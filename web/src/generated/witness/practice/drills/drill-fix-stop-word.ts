// SharpLadder.Content witness emitter output, grammar 2. Do not edit.

import type { ContentDoc } from "../../../content.ts";

export const witness = {
  type: "drill",
  id: "drill-fix-stop-word",
  chapter: "ch-fixture",
  rung: "foundations",
  title: "Read words until a stop word",
  move: "Repeat while a condition holds",
  ideas: ["term-fixture-loop"],
  prerequisites: [],
  prepares: [],
  variationOf: null,
  ladders: ["ladder-lone-word"],
  statement: [
    {
      type: "paragraph",
      blockId: "drill-fix-stop-word/statement/b1",
      content: [
        {
          type: "text",
          text: "Given a list of words and a stop word, use a ",
        },
        {
          type: "term",
          id: "term-fixture-loop",
          short:
            "Code that runs the same statements again while a condition holds.",
          content: [
            {
              type: "text",
              text: "loop",
            },
          ],
        },
        {
          type: "text",
          text: " to count the words that come before the stop word.",
        },
      ],
    },
  ],
  examples: [
    {
      type: "text",
      blockId: "drill-fix-stop-word/examples/b1",
      spoken: "red, blue, stop and green give 2",
      source: "[red, blue, stop, green] gives 2",
    },
  ],
  constraints: [
    {
      type: "list",
      blockId: "drill-fix-stop-word/constraints/b1",
      ordered: false,
      items: [
        {
          blockId: "drill-fix-stop-word/constraints/b1.i1",
          content: [
            {
              type: "text",
              text: "Without the stop word, every word counts.",
            },
          ],
        },
      ],
    },
  ],
  starter: {
    id: "drill-fix-stop-word-starter",
    spoken: "The method to fill in",
    source:
      "using System;\n\npublic static class Solution\n{\n    public static int WordsBeforeStop(string[] words, string stop) =\u003E\n        throw new NotImplementedException();\n}",
  },
  spoken: {
    segments: [
      {
        target: {
          type: "block",
          blockId: "drill-fix-stop-word/statement/b1",
        },
        text: "Given a list of words and a stop word, use a loop to count the words that come before the stop word.",
      },
      {
        target: {
          type: "block",
          blockId: "drill-fix-stop-word/examples/b1",
        },
        text: "red, blue, stop and green give 2",
      },
      {
        target: {
          type: "block",
          blockId: "drill-fix-stop-word/constraints/b1.i1",
        },
        text: "Without the stop word, every word counts.",
      },
    ],
    audio:
      "sha256:a9dee5811cb3aa56b268dc80b0b3d6524634ec929a4eb892807323c78194f1fe",
  },
  tests: {
    text: "using System;\n\nvar failed = 0;\nCheck(\u0022stops at the stop word\u0022,\n    () =\u003E Solution.WordsBeforeStop([\u0022red\u0022, \u0022blue\u0022, \u0022stop\u0022, \u0022green\u0022], \u0022stop\u0022) == 2);\nCheck(\u0022reads every word without a stop word\u0022,\n    () =\u003E Solution.WordsBeforeStop([\u0022red\u0022, \u0022blue\u0022], \u0022stop\u0022) == 2);\nCheck(\u0022edge: no words reads none\u0022, () =\u003E Solution.WordsBeforeStop([], \u0022stop\u0022) == 0);\nreturn failed == 0 ? 0 : 1;\n\n// Each check runs alone, so one that throws fails and the rest still report.\nvoid Check(string name, Func\u003Cbool\u003E test)\n{\n    var passed = false;\n    try\n    {\n        passed = test();\n    }\n    catch (Exception)\n    {\n        passed = false;\n    }\n\n    Console.WriteLine((passed ? \u0022#check pass \u0022 : \u0022#check fail \u0022) \u002B name);\n    failed \u002B= passed ? 0 : 1;\n}\n",
    version: 1,
    hash: "sha256:e7b86d293dd33648e8f006396859a4d7524359938ee827e895d5a7b3ac0aae6b",
    count: 3,
    review: [],
  },
} satisfies ContentDoc;
