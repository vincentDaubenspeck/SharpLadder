// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { buildFixture, cleanUp } from "./build-guard/fixture.js";

afterAll(cleanUp);

// Builds the approved page whose entry imports one CSS module, with the real Vite config.
const buildWith = (moduleCss) =>
  buildFixture(
    {
      "src/main.tsx":
        'import styles from "./Card.module.css";\nconsole.log(styles);\n',
      "src/Card.module.css": `${moduleCss}\n`,
    },
    { modules: false },
  );

describe("Vite CSS module build", () => {
  it("fails on a bare element selector in pure mode", async () => {
    await expect(buildWith("a { color: red }")).rejects.toThrow(
      /should contain at least one class or ID selector/u,
    );
  });

  it("builds a module whose rules carry a local class", async () => {
    const output = [await buildWith(".card a { color: red }")].flat();
    const files = output.flatMap(({ output: chunks }) => chunks);
    const css = files.find(({ fileName }) => fileName.endsWith(".css"));
    expect(css.source).toMatch(/_card a\s*\{\s*color:\s*red/u);
  });
});
