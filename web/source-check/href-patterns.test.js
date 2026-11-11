// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  hrefModule,
  hrefPatternProblems,
  readHrefPatternProblems,
} from "./href-patterns.js";

const web = join(import.meta.dirname, "..");
const schema = (name) =>
  JSON.parse(readFileSync(join(web, "..", "content", "schema", name), "utf8"));
const href = readFileSync(join(web, hrefModule), "utf8");
const body = schema("body.schema.json");
const content = schema("content.schema.json");

// The whole-string end both files use, written once so no escaping can drift between cases.
const end = String.raw`(?![\s\S])`;

const edit = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`no anchor ${from}`);
  return text.replace(from, to);
};

describe("the href.ts literals against the schema", () => {
  it("passes the real module and schema files", () => {
    expect(readHrefPatternProblems(web)).toEqual([]);
  });

  it.each([
    [
      "a widened id length",
      `/^[a-z][a-z0-9-]{0,47}${end}/u`,
      `/^[a-z][a-z0-9-]{0,48}${end}/u`,
      /^id pattern: /u,
    ],
    [
      "an id pattern without its whole-string end",
      `/^[a-z][a-z0-9-]{0,47}${end}/u`,
      "/^[a-z][a-z0-9-]{0,47}$/u",
      /^id pattern: /u,
    ],
    [
      "a dropped id flag",
      `/^[a-z][a-z0-9-]{0,47}${end}/u;`,
      `/^[a-z][a-z0-9-]{0,47}${end}/;`,
      /^id pattern flags: /u,
    ],
    [
      "an id pattern built at run time",
      `/^[a-z][a-z0-9-]{0,47}${end}/u`,
      `new RegExp(${JSON.stringify(`^[a-z][a-z0-9-]{0,47}${end}`)}, "u")`,
      /^id pattern: href\.ts has null/u,
    ],
    [
      "a slug pattern admitting upper case",
      `/^[a-z0-9]+(-[a-z0-9]+)*${end}/u`,
      `/^[a-zA-Z0-9]+(-[a-z0-9]+)*${end}/u`,
      /^slug pattern: /u,
    ],
    [
      "a longer slug limit",
      "const slugMaxLength = 48;",
      "const slugMaxLength = 49;",
      /^slug length limit: /u,
    ],
    [
      "another chapter prefix",
      'value.startsWith("ch-")',
      'value.startsWith("c-")',
      /^chapter prefix: /u,
    ],
    [
      "a chapter check without the id pattern",
      "idPattern.test(value) && value.startsWith",
      "slugPattern.test(value) && value.startsWith",
      /^chapter check: /u,
    ],
  ])("fails %s in href.ts", (_name, from, to, reason) => {
    const problems = hrefPatternProblems(edit(href, from, to), body, content);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => reason.test(p))).toBe(true);
  });

  const changed = (object, path, value) => {
    const copy = structuredClone(object);
    let at = copy;
    for (const key of path.slice(0, -1)) at = at[key];
    at[path.at(-1)] = value;
    return copy;
  };

  it.each([
    [
      "the body id pattern",
      () => [
        changed(body, ["definitions", "id", "pattern"], "^[a-z]+$"),
        content,
      ],
      /^id pattern: /u,
    ],
    [
      "the chapterRef prefix",
      () => [
        changed(
          body,
          ["definitions", "chapterRef", "allOf", 1, "pattern"],
          "^cx-",
        ),
        content,
      ],
      /^chapter prefix: /u,
    ],
    [
      "the content chapterId prefix",
      () => [
        body,
        changed(
          content,
          ["definitions", "chapterId", "allOf", 1, "pattern"],
          "^ch",
        ),
      ],
      /^content chapter prefix: /u,
    ],
    [
      "the slug limit",
      () => [
        body,
        changed(
          content,
          ["definitions", "chapterFile", "properties", "slug", "maxLength"],
          64,
        ),
      ],
      /^slug length limit: /u,
    ],
  ])("fails a changed schema rule: %s", (_name, schemas, reason) => {
    const [b, c] = schemas();
    const problems = hrefPatternProblems(href, b, c);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(reason);
  });
});
