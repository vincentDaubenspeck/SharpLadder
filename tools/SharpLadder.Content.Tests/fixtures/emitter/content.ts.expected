// SharpLadder.Content type emitter output, grammar 1. Do not edit.

import type { Body, Id, SectionId, Spans, Speech } from "./body.ts";

export type ChapterId = Id;

export type Order = number;

export type ChapterFile = {
  type: "chapter";
  id: ChapterId;
  slug: string;
  title: string;
  order: Order;
  targets: {
    csharp: 12;
    dotnet: 8;
  };
  intro: Body;
  sections: ChapterSection[];
};

export type PartFile = {
  type: "part";
  kind: "syntax" | "build" | "idioms" | "gotchas" | "library";
  chapter: ChapterId;
  order: Order;
  sections: [PartSection, ...PartSection[]];
};

export type ChapterSection = {
  id: SectionId;
  title: Spans;
  body: Body;
  spoken: Speech;
};

export type PartSection = {
  id: SectionId;
  number: string;
  title: Spans;
  body: Body;
  spoken: Speech;
};

export type ContentDoc = ChapterFile | PartFile;
