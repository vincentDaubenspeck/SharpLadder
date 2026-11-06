import { execFileSync } from "node:child_process";

// Tracked files only, so untracked local notes never decide the result.
const tracked = execFileSync("git", ["ls-files", "-z", "--", "*.md"], {
  encoding: "utf8",
})
  .split("\0")
  .filter((path) => path !== "");

export default {
  config: { default: true },
  globs: tracked,
  ignores: ["**/node_modules/**"],
};
