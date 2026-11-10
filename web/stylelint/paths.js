import { fileURLToPath } from "node:url";

const web = (relative) =>
  fileURLToPath(new URL(`../${relative}`, import.meta.url));

/** The header module is one configured source identity, compared by canonical path. */
export const productionPaths = {
  src: web("src"),
  tokensFile: web("src/theme/tokens.css"),
  entryFile: web("src/theme/tokens.css"),
  headerModule: web("src/components/AppHeader.module.css"),
  fontsFile: web("src/theme/fonts.css"),
  inventoryFile: web("assets/licences/asset-inventory.json"),
  repoRoot: web(".."),
};

export function ruleOptions({
  tokensFile,
  entryFile,
  headerModule,
  fontsFile,
  inventoryFile,
  repoRoot,
}) {
  return {
    tokensFile,
    entryFile,
    headerModule,
    fontsFile,
    inventoryFile,
    repoRoot,
  };
}
