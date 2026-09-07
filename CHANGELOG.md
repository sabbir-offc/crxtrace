# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because self-hosted receivers parse the envelope directly, **the wire format in
`src/types.ts` is part of the public API.** Additive fields are minor; renaming
or removing one is major.

## [Unreleased]

## [0.2.0] — 2026-09-08

### Added

- **Source map support.** Minified stack frames can now be resolved back to
  original source, server-side.
  - New optional `debugId` option on `init()`, identifying the exact build.
    A build id rather than a version, because rebuilding the same version
    produces different minified output — `release` alone cannot identify which
    map belongs to a frame.
  - `debugId` is carried on the envelope, and survives the durable queue, so an
    event stranded by a worker death is still resolvable on a later boot.
  - New `crxtrace sourcemaps upload` CLI, shipped with the package and
    dependency-free. Walks a directory, uploads every `.map` file keyed by
    debug id, warns when a map has no `sourcesContent`, and exits non-zero on
    failure so a release with missing maps fails CI.
  - The upload contract is documented alongside the envelope format, so a
    self-hosted backend can implement it without reading the SDK source.

Resolution itself is the server's job — source maps are never shipped to the
browser, which would expose your original source to anyone who unpacks the
extension.

### Changed

- `Envelope` gains an optional `debugId` field. Additive: existing receivers
  are unaffected, and the field is omitted entirely when no debug id is set.

## [0.1.0] — 2026-09-08

Initial public release.

### Added

- **Durable event queue.** Events are written to `chrome.storage.local` before
  any send is attempted and cleared only on server acknowledgement, so a
  service worker killed mid-flush loses nothing. In-flight batches are held
  separately from the pending queue and recovered on the next boot.
- **Service worker death attribution.** `track(name, work)` registers async
  work; if Chrome terminates the worker while it is outstanding, the next boot
  emits an `sw_terminated` event naming the task. Routine idle recycling with
  no work in flight is deliberately *not* reported as a fault.
- **Surface detection and relay.** One `init()` call works in the service
  worker, content scripts, popup, options, side panel, devtools, and offscreen
  documents. Only the worker owns the queue and touches the network; every
  other surface relays through it.
- **MV3 error classification.** Raw messages are mapped to a `Mv3Category`
  (`context_invalidated`, `no_receiver`, `message_port_closed`,
  `sw_terminated`, `storage_quota`, `permission_denied`, `script_injection`,
  `tab_gone`, `native_host`, `csp`, `network`, `user_gesture`) and grouped by
  cause rather than call site.
- **Host grouping for content scripts.** Content script events carry the page
  host, so a breakage caused by one site's redesign is one issue.
- **Extension id normalization.** `chrome-extension://<id>/sw.js` is rewritten
  to `app:///sw.js` so a bug is one issue across every install.
- **Host-page error rejection.** Only events with a stack frame inside the
  extension bundle are reported, keeping the host site's own exceptions — and
  their stack traces — out of your server.
- **In-browser redaction.** JWTs, bearer tokens, `sk_`/`pk_`-style keys, email
  addresses, and values under keys matching
  `pass|secret|token|auth|key|cookie|session|credential` are scrubbed before
  send. URLs are truncated to origin + path unless `sendDefaultPii` is set.
- **Filtering hooks.** `ignoreErrors`, `allowHosts`, `denyHosts`, `scrub`, and
  `beforeSend`.
- **Auto-instrumentation** of `console.error`/`warn`, `fetch`, and
  `runtime.sendMessage` as breadcrumbs, disableable with
  `autoBreadcrumbs: false`.
- **Release health.** Session updates per worker boot, and lifecycle events for
  boot, install, update, browser update, startup, suspend, and termination.
- **Retry semantics.** `429` and `5xx` retry with backoff and honour
  `Retry-After`; `4xx` is dropped rather than retried forever.
- **Builds** for ESM, CJS, and a single-file IIFE exposing a `CrxTrace` global
  for extensions with no bundler. Full TypeScript declarations, including every
  envelope type for self-hosted receivers.
- **Reference ingest server** in `examples/ingest-server.mjs` and a demo
  extension exercising each failure mode.

[Unreleased]: https://github.com/sabbir-offc/crxtrace/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/sabbir-offc/crxtrace/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sabbir-offc/crxtrace/releases/tag/v0.1.0
