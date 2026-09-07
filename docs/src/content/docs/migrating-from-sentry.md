---
title: Migrating from Sentry
description: How CrxTrace compares to Sentry's browser SDK in an MV3 extension, and how to run both.
---

Sentry is excellent at what it was built for: web pages. An MV3 extension is
not a web page, and the gap shows up precisely where extension bugs live.

This page is deliberately specific about what CrxTrace does *not* do, so you can
decide honestly.

## The actual differences

| | Sentry browser SDK | CrxTrace |
| --- | --- | --- |
| Service worker context | Assumes `window` and a DOM; neither exists | Built for a worker first |
| Worker killed mid-task | Not reported — nothing throws | `sw_terminated`, naming the task |
| Events queued when worker dies | Held in memory, lost with the context | Written to `chrome.storage.local` before send |
| Host page's own errors | Reported as yours | Excluded — only frames in your bundle |
| Content script grouping | By stack trace | By page host |
| MV3 error families | One issue per call site | Grouped by cause |
| Extension id in stacks | Splits one bug per install | Normalized to `app:///` |
| Performance tracing, profiling, replay | Yes | No |
| Source maps | Yes | Not yet |
| Ecosystem, integrations, maturity | Vast | One library, v0.1 |

If you need performance monitoring or session replay, Sentry is the answer and
CrxTrace isn't trying to be. If you need to know why your worker keeps dying,
Sentry structurally cannot tell you.

## API mapping

The surface is intentionally familiar:

| Sentry | CrxTrace |
| --- | --- |
| `Sentry.init({ dsn })` | `CrxTrace.init({ dsn })` |
| `Sentry.captureException(e)` | `CrxTrace.captureException(e)` |
| `Sentry.captureMessage(m)` | `CrxTrace.captureMessage(m)` |
| `Sentry.addBreadcrumb(c)` | `CrxTrace.addBreadcrumb(c)` |
| `Sentry.setUser(u)` | `CrxTrace.setUser(u)` |
| `Sentry.setTag(k, v)` | `CrxTrace.setTag(k, v)` |
| `Sentry.setContext(k, v)` | `CrxTrace.setContext(k, v)` |
| `Sentry.flush()` | `CrxTrace.flush()` |
| `Sentry.close()` | `CrxTrace.close()` |
| `beforeSend` | `beforeSend` |
| `ignoreErrors` | `ignoreErrors` |
| `sampleRate` | `sampleRate` |
| `denyUrls` / `allowUrls` | `denyHosts` / `allowHosts` |
| `sendDefaultPii` | `sendDefaultPii` |
| — | `track()` — no equivalent |

For most codebases the migration is a find-and-replace plus adding `track()`
around async work.

### Things without an equivalent

- `Sentry.startTransaction` and all performance APIs
- `withScope` / `configureScope` — CrxTrace scope is per-surface, not nestable
- Integrations — auto-instrumentation is on or off, not pluggable
- `Sentry.lastEventId()` — `captureException()` returns the id directly

## Running both

They don't conflict. A reasonable transition is to keep Sentry for your web
dashboard and add CrxTrace inside the extension:

```js title="background.js"
import * as Sentry from "@sentry/browser";
import * as CrxTrace from "crxtrace";

Sentry.init({ dsn: SENTRY_DSN });
CrxTrace.init({ dsn: CRXTRACE_DSN });
```

Both install global handlers and both will report the same uncaught error, so
expect duplicates while you overlap. To avoid double-reporting, drop
extension-surface events on the Sentry side:

```js
Sentry.init({
  dsn: SENTRY_DSN,
  beforeSend: (event) =>
    event.request?.url?.startsWith("chrome-extension://") ? null : event,
});
```

## What you give up

Said plainly:

- **No source maps yet.** A minified bundle reports minified frames. If you ship
  minified extension code, this will hurt — it's the top item on the roadmap.
- **No performance monitoring.** Errors only.
- **v0.1.** Young, small, and maintained by one person. The wire format is
  stable and documented, and the SDK is MIT with no lock-in, so the downside is
  bounded — but it isn't Sentry's maturity and won't be for a long time.

## What you gain

The class of bug that generates one-star reviews saying "randomly stops
working" — and that a page-shaped SDK cannot see, no matter how it's
configured.

## Related

- [Getting started](/getting-started/)
- [Service worker deaths](/guides/worker-deaths/)
