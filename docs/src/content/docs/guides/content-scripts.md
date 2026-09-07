---
title: Content scripts
description: Host grouping, why other sites' errors are excluded, and how content scripts relay through the service worker.
---

Content scripts are the most hostile place an extension runs. Your code shares a
JavaScript context with a page you don't control, that changes without warning,
and that has its own bugs.

## Other sites' bugs stay out

A content script shares the host page's `window`. So `window.onerror` fires for
**the site's own errors too** — a broken analytics script on some news site
would land in your inbox as though it were yours.

CrxTrace only reports events with at least one stack frame inside your
extension bundle. Everything else is dropped in the browser, before any send.

Two things follow from that, and the second matters more:

1. You don't drown in other people's noise.
2. **Their stack traces never reach your server.** A host page's error can
   contain their internal file paths, function names, and sometimes user data.
   Collecting that because your content script happened to be loaded is a
   liability you don't want.

:::note
This is why the demo extension deliberately triggers a "host page error" that
you should **not** see reported. If you ever do see one, that's a bug worth
[reporting privately](https://github.com/sabbir-offc/crxtrace/security/advisories/new).
:::

## Errors group by host

Every content script event carries the page's host. A selector that breaks when
one site redesigns becomes **one issue on one host**, rather than a flood of
identical-looking errors from thousands of installs across hundreds of sites.

```js
// This breaks the day the site ships a redesign
const title = document.querySelector(".video-title").textContent;
```

Grouped by host, that reads as *"`example.com` broke at 14:20 UTC, 400 users
affected"* — which tells you what to fix and roughly when it started.

Only the host is used for grouping. Full URLs are truncated to origin + path,
and query strings are dropped entirely unless you opt in. See
[Privacy](/guides/privacy/).

## Relaying through the worker

Content scripts never talk to your ingest endpoint directly. They forward
events to the service worker, which owns the durable queue and does all
sending.

```
content script ──relay──▶ service worker ──▶ durable queue ──▶ your endpoint
```

This is deliberate:

- **CSP.** Many sites set a Content Security Policy that would block your
  request outright. The worker isn't subject to the page's CSP.
- **Privacy.** A cross-origin request from someone else's page, carrying your
  API key, is visible to that page.
- **Durability.** One queue in one place. A content script is destroyed on every
  navigation; the worker's queue survives.

You don't configure any of this. `init()` detects the surface and wires it up.

:::caution
If the service worker is dead when a content script reports an error, the relay
wakes it — that's a normal message-passing wake. Very rarely, on a page closing
at the same moment, a relayed event can be lost. Errors captured in the worker
itself are always durable; content script events are best-effort until they
reach the queue.
:::

## Scoping which sites you collect from

If your extension runs on a broad match pattern but you only care about a few
sites — or must *not* collect from some — filter by host:

```js
CrxTrace.init({
  dsn: "...",
  allowHosts: ["app.example.com", /\.mycompany\.com$/],
  denyHosts: [/bank/, "internal.corp"],
});
```

`denyHosts` wins over `allowHosts`. Both accept strings and regular
expressions. See [Filtering events](/guides/filtering/).

## Extension id normalization

Stack frames pointing at `chrome-extension://<id>/content.js` are rewritten to
`app:///content.js`.

Every user's install has a different id in unpacked development, and frames
would otherwise never group — you'd get one issue per developer per bug. After
normalization, one bug is one issue everywhere.

## Related

- [Privacy and redaction](/guides/privacy/) — what leaves the browser
- [Filtering events](/guides/filtering/) — `allowHosts`, `denyHosts`, `beforeSend`
