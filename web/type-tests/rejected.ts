import type { ContentDoc } from "../src/generated/content.ts";

export const row01 = {
  type: "chapter",
  id: "ch-matrix",
  title: "Matrix",
  order: 1,
  targets: { csharp: 12, dotnet: 8 },
  intro: [
    {
      type: "paragraph",
      blockId: "intro/b1",
      content: [{ type: "text", text: "Text." }],
    },
  ],
  sections: [
    {
      id: "matrix-intro",
      title: [{ type: "text", text: "Intro" }],
      body: [
        {
          type: "paragraph",
          blockId: "matrix-intro/b1",
          content: [{ type: "text", text: "Text." }],
        },
      ],
    },
  ],
  // @ts-expect-error Row 1: Required property missing (slug).
} satisfies ContentDoc;

export const row02 = {
  type: "chapter",
  id: "ch-matrix",
  slug: "matrix",
  title: "Matrix",
  order: 1,
  targets: { csharp: 12, dotnet: 8 },
  intro: [
    {
      type: "paragraph",
      blockId: "intro/b1",
      content: [{ type: "text", text: "Text." }],
    },
  ],
  sections: [
    {
      id: "matrix-intro",
      title: [{ type: "text", text: "Intro" }],
      body: [
        {
          type: "paragraph",
          blockId: "matrix-intro/b1",
          content: [{ type: "text", text: "Text." }],
        },
      ],
    },
  ],
  // @ts-expect-error Row 2: No extra properties (extra at the top level).
  extra: 1,
} satisfies ContentDoc;

