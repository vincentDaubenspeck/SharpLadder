// @vitest-environment node
import type * as ChildProcessModule from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex, PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { supervise } from "./supervise.ts";

const harness = vi.hoisted(() => ({
  fake: undefined as (() => unknown) | undefined,
  spawns: 0,
}));

// Passes every spawn through unless a row scripts the child.
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof ChildProcessModule>();
  return {
    ...real,
    spawn: (...args: Parameters<typeof real.spawn>) => {
      harness.spawns++;
      return harness.fake === undefined ? real.spawn(...args) : harness.fake();
    },
  };
});

const posix = process.platform !== "win32";
const url = pathToFileURL(join(import.meta.dirname, "supervise.ts")).href;
const scratch: string[] = [];
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function folder(): string {
  const made = mkdtempSync(join(tmpdir(), "sl-cancel-"));
  scratch.push(made);
  return made;
}

async function waitFor(check: () => boolean, bound: number): Promise<boolean> {
  const end = performance.now() + bound;
  for (;;) {
    if (check()) return true;
    if (performance.now() > end) return false;
    await sleep(10);
  }
}

// A zombie counts as gone here: it runs nothing and holds no pipe.
function alive(pid: number): boolean {
  if (posix) {
    try {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
      return stat.charAt(stat.lastIndexOf(")") + 2) !== "Z";
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function groupPresent(groupId: number): boolean {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

const numberIn = (file: string) =>
  Number(readFileSync(file, "utf8").trim().split(" ")[0]);

async function rejection(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    return error as Error;
  }
  throw new Error("the run resolved instead of failing");
}

// Writes its process group (its own ID on Windows) to the file, then hangs to a backstop.
const hanging = `const fs = require("fs");
const id = process.platform === "win32" ? process.pid : Number(fs.readFileSync("/proc/self/stat", "utf8").split(") ")[1].split(" ")[2]);
fs.writeFileSync(process.argv[1], String(id) + "\\n");
setTimeout(() => {}, 30000);`;
const record = (code: number) =>
  `${JSON.stringify({ v: 1, kind: "exit", code, signal: null })}\n`;

class FakeChild extends EventEmitter {
  readonly pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly control = new Duplex({
    read() {
      // Each row pushes the bytes the stub would send.
    },
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  readonly stdio = [null, this.stdout, this.stderr, this.control];
  readonly kill = vi.fn(() => true);
  readonly unref = vi.fn();
  // A normal end as each platform reports it: the stub's record and own kill, or the exit.
  finish(code = 0): void {
    if (posix) {
      this.control.push(record(code));
      this.emit("exit", null, "SIGKILL");
    } else this.emit("exit", code, null);
    this.stdout.end();
    this.stderr.end();
    setTimeout(() => this.emit("close", null, null), 5);
  }
}

function scripted(): FakeChild {
  const child = new FakeChild();
  harness.fake = () => {
    process.nextTick(() => child.emit("spawn"));
    return child;
  };
  return child;
}

// Answers every signal-0 group probe in turn and records any other call; never signals.
function kills(...answers: ("present" | "ESRCH" | "EPERM" | "EINVAL")[]) {
  const calls: [number, string | number | undefined][] = [];
  vi.spyOn(process, "kill").mockImplementation(
    (pid: number, signal?: string | number) => {
      calls.push([pid, signal]);
      if (pid === process.pid) return true;
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer === "present") return true;
      throw Object.assign(new Error(`kill ${String(answer)}`), {
        code: answer ?? "ESRCH",
      });
    },
  );
  return calls;
}

// A fresh module per row, since a cancellation refuses every later run in that module.
async function freshModule() {
  vi.resetModules();
  return import("./supervise.ts");
}
const added = (event: string, before: Set<unknown>) =>
  process.listeners(event as "SIGINT").filter((l) => !before.has(l));

afterEach(() => {
  harness.fake = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const made of scratch.splice(0))
    rmSync(made, { recursive: true, force: true });
});

describe("cancellation by the owning runner and by signals", () => {
  // In a forks worker the channel is real, so the handler is the one an owning runner's exit reaches.
  it("cancels on the owning runner's disconnect without signalling or exiting itself", async () => {
    expect(typeof process.send).toBe("function");
    const fresh = await freshModule();
    const calls = kills("ESRCH");
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const before = new Set(process.listeners("disconnect"));
    const child = scripted();
    const run = fresh.supervise("stand-in", process.execPath, [], {
      run: 10_000,
      grace: 100,
    });
    const ours = added("disconnect", before);
    expect(ours).toHaveLength(1);
    (ours[0] as () => void)();
    (ours[0] as () => void)();
    const error = await rejection(run);
    expect(error.message).toMatch(
      /^stand-in was cancelled: the owning runner disconnected\n/u,
    );
    expect(error.message).toContain("also saw the owning runner disconnect");
    expect(posix ? child.control.destroyed : child.kill.mock.calls).toEqual(
      posix ? true : [["SIGKILL"]],
    );
    expect([calls, exit.mock.calls]).toEqual([[], []]);
    const spawns = harness.spawns;
    await expect(
      fresh.supervise("later", process.execPath, [], { run: 1, grace: 1 }),
    ).rejects.toThrow(
      /^later was not started: cancellation by the owning runner's disconnect has begun$/u,
    );
    expect([harness.spawns, added("disconnect", before)]).toEqual([spawns, []]);
  });

  it("refuses a run in a process whose channel has already closed", async () => {
    const fresh = await freshModule();
    const descriptor = Object.getOwnPropertyDescriptor(process, "connected");
    Object.defineProperty(process, "connected", {
      configurable: true,
      get: () => false,
    });
    try {
      const spawns = harness.spawns;
      await expect(
        fresh.supervise("late", process.execPath, [], { run: 1, grace: 1 }),
      ).rejects.toThrow(
        /^late was not started: the owning runner has disconnected$/u,
      );
      expect(harness.spawns).toBe(spawns);
    } finally {
      if (descriptor === undefined)
        Reflect.deleteProperty(process, "connected");
      else Object.defineProperty(process, "connected", descriptor);
    }
  });

  it("acts once on repeated signals and settles at the first one's grace", async () => {
    const fresh = await freshModule();
    const calls = kills("ESRCH");
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    // Ours must be the only listener, so the exit is its own to raise.
    const others = process.listeners("SIGINT");
    for (const l of others) process.off("SIGINT", l);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const child = scripted();
      const run = rejection(
        fresh.supervise("stand-in", process.execPath, [], {
          run: 10_000,
          grace: 1_000,
        }),
      );
      let settled = false;
      void run.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      const ours = process.listeners("SIGINT")[0] as (s: string) => void;
      ours("SIGINT");
      await vi.advanceTimersByTimeAsync(100);
      ours("SIGINT");
      await vi.advanceTimersByTimeAsync(899);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      const error = await run;
      expect(error.message).toMatch(/^stand-in was cancelled by SIGINT\n/u);
      expect(error.message.match(/also received SIGINT/gu)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(
        posix ? calls.filter(([pid]) => pid === process.pid) : exit.mock.calls,
      ).toEqual(posix ? [[process.pid, "SIGINT"]] : [[130]]);
      expect(posix ? exit.mock.calls : child.kill.mock.calls).toEqual(
        posix ? [] : [["SIGKILL"]],
      );
    } finally {
      vi.useRealTimers();
      for (const l of others) process.on("SIGINT", l);
    }
  });
});

describe("output caps", () => {
  const cap = 64 * 1024 * 1024;
  const mib = Buffer.alloc(1024 * 1024, 0x61);
  const feed = async (stream: PassThrough, bytes: number) => {
    for (let left = bytes; left > 0; left -= mib.length)
      stream.push(left >= mib.length ? mib : mib.subarray(0, left));
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  };
  const retained = (message: string, name: "stdout" | "stderr") => {
    const [, after = ""] = message.split(`\n${name}:\n`);
    return name === "stdout"
      ? after.split("\nstderr:\n")[0]?.length
      : after.length;
  };

  it.each(["stdout"] as const)(
    "keeps exactly the cap on %s and fails one byte more",
    { timeout: 30_000 },
    async (name) => {
      kills("ESRCH");
      let child = scripted();
      const ok = supervise("stand-in", process.execPath, [], {
        run: 10_000,
        grace: 500,
      });
      await feed(child[name], cap);
      child.finish();
      expect((await ok)[name].length).toBe(cap);
      child = scripted();
      const over = rejection(
        supervise("stand-in", process.execPath, [], {
          run: 10_000,
          grace: 500,
        }),
      );
      await feed(child[name], cap + 1);
      child.finish();
      const error = await over;
      expect(error.message).toMatch(
        new RegExp(
          `^stand-in printed more than 67108864 bytes on ${name}\\n`,
          "u",
        ),
      );
      expect(retained(error.message, name)).toBe(cap);
    },
  );
});

describe.skipIf(!posix)("the group probe", () => {
  it("settles a late close with a present group inside run + grace", async () => {
    const calls = kills("present");
    const child = scripted();
    const started = performance.now();
    const run = rejection(
      supervise("stand-in", "/bin/sh", [], { run: 300, grace: 300 }),
    );
    await sleep(280);
    child.finish();
    const error = await run;
    const took = performance.now() - started;
    expect(error.message).toMatch(
      /^stand-in exited with status 0, but its process group still had members after its output closed; termination unconfirmed\n/u,
    );
    expect(took).toBeLessThan(300 + 300 + 50);
    expect(calls.every(([pid, signal]) => pid === -4242 && signal === 0)).toBe(
      true,
    );
  });
});

describe("the command's NODE_OPTIONS and environment", () => {
  const shown = `process.stdout.write(JSON.stringify([process.env.NODE_OPTIONS ?? null, process.env.SHARPLADDER_SUPERVISE_NODE_OPTIONS ?? null]))`;
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        name !== "NODE_OPTIONS" &&
        name !== "SHARPLADDER_SUPERVISE_NODE_OPTIONS",
    ),
  );
  const seen = async (extra: Record<string, string>) => {
    const r = await supervise(
      "stand-in",
      process.execPath,
      ["-e", shown],
      { run: 10_000, grace: 2_000 },
      { env: { ...base, ...extra } },
    );
    return JSON.parse(r.stdout.toString("utf8")) as unknown;
  };

  it.each([
    [
      "both",
      {
        NODE_OPTIONS: "--no-warnings",
        SHARPLADDER_SUPERVISE_NODE_OPTIONS: "--no-deprecation",
      },
      ["--no-warnings", "--no-deprecation"],
    ],
  ])(
    "passes NODE_OPTIONS %s to the command unchanged",
    async (_n, extra, expected) => {
      expect(await seen(extra)).toEqual(expected);
    },
  );
});

// Each fixture cancels its own run: by a real signal on POSIX, by a synthetic one on Windows.
describe("a runner process whose run is cancelled", () => {
  const fixture = `const [url, mode, idFile, fired] = process.argv.slice(2);
const { supervise } = await import(url);
const fs = await import("node:fs");
if (mode === "own") process.on("SIGINT", () => setTimeout(() => process.exit(7), 100));
const backstop = setTimeout(() => process.exit(9), 30000);
backstop.unref();
const raise = (s) => process.platform === "win32" ? process.emit(s, s) : process.kill(process.pid, s);
void supervise("fixture stand-in", process.execPath, ["-e", ${JSON.stringify(hanging)}, idFile], { run: 60000, grace: 2000 }).catch(() => {});
const poll = setInterval(() => {
  if (!fs.existsSync(idFile) || !fs.readFileSync(idFile, "utf8").endsWith("\\n")) return;
  clearInterval(poll);
  fs.writeFileSync(fired, String(Date.now()));
  raise(mode === "term" ? "SIGTERM" : "SIGINT");
  if (mode === "twice") setTimeout(() => raise("SIGINT"), 100);
}, 10);
`;

  it.each([["own", [7, null]]] as const)(
    "ends the run and exits as the signal would (%s)",
    { timeout: 40_000 },
    async (mode, expected) => {
      const dir = folder();
      const [script, id, fired] = ["fixture.mjs", "id", "fired"].map((f) =>
        join(dir, f),
      ) as [string, string, string];
      writeFileSync(script, fixture);
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !name.startsWith("VITEST") && name !== "NODE_OPTIONS",
        ),
      );
      const runner = spawn(process.execPath, [script, url, mode, id, fired], {
        env,
        stdio: "ignore",
      });
      const ended = new Promise<[number | null, string | null]>((resolve) =>
        runner.once("exit", (code, s) => {
          resolve([code, s]);
        }),
      );
      const result = await ended;
      const took = Date.now() - Number(readFileSync(fired, "utf8"));
      expect(result).toEqual(expected);
      expect(took).toBeLessThan(2_000 + 1_000);
      const target = numberIn(id);
      expect(
        await waitFor(
          () => !(posix ? groupPresent(target) : alive(target)),
          1_000,
        ),
      ).toBe(true);
    },
  );
});
