CrxTrace.init({
  dsn: CRXTRACE_CONFIG.dsn,
  environment: "development",
  debug: true,
});

const status = document.getElementById("status");

document.querySelectorAll("button[data-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    const action = button.dataset.action;
    try {
      const response = await chrome.runtime.sendMessage({ action });
      status.textContent = response?.note ?? `sent: ${action}`;
    } catch (error) {
      // The worker may have been killed; sending wakes it, but a reload race
      // can still fail — and that's itself worth reporting.
      CrxTrace.captureException(error, { tags: { action } });
      status.textContent = `failed: ${error.message}`;
    }
  });
});
