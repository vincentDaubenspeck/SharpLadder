// SharpLadder.Content witness emitter output, grammar 2. Do not edit.

import type { ContentDoc } from "../../../content.ts";

export const witness = {
  type: "chapter",
  id: "ch-no-sections",
  slug: "fixture-no-sections",
  title: "Fixture No Sections",
  order: 4,
  targets: {
    csharp: 14,
    dotnet: 10,
  },
  intro: [
    {
      type: "paragraph",
      blockId: "intro/b1",
      content: [
        {
          type: "text",
          text: "This chapter has an intro and no sections.",
        },
      ],
    },
  ],
  sections: [],
} satisfies ContentDoc;
