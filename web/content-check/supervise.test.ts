// @vitest-environment node
import type * as ChildProcessModule from "node:child_process";
import { spawn, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex, PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordLimit, supervise } from "./supervise.ts";

const harness = vi.hoisted(() => ({
  fake: undefined as (() => unknown) | undefined,
  calls: [] as {
    command: string;
    args: readonly string[];
    options: SpawnOptions;
  }[],
  children: [] as ChildProcessModule.ChildProcess[],
}));

// Passes every spawn through unless a row scripts the child.
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof ChildProcessModule>();
  return {
    ...real,
    spawn: (
      command: string,
      args: readonly string[],
      options: SpawnOptions,
    ) => {
      harness.calls.push({ command, args, options });
      if (harness.fake !== undefined) return harness.fake();
      const child = real.spawn(command, args, options);
      harness.children.push(child);
      return child;
    },
  };
});

const posix = process.platform !== "win32";
const limits = { run: 10_000, grace: 2_000 };
const scratch: string[] = [];
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function folder(): string {
  const made = mkdtempSync(join(tmpdir(), "sl-supervise-"));
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

// A zombie counts as gone: it runs nothing and holds no pipe.
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
const written = (file: string) =>
  existsSync(file) && readFileSync(file, "utf8").endsWith("\n");

async function rejection(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    return error as Error;
  }
  throw new Error("the run resolved instead of failing");
}

// Writes its process group (its own ID on Windows) to the file, prints, then hangs to a backstop.
const hanging = `const fs = require("fs");
const id = process.platform === "win32" ? process.pid : Number(fs.readFileSync("/proc/self/stat", "utf8").split(") ")[1].split(" ")[2]);
fs.writeFileSync(process.argv[1], String(id) + "\\n");
process.stdout.write("partial");
setTimeout(() => {}, 30000);`;
const record = (code: number | null, signal: string | null) =>
  `${JSON.stringify({ v: 1, kind: "exit", code, signal })}\n`;

