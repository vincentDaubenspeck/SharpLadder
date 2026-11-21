import { useId } from "react";
import type { ReactElement } from "react";
import type {
  Block,
  Cell,
  CodeBlock,
  ListBlock,
  TableBlock,
  TextBlock,
  WalkItBlock,
} from "../generated/body.ts";
import { assertNever } from "./assertNever.ts";
import type { SlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";
import type { WalkPosition } from "./walk-position.ts";
import { WalkStepper } from "./WalkStepper.tsx";
import type { WalkChange } from "./WalkStepper.tsx";

/** What one walk shows under a page's control: its position, and whether to read it out. */
export interface WalkShown {
  readonly position: WalkPosition;
  readonly announce: boolean;
}

/** A reader's move in one walk of the page: the stepper's change with that walk's id. */
export interface WalkControlChange extends WalkChange {
  readonly walkId: string;
}

/**
 * A page's control of the walks it shows: what each shows by its id, and where a move goes.
 * Without one every walk is frozen at its first sequence's start.
 */
export interface WalkControl {
  readonly shownOf: (walkId: string) => WalkShown;
  readonly onWalkChange: (change: WalkControlChange) => void;
}

export function Blocks({
  blocks,
  slugs,
  walkControl,
}: {
  blocks: readonly Block[];
  slugs: SlugMap;
  walkControl?: WalkControl | undefined;
}): ReactElement {
  return (
    <>
      {blocks.map((block) => (
        <BlockNode
          key={block.blockId}
          block={block}
          slugs={slugs}
          walkControl={walkControl}
        />
      ))}
    </>
  );
}

function BlockNode({
  block,
  slugs,
  walkControl,
}: {
  block: Block;
  slugs: SlugMap;
  walkControl: WalkControl | undefined;
}): ReactElement {
  switch (block.type) {
    case "paragraph":
      return (
        <p data-block-id={block.blockId}>
          <Spans spans={block.content} slugs={slugs} />
        </p>
      );
    case "list":
      return <ListNode block={block} slugs={slugs} />;
    case "code":
    case "text":
      return <SourceBlock block={block} />;
    case "table":
      return <TableNode block={block} slugs={slugs} />;
    case "walk-it":
      return walkControl === undefined ? (
        <FrozenWalk block={block} slugs={slugs} />
      ) : (
        <ControlledWalk block={block} slugs={slugs} walkControl={walkControl} />
      );
    default:
      return assertNever(block);
  }
}

function ListNode({
  block,
  slugs,
}: {
  block: ListBlock;
  slugs: SlugMap;
}): ReactElement {
  const items = block.items.map((item) => (
    <li key={item.blockId} data-block-id={item.blockId}>
      <Spans spans={item.content} slugs={slugs} />
    </li>
  ));
  return block.ordered ? (
    <ol start={block.start} data-block-id={block.blockId}>
      {items}
    </ol>
  ) : (
    <ul data-block-id={block.blockId}>{items}</ul>
  );
}

// A table is static, so a position is a stable key. An empty cell stays an empty cell.
function TableNode({
  block,
  slugs,
}: {
  block: TableBlock;
  slugs: SlugMap;
}): ReactElement {
  return (
    <table data-block-id={block.blockId}>
      <thead>
        <tr>
          {block.headers.map((cell, column) => (
            <th key={column} scope="col">
              <Spans spans={cell} slugs={slugs} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, column) => (
              <td key={column}>
                <Spans spans={cell} slugs={slugs} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The anchor id and the generated label id sit on different elements, so they never meet. The
// block id is a hook for highlighting only and is never written as an id.
function SourceBlock({
  block,
}: {
  block: CodeBlock | TextBlock;
}): ReactElement {
  const labelId = useId();
  const code = <code>{block.source}</code>;
  return (
    <div id={block.id} data-block-id={block.blockId}>
      {block.label === undefined ? (
        <pre>{code}</pre>
      ) : (
        <>
          <span id={labelId}>{block.label}</span>
          <pre aria-labelledby={labelId}>{code}</pre>
        </>
      )}
    </div>
  );
}

// With no controller a walk is frozen at sequence 1's start: the container carries its anchor
// and its one block hook, and nothing in it can move, switch or announce. No step has read or
// written a starting cell, so empty is the one state it can show.
function FrozenWalk({
  block,
  slugs,
}: {
  block: WalkItBlock;
  slugs: SlugMap;
}): ReactElement {
  return (
    <div id={block.id} data-block-id={block.blockId}>
      <p>
        <Spans spans={block.title} slugs={slugs} />
      </p>
      <ol role="list">
        {block.cells.map((cell, index) => (
          <li key={index} data-cell={cell === null ? "empty" : null}>
            {index}: <CellValue value={cell} />
          </li>
        ))}
      </ol>
      <p data-block-id={block.sequences[0].introBlockId}>
        <Spans spans={block.sequences[0].intro} slugs={slugs} />
      </p>
    </div>
  );
}

// The page owns the position by the walk's id, and the stepper writes the walk's only hooks:
// its anchor on the root and its block hook on the title.
function ControlledWalk({
  block,
  slugs,
  walkControl,
}: {
  block: WalkItBlock;
  slugs: SlugMap;
  walkControl: WalkControl;
}): ReactElement {
  return (
    <WalkStepper
      block={block}
      position={walkControl.shownOf(block.id).position}
      onPositionChange={(change) => {
        walkControl.onWalkChange({
          walkId: block.id,
          position: change.position,
          cause: change.cause,
        });
      }}
      announce={walkControl.shownOf(block.id).announce}
      slugs={slugs}
    />
  );
}

// Quotes keep a string apart from the number it may spell; null is the spare slot.
function CellValue({ value }: { value: Cell }): ReactElement {
  return (
    <>
      {value === null
        ? "empty"
        : typeof value === "string"
          ? `“${value}”`
          : value}
    </>
  );
}
