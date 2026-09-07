<div align="center">

# CrxTrace

**Error tracking that understands Manifest V3.**

[![npm](https://img.shields.io/npm/v/crxtrace?color=0b7285)](https://www.npmjs.com/package/crxtrace)
[![CI](https://github.com/sabbir-offc/crxtrace/actions/workflows/ci.yml/badge.svg)](https://github.com/sabbir-offc/crxtrace/actions/workflows/ci.yml)
[![license MIT](https://img.shields.io/badge/license-MIT-0b7285)](LICENSE)
[![bundle size](https://img.shields.io/bundlejs/size/crxtrace?color=0b7285&label=gzipped)](https://bundlejs.com/?q=crxtrace)

**[Documentation](https://crxtrace.dev)** ·
[Getting started](https://crxtrace.dev/getting-started/) ·
[API reference](https://crxtrace.dev/reference/api/) ·
[Self-hosting](https://crxtrace.dev/reference/self-hosting/)

</div>

Your extension breaks on someone else's computer, on a website you don't
control, and you find out from a one-star review a week later. CrxTrace tells
you in an hour.

```bash
npm install crxtrace
```

```js
import * as CrxTrace from "crxtrace";

CrxTrace.init({ dsn: "https://your-ingest-endpoint/pk_live_..." });
```

That's the whole setup. Call the same `init()` in your service worker, your
content scripts, and any extension page — the SDK detects which surface it's in
and routes accordingly.

---

## Why generic trackers don't work here

An MV3 service worker is killed roughly 30 seconds after it goes idle, with no
reliable teardown event. Anything held in memory dies with it — which is
exactly when the interesting failures happen. Sentry's browser SDK assumes a
page with a `window` and a DOM; a service worker has neither.

CrxTrace is built around that constraint.

### Events survive worker death

Every captured event is written to `chrome.storage.local` *before* any send is
attempted, and cleared only once the server acknowledges it. A worker killed
mid-flush loses nothing — the next boot picks the queue back up.

### It tells you what died

Wrap async work in `track()`:

```js
const transcript = await CrxTrace.track("fetchTranscript", getTranscript(id));
```

If Chrome kills the worker while that promise is outstanding, the next boot
reports an `sw_terminated` event naming `fetchTranscript`. That turns *"my
extension randomly does nothing"* into *"the worker died during
fetchTranscript, 11 times yesterday."*

No generic tracker reports this, because nothing throws. The worker simply
stops, and the only way to learn about it is to notice on the **next** boot
that the previous one never exited cleanly.

Routine idle recycling is *not* reported as a fault — only a death with work
still in flight.

### Content script errors group by host

A selector that breaks when a site redesigns shows up as one issue on that
host, not as scattered noise across thousands of installs.

### MV3 noise is classified, not dumped

`Could not establish connection`, `Extension context invalidated`, and
`message port closed` are bucketed into categories and grouped by cause rather
than by call site — one issue instead of two hundred. The full set:

`context_invalidated` · `no_receiver` · `message_port_closed` ·
`sw_terminated` · `storage_quota` · `permission_denied` · `script_injection` ·
`tab_gone` · `native_host` · `csp` · `network` · `user_gesture`

### Your extension id is normalized away

`chrome-extension://<id>/sw.js` becomes `app:///sw.js`, so one bug is one issue
across every install rather than one per user.

### Other sites' bugs stay out

A content script shares the page's `window`, so `window.onerror` also fires for
the host site's own errors. CrxTrace only reports events with a stack frame
inside your bundle. You don't get their noise, and their stack traces never
reach your server.

---

## Privacy

An error tracker for content scripts is one bad default away from being a
browsing-history collector, so the defaults are strict.

Redaction runs on every event **in the browser, before it is sent**: JWTs,
bearer tokens, `sk_`/`pk_`-style keys, email addresses, and any value under a
key matching `pass|secret|token|auth|key|cookie|session|credential`.

URLs are truncated to origin + path — query strings are dropped unless you
explicitly set `sendDefaultPii: true`.

```js
CrxTrace.init({
  dsn: "...",
  denyHosts: [/bank/, "internal.corp"],
  scrub: [/ORDER-\d+/],
  beforeSend: (event) => (event.host === "example.com" ? null : event),
});
```

---

## Where your events go

The `dsn` is just an HTTPS endpoint. CrxTrace `POST`s a JSON envelope to it and
expects a `2xx`. **There is nothing proprietary in the wire format**, and the
SDK works against any server you point it at.

```
POST <dsn>
content-type: application/json
x-crxtrace-sdk: crxtrace-js/<version>

{
  "sdk":        { "name": "crxtrace-js", "version": "0.1.0" },
  "sentAt":     1757280000000,
  "installId":  "<random per-install id>",
  "release":    "1.4.2",
  "environment":"production",
  "extension":  { "id", "name", "version", "manifestVersion" },
  "runtime":    { "browser", "browserVersion", "platform", "language" },
  "events":     [ /* CrxEvent[]     */ ],
  "sessions":   [ /* SessionUpdate[] */ ],
  "lifecycle":  [ /* LifecycleEvent[] */ ]
}
```

Respond `2xx` and the batch is cleared from the durable queue. Respond `429` or
`5xx` and it is retried with backoff, honouring `Retry-After`. Respond `4xx`
(bad key, malformed, too large) and it is dropped rather than retried forever.

A complete working receiver in ~150 lines of dependency-free Node is in
[`examples/ingest-server.mjs`](examples/ingest-server.mjs) — that's the
reference implementation for anyone self-hosting. Every type in the envelope is
exported from the package:

```ts
import type { Envelope, CrxEvent, LifecycleEvent } from "crxtrace";
```

> **On open core:** this SDK is MIT and complete — no feature flags, no phoning
> home, no crippled self-hosted mode. A hosted dashboard that does the
> server-side grouping, triage, and release health is sold separately. If you'd
> rather run your own backend, the contract above is all you need, and it will
> not break under you.

---

## Try it in two minutes

```bash
npm install
npm run demo:sync     # build the SDK into the demo extension
npm run demo:ingest   # throwaway server that pretty-prints arriving events
```

Load `examples/demo-extension` as an unpacked extension at
`chrome://extensions` and click the buttons. Each one triggers a different MV3
failure mode. Full walkthrough in [`examples/README.md`](examples/README.md).

The one worth waiting for: click **Start task, then let worker die**, close the
popup, and leave the browser alone for ~30 seconds. When you wake the extension
again, the terminal prints

```
⚠ worker terminated after 31s while running: fetchTranscript
```

---

## API

| Function | Purpose |
| --- | --- |
| `init(options)` | Start the SDK for this surface |
| `captureException(error, ctx?)` | Report an error you caught |
| `captureMessage(message, ctx?)` | Report a non-error event |
| `track(name, work)` | Run async work, attributing a worker death to it |
| `wrap(fn)` | Wrap a function so throws are reported and rethrown unchanged |
| `addBreadcrumb(crumb)` | Add context to the next event |
| `setUser` / `setTag` / `setContext` | Attach metadata |
| `flush()` | Send everything queued now |
| `close()` | Flush, uninstrument, reset |

### Options

| Option | Default | Notes |
| --- | --- | --- |
| `dsn` | — | **Required.** Your ingest endpoint. |
| `release` | manifest version | Used for release health. |
| `environment` | auto | `development` for unpacked installs. |
| `sampleRate` | `1` | Fraction of events sent. |
| `maxQueueSize` | `60` | Events held in the durable queue. |
| `maxBreadcrumbs` | `40` | Breadcrumbs retained per event. |
| `flushIntervalMinutes` | `1` | Alarm that drains an idle worker. |
| `flushDebounceMs` | `1500` | Batching window before a send. |
| `ignoreErrors` | `[]` | Drop by message (string or RegExp). |
| `allowHosts` / `denyHosts` | `[]` | Filter content script events by host. |
| `autoBreadcrumbs` | `true` | Instrument `console.error`/`warn`, `fetch`, `runtime.sendMessage`. |
| `autoSessionTracking` | `true` | Emit session updates for release health. |
| `trackLifecycle` | `true` | Report boot / install / update / termination. |
| `sendDefaultPii` | `false` | Include full URLs with query strings. |
| `beforeSend` | — | Last-chance hook; return `null` to drop. |
| `debug` | `false` | Narrate the SDK's decisions to the console. |

### No bundler?

Use the IIFE build and the `CrxTrace` global:

```js
// service worker
importScripts("vendor/crxtrace.global.js");
CrxTrace.init({ dsn: "..." });
```

```html
<script src="vendor/crxtrace.global.js"></script>
<script>
  CrxTrace.init({ dsn: "..." });
</script>
```

### Manifest permissions

```json
{ "permissions": ["storage", "alarms"] }
```

`storage` is **required** — it's what makes the queue durable across worker
death. `alarms` is strongly recommended so a mostly-idle worker still drains
its queue.

You also need your ingest origin in `host_permissions`.

---

## Development

```bash
npm install
npm test          # 51 tests
npm run typecheck
npm run build
```

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Bugs and
feature requests go in [issues](https://github.com/sabbir-offc/crxtrace/issues);
security reports go to [SECURITY.md](SECURITY.md) instead.

## License

[MIT](LICENSE)
