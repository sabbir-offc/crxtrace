/**
 * Copy this file to `config.js` and paste in your own DSN.
 *
 *   examples/demo-extension/config.js   (git-ignored — your key stays local)
 *
 * The default below points at the throwaway ingest server in examples/
 * (`npm run demo:ingest`). Swap it for your own endpoint to send events
 * somewhere real.
 */
self.CRXTRACE_CONFIG = {
  dsn: "http://localhost:8787/api/ingest/pk_demo",
};
