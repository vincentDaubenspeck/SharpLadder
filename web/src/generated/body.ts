// SharpLadder.Content type emitter output, grammar 1. Do not edit.

export type Id = string;

export type SectionId = Id;

export type BlockId = string;

export type ItemId = string;

export type Spoken = string;

export type BlockTarget = {
  type: "block";
  blockId: string;
};

export type SectionTarget = {
  type: "section";
  sectionId: SectionId;
};

export type SegmentTarget = BlockTarget | SectionTarget;

export type Segment = {
  target: SegmentTarget;
  text: string;
};

export type Speech = {
  segments: Segment[];
  audio: string;
};

export type Body = Block[];

export type Block = ParagraphBlock | ListBlock | CodeBlock | TextBlock;

export type ParagraphBlock = {
  type: "paragraph";
  blockId: BlockId;
  content: Spans;
};

export type ListBlock = {
  type: "list";
  blockId: BlockId;
  ordered: boolean;
  start?: number;
  items: [ListItem, ...ListItem[]];
};

export type ListItem = {
  blockId: ItemId;
  content: Spans;
};

export type CodeBlock =
  | {
      type: "code";
      blockId: BlockId;
      id: Id;
      group: Id;
      label?: string;
      spoken: Spoken;
      check?: string;
      throws?: never;
      fail?: never;
      source: string;
    }
  | {
      type: "code";
      blockId: BlockId;
      id: Id;
      group: Id;
      label?: string;
      spoken: Spoken;
      check?: never;
      throws?: never;
      fail?: string;
      source: string;
    }
  | {
      type: "code";
      blockId: BlockId;
      id: Id;
      group: Id;
      label?: string;
      spoken: Spoken;
      check?: never;
      throws?: string;
      fail?: never;
      source: string;
    };

export type TextBlock = {
  type: "text";
  blockId: BlockId;
  id?: Id;
  label?: string;
  spoken: Spoken;
  source: string;
};

export type Spans = [Span, ...Span[]];

export type Span = TextSpan | CodeSpan | EmSpan | StrongSpan | LinkSpan;

export type TextSpan = {
  type: "text";
  text: string;
};

export type CodeSpan = {
  type: "code";
  text: string;
};

export type EmSpan = {
  type: "em";
  content: Spans;
};

export type StrongSpan = {
  type: "strong";
  content: Spans;
};

export type ChapterRef = Id;

export type LinkSpan = {
  type: "link";
  id: Id;
  chapter?: ChapterRef;
  content: LinkContent;
};

export type LinkContent = [LinkContentSpan, ...LinkContentSpan[]];

export type LinkContentSpan = TextSpan | CodeSpan | LinkEmSpan | LinkStrongSpan;

export type LinkEmSpan = {
  type: "em";
  content: LinkContent;
};

export type LinkStrongSpan = {
  type: "strong";
  content: LinkContent;
};
