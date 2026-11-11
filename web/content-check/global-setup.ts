import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { acceptEnvelope } from "./envelope.ts";
import { recordInventory } from "./inventory.ts";
import { runTestRecords } from "./records.ts";

const compiled = join(import.meta.dirname, "..", "compiled");

// Every Vitest run binds the round trip to bytes the compiler has just drift-checked and
// validated; Node never reads a payload file itself.
export default function setup(
  project: Pick<TestProject, "provide">,
  run = runTestRecords,
): void {
  const { stdout, stderr, exit } = run();
  try {
    // The inventory is read only once the compiler has accepted the tree.
    const expected = exit === 0 ? recordInventory(compiled) : [];
    project.provide("contentRecords", acceptEnvelope(stdout, exit, expected));
  } catch (error) {
    throw new Error(`${String(error)}\n${stderr}`, { cause: error });
  }
}
