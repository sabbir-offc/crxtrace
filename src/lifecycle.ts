import { getChrome } from "./chrome-api";
import type { LifecycleEvent, LifecycleKind, ServiceWorkerContext } from "./types";
import { now, uuid } from "./util";

const BOOT_KEY = "__crxtrace_boot";

interface BootRecord {
  bootId: string;
  startedAt: number;
  /** Refreshed as the worker does things, so we can bound its lifetime. */
  lastSeen: number;
  /** Only true when `onSuspend` fired — i.e. Chrome shut us down politely. */
  clean: boolean;
  pendingTasks: string[];
  wakeReason?: string;
}

/**
 * Tracks one service worker instance from boot to death.
 *
 * The interesting signal is the *absence* of a clean shutdown. Chrome kills an
 * idle worker without warning and `onSuspend` is not guaranteed to fire, so a
 * worker that vanishes mid-task leaves no trace in its own lifetime. We only
 * learn about it on the *next* boot, by finding a previous record that was
 * never marked clean — and if it had tasks in flight, that's a real bug the
 * developer would otherwise never see.
 */
export class ServiceWorkerTracker {
  readonly bootId = uuid();
  readonly startedAt = now();

  private pending = new Map<string, number>();
  private previous: BootRecord | null = null;
  private coldStart = true;
  private wakeReason: string | undefined;
  private ready: Promise<LifecycleEvent[]> | null = null;

  private area() {
    try {
      return getChrome()?.storage?.local ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Reads the previous instance's record, then claims the slot for this one.
   * Resolves with any lifecycle events the previous instance couldn't report
   * because it was killed.
   */
  start(): Promise<LifecycleEvent[]> {
    if (this.ready) return this.ready;

    this.ready = (async () => {
      const events: LifecycleEvent[] = [];
      const area = this.area();

      if (area) {
        try {
          const bag = await area.get(BOOT_KEY);
          const prev = bag?.[BOOT_KEY] as BootRecord | undefined;

          if (prev && typeof prev.bootId === "string") {
            this.previous = prev;

            if (!prev.clean) {
              const pendingTasks = prev.pendingTasks ?? [];
              events.push({
                kind: "terminated",
                at: now(),
                bootId: prev.bootId,
                data: {
                  // Only as fresh as the last storage write, so an otherwise
                  // idle worker under-reports. The flush alarm keeps this
                  // within roughly `flushIntervalMinutes`.
                  uptimeMs: Math.max(0, prev.lastSeen - prev.startedAt),
                  // The payoff: what was still running when it died.
                  pendingTasks,
                  /**
                   * Chrome kills idle workers constantly — that is normal MV3
                   * behaviour, not a fault. Only a death with work in flight
                   * is worth a developer's attention, so say which this was
                   * rather than making every consumer re-derive it.
                   */
                  hadPendingWork: pendingTasks.length > 0,
                  wakeReason: prev.wakeReason,
                },
              });
            }
          }
        } catch {
          // No history available; treat as a first boot.
        }
      }

      events.push({ kind: "boot", at: this.startedAt, bootId: this.bootId });
      await this.persist();
      return events;
    })();

    return this.ready;
  }

  private async persist(): Promise<void> {
    const area = this.area();
    if (!area) return;
    try {
      const record: BootRecord = {
        bootId: this.bootId,
        startedAt: this.startedAt,
        lastSeen: now(),
        clean: false,
        pendingTasks: [...this.pending.keys()],
        wakeReason: this.wakeReason,
      };
      await area.set({ [BOOT_KEY]: record });
    } catch {
      // Storage unavailable — termination detection degrades, nothing breaks.
    }
  }

  /** Call on meaningful activity so a killed worker's lifetime is accurate. */
  touch(): void {
    void this.persist();
  }

  noteWakeReason(reason: string): void {
    this.wakeReason = reason;
    this.coldStart = false;
  }

  /**
   * Marks a unit of async work as in-flight. If the worker is killed before
   * `done()` runs, the task name is reported on the next boot.
   */
  beginTask(name: string): () => void {
    this.pending.set(name, now());
    void this.persist();

    let settled = false;
    return () => {
      if (settled) return;
      settled = true;
      this.pending.delete(name);
      void this.persist();
    };
  }

  /** `onSuspend` fired — record a clean exit so we don't cry wolf on reboot. */
  async markClean(): Promise<void> {
    const area = this.area();
    if (!area) return;
    try {
      const record: BootRecord = {
        bootId: this.bootId,
        startedAt: this.startedAt,
        lastSeen: now(),
        clean: true,
        pendingTasks: [],
        wakeReason: this.wakeReason,
      };
      await area.set({ [BOOT_KEY]: record });
    } catch {
      // Best effort.
    }
  }

  context(): ServiceWorkerContext {
    const previousUptimeMs = this.previous
      ? Math.max(0, this.previous.lastSeen - this.previous.startedAt)
      : undefined;

    return {
      bootId: this.bootId,
      uptimeMs: Math.max(0, now() - this.startedAt),
      coldStart: this.coldStart,
      pendingTasks: this.pending.size ? [...this.pending.keys()] : undefined,
      previousUptimeMs,
      wakeReason: this.wakeReason,
    };
  }

  static lifecycleFromInstall(
    reason: string | undefined,
    previousVersion: string | undefined,
    bootId: string,
  ): LifecycleEvent {
    const kind: LifecycleKind =
      reason === "install"
        ? "install"
        : reason === "update"
          ? "update"
          : reason === "chrome_update" || reason === "browser_update"
            ? "browser_update"
            : "boot";

    return {
      kind,
      at: now(),
      bootId,
      data: previousVersion ? { previousVersion } : undefined,
    };
  }
}
