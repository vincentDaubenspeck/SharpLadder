// The one member the browser token catalogue reads; the registry itself is untyped tooling.
export function productionRegistry(): {
  tokens: Map<
    string,
    { readonly category: string; readonly runtime?: boolean }
  >;
};
