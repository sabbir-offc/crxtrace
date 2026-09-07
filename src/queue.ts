import { getChrome } from "./chrome-api";

const QUEUE_KEY = "__crxtrace_queue";

/**
 * Durable outbox.
 *
 * An MV3 service worker is killed roughly 30s after it goes idle, and it gets
 * no reliable teardown event — so anything held only in memory dies with it.
 * That is precisely when errors happen, which is why generic trackers lose
 * them. Every item is written to `chrome.storage.local` the moment it is
 * captured and only removed once the server has acknowledged it.
 *
 * Writes are serialized through a promise chain because `storage.local` has no
 * read-modify-write primitive; two concurrent `add` calls would otherwise
 * clobber each other.
 */
export class PersistentQueue<T> {
  private memory: T[] = [];
  private inflightMemory: T[] = [];
  private chain: Promise<void> = Promise.resolve();
  private inflightKey: string;

  constructor(
    private max: number,
    private key: string = QUEUE_KEY,
  ) {
    this.inflightKey = `${this.key}_inflight`;
  }

  private area() {
    try {
      return getChrome()?.storage?.local ?? null;
    } catch {
      return null;
    }
  }

  /** Serializes storage mutations so concurrent callers can't lose items. */
  private run<R>(task: () => Promise<R>): Promise<R> {
    const result = this.chain.then(task, task);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async read(key = this.key): Promise<T[]> {
    const area = this.area();
    if (!area) return this.fallback(key).slice();
    try {
      const bag = await area.get(key);
      const items = bag?.[key];
      return Array.isArray(items) ? (items as T[]) : [];
    } catch {
      return this.fallback(key).slice();
    }
  }

  private async write(items: T[], key = this.key): Promise<void> {
    const area = this.area();
    if (!area) {
      this.setFallback(key, items);
      return;
    }
    try {
      await area.set({ [key]: items });
    } catch {
      // Quota exhausted or context torn down — keep going in memory rather
      // than throwing inside the host extension.
      this.setFallback(key, items);
    }
  }

  private fallback(key: string): T[] {
    return key === this.inflightKey ? this.inflightMemory : this.memory;
  }

  private setFallback(key: string, items: T[]): void {
    if (key === this.inflightKey) this.inflightMemory = items;
    else this.memory = items;
  }

  private cap(items: T[]): T[] {
    // Oldest first: a fresh error is more actionable than a stale one.
    return items.length > this.max ? items.slice(items.length - this.max) : items;
  }

  add(item: T): Promise<void> {
    return this.run(async () => {
      const items = await this.read();
      items.push(item);
      await this.write(this.cap(items));
    });
  }

  /**
   * Moves the queue into an in-flight holding area and returns it.
   *
   * Deliberately not a plain drain: the send that follows is the single most
   * likely moment for Chrome to kill the worker, and anything removed from
   * storage before the server acknowledges it would be lost for good. Items
   * stay in `_inflight` until {@link commit} or {@link rollback}, and a worker
   * that dies in between leaves them there for {@link recover}.
   */
  checkout(): Promise<T[]> {
    return this.run(async () => {
      const pending = await this.read(this.inflightKey);
      const queued = await this.read();

      const batch = [...pending, ...queued];
      if (!batch.length) return [];

      await this.write(this.cap(batch), this.inflightKey);
      await this.write([]);
      return batch;
    });
  }

  /** The server acknowledged the batch — now it is safe to forget. */
  commit(): Promise<void> {
    return this.run(async () => {
      await this.write([], this.inflightKey);
    });
  }

  /** Send failed but is worth retrying: put the batch back at the front. */
  rollback(): Promise<void> {
    return this.run(async () => {
      const pending = await this.read(this.inflightKey);
      if (!pending.length) return;

      const current = await this.read();
      await this.write(this.cap([...pending, ...current]));
      await this.write([], this.inflightKey);
    });
  }

  /**
   * Reclaims a batch orphaned by a worker that died mid-send. Called once at
   * startup; without it those events would sit in `_inflight` forever.
   */
  recover(): Promise<number> {
    return this.run(async () => {
      const orphaned = await this.read(this.inflightKey);
      if (!orphaned.length) return 0;

      const current = await this.read();
      await this.write(this.cap([...orphaned, ...current]));
      await this.write([], this.inflightKey);
      return orphaned.length;
    });
  }

  size(): Promise<number> {
    return this.run(async () => (await this.read()).length);
  }
}
