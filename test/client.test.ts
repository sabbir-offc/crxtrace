import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearChrome, createStorage, installChrome, type FakeStorage } from "./helpers";
import type { CrxEvent, CrxTraceOptions, Envelope } from "../src/types";

const DSN = "https://ingest.test/api/ingest/pk_test_123";

/**
 * Builds a client against a given storage. Pass the same storage twice to
 * simulate a service worker being killed and rebooted.
 */
async function makeClient(
  overrides: Partial<CrxTraceOptions> = {},
  storage: FakeStorage = createStorage(),
) {
  vi.resetModules();
  installChrome({ storage });

  const { CrxTraceClient } = await import("../src/client");
  const { resolveOptions } = await import("../src/options");

  const options = resolveOptions({
    dsn: DSN,
    surface: "service_worker",
    // Keep the debounced flush from firing on its own mid-test.
    flushDebounceMs: 60_000,
    ...overrides,
  });

  return { client: new CrxTraceClient(options), storage };
}

function mockFetch(status = 200, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
  }));
  (globalThis as Record<string, unknown>).fetch = fetchMock;
  return fetchMock;
}

function sentEnvelope(
  fetchMock: ReturnType<typeof mockFetch>,
  index = 0,
): Envelope {
  const call = fetchMock.mock.calls[index] as unknown as [string, { body: string }];
  return JSON.parse(call[1].body) as Envelope;
}

describe("CrxTraceClient", () => {
  beforeEach(() => {
    mockFetch();
  });

  afterEach(() => {
    clearChrome();
    delete (globalThis as Record<string, unknown>).fetch;
    vi.resetModules();
  });

  it("captures an error and ships it in an envelope", async () => {
    const fetchMock = mockFetch();
    const { client } = await makeClient();

    client.capture(new TypeError("cannot read properties of undefined"));
    await client.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const envelope = sentEnvelope(fetchMock);
    expect(envelope.events).toHaveLength(1);
    expect(envelope.events[0]?.type).toBe("TypeError");
    expect(envelope.extension.version).toBe("1.2.3");
    expect(envelope.sdk.name).toBe("crxtrace-js");
  });

  it("tags MV3 failures with a category instead of a stack", async () => {
    const fetchMock = mockFetch();
    const { client } = await makeClient();

    client.capture(
      new Error("Could not establish connection. Receiving end does not exist."),
    );
    await client.flush();

    const event = sentEnvelope(fetchMock).events[0] as CrxEvent;
    expect(event.mv3Category).toBe("no_receiver");
    // Environmental failures group by category, not by call site.
    expect(event.fingerprint).toEqual(["mv3", "no_receiver", "service_worker"]);
  });

  it("redacts secrets before anything leaves the browser", async () => {
    const fetchMock = mockFetch();
    const { client } = await makeClient();

    client.capture(
      new Error("auth failed for a@b.com token=sk_live_abcdef123456"),
    );
    await client.flush();

    const body = (
      fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    )[1].body;
    expect(body).not.toContain("a@b.com");
    expect(body).not.toContain("sk_live_abcdef123456");
    expect(body).toContain("[redacted]");
  });

  it("honours ignoreErrors", async () => {
    const fetchMock = mockFetch();
    const { client } = await makeClient({ ignoreErrors: [/ResizeObserver/] });

    client.capture(new Error("ResizeObserver loop limit exceeded"));
    await client.flush();

    // The session still ships — release health needs the "ok" heartbeat — but
    // the ignored error must not.
    expect(sentEnvelope(fetchMock).events).toHaveLength(0);
  });

  it("lets beforeSend drop an event", async () => {
    const fetchMock = mockFetch();
    const { client } = await makeClient({ beforeSend: () => null });

    client.capture(new Error("boom"));
    await client.flush();

    expect(sentEnvelope(fetchMock).events).toHaveLength(0);
  });

  it("caps a flood of identical errors", async () => {
    const fetchMock = mockFetch();
    const { client } = await makeClient();

    // A looping content script can throw thousands of times a second.
    for (let i = 0; i < 200; i += 1) {
      client.capture(new Error("same failure every tick"));
    }
    await client.flush();

    const envelope = sentEnvelope(fetchMock);
    expect(envelope.events.length).toBeLessThanOrEqual(5);
    expect(envelope.events.length).toBeGreaterThan(0);
  });

  it("keeps events in storage for a retry when the server is down", async () => {
    mockFetch(503);
    const { client, storage } = await makeClient();

    client.capture(new Error("boom"));
    const ok = await client.flush();

    expect(ok).toBe(false);
    // The whole point of the durable queue: it's on disk, not in this worker.
    expect(storage.data.__crxtrace_queue).toHaveLength(1);

    // Reboot the worker against the same storage, with the server healthy.
    const retryMock = mockFetch(200);
    const { client: rebooted } = await makeClient({}, storage);
    await rebooted.flush();

    expect(sentEnvelope(retryMock).events).toHaveLength(1);
    expect(sentEnvelope(retryMock).events[0]?.message).toBe("boom");
  });

  it("does not lose events when the worker dies mid-send", async () => {
    const storage = createStorage();

    // The send never settles — Chrome kills the worker while the request is
    // still open, which is the single likeliest moment for it to happen.
    (globalThis as Record<string, unknown>).fetch = vi.fn(
      () => new Promise(() => {}),
    );

    const { client } = await makeClient({}, storage);
    client.capture(new Error("died in flight"));

    void client.flush();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Worker is gone. Nothing acknowledged it, so it must still be on disk.
    const stranded = [
      ...((storage.data.__crxtrace_queue as unknown[]) ?? []),
      ...((storage.data.__crxtrace_queue_inflight as unknown[]) ?? []),
    ];
    expect(stranded).toHaveLength(1);

    // Next boot recovers and delivers it.
    const retryMock = mockFetch(200);
    const { client: rebooted } = await makeClient({}, storage);
    await rebooted.flush();

    expect(sentEnvelope(retryMock).events[0]?.message).toBe("died in flight");
  });

  it("clears the in-flight batch once the server acknowledges it", async () => {
    mockFetch(200);
    const { client, storage } = await makeClient();

    client.capture(new Error("boom"));
    await client.flush();

    expect(storage.data.__crxtrace_queue ?? []).toHaveLength(0);
    expect(storage.data.__crxtrace_queue_inflight ?? []).toHaveLength(0);
  });

  it("drops events permanently on a bad ingest key", async () => {
    mockFetch(401);
    const { client, storage } = await makeClient();

    client.capture(new Error("boom"));
    await client.flush();

    // A 401 will never succeed; retrying forever would drain the user's
    // battery and hammer the server.
    expect(storage.data.__crxtrace_queue ?? []).toHaveLength(0);
  });

  it("marks the session errored once an error is seen", async () => {
    const fetchMock = mockFetch();
    const { client } = await makeClient();

    client.capture(new Error("boom"));
    await client.flush();

    expect(sentEnvelope(fetchMock).sessions[0]?.status).toBe("errored");
  });

  it("never throws out of capture", async () => {
    const { client } = await makeClient();

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => client.capture(circular)).not.toThrow();
  });
});
