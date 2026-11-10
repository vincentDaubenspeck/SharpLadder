// The Group D matrix axes, shared by the emulated and the real high-contrast specs.

/** Every data-theme value Group D covers; null is the attribute absent. */
export const themes = [null, "light", "dark"] as const;
export type Theme = (typeof themes)[number];

const widths = [1920, 390] as const;

export const viewportAt = (width: number) => ({
  width,
  height: width === 390 ? 844 : 1080,
});

export interface Cell {
  width: number;
  theme: Theme;
  key: string;
}

/** Every width and theme pair, widths outermost so each width is resized to once. */
export function groupDCells(): Cell[] {
  return widths.flatMap((width) =>
    themes.map((theme) => ({
      width,
      theme,
      key: `${String(width)}/${theme ?? "absent"}`,
    })),
  );
}
