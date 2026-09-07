import { BreadcrumbBuffer } from "./breadcrumbs";
import { getChrome, getManifest } from "./chrome-api";
import { classifyMv3, isEnvironmental } from "./classify";
import { ServiceWorkerTracker } from "./lifecycle";
import { PersistentQueue } from "./queue";
import { redact } from "./redact";
import { collectRuntimeInfo } from "./surface";
import { deriveCulprit, describeError, parseStack } from "./stacktrace";
import { sendEnvelope } from "./transport";
import {
  SDK_NAME,
  SDK_VERSION,
  type CaptureContext,
  type CrxEvent,
  type Envelope,
  type ExtensionInfo,
  type Level,
  type LifecycleEvent,
  type Mechanism,
  type ResolvedOptions,
  type SessionUpdate,
} from "./types";
import {
  hostFromUrl,
  matchesAny,
  now,
  sanitizeUrl,
  truncate,
  uuid,
} from "./util";

const INSTALL_KEY = "__crxtrace_install";

/** Per-fingerprint burst control. One looping content script must not flood. */
const BURST_WINDOW_MS = 10_000;
const BURST_PER_FINGERPRINT = 5;
const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_MAX = 40;

export class CrxTraceClient {
  readonly options: ResolvedOptions;
  readonly tracker: ServiceWorkerTracker | null;

  private breadcrumbs: BreadcrumbBuffer;
  private queue: PersistentQueue<CrxEvent>;
  private sessions: SessionUpdate[] = [];
  private lifecycle: LifecycleEvent[] = [];
  private tags: Record<string, string> = {};
  private user: CrxEvent["user"];
  private extra: Record<string, unknown> = {};

  private installId: string | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<boolean> | null = null;
  private recovery: Promise<number> | null = null;
  private backoffUntil = 0;

  private burst = new Map<string, { count: number; start: number }>();
  private globalWindow = { count: 0, start: 0 };
  private sessionErrored = false;

  /**
   * @param relay Non-service-worker surfaces hand events to the worker instead
   * of sending them. Resolves false when the worker is unreachable, in which
   * case we fall back to sending directly.
   */
  constructor(
    options: ResolvedOptions,
    private relay?: (event: CrxEvent) => Promise<boolean>,
  ) {
    this.options = options;
    this.breadcrumbs = new BreadcrumbBuffer(options.maxBreadcrumbs);
    this.queue = new PersistentQueue<CrxEvent>(options.maxQueueSize);
    this.tracker =
      options.surface === "service_worker" ? new ServiceWorkerTracker() : null;

    if (options.autoSessionTracking) {
      this.sessions.push({
        bootId: this.tracker?.bootId ?? uuid(),
        surface: options.surface,
        release: options.release,
        environment: options.environment,
        status: "ok",
        startedAt: now(),
      });
    }
  }

  private log(...args: unknown[]): void {
    if (this.options.debug) console.debug("[crxtrace]", ...args);
  }

  addBreadcrumb(crumb: {
    category: string;
    message: string;
    level?: Level;
    data?: Record<string, unknown>;
  }): void {
    this.breadcrumbs.add(crumb);
  }

  setUser(user: CrxEvent["user"]): void {
    this.user = user;
  }

  setTag(key: string, value: string): void {
    this.tags[key] = truncate(String(value), 200);
  }

  setContext(key: string, value: unknown): void {
    this.extra[key] = value;
  }

  recordLifecycle(events: LifecycleEvent[]): void {
    for (const event of events) this.lifecycle.push(event);
    if (events.length) this.scheduleFlush();
  }

  /** True when this event should be dropped before it costs anything. */
  private shouldDrop(message: string, host: string | undefined): boolean {
    const { ignoreErrors, denyHosts, allowHosts, sampleRate } = this.options;

    if (ignoreErrors.length && matchesAny(message, ignoreErrors)) {
      this.log("dropped by ignoreErrors", message);
      return true;
    }

    if (host) {
      if (denyHosts.length && matchesAny(host, denyHosts)) return true;
      if (allowHosts.length && !matchesAny(host, allowHosts)) return true;
    }

    if (sampleRate < 1 && Math.random() >= sampleRate) return true;

    return false;
  }

  private rateLimited(key: string): boolean {
    const current = now();

    if (current - this.globalWindow.start > GLOBAL_WINDOW_MS) {
      this.globalWindow = { count: 0, start: current };
    }
    if (this.globalWindow.count >= GLOBAL_MAX) return true;

    const entry = this.burst.get(key);
    if (!entry || current - entry.start > BURST_WINDOW_MS) {
      this.burst.set(key, { count: 1, start: current });
      this.globalWindow.count += 1;
      return false;
    }

    if (entry.count >= BURST_PER_FINGERPRINT) return true;

    entry.count += 1;
    this.globalWindow.count += 1;
    return false;
  }

  private locationInfo(): { host?: string; url?: string } {
    if (typeof location === "undefined") return {};
    const url = sanitizeUrl(location.href, this.options.sendDefaultPii);
    return { host: hostFromUrl(location.href), url };
  }

