// Verifies a download against the digest pinned in tools/tool-pins.json.
import { createHash } from "node:crypto";

const labels = { sha512: "SHA-512", sha256: "SHA-256" };

// Prefers SHA-512 because some publishers, the .NET SDK among them, publish only that.
export function digestOf(asset) {
  const algo = ["sha512", "sha256"].find((a) => typeof asset[a] === "string" && asset[a] !== "");
  if (!algo) throw new Error("no pinned SHA-512 or SHA-256 digest");
  return { algo, value: asset[algo] };
}

export function checkDigest(name, asset, data) {
  const { algo, value } = digestOf(asset);
  const got = createHash(algo).update(data).digest("hex");
  if (got !== value) {
    throw new Error(`${name}: ${labels[algo]} mismatch (expected ${value}, got ${got})`);
  }
  return algo;
}
