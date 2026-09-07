/**
 * Throwaway ingest endpoint for the demo extension.
 *
 * Stands in for the real dashboard: accepts envelopes and pretty-prints what
 * arrived, so you can watch events land while clicking around the extension.
 *
 *   node examples/ingest-server.mjs
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8787);

const RESET = "[0m";
const DIM = "[2m";
const BOLD = "[1m";
const RED = "[31m";
const YELLOW = "[33m";
const CYAN = "[36m";
const GREEN = "[32m";

let envelopeCount = 0;

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function printEvent(event) {
  const where = event.host ? `${event.surface} @ ${event.host}` : event.surface;
  const category =
    event.mv3Category && event.mv3Category !== "unknown"
      ? ` ${YELLOW}[${event.mv3Category}]${RESET}`
      : "";

  console.log(
    `  ${RED}✖${RESET} ${BOLD}${event.type}${RESET}: ${event.message}`,
  );
  console.log(`    ${DIM}${where}${category}${RESET}`);

  if (event.culprit) console.log(`    ${DIM}at ${event.culprit}${RESET}`);

  const sw = event.contexts?.serviceWorker;
  if (sw?.pendingTasks?.length) {
    console.log(
      `    ${DIM}in flight: ${sw.pendingTasks.join(", ")}${RESET}`,
    );
  }

  const crumbs = event.breadcrumbs ?? [];
  if (crumbs.length) {
    const last = crumbs.slice(-2);
    for (const crumb of last) {
      console.log(`    ${DIM}· ${crumb.category}: ${crumb.message}${RESET}`);
    }
  }
}

function printLifecycle(entry) {
  if (entry.kind === "terminated") {
    const tasks = entry.data?.pendingTasks ?? [];
    const uptime = Math.round((entry.data?.uptimeMs ?? 0) / 1000);

    // An idle worker being killed is routine MV3 housekeeping, not a fault.
    // Only a death with work still in flight deserves attention.
    if (!entry.data?.hadPendingWork) {
      console.log(
        `  ${DIM}◆ worker recycled after ~${uptime}s idle (normal)${RESET}`,
      );
      return;
    }

    console.log(
      `  ${YELLOW}⚠ worker terminated${RESET} after ~${uptime}s ` +
        `${BOLD}while running: ${tasks.join(", ")}${RESET}`,
    );
    return;
  }
  console.log(`  ${CYAN}◆ ${entry.kind}${RESET}`);
}

const server = createServer(async (request, response) => {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "*");

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }

  let envelope;
  try {
    envelope = JSON.parse(await readBody(request));
  } catch {
    response.writeHead(400).end(JSON.stringify({ error: "invalid json" }));
    return;
  }

  envelopeCount += 1;
  const { events = [], sessions = [], lifecycle = [] } = envelope;

  console.log(
    `\n${GREEN}▸ envelope #${envelopeCount}${RESET} ${DIM}` +
      `${envelope.extension?.name} v${envelope.release} · ` +
      `${events.length} event(s), ${lifecycle.length} lifecycle${RESET}`,
  );

  for (const entry of lifecycle) printLifecycle(entry);
  for (const event of events) printEvent(event);

  for (const session of sessions) {
    if (session.status === "errored") {
      console.log(`  ${DIM}session ${session.surface}: errored${RESET}`);
    }
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, received: events.length }));
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `\n${RED}Port ${PORT} is already in use.${RESET}\n` +
        `${DIM}An old copy of this server is probably still running. Stop it with:${RESET}\n\n` +
        `  ${DIM}PowerShell${RESET}  ${BOLD}Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force${RESET}\n` +
        `  ${DIM}macOS/Linux${RESET}  ${BOLD}lsof -ti:${PORT} | xargs kill${RESET}\n\n` +
        `${DIM}Or run on another port — then update the dsn in the demo extension${RESET}\n` +
        `${DIM}(background.js, content.js, popup.js) and manifest host_permissions:${RESET}\n\n` +
        `  ${DIM}PowerShell${RESET}  ${BOLD}$env:PORT=8788; node examples/ingest-server.mjs${RESET}\n` +
        `  ${DIM}macOS/Linux${RESET}  ${BOLD}PORT=8788 node examples/ingest-server.mjs${RESET}\n`,
    );
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`${BOLD}CrxTrace demo ingest${RESET} listening on :${PORT}`);
  console.log(`${DIM}DSN: http://localhost:${PORT}/api/ingest/pk_demo${RESET}`);
  console.log(`${DIM}Waiting for envelopes…${RESET}`);
});
