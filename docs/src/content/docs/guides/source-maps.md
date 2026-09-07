---
title: Source maps
description: Resolve minified extension stack frames back to your original source using debug IDs and the upload CLI.
---

If you ship a bundled extension, every stack you receive looks like this:

```
TypeError: Cannot read properties of undefined
  at t (app:///background.js:1:45231)
```

Useless. With source maps configured it becomes:

```
TypeError: Cannot read properties of undefined
  at syncBookmarks (src/sync/bookmarks.ts:42:18)
```

## How it works

Resolution happens **on the server**, never in the browser. Shipping source
maps to your users would expose your original source to anyone who installs the
extension and add megabytes to your bundle.

So there are three moving parts:

1. Your build generates a **debug ID** — a unique id for that exact build
2. The SDK sends the debug ID with every event
3. You upload the source maps under the same debug ID, and the server matches
   them up

```
build ──┬── debugId ──▶ init() ──▶ events carry debugId ──┐
        │                                                  ├──▶ server resolves
        └── .map files ──▶ crxtrace sourcemaps upload ─────┘
```

### Why a debug ID and not the version

Rebuilding the same version produces different minified output — different
variable names, different line offsets. A stack frame from build A cannot be
resolved with build B's map, even though both call themselves `1.4.2`.

This bites hardest during development, where you rebuild constantly without
touching the version. A debug ID is per-build, so it never mismatches.

## Setting it up

### 1. Generate a debug ID and inject it

Generate one id per build and make it available to your code. Any bundler that
supports compile-time constants works:

```js title="build.mjs"
import { randomUUID } from "node:crypto";
import { build } from "esbuild";

const debugId = randomUUID();

await build({
  entryPoints: ["src/background.ts"],
  outdir: "dist",
  bundle: true,
  minify: true,
  sourcemap: true,                       // required
  define: { __DEBUG_ID__: JSON.stringify(debugId) },
});

// Hand it to the upload step
console.log(debugId);
```

```ts title="tsup.config.ts"
import { randomUUID } from "node:crypto";
import { defineConfig } from "tsup";

const debugId = process.env.DEBUG_ID ?? randomUUID();

export default defineConfig({
  entry: ["src/background.ts"],
  sourcemap: true,
  minify: true,
  define: { __DEBUG_ID__: JSON.stringify(debugId) },
});
```

:::caution
`sourcemap: true` is off by default in most bundlers. Without it there are no
`.map` files to upload and nothing to resolve.
:::

### 2. Pass it to init()

```js title="background.js"
import * as CrxTrace from "crxtrace";

CrxTrace.init({
  dsn: "https://your-ingest-endpoint/pk_live_...",
  debugId: __DEBUG_ID__,
});
```

That's the only SDK change. `debugId` is optional — omit it and everything
else works exactly as before, you just get minified frames.

### 3. Upload the maps

```bash
npx crxtrace sourcemaps upload \
  --dsn "$DSN" \
  --debug-id "$DEBUG_ID" \
  --release "1.4.2" \
  ./dist
```

The CLI walks the directory, finds every `.map` file, and uploads each one
keyed by debug ID and the path of the file it describes. It ships with the
package and has no dependencies of its own.

```
crxtrace: 2 source maps in ./dist
  debug id  018f2a1e-9c4d-7bb2-a1f4-2b6d9e0c1a33
  endpoint  https://your-ingest-endpoint/pk_live_.../sourcemaps

  uploaded  background.js  (16 sources)
  uploaded  content.js     (9 sources)

crxtrace: 2 uploaded, 0 failed
```

## CLI reference

```
crxtrace sourcemaps upload [options] <directory>
```

| Option | Notes |
| --- | --- |
| `--dsn <url>` | **Required.** The same DSN you pass to `init()`. |
| `--debug-id <id>` | **Required.** The same value you pass to `init({ debugId })`. |
| `--release <version>` | Optional, recorded alongside the map for your own reference. |
| `--url <url>` | Upload endpoint. Defaults to `<dsn>/sourcemaps`. |
| `--concurrency <n>` | Parallel uploads. Default 4. |
| `--dry-run` | List what would be uploaded and exit. |
| `--verbose` | Print each request. |

Exits non-zero if any upload fails, so it fails your CI job rather than
silently shipping a release with no maps.

## In CI

Generate the id once, then use it for both the build and the upload:

```yaml title=".github/workflows/release.yml"
- name: Build and upload source maps
  env:
    DSN: ${{ secrets.CRXTRACE_DSN }}
  run: |
    DEBUG_ID=$(node -e "console.log(crypto.randomUUID())")
    DEBUG_ID="$DEBUG_ID" npm run build
    npx crxtrace sourcemaps upload \
      --dsn "$DSN" \
      --debug-id "$DEBUG_ID" \
      --release "$(node -p "require('./package.json').version")" \
      ./dist
```

## Don't ship the maps

Upload them, then keep them out of the packaged extension:

```bash
npx crxtrace sourcemaps upload --dsn "$DSN" --debug-id "$DEBUG_ID" ./dist
rm dist/*.map
zip -r extension.zip dist
```

A `.map` inside your `.zip` hands your original source to anyone who unpacks
the extension — which is everyone, since a CRX is just a zip.

Some bundlers also append a `//# sourceMappingURL=` comment to each bundle.
It's harmless once the `.map` is gone (the browser just fails to find it), but
you can strip it too if you'd rather not advertise that maps exist.

## Troubleshooting

**Frames are still minified.** The most common cause is a debug ID mismatch —
the id baked into the bundle isn't the one the maps were uploaded under.
Generate it once per build and reuse the same value for both steps.

**"NO sourcesContent" warning.** Your maps name their source files but don't
embed their contents, so the server can resolve a frame to a file and line but
has no code to display around it. Most bundlers embed it by default; check for
a `sourcesContent: false` or "external sources" setting.

**"no .map files found".** Source maps aren't enabled in your build.

**Everything returns 404.** The endpoint defaults to `<dsn>/sourcemaps`. If
your backend puts it elsewhere, pass `--url`.

## Self-hosting the endpoint

The upload contract is simple and documented, so a self-hosted backend can
implement it in an afternoon:

```http
POST <dsn>/sourcemaps
content-type: application/json

{
  "debugId": "018f2a1e-9c4d-7bb2-a1f4-2b6d9e0c1a33",
  "release": "1.4.2",
  "file": "background.js",
  "map": { /* the source map, parsed */ }
}
```

Answer `2xx` on success. Store keyed by `(project, debugId, file)`.

At display time, take a frame's `file` (with the `app:///` prefix stripped),
`line` and `column`, look up the map for the event's `debugId`, and resolve.
[`@jridgewell/trace-mapping`](https://github.com/jridgewell/trace-mapping) does
the lookup in a few lines.

See [Self-hosting](/reference/self-hosting/) for the full picture.

## Related

- [Configuration](/reference/configuration/#debugid) — the `debugId` option
- [Envelope format](/reference/envelope/) — where `debugId` sits on the wire
