// SharpLadder.Content type emitter output, grammar 2. Do not edit.

import type {
  AnchoredTextBlock,
  Block,
  BlockId,
  Body,
  CodeBlock,
  ErrorId,
  Id,
  ItemId,
  LinkContent,
  ListItem,
  ParagraphBlock,
  SectionId,
  Spans,
  Speech,
} from "./body.ts";

export type ChapterId = Id;

export type Order = number;

export type TermId = Id;

export type ShownText = string;

export type See = Id[];

export type FieldBody = [Block, ...Block[]];

export type GlossaryEntry = {
  type: "glossary";
  id: TermId;
  term: ShownText;
  short: string;
  see: See;
  body: Body;
};

export type ErrorEntry = CompilerError | RuntimeError | WrongOutputError;

export type CompilerError = {
  type: "error";
  kind: "compiler";
  id: ErrorId;
  code: ShownText;
  wrote: ShownText;
  got: ShownText;
  see: See;
  cause: FieldBody;
  hint: FieldBody;
};

export type RuntimeError = {
  type: "error";
  kind: "runtime";
  id: ErrorId;
  code: ShownText;
  wrote: ShownText;
  got: ShownText;
  see: See;
  cause: FieldBody;
  hint: FieldBody;
};

export type WrongOutputError = {
  type: "error";
  kind: "wrong-output";
  id: ErrorId;
  wrote: ShownText;
  got: ShownText;
  see: See;
  cause: FieldBody;
  hint: FieldBody;
};

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

export type PartFile =
  | SyntaxPart
  | BuildPart
  | IdiomsPart
  | GotchasPart
  | LibraryPart
  | CardsPart
  | DrillPart
  | HintsPart;

export type SyntaxPart = {
  type: "part";
  kind: "syntax";
  chapter: ChapterId;
  order: Order;
  sections: [PartSection, ...PartSection[]];
};

export type BuildPart = {
  type: "part";
  kind: "build";
  chapter: ChapterId;
  order: Order;
  sections: [BuildSection, ...BuildSection[]];
};

export type IdiomsPart = {
  type: "part";
  kind: "idioms";
  chapter: ChapterId;
  order: Order;
  sections: [PartSection, ...PartSection[]];
};

export type GotchasPart = {
  type: "part";
  kind: "gotchas";
  chapter: ChapterId;
  order: Order;
  sections: [PartSection, ...PartSection[]];
};

export type LibraryPart = {
  type: "part";
  kind: "library";
  chapter: ChapterId;
  order: Order;
  sections: [PartSection, ...PartSection[]];
};

export type CardsPart = {
  type: "part";
  kind: "cards";
  chapter: ChapterId;
  order: Order;
  sections: [CardsSection, ...CardsSection[]];
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

export type BuildSection = {
  id: SectionId;
  number: string;
  title: Spans;
  body: Body;
  approaches?: [Approach, Approach, ...Approach[]];
  spoken: Speech;
};

export type Approach = {
  id: Id;
  title: Spans;
  label: ShownText;
  body: FieldBody;
};

export type CardsSection = {
  id: SectionId;
  number: string;
  title: Spans;
  cards: [Card, ...Card[]];
  spoken: Speech;
};

export type CardId = Id;

export type Card = {
  id: CardId;
  title: Spans;
  reach: ParagraphBlock;
  build: ParagraphBlock | CodeBlock | AnchoredTextBlock;
  why: FieldBody;
  traps?: CardList;
  also?: CardList;
};

export type CardList = {
  type: "list";
  blockId: BlockId;
  ordered: false;
  items: [ListItem] | [ListItem, ListItem];
};

export type DrillPart = {
  type: "part";
  kind: "drill";
  chapter: ChapterId;
  order: Order;
  sections: [DrillSection, ...DrillSection[]];
};

export type DrillSection = {
  id: SectionId;
  number: string;
  title: Spans;
  rung: RampRung;
  body: Body;
  drills: DrillList;
  spoken: Speech;
};

export type RampRung = "foundations" | "warm-up" | "easy" | "medium" | "hard";

export type DrillList = {
  blockId: BlockId;
  items: [DrillReference, ...DrillReference[]];
};

export type DrillReference = {
  blockId: ItemId;
  id: DrillId;
  label: ShownText;
};

export type DrillId = Id;

export type HintsPart = {
  type: "part";
  kind: "hints";
  chapter: ChapterId;
  order: Order;
  sections: [Ladder, ...Ladder[]];
};

export type LadderId = Id;

export type PatternId = Id;

export type Cue = {
  blockId: BlockId;
  text: ShownText;
};

export type Ladder = {
  id: LadderId;
  title: LinkContent;
  cue: Cue;
  pattern: PatternId;
  approach: ShownText;
  rungs: [Rung, ...Rung[]];
};

export type Rung = {
  id: string;
  content: LinkContent;
};

export type HintsCatalogue = {
  type: "hints-catalogue";
  chapter: ChapterId;
  order: Order;
  ladders: [CatalogueLadder, ...CatalogueLadder[]];
};

export type CatalogueLadder = {
  id: LadderId;
  cue: Cue;
  spoken: Speech;
};

export type ContentDoc =
  ChapterFile | PartFile | GlossaryEntry | ErrorEntry | HintsCatalogue;
