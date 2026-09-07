// The IIFE build exposes a `CrxTrace` global — no bundler needed.
importScripts("config.js", "vendor/crxtrace.global.js");

CrxTrace.init({
  dsn: CRXTRACE_CONFIG.dsn,
  environment: "development",
  debug: true,
  // Short debounce so the demo feels immediate; the default is 1500ms.
  flushDebounceMs: 300,
});

CrxTrace.setTag("demo", "true");

/** Resolves never — used to show a task still in flight when the worker dies. */
function neverSettles() {
  return new Promise(() => {});
}

const actions = {
  throw() {
    throw new TypeError("cannot read properties of undefined (reading 'id')");
  },

  reject() {
    // No catch anywhere: surfaces as an unhandledrejection.
    Promise.reject(new Error("transcript pipeline failed on all three tiers"));
  },

  noReceiver() {
    // Classic MV3 noise: nobody is listening on the other end.
    chrome.runtime.sendMessage({ to: "a-port-that-does-not-exist" });
  },

  storageQuota() {
    CrxTrace.captureException(
      new Error("Resource::kQuotaBytesPerItem quota exceeded"),
    );
  },

  handled() {
    try {
      JSON.parse("{ not json");
    } catch (error) {
      CrxTrace.captureException(error, { tags: { source: "demo-handled" } });
    }
  },

  /**
   * Starts tracked work that never finishes. Let the worker go idle (~30s) and
   * Chrome will kill it — on the next boot CrxTrace reports a terminated event
   * naming this task.
   */
  hang() {
    void CrxTrace.track("fetchTranscript", neverSettles());
    return "task started — now let the worker go idle for ~30s";
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const action = actions[message?.action];
  if (!action) return;

  try {
    const note = action();
    sendResponse({ ok: true, note });
  } catch (error) {
    // Rethrow after responding so the global handler still sees it.
    sendResponse({ ok: false, error: String(error) });
    setTimeout(() => {
      throw error;
    }, 0);
  }

  return true;
});
