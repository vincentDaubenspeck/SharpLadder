// Tool installer cases for tools/install-tools.mjs: downloads come from a local server and pauses are
// recorded instead of waited, so the retry rules are tested without the network or real delays.
// The reference pack cases build stand-in archives with the Python of the installed yamllint environment.
// Usage: node tools/tests/install-tools-cases.mjs <empty work directory>
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { download, installBinary, installDotnet, installReference } from "../install-tools.mjs";

const tools = join(import.meta.dirname, "..");
if (!process.argv[2]) throw new Error("usage: node tools/tests/install-tools-cases.mjs <empty work directory>");
const work = resolve(process.argv[2]);
mkdirSync(work, { recursive: true });
const platform = `${process.platform}-${process.arch}`;
const win = process.platform === "win32";
const name = "stand-in-tool";
const archive = Buffer.from("stand-in archive bytes\n".repeat(64));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const sha512 = (data) => createHash("sha512").update(data).digest("hex");
// The installer creates this interpreter in every installed tree; the cases only run it and install into their own folders.
const python = join(tools, "..", ".tools", "venv", win ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) throw new Error(`no Python at ${python}; install the pinned tools first`);

let failed = 0;
function check(label, problems) {
  console.log(`${problems.length === 0 ? "PASS" : "FAIL"} install-tools: ${label}`);
  if (problems.length === 0) return;
  failed++;
  for (const p of problems) console.log(`  ${p}`);
}
const expect = (problems, ok, text) => ok || problems.push(text);

function send(res, status, body) {
  res.writeHead(status, { "content-length": Buffer.byteLength(body) });
  res.end(body);
}

// Headers and half the body arrive, then the connection closes, as in the dropped CI downloads.
function dropMidBody(res) {
  res.writeHead(200, { "content-length": archive.length });
  res.write(archive.subarray(0, Math.floor(archive.length / 2)), () => res.socket.destroy());
}

