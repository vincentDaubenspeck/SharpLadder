import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { acceptEnvelope } from "./envelope.ts";
import { recordInventory } from "./inventory.ts";
import { type Run, runTestRecords } from "./records.ts";

const compiled = join(import.meta.dirname, "..", "compiled");
const walkVectors = join(
  import.meta.dirname,
  "..",
  "..",
  "tools",
  "SharpLadder.Content.Tests",
  "fixtures",
  "walk-replay",
  "vectors.json",
);

declare module "vitest" {
  export interface ProvidedContext {
    walkReplayVectors: string;
  }
}

// Every Vitest run binds the round trip to bytes the compiler has just drift-checked and
// validated; Node never reads a payload file itself.
export default async function setup(
  project: Pick<TestProject, "provide">,
  run: () => Promise<Run> = runTestRecords,
): Promise<void> {
  const { stdout, stderr, exit } = await run();
  try {
    // The inventory is read only once the compiler has accepted the tree.
    const expected = exit === 0 ? recordInventory(compiled) : [];
    project.provide("contentRecords", acceptEnvelope(stdout, exit, expected));
  } catch (error) {
    throw new Error(`${String(error)}\n${stderr}`, { cause: error });
  }
  // The compiler's tests read the same vectors; a test under src cannot read a file, so it is
  // given the text and parses it there.
  project.provide("walkReplayVectors", readFileSync(walkVectors, "utf8"));
}
