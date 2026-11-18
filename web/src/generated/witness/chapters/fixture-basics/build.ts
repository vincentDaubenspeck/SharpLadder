// SharpLadder.Content witness emitter output, grammar 2. Do not edit.

import type { ContentDoc } from "../../../content.ts";

export const witness = {
  type: "part",
  kind: "build",
  chapter: "ch-fixture",
  order: 3,
  sections: [
    {
      id: "build-fix-nest",
      number: "3.1",
      title: [
        {
          type: "text",
          text: "Nested emphasis",
        },
      ],
      body: [
        {
          type: "paragraph",
          blockId: "build-fix-nest/b1",
          content: [
            {
              type: "text",
              text: "Spans nest: ",
            },
            {
              type: "em",
              content: [
                {
                  type: "text",
                  text: "outer ",
                },
                {
                  type: "strong",
                  content: [
                    {
                      type: "text",
                      text: "middle ",
                    },
                    {
                      type: "em",
                      content: [
                        {
                          type: "text",
                          text: "inner",
                        },
                      ],
                    },
                    {
                      type: "text",
                      text: " middle",
                    },
                  ],
                },
                {
                  type: "text",
                  text: " outer",
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
          blockId: "build-fix-nest/b2",
          id: "walk-fix-nest",
          title: [
            {
              type: "text",
              text: "Replace a word",
            },
          ],
          cells: ["old"],
          sequences: [
            {
              name: "once",
              introBlockId: "build-fix-nest/b2.1.s0",
              intro: [
                {
                  type: "text",
                  text: "The cell holds a word.",
                },
              ],
              steps: [
                {
                  blockId: "build-fix-nest/b2.1.s1",
                  dst: 0,
                  value: "new",
                  note: [
                    {
                      type: "text",
                      text: "A new word takes its place.",
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
              blockId: "build-fix-nest/b1",
            },
            text: "Spans nest: outer middle inner middle outer.",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-nest/b2",
            },
            text: "Replace a word",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-nest/b2.1.s0",
            },
            text: "The cell holds a word.",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-nest/b2.1.s1",
            },
            text: "A new word takes its place.",
          },
        ],
        audio:
          "sha256:d60f80529f749c565a41740e47843a2f44d2e3c6d19cb2c69f09ac3ace097b7e",
      },
    },
    {
      id: "build-fix-total",
      number: "3.2",
      title: [
        {
          type: "text",
          text: "Two ways to total",
        },
      ],
      body: [
        {
          type: "paragraph",
          blockId: "build-fix-total/b1",
          content: [
            {
              type: "text",
              text: "Both ways add the same numbers; pick one to read.",
            },
          ],
        },
      ],
      approaches: [
        {
          id: "build-fix-loop",
          title: [
            {
              type: "text",
              text: "Add them in a loop",
            },
          ],
          label: "a loop",
          body: [
            {
              type: "paragraph",
              blockId: "build-fix-total/b2",
              content: [
                {
                  type: "text",
                  text: "Walk the numbers and keep a running total.",
                },
              ],
            },
            {
              type: "code",
              blockId: "build-fix-total/b3",
              id: "build-fix-loop1",
              group: "fix-loop",
              spoken: "Adds each number to the total",
              source: "foreach (var n in numbers) total \u002B= n;",
            },
          ],
        },
        {
          id: "build-fix-sum",
          title: [
            {
              type: "text",
              text: "Ask the library",
            },
          ],
          label: "the library",
          body: [
            {
              type: "list",
              blockId: "build-fix-total/b4",
              ordered: false,
              items: [
                {
                  blockId: "build-fix-total/b4.i1",
                  content: [
                    {
                      type: "text",
                      text: "One call does the walk.",
                    },
                  ],
                },
                {
                  blockId: "build-fix-total/b4.i2",
                  content: [
                    {
                      type: "text",
                      text: "The result is the same.",
                    },
                  ],
                },
              ],
            },
            {
              type: "table",
              blockId: "build-fix-total/b5",
              headers: [
                [
                  {
                    type: "text",
                    text: "Call",
                  },
                ],
                [
                  {
                    type: "text",
                    text: "Result",
                  },
                ],
              ],
              rows: [
                [
                  [
                    {
                      type: "text",
                      text: "Sum",
                    },
                  ],
                  [
                    {
                      type: "text",
                      text: "74",
                    },
                  ],
                ],
                [
                  [
                    {
                      type: "text",
                      text: "Each",
                    },
                  ],
                  [
                    {
                      type: "text",
                      text: "one ",
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
              type: "walk-it",
              blockId: "build-fix-total/b6",
              id: "walk-fix-sum",
              title: [
                {
                  type: "text",
                  text: "Store the total",
                },
              ],
              cells: [0],
              sequences: [
                {
                  name: "once",
                  introBlockId: "build-fix-total/b6.1.s0",
                  intro: [
                    {
                      type: "text",
                      text: "The total starts at zero.",
                    },
                  ],
                  steps: [
                    {
                      blockId: "build-fix-total/b6.1.s1",
                      dst: 0,
                      value: 74,
                      note: [
                        {
                          type: "text",
                          text: "The call stores the whole total at once.",
                        },
                      ],
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
              blockId: "build-fix-total/b1",
            },
            text: "Both ways add the same numbers; pick one to read.",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-total/b2",
            },
            text: "Approach: a loop. Walk the numbers and keep a running total.",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-total/b3",
            },
            text: "Adds each number to the total",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-total/b4.i1",
            },
            text: "Approach: the library. One call does the walk.",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-total/b4.i2",
            },
            text: "The result is the same.",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-total/b5",
            },
            text: "Columns: Call, Result. Row 1. Call: Sum; Result: 74. Row 2. Call: Each; Result: one loop.",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-total/b6",
            },
            text: "Store the total",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-total/b6.1.s0",
            },
            text: "The total starts at zero.",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-total/b6.1.s1",
            },
            text: "The call stores the whole total at once.",
          },
        ],
        audio:
          "sha256:1df3c88522146dad018484d7ebd77ee4688b22d15c0783f0d3f87c1eca4d0e0d",
      },
    },
    {
      id: "build-fix-three",
      number: "3.3",
      title: [
        {
          type: "text",
          text: "Three ways with no lead",
        },
      ],
      body: [],
      approaches: [
        {
          id: "build-fix-first",
          title: [
            {
              type: "text",
              text: "First",
            },
          ],
          label: "first",
          body: [
            {
              type: "paragraph",
              blockId: "build-fix-three/b1",
              content: [
                {
                  type: "text",
                  text: "Only a paragraph, with ",
                },
                {
                  type: "link",
                  kind: "anchor",
                  id: "build-fix-nest",
                  content: [
                    {
                      type: "text",
                      text: "a link",
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
          id: "build-fix-second",
          title: [
            {
              type: "text",
              text: "Second",
            },
          ],
          label: "second, with a comma",
          body: [
            {
              type: "text",
              blockId: "build-fix-three/b2",
              id: "build-fix-second1",
              spoken: "A note for the second way",
              source: "second",
            },
          ],
        },
        {
          id: "build-fix-third",
          title: [
            {
              type: "text",
              text: "Third?",
            },
          ],
          label: "third",
          body: [
            {
              type: "paragraph",
              blockId: "build-fix-three/b3",
              content: [
                {
                  type: "text",
                  text: "The last one.",
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
              blockId: "build-fix-three/b1",
            },
            text: "Approach: first. Only a paragraph, with a link.",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-three/b2",
            },
            text: "Approach: second, with a comma. A note for the second way",
          },
          {
            target: {
              type: "block",
              blockId: "build-fix-three/b3",
            },
            text: "Approach: third. The last one.",
          },
        ],
        audio:
          "sha256:b0b2a67e2ebdee4308a62b5ef10795178c0b2a06b81903b38cfaad7a64b9f677",
      },
    },
  ],
} satisfies ContentDoc;
