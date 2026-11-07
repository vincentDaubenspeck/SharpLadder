// The cascade layer order every first-party stylesheet declares before it is compiled.
export const layerOrder = ["tokens", "base", "components", "overrides"];

// The statement fixes the order at the first stylesheet in the bundle, whatever the import order.
export const layerPrelude = `@layer ${layerOrder.join(", ")};\n`;
