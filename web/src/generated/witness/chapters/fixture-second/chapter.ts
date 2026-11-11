// SharpLadder.Content witness emitter output, grammar 1. Do not edit.

import type { ContentDoc } from "../../../content.ts";

export const witness = {
  type: "chapter",
  id: "ch-second",
  slug: "fixture-second",
  title: "Fixture Second",
  order: 2,
  targets: {
    csharp: 12,
    dotnet: 8,
  },
  intro: [
    {
      type: "paragraph",
      blockId: "intro/b1",
      content: [
        {
          type: "text",
          text: "A second chapter, so a link can name another chapter.",
        },
      ],
    },
  ],
  sections: [
    {
      id: "second-start",
      title: [
        {
          type: "text",
          text: "Where links land",
        },
      ],
      body: [
        {
          type: "paragraph",
          blockId: "second-start/b1",
          content: [
            {
              type: "text",
              text: "Links from the first fixture chapter point here.",
            },
          ],
        },
      ],
      spoken: {
        segments: [
          {
            target: {
              type: "block",
              blockId: "second-start/b1",
            },
            text: "Links from the first fixture chapter point here.",
          },
        ],
        audio:
          "sha256:436913fb5cef2db1041548f6a4fab6c10db8b55494ae19b42172ee48fd9267a5",
      },
    },
  ],
} satisfies ContentDoc;
