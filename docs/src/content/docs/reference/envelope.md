---
title: Envelope format
description: The wire contract between the CrxTrace SDK and any ingest endpoint.
---

This is a **public contract**, not an implementation detail. Additive fields are
a minor version; renaming or removing one is a major version. Build against it
with confidence.

Every type here is exported from the package:

```ts
import type { Envelope, CrxEvent, LifecycleEvent } from "crxtrace";
```

## The request

```http
POST <dsn>
content-type: application/json
x-crxtrace-sdk: crxtrace-js/<version>
```

Sent with `credentials: "omit"` and `cache: "no-store"`. Bodies under 60 KB use
`keepalive`, which lets the request outlive the worker that started it.

## Envelope

```ts
interface Envelope {
  sdk: { name: string; version: string };
  sentAt: number;                 // epoch ms
  installId: string;              // random, per-install
  release?: string;
  environment: string;            // "production" | "development" | custom
  extension: ExtensionInfo;
  runtime: RuntimeInfo;
  events: CrxEvent[];
  sessions: SessionUpdate[];
  lifecycle: LifecycleEvent[];
}
```

```ts
interface ExtensionInfo {
  id?: string;
  name?: string;
  version?: string;
  manifestVersion?: number;
}

interface RuntimeInfo {
  browser: string;
  browserVersion?: string;
  platform?: string;
  language?: string;
}
```

All three arrays may be empty, and an envelope with only `lifecycle` entries is
normal — that's a worker reporting a clean boot.

## CrxEvent

```ts
interface CrxEvent {
  eventId: string;
  timestamp: number;
  level: "fatal" | "error" | "warning" | "info";
  surface: Surface;
  mechanism: Mechanism;
  handled: boolean;
  type: string;                   // e.g. "TypeError"
  message: string;
  culprit?: string;               // e.g. "app:///background.js:12"
  stack?: StackFrame[];
  rawStack?: string;
  mv3Category: Mv3Category;
  host?: string;                  // content scripts only
  url?: string;
  release?: string;
  environment: string;
  breadcrumbs: Breadcrumb[];
  tags: Record<string, string>;
  contexts: {
    serviceWorker?: ServiceWorkerContext;
    extra?: Record<string, unknown>;
  };
  user?: { id?: string; email?: string; username?: string };
  fingerprint?: string[];
}
```

```ts
interface StackFrame {
  function?: string;
  file?: string;
  line?: number;
  column?: number;
  inApp: boolean;      // frame belongs to the extension, not a page script
}

interface Breadcrumb {
  t: number;
  category: string;
  message: string;
  level?: Level;
  data?: Record<string, unknown>;
}

interface ServiceWorkerContext {
  bootId: string;
  uptimeMs: number;
  coldStart: boolean;
  pendingTasks?: string[];        // tasks in flight when this fired
  previousUptimeMs?: number;
  wakeReason?: string;
}
```

`Surface` is one of `service_worker`, `content_script`, `popup`, `options`,
`sidepanel`, `devtools`, `offscreen`, `extension_page`, `unknown`.

`Mechanism` — how the error reached the SDK — is one of `onerror`,
`unhandledrejection`, `capture`, `wrap`, `last_error`, `console`,
`sw_termination`, `relay`.

`Mv3Category` is documented in [MV3 error categories](/guides/error-categories/).

:::note
An `sw_termination` event has no stack, because nobody threw. Read
`contexts.serviceWorker.pendingTasks` to see what was running.
:::

## SessionUpdate

```ts
interface SessionUpdate {
  bootId: string;
  surface: Surface;
  release?: string;
  environment: string;
  status: "ok" | "errored";
  startedAt: number;
}
```

Crash-free rate per release is `ok / (ok + errored)`, grouped by `release`.

## LifecycleEvent

```ts
interface LifecycleEvent {
  kind: "boot" | "install" | "update" | "browser_update"
      | "startup" | "suspend" | "terminated";
  at: number;
  bootId: string;
  release?: string;
  data?: Record<string, unknown>;
}
```

For `kind: "terminated"`, `data` carries:

| Field | Meaning |
| --- | --- |
| `hadPendingWork` | **The one that matters.** `false` is routine idle recycling; `true` is a real fault. |
| `uptimeMs` | Lifetime of the worker that died |
| `pendingTasks` | Names passed to `track()` that were still running |

:::caution
Do not surface `terminated` with `hadPendingWork: false` as an error. A busy
extension is recycled dozens of times a day and reporting each one buries the
real signal.
:::

## Responses

| Status | SDK behaviour |
| --- | --- |
| `2xx` | Batch cleared from the durable queue |
| `429` | Retried with backoff, honouring `Retry-After` |
| `5xx` | Retried with backoff |
| Other `4xx` | **Dropped.** A bad key or malformed body fails identically next time — retrying forever just burns the user's battery. |
| Network failure | Retried |

`Retry-After` is parsed as either seconds or an HTTP date.

Answer `2xx` only once you've durably stored the batch. The SDK deletes its copy
on acknowledgement.

## Minimal receiver

```js
import { createServer } from "node:http";

createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, x-crxtrace-sdk");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const envelope = JSON.parse(Buffer.concat(chunks).toString());

  for (const event of envelope.events) {
    console.log(event.type, event.message, event.mv3Category);
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}).listen(8787);
```

A fuller version, including lifecycle handling, is
[`examples/ingest-server.mjs`](https://github.com/sabbir-offc/crxtrace/blob/main/examples/ingest-server.mjs).

See [Self-hosting](/reference/self-hosting/) for storing and grouping.
