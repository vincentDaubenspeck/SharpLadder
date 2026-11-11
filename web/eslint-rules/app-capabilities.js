// Editor feedback for the source policy; the build guard applies the same engine to the same
// parser output and ignores disable comments, so silencing this rule never silences the build.
import { fileURLToPath } from "node:url";
import { checkProgram } from "../source-policy/index.js";
import { sourceIdentity } from "../source-policy/unit.js";

const root = fileURLToPath(new URL("../", import.meta.url));

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban import.meta, import(), workers, code generation, browser globals and import attributes in application source",
    },
    messages: {
      importMeta: "import.meta is not allowed in application source.",
      dynamicImport:
        "dynamic import() is not allowed in application source yet.",
      global:
        '{{name}} is not allowed in application source, in any form; the only document use is document.getElementById("root").',
      attributes: "Import attributes are not allowed in application source.",
      requireImport: "import = require() is not allowed in application source.",
      renderer: "{{name}}.",
      identity: "This file's place under src is not established: {{name}}.",
      unsupported:
        "{{name}} is outside the syntax the source policy understands, so it fails.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        // The file's real place under src selects the renderer rules; a file outside src has none.
        const { unit, error } = sourceIdentity(root, context.filename);
        if (error !== undefined)
          context.report({
            node,
            messageId: "identity",
            data: { name: error },
          });
        for (const finding of checkProgram(
          node,
          context.sourceCode.scopeManager,
          unit,
          context.sourceCode.text,
          context.sourceCode.hasBOM,
        )) {
          context.report({
            node: finding.node,
            messageId: finding.kind,
            data: { name: finding.name },
          });
        }
      },
    };
  },
};
