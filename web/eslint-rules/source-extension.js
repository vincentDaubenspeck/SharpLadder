// A file with another code extension would escape the type-aware application
// lint, so its presence alone is the error.
export default {
  meta: {
    type: "problem",
    docs: { description: "Require application source to be .ts or .tsx" },
    messages: { extension: "application source must be .ts or .tsx." },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        context.report({ node, messageId: "extension" });
      },
    };
  },
};
