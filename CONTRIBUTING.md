# Contributing to CrxTrace

Thanks for taking the time. This is a small, focused library — the bar for
changes is "does this make MV3 error tracking more accurate?" rather than
"does this add a feature?"

## Getting set up

```bash
git clone https://github.com/sabbir-offc/crxtrace.git
cd crxtrace
npm install
npm test
```

No build step is needed to run the tests. There is no `chrome` global in Node,
so [`test/helpers.ts`](test/helpers.ts) installs a fake one — including a
storage backend you can inspect and a way to simulate a worker restart while
keeping storage intact.

## Trying a change in a real extension

```bash
npm run demo:sync     # builds the SDK and copies it into examples/demo-extension
npm run demo:ingest   # a throwaway server that prints arriving events
```

Then load `examples/demo-extension` unpacked at `chrome://extensions`. After
any change, re-run `demo:sync` **and** hit the reload ↻ on the extension's card
— Chrome caches the old file otherwise.

To force a worker death without waiting 30 seconds, use **Service worker →
terminate** on the extension's card, or `chrome://serviceworker-internals`.

## How the source is laid out

| Module | Responsibility |
| --- | --- |
| `index.ts` | Public API. Everything exported to users lives here. |
| `client.ts` | Orchestrates capture → enrich → redact → queue → send. |
| `queue.ts` | The durable `chrome.storage.local` queue. In-flight batches are held separately so a worker death mid-send doesn't lose them. |
| `transport.ts` | The HTTP send, and which failures are worth retrying. |
| `lifecycle.ts` | Boot/termination detection, and attributing a death to in-flight tasks. |
| `handlers.ts` | Global error hooks, auto-breadcrumbs, and the flush alarm. |
| `classify.ts` | Maps raw error messages to `Mv3Category`. |
| `stacktrace.ts` | Stack parsing, extension-id normalization, `inApp` detection. |
| `redact.ts` | Scrubbing. Runs before anything leaves the browser. |
| `relay.ts` | Content scripts forwarding to the worker instead of the network. |
| `surface.ts` | Detecting which extension surface we're running in. |
| `types.ts` | The wire contract. Changing this is a breaking change. |

## What makes a good pull request

- **One behavioural change per PR.** Refactors separate from fixes.
- **A test that fails without your change.** Especially for classification and
  stack parsing — those are the parts that silently rot.
- **`npm run typecheck` and `npm test` pass.** CI runs both on Node 20 and 22.
- **No new runtime dependencies.** The SDK ships into other people's
  extensions; every byte and every transitive dependency is their problem too.
- **Comments explain *why*, not *what*.** The existing code follows this
  fairly strictly — match it.

## Things that need particular care

**The wire format.** `types.ts` describes what every self-hosted receiver
parses. Additive fields are fine; renaming or removing one is a breaking
change and needs a major version.

**Privacy defaults.** Any change that causes *more* data to leave the browser
by default will be scrutinised hard, and probably rejected in favour of an
opt-in option. Content scripts run on pages the user did not choose to share
with us.

**Storage keys.** `__crxtrace_*` keys are read by extensions already in the
wild. Renaming one strands whatever is queued in it — if you must, migrate.

**Not reporting other people's errors.** The `inApp` frame check is the reason
this library is safe to run in a content script. Be very sure before loosening
it.

## Reporting bugs

Open an [issue](https://github.com/sabbir-offc/crxtrace/issues). The most
useful reports include your `manifest.json` (redacted), which surface the error
came from, and whether the extension was loaded unpacked or from the store.

For security issues, **do not open a public issue** — see [SECURITY.md](SECURITY.md).

## Code of conduct

Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).
