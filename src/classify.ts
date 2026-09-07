import type { Mechanism, Mv3Category } from "./types";

const RULES: { category: Mv3Category; patterns: RegExp[] }[] = [
  {
    category: "context_invalidated",
    patterns: [/extension context invalidated/i, /extension context was invalidated/i],
  },
  {
    category: "no_receiver",
    patterns: [
      /receiving end does not exist/i,
      /could not establish connection/i,
      /attempting to use a disconnected port object/i,
    ],
  },
  {
    category: "message_port_closed",
    patterns: [
      /message port closed before a response was received/i,
      /the message port closed/i,
    ],
  },
  {
    category: "storage_quota",
    patterns: [
      /quota_bytes/i,
      /kquotabytes/i,
      /quota exceeded/i,
      /max_write_operations/i,
      /resource::/i,
    ],
  },
  {
    category: "permission_denied",
    patterns: [
      /cannot access contents of/i,
      /missing host permission/i,
      /does not have permission/i,
      /permission .* is not (?:in the manifest|granted)/i,
      /this extension does not have permission/i,
    ],
  },
  {
    category: "script_injection",
    patterns: [
      /cannot access a chrome(?:-extension)?:\/\/ url/i,
      /the extensions gallery cannot be scripted/i,
      /cannot be scripted/i,
      /frame with id \d+ was removed/i,
      /no frame with id/i,
      /cannot access contents of the page/i,
    ],
  },
  {
    category: "tab_gone",
    patterns: [
      /no tab with id/i,
      /no window with id/i,
      /the tab was closed/i,
      /tabs cannot be edited right now/i,
    ],
  },
  {
    category: "native_host",
    patterns: [
      /specified native messaging host not found/i,
      /native host has exited/i,
      /access to the specified native messaging host is forbidden/i,
    ],
  },
  {
    category: "csp",
    patterns: [
      /content security policy/i,
      /refused to (?:load|execute|connect|apply)/i,
      /unsafe-eval/i,
    ],
  },
  {
    category: "user_gesture",
    patterns: [
      /must be called during a user gesture/i,
      /requires a user gesture/i,
      /user activation is required/i,
    ],
  },
  {
    category: "network",
    patterns: [
      /failed to fetch/i,
      /networkerror/i,
      /net::err_/i,
      /^load failed$/i,
      /err_internet_disconnected/i,
    ],
  },
];

/**
 * Buckets an error into an MV3 failure family. This is what turns a wall of
 * "Could not establish connection" noise into one actionable issue.
 */
export function classifyMv3(
  message: string,
  mechanism?: Mechanism,
): Mv3Category {
  if (mechanism === "sw_termination") return "sw_terminated";

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(message)) return rule.category;
    }
  }

  return "unknown";
}

/**
 * Most MV3 categories are environmental — the user closed the tab, the worker
 * was asleep, the extension just updated. Grouping them by category rather
 * than by stack keeps one issue per root cause instead of one per call site.
 */
export function isEnvironmental(category: Mv3Category): boolean {
  return (
    category === "context_invalidated" ||
    category === "no_receiver" ||
    category === "message_port_closed" ||
    category === "tab_gone"
  );
}
