import type { LinkContentSpan, Span } from "../generated/body.ts";
import { assertNever } from "./assertNever.ts";

// The words a reader is shown, as one string: a link or Term keeps its label and drops its target
// and hidden definition, so the text can stand where no control may.
export function spanText(spans: readonly (Span | LinkContentSpan)[]): string {
  return spans.map((span) => textOf(span)).join("");
}

function textOf(span: Span | LinkContentSpan): string {
  switch (span.type) {
    case "text":
    case "code":
      return span.text;
    case "em":
    case "strong":
    case "link":
    case "term":
      return spanText(span.content);
    default:
      return assertNever(span);
  }
}
