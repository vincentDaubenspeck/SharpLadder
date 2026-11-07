// Every npm setting that could make an install check skip or narrow its view of the tree.
export const bypassEnv = {
  npm_config_package_lock_only: "true",
  npm_config_global: "true",
  npm_config_location: "global",
  NODE_ENV: "production",
  npm_config_omit: "dev",
};

export const bypassRc =
  "package-lock-only=true\nglobal=true\nlocation=global\nomit=dev\n";
