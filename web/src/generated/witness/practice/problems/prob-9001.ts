// SharpLadder.Content witness emitter output, grammar 2. Do not edit.

import type { ContentDoc } from "../../../content.ts";

export const witness = {
  type: "problem",
  id: "prob-9001",
  chapter: "ch-fixture",
  number: 9001,
  link: "https://example.com/fixture-problem-9001",
  title: "Matching ends",
  patternTags: ["pat-fixture-two-pass"],
  ladders: ["ladder-lone-word", "ladder-lone-word-alt"],
  statement: [
    {
      type: "paragraph",
      blockId: "prob-9001/statement/b1",
      content: [
        {
          type: "text",
          text: "Given a list of words, count the words whose first letter is also their last letter.",
        },
      ],
    },
  ],
  examples: [
    {
      type: "text",
      blockId: "prob-9001/examples/b1",
      spoken: "level, noon and cat give 2",
      source: "[level, noon, cat] gives 2",
    },
  ],
  constraints: [
    {
      type: "list",
      blockId: "prob-9001/constraints/b1",
      ordered: false,
      items: [
        {
          blockId: "prob-9001/constraints/b1.i1",
          content: [
            {
              type: "text",
              text: "Every word holds at least one letter.",
            },
          ],
        },
        {
          blockId: "prob-9001/constraints/b1.i2",
          content: [
            {
              type: "text",
              text: "The list holds at most 100 words.",
            },
          ],
        },
      ],
    },
  ],
  starter: {
    id: "prob-9001-starter",
    spoken: "The method to fill in",
    source:
      "using System;\n\npublic static class Solution\n{\n    public static int CountMatchingEnds(string[] words) =\u003E\n        throw new NotImplementedException();\n}",
  },
  spoken: {
    segments: [
      {
        target: {
          type: "block",
          blockId: "prob-9001/statement/b1",
        },
        text: "Given a list of words, count the words whose first letter is also their last letter.",
      },
      {
        target: {
          type: "block",
          blockId: "prob-9001/examples/b1",
        },
        text: "level, noon and cat give 2",
      },
      {
        target: {
          type: "block",
          blockId: "prob-9001/constraints/b1.i1",
        },
        text: "Every word holds at least one letter.",
      },
      {
        target: {
          type: "block",
          blockId: "prob-9001/constraints/b1.i2",
        },
        text: "The list holds at most 100 words.",
      },
    ],
    audio:
      "sha256:7da8f3ee99b763ff36699cb29be0bce237d9652e2e2d75706c0e8b1c91b8bab3",
  },
  tests: {
    text: "using System;\n\nvar failed = 0;\nCheck(\u0022counts words with matching ends\u0022,\n    () =\u003E Solution.CountMatchingEnds([\u0022level\u0022, \u0022noon\u0022, \u0022cat\u0022]) == 2);\nCheck(\u0022counts one-letter words\u0022,\n    () =\u003E Solution.CountMatchingEnds([\u0022a\u0022, \u0022be\u0022]) == 1);\nCheck(\u0022counts a single word\u0022,\n    () =\u003E Solution.CountMatchingEnds([\u0022wow\u0022]) == 1);\nCheck(\u0022returns zero for no words\u0022,\n    () =\u003E Solution.CountMatchingEnds([]) == 0);\nreturn failed == 0 ? 0 : 1;\n\n// Each check runs alone, so one that throws fails and the rest still report.\nvoid Check(string name, Func\u003Cbool\u003E test)\n{\n    var passed = false;\n    try\n    {\n        passed = test();\n    }\n    catch (Exception)\n    {\n        passed = false;\n    }\n\n    Console.WriteLine((passed ? \u0022#check pass \u0022 : \u0022#check fail \u0022) \u002B name);\n    failed \u002B= passed ? 0 : 1;\n}\n",
    version: 1,
    hash: "sha256:07a43679a130465756e338e92a3b89734a905089c7994ea5ae3781cfedf89e67",
    count: 4,
    review: [
      {
        check: "counts one-letter words",
        sectionId: "ramp-fix-easy",
        label: "Count one more",
        walkId: "walk-fix-easy",
      },
    ],
  },
} satisfies ContentDoc;
