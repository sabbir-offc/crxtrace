import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearChrome, createStorage, installChrome, type FakeStorage } from "./helpers";
import type { CrxTraceOptions, Envelope } from "../src/types";

const DSN = "https://ingest.test/api/ingest/pk_test_123";

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
    flushDebounceMs: 60_000,
    ...overrides,
  });

  return { client: new CrxTraceClient(options), storage };
}

function mockFetch(status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
  }));
  (globalThis as Record<string, unknown>).fetch = fetchMock;
  return fetchMock;
}

function sentEnvelope(fetchMock: ReturnType<typeof mockFetch>): Envelope {
  const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
  return JSON.parse(call[1].body) as Envelope;
}

describe("debugId", () => {
  beforeEach(() => {
    mockFetch();
  });

  afterEach(() => {
    clearChrome();
    delete (globalThis as Record<string, unknown>).fetch;
    vi.resetModules();
  });

  it("ships the build id so the server can find the matching source maps", async () => {
    const fetchMock = mockFetch();
    const { client } = await makeClient({ debugId: "018f2a1e-build" });

    client.capture(new TypeError("boom"));
    await client.flush();

    expect(sentEnvelope(fetchMock).debugId).toBe("018f2a1e-build");
  });

  /**
   * An absent debugId has to stay absent rather than become an empty string or
   * a guess: the server treats "no debugId" as "this build has no uploaded
   * maps", which is a different answer from "look for maps under ''".
   */
  it("omits the field entirely when no build id was given", async () => {
    const fetchMock = mockFetch();
    const { client } = await makeClient();

    client.capture(new TypeError("boom"));
    await client.flush();

    const envelope = sentEnvelope(fetchMock);
    expect(envelope.debugId).toBeUndefined();
    expect("debugId" in envelope).toBe(false);
  });

  it("is independent of release, so rebuilding a version is distinguishable", async () => {
    const fetchMock = mockFetch();
    const { client } = await makeClient({
      release: "1.2.3",
      debugId: "second-build-of-1.2.3",
    });

    client.capture(new TypeError("boom"));
    await client.flush();

    const envelope = sentEnvelope(fetchMock);
    expect(envelope.release).toBe("1.2.3");
    expect(envelope.debugId).toBe("second-build-of-1.2.3");
  });

  it("survives a worker death — a stranded event still resolves later", async () => {
    const storage = createStorage();

    // Server is down, so the event stays on disk when this worker goes away.
    mockFetch(503);
    const first = await makeClient({ debugId: "build-abc" }, storage);
    first.client.capture(new TypeError("died before send"));
    await first.client.flush();

    expect(storage.data.__crxtrace_queue).toHaveLength(1);

    // Next boot, same storage, same build, server healthy again. Without the
    // build id surviving the round trip, a stack that was minified yesterday
    // would be unresolvable today.
    const fetchMock = mockFetch(200);
    const second = await makeClient({ debugId: "build-abc" }, storage);
    await second.client.flush();

    const envelope = sentEnvelope(fetchMock);
    expect(envelope.events.length).toBeGreaterThan(0);
    expect(envelope.debugId).toBe("build-abc");
  });
});
