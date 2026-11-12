// SharpLadder.Content type emitter output, grammar 2. Do not edit.

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

export type Block =
  ParagraphBlock | ListBlock | CodeBlock | TextBlock | TableBlock;

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

export type TableBlock = {
  type: "table";
  blockId: BlockId;
  headers: TableRow;
  rows: [TableRow, ...TableRow[]];
};

export type TableRow = [TableCell, ...TableCell[]];

export type TableCell = Span[];

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

export type AnchoredTextBlock = {
  type: "text";
  blockId: BlockId;
  id: Id;
  label?: string;
  spoken: Spoken;
  source: string;
};

export type Spans = [Span, ...Span[]];

export type Span =
  TextSpan | CodeSpan | EmSpan | StrongSpan | LinkSpan | TermSpan;

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

export type LinkSpan = AnchorLinkSpan | ErrorLinkSpan;

export type AnchorLinkSpan = {
  type: "link";
  kind: "anchor";
  id: Id;
  chapter?: ChapterRef;
  content: LinkContent;
};

export type ErrorLinkSpan = {
  type: "link";
  kind: "error";
  id: ErrorId;
  content: LinkContent;
};

export type ErrorId = Id;

export type TermSpan = {
  type: "term";
  id: TermRef;
  short: string;
  content: LinkContent;
};

export type TermRef = Id;

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
