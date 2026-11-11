// SharpLadder.Content witness emitter output, grammar 1. Do not edit.

import type { ContentDoc } from "../../../content.ts";

export const witness = {
  type: "chapter",
  id: "ch-empty-intro",
  slug: "fixture-empty-intro",
  title: "Fixture Empty Intro",
  order: 3,
  targets: {
    csharp: 12,
    dotnet: 8,
  },
  intro: [],
  sections: [
    {
      id: "empty-intro-only",
      title: [
        {
          type: "text",
          text: "The only section",
        },
      ],
      body: [
        {
          type: "paragraph",
          blockId: "empty-intro-only/b1",
          content: [
            {
              type: "text",
              text: "This chapter has no intro blocks before its first section.",
            },
          ],
        },
      ],
    },
  ],
} satisfies ContentDoc;
