// What the Vitest global setup provides: the records it accepted from the compiler's
// test-records command, and the text of the walk-it replay vectors file.
declare module "vitest" {
  export interface ProvidedContext {
    contentRecords: readonly {
      readonly path: string;
      readonly kind: string;
      readonly part: string | null;
      readonly text: string;
    }[];
    walkReplayVectors: string;
  }
}

export {};
