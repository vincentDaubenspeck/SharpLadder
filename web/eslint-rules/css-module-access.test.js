// @vitest-environment node
import { RuleTester } from "eslint";
import { afterAll, describe, it } from "vitest";
import rule, { reservedNames } from "./css-module-access.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

const card = 'import styles from "./Card.module.css";\n';

const invalid = [
  ["computed key", `${card}const k = "card";\nstyles[k];`, "computed"],
  [
    "destructuring with a rest element",
    `${card}const { card, ...rest } = styles;`,
    "destructure",
  ],
  ["literal import()", 'import("./Card.module.css");', "dynamic"],
  ["call by dot", `${card}styles.card();`, "call"],
  [
    "default import of .module.scss",
    'import s from "./Card.module.scss";\ns.card;',
    "family",
  ],
  ["argument", `${card}f(styles);`, "escape"],
  [
    "named class import",
    'import { card } from "./Card.module.css";\nf(card);',
    "named",
  ],
  ["namespace import", 'import * as ns from "./Card.module.css";', "namespace"],
  [
    "query-suffixed default import",
    'import s from "./Card.module.css?inline";',
    "query",
  ],
  [
    "re-export of the default",
    'export { default } from "./Card.module.css";',
    "reExport",
  ],
];

tester.run("css-module-access", rule, {
  valid: [
    {
      name: "static reads by dot, string key and destructuring",
      code: `${card}styles.card;
styles["card-title"];
const { title } = styles;`,
    },
  ],
  invalid: [
    ...invalid.map(([name, code, messageId]) => ({
      name,
      code,
      errors: [{ messageId }],
    })),
    {
      name: "a read of every reserved name",
      code: card + reservedNames.map((name) => `styles.${name};`).join("\n"),
      errors: reservedNames.map(() => ({ messageId: "reserved" })),
    },
  ],
});
