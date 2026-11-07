// Fails the production build when anything but canonical first-party source, owned dependency
// files, the approved page and the known virtual modules would enter the bundle.
import { realpathSync } from "node:fs";
import {
  GuardError,
  classifyId,
  cssViolations,
  guardContext,
  htmlViolations,
  isReservedSpecifier,
  pathKey,
  scriptViolations,
} from "./classify.js";
import {
  configViolations,
  publishInventory,
  sameInventory,
  snapshot,
} from "./output.js";
import { layerPrelude } from "./prelude.js";

const message = (error) =>
  error instanceof Error ? error.message : String(error);

export function guard({ worker = false } = {}) {
  let ctx = null;
  let setupError = null;
  let inventory = null;

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

  return {
    name: "sharpladder:build-guard",
    enforce: "pre",
    apply: "build",

    configResolved(config) {
      try {
        const found = worker ? [] : configViolations(config);
        if (found.length > 0) {
          throw new GuardError(`build guard: ${found.join("; ")}`);
        }
        ctx = guardContext(config.root);
      } catch (error) {
        setupError = message(error);
      }
    },

    buildStart() {
      if (worker) this.error("build guard: unexpected worker build");
      if (ctx === null)
        this.error(setupError ?? "build guard: configuration was not resolved");
    },

    transformIndexHtml: {
      order: "pre",
      handler(html, { filename }) {
        if (worker || ctx === null)
          throw new GuardError("build guard: page outside the guarded build");
        if (pathKey(realpathSync.native(filename)) !== ctx.htmlKey) {
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
      return null;
    },

    load(id) {
      check(this, id, "load");
      return null;
    },

    transform(code, id) {
      const kind = check(this, id, "transform");
      if (kind.kind !== "first-party") return null;
      let found;
      if (kind.lang === "css") {
        found = cssViolations(code, id);
      } else {
        try {
          found = scriptViolations(code, id);
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
        try {
          inventory = snapshot(bundle);
        } catch (error) {
          this.error(message(error));
        }
        publishInventory({
          outDir: options.dir,
          files: inventory,
          written: false,
        });
      },
    },

    writeBundle(options, bundle) {
      if (inventory === null) this.error("build guard: no output snapshot");
      try {
        sameInventory(inventory, snapshot(bundle), "the written bundle");
      } catch (error) {
        this.error(message(error));
      }
      publishInventory({
        outDir: options.dir,
        files: inventory,
        written: true,
      });
    },
  };
}
