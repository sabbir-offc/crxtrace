/**
 * Minimal structural typing for the slice of the extension API we touch.
 * Declared locally so the SDK stays dependency-free and never collides with a
 * consumer's `@types/chrome`.
 */

export interface CrxManifest {
  name?: string;
  version?: string;
  manifest_version?: number;
  action?: { default_popup?: string };
  options_page?: string;
  options_ui?: { page?: string };
  side_panel?: { default_path?: string };
  devtools_page?: string;
  [key: string]: unknown;
}

export interface CrxEventSource<Args extends unknown[]> {
  addListener(cb: (...args: Args) => void): void;
  removeListener?(cb: (...args: Args) => void): void;
  hasListener?(cb: (...args: Args) => void): boolean;
}

export interface CrxMessageSender {
  id?: string;
  tab?: { id?: number; url?: string };
  url?: string;
  origin?: string;
  frameId?: number;
}

export interface CrxStorageArea {
  get(
    keys: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface CrxAlarm {
  name: string;
}

export interface CrxChrome {
  runtime: {
    id?: string;
    lastError?: { message?: string };
    getManifest?(): CrxManifest;
    getURL?(path: string): string;
    sendMessage?(message: unknown): Promise<unknown>;
    onMessage?: CrxEventSource<
      [unknown, CrxMessageSender, (response?: unknown) => void]
    >;
    onInstalled?: CrxEventSource<
      [{ reason?: string; previousVersion?: string }]
    >;
    onStartup?: CrxEventSource<[]>;
    onSuspend?: CrxEventSource<[]>;
  };
  storage?: {
    local?: CrxStorageArea;
    session?: CrxStorageArea;
  };
  alarms?: {
    create(name: string, info: { periodInMinutes?: number; when?: number }): void;
    onAlarm?: CrxEventSource<[CrxAlarm]>;
  };
}

let cached: CrxChrome | null | undefined;

export function getChrome(): CrxChrome | null {
  if (cached !== undefined) return cached;

  const g = globalThis as unknown as {
    chrome?: CrxChrome;
    browser?: CrxChrome;
  };

  if (g.chrome?.runtime?.id) cached = g.chrome;
  else if (g.browser?.runtime?.id) cached = g.browser;
  else if (g.chrome?.runtime) cached = g.chrome;
  else cached = null;

  return cached;
}

/**
 * True once the extension has been reloaded/updated out from under this
 * content script. Every `chrome.*` call from here on throws
 * "Extension context invalidated".
 */
export function isContextInvalidated(): boolean {
  const chrome = getChrome();
  if (!chrome) return false;
  try {
    return !chrome.runtime.id;
  } catch {
    return true;
  }
}

export function getManifest(): CrxManifest {
  try {
    return getChrome()?.runtime.getManifest?.() ?? {};
  } catch {
    return {};
  }
}

/**
 * Reads and clears `chrome.runtime.lastError`. Callback-style extension APIs
 * report failure here instead of throwing, and Chrome logs an unchecked-error
 * warning if you never look at it.
 */
export function takeLastError(): string | null {
  try {
    const message = getChrome()?.runtime.lastError?.message;
    return message ?? null;
  } catch {
    return null;
  }
}
