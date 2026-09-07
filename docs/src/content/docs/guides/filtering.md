---
title: Filtering events
description: Drop noise before it's sent using ignoreErrors, host filters, sampling, and beforeSend.
---

Everything here runs **in the browser**, before an event is queued or sent.
Filtered events cost you no bandwidth and no storage.

## The order things run

```
capture → ignoreErrors → allowHosts / denyHosts → sampleRate → redaction → beforeSend → queue
```

`beforeSend` runs last, so it sees the event exactly as it would be sent —
already redacted, already classified.

## Drop by message

```js
CrxTrace.init({
  dsn: "...",
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    /Extension context invalidated/,
  ],
});
```

Strings match as substrings; regular expressions are tested against the
message. Use this for known-benign noise, not for hiding real bugs — a dropped
event is gone, with no record that it happened.

## Filter by host

For content scripts:

```js
CrxTrace.init({
  dsn: "...",
  allowHosts: ["app.example.com", /\.mycompany\.com$/],
  denyHosts: [/bank/, "internal.corp"],
});
```

- `allowHosts` — if non-empty, **only** these hosts are reported
- `denyHosts` — always wins, even over `allowHosts`

Both accept strings (matched as substrings) and regular expressions. Neither
affects service worker or extension page events, which have no host.

## Sample high-volume events

```js
CrxTrace.init({ dsn: "...", sampleRate: 0.25 });   // send 25%
```

The decision is made per event, client-side. Useful once an extension is large
enough that a single bad release would otherwise flood your endpoint.

:::caution
Sampling makes counts estimates. If your dashboard shows "affected installs",
that number becomes a lower bound. Start at `1` and only reduce it when volume
actually forces you to.
:::

## beforeSend — the escape hatch

Return the event to send it, a modified event to change it, or `null` to drop
it:

```js
CrxTrace.init({
  dsn: "...",
  beforeSend: (event) => {
    // Never report anything from this host
    if (event.host === "internal.example.com") return null;

    // Offline network errors aren't actionable
    if (event.mv3Category === "network" && !navigator.onLine) return null;

    // Strip something noisy you attached yourself
    delete event.contexts.extra?.rawResponse;

    // Add routing context
    event.tags.tier = isPaidUser ? "paid" : "free";

    return event;
  },
});
```

Keep it cheap and synchronous — it runs on every event, sometimes during a
worker's dying seconds. It cannot be async.

If `beforeSend` throws, the event is sent unmodified rather than lost.

## Grouping control

Set `fingerprint` on a capture to force events together or apart:

```js
CrxTrace.captureException(error, {
  fingerprint: ["sync-failure", provider],
});
```

Events sharing a fingerprint group into one issue regardless of stack. Useful
when one logical failure surfaces through several code paths.

## Turning off auto-instrumentation

Breadcrumbs from `console.error`/`warn`, `fetch`, and `runtime.sendMessage` are
on by default:

```js
CrxTrace.init({ dsn: "...", autoBreadcrumbs: false });
```

You can still call `addBreadcrumb()` manually. To trim rather than disable, cap
how many are retained:

```js
CrxTrace.init({ dsn: "...", maxBreadcrumbs: 10 });
```

## What not to filter

Two things are handled for you and shouldn't be re-implemented:

- **Host page errors** are already excluded — only events with a frame in your
  bundle are reported. See [Content scripts](/guides/content-scripts/).
- **Routine worker recycling** is already not reported as a fault. See
  [Service worker deaths](/guides/worker-deaths/).

## Related

- [Configuration](/reference/configuration/) — every option
- [Privacy and redaction](/guides/privacy/)