const requests = [];
// Bodies for the reference pack cases, by request path.
const served = new Map();
const server = createServer((req, res) => {
  requests.push(req.url);
  switch (req.url) {
    case "/t1/archive.tar.gz":
      if (requests.filter((u) => u === req.url).length === 1) dropMidBody(res);
      else send(res, 200, archive);
      break;
    case "/t2/archive.tar.gz":
      send(res, 503, "unavailable");
      break;
    case "/t3/archive.tar.gz":
      send(res, 404, "not found");
      break;
    case "/t5/archive.tar.gz":
      send(res, 200, archive);
      break;
    default:
      if (served.has(req.url)) send(res, 200, served.get(req.url));
      else send(res, 404, "no such case");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;
const asset = (path, data = archive) => ({ url: `${base}${path}`, sha256: sha256(data) });

// Stderr is captured so a case can check the retry lines; the pause stub records waits instead of waiting.
async function call(dir, fn) {
  const dest = join(work, dir);
  mkdirSync(join(dest, "bin"), { recursive: true });
  const pauses = [];
  const lines = [];
  const before = requests.length;
  const write = process.stderr.write;
  process.stderr.write = (chunk) => {
    lines.push(...String(chunk).split("\n").filter((l) => l !== ""));
    return true;
  };
  let value = null;
  let error = null;
  try {
    value = await fn({ pins: {}, dest, pause: async (ms) => void pauses.push(ms) });
  } catch (err) {
    error = err;
  } finally {
    process.stderr.write = write;
  }
  return { dest, value, error, pauses, lines, requests: requests.slice(before) };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

{
  const p = [];
  const a = asset("/t1/archive.tar.gz");
  const observed = [];
  const realFetch = globalThis.fetch;
  // Passes every call through and rethrows each rejection unchanged, keeping it for the comparison.
  globalThis.fetch = async (...args) => {
    let res;
    try {
      res = await realFetch(...args);
    } catch (err) {
      observed.push({ stage: "fetch", err });
      throw err;
    }
    const read = res.arrayBuffer.bind(res);
    res.arrayBuffer = async () => {
      try {
        return await read();
      } catch (err) {
        observed.push({ stage: "body", err });
        throw err;
      }
    };
    return res;
  };
  let r;
  try {
    r = await call("t1", (ctx) => download(ctx, name, a));
  } finally {
    globalThis.fetch = realFetch;
  }
  expect(p, r.error === null, `download rejected: ${r.error?.message}`);
  expect(p, r.value !== null && readFileSync(r.value.file).equals(archive), "the archive differs from the served bytes");
  expect(p, r.requests.length === 2, `requests ${r.requests.length}, expected 2`);
  expect(p, same(r.pauses, [1000]), `pauses ${JSON.stringify(r.pauses)}, expected [1000]`);
  expect(p, observed.length === 1 && observed[0].stage === "body",
    `observed failures ${JSON.stringify(observed.map((o) => o.stage))}, expected one body read`);
  const outer = observed[0]?.err;
  const nested = [];
  const seen = new Set([outer]);
  for (let e = outer?.cause; e !== undefined && e !== null && !seen.has(e); e = e.cause) {
    seen.add(e);
    if (typeof e.message === "string" && e.message !== "") nested.push(e.message);
    if (typeof e.code === "string" || typeof e.code === "number") nested.push(String(e.code));
  }
  expect(p, nested.length > 0, "the body-read failure carried no nested message or code");
  const line = r.lines[0] ?? "";
  expect(p, r.lines.length === 1, `${r.lines.length} stderr lines, expected 1: ${r.lines.join(" | ")}`);
  expect(p, line.includes(`${name}: attempt 1 of 3`), `the retry line names no tool and attempt: ${line}`);
  for (const field of [outer?.message, ...nested]) {
    expect(p, typeof field === "string" && line.includes(field), `the retry line lacks "${field}": ${line}`);
  }
  check("a download dropped mid-body is fetched again and the retry line carries the cause", p);
}

{
  const p = [];
  const r = await call("t2", (ctx) => download(ctx, name, asset("/t2/archive.tar.gz")));
  const message = r.error?.message ?? "";
  expect(p, message.startsWith(`${name}: all 3 download attempts failed`) && message.includes("HTTP 503"),
    `rejection: ${message || "none"}`);
  expect(p, r.requests.length === 3, `requests ${r.requests.length}, expected 3`);
  expect(p, same(r.pauses, [1000, 4000]), `pauses ${JSON.stringify(r.pauses)}, expected [1000,4000]`);
  expect(p, r.lines.length === 2, `${r.lines.length} stderr lines, expected 2: ${r.lines.join(" | ")}`);
  for (const [i, line] of r.lines.entries()) {
    expect(p, line.includes(`${name}: attempt ${i + 1} of 3`) && line.includes("HTTP 503"), `retry line: ${line}`);
  }
  check("three transient failures end in one rejection after pauses of 1 and 4 seconds", p);
}

{
  const p = [];
  const a = asset("/t3/archive.tar.gz");
  const r = await call("t3", (ctx) => download(ctx, name, a));
  expect(p, r.error?.message === `${name}: HTTP 404 for ${a.url}`, `rejection: ${r.error?.message ?? "none"}`);
  expect(p, r.requests.length === 1, `requests ${r.requests.length}, expected 1`);
  expect(p, r.pauses.length === 0 && r.lines.length === 0, `pauses ${JSON.stringify(r.pauses)}, lines ${r.lines.length}`);
  check("a permanent HTTP status fails at once without a second request", p);
}

{
  const p = [];
  // The entry guard compares paths, so the copy runs under its long name on Windows.
  const copy = join(work, "t4");
  mkdirSync(join(copy, "tools"), { recursive: true });
  const long = realpathSync.native(copy);
  for (const file of ["install-tools.mjs", "digest.mjs"]) copyFileSync(join(tools, file), join(long, "tools", file));
  const pinText = JSON.stringify({ node: { version: "0.0.0", assets: { [platform]: asset("/t4/archive.tar.gz") } } });
  writeFileSync(join(long, "tools", "tool-pins.json"), pinText.slice(0, -1));
  const before = requests.length;
  const child = spawn(process.execPath, [join(long, "tools", "install-tools.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stdout.resume();
  child.stderr.on("data", (c) => (stderr += c));
  const code = await new Promise((ok) => child.on("close", ok));
  expect(p, code === 1, `exit ${code}, expected 1`);
  expect(p, stderr.startsWith("install-tools:"), `stderr: ${stderr.trim()}`);
  expect(p, requests.length === before, `requests ${requests.length - before}, expected none`);
  check("a malformed pin file ends the installer with its error line and no request", p);
}

{
  const p = [];
  const pins = { [name]: { version: "1.0.0", assets: { [platform]: asset("/t5/archive.tar.gz", Buffer.from("other")) } } };
  const r = await call("t5", (ctx) => installBinary({ ...ctx, pins }, name));
  expect(p, r.error?.message.startsWith(`${name}: SHA-256 mismatch`) === true, `rejection: ${r.error?.message ?? "none"}`);
  expect(p, r.requests.length === 1, `requests ${r.requests.length}, expected 1`);
  expect(p, r.pauses.length === 0, `pauses ${JSON.stringify(r.pauses)}`);
  const left = readdirSync(r.dest);
  const installed = readdirSync(join(r.dest, "bin"));
  expect(p, same(left, ["bin"]) && installed.length === 0, `left behind: ${JSON.stringify([...left, ...installed])}`);
  check("a complete body with the wrong digest installs nothing and is not fetched again", p);
}

// Reference pack cases: a stand-in pack, list, pin and SDK in each case's own folder.
const stand = join(work, "stand-in");
const refVersion = "1.2.3";
const runtimeOf = (dest) => join(dest, "dotnet", "shared", "Microsoft.NETCore.App", refVersion);
const muxer = win ? "dotnet.exe" : "dotnet";
const list = { package: "Stand.In.Ref", version: refVersion, folder: "ref/net10.0", files: ["Alpha.dll", "Beta.dll"] };

// Built with Python's zipfile or tarfile from a folder holding only the given files, so the archive has nothing else.
function pack(module, file, entries) {
  const folder = join(stand, `${file}-src`);
  for (const [rel, text] of Object.entries(entries)) {
    mkdirSync(dirname(join(folder, rel)), { recursive: true });
    writeFileSync(join(folder, rel), text);
  }
  const top = [...new Set(Object.keys(entries).map((rel) => rel.split("/")[0]))];
  const r = spawnSync(python, ["-I", "-m", module, "-c", join(stand, file), ...top], { cwd: folder, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`building the stand-in ${file} failed`);
  return readFileSync(join(stand, file));
}

const goodPack = pack("zipfile", "good.nupkg", {
  "ref/net10.0/Alpha.dll": "alpha",
  "ref/net10.0/Beta.dll": "beta",
  "ref/net10.0/Alpha.xml": "docs",
  "analyzers/dotnet/cs/Gamma.dll": "analyzer",
  "stand-in.nuspec": "<package />",
});
served.set("/ref/good.nupkg", goodPack);
const refPin = (path, digested) => ({ version: refVersion, url: `${base}${path}`, sha512: sha512(digested) });
const refCtx = (ctx, pin, more = {}) => ({ ...ctx, python, referenceList: list, pins: { "dotnet-ref": pin }, ...more });

function sdkFolder(dest) {
  mkdirSync(runtimeOf(dest), { recursive: true });
  writeFileSync(join(dest, "dotnet", muxer), "muxer");
}

// The reference install by file name and content, and the stamp text; null where absent.
function referenceState(dest) {
  const dir = join(dest, "ref-net10");
  const stamp = join(dest, "dotnet-ref.stamp.json");
  return {
    files: existsSync(dir) ? readdirSync(dir).sort().map((n) => `${n} ${sha256(readFileSync(join(dir, n)))}`) : null,
    stamp: existsSync(stamp) ? readFileSync(stamp, "utf8") : null,
  };
}
const leftovers = (dest) => readdirSync(dest).filter((n) => n.startsWith("tmp-"));
const seeded = (p, r) => expect(p, r.error === null, `the earlier install failed: ${r.error?.message}`);

{
  const p = [];
  const pin = refPin("/ref/good.nupkg", goodPack);
  const sdk = (tag) => {
    const data = pack("tarfile", `sdk-${tag}.tar.gz`, {
      [muxer]: "muxer",
      [`shared/Microsoft.NETCore.App/${refVersion}/build.txt`]: tag,
    });
    served.set(`/i1/sdk-${tag}.tar.gz`, data);
    return { version: `0.0.0-${tag}`, assets: { [platform]: { url: `${base}/i1/sdk-${tag}.tar.gz`, sha256: sha256(data) } } };
  };
  const both = (dotnet) =>
    call("i1", async (ctx) => {
      const c = refCtx(ctx, pin, { pins: { dotnet, "dotnet-ref": pin } });
      await installDotnet(c);
      await installReference(c);
    });
  const first = await both(sdk("a"));
  const installed = referenceState(first.dest);
  expect(p, first.error === null, `first install rejected: ${first.error?.message}`);
  expect(p, same(first.requests, ["/i1/sdk-a.tar.gz", "/ref/good.nupkg"]), `requests ${JSON.stringify(first.requests)}`);
  expect(p, same(installed.files, [`Alpha.dll ${sha256("alpha")}`, `Beta.dll ${sha256("beta")}`]),
    `installed ${JSON.stringify(installed.files)}, expected the two listed DLLs only`);
  expect(p, installed.stamp === `{"version":"${refVersion}","sha512":"${pin.sha512}"}\n`, `stamp: ${installed.stamp}`);
  const second = await both(sdk("b"));
  expect(p, second.error === null, `install after the SDK reinstall rejected: ${second.error?.message}`);
  expect(p, same(second.requests, ["/i1/sdk-b.tar.gz"]), `requests after the SDK reinstall ${JSON.stringify(second.requests)}`);
  const build = join(runtimeOf(second.dest), "build.txt");
  expect(p, existsSync(build) && readFileSync(build, "utf8") === "b", "the selected runtime is not the reinstalled SDK's");
  expect(p, same(referenceState(second.dest), installed), "the SDK reinstall changed the reference install or stamp");
  expect(p, leftovers(second.dest).length === 0, `left behind: ${JSON.stringify(leftovers(second.dest))}`);
  check("the reference pack installs the listed DLLs and stays installed when an SDK reinstall brings the runtime", p);
}

{
  const p = [];
  const r = await call("i2", (ctx) => {
    sdkFolder(ctx.dest);
    return installReference(refCtx(ctx, refPin("/ref/good.nupkg", Buffer.from("other"))));
  });
  expect(p, r.error?.message.startsWith("dotnet-ref: SHA-512 mismatch") === true, `rejection: ${r.error?.message ?? "none"}`);
  expect(p, r.requests.length === 1, `requests ${r.requests.length}, expected 1`);
  const left = readdirSync(r.dest).sort();
  expect(p, same(left, ["bin", "dotnet"]), `left behind: ${JSON.stringify(left)}`);
  check("a reference pack with the wrong digest is never unpacked and installs nothing", p);
}

{
  const p = [];
  const pin = refPin("/ref/good.nupkg", goodPack);
  const seed = await call("i3", (ctx) => {
    sdkFolder(ctx.dest);
    return installReference(refCtx(ctx, pin));
  });
  seeded(p, seed);
  const before = referenceState(seed.dest);
  const r = await call("i3", (ctx) => installReference(refCtx(ctx, pin, { referenceList: { ...list, version: "1.2.4" } })));
  const want = `dotnet-ref: tools/reference-dlls.json is for 1.2.4, the pin is ${refVersion}`;
  expect(p, r.error?.message === want, `rejection: ${r.error?.message ?? "none"}`);
  expect(p, r.requests.length === 0, `requests ${r.requests.length}, expected none`);
  expect(p, before.stamp !== null && same(referenceState(r.dest), before), "the existing install or stamp changed");
  check("a reference list for another version is refused, also when the stamp is current", p);
}

{
  const p = [];
  const otherPack = pack("zipfile", "other.nupkg", { "ref/net10.0/Alpha.dll": "alpha", "ref/net10.0/Delta.dll": "delta" });
  served.set("/ref/other.nupkg", otherPack);
  const seed = await call("i4", (ctx) => {
    sdkFolder(ctx.dest);
    return installReference(refCtx(ctx, refPin("/ref/good.nupkg", goodPack)));
  });
  seeded(p, seed);
  const before = referenceState(seed.dest);
  const r = await call("i4", (ctx) => installReference(refCtx(ctx, refPin("/ref/other.nupkg", otherPack))));
  const want =
    "dotnet-ref: the package's ref/net10.0 DLLs differ from tools/reference-dlls.json " +
    "(missing: Beta.dll; not listed: Delta.dll)";
  expect(p, r.error?.message === want, `rejection: ${r.error?.message ?? "none"}`);
  expect(p, r.requests.length === 1, `requests ${r.requests.length}, expected 1`);
  expect(p, before.stamp !== null && same(referenceState(r.dest), before), "the previous install or its stamp changed");
  expect(p, leftovers(r.dest).length === 0, `left behind: ${JSON.stringify(leftovers(r.dest))}`);
  check("a pack whose DLLs differ from the list is refused and the previous install stays", p);
}

{
  const p = [];
  const pin = refPin("/ref/good.nupkg", goodPack);
  const seed = await call("i5", (ctx) => {
    sdkFolder(ctx.dest);
    return installReference(refCtx(ctx, pin));
  });
  seeded(p, seed);
  // Another runtime stays, so only the selected version can satisfy the check.
  rmSync(runtimeOf(seed.dest), { recursive: true });
  mkdirSync(join(seed.dest, "dotnet", "shared", "Microsoft.NETCore.App", "1.2.2"));
  const r = await call("i5", (ctx) => installReference(refCtx(ctx, pin)));
  const want = `dotnet-ref: the SDK does not provide runtime ${refVersion}: ${runtimeOf(seed.dest)} is missing`;
  expect(p, r.error?.message === want, `rejection: ${r.error?.message ?? "none"}`);
  expect(p, r.requests.length === 0, `requests ${r.requests.length}, expected none`);
  check("an SDK without the selected runtime is refused, also when the stamp is current", p);
}

server.closeAllConnections();
server.close();
process.exitCode = failed > 0 ? 1 : 0;
