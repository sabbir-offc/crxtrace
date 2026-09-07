import { afterEach, describe, expect, it, vi } from "vitest";
import { clearChrome, createStorage, installChrome, type FakeStorage } from "./helpers";

/** A fresh worker instance sharing the previous one's storage. */
async function bootWorker(storage: FakeStorage) {
  vi.resetModules();
  installChrome({ storage });
  const { ServiceWorkerTracker } = await import("../src/lifecycle");
  return new ServiceWorkerTracker();
}

describe("ServiceWorkerTracker", () => {
  afterEach(() => {
    clearChrome();
    vi.resetModules();
  });

  it("reports nothing on a genuine first boot", async () => {
    const storage = createStorage();
    const tracker = await bootWorker(storage);

    const events = await tracker.start();

    expect(events.map((e) => e.kind)).toEqual(["boot"]);
  });

  it("flags a worker killed with work in flight", async () => {
    const storage = createStorage();

    const first = await bootWorker(storage);
    await first.start();
    first.beginTask("fetchTranscript");
    // No markClean(): Chrome pulled the plug mid-task.

    const second = await bootWorker(storage);
    const events = await second.start();

    const terminated = events.find((e) => e.kind === "terminated");
    expect(terminated).toBeDefined();
    expect(terminated?.data?.pendingTasks).toEqual(["fetchTranscript"]);
    expect(terminated?.data?.hadPendingWork).toBe(true);
  });

  it("marks an idle recycle as routine, not a fault", async () => {
    const storage = createStorage();

    const first = await bootWorker(storage);
    await first.start();
    // Nothing running — Chrome reclaiming an idle worker is normal MV3
    // behaviour and must not read as an incident.

    const second = await bootWorker(storage);
    const events = await second.start();

    const terminated = events.find((e) => e.kind === "terminated");
    expect(terminated?.data?.hadPendingWork).toBe(false);
    expect(terminated?.data?.pendingTasks).toEqual([]);
  });

  it("stays quiet after a clean shutdown", async () => {
    const storage = createStorage();

    const first = await bootWorker(storage);
    await first.start();
    await first.markClean();

    const second = await bootWorker(storage);
    const events = await second.start();

    expect(events.find((e) => e.kind === "terminated")).toBeUndefined();
  });

  it("clears a task once it completes", async () => {
    const storage = createStorage();

    const first = await bootWorker(storage);
    await first.start();
    const done = first.beginTask("fetchTranscript");
    done();

    const second = await bootWorker(storage);
    const events = await second.start();

    expect(events.find((e) => e.kind === "terminated")?.data?.hadPendingWork).toBe(
      false,
    );
  });

  it("exposes in-flight tasks on the event context", async () => {
    const storage = createStorage();
    const tracker = await bootWorker(storage);
    await tracker.start();

    tracker.beginTask("summarize");

    expect(tracker.context().pendingTasks).toEqual(["summarize"]);
  });
});
