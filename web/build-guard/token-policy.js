// A closed policy: any function or at-rule not reviewed below fails, so a new resource carrier needs no list update.
import { ident, tokenize, tokenTypes } from "css-tree";

/** Function names the production stylesheet uses, each reviewed not to take a resource locator. */
export const allowedFunctions = new Map([
  [
    "var",
    "substitutes a custom property; its fallback is ordinary tokens, checked like any others",
  ],
  ["clamp", "math over numbers and lengths; it takes no string or locator"],
  [
    "not",
    "the :not() selector; its strings are attribute values, never locators",
  ],
]);

/** At-rule names the production stylesheet uses, each reviewed for string or locator preludes. */
export const allowedAtRules = new Map([
  ["layer", "names cascade layers; its prelude is identifiers only"],
  ["media", "media queries; its prelude takes no string and loads nothing"],
]);

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const typeName = Object.fromEntries(
  Object.entries(tokenTypes).map(([name, type]) => [type, name]),
);
const closerOf = {
  Function: ")",
  LeftParenthesis: ")",
  LeftSquareBracket: "]",
  LeftCurlyBracket: "}",
};
const closers = {
  RightParenthesis: ")",
  RightSquareBracket: "]",
  RightCurlyBracket: "}",
};
const lowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;

// ASCII lowering only: CSS matches names ASCII case-insensitively, never by Unicode case folding.
const asciiLower = (name) =>
  name.replace(/[A-Z]/gu, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

// An odd run of backslashes before the final character escapes it, so it does not close.
function closedBy(raw, last) {
  if (!raw.endsWith(last)) return false;
  let slashes = 0;
  for (let i = raw.length - 2; i >= 0 && raw[i] === "\\"; i--) slashes++;
  return slashes % 2 === 0;
}

/**
 * Problems with the original bytes of one emitted stylesheet under the token policy. Only
 * tokens wholly inside `exempt`, a byte range [start, end) already admitted by exact equality,
 * skip the name checks; the syntax checks apply everywhere.
 */
export function tokenPolicyProblems(bytes, exempt = null) {
  let text;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    return ["not strict UTF-8"];
  }
  if (text.includes("\u0000")) return ["U+0000 in the input"];
  const tokens = [];
  tokenize(text, (type, start, end) =>
    tokens.push([typeName[type], start, end]),
  );
  const problems = [];
  const stack = [];
  // Tokenizer offsets count UTF-16 units; the slice and every report are in bytes.
  let at = 0;
  let byte = 0;
  let last = null;
  let boundaries = 0;
  for (const [type, start, end] of tokens) {
    if (
      start !== at ||
      end <= start ||
      (start > 0 && lowSurrogate(text.charCodeAt(start)))
    ) {
      return [`an uncertain token span at UTF-16 offset ${start}`];
    }
    const from = byte;
    byte += Buffer.byteLength(text.slice(start, end), "utf8");
    at = end;
    const raw = text.slice(start, end);
    const where = `at byte ${from}`;
    if (exempt !== null) {
      if (from === exempt.start) boundaries++;
      if (byte === exempt.end) boundaries++;
      if (from < exempt.start && byte > exempt.start)
        problems.push(`a token ${where} crosses the admitted slice start`);
      if (from < exempt.end && byte > exempt.end)
        problems.push(`a token ${where} crosses the admitted slice end`);
    }
    const inside =
      exempt !== null && from >= exempt.start && byte <= exempt.end;
    // A closed comment may trail; an unterminated one is reported on its own.
    if (type !== "WhiteSpace" && type !== "Comment") last = type;
    if (type === "BadUrl") problems.push(`a bad-url token ${where}`);
    else if (type === "BadString") problems.push(`a bad-string token ${where}`);
    // The tokenizer recovers from a backslash that starts no valid escape with a delim token.
    else if (type === "Delim" && raw === "\\")
      problems.push(`a backslash that starts no valid escape ${where}`);
    else if (type === "Comment" && !(raw.length >= 4 && raw.endsWith("*/")))
      problems.push(`an unterminated comment ${where}`);
    else if (type === "String" && !(raw.length >= 2 && closedBy(raw, raw[0])))
      problems.push(`an unterminated string ${where}`);
    else if (type === "Url" && !closedBy(raw, ")"))
      problems.push(`an unterminated url ${where}`);
    if (type in closerOf) stack.push([closerOf[type], from]);
    else if (type in closers) {
      const open = stack.pop();
      if (open?.[0] !== closers[type])
        problems.push(`an unmatched ${closers[type]} ${where}`);
    }
    if (inside) continue;
    if (type === "Url")
      problems.push(`a url token ${where} is outside the token policy`);
    else if (type === "Function") {
      const name = asciiLower(ident.decode(raw.slice(0, -1)));
      if (!allowedFunctions.has(name))
        problems.push(
          `function ${name}() ${where} is outside the token policy`,
        );
    } else if (type === "AtKeyword") {
      const name = asciiLower(ident.decode(raw.slice(1)));
      if (!allowedAtRules.has(name))
        problems.push(`@${name} ${where} is outside the token policy`);
    }
  }
  if (at !== text.length) return ["input the tokenizer did not consume"];
  for (const [closer, from] of stack)
    problems.push(
      `an unclosed block or function at byte ${from} (wants ${closer})`,
    );
  if (last !== null && last !== "RightCurlyBracket" && last !== "Semicolon")
    problems.push("the input does not end with } or ;");
  if (exempt !== null && boundaries !== 2)
    problems.push(
      "the admitted slice does not start and end on token boundaries",
    );
  return problems;
}
