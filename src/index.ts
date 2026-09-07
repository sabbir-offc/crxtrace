import { CrxTraceClient } from "./client";
import {
  installAutoBreadcrumbs,
  installGlobalHandlers,
  installServiceWorkerLifecycle,
} from "./handlers";
import { resolveOptions } from "./options";
import { installRelayReceiver, relayToWorker } from "./relay";
import type {
  Breadcrumb,
  CaptureContext,
  CrxEvent,
  CrxTraceOptions,
  Level,
} from "./types";

export * from "./types";
export { CrxTraceClient } from "./client";
export { detectSurface } from "./surface";

let client: CrxTraceClient | null = null;
let teardown: (() => void)[] = [];

/**
 * Starts CrxTrace. Call once per surface — in the service worker, in each
 * content script, and in any extension page you want covered.
 *
 * ```js
 * import * as CrxTrace from "crxtrace";
 * CrxTrace.init({ dsn: "https://crxtrace.dev/api/ingest/pk_live_..." });
 * ```
 */
export function init(options: CrxTraceOptions): CrxTraceClient {
  if (client) {
    console.warn("[crxtrace] init() called twice in one context; ignoring.");
    return client;
  }

  const resolved = resolveOptions(options);
  const isWorker = resolved.surface === "service_worker";

  // Only the worker holds the durable queue; everything else forwards to it.
  client = new CrxTraceClient(resolved, isWorker ? undefined : relayToWorker);

  teardown.push(installGlobalHandlers(client));

  if (resolved.autoBreadcrumbs) {
    teardown.push(installAutoBreadcrumbs(client));
  }

  if (isWorker) {
    installRelayReceiver(client);
    if (resolved.trackLifecycle) {
      installServiceWorkerLifecycle(client);
    }
  }

  return client;
}

function active(): CrxTraceClient | null {
  if (!client && typeof console !== "undefined") {
    // Silent no-ops are worse than a nudge — a developer who forgot init()
    // would otherwise sit and wait for events that never arrive.
    console.warn("[crxtrace] not initialized — call init() first.");
  }
  return client;
}

export function captureException(
  error: unknown,
  context?: CaptureContext,
): string | undefined {
  return active()?.capture(error, context, "capture");
}

export function captureMessage(
  message: string,
  context?: CaptureContext,
): string | undefined {
  return active()?.capture(message, {
    level: "info",
    handled: true,
    ...context,
  });
}

export function addBreadcrumb(crumb: {
  category: string;
  message: string;
  level?: Level;
  data?: Record<string, unknown>;
}): void {
  client?.addBreadcrumb(crumb);
}

export function setUser(user: CrxEvent["user"]): void {
  client?.setUser(user);
}

export function setTag(key: string, value: string): void {
  client?.setTag(key, value);
}

export function setContext(key: string, value: unknown): void {
  client?.setContext(key, value);
}

/** Sends everything queued. Resolves false if the server rejected the batch. */
export function flush(): Promise<boolean> {
  return client?.flush() ?? Promise.resolve(true);
}

/**
 * Runs async work with the service worker's death in mind.
 *
 * Chrome kills an idle MV3 worker without warning. If it dies while this
 * promise is outstanding, the task name is reported on the next boot as a
 * `sw_terminated` event — turning "my extension randomly does nothing" into
 * "the worker died during fetchTranscript, 11 times yesterday."
 *
 * ```js
 * const transcript = await CrxTrace.track("fetchTranscript", getTranscript(id));
 * ```
 */
export async function track<T>(
  name: string,
  work: Promise<T> | (() => Promise<T>),
): Promise<T> {
  const done = client?.tracker?.beginTask(name);
  try {
    return await (typeof work === "function" ? work() : work);
  } catch (error) {
    client?.capture(error, { tags: { task: name }, handled: false }, "capture");
    throw error;
  } finally {
    done?.();
  }
}

/** Wraps a function so throws are reported and then rethrown unchanged. */
export function wrap<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  return function wrapped(this: unknown, ...args: A): R {
    try {
      const result = fn.apply(this, args);
      if (result instanceof Promise) {
        return result.catch((error: unknown) => {
          client?.capture(error, { handled: false }, "wrap");
          throw error;
        }) as R;
      }
      return result;
    } catch (error) {
      client?.capture(error, { handled: false }, "wrap");
      throw error;
    }
  };
}

/** Flushes, removes instrumentation, and resets module state. */
export async function close(): Promise<boolean> {
  const result = (await client?.flush()) ?? true;
  for (const undo of teardown) {
    try {
      undo();
    } catch {
      // Best effort.
    }
  }
  teardown = [];
  client = null;
  return result;
}

export type { Breadcrumb, CaptureContext, CrxTraceOptions };
