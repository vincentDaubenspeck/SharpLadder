// Serves a guard-verified build read-only from the bytes the guard checked, never from the live directory.
import { createServer } from "node:http";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { releaseBuild } from "../build-guard/build.mjs";
import { sameInventory, walkDist } from "../build-guard/output.js";
import { buildHarness } from "./harness.mjs";
import { buildSpecimen, cleanUp } from "./specimen.mjs";

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
]);

/** A request handler over a fixed inventory; anything outside it is 404 and only GET and HEAD exist. */
export function handler(files) {
  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const { pathname } = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = files.get(path);
    const type = types.get(path.slice(path.lastIndexOf(".")));
    if (file === undefined || type === undefined) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": type,
      "content-length": file.bytes.length,
      "cache-control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : file.bytes);
  };
}

/** The verified inventory of a build: the guard's record, rechecked against the directory once more. */
function verified(record) {
  const files = walkDist(record.outDir);
  sameInventory(record.files, files, `${record.outDir} before serving`);
  return files;
}

export async function serve(kind, port, { tree, records } = {}) {
  let files;
  if (kind === "dist") files = verified(await releaseBuild());
  else if (kind === "specimen") {
    // The throwaway root goes as soon as its bytes are held; nothing is served from disk.
    try {
      files = verified((await buildSpecimen()).built);
    } finally {
      cleanUp();
    }
  } else if (kind === "harness")
    // The harness has no release record; its build refuses to start before the preflight passes.
    files = walkDist(
      (
        await buildHarness({
          ...(tree === undefined ? {} : { tree }),
          ...(records === undefined ? {} : { records }),
        })
      ).outDir,
    );
  else
    throw new Error(
      `serve: unknown build ${kind}; expected dist, specimen or harness`,
    );
  const server = createServer(handler(files));
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", done);
  });
  console.log(
    `serving ${kind} (${files.size} files) on http://127.0.0.1:${port}/`,
  );
  return server;
}

const invoked =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));

if (invoked) {
  const [kind, port] = process.argv.slice(2);
  try {
    await serve(kind ?? "", Number(port));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
