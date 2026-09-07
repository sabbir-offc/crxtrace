import type { CrxTraceClient } from "./client";
import { getChrome, isContextInvalidated } from "./chrome-api";
import type { CrxEvent } from "./types";

const RELAY_TAG = "__crxtrace_relay";

interface RelayMessage {
  [RELAY_TAG]: 1;
  event: CrxEvent;
}

function isRelayMessage(value: unknown): value is RelayMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[RELAY_TAG] === 1 &&
    typeof (value as RelayMessage).event === "object"
  );
}

/**
 * Content scripts run inside pages we don't control, so they never talk to the
 * ingest endpoint directly: the service worker owns the single durable queue,
 * and routing through it keeps retries and ordering in one place. Sending also
 * wakes a sleeping worker, which is exactly what we want.
 */
export async function relayToWorker(event: CrxEvent): Promise<boolean> {
  if (isContextInvalidated()) return false;

  const chrome = getChrome();
  const send = chrome?.runtime.sendMessage;
  if (!chrome || !send) return false;

  try {
    const message: RelayMessage = { [RELAY_TAG]: 1, event };
    await send.call(chrome.runtime, message);
    return true;
  } catch {
    // Worker unreachable, or the extension was reloaded out from under us.
    // Falling back to a direct send is better than losing the event.
    return false;
  }
}

/**
 * Installed in the service worker. Accepts events forwarded from content
 * scripts and extension pages and folds them into the shared queue.
 */
export function installRelayReceiver(client: CrxTraceClient): void {
  const chrome = getChrome();
  const onMessage = chrome?.runtime.onMessage;
  if (!onMessage) return;

  onMessage.addListener((message, _sender, sendResponse) => {
    if (!isRelayMessage(message)) return;

    try {
      client.ingest(message.event);
    } catch {
      // Never let a malformed relay break the host's message handling.
    }

    try {
      sendResponse({ ok: true });
    } catch {
      // Channel already closed; the event is queued either way.
    }
  });
}
