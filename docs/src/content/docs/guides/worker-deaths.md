---
title: Service worker deaths
description: Why a terminated MV3 service worker is invisible to generic error trackers, and how track() makes it visible.
---

This is the failure mode CrxTrace exists for.

## What actually happens

Chrome kills an idle MV3 service worker roughly 30 seconds after its last
activity. There is no reliable teardown event — `onSuspend` is not guaranteed
to fire, and even when it does you have no time to do anything useful.

So consider a worker that starts a fetch and gets terminated halfway through:

- Nothing threw. There is no `Error` object anywhere.
- `window.onerror` never fires. There's no `window`, and nothing errored.
- `unhandledrejection` never fires. The promise wasn't rejected — it was
  *abandoned*, along with the entire JavaScript context.
- Your in-memory error buffer is gone with the context that held it.

From the user's side, the extension "randomly does nothing sometimes." From
your side, total silence. A generic error tracker reports exactly zero events,
and it is not doing anything wrong — there is genuinely no error to catch.

## Making it visible

The only way to learn about a death is to notice, on the *next* boot, that the
previous one never exited cleanly. CrxTrace writes a boot record to
`chrome.storage.local` and checks it on every start.

Give your async work a name and it gets attributed:

```js
const transcript = await CrxTrace.track("fetchTranscript", getTranscript(id));
```

`track()` registers the task, awaits your promise, and deregisters it — whether
it resolves or throws. If the worker dies while the task is still registered,
the next boot emits an `sw_terminated` event naming it:

```
⚠ worker terminated after 31s while running: fetchTranscript
```

That is the difference between an unactionable bug report and a line item:
*"the worker died during fetchTranscript, 11 times yesterday."*

`track()` accepts either a promise or a function returning one, and it re-throws
unchanged — so wrapping an existing call never alters its behaviour:

```js
// both forms work
await CrxTrace.track("sync", syncBookmarks());
await CrxTrace.track("sync", () => syncBookmarks());
```

If the promise rejects normally, that's captured as an ordinary error, tagged
with `task: "sync"`.

## Idle recycling is not a fault

A worker shutting down with nothing in flight is **normal MV3 housekeeping**,
not a bug, and CrxTrace does not report it as one. That distinction matters
enormously in practice: a busy extension is recycled dozens of times a day, and
a tracker that reported each one would bury the real signal within a week.

Only a death with work still registered is reported as a fault. Routine
recycling is recorded as a lifecycle event for release-health purposes and
otherwise stays out of your way.

## What to wrap

Anything that can outlive a moment of idleness:

| Wrap | Why |
| --- | --- |
| Network calls | The most common cause. A slow endpoint and an idle timer race each other. |
| `chrome.tabs` / `chrome.scripting` work | Injection into a tab that may close under you. |
| Multi-step flows | Where a partial completion leaves inconsistent state. |
| Anything after an `await` chain | The worker doesn't know you intend to continue. |

Don't wrap synchronous code — it can't be interrupted by termination, so
there's nothing to attribute.

## Keeping the worker alive long enough

`track()` reports deaths; it doesn't prevent them. If work is being cut off
routinely, the fix is architectural rather than observability:

- Persist progress to `chrome.storage` at each step so a restart can resume,
  rather than holding state in memory.
- Use `chrome.alarms` for anything that must happen later — an alarm survives
  termination, a `setTimeout` does not.
- Break long jobs into resumable chunks.

CrxTrace's own queue is built exactly this way, which is why it survives the
event it's reporting on.

## Reproducing it on demand

Waiting 30 seconds gets old. To force a termination:

- `chrome://extensions` → your extension's card → **Service worker** →
  *terminate*
- or `chrome://serviceworker-internals` → find the worker → **Stop**

Then wake the extension again — clicking its icon is enough — and the death is
reported on that boot.

## Related

- [Envelope format](/reference/envelope/) — how lifecycle events are transmitted
- [API reference](/reference/api/) — `track()` and `wrap()`
