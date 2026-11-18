import { type ChildProcess, spawn } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Duplex, Readable } from "node:stream";

/** A command that ran to a normal exit, zero or not. */
interface Exit {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly status: number;
}

interface Limits {
  /** Milliseconds from the spawn until an unfinished run is stopped. */
  readonly run: number;
  /** Milliseconds a stopped run may take to end, and a finished one to leave no group behind. */
  readonly grace: number;
  /** Bytes kept from each output stream. */
  readonly cap?: number;
}

interface Options {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
}

const outputCap = 64 * 1024 * 1024;
// The stub sends one short record, so anything longer is a protocol failure.
export const recordLimit = 4096;

// POSIX runs go through the stub, which anchors the command's process group and kills it from
// inside while it is a member, so no group is ever signalled here by a number that can be reused.
const grouped = process.platform !== "win32";
const stubPath = join(
  realpathSync.native(import.meta.dirname),
  "supervise-stub.js",
);
// The stub's own Node startup must not load a caller's preload; the stub restores it for the command.
const preloadVariable = "SHARPLADDER_SUPERVISE_NODE_OPTIONS";
const probeInterval = 10;

type Report =
  | { readonly kind: "exit"; readonly code: number; readonly signal: null }
  | { readonly kind: "exit"; readonly code: null; readonly signal: string }
  | { readonly kind: "spawn-error"; readonly code: string };

interface Supervision {
  cancel(reason: string): Promise<void>;
  note(text: string): void;
}

const active = new Set<Supervision>();
let cancellation: string | undefined;

function onSignal(signal: NodeJS.Signals): void {
  if (cancellation !== undefined) {
    for (const s of active) s.note(`also received ${signal}`);
    return;
  }
  cancellation = signal;
  const alone = process.listenerCount(signal) === 1;
  const settled = [...active].map((s) => s.cancel(`cancelled by ${signal}`));
  // Another listener owns the exit; this one only cancels.
  if (!alone) return;
  void Promise.allSettled(settled).then(() => {
    uninstall();
    if (process.platform === "win32")
      process.exit(signal === "SIGINT" ? 130 : 143);
    else process.kill(process.pid, signal);
  });
}

// A forked worker never receives a signal sent to its runner alone, but its channel closes.
function onDisconnect(): void {
  if (cancellation !== undefined) {
    for (const s of active) s.note("also saw the owning runner disconnect");
    return;
  }
  cancellation = "the owning runner's disconnect";
  for (const s of active)
    void s.cancel("cancelled: the owning runner disconnected");
}

function onExit(): void {
  cancellation ??= "the process exit";
  for (const s of active) void s.cancel("cancelled by the process exit");
}

function install(): void {
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("exit", onExit);
  if (typeof process.send === "function")
    process.on("disconnect", onDisconnect);
}

function uninstall(): void {
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  process.off("exit", onExit);
  process.off("disconnect", onDisconnect);
}

function refusal(operation: string): string | undefined {
  if (cancellation !== undefined)
    return `${operation} was not started: cancellation by ${cancellation} has begun`;
  if (typeof process.send === "function" && !process.connected)
    return `${operation} was not started: the owning runner has disconnected`;
  return undefined;
}

// A link or a substitute at the stub's path would run other code as the group anchor.
function admittedStub(): string {
  if (
    realpathSync.native(stubPath) !== stubPath ||
    !lstatSync(stubPath).isFile()
  )
    throw new Error(
      `the supervision stub is not at its admitted path ${stubPath}`,
    );
  return stubPath;
}