  buildEvent(
    input: unknown,
    context: CaptureContext | undefined,
    mechanism: Mechanism,
  ): CrxEvent | null {
    const described = describeError(input);
    const { host, url } = this.locationInfo();

    if (this.shouldDrop(described.message, host)) return null;

    const frames = parseStack(described.stack);
    const culprit = deriveCulprit(frames);
    const mv3Category = classifyMv3(described.message, mechanism);

    // Environmental MV3 failures have meaningless stacks — the same root cause
    // surfaces from dozens of call sites. Group them by category instead.
    const fingerprint =
      context?.fingerprint ??
      (isEnvironmental(mv3Category)
        ? ["mv3", mv3Category, this.options.surface]
        : undefined);

    const limitKey = fingerprint
      ? fingerprint.join("|")
      : `${described.type}|${culprit ?? described.message}`;

    if (this.rateLimited(limitKey)) {
      this.log("rate limited", limitKey);
      return null;
    }

    const event: CrxEvent = {
      eventId: uuid(),
      timestamp: now(),
      level: context?.level ?? "error",
      surface: this.options.surface,
      mechanism,
      handled: context?.handled ?? mechanism === "capture",
      type: described.type,
      message: truncate(described.message, 1000),
      culprit,
      stack: frames.length ? frames : undefined,
      rawStack: frames.length ? undefined : described.stack,
      mv3Category,
      host,
      url,
      release: this.options.release,
      environment: this.options.environment,
      breadcrumbs: this.breadcrumbs.all(),
      tags: { ...this.tags, ...(context?.tags ?? {}) },
      contexts: {
        serviceWorker: this.tracker?.context(),
        extra:
          Object.keys(this.extra).length || context?.extra
            ? { ...this.extra, ...(context?.extra ?? {}) }
            : undefined,
      },
      user: this.user,
      fingerprint,
    };

    return event;
  }

  /** Runs redaction and `beforeSend`, then queues. Shared by capture + relay. */
  ingest(event: CrxEvent): string | undefined {
    let prepared: CrxEvent = redact(event, this.options.scrub);

    if (this.options.beforeSend) {
      try {
        const result = this.options.beforeSend(prepared);
        if (!result) {
          this.log("dropped by beforeSend", prepared.eventId);
          return undefined;
        }
        prepared = result;
      } catch (error) {
        this.log("beforeSend threw, sending original", error);
      }
    }

    if (this.options.autoSessionTracking && !this.sessionErrored) {
      this.sessionErrored = true;
      const session = this.sessions[0];
      if (session) session.status = "errored";
    }

    if (this.relay) {
      void this.relay(prepared).then((accepted) => {
        if (!accepted) this.enqueue(prepared);
      });
      return prepared.eventId;
    }

    this.enqueue(prepared);
    return prepared.eventId;
  }

  /** Runs the orphan sweep exactly once per worker instance. */
  private recoverOnce(): Promise<number> {
    this.recovery ??= this.queue.recover().then((count) => {
      if (count) this.log(`recovered ${count} event(s) from a killed worker`);
      return count;
    });
    return this.recovery;
  }

  private enqueue(event: CrxEvent): void {
    void this.queue.add(event);
    this.tracker?.touch();
    this.scheduleFlush();
  }

  capture(
    input: unknown,
    context?: CaptureContext,
    mechanism: Mechanism = "capture",
  ): string | undefined {
    try {
      const event = this.buildEvent(input, context, mechanism);
      if (!event) return undefined;
      return this.ingest(event);
    } catch (error) {
      // The tracker must never be the thing that breaks the extension.
      this.log("capture failed", error);
      return undefined;
    }
  }

  scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.options.flushDebounceMs);
  }

  private async installIdentifier(): Promise<string> {
    if (this.installId) return this.installId;

    const area = (() => {
      try {
        return getChrome()?.storage?.local ?? null;
      } catch {
        return null;
      }
    })();

    if (!area) {
      this.installId = uuid();
      return this.installId;
    }

    try {
      const bag = await area.get(INSTALL_KEY);
      const existing = bag?.[INSTALL_KEY];
      if (typeof existing === "string" && existing) {
        this.installId = existing;
        return existing;
      }
      const fresh = uuid();
      await area.set({ [INSTALL_KEY]: fresh });
      this.installId = fresh;
      return fresh;
    } catch {
      this.installId = uuid();
      return this.installId;
    }
  }

  private extensionInfo(): ExtensionInfo {
    const manifest = getManifest();
    let id: string | undefined;
    try {
      id = getChrome()?.runtime.id;
    } catch {
      id = undefined;
    }
    return {
      id,
      name: manifest.name,
      version: manifest.version,
      manifestVersion: manifest.manifest_version,
    };
  }

  async flush(): Promise<boolean> {
    if (this.inFlight) return this.inFlight;

    if (now() < this.backoffUntil) {
      this.log("in backoff, skipping flush");
      return false;
    }

    this.inFlight = (async () => {
      // Reclaim anything a previously killed worker left mid-send.
      await this.recoverOnce();

      const events = await this.queue.checkout();
      const sessions = this.sessions.splice(0, this.sessions.length);
      const lifecycle = this.lifecycle.splice(0, this.lifecycle.length);

      if (!events.length && !sessions.length && !lifecycle.length) return true;

      const envelope: Envelope = {
        sdk: { name: SDK_NAME, version: SDK_VERSION },
        sentAt: now(),
        installId: await this.installIdentifier(),
        release: this.options.release,
        ...(this.options.debugId ? { debugId: this.options.debugId } : {}),
        environment: this.options.environment,
        extension: this.extensionInfo(),
        runtime: collectRuntimeInfo(),
        events,
        sessions,
        lifecycle,
      };

      const result = await sendEnvelope(this.options.dsn, envelope);

      if (result.ok) {
        await this.queue.commit();
        this.log(`sent ${events.length} event(s)`);
        return true;
      }

      if (result.retryable) {
        this.backoffUntil = now() + (result.retryAfterMs ?? 30_000);
        await this.queue.rollback();
        this.sessions.unshift(...sessions);
        this.lifecycle.unshift(...lifecycle);
        this.log("flush failed, will retry", result.status);
      } else {
        // A 401 or 400 fails identically forever; holding the batch would
        // just retry it on every boot.
        await this.queue.commit();
        this.log("flush rejected permanently, dropping", result.status);
      }

      return false;
    })();

    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }
}
