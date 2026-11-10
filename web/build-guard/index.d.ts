import type { Plugin } from "vite";

export function guard(options?: { worker?: boolean }): Plugin & {
  visitor: { StyleSheet(sheet: unknown): void };
  minify: Plugin;
};