// Both names travel in one value the stub always gets, so a caller's own value under the
// transport name can neither stand in for NODE_OPTIONS nor be lost.
function stubEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const carried = ["NODE_OPTIONS", preloadVariable];
  const kept = Object.entries(env).filter(([name]) => !carried.includes(name));
  const values = Object.fromEntries(
    carried.flatMap((name) => {
      const value = env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  return Object.fromEntries([
    ...kept,
    [preloadVariable, JSON.stringify(values)],
  ]);
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function parse(line: string): Report | string {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return "the result record is not JSON";
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return "the result record is not an object";
  const r = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(r).sort().join(",");
  const code = r["code"];
  const signal = r["signal"];
  if (r["v"] === 1 && r["kind"] === "exit" && keys === "code,kind,signal,v") {
    if (
      typeof code === "number" &&
      Number.isInteger(code) &&
      code >= 0 &&
      code <= 255 &&
      signal === null
    )
      return { kind: "exit", code, signal: null };
    if (
      code === null &&
      typeof signal === "string" &&
      /^SIG[A-Z0-9]+$/u.test(signal)
    )
      return { kind: "exit", code: null, signal };
    return "the exit record's code and signal do not match";
  }
  if (
    r["v"] === 1 &&
    r["kind"] === "spawn-error" &&
    keys === "code,kind,v" &&
    typeof code === "string" &&
    /^[A-Z][A-Z0-9_]*$/u.test(code)
  )
    return { kind: "spawn-error", code };
  return "the result record does not match its schema";
}

const outcome = (exit: { code: number | null; signal: string | null }) =>
  exit.signal === null
    ? `exited with status ${String(exit.code)}`
    : `was killed by ${exit.signal}`;

const described = (
  exit: { code: number | null; signal: string | null } | undefined,
) =>
  exit === undefined
    ? "no exit seen"
    : exit.signal === null
      ? `exit status ${String(exit.code)}`
      : `signal ${exit.signal}`;

/**
 * Runs one command with its output piped, stops it at the run deadline, and settles within
 * run + grace while the event loop can run. A normal exit, zero or not, resolves; every other
 * outcome rejects with its own diagnostic and the output kept so far. On POSIX the command runs
 * in a process group anchored by the stub, and a result counts only once the group is empty.
 */
export function supervise(
  operation: string,
  command: string,
  args: readonly string[],
  limits: Limits,
  options: Options = {},
): Promise<Exit> {
  const refused = refusal(operation);
  if (refused !== undefined) return Promise.reject(new Error(refused));
  const env = options.env ?? process.env;
  const cwd = options.cwd === undefined ? {} : { cwd: options.cwd };
  let child: ChildProcess;
  try {
    child = grouped
      ? spawn(process.execPath, [admittedStub(), command, ...args], {
          stdio: ["ignore", "pipe", "pipe", "pipe"],
          detached: true,
          env: stubEnvironment(env),
          ...cwd,
        })
      : spawn(command, args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          env,
          ...cwd,
        });
  } catch (error) {
    return Promise.reject(
      new Error(`${operation} could not start: ${messageOf(error)}`, {
        cause: error,
      }),
    );
  }
  return run(operation, command, child, limits);
}

function run(
  operation: string,
  command: string,
  child: ChildProcess,
  limits: Limits,
): Promise<Exit> {
  const cap = limits.cap ?? outputCap;
  const control = grouped ? (child.stdio[3] as Duplex | null) : null;
  const kept = {
    stdout: { chunks: [] as Buffer[], size: 0, over: false, closed: false },
    stderr: { chunks: [] as Buffer[], size: 0, over: false, closed: false },
  };
  const received: Buffer[] = [];
  let receivedSize = 0;
  let receivedOver = false;
  let primary: string | undefined;
  let cause: { readonly error: unknown } | undefined;
  const notes: string[] = [];
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let spawned = false;
  let stopping = false;
  let closed = false;
  let settled = false;
  const started = performance.now();
  let runTimer: NodeJS.Timeout | undefined;
  let graceTimer: NodeJS.Timeout | undefined;
  let probeTimer: NodeJS.Timeout | undefined;
  let finished = (): void => undefined;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });

  return new Promise<Exit>((resolve, reject) => {
    const note = (text: string) => {
      if (!notes.includes(text)) notes.push(text);
    };
    const guard = (body: () => void) => {
      try {
        body();
      } catch (error) {
        note(`teardown error: ${messageOf(error)}`);
      }
    };
    const shown = (name: "stdout" | "stderr") =>
      Buffer.concat(kept[name].chunks).toString("utf8");

    const settle = (body: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(runTimer);
      clearTimeout(graceTimer);
      clearTimeout(probeTimer);
      active.delete(self);
      if (active.size === 0) uninstall();
      body();
      finished();
    };
    const fail = () => {
      const message = `${primary ?? `${operation} failed`}${notes.map((n) => `\n${n}`).join("")}\nstdout:\n${shown("stdout")}\nstderr:\n${shown("stderr")}`;
      settle(() => {
        reject(
          cause === undefined
            ? new Error(message)
            : new Error(message, { cause: cause.error }),
        );
      });
    };
    const release = () => {
      for (const stream of [child.stdout, child.stderr, control])
        guard(() => {
          stream?.destroy();
        });
      guard(() => {
        child.unref();
      });
    };

    const judge = (): { record?: Report; problem?: string } => {
      if (receivedOver)
        return {
          problem: `the stub sent more than ${String(recordLimit)} bytes`,
        };
      const bytes = Buffer.concat(received);
      if (bytes.length === 0) return { problem: "no result record" };
      let all: string;
      try {
        all = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return { problem: "the result record is not valid UTF-8" };
      }
      const end = all.indexOf("\n");
      if (end < 0) return { problem: "the result record is incomplete" };
      if (all.slice(end + 1).trim() !== "")
        return {
          problem: "extra records or trailing data after the result record",
        };
      const record = parse(all.slice(0, end));
      return typeof record === "string" ? { problem: record } : { record };
    };

    // Teardown never signals a POSIX group from here: closing this end makes the stub kill it.
    const stop = () => {
      if (stopping || settled) return;
      stopping = true;
      clearTimeout(runTimer);
      clearTimeout(probeTimer);
      guard(() => {
        if (grouped) {
          if (exit !== undefined)
            note(
              `the supervision stub had already ended (${described(exit)}); its group was not signalled again`,
            );
          control?.destroy();
        } else if (exit !== undefined)
          note(
            `${operation} was not signalled: it had already exited; descendants not confirmed terminated`,
          );
        else if (!child.kill("SIGKILL")) note("the kill was not delivered");
      });
      graceTimer = setTimeout(() => {
        guard(() => {
          if (settled) return;
          const open = !(kept.stdout.closed && kept.stderr.closed);
          note(
            `teardown did not finish within ${String(limits.grace)} ms; ${grouped ? "stub" : "child"} exited: ${exit === undefined ? "no" : "yes"}; output open: ${open ? "yes" : "no"}`,
          );
          note("descendants not confirmed terminated");
          release();
        });
        fail();
      }, limits.grace);
    };

    const latch = (message: string, error?: { readonly error: unknown }) => {
      if (settled) return;
      if (primary !== undefined) {
        note(message);
        return;
      }
      primary = message;
      cause = error;
      // A close already seen leaves nothing to stop.
      if (closed) fail();
      else stop();
    };
    const defect = (text: string) => {
      if (primary === undefined)
        latch(`${operation} failed: supervision protocol: ${text}`);
      else note(`supervision protocol: ${text}`);
    };

    const self: Supervision = {
      cancel: (reason) => {
        latch(`${operation} was ${reason}`);
        return done;
      },
      note,
    };
    if (active.size === 0) install();
    active.add(self);

    const probe = (status: number, deadline: number) => {
      guard(() => {
        if (settled) return;
        const groupId = child.pid;
        if (groupId === undefined || groupId <= 0) {
          primary = `${operation} termination unconfirmed: the stub had no process ID`;
          fail();
          return;
        }
        try {
          process.kill(-groupId, 0);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ESRCH") {
            settle(() => {
              resolve({
                stdout: Buffer.concat(kept.stdout.chunks),
                stderr: Buffer.concat(kept.stderr.chunks),
                status,
              });
            });
            return;
          }
          primary = `${operation} termination unconfirmed: the group probe returned ${String(code)}`;
          fail();
          return;
        }
        // Killed members stay in the group until their reaper collects them.
        if (performance.now() >= deadline) {
          primary = `${operation} exited with status ${String(status)}, but its process group still had members after its output closed; termination unconfirmed`;
          fail();
          return;
        }
        probeTimer = setTimeout(
          () => {
            probe(status, deadline);
          },
          Math.max(0, Math.min(probeInterval, deadline - performance.now())),
        );
      });
    };

    const closedNormally = () => {
      if (!grouped) {
        const status = exit?.code;
        if (typeof exit?.signal === "string")
          primary = `${operation} was killed by ${exit.signal}`;
        else if (typeof status !== "number")
          primary = `${operation} ended without an exit status`;
        else {
          settle(() => {
            resolve({
              stdout: Buffer.concat(kept.stdout.chunks),
              stderr: Buffer.concat(kept.stderr.chunks),
              status,
            });
          });
          return;
        }
        fail();
        return;
      }
      const { record, problem } = judge();
      const ownKill = exit?.code === null && exit.signal === "SIGKILL";
      if (record === undefined)
        primary = ownKill
          ? `${operation} failed: the supervision stub ended by SIGKILL without a valid result record (${String(problem)})`
          : `${operation} failed: supervision protocol: ${String(problem)}; the stub ended with ${described(exit)}`;
      else if (!ownKill)
        primary = `${operation} failed: supervision protocol: the stub ended with ${described(exit)}, not by SIGKILL`;
      else if (record.kind === "spawn-error") {
        const error = Object.assign(
          new Error(`spawn ${command} ${record.code}`),
          { code: record.code },
        );
        primary = `${operation} could not start: ${error.message}`;
        cause = { error };
      } else if (record.signal !== null)
        primary = `${operation} was killed by ${record.signal}`;
      else {
        // However late the close came, probing ends by the run's own bound.
        probe(
          record.code,
          Math.min(
            performance.now() + limits.grace,
            started + limits.run + limits.grace,
          ),
        );
        return;
      }
      fail();
    };

    child.on("spawn", () => {
      spawned = true;
    });
    child.on("error", (error) => {
      guard(() => {
        if (settled) return;
        if (!spawned && exit === undefined && primary === undefined) {
          primary = `${operation} could not start: ${error.message}`;
          cause = { error };
          release();
          fail();
          return;
        }
        latch(`${operation} failed while running: ${error.message}`, { error });
      });
    });
    child.on("exit", (code, signal) => {
      exit = { code, signal };
    });
    child.on("close", () => {
      guard(() => {
        if (settled) return;
        closed = true;
        clearTimeout(runTimer);
        if (!stopping) {
          closedNormally();
          return;
        }
        if (grouped) {
          const { record, problem } = judge();
          note(
            record === undefined
              ? `supervision record: ${String(problem)}`
              : `supervision record: ${record.kind === "spawn-error" ? `spawn error ${record.code}` : described(record)}`,
          );
          note(`the supervision stub ended with ${described(exit)}`);
        }
        fail();
      });
    });

    const watch = (name: "stdout" | "stderr", stream: Readable | null) => {
      const k = kept[name];
      stream?.on("data", (chunk: Buffer) => {
        guard(() => {
          if (settled || k.over) return;
          const room = cap - k.size;
          if (chunk.length <= room) {
            k.chunks.push(chunk);
            k.size += chunk.length;
            return;
          }
          k.chunks.push(chunk.subarray(0, room));
          k.size = cap;
          k.over = true;
          latch(
            `${operation} printed more than ${String(cap)} bytes on ${name}`,
          );
        });
      });
      stream?.on("error", (error: Error) => {
        guard(() => {
          latch(`${operation} failed while running: ${error.message}`, {
            error,
          });
        });
      });
      stream?.on("close", () => {
        k.closed = true;
      });
    };
    watch("stdout", child.stdout);
    watch("stderr", child.stderr);

    control?.on("data", (chunk: Buffer) => {
      guard(() => {
        if (settled || receivedOver) return;
        if (receivedSize + chunk.length > recordLimit) {
          receivedOver = true;
          defect(`the stub sent more than ${String(recordLimit)} bytes`);
          return;
        }
        received.push(chunk);
        receivedSize += chunk.length;
      });
    });
    control?.on("error", (error: Error) => {
      guard(() => {
        defect(`the supervision channel failed: ${error.message}`);
      });
    });

    runTimer = setTimeout(() => {
      guard(() => {
        if (settled || stopping || closed) return;
        // On POSIX the command's own exit is known only from its record.
        const record = grouped ? judge().record : undefined;
        const ended =
          record === undefined
            ? grouped || exit === undefined
              ? undefined
              : outcome(exit)
            : record.kind === "exit"
              ? outcome(record)
              : undefined;
        latch(
          ended === undefined
            ? `${operation} timed out after ${String(limits.run)} ms`
            : `${operation} ${ended} but its output stayed open past ${String(limits.run)} ms`,
        );
      });
    }, limits.run);
  });
}
