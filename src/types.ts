export const SDK_NAME = "crxtrace-js";
export const SDK_VERSION = "0.1.0";

/** Where in the extension the event came from. */
export type Surface =
  | "service_worker"
  | "content_script"
  | "popup"
  | "options"
  | "sidepanel"
  | "devtools"
  | "offscreen"
  | "extension_page"
  | "unknown";

export type Level = "fatal" | "error" | "warning" | "info";

/**
 * How the error reached us. Useful when triaging: an `sw_termination` event
 * has no stack because nobody threw — the worker just died mid-task.
 */
export type Mechanism =
  | "onerror"
  | "unhandledrejection"
  | "capture"
  | "wrap"
  | "last_error"
  | "console"
  | "sw_termination"
  | "relay";

/**
 * MV3-specific error families. These are the failures that show up as
 * meaningless noise in generic error trackers.
 */
export type Mv3Category =
  | "context_invalidated"
  | "no_receiver"
  | "message_port_closed"
  | "sw_terminated"
  | "storage_quota"
  | "permission_denied"
  | "script_injection"
  | "tab_gone"
  | "native_host"
  | "csp"
  | "network"
  | "user_gesture"
  | "unknown";

export interface StackFrame {
  function?: string;
  file?: string;
  line?: number;
  column?: number;
  /** True when the frame belongs to the extension bundle, not a page script. */
  inApp: boolean;
}

export interface Breadcrumb {
  t: number;
  category: string;
  message: string;
  level?: Level;
  data?: Record<string, unknown>;
}

export interface ExtensionInfo {
  id?: string;
  name?: string;
  version?: string;
  manifestVersion?: number;
}

export interface RuntimeInfo {
  browser: string;
  browserVersion?: string;
  platform?: string;
  language?: string;
}

export interface ServiceWorkerContext {
  bootId: string;
  /** ms since this service worker instance started. */
  uptimeMs: number;
  /** True when this is the first event after a cold boot of the worker. */
  coldStart: boolean;
  /** Names of tasks that were still running when the event fired. */
  pendingTasks?: string[];
  /** Approximate lifetime of the *previous* worker instance, in ms. */
  previousUptimeMs?: number;
  wakeReason?: string;
}

export interface CrxEvent {
  eventId: string;
  timestamp: number;
  level: Level;
  surface: Surface;
  mechanism: Mechanism;
  handled: boolean;
  type: string;
  message: string;
  culprit?: string;
  stack?: StackFrame[];
  rawStack?: string;
  mv3Category: Mv3Category;
  /** Page host for content script errors — the whole point of host grouping. */
  host?: string;
  url?: string;
  release?: string;
  environment: string;
  breadcrumbs: Breadcrumb[];
  tags: Record<string, string>;
  contexts: {
    serviceWorker?: ServiceWorkerContext;
    extra?: Record<string, unknown>;
  };
  user?: { id?: string; email?: string; username?: string };
  fingerprint?: string[];
}

export type SessionStatus = "ok" | "errored";

export interface SessionUpdate {
  bootId: string;
  surface: Surface;
  release?: string;
  environment: string;
  status: SessionStatus;
  startedAt: number;
}

export type LifecycleKind =
  | "boot"
  | "install"
  | "update"
  | "browser_update"
  | "startup"
  | "suspend"
  | "terminated";

export interface LifecycleEvent {
  kind: LifecycleKind;
  at: number;
  bootId: string;
  release?: string;
  data?: Record<string, unknown>;
}

export interface Envelope {
  sdk: { name: string; version: string };
  sentAt: number;
  installId: string;
  release?: string;
  environment: string;
  extension: ExtensionInfo;
  runtime: RuntimeInfo;
  events: CrxEvent[];
  sessions: SessionUpdate[];
  lifecycle: LifecycleEvent[];
}

export interface CaptureContext {
  level?: Level;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  fingerprint?: string[];
  mechanism?: Mechanism;
  handled?: boolean;
}

export interface CrxTraceOptions {
  /**
   * The endpoint events are POSTed to, e.g.
   * `https://your-ingest-endpoint/pk_live_abc123`.
   *
   * Any server that accepts the envelope and answers 2xx works — see
   * `examples/ingest-server.mjs` for a reference implementation.
   */
  dsn: string;
  /** Defaults to the version in your manifest. */
  release?: string;
  /** Defaults to "production", or "development" for unpacked installs. */
  environment?: string;
  /** Auto-detected. Only set this if detection guesses wrong. */
  surface?: Surface;
  /** 0..1 — fraction of events actually sent. Default 1. */
  sampleRate?: number;
  /** Default 40. */
  maxBreadcrumbs?: number;
  /** Max events held in the offline queue. Default 60. */
  maxQueueSize?: number;
  /** How often the background flush alarm runs, in minutes. Default 1. */
  flushIntervalMinutes?: number;
  /** Debounce before an in-process flush, in ms. Default 1500. */
  flushDebounceMs?: number;
  /** Track release health (crash-free worker sessions). Default true. */
  autoSessionTracking?: boolean;
  /** Record install/update/startup/termination events. Default true. */
  trackLifecycle?: boolean;
  /** Auto-instrument console.error/warn, fetch, and runtime messaging. Default true. */
  autoBreadcrumbs?: boolean;
  /** Drop events whose message matches any of these. */
  ignoreErrors?: (string | RegExp)[];
  /** Drop content script events on hosts matching any of these. */
  denyHosts?: (string | RegExp)[];
  /** Only report content script events on hosts matching one of these. */
  allowHosts?: (string | RegExp)[];
  /** Extra patterns to redact from messages, stacks, and breadcrumb data. */
  scrub?: (string | RegExp)[];
  /** Include page URLs and query strings verbatim. Default false. */
  sendDefaultPii?: boolean;
  /** Return null to drop the event. */
  beforeSend?: (event: CrxEvent) => CrxEvent | null;
  /** Log SDK activity to the console. Default false. */
  debug?: boolean;
}

export interface ResolvedOptions extends Required<
  Omit<
    CrxTraceOptions,
    "beforeSend" | "release" | "surface" | "allowHosts" | "denyHosts" | "ignoreErrors" | "scrub"
  >
> {
  release?: string;
  surface: Surface;
  allowHosts: (string | RegExp)[];
  denyHosts: (string | RegExp)[];
  ignoreErrors: (string | RegExp)[];
  scrub: (string | RegExp)[];
  beforeSend?: (event: CrxEvent) => CrxEvent | null;
}
