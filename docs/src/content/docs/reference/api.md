---
title: API reference
description: Every function CrxTrace exports, with signatures and behaviour.
---

```js
import * as CrxTrace from "crxtrace";
```

All functions are safe to call before `init()` — they no-op and warn rather
than throw, so a missing init never takes your extension down.

## init()

```ts
init(options: CrxTraceOptions): CrxTraceClient
```

Starts the SDK for the current surface. Call once per surface — the service
worker, each content script, and any extension page.

Throws if `dsn` is missing. Calling it twice in the same context logs a warning
and returns the existing client.

Returns the client, which you can ignore — the module-level functions below
operate on it.

```js
CrxTrace.init({ dsn: "https://your-ingest-endpoint/pk_live_..." });
```

See [Configuration](/reference/configuration/) for every option.

## captureException()

```ts
captureException(error: unknown, context?: CaptureContext): string | undefined
```

Reports an error you caught. Returns the generated event id, or `undefined` if
the event was dropped by filtering.

Accepts anything — a non-`Error` value is coerced rather than discarded.

```js
try {
  await syncBookmarks();
} catch (error) {
  CrxTrace.captureException(error, {
    tags: { feature: "sync" },
    extra: { attempt: 3 },
  });
}
```

## captureMessage()

```ts
captureMessage(message: string, context?: CaptureContext): string | undefined
```

Reports a non-error event. Defaults to `level: "info"` and `handled: true`.

```js
CrxTrace.captureMessage("Migration completed", { level: "info" });
```

## track()

```ts
track<T>(name: string, work: Promise<T> | (() => Promise<T>)): Promise<T>
```

Runs async work with service worker termination in mind. If Chrome kills the
worker while the promise is outstanding, the next boot reports an
`sw_terminated` event naming the task.

Re-throws rejections unchanged, after capturing them tagged with `task: name`.
Wrapping an existing call never changes its behaviour.

```js
const transcript = await CrxTrace.track("fetchTranscript", getTranscript(id));
await CrxTrace.track("sync", () => syncBookmarks());
```

See [Service worker deaths](/guides/worker-deaths/).

## wrap()

```ts
wrap<A, R>(fn: (...args: A) => R): (...args: A) => R
```

Wraps a function so throws are reported and then re-thrown unchanged. Handles
both synchronous throws and rejected promises.

```js
chrome.runtime.onMessage.addListener(
  CrxTrace.wrap((message, sender, sendResponse) => {
    // throws in here are reported, then propagate as normal
  }),
);
```

## addBreadcrumb()

```ts
addBreadcrumb(crumb: {
  category: string;
  message: string;
  level?: Level;
  data?: Record<string, unknown>;
}): void
```

Records context attached to subsequent events. Retention is capped by
[`maxBreadcrumbs`](/reference/configuration/) (default 40), oldest dropped
first.

```js
CrxTrace.addBreadcrumb({
  category: "auth",
  message: "token refreshed",
  level: "info",
});
```

## setUser() / setTag() / setContext()

```ts
setUser(user: { id?: string; email?: string; username?: string }): void
setTag(key: string, value: string): void
setContext(key: string, value: unknown): void
```

Attach metadata to every subsequent event from this surface.

```js
CrxTrace.setUser({ id: accountId });
CrxTrace.setTag("plan", "pro");
CrxTrace.setContext("workspace", { id, memberCount });
```

:::caution
`setUser({ email })` sends that email. Redaction deliberately doesn't strip
fields you set intentionally. Prefer an opaque id — see
[Privacy](/guides/privacy/).
:::

## flush()

```ts
flush(): Promise<boolean>
```

Sends everything queued immediately, bypassing the debounce. Resolves `false`
if the server rejected the batch. Resolves `true` when there was nothing to
send.

```js
await CrxTrace.flush();
```

## close()

```ts
close(): Promise<boolean>
```

Flushes, removes all instrumentation, and resets module state. Mainly useful in
tests, or if you need to fully disable reporting at runtime.

After `close()`, a later `init()` starts cleanly.

## Types

Every wire type is exported for self-hosted receivers:

```ts
import type {
  Envelope,
  CrxEvent,
  SessionUpdate,
  LifecycleEvent,
  Breadcrumb,
  StackFrame,
  CaptureContext,
  CrxTraceOptions,
  Surface,
  Level,
  Mechanism,
  Mv3Category,
} from "crxtrace";
```

Also exported: `CrxTraceClient` (the class `init()` returns) and
`detectSurface()` (the surface detection used internally).

See the [envelope reference](/reference/envelope/) for their shapes.

## CaptureContext

Accepted as the second argument to `captureException` and `captureMessage`:

| Field | Type | Notes |
| --- | --- | --- |
| `level` | `"fatal" \| "error" \| "warning" \| "info"` | Defaults to `error` for exceptions. |
| `tags` | `Record<string, string>` | Merged over tags set with `setTag()`. |
| `extra` | `Record<string, unknown>` | Lands in `contexts.extra`. |
| `fingerprint` | `string[]` | Forces grouping. See [Filtering](/guides/filtering/#grouping-control). |
| `mechanism` | `Mechanism` | How the error was reached. Rarely set by hand. |
| `handled` | `boolean` | Whether you caught it. |
