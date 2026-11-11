// SharpLadder.Content witness emitter output, grammar 1. Do not edit.

import type { ContentDoc } from "../../../content.ts";

export const witness = {
  type: "part",
  kind: "syntax",
  chapter: "ch-fixture",
  order: 1,
  sections: [
    {
      id: "syn-fix-sum",
      number: "1.1",
      title: [
        {
          type: "text",
          text: "Sum with ",
        },
        {
          type: "code",
          text: "foreach",
        },
      ],
      body: [
        {
          type: "paragraph",
          blockId: "syn-fix-sum/b1",
          content: [
            {
              type: "text",
              text: "To add up the readings, visit each one in turn and keep a ",
            },
            {
              type: "strong",
              content: [
                {
                  type: "text",
                  text: "running total",
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
          type: "code",
          blockId: "syn-fix-sum/b2",
          id: "syn-fix-sum1",
          group: "fix-sum",
          label: "Over an array",
          spoken: "Sums it",
          source:
            "int[] temps = { 18, 25, 31 };\nint sum = 0;\nforeach (int t in temps)\n    sum \u002B= t;",
        },
        {
          type: "code",
          blockId: "syn-fix-sum/b3",
          id: "syn-fix-sum2",
          group: "fix-sum",
          spoken: "Shows it",
          check: "sum == 74",
          source: "Console.WriteLine(sum);",
        },
        {
          type: "text",
          blockId: "syn-fix-sum/b4",
          id: "syn-fix-out",
          label: "Output",
          spoken: "Prints seventy-four",
          source: "74",
        },
        {
          type: "list",
          blockId: "syn-fix-sum/b5",
          ordered: true,
          start: 1,
          items: [
            {
              blockId: "syn-fix-sum/b5.i1",
              content: [
                {
                  type: "text",
                  text: "Start the total at zero.",
                },
              ],
            },
            {
              blockId: "syn-fix-sum/b5.i2",
              content: [
                {
                  type: "text",
                  text: "Add each reading in turn.",
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          blockId: "syn-fix-sum/b6",
          content: [
            {
              type: "text",
              text: "Back to ",
            },
            {
              type: "link",
              id: "syn-fix-sum1",
              chapter: "ch-fixture",
              content: [
                {
                  type: "text",
                  text: "the first sum",
                },
              ],
            },
            {
              type: "text",
              text: " or ",
            },
            {
              type: "link",
              id: "syn-fix-sum",
              content: [
                {
                  type: "text",
                  text: "this section",
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
      spoken: {
        segments: [
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b1",
            },
            text: "To add up the readings, visit each one in turn and keep a running total.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b2",
            },
            text: "Sums it",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b3",
            },
            text: "Shows it",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b4",
            },
            text: "Prints seventy-four",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b5.i1",
            },
            text: "Start the total at zero.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b5.i2",
            },
            text: "Add each reading in turn.",
          },
          {
            target: {
              type: "block",
              blockId: "syn-fix-sum/b6",
            },
            text: "Back to the first sum or this section.",
          },
        ],
        audio:
          "sha256:380a29fa4d76bee1ffbf5ece0277f63d62a8acdb44c761a91d665e11dd54693c",
      },
    },
  ],
} satisfies ContentDoc;
