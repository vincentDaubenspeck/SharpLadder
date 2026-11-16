// @vitest-environment node
import type { Page } from "@playwright/test";
import { createContext, runInContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cell, endTest, startTest } from "./evidence.ts";
import { settle } from "./probe.ts";

/**
 * A page whose timers and frames run only when the case says so. The evaluated function crosses
 * as source text, as it does to a real page, so it reaches nothing in this module.
 */
function fakePage(
  font: { whenReady: () => Promise<void>; status: () => string },
  visibility: string,
) {
  let now = 0;
  let next = 1;
  const log: string[] = [];
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { due: number; run: () => void }>();
  const cancelled: number[] = [];
  const context = createContext({
    performance: { now: () => now },
    setTimeout: (run: () => void, ms: number) => {
      timers.set(next, { due: now + ms, run });
      return next++;
    },
    clearTimeout: (id: number) => timers.delete(id),
    requestAnimationFrame: (run: () => void) => {
      log.push("frame");
      frames.set(next, run);
      return next++;
    },
    cancelAnimationFrame: (id: number) => {
      cancelled.push(id);
      frames.delete(id);
    },
    document: {
      visibilityState: visibility,
      body: {
        getBoundingClientRect: () => {
          log.push("layout");
        },
      },
      fonts: {
        get ready() {
          log.push("fonts.ready");
          return font.whenReady();
        },
        get status() {
          log.push("status");
          return font.status();
        },
        [Symbol.iterator]: () => [{ status: "loading" }][Symbol.iterator](),
      },
    },
  });
  const evaluate = vi.fn((fn: (arg: unknown) => unknown, arg: unknown) =>
    (runInContext(`(${fn.toString()})`, context) as typeof fn)(arg),
  );
  return {
    page: { evaluate } as unknown as Page,
    evaluate,
    log,
    frames,
    timers,
    cancelled,
    /** Runs every frame callback requested so far, as one engine frame would. */
    fireFrames() {
      const due = [...frames];
      frames.clear();
      for (const [, run] of due) run();
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers])
        if (timer.due <= now) {
          timers.delete(id);
          timer.run();
        }
    },
  };
}

const flush = () =>
  new Promise<void>((done) => {
    setImmediate(done);
  });

const outcome = (call: Promise<void>) =>
  call.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : "no error"),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  startTest();
});

afterEach(() => {
  endTest();
  vi.useRealTimers();
});

describe("settle", () => {
  it("passes through the unchanged sequence and clears every timer", async () => {
    let reads = 0;
    const fake = fakePage(
      {
        whenReady: () => Promise.resolve(),
        status: () => (reads++ === 0 ? "loading" : "loaded"),
      },
      "visible",
    );
    const call = outcome(settle(fake.page));
    for (let round = 0; round < 20; round += 1) {
      await flush();
      fake.fireFrames();
    }
    expect(await call).toBeNull();
    const pass = [
      "layout",
      "frame",
      "frame",
      "fonts.ready",
      "frame",
      "frame",
      "status",
    ];
    expect(fake.log).toEqual([...pass, ...pass]);
    expect([fake.frames.size, fake.timers.size, vi.getTimerCount()]).toEqual([
      0, 0, 0,
    ]);
    expect(fake.evaluate).toHaveBeenCalledTimes(1);
    const record = endTest();
    expect(record?.nestedInElapsed.settle.count).toBe(1);
    expect(record?.unfinished).toEqual([]);
  });

  it("fails with the stage record when the in-page deadline expires, and the late font continuation does nothing", async () => {
    const held: (() => void)[] = [];
    const fake = fakePage(
      {
        whenReady: () =>
          new Promise<void>((resolve) => {
            held.push(resolve);
          }),
        status: () => "loading",
      },
      "visible",
    );
    const failure = outcome(cell("390/dark/light", () => settle(fake.page)));
    for (let round = 0; round < 5; round += 1) {
      await flush();
      fake.fireFrames();
    }
    expect(fake.log.at(-1)).toBe("fonts.ready");
    fake.advance(10_000);
    const message = await failure;
    expect(message).toContain(
      `settle: the page did not settle within 10000 ms: ${JSON.stringify({
        stage: "fonts.ready",
        iteration: 1,
        fontsStatus: "loading",
        loadingFaces: 1,
        visibility: "visible",
        elapsedMs: 10_000,
      })}`,
    );
    expect(message).toMatch(
      /"unfinished":\[\{"kind":"settle","elapsedMs":\d+,"stage":"fonts\.ready"\}\]/u,
    );
    expect([fake.frames.size, fake.timers.size, vi.getTimerCount()]).toEqual([
      0, 0, 0,
    ]);
    const seen = [...fake.log];
    for (const resolve of held) resolve();
    await flush();
    fake.fireFrames();
    fake.advance(20_000);
    await flush();
    expect(fake.log).toEqual(seen);
    expect(fake.evaluate).toHaveBeenCalledTimes(1);
    const record = endTest();
    expect(record?.interrupted).toMatchObject([
      { kind: "settle", stage: "fonts.ready", cell: "390/dark/light" },
    ]);
    expect(record?.cellsNestedInTest).toMatchObject([
      { id: "390/dark/light", interrupted: true },
    ]);
    expect(record?.nestedInElapsed.settle.count).toBe(0);
  });

  it("fails on the Node watchdog when the page stops answering, and never uses the page again", async () => {
    const fake = fakePage(
      { whenReady: () => Promise.resolve(), status: () => "loading" },
      "hidden",
    );
    const failure = outcome(settle(fake.page));
    await flush();
    const [stale] = [...fake.frames.values()];
    expect(fake.log).toEqual(["layout", "frame"]);
    await vi.advanceTimersByTimeAsync(12_000);
    const message = await failure;
    expect(message).toMatch(
      /^settle: diagnostics unavailable, the page did not answer within 12000 ms; evidence .*"unfinished":\[\{"kind":"settle","elapsedMs":\d+,"stage":null\}\]/u,
    );
    expect(vi.getTimerCount()).toBe(0);
    // A throttled page that wakes later still stops its own wait and cancels its frame.
    fake.advance(10_000);
    await flush();
    expect(fake.cancelled).toHaveLength(1);
    expect([fake.frames.size, fake.timers.size]).toEqual([0, 0]);
    const seen = [...fake.log];
    stale?.();
    await flush();
    fake.fireFrames();
    expect(fake.log).toEqual(seen);
    expect(fake.evaluate).toHaveBeenCalledTimes(1);
  });
});
