// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { webStages } from "../../tools/checks/web.mjs";
import { eslintCoverage } from "../source-check/coverage.js";

const web = join(import.meta.dirname, "..");

const launchText = (text) =>
  /^(npx\s+)?eslint(\.cmd|\.js)?(\s|$)/u.test(text) ||
  /node_modules[\\/](\.bin[\\/])?eslint(?![\w-])|eslint[\\/]bin\b/u.test(text);

describe("the production lint launch sites", () => {
  const { scripts: npm } = JSON.parse(
    readFileSync(join(web, "package.json"), "utf8"),
  );
  const command =
    /(^|[;&|(`]|\$\(|\brun:)\s*((npx|npm\s+(exec|x))\s+(-\S+\s+)*)?eslint(?![\w.-])/mu;

  it("runs the application lint only through the bound lint command", () => {
    expect(npm.lint).toBe("node lint-application.js");
    expect(
      Object.entries(npm).filter(
        ([, line]) => command.test(line) || launchText(line),
      ),
    ).toEqual([]);
    for (const name of ["build", "check"])
      expect(npm[name]).toMatch(/(^|&& )npm run lint( &&|$)/u);
    expect(webStages).toContainEqual(["ESLint", "lint"]);
  });
});

describe("lint check argument validation", () => {
  it("refuses an unknown parser option", async () => {
    await expect(eslintCoverage(web, [], { parser: {} })).rejects.toThrow(
      "eslintCoverage: unknown parser option parser",
    );
  });
});
