export function now(): number {
  return Date.now();
}

export function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16,
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
}

export function matchesAny(
  value: string,
  patterns: (string | RegExp)[],
): boolean {
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      if (value.includes(pattern)) return true;
    } else if (pattern.test(value)) {
      return true;
    }
  }
  return false;
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Never let telemetry serialization throw inside a customer's extension. */
export function safeStringify(value: unknown, max = 200): string {
  if (typeof value === "string") return truncate(value, max);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value !== "object") return truncate(String(value), max);
  try {
    const seen = new WeakSet<object>();
    return truncate(
      JSON.stringify(value, (_key, val) => {
        if (typeof val === "object" && val !== null) {
          if (seen.has(val as object)) return "[Circular]";
          seen.add(val as object);
        }
        if (typeof val === "bigint") return `${val}n`;
        if (typeof val === "function") return "[Function]";
        return val as unknown;
      }) ?? "undefined",
      max,
    );
  } catch {
    return "[Unserializable]";
  }
}

export function hostFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "chrome-extension:") return undefined;
    return parsed.hostname || undefined;
  } catch {
    return undefined;
  }
}

/** Strips query and hash unless the caller opted into full URLs. */
export function sanitizeUrl(url: string | undefined, keepQuery: boolean) {
  if (!url) return undefined;
  if (keepQuery) return truncate(url, 500);
  try {
    const parsed = new URL(url);
    return truncate(`${parsed.origin}${parsed.pathname}`, 500);
  } catch {
    return truncate(url.split("?")[0] ?? url, 500);
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
