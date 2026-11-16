// Kept in Node and fed only by operations the tests already make, so the record never asks the
// page anything and still holds what was running when a test stalls.

type Operation = "settle" | "screenshot" | "pixelDiff";

interface Tally {
  count: number;
  totalMs: number;
  maxMs: number;
}

type Tallies = Record<Operation, Tally>;

interface Call {
  readonly kind: Operation;
  readonly started: number;
  stage: string | null;
  end: (completed: boolean) => void;
}

interface Cell {
  readonly id: string;
  readonly started: number;
  readonly tallies: Tallies;
}

// A call that ended by rejection, kept out of the tallies so it never reads as completed work.
interface Interrupted {
  kind: Operation;
  elapsedMs: number;
  stage: string | null;
  cell: string | null;
}

interface TestRecord {
  readonly started: number;
  readonly tallies: Tallies;
  readonly open: Set<Call>;
  readonly interrupted: Interrupted[];
  readonly cells: (ReturnType<typeof cellFigures> & { interrupted: boolean })[];
  cell: Cell | null;
}

// A worker process runs one test at a time, so it holds at most one open record.
let current: TestRecord | null = null;

const empty = (): Tallies => ({
  settle: { count: 0, totalMs: 0, maxMs: 0 },
  screenshot: { count: 0, totalMs: 0, maxMs: 0 },
  pixelDiff: { count: 0, totalMs: 0, maxMs: 0 },
});

const round = ({ count, totalMs, maxMs }: Tally) => ({
  count,
  totalMs: Math.round(totalMs),
  maxMs: Math.round(maxMs),
});

const rounded = (tallies: Tallies) => ({
  settle: round(tallies.settle),
  screenshot: round(tallies.screenshot),
  pixelDiff: round(tallies.pixelDiff),
});

function cellFigures(cell: Cell, testStarted: number, now: number) {
  return {
    id: cell.id,
    startMs: Math.round(cell.started - testStarted),
    elapsedMs: Math.round(now - cell.started),
    nestedInElapsed: rounded(cell.tallies),
  };
}

/** Registers a call before it is awaited, so one that never returns still shows as unfinished. */
export function begin(kind: Operation): Call {
  const record = current;
  const cell = record?.cell ?? null;
  const call: Call = {
    kind,
    started: performance.now(),
    stage: null,
    end: (completed) => {
      const took = performance.now() - call.started;
      record?.open.delete(call);
      if (!completed) {
        record?.interrupted.push({
          kind,
          elapsedMs: Math.round(took),
          stage: call.stage,
          cell: cell?.id ?? null,
        });
        return;
      }
      for (const tallies of [record?.tallies, cell?.tallies]) {
        if (tallies === undefined) continue;
        const tally = tallies[kind];
        tally.count += 1;
        tally.totalMs += took;
        tally.maxMs = Math.max(tally.maxMs, took);
      }
    },
  };
  record?.open.add(call);
  return call;
}

export async function timed<T>(
  kind: Operation,
  run: () => Promise<T>,
): Promise<T> {
  const call = begin(kind);
  let completed = false;
  try {
    const result = await run();
    completed = true;
    return result;
  } finally {
    call.end(completed);
  }
}

/** One matrix cell, so a slow cell is named and its operations are told apart from the rest. */
export async function cell<T>(id: string, run: () => Promise<T>): Promise<T> {
  const record = current;
  const entry: Cell = { id, started: performance.now(), tallies: empty() };
  if (record !== null) record.cell = entry;
  let completed = false;
  try {
    const result = await run();
    completed = true;
    return result;
  } finally {
    if (record !== null) {
      record.cells.push({
        ...cellFigures(entry, record.started, performance.now()),
        interrupted: !completed,
      });
      if (record.cell === entry) record.cell = null;
    }
  }
}

/** The record as it stands, including any call or cell still running when it is read. */
export function evidence() {
  const record = current;
  if (record === null) return null;
  const now = performance.now();
  return {
    elapsedMs: Math.round(now - record.started),
    nestedInElapsed: rounded(record.tallies),
    unfinished: [...record.open].map((call) => ({
      kind: call.kind,
      elapsedMs: Math.round(now - call.started),
      stage: call.stage,
    })),
    interrupted: record.interrupted,
    currentCellNestedInTest:
      record.cell === null
        ? null
        : cellFigures(record.cell, record.started, now),
    cellsNestedInTest: record.cells,
  };
}

export function startTest() {
  current = {
    started: performance.now(),
    tallies: empty(),
    open: new Set(),
    interrupted: [],
    cells: [],
    cell: null,
  };
}

/** Closes the record; a call that outlives its test then counts towards nothing. */
export function endTest() {
  const record = evidence();
  current = null;
  return record;
}
