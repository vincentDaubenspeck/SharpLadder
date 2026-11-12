import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { guard } from "./build-guard/index.js";

const buildGuard = guard();

export default defineConfig({
  // The guard's C2 minifier is post-enforced, so Vite sorts it after the core plugins.
  plugins: [buildGuard, react(), buildGuard.minify],
  // Caches stay out of node_modules, where the install-health census admits no tool files.
  cacheDir: ".cache/vite",
  // Nothing is copied into the build unchecked.
  publicDir: false,
  // One stylesheet, no inlined assets and no maps, as the guard's output admission requires.
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    sourcemap: false,
    // Unminified output keeps every literal where the provenance check can find it.
    cssMinify: false,
    cssTarget: ["chrome156", "edge155", "firefox158", "safari26", "ios26"],
    rolldownOptions: {
      output: {
        // Font paths are fixed by name so the inventory can state them.
        assetFileNames: (asset) =>
          asset.names[0]?.endsWith(".woff2")
            ? "assets/[name][extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  // Agent detection must not change the pipeline.
  server: { forwardConsole: false },
  // The source never starts a worker, so any worker bundle fails the build.
  worker: { plugins: () => [guard({ worker: true })] },
  css: {
    transformer: "lightningcss",
    // Pure mode fails the build on a module rule without a local class or id; the class-name
    // pattern is Lightning CSS's default, stated so the contract can pin it.
    lightningcss: {
      cssModules: { pure: true, pattern: "[hash]_[local]" },
      // A rule Lightning CSS cannot parse fails the build instead of being dropped.
      errorRecovery: false,
      // C1: the guard's own visitor matches every compile input to its bound source.
      visitor: buildGuard.visitor,
      // The caniuse-lite 1.0.30001822 floors, as Lightning CSS version integers.
      targets: {
        chrome: 10223616,
        edge: 10158080,
        firefox: 10354688,
        safari: 1703936,
        ios_saf: 1703936,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // The round trip takes its records only from this setup, and the acceptance run requires
    // every record-backed case to pass.
    globalSetup: ["./content-check/global-setup.ts"],
    fsModuleCachePath: ".cache/vitest",
    // Tests run the build guard in each forked worker, which inherits none of the runner's own
    // startup flags; a thread pool would refuse this V8 flag outright.
    pool: "forks",
    execArgv: ["--no-concurrent-array-buffer-sweeping"],
  },
});
