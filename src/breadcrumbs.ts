import type { Breadcrumb, Level } from "./types";
import { now, safeStringify } from "./util";

/**
 * Fixed-size ring of recent activity, attached to every event. Capped hard —
 * breadcrumbs are the easiest way to accidentally hold a page's worth of data
 * in a long-lived service worker.
 */
export class BreadcrumbBuffer {
  private items: Breadcrumb[] = [];

  constructor(private max: number) {}

  add(crumb: {
    category: string;
    message: string;
    level?: Level;
    data?: Record<string, unknown>;
  }): void {
    if (this.max <= 0) return;

    this.items.push({
      t: now(),
      category: crumb.category,
      message: safeStringify(crumb.message, 300),
      level: crumb.level,
      data: crumb.data,
    });

    if (this.items.length > this.max) {
      this.items.splice(0, this.items.length - this.max);
    }
  }

  all(): Breadcrumb[] {
    return this.items.slice();
  }

  clear(): void {
    this.items = [];
  }
}
