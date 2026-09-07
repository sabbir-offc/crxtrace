import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearChrome, createStorage, installChrome, type FakeStorage } from "./helpers";

async function loadQueue() {
  vi.resetModules();
  return (await import("../src/queue")).PersistentQueue;
}

describe("PersistentQueue", () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = createStorage();
    installChrome({ storage });
  });

  afterEach(() => {
    clearChrome();
    vi.resetModules();
  });

  it("persists items to storage rather than memory", async () => {
    const PersistentQueue = await loadQueue();
    const queue = new PersistentQueue<{ id: number }>(10);

    await queue.add({ id: 1 });

    expect(storage.data.__crxtrace_queue).toEqual([{ id: 1 }]);
  });

  it("survives a service worker restart", async () => {
    const PersistentQueue = await loadQueue();
    const first = new PersistentQueue<{ id: number }>(10);
    await first.add({ id: 1 });
    await first.add({ id: 2 });

    // A new worker instance: fresh objects, same backing storage.
    vi.resetModules();
    installChrome({ storage });
    const Reloaded = (await import("../src/queue")).PersistentQueue;
    const second = new Reloaded<{ id: number }>(10);

    expect(await second.checkout()).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("does not lose items when adds overlap", async () => {
    const PersistentQueue = await loadQueue();
    const queue = new PersistentQueue<{ id: number }>(50);

    // Concurrent adds are the norm: storage has no read-modify-write, so an
    // unserialized implementation drops all but the last write here.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => queue.add({ id: i })),
    );

    const batch = await queue.checkout();
    expect(batch).toHaveLength(20);
    expect(new Set(batch.map((item) => item.id)).size).toBe(20);
  });

  it("drops the oldest items once full", async () => {
    const PersistentQueue = await loadQueue();
    const queue = new PersistentQueue<{ id: number }>(3);

    for (const id of [1, 2, 3, 4, 5]) await queue.add({ id });

    expect(await queue.checkout()).toEqual([{ id: 3 }, { id: 4 }, { id: 5 }]);
  });

  it("empties the queue on checkout", async () => {
    const PersistentQueue = await loadQueue();
    const queue = new PersistentQueue<{ id: number }>(10);
    await queue.add({ id: 1 });

    await queue.checkout();

    expect(await queue.size()).toBe(0);
  });

  it("holds a checked-out batch until it is committed", async () => {
    const PersistentQueue = await loadQueue();
    const queue = new PersistentQueue<{ id: number }>(10);
    await queue.add({ id: 1 });

    await queue.checkout();

    // Still on disk: nothing has acknowledged it yet.
    expect(storage.data.__crxtrace_queue_inflight).toEqual([{ id: 1 }]);

    await queue.commit();
    expect(storage.data.__crxtrace_queue_inflight).toEqual([]);
  });

  it("puts a failed batch back in front on rollback", async () => {
    const PersistentQueue = await loadQueue();
    const queue = new PersistentQueue<{ id: number }>(10);
    await queue.add({ id: 1 });
    await queue.add({ id: 2 });
    await queue.checkout();
    await queue.add({ id: 3 });

    await queue.rollback();

    expect(await queue.checkout()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("recovers a batch orphaned by a worker that died mid-send", async () => {
    const PersistentQueue = await loadQueue();
    const queue = new PersistentQueue<{ id: number }>(10);
    await queue.add({ id: 1 });
    await queue.checkout();
    // Worker dies here: never committed, never rolled back.

    vi.resetModules();
    installChrome({ storage });
    const Reloaded = (await import("../src/queue")).PersistentQueue;
    const rebooted = new Reloaded<{ id: number }>(10);

    expect(await rebooted.recover()).toBe(1);
    expect(await rebooted.checkout()).toEqual([{ id: 1 }]);
  });

  it("reports nothing to recover on a clean start", async () => {
    const PersistentQueue = await loadQueue();
    const queue = new PersistentQueue<{ id: number }>(10);

    expect(await queue.recover()).toBe(0);
  });

  it("falls back to memory when storage throws", async () => {
    const PersistentQueue = await loadQueue();
    storage.set.mockRejectedValue(new Error("QUOTA_BYTES exceeded"));
    const queue = new PersistentQueue<{ id: number }>(10);

    await expect(queue.add({ id: 1 })).resolves.toBeUndefined();
  });
});
