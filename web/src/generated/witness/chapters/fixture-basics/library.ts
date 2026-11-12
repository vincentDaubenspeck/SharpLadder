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
      spoken: {
        segments: [
          {
            target: {
              type: "block",
              blockId: "lib-fix-one/b1",
            },
            text: "A library part holds one plain paragraph.",
          },
        ],
        audio:
          "sha256:c3965a036726aac739905bc7aacdc6556097dac7d9e0a2e9525cd7280f15cc11",
      },
    },
    {
      id: "lib-fix-composed",
      number: "5.2",
      title: [
        {
          type: "text",
          text: "Text that arrives decomposed",
        },
      ],
      body: [
        {
          type: "paragraph",
          blockId: "lib-fix-composed/b1",
          content: [
            {
              type: "text",
              text: "A cafe\u0301 spelled with a combining mark, and one where the mark follows ",
            },
            {
              type: "em",
              content: [
                {
                  type: "text",
                  text: "e",
                },
              ],
            },
            {
              type: "text",
              text: "\u0301 across a span.",
            },
          ],
        },
        {
          type: "list",
          blockId: "lib-fix-composed/b2",
          ordered: false,
          items: [
            {
              blockId: "lib-fix-composed/b2.i1",
              content: [
                {
                  type: "text",
                  text: "An item with ",
                },
                {
                  type: "code",
                  text: "code",
                },
                {
                  type: "text",
                  text: " and a link to ",
                },
                {
                  type: "link",
                  kind: "anchor",
                  id: "lib-fix-one",
                  content: [
                    {
                      type: "text",
                      text: "the first section",
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
              blockId: "lib-fix-composed/b2.i2",
              content: [
                {
                  type: "text",
                  text: "A second item, on two lines.",
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
              blockId: "lib-fix-composed/b1",
            },
            text: "A caf\u00E9 spelled with a combining mark, and one where the mark follows \u00E9 across a span.",
          },
          {
            target: {
              type: "block",
              blockId: "lib-fix-composed/b2.i1",
            },
            text: "An item with code and a link to the first section.",
          },
          {
            target: {
              type: "block",
              blockId: "lib-fix-composed/b2.i2",
            },
            text: "A second item, on two lines.",
          },
        ],
        audio:
          "sha256:f8b76fa6160a06383ad9ebe53ef65af440aecc2b64e1c1bc04af75912c7056cc",
      },
    },
    {
      id: "lib-fix-skipped",
      number: "5.3",
      title: [
        {
          type: "text",
          text: "Summarised",
        },
      ],
      body: [
        {
          type: "paragraph",
          blockId: "lib-fix-skipped/b1",
          content: [
            {
              type: "text",
              text: "This paragraph is shown but never spoken.",
            },
          ],
        },
      ],
      spoken: {
        segments: [
          {
            target: {
              type: "section",
              sectionId: "lib-fix-skipped",
            },
            text: "A summary stands in.",
          },
        ],
        audio:
          "sha256:bbd1b07bd99c68214304d95a8ef08b3f2e75b8ad9b2b1035da1b8a5fee5ca882",
      },
    },
  ],
} satisfies ContentDoc;
