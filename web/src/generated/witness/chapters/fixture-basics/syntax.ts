// SharpLadder.Content witness emitter output, grammar 2. Do not edit.

import type { ContentDoc } from "../../../content.ts";

export const witness = {
  type: "part",
  kind: "syntax",
  chapter: "ch-fixture",
  order: 1,
  sections: [
    {
      id: "syn-fix-sum",
      number: "1.1",
      title: [
        {
          type: "text",
          text: "Sum with ",
        },
        {
          type: "code",
          text: "foreach",
        },
      ],
      body: [
        {
          type: "paragraph",
          blockId: "syn-fix-sum/b1",
          content: [
            {
              type: "text",
              text: "To add up the readings, visit each one in turn with a ",
            },
            {
              type: "term",
              id: "term-fixture-loop",
              short:
                "Code that runs the same statements again while a condition holds.",
              content: [
                {
                  type: "em",
                  content: [
                    {
                      type: "text",
                      text: "loop",
                    },
                  ],
                },
              ],
            },
            {
              type: "text",
              text: " and keep a ",
            },
            {
              type: "strong",
              content: [
                {
                  type: "text",
                  text: "running total",
                },
              ],
            },
            {
              type: "text",
              text: ".",
            },
          ],
        },
        {
          type: "code",
          blockId: "syn-fix-sum/b2",
          id: "syn-fix-sum1",
          group: "fix-sum",
          label: "Over an array",
          spoken: "Sums it",
          source:
            "int[] temps = { 18, 25, 31 };\nint sum = 0;\nforeach (int t in temps)\n    sum \u002B= t;",
        },
        {
          type: "code",
          blockId: "syn-fix-sum/b3",
          id: "syn-fix-sum2",
          group: "fix-sum",
          spoken: "Shows it",
          check: "sum == 74",
          source: "Console.WriteLine(sum);",
        },
        {
          type: "text",
          blockId: "syn-fix-sum/b4",
          id: "syn-fix-out",
          label: "Output",
          spoken: "Prints seventy-four",
          source: "74",
        },
        {
          type: "list",
          blockId: "syn-fix-sum/b5",
          ordered: true,
          start: 1,
          items: [
            {
              blockId: "syn-fix-sum/b5.i1",
              content: [
                {
                  type: "text",
                  text: "Start the total at zero.",
                },
              ],
            },
            {
              blockId: "syn-fix-sum/b5.i2",
              content: [
                {
                  type: "text",
                  text: "Add each reading on each turn of the ",
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
                  text: ".",
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          blockId: "syn-fix-sum/b6",
          content: [
            {
              type: "text",
              text: "Back to ",
            },
            {
              type: "link",
              kind: "anchor",
              id: "syn-fix-sum1",
              chapter: "ch-fixture",
              content: [
                {
                  type: "text",
                  text: "the first sum",
                },
              ],
            },
            {
              type: "text",
              text: " or ",
            },
            {
              type: "link",
              kind: "anchor",
              id: "syn-fix-sum",
              content: [
                {
                  type: "text",
                  text: "this section",
                },
              ],
            },
            {
              type: "text",
              text: ".",
            },
          ],
        },
      ],
      spoken: {
        segments: [
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b1",
            },
            text: "To add up the readings, visit each one in turn with a loop and keep a running total.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b2",
            },
            text: "Sums it",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b3",
            },
            text: "Shows it",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b4",
            },
            text: "Prints seventy-four",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b5.i1",
            },
            text: "Start the total at zero.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b5.i2",
            },
            text: "Add each reading on each turn of the loop.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b6",
            },
            text: "Back to the first sum or this section.",
          },
        ],
        audio:
          "sha256:cacb520d2134710ea202f876e9edbc85cf41223c5b47bf1ff7a2347ae8d0cb83",
      },
    },
    {
      id: "syn-fix-sizes",
      number: "1.2",
      title: [
        {
          type: "text",
          text: "Sizes in a table",
        },
      ],
      body: [
        {
          type: "paragraph",
          blockId: "syn-fix-sizes/b1",
          content: [
            {
              type: "text",
              text: "Each type takes a fixed number of bytes.",
            },
          ],
        },
        {
          type: "table",
          blockId: "syn-fix-sizes/b2",
          headers: [
            [
              {
                type: "text",
                text: "Type",
              },
            ],
            [
              {
                type: "text",
                text: "Size",
              },
            ],
          ],
          rows: [
            [
              [
                {
                  type: "code",
                  text: "int",
                },
              ],
              [
                {
                  type: "text",
                  text: "4 bytes",
                },
              ],
            ],
            [
              [
                {
                  type: "code",
                  text: "long",
                },
              ],
              [],
            ],
          ],
        },
        {
          type: "table",
          blockId: "syn-fix-sizes/b3",
          headers: [
            [],
            [
              {
                type: "text",
                text: "Meaning",
              },
            ],
          ],
          rows: [
            [
              [
                {
                  type: "text",
                  text: "a | b",
                },
              ],
              [
                {
                  type: "em",
                  content: [
                    {
                      type: "text",
                      text: "either",
                    },
                  ],
                },
                {
                  type: "text",
                  text: " one",
                },
              ],
            ],
            [
              [
                {
                  type: "text",
                  text: "repeat",
                },
              ],
              [
                {
                  type: "text",
                  text: "a ",
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
              ],
            ],
          ],
        },
        {
          type: "paragraph",
          blockId: "syn-fix-sizes/b4",
          content: [
            {
              type: "text",
              text: "Reading a variable before it has a value gives ",
            },
            {
              type: "link",
              kind: "error",
              id: "err-fixture-cs0165",
              content: [
                {
                  type: "text",
                  text: "an unassigned variable error",
                },
              ],
            },
            {
              type: "text",
              text: ".",
            },
          ],
        },
        {
          type: "walk-it",
          blockId: "syn-fix-sizes/b5",
          id: "walk-fix-shift",
          title: [
            {
              type: "text",
              text: "Shift a value with a ",
            },
            {
              type: "term",
              id: "term-fixture-loop",
              short:
                "Code that runs the same statements again while a condition holds.",
              content: [
                {
                  type: "em",
                  content: [
                    {
                      type: "text",
                      text: "loop",
                    },
                  ],
                },
              ],
            },
          ],
          cells: [4, "ab", null],
          sequences: [
            {
              name: "safe",
              introBlockId: "syn-fix-sizes/b5.1.s0",
              intro: [
                {
                  type: "text",
                  text: "Copy first, as ",
                },
                {
                  type: "link",
                  kind: "anchor",
                  id: "syn-fix-sizes",
                  content: [
                    {
                      type: "text",
                      text: "the sizes",
                    },
                  ],
                },
                {
                  type: "text",
                  text: " allow.",
                },
              ],
              steps: [
                {
                  blockId: "syn-fix-sizes/b5.1.s1",
                  dst: 2,
                  src: 1,
                  note: [
                    {
                      type: "text",
                      text: "Copy the text to the spare cell.",
                    },
                  ],
                },
                {
                  blockId: "syn-fix-sizes/b5.1.s2",
                  dst: 1,
                  value: 7,
                  note: [
                    {
                      type: "text",
                      text: "Write over the text.",
                    },
                  ],
                  lost: true,
                },
              ],
            },
            {
              name: "risky",
              introBlockId: "syn-fix-sizes/b5.2.s0",
              intro: [
                {
                  type: "text",
                  text: "Write first.",
                },
              ],
              steps: [
                {
                  blockId: "syn-fix-sizes/b5.2.s1",
                  dst: 1,
                  value: 8,
                  note: [
                    {
                      type: "text",
                      text: "The text is gone.",
                    },
                  ],
                  lost: true,
                },
              ],
            },
            {
              name: "spare",
              introBlockId: "syn-fix-sizes/b5.3.s0",
              intro: [
                {
                  type: "text",
                  text: "Copy the spare.",
                },
              ],
              steps: [
                {
                  blockId: "syn-fix-sizes/b5.3.s1",
                  dst: 0,
                  src: 2,
                  note: [
                    {
                      type: "text",
                      text: "Copy the empty cell.",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      spoken: {
        segments: [
          {
            target: {
              type: "block",
              blockId: "syn-fix-sizes/b1",
            },
            text: "Each type takes a fixed number of bytes.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sizes/b2",
            },
            text: "Columns: Type, Size. Row 1. Type: int; Size: 4 bytes. Row 2. Type: long; Size: blank.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sizes/b3",
            },
            text: "Columns: Column 1, Meaning. Row 1. Column 1: a | b; Meaning: either one. Row 2. Column 1: repeat; Meaning: a loop.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sizes/b4",
            },
            text: "Reading a variable before it has a value gives an unassigned variable error.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sizes/b5",
            },
            text: "Shift a value with a loop",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sizes/b5.1.s0",
            },
            text: "Copy first, as the sizes allow.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sizes/b5.1.s1",
            },
            text: "Copy the text to the spare cell.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sizes/b5.1.s2",
            },
            text: "Write over the text.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sizes/b5.2.s0",
            },
            text: "Write first.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sizes/b5.2.s1",
            },
            text: "The text is gone.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sizes/b5.3.s0",
            },
            text: "Copy the spare.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sizes/b5.3.s1",
            },
            text: "Copy the empty cell.",
          },
        ],
        audio:
          "sha256:54ce06f51bba06f8b1b6602247654a7a1bf998551aa1cdf7dcfdd0553285e412",
      },
    },
  ],
} satisfies ContentDoc;
