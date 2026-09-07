import { describe, expect, it } from "vitest";
import { classifyMv3, isEnvironmental } from "../src/classify";
import { redact } from "../src/redact";
import { deriveCulprit, describeError, normalizeFile, parseStack } from "../src/stacktrace";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";

describe("classifyMv3", () => {
  const cases: [string, string][] = [
    ["Extension context invalidated.", "context_invalidated"],
    [
      "Could not establish connection. Receiving end does not exist.",
      "no_receiver",
    ],
    [
      "The message port closed before a response was received.",
      "message_port_closed",
    ],
    ["Resource::kQuotaBytes quota exceeded", "storage_quota"],
    ["Cannot access contents of the page", "permission_denied"],
    ["No tab with id: 42", "tab_gone"],
    ["Failed to fetch", "network"],
    ["something nobody has ever seen", "unknown"],
  ];

  for (const [message, expected] of cases) {
    it(`buckets "${message.slice(0, 40)}" as ${expected}`, () => {
      expect(classifyMv3(message)).toBe(expected);
    });
  }

  it("treats a termination mechanism as sw_terminated regardless of text", () => {
    expect(classifyMv3("anything at all", "sw_termination")).toBe("sw_terminated");
  });

  it("marks environmental categories so they group by cause", () => {
    expect(isEnvironmental("no_receiver")).toBe(true);
    expect(isEnvironmental("unknown")).toBe(false);
  });
});

describe("stack normalization", () => {
  it("rewrites the extension origin so installs group together", () => {
    // Every user has a different extension id in dev; without this, one bug
    // becomes one issue per install.
    expect(normalizeFile(`chrome-extension://${EXT_ID}/background.js`)).toBe(
      "app:///background.js",
    );
  });

  it("parses a chromium stack into frames", () => {
    const stack = [
      "TypeError: x is not a function",
      `    at handleMessage (chrome-extension://${EXT_ID}/sw.js:120:15)`,
      `    at chrome-extension://${EXT_ID}/sw.js:44:3`,
      "    at https://example.com/page.js:9:1",
    ].join("\n");

    const frames = parseStack(stack);

    expect(frames).toHaveLength(3);
    expect(frames[0]).toMatchObject({
      function: "handleMessage",
      file: "app:///sw.js",
      line: 120,
      column: 15,
      inApp: true,
    });
    // Page scripts are not ours.
    expect(frames[2]?.inApp).toBe(false);
  });

  it("derives a culprit from the first in-app frame", () => {
    const frames = parseStack(
      [
        "Error: nope",
        "    at https://cdn.example.com/vendor.js:1:1",
        `    at doWork (chrome-extension://${EXT_ID}/worker.js:12:4)`,
      ].join("\n"),
    );

    expect(deriveCulprit(frames)).toBe("doWork (worker.js:12)");
  });
});

describe("describeError", () => {
  it("handles a thrown Error", () => {
    const result = describeError(new RangeError("out of range"));
    expect(result).toMatchObject({ type: "RangeError", message: "out of range" });
  });

  it("handles a rejected plain object", () => {
    // `reject({ ok: false })` is everywhere in extension code.
    const result = describeError({ ok: false, code: 7 });
    expect(result.type).toBe("UnknownError");
    expect(result.message).toContain("code");
  });

  it("handles a thrown string", () => {
    expect(describeError("just a string")).toMatchObject({
      type: "Error",
      message: "just a string",
    });
  });
});

describe("redact", () => {
  it("removes emails, JWTs, and api keys", () => {
    const input = {
      message:
        "failed for sam@example.com with eyJhbGciOiJIUzI1NiJ9.abcdefghij.signature",
      key: "sk_live_1234567890abcdef",
    };

    const output = redact(input);

    expect(output.message).not.toContain("sam@example.com");
    expect(output.message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(output.key).toBe("[redacted]");
  });

  it("keeps a query parameter's name but drops its value", () => {
    const output = redact({ url: "https://x.test/cb?token=supersecretvalue&page=2" });

    expect(output.url).toContain("?token=[redacted]");
    expect(output.url).not.toContain("supersecretvalue");
    expect(output.url).toContain("page=2");
  });

  it("drops values under sensitive keys at any depth", () => {
    const output = redact({ a: { b: { password: "hunter2", safe: "keep" } } });

    expect(output.a.b.password).toBe("[redacted]");
    expect(output.a.b.safe).toBe("keep");
  });

  it("survives circular structures", () => {
    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular;

    expect(() => redact(circular)).not.toThrow();
  });

  it("applies caller-supplied patterns", () => {
    const output = redact({ note: "internal-code-4242" }, [/internal-code-\d+/]);
    expect(output.note).toBe("[redacted]");
  });
});
