import { ESLint } from "eslint";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const web = dirname(dirname(fileURLToPath(import.meta.url)));

// Probe files do not exist on disk, so the project service opens them in a
// default project built from the real tsconfig; the lint policy is unchanged.
export const production = new ESLint({
  cwd: web,
  overrideConfig: {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["src/*.ts", "src/*.tsx"],
          defaultProject: "tsconfig.json",
        },
      },
    },
  },
});
