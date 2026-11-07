// A reason on a later line is easily separated from its directive.
const directives = new Set([
  "eslint",
  "eslint-disable",
  "eslint-enable",
  "eslint-disable-line",
  "eslint-disable-next-line",
  "eslint-env",
  "exported",
  "global",
  "globals",
]);

export default {
  meta: {
    type: "problem",
    docs: { description: "Require directive comments to fit on one line" },
    messages: {
      multiLine: "Keep the directive and its -- reason on one line.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const head = comment.value.trimStart().split(/\s/, 1)[0] ?? "";
          if (
            directives.has(head) &&
            comment.loc.start.line !== comment.loc.end.line
          ) {
            context.report({ loc: comment.loc, messageId: "multiLine" });
          }
        }
      },
    };
  },
};
