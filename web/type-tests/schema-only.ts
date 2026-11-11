import type { ContentDoc } from "../src/generated/content.ts";

// Whole number (order 1.5).
export const row19 = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  order: 1.5,
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

// Minimum (order 0).
export const row20 = {
  type: "part",
  kind: "syntax",
  chapter: "ch-matrix",
  order: 0,
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

// Pattern (slug with a space).
export const row21 = {
  type: "chapter",
  id: "ch-matrix",
  slug: "two words",
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

// Minimum length (empty title).
export const row22 = {
  type: "chapter",
  id: "ch-matrix",
  slug: "matrix",
  title: "",
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

// Maximum length (spoken text over 200).
export const row23 = {
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
          spoken:
            "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          source: "int x = 1;",
        },
      ],
    },
  ],
} satisfies ContentDoc;

// Reference plus pattern (chapter id must start ch-).
export const row24 = {
  type: "chapter",
  id: "matrix",
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

// Reference plus "not this value" (section id intro).
export const row25 = {
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
      id: "intro",
      title: [{ type: "text", text: "Intro" }],
      body: [
        {
          type: "paragraph",
          blockId: "intro/b1",
          content: [{ type: "text", text: "Text." }],
        },
      ],
    },
  ],
} satisfies ContentDoc;
