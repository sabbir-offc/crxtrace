import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SDK_NAME, SDK_VERSION } from "../src/types";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { name: string; version: string };

describe("SDK identity", () => {
  /**
   * `SDK_VERSION` is baked into every envelope's `sdk` field and the
   * `x-crxtrace-sdk` header, so a release that bumps package.json without
   * bumping this constant would mislabel every event it ever sends.
   */
  it("reports the version this package publishes", () => {
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it("reports a name derived from the package name", () => {
    expect(SDK_NAME).toBe(`${pkg.name}-js`);
  });
});
