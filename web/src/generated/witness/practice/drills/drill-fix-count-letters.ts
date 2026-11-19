// SharpLadder.Content witness emitter output, grammar 2. Do not edit.

import type { ContentDoc } from "../../../content.ts";

export const witness = {
  type: "drill",
  id: "drill-fix-count-letters",
  chapter: "ch-fixture",
  rung: "warm-up",
  title: "Count the letters of a word",
  move: "Count with a loop and a test on each character",
  ideas: ["term-fixture-loop"],
  prerequisites: [],
  prepares: ["prob-9001"],
  variationOf: null,
  ladders: ["ladder-lone-word", "ladder-lone-word-alt"],
  statement: [
    {
      type: "paragraph",
      blockId: "drill-fix-count-letters/statement/b1",
      content: [
        {
          type: "text",
          text: "Given a word, count the characters in it that are letters.",
        },
      ],
    },
  ],
  examples: [
    {
      type: "text",
      blockId: "drill-fix-count-letters/examples/b1",
      spoken: "a1 b gives 2",
      source: "a1 b gives 2",
    },
  ],
  constraints: [
    {
      type: "list",
      blockId: "drill-fix-count-letters/constraints/b1",
      ordered: false,
      items: [
        {
          blockId: "drill-fix-count-letters/constraints/b1.i1",
          content: [
            {
              type: "text",
              text: "The word holds at most 100 characters.",
            },
          ],
        },
      ],
    },
  ],
  starter: {
    id: "drill-fix-count-letters-starter",
    spoken: "The method to fill in",
    source:
      "using System;\n\npublic static class Solution\n{\n    public static int CountLetters(string word) =\u003E\n        throw new NotImplementedException();\n}",
  },
  spoken: {
    segments: [
      {
        target: {
          type: "block",
          blockId: "drill-fix-count-letters/statement/b1",
        },
        text: "Given a word, count the characters in it that are letters.",
      },
      {
        target: {
          type: "block",
          blockId: "drill-fix-count-letters/examples/b1",
        },
        text: "a1 b gives 2",
      },
      {
        target: {
          type: "block",
          blockId: "drill-fix-count-letters/constraints/b1.i1",
        },
        text: "The word holds at most 100 characters.",
      },
    ],
    audio:
      "sha256:cc53b4e8689f7c2b9b006d7fbeb5ba739f4206f4f70bf7def5bb28ffffe436fb",
  },
  tests: {
    text: "using System;\n\nvar failed = 0;\nCheck(\u0022counts every letter\u0022, () =\u003E Solution.CountLetters(\u0022cat\u0022) == 3);\nCheck(\u0022skips digits and spaces\u0022, () =\u003E Solution.CountLetters(\u0022a1 b\u0022) == 2);\nCheck(\u0022edge: an empty word has no letters\u0022, () =\u003E Solution.CountLetters(\u0022\u0022) == 0);\nreturn failed == 0 ? 0 : 1;\n\n// Each check runs alone, so one that throws fails and the rest still report.\nvoid Check(string name, Func\u003Cbool\u003E test)\n{\n    var passed = false;\n    try\n    {\n        passed = test();\n    }\n    catch (Exception)\n    {\n        passed = false;\n    }\n\n    Console.WriteLine((passed ? \u0022#check pass \u0022 : \u0022#check fail \u0022) \u002B name);\n    failed \u002B= passed ? 0 : 1;\n}\n",
    version: 1,
    hash: "sha256:ee1aa71d772a312d33984927cc2fd045a3aeb89c929f3a5ef1feba4a6bb37098",
    count: 3,
    review: [],
  },
} satisfies ContentDoc;
