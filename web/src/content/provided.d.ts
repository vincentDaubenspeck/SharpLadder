// The records the Vitest global setup accepted from the compiler's test-records command.
declare module "vitest" {
  export interface ProvidedContext {
    contentRecords: readonly {
      readonly path: string;
      readonly kind: string;
      readonly text: string;
    }[];
  }
}

export {};
