import { vi } from "vitest";

export interface FakeStorage {
  data: Record<string, unknown>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

export function createStorage(
  initial: Record<string, unknown> = {},
): FakeStorage {
  const data: Record<string, unknown> = { ...initial };

  return {
    data,
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) {
        if (key in data) out[key] = data[key];
      }
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
  };
}

export interface FakeChromeOptions {
  id?: string;
  manifest?: Record<string, unknown>;
  storage?: FakeStorage;
}

/**
 * Installs a minimal `globalThis.chrome`. `getChrome()` memoizes its lookup, so
 * every test that uses this must `vi.resetModules()` and re-import the module
 * under test afterwards.
 */
export function installChrome(options: FakeChromeOptions = {}) {
  const storage = options.storage ?? createStorage();
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const source = (name: string) => ({
    addListener: (cb: (...args: unknown[]) => void) => {
      (listeners[name] ??= []).push(cb);
    },
    removeListener: (cb: (...args: unknown[]) => void) => {
      listeners[name] = (listeners[name] ?? []).filter((fn) => fn !== cb);
    },
  });

  const chrome = {
    runtime: {
      id: options.id ?? "abcdefghijklmnopabcdefghijklmnop",
      getManifest: () => options.manifest ?? { name: "Test", version: "1.2.3" },
      sendMessage: vi.fn(async () => ({ ok: true })),
      onMessage: source("onMessage"),
      onInstalled: source("onInstalled"),
      onStartup: source("onStartup"),
      onSuspend: source("onSuspend"),
    },
    storage: { local: storage },
    alarms: {
      create: vi.fn(),
      onAlarm: source("onAlarm"),
    },
  };

  (globalThis as Record<string, unknown>).chrome = chrome;

  return {
    chrome,
    storage,
    emit(name: string, ...args: unknown[]) {
      for (const cb of listeners[name] ?? []) cb(...args);
    },
  };
}

export function clearChrome(): void {
  delete (globalThis as Record<string, unknown>).chrome;
}