export const row03 = {
  type: "chapter",
  id: "ch-matrix",
  slug: "matrix",
  title: "Matrix",
  order: 1,
  // @ts-expect-error Row 3: No extra properties in a nested object (targets).
  targets: { csharp: 12, dotnet: 8, java: 21 },
  intro: [
    {
      type: "paragraph",
      blockId: "intro/b1",
      content: [{ type: "text", text: "Text." }],
    },
  ],
  sections: [
    {
      id: "matrix-intro",
      title: [{ type: "text", text: "Intro" }],
      body: [
        {
          type: "paragraph",
          blockId: "matrix-intro/b1",
          content: [{ type: "text", text: "Text." }],
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row04 = {
  // @ts-expect-error Row 4: Fixed text value (type "chapter").
  type: "chapters",
  id: "ch-matrix",
  slug: "matrix",
  title: "Matrix",
  order: 1,
  targets: { csharp: 12, dotnet: 8 },
  intro: [
    {
      type: "paragraph",
      blockId: "intro/b1",
      content: [{ type: "text", text: "Text." }],
    },
  ],
  sections: [
    {
      id: "matrix-intro",
      title: [{ type: "text", text: "Intro" }],
      body: [
        {
          type: "paragraph",
          blockId: "matrix-intro/b1",
          content: [{ type: "text", text: "Text." }],
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row05 = {
  type: "chapter",
  id: "ch-matrix",
  slug: "matrix",
  title: "Matrix",
  order: 1,
  // @ts-expect-error Row 5: Fixed number value (csharp 12).
  targets: { csharp: 11, dotnet: 8 },
  intro: [
    {
      type: "paragraph",
      blockId: "intro/b1",
      content: [{ type: "text", text: "Text." }],
    },
  ],
  sections: [
    {
      id: "matrix-intro",
      title: [{ type: "text", text: "Intro" }],
      body: [
        {
          type: "paragraph",
          blockId: "matrix-intro/b1",
          content: [{ type: "text", text: "Text." }],
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row06 = {
  type: "part",
  // @ts-expect-error Row 6: Allowed list (kind).
  kind: "recipes",
  chapter: "ch-matrix",
  order: 1,
  sections: [
    {
      id: "matrix-one",
      number: "1.1",
      title: [{ type: "text", text: "One" }],
      body: [
        {
          type: "paragraph",
          blockId: "matrix-one/b1",
          content: [{ type: "text", text: "Text." }],
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row07 = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  order: 1,
  sections: [
    {
      id: "matrix-one",
      number: "1.1",
      title: [{ type: "text", text: "One" }],
      body: [
        {
          // @ts-expect-error Row 7: Discriminated union: unknown block type.
          type: "table",
          blockId: "matrix-one/b1",
          content: [{ type: "text", text: "Cell." }],
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row08 = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  order: 1,
  sections: [
    {
      id: "matrix-one",
      number: "1.1",
      title: [{ type: "text", text: "One" }],
      body: [
        {
          type: "paragraph",
          blockId: "matrix-one/b1",
          content: [{ type: "text", text: "Text." }],
          // @ts-expect-error Row 8: Discriminated union: a field from another block type.
          ordered: true,
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row09 = {
  type: "part",
  chapter: "ch-matrix",
  order: 1,
  sections: [
    {
      id: "matrix-one",
      number: "1.1",
      title: [{ type: "text", text: "One" }],
      body: [
        {
          type: "paragraph",
          blockId: "matrix-one/b1",
          content: [{ type: "text", text: "Text." }],
        },
      ],
    },
  ],
  // @ts-expect-error Row 9: Root choice: part without kind.
} satisfies ContentDoc;

export const row10 = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  order: 1,
  sections: [
    {
      id: "matrix-one",
      number: "1.1",
      // @ts-expect-error Row 10: At least one item (empty spans).
      title: [],
      body: [
        {
          type: "paragraph",
          blockId: "matrix-one/b1",
          content: [{ type: "text", text: "Text." }],
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row11 = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  order: 1,
  sections: [],
  // @ts-expect-error Row 11: At least one item (part with no sections).
} satisfies ContentDoc;

export const row12 = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  order: 1,
  sections: [
    {
      id: "matrix-one",
      number: "1.1",
      title: [{ type: "text", text: "One" }],
      body: [
        {
          type: "list",
          blockId: "matrix-one/b1",
          ordered: true,
          // @ts-expect-error Row 12: Nested arrays: wrong element inside list items.
          items: [{ type: "text", text: "Item." }],
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row13 = {
  type: "chapter",
  id: "ch-matrix",
  slug: "matrix",
  title: "Matrix",
  order: 1,
  targets: { csharp: 12, dotnet: 8 },
  // @ts-expect-error Row 13: Reference into the other schema file (chapter intro).
  intro: [{ type: "paragraph", blockId: "intro/b1", content: "Text." }],
  sections: [
    {
      id: "matrix-intro",
      title: [{ type: "text", text: "Intro" }],
      body: [
        {
          type: "paragraph",
          blockId: "matrix-intro/b1",
          content: [{ type: "text", text: "Text." }],
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row14 = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  order: 1,
  sections: [
    {
      id: "matrix-one",
      number: "1.1",
      title: [{ type: "text", text: "One" }],
      body: [
        {
          type: "paragraph",
          blockId: "matrix-one/b1",
          content: [
            {
              type: "em",
              content: [
                // @ts-expect-error Row 14: Recursion: bad value two levels inside emphasis.
                { type: "strong", content: [{ type: "text", text: 5 }] },
              ],
            },
          ],
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row15 = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  // @ts-expect-error Row 15: Number, not text (order "1").
  order: "1",
  sections: [
    {
      id: "matrix-one",
      number: "1.1",
      title: [{ type: "text", text: "One" }],
      body: [
        {
          type: "paragraph",
          blockId: "matrix-one/b1",
          content: [{ type: "text", text: "Text." }],
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row16 = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  order: 1,
  sections: [
    {
      id: "matrix-one",
      number: "1.1",
      title: [{ type: "text", text: "One" }],
      body: [
        {
          type: "list",
          blockId: "matrix-one/b1",
          // @ts-expect-error Row 16: True or false only (ordered).
          ordered: "yes",
          items: [
            {
              blockId: "matrix-one/b1.i1",
              content: [{ type: "text", text: "Item." }],
            },
          ],
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row17 = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  order: 1,
  sections: [
    {
      id: "matrix-one",
      number: "1.1",
      title: [{ type: "text", text: "One" }],
      body: [
        {
          type: "code",
          blockId: "matrix-one/b1",
          id: "matrix-code",
          group: "matrix-group",
          spoken: "Runs it",
          check: "x == 1",
          // @ts-expect-error Row 17: At most one of check, throws and fail.
          throws: "InvalidOperationException",
          source: "int x = 1;",
        },
      ],
    },
  ],
} satisfies ContentDoc;

export const row18 = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  order: 1,
  sections: [
    {
      id: "matrix-one",
      number: "1.1",
      title: [{ type: "text", text: "One" }],
      body: [
        // @ts-expect-error Row 18: Optional property present but undefined (list start).
        {
          type: "list",
          blockId: "matrix-one/b1",
          ordered: true,
          start: undefined,
          items: [
            {
              blockId: "matrix-one/b1.i1",
              content: [{ type: "text", text: "Item." }],
            },
          ],
        },
      ],
    },
  ],
} satisfies ContentDoc;
