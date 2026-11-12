import { useId } from "react";
import type { ReactElement } from "react";
import type {
  Block,
  CodeBlock,
  ListBlock,
  TableBlock,
  TextBlock,
} from "../generated/body.ts";
import { assertNever } from "./assertNever.ts";
import type { SlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";

export function Blocks({
  blocks,
  slugs,
}: {
  blocks: readonly Block[];
  slugs: SlugMap;
}): ReactElement {
  return (
    <>
      {blocks.map((block) => (
        <BlockNode key={block.blockId} block={block} slugs={slugs} />
      ))}
    </>
  );
}

function BlockNode({
  block,
  slugs,
}: {
  block: Block;
  slugs: SlugMap;
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
