// SharpLadder.Content witness emitter output, grammar 1. Do not edit.

import type { ContentDoc } from "../../../content.ts";

export const witness = {
  type: "part",
  kind: "library",
  chapter: "ch-fixture",
  order: 5,
  sections: [
    {
      id: "lib-fix-one",
      number: "5.1",
      title: [
        {
          type: "text",
          text: "A library part",
        },
      ],
      body: [
        {
          type: "paragraph",
          blockId: "lib-fix-one/b1",
          content: [
            {
              type: "text",
              text: "A library part holds one plain paragraph.",
            },
          ],
        },
      ],
    },
  ],
} satisfies ContentDoc;
