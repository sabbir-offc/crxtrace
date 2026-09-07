import { getChrome, getManifest } from "./chrome-api";
import type { RuntimeInfo, Surface } from "./types";

function isServiceWorkerScope(): boolean {
  if (typeof window !== "undefined") return false;
  const scope = globalThis as unknown as {
    ServiceWorkerGlobalScope?: unknown;
    registration?: unknown;
    clients?: unknown;
  };
  if (
    typeof scope.ServiceWorkerGlobalScope === "function" &&
    globalThis instanceof
      (scope.ServiceWorkerGlobalScope as new () => unknown as never)
  ) {
    return true;
  }
  return Boolean(scope.registration) || Boolean(scope.clients);
}

function normalizeManifestPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const cleaned = path.split("?")[0]?.split("#")[0] ?? path;
  return cleaned.replace(/^\/+/, "");
}

/**
 * Works out which part of the extension is running. Explicit `options.surface`
 * always wins; this is only the fallback.
 */
export function detectSurface(): Surface {
  if (isServiceWorkerScope()) return "service_worker";

  if (typeof document === "undefined" || typeof location === "undefined") {
    return "unknown";
  }

  const chrome = getChrome();
  if (!chrome) return "unknown";

  const hasDevtools = Boolean(
    (chrome as unknown as { devtools?: unknown }).devtools,
  );
  if (hasDevtools) return "devtools";

  const protocol = location.protocol;

  if (protocol === "chrome-extension:" || protocol === "moz-extension:") {
    const manifest = getManifest();
    const current = location.pathname.replace(/^\/+/, "");

    const popup = normalizeManifestPath(manifest.action?.default_popup);
    const options = normalizeManifestPath(
      manifest.options_ui?.page ?? manifest.options_page,
    );
    const sidepanel = normalizeManifestPath(manifest.side_panel?.default_path);
    const devtools = normalizeManifestPath(manifest.devtools_page);

    if (popup && current === popup) return "popup";
    if (options && current === options) return "options";
    if (sidepanel && current === sidepanel) return "sidepanel";
    if (devtools && current === devtools) return "devtools";
    if (/offscreen/i.test(current)) return "offscreen";
    return "extension_page";
  }

  // Injected into a web page: http(s), file, or a sandboxed frame.
  return "content_script";
}

/** True when the surface has no direct network access we should rely on. */
export function isRelaySurface(surface: Surface): boolean {
  return surface === "content_script";
}

function parseBrowser(ua: string): { browser: string; version?: string } {
  const edge = /Edg\/([\d.]+)/.exec(ua);
  if (edge) return { browser: "edge", version: edge[1] };
  const opera = /OPR\/([\d.]+)/.exec(ua);
  if (opera) return { browser: "opera", version: opera[1] };
  const brave = /Brave\/([\d.]+)/.exec(ua);
  if (brave) return { browser: "brave", version: brave[1] };
  const firefox = /Firefox\/([\d.]+)/.exec(ua);
  if (firefox) return { browser: "firefox", version: firefox[1] };
  const chrome = /Chrome\/([\d.]+)/.exec(ua);
  if (chrome) return { browser: "chrome", version: chrome[1] };
  return { browser: "unknown" };
}

function parsePlatform(ua: string): string | undefined {
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X/i.test(ua)) return "macos";
  if (/CrOS/i.test(ua)) return "chromeos";
  if (/Android/i.test(ua)) return "android";
  if (/Linux/i.test(ua)) return "linux";
  return undefined;
}

export function collectRuntimeInfo(): RuntimeInfo {
  const nav = (globalThis as unknown as { navigator?: Navigator }).navigator;
  const ua = nav?.userAgent ?? "";
  const { browser, version } = parseBrowser(ua);

  return {
    browser,
    browserVersion: version,
    platform: parsePlatform(ua),
    language: nav?.language,
  };
}
