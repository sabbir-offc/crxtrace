import type { Envelope } from "./types";
import { SDK_NAME, SDK_VERSION } from "./types";

export interface SendResult {
  ok: boolean;
  /** False for permanent failures — a bad DSN must not retry forever. */
  retryable: boolean;
  status?: number;
  retryAfterMs?: number;
}

/** `keepalive` lets a request outlive the worker, but only for small bodies. */
const KEEPALIVE_LIMIT = 60_000;

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());

  return undefined;
}

export async function sendEnvelope(
  dsn: string,
  envelope: Envelope,
): Promise<SendResult> {
  let body: string;
  try {
    body = JSON.stringify(envelope);
  } catch {
    // Unserializable payload is our bug, not a network problem — dropping it
    // is better than retrying it forever.
    return { ok: false, retryable: false };
  }

  try {
    const response = await fetch(dsn, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-crxtrace-sdk": `${SDK_NAME}/${SDK_VERSION}`,
      },
      body,
      keepalive: body.length < KEEPALIVE_LIMIT,
      credentials: "omit",
      cache: "no-store",
    });

    if (response.ok) return { ok: true, retryable: false, status: response.status };

    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));

    // 429 and 5xx are worth another attempt. Everything else (401 bad key,
    // 413 too large, 400 malformed) will fail identically next time.
    const retryable = response.status === 429 || response.status >= 500;

    return { ok: false, retryable, status: response.status, retryAfterMs };
  } catch {
    // Offline, DNS failure, or the worker was torn down mid-request.
    return { ok: false, retryable: true };
  }
}
