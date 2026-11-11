import type { ContentDoc } from "../src/generated/content.ts";

// Optional properties left out: no list start, no code label.
export const p1 = {
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
          ordered: false,
          items: [
            {
              blockId: "matrix-one/b1.i1",
              content: [{ type: "text", text: "Item." }],
            },
          ],
        },
        {
          type: "code",
          blockId: "matrix-one/b2",
          id: "matrix-code",
          group: "matrix-group",
          spoken: "Runs it",
          source: "int x = 1;",
        },
      ],
    },
  ],
} satisfies ContentDoc;

// Empty arrays where allowed: chapter intro and sections.
export const p2a = {
  type: "chapter",
  id: "ch-matrix",
  slug: "matrix",
  title: "Matrix",
  order: 1,
  targets: { csharp: 12, dotnet: 8 },
  intro: [],
  sections: [],
} satisfies ContentDoc;

// Empty array where allowed: section body.
export const p2b = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  order: 1,
  sections: [
    {
      id: "matrix-one",
      number: "1.1",
      title: [{ type: "text", text: "One" }],
      body: [],
    },
  ],
} satisfies ContentDoc;

// One exclusive field alone: fail without check or throws.
export const p3 = {
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
          fail: "CS0029",
          source: "int x = 1;",
        },
      ],
    },
  ],
} satisfies ContentDoc;
