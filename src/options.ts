import { getManifest } from "./chrome-api";
import { detectSurface } from "./surface";
import type { CrxTraceOptions, ResolvedOptions } from "./types";
import { clamp } from "./util";

/**
 * Store builds get an `update_url` injected into the manifest at packaging
 * time; unpacked loads never have one. It's the only reliable unpacked signal
 * that doesn't cost us the `management` permission.
 */
function looksUnpacked(): boolean {
  const manifest = getManifest();
  return manifest.update_url === undefined;
}

export function resolveOptions(options: CrxTraceOptions): ResolvedOptions {
  if (!options?.dsn || typeof options.dsn !== "string") {
    throw new Error(
      "CrxTrace: `dsn` is required — the endpoint your events are sent to.",
    );
  }

  const manifest = getManifest();

  return {
    dsn: options.dsn.replace(/\/+$/, ""),
    release: options.release ?? manifest.version,
    // No default. An absent debugId means "this build has no uploaded maps",
    // which is different from guessing one and having the server look for maps
    // that were never uploaded.
    debugId: options.debugId,
    environment:
      options.environment ?? (looksUnpacked() ? "development" : "production"),
    surface: options.surface ?? detectSurface(),
    sampleRate: clamp(options.sampleRate ?? 1, 0, 1),
    maxBreadcrumbs: clamp(options.maxBreadcrumbs ?? 40, 0, 200),
    maxQueueSize: clamp(options.maxQueueSize ?? 60, 1, 500),
    flushIntervalMinutes: Math.max(options.flushIntervalMinutes ?? 1, 0.5),
    flushDebounceMs: clamp(options.flushDebounceMs ?? 1500, 0, 30_000),
    autoSessionTracking: options.autoSessionTracking ?? true,
    trackLifecycle: options.trackLifecycle ?? true,
    autoBreadcrumbs: options.autoBreadcrumbs ?? true,
    ignoreErrors: options.ignoreErrors ?? [],
    denyHosts: options.denyHosts ?? [],
    allowHosts: options.allowHosts ?? [],
    scrub: options.scrub ?? [],
    sendDefaultPii: options.sendDefaultPii ?? false,
    beforeSend: options.beforeSend,
    debug: options.debug ?? false,
  };
}
