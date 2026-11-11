import { slotOf } from "./slot.ts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What a parsed content record fails to prove about its audio slots: every section holding a
 * slot equal to the hash of its own segment texts, in their stored order. A section without
 * speech, or anything that is not the expected shape, is a problem, never a section passed over.
 */
export function slotProblems(doc: unknown): string[] {
  if (!isObject(doc) || !Array.isArray(doc["sections"]))
    return ["the record has no sections"];
  const sections: unknown[] = doc["sections"];
  return sections.flatMap((section, index) => {
    const at = `section ${String(index + 1)}`;
    const spoken = isObject(section) ? section["spoken"] : undefined;
    if (!isObject(spoken) || !Array.isArray(spoken["segments"]))
      return [`${at}: no spoken segments`];
    const segments: unknown[] = spoken["segments"];
    const texts = segments.map((s) => (isObject(s) ? s["text"] : undefined));
    let slot: string;
    try {
      slot = slotOf(texts);
    } catch (error) {
      return [`${at}: ${String(error)}`];
    }
    return spoken["audio"] === slot
      ? []
      : [`${at}: the slot is not the hash of its segment texts`];
  });
}
