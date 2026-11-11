// Fails the production build when anything but canonical first-party source, owned dependency
// files, the approved page and the known virtual modules would enter the bundle.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assetAdmission } from "../asset-licence-check.js";
import {
  GuardError,
  classifyId,
  cssViolations,
  guardContext,
  htmlViolations,
  isReservedSpecifier,
  projectPath,
  isTestOnly,
  scriptViolations,
  sourceUnit,
} from "./classify.js";
import {
  configViolations,
  pipelineViolations,
  publishInventory,
  sameInventory,
  snapshot,
} from "./output.js";
import { lightningViolations } from "./contract.js";
import { rendererModules } from "../source-policy/renderer.js";
import { canonical } from "../source-policy/unit.js";
import { layerPrelude } from "./prelude.js";
import {
  collect,
  minifySheet,
  moduleViolations,
  parseSheet,
  sameEntries,
  sheetKey,
  tokenManifest,
  tokensPath,
} from "./provenance.js";

// Asset files are the validator's to admit, so the release step never counts them as guard-owned.
const assetPaths = (inventory) =>
  new Set(
    inventory.assets
      .filter((asset) => asset.shipped)
      .flatMap((asset) => [
        ...asset.distributedFiles.map((file) => file.distPath),
        asset.licenceText.distributionPath,
      ]),
  );

/** A1: a leading BOM or any CR is rejected before anything parses or prepends the source. */
function byteViolation(raw) {
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
    return "starts with a byte order mark at byte 0";
  const cr = raw.indexOf(0x0d);
  return cr === -1 ? null : `holds a carriage return at byte ${cr}`;
}

const message = (error) =>
  error instanceof Error ? error.message : String(error);

