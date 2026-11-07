// @vitest-environment node
import { transform } from "lightningcss";
import { describe, expect, it } from "vitest";
import { isThickness } from "./decimal.js";

// Vite's default lightningcss targets: baseline-widely-available, as major << 16 | minor << 8.
const viteTargets = {
  chrome: 111 << 16,
  edge: 111 << 16,
  firefox: 114 << 16,
  safari: (16 << 16) | (4 << 8),
  ios_saf: (16 << 16) | (4 << 8),
};

/** The bare 0, then every accepted px spelling from 0.0001px to 4px in steps of 0.0001px. */
function acceptedSpellings() {
  const out = ["0"];
  for (let k = 1; k <= 40000; k += 1) {
    const whole = String(Math.floor(k / 10000));
    const fraction = String(k % 10000)
      .padStart(4, "0")
      .replace(/0+$/, "");
    out.push(`${whole}${fraction === "" ? "" : `.${fraction}`}px`);
  }
  return out;
}

// Compiler output is compared as a string, so a rounded or exponent form cannot slip past.
const compiled = /^(?:0|(?:[0-3](?:\.[0-9]*)?|\.[0-9]+|4(?:\.0*)?)(?:px)?)$/;

describe("compiled thickness stays within 0 to 4px", () => {
  it("every accepted source spelling is accepted by the lint", () => {
    const spellings = acceptedSpellings();
    expect(spellings).toHaveLength(40001);
    expect(spellings.filter((s) => !isThickness(s))).toEqual([]);
  });

  it.each([false, true])(
    "lightningcss with minify %s keeps every value in range",
    (minify) => {
      const spellings = acceptedSpellings();
      // A distinct order per rule stops the compiler merging rules with equal widths.
      const source = spellings
        .map(
          (v, i) =>
            `.c${String(i)} { border-width: ${v}; order: ${String(i)}; }`,
        )
        .join("\n");
      const { code } = transform({
        filename: "Thickness.module.css",
        code: Buffer.from(source),
        cssModules: { pure: true },
        targets: viteTargets,
        minify,
      });
      const rules = [...code.toString().matchAll(/\{([^}]*)\}/g)].map((m) => ({
        width: /border-width:\s*([^;\s]+)/.exec(m[1])?.[1],
        order: /order:\s*([0-9]+)/.exec(m[1])?.[1],
      }));
      expect(rules.map((r) => r.order)).toEqual(
        spellings.map((_, i) => String(i)),
      );
      expect(rules.filter((r) => !compiled.test(r.width ?? ""))).toEqual([]);
    },
    60_000,
  );
});
