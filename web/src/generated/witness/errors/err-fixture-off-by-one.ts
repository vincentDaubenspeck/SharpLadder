// SharpLadder.Content witness emitter output, grammar 1. Do not edit.

import type { ContentDoc } from "../../content.ts";

export const witness = {
  type: "error",
  kind: "wrong-output",
  id: "err-fixture-off-by-one",
  wrote: "Counted the items of a list with a loop",
  got: "A count that is one too small",
  see: ["err-fixture-cs0165"],
  cause: [
    {
      type: "paragraph",
      blockId: "err-fixture-off-by-one/b1",
      content: [
        {
          type: "text",
          text: "The loop stops one step early.",
        },
      ],
    },
    {
      type: "list",
      blockId: "err-fixture-off-by-one/b2",
      ordered: true,
      start: 1,
      items: [
        {
          blockId: "err-fixture-off-by-one/b2.i1",
          content: [
            {
              type: "text",
              text: "Check where the loop starts.",
            },
          ],
        },
        {
          blockId: "err-fixture-off-by-one/b2.i2",
          content: [
            {
              type: "text",
              text: "Check the comparison that ends it.",
            },
          ],
        },
      ],
    },
  ],
  hint: [
    {
      type: "paragraph",
      blockId: "err-fixture-off-by-one/b3",
      content: [
        {
          type: "text",
          text: "Walk the loop by hand for a list of one item. Compare with ",
        },
        {
          type: "link",
          kind: "error",
          id: "err-fixture-cs0165",
          content: [
            {
              type: "text",
              text: "the compiler entry",
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
} satisfies ContentDoc;
