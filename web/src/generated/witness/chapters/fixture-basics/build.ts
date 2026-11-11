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
  ],
} satisfies ContentDoc;
