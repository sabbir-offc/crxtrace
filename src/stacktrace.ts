import { getChrome } from "./chrome-api";
import type { StackFrame } from "./types";

const CHROMIUM_FRAME =
  /^\s*at (?:(.+?)\s+\()?((?:chrome-extension|moz-extension|https?|file|blob|data):[^)]*|<anonymous>|native)\)?\s*$/;
const GECKO_FRAME = /^\s*(.*?)@((?:chrome|moz|resource|https?|file|blob)[^\s]*)\s*$/;
const LOCATION = /^(.*?):(\d+):(\d+)$/;

function splitLocation(raw: string): {
  file: string;
  line?: number;
  column?: number;
} {
  const match = LOCATION.exec(raw);
  if (!match) return { file: raw };
  return {
    file: match[1] ?? raw,
    line: Number(match[2]),
    column: Number(match[3]),
  };
}

/**
 * Rewrites `chrome-extension://<32-char id>/background.js` to
 * `app:///background.js`. Without this every user's stack looks different and
 * grouping falls apart across installs.
 */
export function normalizeFile(file: string): string {
  return file.replace(
    /^(?:chrome|moz)-extension:\/\/[a-z0-9-]+\//i,
    "app:///",
  );
}

function isInApp(file: string): boolean {
  if (file.startsWith("app:///")) return true;
  const id = (() => {
    try {
      return getChrome()?.runtime.id;
    } catch {
      return undefined;
    }
  })();
  if (id && file.includes(id)) return true;
  return /^(?:chrome|moz)-extension:\/\//i.test(file);
}

export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];

  const frames: StackFrame[] = [];

  for (const line of stack.split("\n")) {
    if (!line.trim()) continue;

    let fn: string | undefined;
    let location: string | undefined;

    const chromium = CHROMIUM_FRAME.exec(line);
    if (chromium) {
      fn = chromium[1];
      location = chromium[2];
    } else {
      const gecko = GECKO_FRAME.exec(line);
      if (gecko) {
        fn = gecko[1] || undefined;
        location = gecko[2];
      }
    }

    if (!location) continue;
    if (location === "native" || location === "<anonymous>") {
      frames.push({ function: fn, file: location, inApp: false });
      continue;
    }

    const { file, line: lineNo, column } = splitLocation(location);
    const normalized = normalizeFile(file);

    frames.push({
      function: fn?.replace(/^(?:async\s+|new\s+)/, "") || undefined,
      file: normalized,
      line: lineNo,
      column,
      inApp: isInApp(normalized),
    });
  }

  // Deepest frame first is easier to scan in a UI and matches how the
  // fingerprint is derived.
  return frames.slice(0, 40);
}

/** Short "where did this happen" label used as the issue subtitle. */
export function deriveCulprit(frames: StackFrame[]): string | undefined {
  const frame = frames.find((f) => f.inApp) ?? frames[0];
  if (!frame) return undefined;

  const file = frame.file ? frame.file.replace(/^app:\/\/\//, "") : "?";
  const fn = frame.function;
  if (fn && frame.line) return `${fn} (${file}:${frame.line})`;
  if (fn) return `${fn} (${file})`;
  if (frame.line) return `${file}:${frame.line}`;
  return file;
}

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
}

/** Normalizes anything a caller might throw into a type/message/stack triple. */
export function describeError(input: unknown): {
  type: string;
  message: string;
  stack?: string;
} {
  if (input instanceof Error) {
    return {
      type: input.name || "Error",
      message: input.message || String(input),
      stack: input.stack,
    };
  }

  if (typeof input === "string") {
    return { type: "Error", message: input };
  }

  if (input && typeof input === "object") {
    const err = input as ErrorLike;
    if (typeof err.message === "string") {
      return {
        type: typeof err.name === "string" ? err.name : "Error",
        message: err.message,
        stack: typeof err.stack === "string" ? err.stack : undefined,
      };
    }

    // Rejecting with a plain object is common in extension code
    // (`reject({ ok: false })`), and Sentry renders it as "Non-Error exception".
    try {
      return {
        type: "UnknownError",
        message: JSON.stringify(input).slice(0, 400),
      };
    } catch {
      return { type: "UnknownError", message: Object.prototype.toString.call(input) };
    }
  }

  return { type: "UnknownError", message: String(input) };
}
