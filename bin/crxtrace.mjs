#!/usr/bin/env node
/**
 * CrxTrace CLI.
 *
 *   crxtrace sourcemaps upload --dsn <url> --debug-id <id> <dir>
 *
 * Dependency-free by design: this ships inside the published package, and a
 * CLI that drags in a dependency tree is a supply-chain surface for every
 * project that installs the SDK.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const NAME = "crxtrace";

// A single map larger than this is almost always an accident (a bundled
// node_modules, or `sourcesContent` for a whole monorepo). Refuse rather than
// spend minutes uploading something the server will reject.
const MAX_MAP_BYTES = 30 * 1024 * 1024;

const USAGE = `
${NAME} — MV3-aware error tracking for Chrome extensions

Usage
  ${NAME} sourcemaps upload [options] <directory>

Uploads every .map file in <directory> so the server can resolve minified
stack frames back to your original source.

Required
  --dsn <url>          Your ingest DSN, the same one passed to init()
  --debug-id <id>      Build id, the same value passed to init({ debugId })

Options
  --release <version>  Release these maps belong to, for your own reference
  --url <url>          Upload endpoint (default: <dsn>/sourcemaps)
  --concurrency <n>    Parallel uploads (default 4)
  --dry-run            List what would be uploaded and exit
  --verbose            Print each request
  -h, --help           Show this

Example
  DEBUG_ID=$(node -e "console.log(crypto.randomUUID())")
  # inject DEBUG_ID into your bundle, then:
  ${NAME} sourcemaps upload --dsn "$DSN" --debug-id "$DEBUG_ID" ./dist
`;

function fail(message, { usage = false } = {}) {
  process.stderr.write(`${NAME}: ${message}\n`);
  if (usage) process.stderr.write(USAGE);
  process.exit(1);
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      flags.help = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--verbose") {
      flags.verbose = true;
    } else if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s);
      const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = inline ?? argv[++i];
      if (value === undefined) fail(`${arg} needs a value`, { usage: true });
      flags[key] = value;
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

async function findMaps(dir) {
  const found = [];

  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      fail(`cannot read ${current}: ${error.message}`);
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        await walk(full);
      } else if (entry.name.endsWith(".map")) {
        found.push(full);
      }
    }
  }

  await walk(dir);
  return found.sort();
}

/**
 * Resolution needs the original sources. A map built without `sourcesContent`
 * only names its sources, and the server has no way to fetch files off your
 * machine — so frames resolve to a file and line with no code to show.
 */
function describeMap(parsed) {
  const sources = Array.isArray(parsed.sources) ? parsed.sources.length : 0;
  const contents = Array.isArray(parsed.sourcesContent)
    ? parsed.sourcesContent.filter((c) => typeof c === "string" && c.length).length
    : 0;
  return { sources, contents, hasContent: contents > 0 };
}

