import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { guard } from "./build-guard/index.js";

export default defineConfig({
  plugins: [guard(), react()],
  // Caches stay out of node_modules, where the install-health census admits no tool files.
  cacheDir: ".cache/vite",
  // Nothing is copied into the build unchecked.
  publicDir: false,
  // One stylesheet, no inlined assets and no maps, as the guard's output admission requires.
  build: { cssCodeSplit: false, assetsInlineLimit: 0, sourcemap: false },
  // Agent detection must not change the pipeline.
  server: { forwardConsole: false },
  // The source never starts a worker, so any worker bundle fails the build.
  worker: { plugins: () => [guard({ worker: true })] },
  css: {
    transformer: "lightningcss",
    // Pure mode fails the build on a module rule without a local class or id.
    lightningcss: { cssModules: { pure: true } },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    fsModuleCachePath: ".cache/vitest",
  },
});
