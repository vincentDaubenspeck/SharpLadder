// Editor feedback for the source policy; the build guard applies the same engine to the same
// parser output and ignores disable comments, so silencing this rule never silences the build.
import { checkProgram } from "../source-policy/index.js";

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
      unsupported:
        "{{name}} is outside the syntax the source policy understands, so it fails.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        for (const finding of checkProgram(
          node,
          context.sourceCode.scopeManager,
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
