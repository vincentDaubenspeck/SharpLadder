// SharpLadder.Content witness emitter output, grammar 1. Do not edit.

import type { ContentDoc } from "../../content.ts";

export const witness = {
  type: "glossary",
  id: "term-fixture-set",
  term: "HashSet\u003CT\u003E",
  short:
    "A collection of unique values with fast \u0022is it here?\u0022 checks.",
  see: [
    "term-fixture-loop",
    "card-fix-tally",
    "syn-fix-sum",
    "err-fixture-cs0165",
    "ch-fixture",
  ],
  body: [
    {
      type: "paragraph",
      blockId: "term-fixture-set/b1",
      content: [
        {
          type: "text",
          text: "A set keeps each value ",
        },
        {
          type: "em",
          content: [
            {
              type: "text",
              text: "once",
            },
          ],
        },
        {
          type: "text",
          text: ". Adding a value it already holds changes nothing.",
        },
      ],
    },
    {
      type: "list",
      blockId: "term-fixture-set/b2",
      ordered: false,
      items: [
        {
          blockId: "term-fixture-set/b2.i1",
          content: [
            {
              type: "code",
              text: "Add",
            },
            {
              type: "text",
              text: " returns ",
            },
            {
              type: "code",
              text: "false",
            },
            {
              type: "text",
              text: " for a value the set already holds.",
            },
          ],
        },
        {
          blockId: "term-fixture-set/b2.i2",
          content: [
            {
              type: "code",
              text: "Contains",
            },
            {
              type: "text",
              text: " answers without a scan.",
            },
          ],
        },
      ],
    },
    {
      type: "code",
      blockId: "term-fixture-set/b3",
      id: "fix-set1",
      group: "term-fixture-set",
      spoken: "Adds seven twice and keeps one",
      source:
        "var seen = new HashSet\u003Cint\u003E();\nseen.Add(7);\nseen.Add(7);",
    },
    {
      type: "table",
      blockId: "term-fixture-set/b4",
      headers: [
        [
          {
            type: "text",
            text: "Call",
          },
        ],
        [
          {
            type: "text",
            text: "Result",
          },
        ],
      ],
      rows: [
        [
          [
            {
              type: "text",
              text: "first Add",
            },
          ],
          [
            {
              type: "code",
              text: "true",
            },
          ],
        ],
        [
          [
            {
              type: "text",
              text: "second Add",
            },
          ],
          [
            {
              type: "code",
              text: "false",
            },
          ],
        ],
      ],
    },
    {
      type: "paragraph",
      blockId: "term-fixture-set/b5",
      content: [
        {
          type: "text",
          text: "A missing value is one cause of ",
        },
        {
          type: "link",
          kind: "error",
          id: "err-fixture-off-by-one",
          content: [
            {
              type: "text",
              text: "a wrong count",
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