afterEach(() => {
  harness.fake = undefined;
  harness.children = [];
  vi.restoreAllMocks();
  // A Windows process that has just ended can hold its working folder for a moment.
  for (const made of scratch.splice(0))
    rmSync(made, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
});

describe("supervised runs", () => {
  // A non-zero status is the caller's to judge, so it comes back as a result.
  it("returns a normal exit with its output", async () => {
    const r = await supervise(
      "stand-in",
      process.execPath,
      [
        "-e",
        "process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 3;",
      ],
      limits,
    );
    expect([r.status, r.stdout.toString(), r.stderr.toString()]).toEqual([
      3,
      "out",
      "err",
    ]);
  });

  it("fails a launch error and keeps its code in the cause", async () => {
    const error = await rejection(
      supervise("absent tool", join(tmpdir(), "sl-absent-tool"), [], limits),
    );
    expect(error.message).toMatch(
      /^absent tool could not start: spawn .*ENOENT/u,
    );
    expect((error.cause as NodeJS.ErrnoException).code).toBe("ENOENT");
  });

  it(
    "stops a hung run at its deadline and ends what it started",
    { timeout: 20_000 },
    async () => {
      const id = join(folder(), "id");
      const started = performance.now();
      const error = await rejection(
        supervise("stand-in", process.execPath, ["-e", hanging, id], {
          run: 1_000,
          grace: 1_000,
        }),
      );
      expect(performance.now() - started).toBeLessThan(1_000 + 1_000 + 1_000);
      expect(error.message).toMatch(
        /^stand-in timed out after 1000 ms\n[^]*stdout:\npartial\n/u,
      );
      const ended = posix
        ? () => !groupPresent(numberIn(id))
        : () => !alive(numberIn(id));
      expect(await waitFor(ended, 1_000)).toBe(true);
    },
  );

  it.skipIf(!posix)("fails a command that a signal ends", async () => {
    const error = await rejection(
      supervise("stand-in", "/bin/sh", ["-c", "kill -TERM $$"], limits),
    );
    expect(error.message).toMatch(/^stand-in was killed by SIGTERM\n/u);
  });

  it.skipIf(!posix)(
    "keeps a caller's preload out of the stub and gives it to the command",
    async () => {
      const dir = folder();
      const marks = join(dir, "marks");
      const preload = join(dir, "preload.cjs");
      writeFileSync(
        preload,
        `require("fs").appendFileSync(${JSON.stringify(marks)}, process.pid + "\\n");\n`,
      );
      const r = await supervise(
        "stand-in",
        process.execPath,
        ["-e", "process.stdout.write(String(process.pid))"],
        limits,
        { env: { ...process.env, NODE_OPTIONS: `--require ${preload}` } },
      );
      expect(readFileSync(marks, "utf8")).toBe(`${r.stdout.toString()}\n`);
    },
  );

  it.skipIf(!posix)(
    "kills a residual in-group descendant and still returns the result",
    async () => {
      const pid = join(folder(), "pid");
      const started = performance.now();
      const r = await supervise(
        "stand-in",
        "/bin/sh",
        ["-c", `sleep 30 & echo $! > '${pid}'; printf done`],
        limits,
      );
      expect([r.status, r.stdout.toString()]).toEqual([0, "done"]);
      expect(performance.now() - started).toBeLessThan(5_000);
      expect(await waitFor(() => !alive(numberIn(pid)), 1_000)).toBe(true);
    },
  );

  it.skipIf(!posix)(
    "never starts the command when the stop reaches the stub first",
    async () => {
      const marker = join(folder(), "started");
      const run = supervise(
        "stand-in",
        "/bin/sh",
        ["-c", `echo > '${marker}'; sleep 30`],
        { run: 50, grace: 3_000 },
      );
      const stub = harness.children.at(-1);
      stub?.kill("SIGSTOP");
      await sleep(200);
      stub?.kill("SIGCONT");
      const error = await rejection(run);
      expect(error.message).toMatch(/^stand-in timed out after 50 ms\n/u);
      await sleep(300);
      expect(existsSync(marker)).toBe(false);
    },
  );

  // The owner is killed outright while the command runs, so only the stub can end the group.
  it.skipIf(!posix).each(["kill"])(
    "ends the group when its owner dies (%s)",
    { timeout: 20_000 },
    async (mode) => {
      const group = join(folder(), "group");
      const url = pathToFileURL(join(import.meta.dirname, "supervise.ts")).href;
      const owner = `const [url, mode, file] = process.argv.slice(1);
const { supervise } = await import(url);
const tail = mode === "racing" ? \`kill -KILL \${process.pid}; exit 0\` : "exec sleep 30";
supervise("owner fixture", "/bin/sh", ["-c", \`read -r _ _ _ _ g _ < /proc/$$/stat; echo "$g" > '\${file}'; \${tail}\`], { run: 30000, grace: 1000 }).catch(() => {});
if (mode !== "racing") {
  const { readFileSync } = await import("node:fs");
  const seen = () => { try { return readFileSync(file, "utf8").endsWith("\\n"); } catch { return false; } };
  while (!seen()) await new Promise((r) => setTimeout(r, 10));
  if (mode === "exit") process.exit(0); else process.kill(process.pid, "SIGKILL");
}`;
      const fixture = spawn(
        process.execPath,
        ["--input-type=module", "-e", owner, url, mode, group],
        { stdio: "ignore" },
      );
      const ended = new Promise<void>((resolve) =>
        fixture.once("exit", () => {
          resolve();
        }),
      );
      expect(await waitFor(() => written(group), 10_000)).toBe(true);
      await ended;
      expect(await waitFor(() => !groupPresent(numberIn(group)), 2_000)).toBe(
        true,
      );
    },
  );
});

class FakeChild extends EventEmitter {
  readonly pid = 4242;
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
  exited(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit("exit", code, signal);
  }
  // Pushed channel bytes are delivered on a later turn, so the close follows them.
  closed(): void {
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

// Answers the supervisor's signal-0 group probes in turn, repeating the last answer.
function probes(...answers: ("present" | "ESRCH" | "EPERM")[]) {
  const calls: [number, string | number | undefined][] = [];
  vi.spyOn(process, "kill").mockImplementation(
    (pid: number, signal?: string | number) => {
      calls.push([pid, signal]);
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer === "present") return true;
      throw Object.assign(new Error(`kill ${String(answer)}`), {
        code: answer,
      });
    },
  );
  return calls;
}

function watched(run: Promise<unknown>) {
  const state = { settled: false };
  run.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
}

const grace = 100;
// Far below the run limit, so only the injected failure or its teardown can end the run.
const bound = grace + 2_000;
const command = posix ? "/bin/sh" : "stand-in.exe";

// Gives up at the bound, so a run that never settles fails its own row.
async function settledWithin(
  run: Promise<unknown>,
  limit: number,
): Promise<Error> {
  // The handle's type follows the call, which differs between the DOM and Node programs.
  let clear = (): void => undefined;
  const late = new Promise<undefined>((resolve) => {
    const timer = setTimeout(resolve, limit);
    clear = () => {
      clearTimeout(timer);
    };
  });
  try {
    const outcome = await Promise.race([rejection(run), late]);
    if (outcome === undefined)
      throw new Error(`the run did not settle within ${String(limit)} ms`);
    return outcome;
  } finally {
    clear();
  }
}

// POSIX stops by closing the channel and never signals; Windows kills the child itself.
function stopped(child: FakeChild): void {
  if (posix)
    expect([child.control.destroyed, child.kill.mock.calls]).toEqual([
      true,
      [],
    ]);
  else expect(child.kill.mock.calls).toEqual([["SIGKILL"]]);
}

// A stop with no end seen: unconfirmed, the output let go, and no group ever signalled.
function unconfirmed(
  child: FakeChild,
  error: Error,
  calls: readonly unknown[],
): void {
  expect(error.message).toContain(
    `\nteardown did not finish within ${String(grace)} ms; ${posix ? "stub" : "child"} exited: no; output open: yes\n`,
  );
  expect(error.message).toContain("\ndescendants not confirmed terminated\n");
  expect([child.stdout.destroyed, child.stderr.destroyed]).toEqual([
    true,
    true,
  ]);
  expect(child.unref).toHaveBeenCalledOnce();
  expect(calls).toEqual([]);
}

// The injection runs on the turn after the stop is delivered, well inside the grace.
function afterStop(child: FakeChild, inject: () => void): void {
  if (posix) child.control.once("close", inject);
  else
    child.kill.mockImplementation(() => {
      process.nextTick(inject);
      return true;
    });
}

// An injected failure alone, after an already latched primary, and before an end that is seen.
async function failsWhileRunning(
  inject: (child: FakeChild) => Error,
  shown: string,
): Promise<void> {
  let calls = probes("ESRCH");
  let child = scripted();
  let run = supervise("stand-in", command, [], { run: 10_000, grace });
  await sleep(10);
  let injected = inject(child);
  let error = await settledWithin(run, bound);
  expect(error.message.split("\n")[0]).toBe(
    `stand-in failed while running: ${shown}`,
  );
  expect(error.cause).toBe(injected);
  stopped(child);
  unconfirmed(child, error, calls);

  vi.restoreAllMocks();
  calls = probes("ESRCH");
  child = scripted();
  const late: Error[] = [];
  const target = child;
  afterStop(child, () => late.push(inject(target)));
  run = supervise("stand-in", command, [], { run: 30, grace });
  error = await settledWithin(run, 30 + bound);
  expect(late).toHaveLength(1);
  expect(error.message.split("\n")[0]).toBe("stand-in timed out after 30 ms");
  expect(error.message).toContain(
    `\nstand-in failed while running: ${shown}\n`,
  );
  expect(error.cause).toBeUndefined();
  stopped(child);
  unconfirmed(child, error, calls);

  // A grace longer than the bound, so only the seen end can settle the run.
  vi.restoreAllMocks();
  calls = probes("ESRCH");
  child = scripted();
  const ending = child;
  afterStop(child, () => {
    ending.exited(null, "SIGKILL");
    ending.closed();
  });
  run = supervise("stand-in", command, [], { run: 10_000, grace: 5_000 });
  await sleep(10);
  injected = inject(child);
  error = await settledWithin(run, bound);
  expect(error.message.split("\n")[0]).toBe(
    `stand-in failed while running: ${shown}`,
  );
  expect(error.message).not.toContain("teardown did not finish");
  expect(error.cause).toBe(injected);
  stopped(child);
  expect(calls).toEqual([]);
}

// Each fault returns the delivery attempts it saw.
type Fault = readonly [
  string,
  (child: FakeChild) => readonly unknown[],
  string,
];

describe("failures during a run", () => {
  it("fails a child error after the spawn and keeps an earlier primary", async () => {
    await failsWhileRunning((child) => {
      const error = new Error("injected child failure");
      child.emit("error", error);
      return error;
    }, "injected child failure");
  });

  it("fails an output stream error and keeps an earlier primary", async () => {
    await failsWhileRunning((child) => {
      const error = new Error("injected stream failure");
      child.stdout.destroy(error);
      return error;
    }, "injected stream failure");
  });

  it("never counts a stop that was not delivered as an ended run", async () => {
    const thrown = () => {
      throw new Error("injected delivery failure");
    };
    const faults: readonly Fault[] = posix
      ? [
          [
            "a channel close that throws",
            (child) =>
              vi.spyOn(child.control, "destroy").mockImplementation(thrown).mock
                .calls,
            "teardown error: injected delivery failure",
          ],
        ]
      : [
          [
            "an undelivered kill",
            (child) => child.kill.mockReturnValue(false).mock.calls,
            "the kill was not delivered",
          ],
          [
            "a kill that throws",
            (child) => child.kill.mockImplementation(thrown).mock.calls,
            "teardown error: injected delivery failure",
          ],
        ];
    for (const [name, fault, shown] of faults)
      for (const ends of [false, true]) {
        vi.restoreAllMocks();
        const calls = probes("ESRCH");
        const child = scripted();
        const attempted = fault(child);
        const run = supervise("stand-in", command, [], {
          run: 30,
          grace: ends ? 5_000 : grace,
        });
        if (ends) {
          expect(await waitFor(() => attempted.length > 0, bound), name).toBe(
            true,
          );
          child.exited(1, null);
          child.closed();
        }
        const error = await settledWithin(run, 30 + bound);
        expect(error.message.split("\n")[0], name).toBe(
          "stand-in timed out after 30 ms",
        );
        expect(error.message, name).toContain(`\n${shown}\n`);
        expect(attempted.length, name).toBeGreaterThan(0);
        if (ends) {
          expect(error.message, name).not.toContain("teardown did not finish");
          expect(calls, name).toEqual([]);
        } else unconfirmed(child, error, calls);
      }
  });
});

describe.skipIf(!posix)("the supervision protocol", () => {
  it("settles on the channel end and the stub's exit, in either order", async () => {
    for (const order of [
      ["exit", "record"],
      ["record", "exit"],
    ]) {
      probes("ESRCH");
      const child = scripted();
      const run = supervise("stand-in", "/bin/sh", [], limits);
      const state = watched(run);
      for (const step of order)
        if (step === "exit") child.exited(null, "SIGKILL");
        else child.control.push(record(0, null));
      child.control.push(null);
      await sleep(20);
      expect(state.settled).toBe(false);
      child.closed();
      expect((await run).status).toBe(0);
      vi.restoreAllMocks();
    }
  });

  it.each([
    [
      "a write failure",
      "",
      /ended by SIGKILL without a valid result record \(no result record\)/u,
    ],
    [
      "a partial record",
      '{"v":1,"kind":"exit"',
      /without a valid result record \(the result record is incomplete\)/u,
    ],
    [
      "a record that is not JSON",
      "not json\n",
      /\(the result record is not JSON\)/u,
    ],
    [
      "a code with a signal",
      record(0, "SIGTERM"),
      /\(the exit record's code and signal do not match\)/u,
    ],
    [
      "an extra field",
      '{"v":1,"kind":"exit","code":0,"signal":null,"x":1}\n',
      /\(the result record does not match its schema\)/u,
    ],
    [
      "two records",
      record(0, null) + record(0, null),
      /\(extra records or trailing data after the result record\)/u,
    ],
  ])("fails %s", async (_name, sent, expected) => {
    const calls = probes("ESRCH");
    const child = scripted();
    const run = supervise("stand-in", "/bin/sh", [], limits);
    if (sent !== "") child.control.push(sent);
    child.control.push(null);
    child.exited(null, "SIGKILL");
    child.closed();
    expect((await rejection(run)).message).toMatch(expected);
    expect(calls).toEqual([]);
  });

  it("stops at once when the stub sends more than the byte bound", async () => {
    const child = scripted();
    const run = supervise("stand-in", "/bin/sh", [], limits);
    child.control.push("x".repeat(recordLimit + 1));
    await sleep(20);
    expect(child.control.destroyed).toBe(true);
    child.exited(null, "SIGKILL");
    child.closed();
    expect((await rejection(run)).message).toMatch(
      /^stand-in failed: supervision protocol: the stub sent more than 4096 bytes\n/u,
    );
  });

  it.each([["a normal exit", 0, null, "exit status 0"]] as const)(
    "fails a stub that ends by %s, even with a valid record",
    async (_name, code, signal, shown) => {
      const calls = probes("ESRCH");
      const child = scripted();
      const run = supervise("stand-in", "/bin/sh", [], limits);
      child.control.push(record(0, null));
      child.control.push(null);
      child.exited(code, signal);
      child.closed();
      expect((await rejection(run)).message).toMatch(
        new RegExp(
          `^stand-in failed: supervision protocol: the stub ended with ${shown}, not by SIGKILL\\n`,
          "u",
        ),
      );
      expect(calls).toEqual([]);
    },
  );

  it("probes the group before every success and fails a group that stays", async () => {
    const waited = probes("present", "ESRCH");
    let child = scripted();
    let run = supervise("stand-in", "/bin/sh", [], limits);
    child.control.push(record(0, null));
    child.exited(null, "SIGKILL");
    child.closed();
    expect((await run).status).toBe(0);
    expect(waited).toEqual([
      [-4242, 0],
      [-4242, 0],
    ]);
    for (const [answer, expected] of [
      [
        "present",
        /^stand-in exited with status 0, but its process group still had members/u,
      ],
      [
        "EPERM",
        /^stand-in termination unconfirmed: the group probe returned EPERM\n/u,
      ],
    ] as const) {
      vi.restoreAllMocks();
      probes(answer);
      child = scripted();
      run = supervise("stand-in", "/bin/sh", [], { run: 10_000, grace: 100 });
      child.control.push(record(0, null));
      child.exited(null, "SIGKILL");
      child.closed();
      expect((await rejection(run)).message).toMatch(expected);
    }
  });

  it("never signals after the stub's exit at the deadline and reports the overrun", async () => {
    const calls = probes("ESRCH");
    const child = scripted();
    const run = supervise("stand-in", "/bin/sh", [], { run: 30, grace: 100 });
    child.control.push(record(0, null));
    child.exited(null, "SIGKILL");
    const error = await rejection(run);
    expect(error.message).toMatch(
      /^stand-in exited with status 0 but its output stayed open past 30 ms\n/u,
    );
    expect(error.message).toContain("its group was not signalled again");
    expect(error.message).toContain(
      "teardown did not finish within 100 ms; stub exited: yes; output open: yes",
    );
    expect(error.message).toContain("descendants not confirmed terminated");
    expect([calls, child.kill.mock.calls, child.stdout.destroyed]).toEqual([
      [],
      [],
      true,
    ]);
  });

  // A fresh module, since a cancellation refuses every later run in that module.
  it("never signals after the stub's exit on cancellation by the process exit", async () => {
    vi.resetModules();
    const fresh = await import("./supervise.ts");
    const calls = probes("ESRCH");
    const before = new Set(process.listeners("exit"));
    const child = scripted();
    const run = fresh.supervise("stand-in", "/bin/sh", [], {
      run: 10_000,
      grace: 100,
    });
    child.exited(null, "SIGKILL");
    const ours = process
      .listeners("exit")
      .filter((listener) => !before.has(listener));
    expect(ours).toHaveLength(1);
    (ours[0] as () => void)();
    const error = await rejection(run);
    expect(error.message).toMatch(
      /^stand-in was cancelled by the process exit\n/u,
    );
    expect(error.message).toContain("its group was not signalled again");
    expect([calls, child.kill.mock.calls, child.control.destroyed]).toEqual([
      [],
      [],
      true,
    ]);
    await expect(
      fresh.supervise("later", "/bin/sh", [], limits),
    ).rejects.toThrow(/^later was not started: cancellation by /u);
    expect(process.listeners("exit").filter((l) => !before.has(l))).toEqual([]);
  });
});

describe.skipIf(posix)("the Windows run", () => {
  it("never kills a child whose exit was already seen", async () => {
    const child = scripted();
    const run = supervise("stand-in", "stand-in.exe", [], {
      run: 30,
      grace: 2_000,
    });
    child.exited(0, null);
    await sleep(80);
    child.closed();
    const error = await rejection(run);
    expect(error.message).toMatch(
      /^stand-in exited with status 0 but its output stayed open past 30 ms\n/u,
    );
    expect(error.message).toContain("was not signalled: it had already exited");
    expect(child.kill).not.toHaveBeenCalled();
  });
});
