// Same init call as the worker — the SDK detects it's a content script and
// relays events through the service worker instead of fetching from this page.
CrxTrace.init({
  dsn: CRXTRACE_CONFIG.dsn,
  environment: "development",
  debug: true,
});

// Proves the host-page filter: this error belongs to the page, not to us, and
// must never be reported.
//
// The stack is overwritten deliberately. An Error constructed here would carry
// a chrome-extension:// frame from this very file and would — correctly — be
// treated as ours, so faking the error means faking where it came from.
const pageError = new Error("host page error that CrxTrace should ignore");
pageError.stack = [
  "Error: host page error that CrxTrace should ignore",
  `    at renderWidget (${location.origin}/static/app.js:412:19)`,
  `    at ${location.origin}/static/app.js:88:3`,
].join("\n");

window.dispatchEvent(
  new ErrorEvent("error", {
    message: pageError.message,
    error: pageError,
  }),
);

// A selector that silently stops matching after a site redesign is the most
// common way a content script dies without anyone noticing.
function readTitle() {
  const node = document.querySelector("[data-crxtrace-demo-title]");
  return node.textContent.trim();
}

setTimeout(() => {
  try {
    readTitle();
  } catch (error) {
    CrxTrace.captureException(error, { tags: { feature: "title-extraction" } });
  }
}, 1000);
