import type { ReactElement, ReactNode } from "react";
import type { LinkContentSpan, Span } from "../generated/body.ts";
import { assertNever } from "./assertNever.ts";
import { ContentLink } from "./ContentLink.tsx";
import type { SlugMap } from "./href.ts";

// Inline content is static, so a position is a stable key.
export function Spans({
  spans,
  slugs,
}: {
  spans: readonly Span[];
  slugs: SlugMap;
}): ReactElement {
  return (
    <>
      {spans.map((span, index) => (
        <SpanNode key={index} span={span} slugs={slugs} />
      ))}
    </>
  );
}

function SpanNode({ span, slugs }: { span: Span; slugs: SlugMap }): ReactNode {
  switch (span.type) {
    case "text":
      return span.text;
    case "code":
      return <code>{span.text}</code>;
    case "em":
      return (
        <em>
          <Spans spans={span.content} slugs={slugs} />
        </em>
      );
    case "strong":
      return (
        <strong>
          <Spans spans={span.content} slugs={slugs} />
        </strong>
      );
    case "link":
      return <ContentLink link={span} slugs={slugs} />;
    default:
      return assertNever(span);
  }
}

// No link case: a link inside link text reaches assertNever and throws.
export function LinkContent({
  spans,
}: {
  spans: readonly LinkContentSpan[];
}): ReactElement {
  return (
    <>
      {spans.map((span, index) => (
        <LinkContentNode key={index} span={span} />
      ))}
    </>
  );
}

function LinkContentNode({ span }: { span: LinkContentSpan }): ReactNode {
  switch (span.type) {
    case "text":
      return span.text;
    case "code":
      return <code>{span.text}</code>;
    case "em":
      return (
        <em>
          <LinkContent spans={span.content} />
        </em>
      );
    case "strong":
      return (
        <strong>
          <LinkContent spans={span.content} />
        </strong>
      );
    default:
      return assertNever(span);
  }
}
