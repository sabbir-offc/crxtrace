---
title: Getting started
description: Install CrxTrace, initialise it in each extension surface, and see your first error.
---

## Install

```bash
npm install crxtrace
```

No bundler? Grab the single-file IIFE build from
`node_modules/crxtrace/dist/crxtrace.global.js` and see
[Without a bundler](#without-a-bundler) below.

## Get a DSN

The `dsn` is the endpoint your events are sent to. Two ways to get one:

**Use the hosted dashboard.** Sign up at
[app.crxtrace.dev](https://app.crxtrace.dev), create a project, and the setup
page hands you a DSN that looks like:

```
https://app.crxtrace.dev/api/ingest/pk_live_...
```

It's safe to ship inside your extension bundle — it only allows writing events,
never reading them.

**Or run your own.** The SDK works against any server that accepts the
[envelope](/reference/envelope/) and answers `2xx`. A complete receiver in ~150
lines of dependency-free Node ships in the repo, and
[self-hosting](/reference/self-hosting/) covers storage, grouping and retention.

Either way the rest of this page is identical — nothing below depends on which
you chose.

## Manifest permissions

```json title="manifest.json"
{
  "permissions": ["storage", "alarms"],
  "host_permissions": ["https://your-ingest-endpoint/*"]
}
```

| Permission | Why |
| --- | --- |
| `storage` | **Required.** It's what makes the queue durable across worker death. Without it, CrxTrace is just a slower `console.error`. |
| `alarms` | Strongly recommended. A mostly-idle worker may never wake on its own; the alarm drains the queue on a schedule. |
| `host_permissions` | Your ingest origin, so the worker is allowed to `fetch` it. |

## Initialise every surface

Call `init()` once per surface — the service worker, each content script, and
any extension page you want covered. It's the same call everywhere; the SDK
detects where it is running.

```js title="background.js"
import * as CrxTrace from "crxtrace";

CrxTrace.init({ dsn: "https://your-ingest-endpoint/pk_live_..." });
```

```js title="content.js"
import * as CrxTrace from "crxtrace";

CrxTrace.init({ dsn: "https://your-ingest-endpoint/pk_live_..." });
```

Only the service worker owns the durable queue and talks to the network.
Content scripts and extension pages relay their events through the worker —
they never send from a page they don't control. That's deliberate: a content
script issuing cross-origin requests from someone else's site is both a privacy
problem and a CSP problem.

:::note
Calling `init()` twice in the same context is a no-op and logs a warning. Each
surface is a separate JavaScript context, so calling it in both the worker and
a content script is correct, not a double-init.
:::

## Name your async work

This is the single highest-value thing you can do, and it takes one line.

```js
const transcript = await CrxTrace.track("fetchTranscript", getTranscript(id));
```

If Chrome terminates the worker while that promise is outstanding, the **next**
boot reports an `sw_terminated` event naming `fetchTranscript`. Without it you
get silence, because nothing threw — the worker simply stopped.

See [Service worker deaths](/guides/worker-deaths/) for what this catches and
why nothing else catches it.

## Report errors you handle

Uncaught errors and unhandled rejections are captured automatically. For the
ones you catch yourself:

```js
try {
  await syncBookmarks();
} catch (error) {
  CrxTrace.captureException(error, { tags: { feature: "sync" } });
}
```

## Verify it works

Set `debug: true` and the SDK narrates its decisions to the console:

```js
CrxTrace.init({
  dsn: "https://your-ingest-endpoint/pk_live_...",
  debug: true,
});
```

Then throw something on purpose from your service worker console:

```js
throw new Error("crxtrace smoke test");
```

By default events are batched with a 1.5 second debounce, so give it a moment —
or call `await CrxTrace.flush()` to send immediately.

:::caution
Nothing arriving? The three usual causes, in order: `storage` is missing from
`permissions`, your ingest origin is missing from `host_permissions`, or the
DSN has a typo. `debug: true` will tell you which.
:::

## Without a bundler

The IIFE build exposes a `CrxTrace` global and works with `importScripts()`:

```js title="background.js"
importScripts("vendor/crxtrace.global.js");

CrxTrace.init({ dsn: "https://your-ingest-endpoint/pk_live_..." });
```

```html title="popup.html"
<script src="vendor/crxtrace.global.js"></script>
<script>
  CrxTrace.init({ dsn: "https://your-ingest-endpoint/pk_live_..." });
</script>
```

Copy the file out of `node_modules/crxtrace/dist/crxtrace.global.js` as part of
your build.

## Try the demo extension

The repository ships a real MV3 extension that triggers each failure mode on
demand, plus a throwaway server that pretty-prints arriving events:

```bash
git clone https://github.com/sabbir-offc/crxtrace.git
cd crxtrace
npm install
npm run demo:sync     # build the SDK into the demo
npm run demo:ingest   # start the receiver
```

Load `examples/demo-extension` unpacked at `chrome://extensions` and press the
buttons. The one worth waiting for is **Start task, then let worker die** —
close the popup, wait about 30 seconds, then wake the extension:

```
⚠ worker terminated after 31s while running: fetchTranscript
```

## Next

- [Service worker deaths](/guides/worker-deaths/) — the failure mode this exists for
- [Configuration](/reference/configuration/) — every option and its default
- [Self-hosting](/reference/self-hosting/) — run your own backend
