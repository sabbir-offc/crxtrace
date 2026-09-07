const DEFAULT_PATTERNS: RegExp[] = [
  // Query params that smell like secrets. Must run before the bare-token rule
  // below, which would otherwise swallow the `?token=` prefix along with the
  // value and leave an unreadable URL.
  /([?&](?:token|key|secret|password|auth|session|sig)=)[^&\s"']+/gi,
  // Bearer / OAuth tokens and long opaque keys
  /\b(?:bearer|token|access_token|refresh_token|id_token)[=:\s"']+[A-Za-z0-9._\-]{8,}/gi,
  // JWTs
  /\beyJ[A-Za-z0-9._-]{10,}\b/g,
  // Common API key prefixes
  /\b(?:sk|pk|rk|api|key)_(?:live|test)?_?[A-Za-z0-9]{12,}\b/gi,
  // Email addresses
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

const SENSITIVE_KEY = /(pass|secret|token|auth|key|cookie|session|credential)/i;

export const REDACTED = "[redacted]";

function scrubString(value: string, extra: RegExp[]): string {
  let output = value;
  for (const pattern of DEFAULT_PATTERNS) {
    pattern.lastIndex = 0;
    output = output.replace(pattern, (match) => {
      // Preserve the `?token=` prefix so the URL stays readable.
      const prefixed = /^[?&][^=]+=/.exec(match);
      return prefixed ? `${prefixed[0]}${REDACTED}` : REDACTED;
    });
  }
  for (const pattern of extra) {
    output = output.replace(pattern, REDACTED);
  }
  return output;
}

function toRegExps(patterns: (string | RegExp)[]): RegExp[] {
  return patterns.map((pattern) =>
    typeof pattern === "string"
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
      : new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`),
  );
}

/**
 * Deep-scrubs strings and drops values under obviously sensitive keys.
 * Runs on every event before it leaves the browser.
 */
export function redact<T>(value: T, patterns: (string | RegExp)[] = []): T {
  const extra = toRegExps(patterns);
  return walk(value, extra, 0) as T;
}

function walk(value: unknown, extra: RegExp[], depth: number): unknown {
  if (depth > 6) return "[depth limit]";

  if (typeof value === "string") return scrubString(value, extra);
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => walk(item, extra, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : walk(entry, extra, depth + 1);
  }
  return output;
}
