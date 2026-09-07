# CrxTrace demo

A real MV3 extension that triggers each failure mode CrxTrace is built to catch,
plus a throwaway ingest server so you can watch events arrive.

## Run it

**1. Build the SDK and copy it into the demo:**

```bash
npm run demo:sync
```

**2. Point the demo at an ingest endpoint.** Copy the example config:

```bash
cp examples/demo-extension/config.example.js examples/demo-extension/config.js
```

`config.js` is git-ignored, so your real DSN never gets committed. Leave the
default to use the throwaway terminal server below, or point it at your own
ingest endpoint to send events somewhere real:

```js
self.CRXTRACE_CONFIG = {
  dsn: "https://your-ingest-endpoint/pk_live_...",
};
```

**3. Start something to receive events.** The throwaway server pretty-prints
every envelope to your terminal:

```bash
npm run demo:ingest
```

It's ~150 lines of dependency-free Node
([`ingest-server.mjs`](ingest-server.mjs)) and doubles as the reference
implementation if you're writing your own receiver — the wire format is
documented under [**Where your events go**](../README.md#where-your-events-go).

**4. Load the extension:** open `chrome://extensions`, enable Developer mode,
click *Load unpacked*, and select `examples/demo-extension`.

**5. Click the toolbar icon** and press the buttons. Events appear within a
second, in the terminal running the ingest server.

> Changed `config.js` after loading? Hit the reload ↻ on the extension's card
> in `chrome://extensions`, otherwise Chrome keeps serving the old file.

## What each button proves

| Button | What you should see |
| --- | --- |
| Throw in service worker | A `TypeError` with `app:///background.js` in the culprit — the extension id is normalized away |
| Unhandled promise rejection | Caught with no try/catch anywhere |
| sendMessage with no receiver | Classified `[no_receiver]` and grouped by cause, not call site |
| Storage quota exceeded | Classified `[storage_quota]` |
| Handled error | Reported with your `source: demo-handled` tag |
| Start task, then let worker die | See below — this is the one that matters |

## The worker-death demo

This is the failure no generic tracker reports.

1. Click **Start task, then let worker die**. It begins tracked work that never
   finishes.
2. Close the popup and leave the browser alone for ~30 seconds. Chrome kills
   the idle service worker — silently, with no error and no teardown event.
3. Click the extension icon again to wake it.

The ingest terminal prints:

```
⚠ worker terminated after 31s while running: fetchTranscript
```

Nothing threw. Nothing logged. The worker simply stopped mid-task, and the only
way to learn about it is to notice on the *next* boot that the previous one
never exited cleanly.

To force it faster, open `chrome://serviceworker-internals` and stop the
worker, or hit **Service worker → terminate** on the extension's card in
`chrome://extensions`.

## Content script behaviour

Open any http(s) page with the extension loaded. Two things happen:

- The demo fires a fake **host page error**. It is *not* reported — a content
  script shares the page's `window`, so `window.onerror` sees the site's own
  bugs too. CrxTrace only reports events with a frame inside your bundle.
- A broken `document.querySelector` lookup **is** reported, tagged with the
  page's host, which is how a site redesign shows up as one issue on one host.

## Notes

- The demo DSN points at `http://localhost:8787`, declared in the manifest's
  `host_permissions`. A real DSN would be https.
- `debug: true` is on, so the SDK narrates itself in the service worker console.
- `flushDebounceMs` is lowered to 300ms so the demo feels immediate. The default
  is 1500ms.
