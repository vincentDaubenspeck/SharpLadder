import { composedConfig } from "./stylelint/config.js";
import { productionPaths, ruleOptions } from "./stylelint/paths.js";

export default composedConfig({
  registry: "production",
  ...ruleOptions(productionPaths),
});