async function uploadOne(endpoint, mapPath, dir, { debugId, release, verbose }) {
  const raw = await readFile(mapPath, "utf8");

  if (Buffer.byteLength(raw) > MAX_MAP_BYTES) {
    return { mapPath, ok: false, reason: `larger than ${MAX_MAP_BYTES / 1024 / 1024} MB` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { mapPath, ok: false, reason: "not valid JSON" };
  }

  // A frame arrives as app:///background.js, so the map for it is recorded
  // under the path of the file it describes, relative to the upload directory.
  const file = path.relative(dir, mapPath).replace(/\\/g, "/").replace(/\.map$/, "");
  const info = describeMap(parsed);

  const body = JSON.stringify({
    debugId,
    ...(release ? { release } : {}),
    file,
    map: parsed,
  });

  if (verbose) {
    process.stdout.write(`  POST ${endpoint}  file=${file} bytes=${Buffer.byteLength(body)}\n`);
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  } catch (error) {
    return { mapPath, file, ok: false, reason: `request failed: ${error.message}` };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      mapPath,
      file,
      ok: false,
      reason: `HTTP ${response.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
    };
  }

  return { mapPath, file, ok: true, info, bytes: Buffer.byteLength(body) };
}

async function pool(items, limit, worker) {
  const results = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function sourcemapsUpload(flags, positional) {
  const dir = positional[0];
  if (!dir) fail("a directory is required", { usage: true });
  if (!flags.dsn) fail("--dsn is required", { usage: true });
  if (!flags.debugId) fail("--debug-id is required", { usage: true });

  let dirStat;
  try {
    dirStat = await stat(dir);
  } catch {
    fail(`no such directory: ${dir}`);
  }
  if (!dirStat.isDirectory()) fail(`not a directory: ${dir}`);

  const dsn = String(flags.dsn).replace(/\/+$/, "");
  const endpoint = flags.url ?? `${dsn}/sourcemaps`;
  try {
    new URL(endpoint);
  } catch {
    fail(`not a valid URL: ${endpoint}`);
  }

  const maps = await findMaps(dir);
  if (!maps.length) {
    fail(
      `no .map files found in ${dir}\n` +
        `  Source maps are off by default in most bundlers. For tsup or esbuild,\n` +
        `  build with sourcemap: true.`,
    );
  }

  process.stdout.write(
    `${NAME}: ${maps.length} source map${maps.length === 1 ? "" : "s"} in ${dir}\n` +
      `  debug id  ${flags.debugId}\n` +
      `  endpoint  ${endpoint}\n\n`,
  );

  if (flags.dryRun) {
    for (const m of maps) {
      const rel = path.relative(dir, m).replace(/\\/g, "/");
      process.stdout.write(`  would upload  ${rel.replace(/\.map$/, "")}\n`);
    }
    process.stdout.write(`\n${NAME}: dry run, nothing uploaded\n`);
    return 0;
  }

  const concurrency = Math.max(1, Number(flags.concurrency ?? 4) || 4);
  const results = await pool(maps, concurrency, (mapPath) =>
    uploadOne(endpoint, mapPath, dir, {
      debugId: flags.debugId,
      release: flags.release,
      verbose: flags.verbose,
    }),
  );

  let failed = 0;
  let noContent = 0;

  for (const r of results) {
    if (r.ok) {
      const note = r.info.hasContent
        ? `${r.info.sources} sources`
        : `${r.info.sources} sources, NO sourcesContent`;
      if (!r.info.hasContent) noContent++;
      process.stdout.write(`  uploaded  ${r.file}  (${note})\n`);
    } else {
      failed++;
      const rel = path.relative(dir, r.mapPath).replace(/\\/g, "/");
      process.stderr.write(`  FAILED    ${r.file ?? rel}  ${r.reason}\n`);
    }
  }

  process.stdout.write(
    `\n${NAME}: ${results.length - failed} uploaded, ${failed} failed\n`,
  );

  if (noContent) {
    process.stdout.write(
      `\nWarning: ${noContent} map${noContent === 1 ? " has" : "s have"} no sourcesContent.\n` +
        `Frames will resolve to a file and line, but the server has no copy of your\n` +
        `code to display around it. Most bundlers embed it when you ask for a full\n` +
        `source map rather than an external-sources one.\n`,
    );
  }

  if (failed) {
    process.stderr.write(
      `\nIf every upload returned 404, the endpoint is probably wrong.\n` +
        `It defaults to <dsn>/sourcemaps — override it with --url.\n`,
    );
  }

  return failed ? 1 : 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseArgs(argv);

  if (flags.help || !positional.length) {
    process.stdout.write(USAGE);
    return flags.help ? 0 : 1;
  }

  const [command, sub, ...rest] = positional;

  if (command === "sourcemaps" && sub === "upload") {
    return await sourcemapsUpload(flags, rest);
  }

  if (command === "sourcemaps") {
    fail(`unknown sourcemaps command: ${sub ?? "(none)"}`, { usage: true });
  }

  fail(`unknown command: ${command}`, { usage: true });
}

/**
 * Set exitCode and let the event loop drain instead of calling process.exit().
 *
 * fetch() keeps its sockets alive after the response resolves, and exiting on
 * top of them trips a libuv assertion on Windows — the uploads succeed, then
 * the process dies with a crash and a nonzero code, which fails the CI job
 * that just ran it. Closing the dispatcher first lets Node exit on its own,
 * immediately and cleanly.
 */
async function closeHttpSockets() {
  // Node keeps fetch's global dispatcher on a well-known symbol. It is not a
  // documented API, so treat its absence as normal and fall back to letting
  // the keep-alive timeout expire.
  const dispatcher = globalThis[Symbol.for("undici.globalDispatcher.1")];
  try {
    await dispatcher?.close?.();
  } catch {
    // Nothing actionable — the process will still exit once sockets time out.
  }
}

main()
  .then(async (code) => {
    await closeHttpSockets();
    process.exitCode = code ?? 0;
  })
  .catch(async (error) => {
    process.stderr.write(`${NAME}: ${error?.stack ?? error}\n`);
    await closeHttpSockets();
    process.exitCode = 1;
  });
