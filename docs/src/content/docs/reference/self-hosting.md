---
title: Self-hosting
description: Run your own CrxTrace backend — CORS, authentication, grouping, and retention.
---

The SDK is MIT licensed and complete. It has no hosted-service dependency: the
`dsn` is just a URL, and pointing it at your own server is a first-class,
supported use — not a degraded mode.

This page is what you need to build one.

## The minimum

An endpoint that accepts `POST`, parses JSON, and answers `2xx`. Start from
[`examples/ingest-server.mjs`](https://github.com/sabbir-offc/crxtrace/blob/main/examples/ingest-server.mjs)
— about 150 lines of dependency-free Node.

```bash
git clone https://github.com/sabbir-offc/crxtrace.git
cd crxtrace && npm install
npm run demo:ingest
```

## CORS

Requests come from an extension origin, so you must handle preflight:

```js
res.setHeader("access-control-allow-origin", "*");
res.setHeader("access-control-allow-headers", "content-type, x-crxtrace-sdk");
if (req.method === "OPTIONS") return res.writeHead(204).end();
```

The custom `x-crxtrace-sdk` header **must** be in
`access-control-allow-headers`, or the browser rejects the preflight and no
events ever arrive. This is the single most common self-hosting mistake.

`*` for the origin is reasonable here — the DSN key is the credential, and
extension origins are unguessable anyway.

## Authentication

Put a key in the DSN path and validate it:

```
https://ingest.example.com/api/ingest/pk_live_abc123
```

Treat that key as **public**. It ships inside an extension anyone can unpack, so
it identifies a project — it does not authenticate a user. Design accordingly:

- Scope it to one project, write-only
- Rate limit per key and per IP
- Cap body size (reject over ~1 MB) so a bad actor can't fill your disk
- Make revocation and rotation easy

Return `401` for an unknown key. The SDK treats non-`429`/`5xx` failures as
permanent and drops the batch rather than retrying forever — which is what you
want for a revoked key.

## Responses that behave

| You return | SDK does |
| --- | --- |
| `2xx` | Clears the batch permanently |
| `429` + `Retry-After` | Backs off for that long |
| `5xx` | Retries with backoff |
| Other `4xx` | Drops the batch |

**Only answer `2xx` after the batch is durably stored.** The SDK deletes its
copy on acknowledgement — a `200` returned before your write commits means the
events are gone.

## Grouping

Raw events are close to useless at volume; the value is in collapsing them into
issues. A grouping key that works well in practice:

```
hash(type, mv3Category, surface, culprit, normalizedMessage)
```

The important part is **normalising the message** before hashing. Strip the
things that vary per occurrence, or one bug becomes thousands of issues:

```js
function normalize(message) {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/https?:\/\/\S+/g, "<url>");
}
```

Then:

- **Honour `fingerprint`.** If an event carries one, group by it and skip the
  rest — the developer asked for it explicitly.
- **Group `sw_terminated` by the task name** in
  `contexts.serviceWorker.pendingTasks`, not by stack. There is no stack.
- **Include `host` for content script events** so one site's redesign is one
  issue.
- **Don't include `release`** in the key, or every version starts from zero and
  you lose regression history. Track it as a facet instead.

## Lifecycle and sessions

```js
for (const entry of envelope.lifecycle) {
  if (entry.kind !== "terminated") continue;
  if (!entry.data?.hadPendingWork) continue;   // routine recycling — ignore
  recordWorkerDeath(entry.data.pendingTasks, entry.data.uptimeMs);
}
```

That `hadPendingWork` check is the whole game. Skip it and you'll generate an
"error" every time Chrome does normal housekeeping.

For release health, count sessions by status per release:

```
crash-free rate = ok / (ok + errored)
```

## Deduplication

Retries are expected — a worker can die after your server commits but before the
SDK sees the response, and the same batch arrives again on the next boot.

`eventId` is unique per event. Make your writes idempotent on it, with a unique
index rather than a read-then-write check.

## Source maps

To resolve minified frames you need a second endpoint. The CLI that ships with
the SDK posts one request per map file:

```http
POST <dsn>/sourcemaps
content-type: application/json

{
  "debugId": "018f2a1e-9c4d-7bb2-a1f4-2b6d9e0c1a33",
  "release": "1.4.2",
  "file": "background.js",
  "map": { /* the parsed source map */ }
}
```

Store keyed by `(project, debugId, file)` and answer `2xx`. Maps are large —
a few hundred KB each is normal — so put them in object storage rather than a
row in your events table, and cap the request body generously (10 MB is a
reasonable ceiling).

Resolve at **display** time, not ingest time. Maps are frequently uploaded
seconds after the first events from a new build arrive, and an event resolved
at ingest against a missing map stays minified forever. Resolving lazily means
a map uploaded later fixes every event that came before it.

```js
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

function resolveFrame(frame, rawMap) {
  const traced = originalPositionFor(new TraceMap(rawMap), {
    line: frame.line,
    column: frame.column,
  });
  if (!traced.source) return frame;
  return {
    ...frame,
    file: traced.source,
    line: traced.line ?? frame.line,
    column: traced.column ?? frame.column,
    function: traced.name ?? frame.function,
  };
}
```

Strip the `app:///` prefix from `frame.file` before looking up the map — the
CLI records maps under the plain path (`background.js`), while frames carry the
normalized form (`app:///background.js`).

Cache parsed maps in memory. Building a `TraceMap` is the expensive part, and
one issue page resolves dozens of frames against the same map.

## Retention

Raw events grow fast and age badly. A workable split:

- **Raw events:** 30 days, then delete
- **Issue rollups** (counts, first/last seen, affected installs): keep
  indefinitely — they're small and they're the history you actually want

Postgres has no TTL index, so schedule the prune yourself.

## Counting installs

`installId` is random per install, generated locally, and derived from nothing
about the user. Counting distinct values per issue gives you "how many people
does this affect" without identifying anyone.

If you enable [`sampleRate`](/reference/configuration/#samplerate) below `1`,
that count becomes a lower bound.

## Checklist

- [ ] `OPTIONS` preflight handled, `x-crxtrace-sdk` in allowed headers
- [ ] DSN key validated; unknown keys get `401`
- [ ] Body size capped, rate limited per key
- [ ] `2xx` returned only after a durable write
- [ ] `429` sent with `Retry-After` under load
- [ ] Writes idempotent on `eventId`
- [ ] Messages normalised before hashing into groups
- [ ] `fingerprint` honoured when present
- [ ] `terminated` with `hadPendingWork: false` ignored
- [ ] `POST <dsn>/sourcemaps` accepts and stores maps by `(project, debugId, file)`
- [ ] Frames resolved at display time, with parsed maps cached
- [ ] Retention policy scheduled

## Related

- [Envelope format](/reference/envelope/) — the full type reference
