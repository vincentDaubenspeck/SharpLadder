// The theme specimen: the shipped theme sheets plus specimen modules, built by the release guard in a throwaway root.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  cleanUp,
  fixture,
  inventoryFile,
  releaseRoot,
  sliceRecordFile,
} from "../build-guard/fixture.js";
import { lintProduction } from "../stylelint/lint-production.js";

const web = join(import.meta.dirname, "..");
const theme = (name) => readFileSync(join(web, "src", "theme", name), "utf8");
const repo = join(web, "..");

/**
 * The shipped font slice as the release build admits it: the production inventory, slice
 * record, font sheet, faces and licence texts, so the specimen renders in the real font stacks.
 */
function fontSlice() {
  const inventory = JSON.parse(readFileSync(join(web, inventoryFile), "utf8"));
  const local = (path) => path.replace(/^web\//u, "");
  const files = {
    [inventoryFile]: readFileSync(join(web, inventoryFile)),
    [sliceRecordFile]: readFileSync(join(web, sliceRecordFile)),
    "src/theme/fonts.css": theme("fonts.css"),
  };
  for (const asset of inventory.assets.filter((entry) => entry.shipped)) {
    const text = asset.licenceText.sourcePath;
    files[local(text)] = readFileSync(join(repo, text));
    for (const file of asset.distributedFiles)
      files[local(file.sourcePath)] = readFileSync(join(repo, file.sourcePath));
  }
  return files;
}

const layer = (body) => `@layer components {\n${body}}\n`;

/** Specimen modules; each is one components block, as a production module must be. */
const modules = {
  "src/specimen/iso-a.module.css": layer(`  .box {
    color: var(--accent);
  }
`),
  "src/specimen/iso-b.module.css": layer(`  .box {
    color: var(--warm);
  }
`),
  "src/specimen/order.module.css": layer(`  .code {
    font-family: var(--font-ui);
  }
`),
  "src/specimen/focus.module.css": layer(`  .target {
    padding: var(--space-0-5);
  }

  .target:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .panel {
    overflow: auto;
    padding: var(--space-0-5);
  }
`),
  "src/specimen/rings.module.css": layer(`  .rung {
    padding: var(--space-0-5);
    border-radius: var(--r-pill);
    outline: 4px solid var(--accent-soft);
    outline-offset: 0;
  }

  .read {
    outline: 3px solid var(--accent-soft);
    outline-offset: 0;
  }

  .narrow {
    display: inline-block;
    inline-size: min-content;
  }
`),
  // The tab pads its block end instead of a rest border, which forced colours would paint.
  // That room equals the 2px indicator only at a 16px root, so it is not shown layout-preserving.
  "src/specimen/strokes.module.css": layer(`  .stroke {
    display: inline-block;
    box-sizing: border-box;
    inline-size: 0;
    padding-block: var(--space-0-75);
    border-inline-start: 2px solid var(--line-2);
  }

  .tab {
    padding: var(--space-0-5);
    padding-block-end: var(--space-0-625);
  }

  .src {
    padding: var(--space-0-5);
    border: 2px solid var(--text);
  }

  .dst {
    padding: var(--space-0-5);
    border: 2px dashed var(--text);
  }
`),
};

// Modules first and the token sheet last, so layer order can come only from the build.
// The wrapped reading span ends in a glyph no shipped face covers, so its ring spans a substituted run.
const main = `import a from "./specimen/iso-a.module.css";
import b from "./specimen/iso-b.module.css";
import order from "./specimen/order.module.css";
import focus from "./specimen/focus.module.css";
import rings from "./specimen/rings.module.css";
import strokes from "./specimen/strokes.module.css";
import "./theme/base.css";
import "./theme/fonts.css";
import "./theme/tokens.css";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
createRoot(root).render(
  <main>
    <div data-spec="iso-a" className={a.box}>Isolated A</div>
    <div data-spec="iso-b" className={b.box}>Isolated B</div>
    <code data-spec="order" className={order.code}>layered</code>
    <code data-spec="plain">plain</code>
    <button data-spec="focus" className={focus.target}>Focus</button>
    <div data-spec="rung" className={rings.rung}>Current rung</div>
    <div className={rings.narrow}>
      <span data-spec="read" className={rings.read}>
        Reading highlight that wraps across more than one line 漢.
      </span>
    </div>
    <p>
      <span data-spec="nest" className={rings.read}>
        Nested <button data-spec="nested" className={focus.target}>term</button>
      </span>
    </p>
    <div data-spec="panel" className={focus.panel}>
      <button data-spec="clipped" className={focus.target}>Inside</button>
    </div>
    <span data-spec="stroke" className={strokes.stroke}></span>
    <div data-spec="tab" className={strokes.tab}>Tab at rest</div>
    <div data-spec="src" className={strokes.src}>Source</div>
    <div data-spec="dst" className={strokes.dst}>Destination</div>
    <div data-spec="work" className="work"></div>
  </main>,
);
`;

/** Every file the specimen root holds; the theme sheets and fonts are the shipped ones, byte for byte. */
export function specimenFiles() {
  return {
    ...modules,
    ...fontSlice(),
    "src/theme/tokens.css": theme("tokens.css"),
    "src/theme/base.css": theme("base.css"),
    "src/main.tsx": main,
  };
}

/** Builds the specimen through the release guard; returns the verified output directory. */
export async function buildSpecimen(files = specimenFiles()) {
  const lint = await lintSpecimen(files);
  if (lint.state !== "pass")
    throw new Error(`specimen lint: ${lint.lines.join("; ")}`);
  const { root } = fixture(files, { tokens: false });
  const built = await releaseRoot(root);
  return { outDir: built.outDir, built };
}

/**
 * The production stylesheet lint over the specimen files, in a throwaway tree laid out as the
 * production one, with the production registry; the release build runs this lint first.
 */
export async function lintSpecimen(files = specimenFiles()) {
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), "sl-specimen-")));
  const root = join(repo, "web");
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return await lintProduction({
      src: join(root, "src"),
      tokensFile: join(root, "src", "theme", "tokens.css"),
      entryFile: join(root, "src", "theme", "tokens.css"),
      headerModule: join(root, "src", "components", "AppHeader.module.css"),
      fontsFile: join(root, "src", "theme", "fonts.css"),
      inventoryFile: join(root, "assets", "licences", "asset-inventory.json"),
      repoRoot: repo,
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

export { cleanUp };
