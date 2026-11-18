// SharpLadder.Content witness emitter output, grammar 2. Do not edit.

import type { ContentDoc } from "../../content.ts";

export const witness = {
  type: "error",
  kind: "runtime",
  id: "err-fixture-null",
  code: "NullReferenceException",
  wrote: "Called a method on a variable that holds nothing",
  got: "Object reference not set to an instance of an object",
  see: [],
  cause: [
    {
      type: "paragraph",
      blockId: "err-fixture-null/b1",
      content: [
        {
          type: "text",
          text: "The variable holds ",
        },
        {
          type: "code",
          text: "null",
        },
        {
          type: "text",
          text: ", so there is no object to call the method on.",
        },
      ],
    },
    {
      type: "walk-it",
      blockId: "err-fixture-null/b2",
      id: "walk-fix-null",
      title: [
        {
          type: "text",
          text: "Lose the object",
        },
      ],
      cells: ["box"],
      sequences: [
        {
          name: "once",
          introBlockId: "err-fixture-null/b2.1.s0",
          intro: [
            {
              type: "text",
              text: "The variable holds an object.",
            },
          ],
          steps: [
            {
              blockId: "err-fixture-null/b2.1.s1",
              dst: 0,
              value: "none",
              note: [
                {
                  type: "text",
                  text: "Now it holds nothing to call.",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  hint: [
    {
      type: "paragraph",
      blockId: "err-fixture-null/b3",
      content: [
        {
          type: "text",
          text: "Find where the variable was meant to get its object, and what ran instead.",
        },
      ],
    },
  ],
} satisfies ContentDoc;
