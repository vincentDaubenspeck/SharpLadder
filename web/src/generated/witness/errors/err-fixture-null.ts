// SharpLadder.Content witness emitter output, grammar 1. Do not edit.

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
  ],
  hint: [
    {
      type: "paragraph",
      blockId: "err-fixture-null/b2",
      content: [
        {
          type: "text",
          text: "Find where the variable was meant to get its object, and what ran instead.",
        },
      ],
    },
  ],
} satisfies ContentDoc;
