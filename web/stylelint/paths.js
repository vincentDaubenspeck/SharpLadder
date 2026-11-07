import { fileURLToPath } from "node:url";

const web = (relative) =>
  fileURLToPath(new URL(`../${relative}`, import.meta.url));

/** The header module is one configured source identity, compared by canonical path. */
export const productionPaths = {
  src: web("src"),
  tokensFile: web("src/theme/tokens.css"),
  entryFile: web("src/index.css"),
  headerModule: web("src/components/AppHeader.module.css"),
};

export function ruleOptions({ tokensFile, entryFile, headerModule }) {
  return { tokensFile, entryFile, headerModule };
}