export function guard({ worker = false } = {}) {
  let ctx = null;
  let setupError = null;
  let inventory = null;
  let admission = null;
  let evidence = null;
  let manifest = null;
  let lightning = null;
  // C0 records per canonical source key: raw hash, bind count, expected AST of E, C1 uses.
  const ledger = new Map();

  // C1: the compile input must be exactly one module's expected AST, never an ambiguous one.
  const visitor = {
    StyleSheet(sheet) {
      const key = sheetKey(sheet);
      const matches = [...ledger].filter(
        ([, record]) => record.expected === key,
      );
      if (matches.length !== 1) {
        throw new GuardError(
          `build guard: C1 compile input matches ${matches.length} C0 records`,
        );
      }
      const [[source, record]] = matches;
      record.consumed += 1;
      const found = moduleViolations(collect(sheet), {
        tokens: record.tokens,
        where: `${source} at C1`,
      });
      if (found.length > 0)
        throw new GuardError(`build guard: ${found.join("; ")}`);
    },
  };

  const visitorStyleSheet = visitor.StyleSheet;

  // C2: the sole sanctioned minification; it must run before the guard's snapshot.
  const minify = {
    name: "sharpladder:css-minify",
    enforce: "post",
    apply: "build",
    generateBundle(options, bundle) {
      if (worker) this.error("build guard: unexpected worker build");
      const sheets = Object.values(bundle).filter(
        (out) => out.type === "asset" && out.fileName.endsWith(".css"),
      );
      if (sheets.length !== 1)
        this.error(
          `build guard: expected one stylesheet at C2, found ${sheets.length}`,
        );
      if (manifest === null)
        this.error(`build guard: ${tokensPath} was never bound`);
      for (const sheet of sheets) {
        const source = Buffer.from(sheet.source).toString("utf8");
        try {
          const found = collect(parseSheet(source));
          const problems = moduleViolations(found, {
            tokens: true,
            where: `${sheet.fileName} at C2`,
          });
          if (problems.length > 0)
            throw new GuardError(`build guard: ${problems.join("; ")}`);
          sameEntries(
            manifest.stage1,
            found.entries,
            `${sheet.fileName} at C2`,
          );
          sheet.source = minifySheet(source);
        } catch (error) {
          this.error(message(error));
        }
      }
    },
  };

  // Every hook classifies under the plugin context so a failure stops the build with exit 1.
  const check = (plugin, id, hook) => {
    if (worker) plugin.error("build guard: unexpected worker build");
    if (ctx === null)
      plugin.error(setupError ?? "build guard: configuration was not resolved");
    try {
      return classifyId(ctx, id, hook);
    } catch (error) {
      return plugin.error(message(error));
    }
  };

  // A5, C0 side: the stylesheets the chunks carry are exactly those bound once each at C0.
  const ledgerViolations = (plugin, bundle) => {
    const carried = new Set();
    for (const out of Object.values(bundle)) {
      if (out.type !== "chunk") continue;
      for (const id of out.moduleIds) {
        // Virtual ids are never first-party stylesheets; the buildEnd walk classifies them.
        if (id.startsWith("\0")) continue;
        const kind = check(plugin, id, "getModuleIds");
        if (kind.kind === "first-party" && kind.lang === "css")
          carried.add(canonical(id));
      }
    }
    for (const key of carried) {
      if (!ledger.has(key))
        plugin.error(`build guard: ${key} reached the bundle unbound`);
    }
    if (ledger.size === 0)
      plugin.error("build guard: the build has no stylesheet");
    if (manifest === null)
      plugin.error(`build guard: ${tokensPath} was never bound`);
    const registry = new Set(manifest.names);
    // Sorted by source so the evidence does not depend on transform scheduling.
    const sorted = [...ledger].sort(([a], [b]) => (a < b ? -1 : 1));
    return sorted.map(([key, record]) => {
      const { sha256, bound, consumed, names, tokens, source } = record;
      if (!carried.has(key))
        plugin.error(`build guard: ${key} was bound but never bundled`);
      if (bound !== 1)
        plugin.error(`build guard: ${key} was bound ${bound} times`);
      if (consumed !== 1)
        plugin.error(`build guard: ${key} reached C1 ${consumed} times`);
      // A registry name declared elsewhere would be erased or override the token (T 4.4).
      const taken = tokens ? [] : names.filter((name) => registry.has(name));
      if (taken.length > 0)
        plugin.error(
          `build guard: ${source} declares the token ${taken.join(", ")}`,
        );
      return { source, sha256, bound, consumed };
    });
  };

  return {
    name: "sharpladder:build-guard",
    enforce: "pre",
    apply: "build",

    visitor,
    minify,

    configResolved(config) {
      try {
        const found = worker ? [] : configViolations(config);
        lightning = config.css.lightningcss ?? {};
        if (!worker) {
          // Absence, replacement, wrapping or an added callback all change this identity (A2).
          const used = lightning.visitor;
          if (
            used !== visitor ||
            Object.keys(used).join() !== "StyleSheet" ||
            used.StyleSheet !== visitorStyleSheet
          )
            found.push(
              "css.lightningcss.visitor is not the guard's C1 visitor",
            );
          const resolved = config.plugins.find(
            ({ name }) => name === minify.name,
          );
          // Only the object is pinned: the A4 harness changes its hook order in place.
          if (resolved !== minify)
            found.push("the C2 plugin is not the guard's own");
          found.push(...lightningViolations());
        }
        if (found.length > 0) {
          throw new GuardError(`build guard: ${found.join("; ")}`);
        }
        ctx = guardContext(config.root);
      } catch (error) {
        setupError = message(error);
      }
    },

    async buildStart() {
      if (worker) this.error("build guard: unexpected worker build");
      if (ctx === null)
        this.error(setupError ?? "build guard: configuration was not resolved");
      // Plugins supplied through build options join here, after the configuration check.
      const pipeline = pipelineViolations(this.environment?.plugins ?? []);
      if (pipeline.length > 0)
        this.error(`build guard: ${pipeline.join("; ")}`);
      // The App never imports the renderer, so the transform hook alone would not see its modules.
      const renderer = [];
      for (const unit of rendererModules.keys()) {
        const file = join(ctx.root, "src", unit);
        try {
          const text = readFileSync(file, "utf8");
          const actual = sourceUnit(ctx, file);
          if (actual !== unit)
            renderer.push(`src/${unit} is on disk as src/${actual}`);
          else renderer.push(...scriptViolations(text, file, unit));
        } catch (error) {
          renderer.push(`src/${unit} cannot be read: ${message(error)}`);
        }
      }
      if (renderer.length > 0)
        this.error(`build guard: ${[...new Set(renderer)].join("; ")}`);
      ledger.clear();
      manifest = null;
      // The licence texts reach the output only through the inventory that binds their hashes.
      admission = await assetAdmission({ root: join(ctx.root, "..") });
      if (admission.problems.length > 0)
        this.error(`build guard: assets: ${admission.problems.join("; ")}`);
      for (const { path, bytes } of admission.licenceTexts)
        this.emitFile({ type: "asset", fileName: path, source: bytes });
    },

    outputOptions(options) {
      // Rolldown asks for output options before buildStart, so a configuration failure reports first.
      if (!worker && ctx === null)
        throw new GuardError(
          setupError ?? "build guard: configuration was not resolved",
        );
      // Output plugins never appear in the environment's plugin list.
      if (
        options !== null &&
        typeof options === "object" &&
        "plugins" in options
      )
        throw new GuardError("build guard: output options carry plugins");
      return null;
    },

    transformIndexHtml: {
      order: "pre",
      handler(html, { filename }) {
        if (worker || ctx === null)
          throw new GuardError("build guard: page outside the guarded build");
        if (canonical(filename) !== ctx.html) {
          throw new GuardError(`build guard: unexpected page ${filename}`);
        }
        const found = htmlViolations(html);
        if (found.length > 0) {
          throw new GuardError(
            `build guard: index.html is not the approved page: ${found.join("; ")}`,
          );
        }
        return html;
      },
    },

    async resolveId(source, importer, options) {
      const from =
        importer === undefined ? null : check(this, importer, "resolveId");
      if (from?.kind === "first-party" && isReservedSpecifier(source)) {
        this.error(
          `build guard: ${importer} imports the reserved specifier ${JSON.stringify(source)}`,
        );
      }
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (resolved === null || resolved.external) {
        this.error(
          `build guard: ${JSON.stringify(source)} from ${importer ?? "the entry"} did not resolve to a bundled module`,
        );
      }
      const target = check(this, resolved.id, "resolveId");
      if (target.kind === "virtual" && from?.kind !== "html") {
        this.error(
          `build guard: virtual ${JSON.stringify(resolved.id)} imported from ${importer ?? "the entry"}`,
        );
      }
      // 4.2: Vite resolves links away, so a stylesheet path is compared before it does.
      if (
        from?.kind === "first-party" &&
        target.kind === "first-party" &&
        target.lang === "css" &&
        source.startsWith(".") &&
        resolve(dirname(importer), source) !== resolve(resolved.id)
      ) {
        this.error(
          `build guard: ${JSON.stringify(source)} from ${importer} reaches ${resolved.id} through a link or alias`,
        );
      }
      return null;
    },

    load(id) {
      check(this, id, "load");
      return null;
    },

    transform(code, id) {
      const kind = check(this, id, "transform");
      // 4.7: no vendor stylesheet is compiled into the bundle.
      if (kind.kind !== "first-party") {
        if (/\.css(?:$|\?)/u.test(id))
          this.error(`build guard: ${id} is a stylesheet outside the project`);
        return null;
      }
      let found;
      if (kind.lang === "css") {
        // 4.2: identity is the real path, so a link or a case alias is never bound.
        if (realpathSync.native(id) !== resolve(id))
          this.error(`build guard: ${id} is not its own real path`);
        const raw = readFileSync(id);
        const bad = byteViolation(raw);
        if (bad !== null) this.error(`build guard: ${id} ${bad}`);
        // Anything that changed the bytes before this hook would otherwise be bound as source.
        if (raw.toString("utf8") !== code)
          this.error(`build guard: ${id} reached the guard altered`);
        const key = canonical(id);
        const source = projectPath(ctx, key);
        const held = ledger.get(key);
        const sha256 = createHash("sha256").update(raw).digest("hex");
        const tokens = source === tokensPath;
        found = cssViolations(code, id);
        if (found.length > 0)
          this.error(
            `build guard: ${id} uses ${[...new Set(found)].join(", ")}`,
          );
        // The expected record is the AST of E, the exact input the compile stage receives.
        const expected = layerPrelude + code;
        let sheet;
        try {
          sheet = parseSheet(expected, {
            filename: id,
            cssModules: id.endsWith(".module.css")
              ? lightning.cssModules
              : undefined,
          });
          const collected = collect(sheet);
          const bad = moduleViolations(collected, { tokens, where: source });
          if (bad.length > 0) throw new GuardError(bad.join("; "));
          if (tokens) manifest = tokenManifest(expected, sha256);
          ledger.set(key, {
            source,
            sha256,
            tokens,
            bound: (held?.bound ?? 0) + 1,
            consumed: held?.consumed ?? 0,
            expected: sheetKey(sheet),
            names: collected.names,
          });
        } catch (error) {
          // Positions are over E, so lines include the prelude; columns are zero-based as Vite reports them.
          const at = error?.loc
            ? `:${error.loc.line}:${error.loc.column - 1}`
            : "";
          this.error(`build guard: ${source}${at}: ${message(error)}`);
        }
      } else {
        try {
          found = scriptViolations(code, id, sourceUnit(ctx, id));
        } catch (error) {
          this.error(`build guard: cannot parse ${id}: ${message(error)}`);
        }
      }
      if (found.length > 0)
        this.error(`build guard: ${id} uses ${[...new Set(found)].join(", ")}`);
      // Lines shift down by one; no source map is emitted, so only compile error positions move.
      if (kind.lang === "css") return { code: layerPrelude + code, map: null };
      return null;
    },

    moduleParsed(info) {
      check(this, info.id, "moduleParsed");
    },

    buildEnd(error) {
      if (error) return;
      for (const id of this.getModuleIds()) {
        const kind = check(this, id, "getModuleIds");
        const info = this.getModuleInfo(id);
        if (info === null || info.isExternal)
          this.error(`build guard: ${id} has no bundled module`);
        // The resolved production graph: every module the entry reaches.
        if (kind.kind === "first-party" && isTestOnly(sourceUnit(ctx, id))) {
          this.error(
            `build guard: test-only module ${sourceUnit(ctx, id)} is reachable from the production entry through ${info.importers.join(", ")}`,
          );
        }
        if (
          kind.kind === "first-party" &&
          info.dynamicallyImportedIds.length > 0
        ) {
          this.error(`build guard: ${id} has a dynamic import`);
        }
        if (kind.kind === "virtual") {
          for (const importer of info.importers) {
            if (check(this, importer, "getModuleIds").kind !== "html") {
              this.error(
                `build guard: virtual ${JSON.stringify(id)} imported by ${importer}`,
              );
            }
          }
        }
      }
    },

    // Post order runs after css-post and build-html have added their files, as tests show.
    generateBundle: {
      order: "post",
      handler(options, bundle) {
        const verified = ledgerViolations(this, bundle);
        evidence = { root: ctx.root, ledger: verified, manifest };
        try {
          inventory = snapshot(bundle, admission.check);
        } catch (error) {
          this.error(message(error));
        }
        publishInventory({
          ...evidence,
          outDir: options.dir,
          files: inventory,
          assets: assetPaths(admission.inventory),
          written: false,
        });
      },
    },

    writeBundle(options, bundle) {
      if (inventory === null) this.error("build guard: no output snapshot");
      try {
        sameInventory(
          inventory,
          snapshot(bundle, admission.check),
          "the written bundle",
        );
      } catch (error) {
        this.error(message(error));
      }
      publishInventory({
        ...evidence,
        outDir: options.dir,
        files: inventory,
        assets: assetPaths(admission.inventory),
        written: true,
      });
    },
  };
}
