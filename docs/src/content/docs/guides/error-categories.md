---
title: MV3 error categories
description: The MV3 error families CrxTrace classifies, what each one actually means, and how to fix it.
---

MV3 produces a small set of error messages over and over, from wildly different
call sites. A generic tracker groups by stack trace, so one root cause becomes
two hundred issues.

CrxTrace classifies each event into an `mv3Category` and groups by **cause**
rather than call site. One underlying problem is one issue.

## The categories

| Category | Typical message | What it actually means |
| --- | --- | --- |
| `context_invalidated` | `Extension context invalidated` | The extension was reloaded, updated, or disabled while a content script from the old version was still running on a page. |
| `no_receiver` | `Could not establish connection. Receiving end does not exist.` | You sent a message to something that isn't listening — usually a content script not injected on that page, or a worker that hasn't booted. |
| `message_port_closed` | `The message port closed before a response was received.` | A `sendMessage` listener returned without responding, or forgot to `return true` for an async response. |
| `sw_terminated` | *(synthesised)* | The service worker was killed with tracked work still in flight. See [Service worker deaths](/guides/worker-deaths/). |
| `storage_quota` | `QUOTA_BYTES quota exceeded` | You've exceeded `chrome.storage` limits. `sync` is far smaller than `local`. |
| `permission_denied` | `Cannot access contents of the page` | A missing host permission, or a page extensions may not touch at all. |
| `script_injection` | `Cannot access a chrome:// URL` | `chrome.scripting` aimed at a restricted page — `chrome://`, the Web Store, or another extension. |
| `tab_gone` | `No tab with id: 42` | The tab closed or navigated between you reading its id and using it. |
| `native_host` | `Specified native messaging host not found` | The native messaging host isn't installed or isn't registered for your extension id. |
| `csp` | `Refused to execute inline script` | The page's Content Security Policy blocked something your content script did. |
| `network` | `Failed to fetch` | A request failed — offline, DNS, CORS, or the server. |
| `user_gesture` | `must be called during a user gesture` | An API that requires a real click was called after an `await`, which discards gesture context. |
| `unknown` | — | Everything else, including your own application errors. |

## Why grouping by cause matters

Take `no_receiver`. In a real extension it fires from every place you call
`chrome.tabs.sendMessage` — a dozen call sites, all with different stacks, all
the same root cause: *you messaged a tab with no content script*.

Grouped by stack, that's a dozen issues that each look mildly puzzling. Grouped
by cause, it's one issue with a clear fix.

The same applies to `context_invalidated`, which fires from wherever your
content script happened to be when the user hit reload — effectively a random
stack every time.

## The two you should fix first

**`message_port_closed`** is almost always a real bug in your message handling:

```js
// Broken — the listener returns synchronously, so the port closes
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  doAsyncWork().then(sendResponse);
});

// Fixed — return true to keep the port open
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  doAsyncWork().then(sendResponse);
  return true;
});
```

**`user_gesture`** is a bug that only shows up on slow machines, which is why
you never see it locally:

```js
// Broken — the gesture is gone by the time this runs
button.addEventListener("click", async () => {
  await loadSettings();
  chrome.tabs.create({ url });     // may throw
});

// Fixed — use the gesture first, await after
button.addEventListener("click", () => {
  chrome.tabs.create({ url });
  void loadSettings();
});
```

## Expected noise

Some of these are unavoidable and not worth alerting on:

- **`context_invalidated`** spikes every time you ship an update — old content
  scripts are still on open tabs. A spike right after a release is normal; a
  steady stream is not.
- **`no_receiver`** is routine if you broadcast to tabs speculatively.
- **`network`** tracks your users' connectivity as much as your code.

If a category is pure noise for your extension, drop it:

```js
CrxTrace.init({
  dsn: "...",
  ignoreErrors: [/Extension context invalidated/],
});
```

Better, keep it but stop alerting on it — the volume is a useful signal even
when individual events aren't.

## Reading the category in code

```js
CrxTrace.init({
  dsn: "...",
  beforeSend: (event) => {
    if (event.mv3Category === "network" && !navigator.onLine) return null;
    return event;
  },
});
```

## Related

- [Filtering events](/guides/filtering/)
- [Envelope format](/reference/envelope/) — where `mv3Category` sits on the wire
