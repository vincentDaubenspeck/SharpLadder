// SharpLadder.Content witness emitter output, grammar 1. Do not edit.

import type { ContentDoc } from "../../../content.ts";

export const witness = {
  type: "part",
  kind: "cards",
  chapter: "ch-fixture",
  order: 6,
  sections: [
    {
      id: "cards-fix-all",
      number: "6.1",
      title: [
        {
          type: "text",
          text: "Cards with every field",
        },
      ],
      cards: [
        {
          id: "card-fix-tally",
          title: [
            {
              type: "text",
              text: "Tally words by key",
            },
          ],
          reach: {
            type: "paragraph",
            blockId: "cards-fix-all/b1",
            content: [
              {
                type: "text",
                text: "A ",
              },
              {
                type: "code",
                text: "Dictionary\u003Cstring, int\u003E",
              },
              {
                type: "text",
                text: " read with ",
              },
              {
                type: "code",
                text: "GetValueOrDefault",
              },
              {
                type: "text",
                text: ".",
              },
            ],
          },
          build: {
            type: "code",
            blockId: "cards-fix-all/b2",
            id: "tally-fix-code1",
            group: "fix-tally",
            spoken: "Adds one to the count of a word",
            source: "counts[word] = counts.GetValueOrDefault(word) \u002B 1;",
          },
          why: [
            {
              type: "paragraph",
              blockId: "cards-fix-all/b3",
              content: [
                {
                  type: "text",
                  text: "An array needs every key known ",
                },
                {
                  type: "em",
                  content: [
                    {
                      type: "text",
                      text: "before",
                    },
                  ],
                },
                {
                  type: "text",
                  text: " the first count.",
                },
              ],
            },
            {
              type: "list",
              blockId: "cards-fix-all/b4",
              ordered: false,
              items: [
                {
                  blockId: "cards-fix-all/b4.i1",
                  content: [
                    {
                      type: "text",
                      text: "The keys arrive in any order.",
                    },
                  ],
                },
                {
                  blockId: "cards-fix-all/b4.i2",
                  content: [
                    {
                      type: "text",
                      text: "A missing key reads as zero.",
                    },
                  ],
                },
              ],
            },
            {
              type: "table",
              blockId: "cards-fix-all/b5",
              headers: [
                [
                  {
                    type: "text",
                    text: "Word",
                  },
                ],
                [
                  {
                    type: "text",
                    text: "Count",
                  },
                ],
              ],
              rows: [
                [
                  [
                    {
                      type: "term",
                      id: "term-fixture-set",
                      short:
                        "A collection of unique values with fast \u0022is it here?\u0022 checks.",
                      content: [
                        {
                          type: "text",
                          text: "set",
                        },
                      ],
                    },
                  ],
                  [
                    {
                      type: "text",
                      text: "2",
                    },
                  ],
                ],
              ],
            },
          ],
          traps: {
            type: "list",
            blockId: "cards-fix-all/b6",
            ordered: false,
            items: [
              {
                blockId: "cards-fix-all/b6.i1",
                content: [
                  {
                    type: "text",
                    text: "Reading a missing key with the indexer throws.",
                  },
                ],
              },
              {
                blockId: "cards-fix-all/b6.i2",
                content: [
                  {
                    type: "text",
                    text: "A key differs by case unless a comparer says otherwise.",
                  },
                ],
              },
            ],
          },
          also: {
            type: "list",
            blockId: "cards-fix-all/b7",
            ordered: false,
            items: [
              {
                blockId: "cards-fix-all/b7.i1",
                content: [
                  {
                    type: "text",
                    text: "Counting characters works the same way.",
                  },
                ],
              },
            ],
          },
        },
        {
          id: "card-fix-note",
          title: [
            {
              type: "text",
              text: "Is the note kept?",
            },
          ],
          reach: {
            type: "paragraph",
            blockId: "cards-fix-all/b8",
            content: [
              {
                type: "text",
                text: "A plain ",
              },
              {
                type: "strong",
                content: [
                  {
                    type: "text",
                    text: "note",
                  },
                ],
              },
              {
                type: "text",
                text: " beside the code.",
              },
            ],
          },
          build: {
            type: "text",
            blockId: "cards-fix-all/b9",
            id: "note-fix-text1",
            spoken: "One line of plain text",
            source: "kept: yes",
          },
          why: [
            {
              type: "paragraph",
              blockId: "cards-fix-all/b10",
              content: [
                {
                  type: "text",
                  text: "The note is read back later; compare ",
                },
                {
                  type: "link",
                  kind: "anchor",
                  id: "card-fix-tally",
                  content: [
                    {
                      type: "text",
                      text: "the first card",
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
          traps: {
            type: "list",
            blockId: "cards-fix-all/b11",
            ordered: false,
            items: [
              {
                blockId: "cards-fix-all/b11.i1",
                content: [
                  {
                    type: "text",
                    text: "A note without an id cannot be linked.",
                  },
                ],
              },
            ],
          },
          also: {
            type: "list",
            blockId: "cards-fix-all/b12",
            ordered: false,
            items: [
              {
                blockId: "cards-fix-all/b12.i1",
                content: [
                  {
                    type: "text",
                    text: "A note may carry a label.",
                  },
                ],
              },
              {
                blockId: "cards-fix-all/b12.i2",
                content: [
                  {
                    type: "text",
                    text: "A note may stand alone.",
                  },
                ],
              },
            ],
          },
        },
      ],
      spoken: {
        segments: [
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b1",
            },
            text: "Card: Tally words by key. Reach for: A Dictionary\u003Cstring, int\u003E read with GetValueOrDefault.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b2",
            },
            text: "Build: Adds one to the count of a word",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b3",
            },
            text: "Why: An array needs every key known before the first count.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b4.i1",
            },
            text: "The keys arrive in any order.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b4.i2",
            },
            text: "A missing key reads as zero.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b5",
            },
            text: "Columns: Word, Count. Row 1. Word: set; Count: 2.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b6.i1",
            },
            text: "Traps: Reading a missing key with the indexer throws.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b6.i2",
            },
            text: "A key differs by case unless a comparer says otherwise.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b7.i1",
            },
            text: "Also: Counting characters works the same way.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b8",
            },
            text: "Card: Is the note kept?. Reach for: A plain note beside the code.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b9",
            },
            text: "Build: One line of plain text",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b10",
            },
            text: "Why: The note is read back later; compare the first card.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b11.i1",
            },
            text: "Traps: A note without an id cannot be linked.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b12.i1",
            },
            text: "Also: A note may carry a label.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-all/b12.i2",
            },
            text: "A note may stand alone.",
          },
        ],
        audio:
          "sha256:363fafb848db5a8ef40c6c4692b921e81ab6ec6f80dd78d317ee212acd0598f6",
      },
    },
    {
      id: "cards-fix-plain",
      number: "6.2",
      title: [
        {
          type: "text",
          text: "Cards with the required fields",
        },
      ],
      cards: [
        {
          id: "card-fix-short",
          title: [
            {
              type: "text",
              text: "Keep it short",
            },
          ],
          reach: {
            type: "paragraph",
            blockId: "cards-fix-plain/b1",
            content: [
              {
                type: "text",
                text: "One sentence.",
              },
            ],
          },
          build: {
            type: "paragraph",
            blockId: "cards-fix-plain/b2",
            content: [
              {
                type: "text",
                text: "One more sentence, written on the label line.",
              },
            ],
          },
          why: [
            {
              type: "paragraph",
              blockId: "cards-fix-plain/b3",
              content: [
                {
                  type: "text",
                  text: "Nothing else is needed here.",
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
              blockId: "cards-fix-plain/b1",
            },
            text: "Card: Keep it short. Reach for: One sentence.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-plain/b2",
            },
            text: "Build: One more sentence, written on the label line.",
          },
          {
            target: {
              type: "block",
              blockId: "cards-fix-plain/b3",
            },
            text: "Why: Nothing else is needed here.",
          },
        ],
        audio:
          "sha256:40d548f253bb535691dfab960140c2772da1b97ceb57e813d6250f937f366a24",
      },
    },
  ],
} satisfies ContentDoc;
