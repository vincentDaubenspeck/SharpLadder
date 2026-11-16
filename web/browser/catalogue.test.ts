// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  belowMinimum,
  contexts,
  contrastPairs,
  expectedTokens,
  pairRatio,
  runtimeTokens,
  widthQueries,
  workPairs,
  type PageState,
} from "./catalogue.ts";

const sets = contexts();

describe("contrast from the catalogue", () => {
  const contrastStates: PageState[] = [
    { theme: null, scheme: "light", print: false, work: false },
    { theme: "light", scheme: "dark", print: false, work: false },
    { theme: "dark", scheme: "light", print: false, work: false },
    { theme: null, scheme: "dark", print: false, work: false },
    { theme: null, scheme: "light", print: true, work: false },
    { theme: "dark", scheme: "dark", print: true, work: false },
  ];

  it("contrast pairs reach their minimum in light, dark and print", () => {
    const failures = contrastStates.flatMap((state) =>
      belowMinimum(state, contrastPairs, sets),
    );
    for (const theme of [null, "dark"] as const)
      failures.push(
        ...belowMinimum(
          { theme, scheme: "dark", print: false, work: true },
          workPairs,
          sets,
        ),
      );
    expect(failures).toEqual([]);
  });

  it("control: contrast thresholds and a decorative line fail", () => {
    const state: PageState = {
      theme: "dark",
      scheme: "light",
      print: false,
      work: false,
    };
    const line = { fg: "--line", bg: "--surface", min: 3, kind: "control" };
    expect(belowMinimum(state, [line], sets)).toHaveLength(1);
    const measured = pairRatio(state, "--muted", "--surface", sets);
    const at = (min: number) => ({
      fg: "--muted",
      bg: "--surface",
      min,
      kind: "control",
    });
    expect(belowMinimum(state, [at(measured + 0.01)], sets)).toHaveLength(1);
    expect(belowMinimum(state, [at(measured - 0.01)], sets)).toEqual([]);
  });

  it("refuses a translucent colour", () => {
    const state: PageState = {
      theme: null,
      scheme: "light",
      print: false,
      work: false,
    };
    expect(() => pairRatio(state, "--header-bg", "--surface", sets)).toThrow(
      /not a #rrggbb colour/u,
    );
  });
});

it("TH1 the runtime-only name is declared nowhere", () => {
  const names = runtimeTokens();
  expect(names.length).toBeGreaterThan(0);
  for (const theme of [null, "light", "dark"] as const)
    for (const scheme of ["light", "dark"] as const)
      for (const print of [false, true])
        for (const work of [false, true]) {
          const declared = expectedTokens({ theme, scheme, print, work }, sets);
          expect(names.filter((name) => name in declared)).toEqual([]);
        }
});

describe("the token tests' desktop-only scope", () => {
  it("holds while tokens.css has no width media query", () => {
    expect(widthQueries()).toEqual([]);
  });

  it("fails on a width media query", () => {
    expect(
      widthQueries("@media (min-width: 40rem) { :root { --gap: 1rem; } }"),
    ).toEqual(["(min-width: 40rem)"]);
  });
});
