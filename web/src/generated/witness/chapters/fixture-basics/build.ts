// SharpLadder.Content witness emitter output, grammar 1. Do not edit.

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
        ],
        audio:
          "sha256:dc9e39fbd2ba71966a85fe1ee9a8c62773ea0de7fffaec2f34b4715752d90701",
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
        ],
        audio:
          "sha256:7a2343c7d8aa73b4c94faa531afa23f9a5c16c827e80f24cd9cb33a0fac519eb",
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
