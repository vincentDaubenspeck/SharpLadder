import { createHash } from "node:crypto";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Freezes every plain object and array reachable from value; Buffers, Maps and Sets stay as they are. */
function freezePlain(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return value;
  for (const child of Object.values(value)) freezePlain(child);
  return Object.freeze(value);
}

/**
 * Freezes the admission's reachable plain data and returns a view of what it exposes. The claims,
 * expected bytes and face sets that admit closes over cannot be reached from here; the outcomes
 * compared beside this view show them unchanged.
 */
export function shareAdmission(admission) {
  freezePlain(admission);
  return () => ({
    problems: [...admission.problems],
    licenceTexts: admission.licenceTexts.map(({ path, bytes }) => ({
      path,
      sha256: hash(bytes),
    })),
    inventory: structuredClone(admission.inventory),
  });
}

/** A caller's map in a comparable form, with each Buffer by its hash. */
export const entriesOf = (map) =>
  [...map].map(([key, value]) => [
    key,
    Buffer.isBuffer(value) ? hash(value) : value,
  ]);
