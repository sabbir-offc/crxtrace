---
title: Configuration
description: Every CrxTrace option, its default, and when to change it.
---

```js
CrxTrace.init({
  dsn: "https://your-ingest-endpoint/pk_live_...",
});
```

`dsn` is the only required option. Everything else has a default chosen to be
correct for a typical extension.

## Identity

### dsn

**Required.** `string`

The endpoint events are `POST`ed to. Trailing slashes are stripped.

Any server that accepts the [envelope](/reference/envelope/) and answers `2xx`
works — there is nothing proprietary about it.

### release

Default: **your manifest's `version`**

Used for release health and per-version breakdowns. Override if your internal
version differs from the manifest one.

```js
CrxTrace.init({ dsn: "...", release: "2026.9.1-canary" });
```

### environment

Default: **`"production"`, or `"development"` for unpacked installs**

Detected from the manifest: store builds get an `update_url` injected at
packaging time, unpacked loads never have one. It's the only reliable unpacked
signal that doesn't cost you the `management` permission.

### surface

Default: **auto-detected**

One of `service_worker`, `content_script`, `popup`, `options`, `sidepanel`,
`devtools`, `offscreen`, `extension_page`, `unknown`. Only set this if
detection guesses wrong — and please
[report it](https://github.com/sabbir-offc/crxtrace/issues) if it does.

## Volume and delivery

### sampleRate

Default: **`1`** · Range: `0`–`1`

Fraction of events sent, decided per event in the browser.

### maxQueueSize

Default: **`60`** · Range: `1`–`500`

Events held in the durable `chrome.storage.local` queue. When full, the oldest
are dropped.

Raising it costs extension storage quota; lowering it risks losing events
during an outage.

### maxBreadcrumbs

Default: **`40`** · Range: `0`–`200`

Breadcrumbs retained per surface, oldest dropped first.

### flushIntervalMinutes

Default: **`1`** · Minimum: `0.5`

The `chrome.alarms` interval that drains an idle worker's queue.

This is why `alarms` is a recommended permission — without it, a mostly-idle
worker may hold events until something else wakes it. Chrome enforces its own
minimum alarm period, so very low values won't fire as often as you ask.

### flushDebounceMs

Default: **`1500`** · Range: `0`–`30000`

How long to batch events before sending. Lower feels more immediate and costs
more requests; the demo extension uses `300`.

## Behaviour

### autoBreadcrumbs

Default: **`true`**

Instruments `console.error`/`warn`, `fetch`, and `runtime.sendMessage` as
breadcrumbs.

### autoSessionTracking

Default: **`true`**

Emits session updates per worker boot, which is what powers crash-free-session
rates.

### trackLifecycle

Default: **`true`**

Reports boot, install, update, browser update, startup, suspend, and
termination events. Turning this off disables service worker death detection —
the main reason to use CrxTrace at all.

### debug

Default: **`false`**

Narrates the SDK's decisions to the console. Useful while wiring things up;
leave it off in production.

## Filtering

### ignoreErrors

Default: **`[]`** · Type: `(string | RegExp)[]`

Drop by message. Strings match as substrings.

### allowHosts / denyHosts

Default: **`[]`** · Type: `(string | RegExp)[]`

Filter content script events by page host. If `allowHosts` is non-empty, only
those hosts are reported. `denyHosts` always wins.

### scrub

Default: **`[]`** · Type: `RegExp[]`

Extra patterns redacted from event data, on top of the built-in rules.

### sendDefaultPii

Default: **`false`**

When `false`, URLs are truncated to origin + path and query strings are
dropped. Setting it `true` includes full URLs.

:::caution
In a content script this means collecting the full URLs of pages your users
visit. See [Privacy](/guides/privacy/).
:::

### beforeSend

Default: **none** · Type: `(event: CrxEvent) => CrxEvent | null`

Last-chance synchronous hook. Return `null` to drop. Runs after redaction, so
it sees exactly what would be sent. Cannot be async.

## Full example

```js
CrxTrace.init({
  dsn: "https://your-ingest-endpoint/pk_live_...",
  release: chrome.runtime.getManifest().version,
  environment: "production",

  sampleRate: 1,
  maxQueueSize: 60,
  maxBreadcrumbs: 40,
  flushIntervalMinutes: 1,
  flushDebounceMs: 1500,

  autoBreadcrumbs: true,
  autoSessionTracking: true,
  trackLifecycle: true,

  ignoreErrors: [/Extension context invalidated/],
  denyHosts: [/bank/],
  scrub: [/ORDER-\d+/],
  sendDefaultPii: false,
  beforeSend: (event) => event,

  debug: false,
});
```

## Storage keys

For reference when debugging `chrome.storage.local`:

| Key | Holds |
| --- | --- |
| `__crxtrace_queue` | Events pending send |
| `__crxtrace_queue_inflight` | A batch currently being sent, kept separate so a worker death mid-send doesn't lose it |
| `__crxtrace_boot` | Last boot record, used to detect an unclean termination |
| `__crxtrace_install` | The random per-install id |
| `__crxtrace_relay` | Relay channel marker for content script forwarding |

The flush alarm is named `crxtrace-flush`.
