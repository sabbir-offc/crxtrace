import type { CrxTraceClient } from "./client";
import { getChrome } from "./chrome-api";
import { ServiceWorkerTracker } from "./lifecycle";
import { parseStack } from "./stacktrace";
import type { Mechanism } from "./types";
import { safeStringify, sanitizeUrl } from "./util";

interface ErrorEventLike {
  error?: unknown;
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

interface RejectionEventLike {
  reason?: unknown;
}

/**
 * A content script shares the page's window, so `window.onerror` also fires for
 * the host site's own bugs. Reporting those would drown the developer in noise
 * they cannot fix — and would quietly turn the SDK into a scraper of other
 * people's stack traces. Only events with a frame inside our bundle count.
 */
function belongsToExtension(input: unknown): boolean {
  const stack =
    input instanceof Error
      ? input.stack
      : typeof (input as { stack?: unknown })?.stack === "string"
        ? ((input as { stack: string }).stack)
        : undefined;

  if (!stack) return false;
  return parseStack(stack).some((frame) => frame.inApp);
}

export function installGlobalHandlers(client: CrxTraceClient): () => void {
  const target = globalThis as unknown as {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
    removeEventListener?: (
      type: string,
      listener: (event: unknown) => void,
    ) => void;
  };

  if (typeof target.addEventListener !== "function") return () => {};

  const isContentScript = client.options.surface === "content_script";

  const onError = (raw: unknown) => {
    const event = raw as ErrorEventLike;
    const thrown = event?.error ?? event?.message ?? raw;

    if (isContentScript && !belongsToExtension(event?.error ?? thrown)) return;

    client.capture(thrown, { handled: false, level: "error" }, "onerror");
  };

  const onRejection = (raw: unknown) => {
    const reason = (raw as RejectionEventLike)?.reason ?? raw;

    if (isContentScript && !belongsToExtension(reason)) return;

    client.capture(
      reason,
      { handled: false, level: "error" },
      "unhandledrejection",
    );
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  return () => {
    target.removeEventListener?.("error", onError);
    target.removeEventListener?.("unhandledrejection", onRejection);
  };
}

/**
 * Cheap ambient context. Each of these is a thing developers reach for when
 * reconstructing what the worker was doing right before it fell over.
 */
export function installAutoBreadcrumbs(client: CrxTraceClient): () => void {
  const undo: (() => void)[] = [];
  const scope = globalThis as unknown as Record<string, unknown>;

  // console.error / console.warn
  const consoleRef = scope.console as Console | undefined;
  if (consoleRef) {
    for (const level of ["error", "warn"] as const) {
      const original = consoleRef[level];
      if (typeof original !== "function") continue;

      consoleRef[level] = ((...args: unknown[]) => {
        client.addBreadcrumb({
          category: "console",
          level: level === "warn" ? "warning" : "error",
          message: args.map((arg) => safeStringify(arg, 120)).join(" "),
        });
        return original.apply(consoleRef, args);
      }) as typeof original;

      undo.push(() => {
        consoleRef[level] = original;
      });
    }
  }

  // fetch
  const originalFetch = scope.fetch as typeof fetch | undefined;
  if (typeof originalFetch === "function") {
    const dsn = client.options.dsn;

    scope.fetch = async function patchedFetch(
      this: unknown,
      ...args: Parameters<typeof fetch>
    ) {
      const request = args[0];
      const url =
        typeof request === "string"
          ? request
          : request instanceof URL
            ? request.href
            : ((request as Request)?.url ?? "");

      // Never breadcrumb our own uploads — that recurses.
      if (url.startsWith(dsn)) {
        return originalFetch.apply(this, args) as Promise<Response>;
      }

      const method =
        (args[1]?.method ??
          (typeof request === "object" && "method" in (request as Request)
            ? (request as Request).method
            : "GET")) || "GET";

      try {
        const response = (await originalFetch.apply(this, args)) as Response;
        client.addBreadcrumb({
          category: "fetch",
          message: `${method} ${sanitizeUrl(url, client.options.sendDefaultPii)}`,
          level: response.ok ? "info" : "warning",
          data: { status: response.status },
        });
        return response;
      } catch (error) {
        client.addBreadcrumb({
          category: "fetch",
          message: `${method} ${sanitizeUrl(url, client.options.sendDefaultPii)} failed`,
          level: "error",
          data: { error: safeStringify(error, 120) },
        });
        throw error;
      }
    } as typeof fetch;

    undo.push(() => {
      scope.fetch = originalFetch;
    });
  }

  // chrome.runtime.sendMessage — the usual source of "no receiver" errors.
  const runtime = getChrome()?.runtime;

  if (runtime && typeof runtime.sendMessage === "function") {
    const original = runtime.sendMessage.bind(runtime);

    runtime.sendMessage = async (message: unknown) => {
      client.addBreadcrumb({
        category: "runtime.sendMessage",
        message: safeStringify(message, 120),
      });
      return original(message);
    };

    undo.push(() => {
      runtime.sendMessage = original;
    });
  }

  return () => {
    for (const fn of undo) {
      try {
        fn();
      } catch {
        // Restoring is best effort.
      }
    }
  };
}

/**
 * Service-worker-only wiring: install/update/startup reporting, a periodic
 * alarm so queued events still leave a mostly-idle worker, and a clean-exit
 * marker so the next boot doesn't misreport a polite shutdown as a crash.
 */
export function installServiceWorkerLifecycle(client: CrxTraceClient): void {
  const chrome = getChrome();
  const tracker = client.tracker;
  if (!chrome || !tracker) return;

  void tracker.start().then((events) => client.recordLifecycle(events));

  chrome.runtime.onInstalled?.addListener((details) => {
    tracker.noteWakeReason(details?.reason ?? "installed");
    client.recordLifecycle([
      ServiceWorkerTracker.lifecycleFromInstall(
        details?.reason,
        details?.previousVersion,
        tracker.bootId,
      ),
    ]);
  });

  chrome.runtime.onStartup?.addListener(() => {
    tracker.noteWakeReason("startup");
    client.recordLifecycle([
      { kind: "startup", at: Date.now(), bootId: tracker.bootId },
    ]);
  });

  chrome.runtime.onSuspend?.addListener(() => {
    client.recordLifecycle([
      { kind: "suspend", at: Date.now(), bootId: tracker.bootId },
    ]);
    void tracker.markClean();
    void client.flush();
  });

  // The debounced flush often loses the race with worker termination; an alarm
  // wakes the worker back up and drains whatever survived in storage.
  const alarms = chrome.alarms;
  if (alarms) {
    try {
      alarms.create("crxtrace-flush", {
        periodInMinutes: client.options.flushIntervalMinutes,
      });
      alarms.onAlarm?.addListener((alarm) => {
        if (alarm?.name === "crxtrace-flush") {
          tracker.noteWakeReason("alarm");
          // Also refreshes `lastSeen`, which is the only thing bounding how
          // long a killed worker is reported to have lived.
          tracker.touch();
          void client.flush();
        }
      });
    } catch {
      // `alarms` permission not granted — periodic flush is a nice-to-have.
    }
  }
}
