// @vitest-environment node
import type * as ChildProcessModule from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import type * as FsPromisesModule from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as SuperviseModule from "./supervise.ts";

type Outcome = Promise<{ stdout: Buffer; stderr: Buffer; status: number }>;

const fake = vi.hoisted(() => ({
  supervise: undefined as ((operation: string) => Outcome) | undefined,
  calls: [] as {
    operation: string;
    args: readonly string[];
    limits: unknown;
  }[],
  rm: undefined as ((path: string) => Promise<void>) | undefined,
  spawnSync: undefined as ((args: readonly string[]) => unknown) | undefined,
}));

// Every row scripts the supervised outcome, so no compiler or child is ever started here.
vi.mock("./supervise.ts", async (importOriginal) => {
  const real = await importOriginal<typeof SuperviseModule>();
  return {
    ...real,
    supervise: (
      operation: string,
      command: string,
      args: readonly string[],
      limits: Parameters<typeof real.supervise>[3],
      options: Parameters<typeof real.supervise>[4],
    ) => {
      fake.calls.push({ operation, args, limits });
      return fake.supervise === undefined
        ? real.supervise(operation, command, args, limits, options)
        : fake.supervise(operation);
    },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof FsPromisesModule>();
  return {
    ...real,
    rm: (path: string, options: Parameters<typeof real.rm>[1]) =>
      fake.rm === undefined ? real.rm(path, options) : fake.rm(path),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof ChildProcessModule>();
  return {
    ...real,
    spawnSync: (command: string, args: readonly string[], options: object) =>
      fake.spawnSync === undefined
        ? real.spawnSync(command, args, options)
        : fake.spawnSync(args),
  };
});

const build = "content compiler build";
const records = "content compiler test-records";
const envelope = '{"version":3,"records":[]}';
const exited = (status: number, stdout = "") =>
  Promise.resolve({
    stdout: Buffer.from(stdout),
    stderr: Buffer.alloc(0),
    status,
  });
const succeeding = (operation: string) =>
  exited(0, operation === records ? envelope : "");
// A fresh module per row, since the build is shared for the life of one.
const fresh = async () => {
  vi.resetModules();
  return import("./records.ts");
};
const staging = () => {
  const call = fake.calls.find((c) => c.operation === records);
  return dirname(call?.args.at(-1) ?? "");
};
const left: string[] = [];

afterEach(() => {
  fake.supervise = undefined;
  fake.rm = undefined;
  fake.spawnSync = undefined;
  fake.calls = [];
  vi.useRealTimers();
  for (const folder of left.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

describe("compiler runs", () => {
  it("builds once with the build servers off, then runs test-records under its own limits", async () => {
    fake.supervise = succeeding;
    const { runTestRecords, buildLimits, recordsLimits } = await fresh();
    for (let i = 0; i < 2; i++)
      expect(await runTestRecords()).toEqual({
        stdout: new Uint8Array(Buffer.from(envelope)),
        stderr: "",
        exit: 0,
      });
    expect(fake.calls.map((c) => [c.operation, c.limits])).toEqual([
      [build, buildLimits],
      [records, recordsLimits],
      [records, recordsLimits],
    ]);
    expect(fake.calls[0]?.args.slice(-1)).toEqual(["--disable-build-servers"]);
    expect(existsSync(staging())).toBe(false);
    fake.calls = [];
    await (await fresh()).runTestRecords({ builtByGlobalSetup: true });
    expect(fake.calls.map((c) => c.operation)).toEqual([records]);
  });

  it.each(["content compiler build timed out after 90000 ms"])(
    "gives every caller the one rejection of a failed build: %s",
    async (message) => {
      const failure = new Error(message);
      fake.supervise = (operation) =>
        operation === build ? Promise.reject(failure) : succeeding(operation);
      const { runTestRecords } = await fresh();
      const both = await Promise.allSettled([
        runTestRecords(),
        runTestRecords(),
      ]);
      expect(both).toEqual([
        { status: "rejected", reason: failure },
        { status: "rejected", reason: failure },
      ]);
      expect((both[0] as PromiseRejectedResult).reason).toBe(failure);
      await expect(runTestRecords()).rejects.toBe(failure);
      expect(fake.calls.map((c) => c.operation)).toEqual([build]);
    },
  );

  it("fails a build that exits non-zero and runs nothing after it", async () => {
    fake.supervise = (operation) =>
      operation === build ? exited(1, "error CS1002") : succeeding(operation);
    const { runTestRecords } = await fresh();
    await expect(runTestRecords()).rejects.toThrow(
      /^content compiler build failed \(exit 1\):\nerror CS1002$/u,
    );
    expect(fake.calls.map((c) => c.operation)).toEqual([build]);
  });

  it("keeps a failed run's own error and removes the staging folder", async () => {
    const failure = new Error(`${records} timed out after 20000 ms`);
    fake.supervise = () => Promise.reject(failure);
    const { runTestRecords } = await fresh();
    await expect(runTestRecords({ builtByGlobalSetup: true })).rejects.toBe(
      failure,
    );
    expect(existsSync(staging())).toBe(false);
  });
});

describe("staging cleanup", () => {
  const ebusy = () =>
    Object.assign(new Error("EBUSY: resource busy or locked"), {
      code: "EBUSY",
    });

  it("fails a successful run whose cleanup fails, with the removal error as the cause", async () => {
    const error = ebusy();
    fake.supervise = succeeding;
    fake.rm = (path) => {
      left.push(path);
      return Promise.reject(error);
    };
    const { runTestRecords } = await fresh();
    const failed = await runTestRecords({ builtByGlobalSetup: true }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(failed?.message).toBe(
      `staging cleanup of ${staging()} failed: EBUSY: resource busy or locked`,
    );
    expect(failed?.cause).toBe(error);
  });

  it("appends a failed cleanup to a failed run and keeps the run's cause", async () => {
    const cause = new Error("spawn ENOENT");
    fake.supervise = () =>
      Promise.reject(new Error(`${records} could not start`, { cause }));
    fake.rm = (path) => {
      left.push(path);
      return Promise.reject(ebusy());
    };
    const { runTestRecords } = await fresh();
    const failed = await runTestRecords({ builtByGlobalSetup: true }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(failed?.message).toBe(
      `${records} could not start\nstaging cleanup of ${staging()} failed: EBUSY: resource busy or locked`,
    );
    expect(failed?.cause).toBe(cause);
  });

  it.each([true])(
    "reports a cleanup that overruns its bound (run succeeded: %s)",
    async (succeeded) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let late: ((error: Error) => void) | undefined;
      fake.supervise = (operation) =>
        succeeded
          ? succeeding(operation)
          : Promise.reject(new Error(`${records} timed out after 20000 ms`));
      fake.rm = (path) => {
        left.push(path);
        return new Promise((_resolve, reject) => {
          late = reject;
        });
      };
      const { runTestRecords, cleanupBound } = await fresh();
      const call = runTestRecords({ builtByGlobalSetup: true }).then(
        () => undefined,
        (e: unknown) => e as Error,
      );
      await vi.advanceTimersByTimeAsync(cleanupBound - 1);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      const overrun = `staging cleanup of ${staging()} did not finish within 10000 ms; the folder may be left behind`;
      expect((await call)?.message).toBe(
        succeeded ? overrun : `${records} timed out after 20000 ms\n${overrun}`,
      );
      // The removal that lost the race may still fail; its handler keeps that silent.
      late?.(ebusy());
      await vi.advanceTimersByTimeAsync(0);
    },
  );

  it("clears the cleanup timer when the removal wins", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fake.supervise = succeeding;
    const { runTestRecords } = await fresh();
    await runTestRecords({ builtByGlobalSetup: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("callers of a rejected run", () => {
  it("rejects the global setup with the run's own error and cause", async () => {
    const cause = new Error("spawn ENOENT");
    const failure = new Error(`${records} could not start`, { cause });
    const { default: setup } = await import("./global-setup.ts");
    await expect(
      setup({ provide: () => undefined }, () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(failure.cause).toBe(cause);
  });

  it("fails the acceptance run when the records run times out after Vitest passed", async () => {
    let out = "";
    fake.spawnSync = (args) => {
      const results = args.find((a) => a.startsWith("--outputFile.json="));
      out = dirname(results?.slice("--outputFile.json=".length) ?? "");
      return { status: 0 };
    };
    fake.supervise = (operation) =>
      operation === build
        ? succeeding(operation)
        : Promise.reject(new Error(`${records} timed out after 20000 ms`));
    vi.resetModules();
    const { acceptRun } = await import("./acceptance.ts");
    const lines: string[] = [];
    expect(await acceptRun([], (line) => lines.push(line))).toBe(1);
    expect(lines).toEqual([
      `acceptance evidence: the Vitest report could not be judged: Error: ${records} timed out after 20000 ms`,
    ]);
    expect([out === "", existsSync(out)]).toEqual([false, false]);
  });
});
