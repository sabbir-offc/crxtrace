import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    target: "es2020",
    sourcemap: true,
  },
  {
    // Single-file IIFE build for extensions with no bundler.
    // Load with <script src="crxtrace.global.js"> or importScripts() and use window.CrxTrace.
    // tsup appends ".global" for the iife format, so this emits
    // dist/crxtrace.global.js — the path package.json exports.
    entry: { crxtrace: "src/index.ts" },
    format: ["iife"],
    globalName: "CrxTrace",
    target: "es2020",
    minify: true,
    sourcemap: false,
    dts: false,
    clean: false,
  },
]);
