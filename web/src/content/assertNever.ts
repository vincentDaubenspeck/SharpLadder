// Reached only when data escapes its type, so rendering stops instead of guessing.
export function assertNever(value: never): never {
  throw new Error(`Unknown content variant: ${JSON.stringify(value)}`);
}
