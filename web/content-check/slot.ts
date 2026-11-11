import { createHash } from "node:crypto";

function fail(reason: string): never {
  throw new Error(`audio slot refused: ${reason}`);
}

const isNoncharacter = (point: number) =>
  (point & 0xfffe) === 0xfffe || (point >= 0xfdd0 && point <= 0xfdef);

// A fresh array of primitive strings, so nothing the caller passed can answer for itself when
// the array is written out.
function checked(texts: unknown): string[] {
  if (!Array.isArray(texts)) fail("the segment texts are not an array");
  const list: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (!Object.hasOwn(texts, i)) fail(`text ${String(i)} is missing`);
    const text: unknown = texts[i];
    if (typeof text !== "string") fail(`text ${String(i)} is not a string`);
    if (!text.isWellFormed()) fail(`text ${String(i)} holds a lone surrogate`);
    list.push(text);
  }
  return list;
}

/** Whether text is as the compiler stores it: well formed, no noncharacter, LF only, NFC. */
export function isStoredForm(text: string): boolean {
  if (!text.isWellFormed() || text.includes("\r")) return false;
  for (const character of text) {
    if (isNoncharacter(character.codePointAt(0) ?? 0)) return false;
  }
  return text.normalize("NFC") === text;
}

/**
 * The RFC 8785 bytes of an array of strings. JSON.stringify gives exactly those bytes for a dense
 * array of well-formed strings and for nothing else, so every other input is refused first.
 */
export function serialiseTexts(texts: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(checked(texts)));
}

/** The audio slot of a section's segment texts, refusing any text not in its stored form. */
export function slotOf(texts: unknown): string {
  const list = checked(texts);
  list.forEach((text, i) => {
    if (!isStoredForm(text))
      fail(`text ${String(i)} is not in its stored form`);
  });
  const digest = createHash("sha256").update(serialiseTexts(list));
  return `sha256:${digest.digest("hex")}`;
}
