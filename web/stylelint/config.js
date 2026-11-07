import { fileURLToPath } from "node:url";
import { systemColours } from "./colours.js";

export function composedConfig(tokenOptions) {
  return {
    // Stylesheet bytes are untrusted, so a disable comment in one must not switch a rule off.
    ignoreDisables: true,
    extends: ["stylelint-config-standard"],
    plugins: [fileURLToPath(new URL("token-rule.js", import.meta.url))],
    rules: {
      "color-no-hex": true,
      "color-named": "never",
      "no-duplicate-selectors": true,
      "declaration-no-important": true,
      "at-rule-allowed-list": ["layer", "media"],
      "value-keyword-case": [
        "lower",
        {
          camelCaseSvgKeywords: true,
          ignoreKeywords: [...systemColours].map(caseInsensitive),
        },
      ],
      "sharpladder/tokens": [true, tokenOptions],
    },
    overrides: [
      {
        // Colour literals live only in tokens.css; the token rule still checks it fully.
        files: [tokenOptions.tokensFile],
        rules: {
          "color-no-hex": null,
          "color-named": null,
          "color-hex-length": null,
        },
      },
    ],
  };
}

function caseInsensitive(keyword) {
  return new RegExp(`^${keyword}$`, "i");
}
