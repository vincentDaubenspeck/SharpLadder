import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  authenticate,
  base64,
  loadBaselines,
  review,
  covers,
  environments,
  host,
  shippedFaces,
  systemFace,
  systemFamilies,
  writeEvidence,
  writeObserved,
  type BaselineIdentity,
  type Environment,
  type Face,
  type Role,
} from "./fonts.ts";
import { resize } from "./indicators.ts";
import {
  applyEnvironment,
  differing,
  distUrl,
  settle,
  shot,
  watchFonts,
} from "./probe.ts";

const faces = shippedFaces();
const platform = host().platform;
const roles: Record<Role, string> = { ui: "p", display: "h1", code: "code" };
const roleNames = Object.keys(roles) as Role[];
const latin = "Grow Marvel 0137@&?";
const ascii = Array.from({ length: 0x7e - 0x20 }, (_, i) =>
  String.fromCodePoint(0x21 + i),
).join("");
const witness: Record<Role, string> = {
  ui: latin,
  display: latin,
  code: ascii,
};
// Outside every shipped face's recorded coverage, so it must come from a later family.
const uncovered = "漢";
const mixed = `Hg${uncovered}am`;
// A family no environment can resolve; whatever it renders is the engine's last resort.
const control = "sl-control-absent-family";
const generics = ["sans-serif", "serif", "monospace"];
// The size glyph images are rendered at; advances are measured at 100px.
const glyphSize = "28px";
const alias = (face: Face) => `sl-ref-${face.distPath.replace(/\W/g, "-")}`;

const faceOf = (family: string) => {
  const face = faces.find((known) => known.family === family);
  if (face === undefined) throw new Error(`no shipped face ${family}`);
  return face;
};

// Every witness glyph must be inside the face's recorded coverage and the uncovered glyph outside all.
for (const env of environments(platform))
  for (const role of roleNames) {
    const want = env.expect[role];
    if (want.kind !== "shipped") continue;
    const face = faceOf(want.family);
    for (const glyph of witness[role] + mixed.replace(uncovered, ""))
      if (!covers(face, glyph.codePointAt(0) ?? -1))
        throw new Error(`witness ${glyph} is outside ${face.family}`);
  }
if (faces.some((face) => covers(face, uncovered.codePointAt(0) ?? -1)))
  throw new Error("the uncovered witness glyph is covered by a shipped face");

const engineOf = (info: TestInfo) => String(info.project.metadata["engine"]);
const versionOf = (info: TestInfo) => String(info.project.metadata["version"]);

interface Probe {
  id: string;
  role: Role;
  family: string | null;
  text: string;
}
interface Measured {
  widths: number[];
  family: string;
  weight: string;
  style: string;
  stretch: string;
  size: string;
  featureSettings: string;
  variationSettings: string;
  opticalSizing: string;
  ligatures: string;
}

/**
 * Renders each probe as its role's element, one span per glyph at 100px, and returns every
 * glyph's advance. A null family keeps the role's own stack; anything else is test-only inline.
 */
async function measure(page: Page, probes: Probe[], split = true) {
  await place(page, probes, split);
  await settle(page);
  return read(page, probes);
}

/** Advances read at once, without waiting for font readiness, for a load still in flight. */
async function measureNow(page: Page, probes: Probe[]) {
  await place(page, probes, true);
  return read(page, probes);
}

async function place(page: Page, probes: Probe[], split: boolean) {
  await page.evaluate(
    ({ probes, roles, split }) => {
      document.querySelector("[data-font-probes]")?.remove();
      const box = document.createElement("div");
      box.dataset["fontProbes"] = "";
      box.style.cssText = "position:absolute;left:0;top:0;";
      for (const probe of probes) {
        const element = document.createElement(roles[probe.role]);
        element.dataset["probe"] = probe.id;
        element.style.cssText = "margin:0;display:block;white-space:pre;";
        if (probe.family !== null) element.style.fontFamily = probe.family;
        const glyphs = split ? Array.from(probe.text) : [probe.text];
        for (const glyph of glyphs) {
          const span = document.createElement("span");
          span.style.fontSize = "100px";
          // Each glyph starts its own line at x 0, so its width carries no position rounding.
          if (split) span.style.cssText += "float:left;clear:left;";
          span.textContent = glyph;
          element.append(span);
        }
        box.append(element);
      }
      document.body.append(box);
    },
    { probes, roles, split },
  );
}

async function read(page: Page, probes: Probe[]) {
  return page.evaluate(
    (ids) => {
      const out: Record<string, Measured> = {};
      for (const id of ids) {
        const element = document.querySelector(`[data-probe="${id}"]`);
        if (element === null) throw new Error(`probe ${id} missing`);
        const style = getComputedStyle(element);
        const first = element.firstElementChild;
        const glyph = first === null ? style : getComputedStyle(first);
        const widths: number[] = [];
        for (const span of Array.from(element.children)) {
          const text = span.firstChild;
          if (text === null) throw new Error(`probe ${id} has an empty span`);
          // One range per code point, so a mixed run reports each glyph's own advance.
          for (let i = 0; i < (text.textContent ?? "").length; i += 1) {
            const range = document.createRange();
            range.setStart(text, i);
            range.setEnd(text, i + 1);
            widths.push(range.getBoundingClientRect().width);
          }
        }
        out[id] = {
          widths,
          family: style.fontFamily,
          weight: style.fontWeight,
          style: style.fontStyle,
          stretch: style.fontStretch,
          size: glyph.fontSize,
          featureSettings: glyph.fontFeatureSettings,
          variationSettings: glyph.fontVariationSettings,
          opticalSizing: glyph.fontOpticalSizing,
          ligatures: glyph.fontVariantLigatures,
        };
      }
      return out;
    },
    probes.map((probe) => probe.id),
  );
}

/**
 * Adds reference faces under aliases no stack names, from bytes the test fetched from the
 * verified dist and checked against the build record; a face that does not load is refused.
 */
async function register(
  page: Page,
  references: { alias: string; face: Face; data: string }[],
) {
  const declared = await page.evaluate(() =>
    Array.from(document.fonts, (face) => face.family.replace(/^"|"$/g, "")),
  );
  for (const { alias } of references)
    if (!alias.startsWith("sl-ref-") || declared.includes(alias))
      throw new Error(`reference ${alias} is not an independent alias`);
  const status = await page.evaluate(
    async (references) =>
      Promise.all(
        references.map(async ({ alias, data, weight, style, stretch }) => {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
          const face = new FontFace(alias, bytes.buffer, {
            weight,
            style,
            stretch,
          });
          document.fonts.add(face);
          await face.load().catch(() => undefined);
          return face.status;
        }),
      ),
    references.map(({ alias, face, data }) => ({
      alias,
      data,
      weight: `${String(face.weight[0])} ${String(face.weight[1])}`,
      style: face.style,
      stretch: `${String(face.stretch[0])}% ${String(face.stretch[1])}%`,
    })),
  );
  status.forEach((value, i) => {
    if (value !== "loaded")
      throw new Error(
        `reference ${references[i]?.alias ?? ""} is ${value}, not loaded`,
      );
  });
}

/** Fetches every shipped face from the dist server and authenticates it before use. */
async function references(page: Page) {
  return Promise.all(
    faces.map(async (face) => {
      const response = await page.request.get(`${distUrl}${face.distPath}`);
      const bytes = await response.body();
      authenticate(face, bytes);
      return { alias: alias(face), face, data: base64(bytes) };
    }),
  );
}

/** Every candidate a role could render, measured with the role's own weight and style. */
const candidates = (role: Role, text: string): Probe[] => [
  ...faces.map((face) => ({
    id: `${role}-ref:${face.family}`,
    role,
    family: `"${alias(face)}"`,
    text,
  })),
  ...systemFamilies(platform).map((family) => ({
    id: `${role}-system:${family}`,
    role,
    family: `"${family}"`,
    text,
  })),
  ...generics.map((family) => ({
    id: `${role}-generic:${family}`,
    role,
    family,
    text,
  })),
  { id: `${role}-control`, role, family: `"${control}"`, text },
];

// Firefox lays out in 1/60 px units, and its range boxes for one fallback glyph can differ below that.
const layoutUnits = (engine: string, width: number) =>
  engine === "firefox" ? Math.round(width * 60) : width;

const same = (a: number[], b: number[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/** Candidate ids whose advances equal the target exactly; identical bytes and instance give identical advances. */
const matching = (
  target: number[],
  measured: Record<string, Measured>,
  role: Role,
) =>
  Object.entries(measured)
    .filter(
      ([id, value]) =>
        id.startsWith(`${role}-`) &&
        id !== `${role}-target` &&
        same(value.widths, target),
    )
    .map(([id]) => id.slice(role.length + 1))
    .sort();

// Firefox sets the optical size from the font size, so at the witness size the named Text and
// Display families render one instance; the pair still differs from every shipped face and the control.
const sameInstance: Record<string, string[]> = {
  firefox: [
    "system:Segoe UI Variable Display",
    "system:Segoe UI Variable Text",
  ],
};

const expectedMatches = (engine: string, id: string) =>
  sameInstance[engine]?.includes(id) === true ? sameInstance[engine] : [id];

const expectedId = (env: Environment, role: Role) =>
  env.expect[role].kind === "shipped"
    ? `ref:${env.expect[role].family}`
    : `system:${env.expect[role].family}`;

/** The stack after the expected family: what renders a glyph the expected face lacks. */
function remainder(stack: string, family: string, last = `"${control}"`) {
  const families = stack.split(",").map((name) => name.trim());
  const at = families.findIndex(
    (name) => name.replace(/^"|"$/g, "") === family,
  );
  if (at < 0) throw new Error(`stack ${stack} does not name ${family}`);
  const rest = families.slice(at + 1);
  return rest.length === 0 ? last : rest.join(", ");
}

/** Chromium's own report of the platform fonts behind an element's text, through DevTools. */
async function platformFonts(page: Page, info: TestInfo, selector: string) {
  if (engineOf(info) !== "chromium") return null;
  const session = await page.context().newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const { root } = await session.send("DOM.getDocument");
  const { nodeId } = await session.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });
  const { fonts } = await session.send("CSS.getPlatformFontsForNode", {
    nodeId,
  });
  await session.detach();
  return fonts
    .map(
      (font) =>
        `${font.familyName}|${font.postScriptName}|${font.isCustomFont ? "custom" : "system"}|${String(font.glyphCount)}`,
    )
    .sort();
}

/** Each whole-witness or mixed run as one text node, so DevTools reports the fonts behind it. */
async function wholeRuns(page: Page, info: TestInfo, ids: string[]) {
  const out: Record<string, string[] | null> = {};
  for (const id of ids)
    out[id] = await platformFonts(page, info, `[data-probe="${id}"] span`);
  return out;
}

/** SHA-256 of a screenshot's decoded pixels and size, so equal hashes mean identical rendering. */
async function pixelHash(page: Page, png: Uint8Array) {
  return page.evaluate(async (data) => {
    const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
    const image = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const size = new TextEncoder().encode(
      `${String(image.width)}x${String(image.height)}:`,
    );
    const all = new Uint8Array(size.length + pixels.length);
    all.set(size);
    all.set(pixels, size.length);
    const digest = await crypto.subtle.digest("SHA-256", all);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }, base64(png));
}

/**
 * Each probe rendered alone at one fixed place, size and colour, hashed from the engine's own
 * screenshot; the glyph half of the evidence, beside the advance widths.
 */
async function glyphImages(page: Page, probes: Probe[]) {
  const out: Record<string, string> = {};
  for (const probe of probes) {
    await page.evaluate(
      ({ probe, roles, glyphSize }) => {
        document.querySelector("[data-glyph-probe]")?.remove();
        const element = document.createElement(roles[probe.role]);
        element.dataset["glyphProbe"] = probe.id;
        element.style.cssText =
          "position:fixed;left:0;top:0;z-index:2147483647;margin:0;padding:4px;" +
          `white-space:pre;font-size:${glyphSize};line-height:1.5;background:#fff;color:#000;`;
        if (probe.family !== null) element.style.fontFamily = probe.family;
        element.textContent = probe.text;
        document.body.append(element);
      },
      { probe, roles, glyphSize },
    );
    await settle(page);
    const box = await page.locator("[data-glyph-probe]").boundingBox();
    if (box === null) throw new Error(`glyph probe ${probe.id} has no box`);
    out[probe.id] = await pixelHash(page, await shot(page, box));
  }
  await page.evaluate(() => {
    document.querySelector("[data-glyph-probe]")?.remove();
  });
  return out;
}

for (const env of environments(platform)) {
  test(`${env.name}: each role renders its expected face and nothing else`, async ({
    page,
  }, info) => {
    const served = watchFonts(page);
    await page.goto(distUrl);
    const stacks = await applyEnvironment(page, env);
    const targets = roleNames.map((role) => ({
      id: `${role}-target`,
      role,
      family: null,
      text: witness[role],
    }));
    await measure(page, targets);
    const wanted = roleNames
      .filter((role) => env.expect[role].kind === "shipped")
      .map((role) => faceOf(env.expect[role].family).distPath)
      .sort();
    // Recorded before any reference or uncovered glyph, so only the covered render's requests count.
    // A response can still be arriving once the render has settled, so the set is polled.
    let requested: Awaited<ReturnType<typeof served>> = [];
    await expect
      .poll(async () => {
        requested = await served();
        return requested.map((entry) => entry.path);
      }, "the covered render's font responses")
      .toEqual(wanted);
    const systemHash = roleNames.some(
      (role) => env.expect[role].kind === "system",
    )
      ? systemFace()
      : null;

    await register(page, await references(page));
    const all = [
      ...targets,
      ...roleNames.flatMap((role) => candidates(role, witness[role])),
    ];
    const measured = await measure(page, all);
    const whole = await measure(page, targets, false).then(() =>
      wholeRuns(
        page,
        info,
        targets.map((t) => t.id),
      ),
    );

    const mixedProbes = roleNames.flatMap((role): Probe[] => {
      const family = env.expect[role].family;
      const stack = measured[`${role}-target`]?.family ?? "";
      const alone =
        env.expect[role].kind === "shipped"
          ? `"${alias(faceOf(family))}"`
          : `"${family}"`;
      return [
        { id: `${role}-target`, role, family: null, text: mixed },
        { id: `${role}-alone`, role, family: alone, text: mixed },
        {
          id: `${role}-rest`,
          role,
          // With no later family the platform fallback starts from the face itself, as in the alias.
          family: remainder(stack, family, alone),
          text: mixed,
        },
      ];
    });
    const mixedMeasured = await measure(page, mixedProbes, false);
    const mixedFonts = await wholeRuns(
      page,
      info,
      roleNames.map((role) => `${role}-target`),
    );

    const glyphProbes = roleNames.flatMap((role): Probe[] => {
      const want = env.expect[role];
      return [
        { id: `${role}-target`, role, family: null, text: latin },
        {
          id: `${role}-reference`,
          role,
          family:
            want.kind === "shipped"
              ? `"${alias(faceOf(want.family))}"`
              : `"${want.family}"`,
          text: latin,
        },
        { id: `${role}-control`, role, family: `"${control}"`, text: latin },
      ];
    });
    const glyphs = await glyphImages(page, glyphProbes);

    await resize(page, { width: 390, height: 844 });
    const reflow = await page.evaluate(() => {
      document.querySelector("[data-font-probes]")?.remove();
      const box = document.createElement("div");
      box.dataset["fontProbes"] = "";
      const words =
        "The ladder holds every rung of the reference in a readable measure ".repeat(
          6,
        );
      box.innerHTML = `<h1>${words}</h1><p>${words}</p><p><code>${words}</code></p>`;
      document.body.append(box);
      const root = document.documentElement;
      return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
    });

    const engine = engineOf(info);
    const rows = roleNames.map((role) => {
      const want = env.expect[role];
      const target = measured[`${role}-target`];
      if (target === undefined) throw new Error(`no measurement for ${role}`);
      const faceSha256 =
        want.kind === "shipped"
          ? faceOf(want.family).sha256
          : (systemHash ?? "");
      return {
        role,
        expected: expectedId(env, role),
        face: want.family,
        faceSha256,
        stack: target.family,
        weight: target.weight,
        style: target.style,
        stretch: target.stretch,
        size: target.size,
        featureSettings: target.featureSettings,
        variationSettings: target.variationSettings,
        opticalSizing: target.opticalSizing,
        ligatures: target.ligatures,
        witness: witness[role],
        signature: target.widths,
        matches: matching(target.widths, measured, role),
        controlMatches: matching(
          measured[`${role}-control`]?.widths ?? [],
          measured,
          role,
        ),
        platformFonts: whole[`${role}-target`] ?? null,
        glyph: {
          text: latin,
          target: glyphs[`${role}-target`] ?? "",
          reference: glyphs[`${role}-reference`] ?? "",
          control: glyphs[`${role}-control`] ?? "",
        },
        mixed: {
          text: mixed,
          target: mixedMeasured[`${role}-target`]?.widths ?? [],
          alone: mixedMeasured[`${role}-alone`]?.widths ?? [],
          rest: mixedMeasured[`${role}-rest`]?.widths ?? [],
          platformFonts: mixedFonts[`${role}-target`] ?? null,
        },
      };
    });
    const record = {
      project: info.project.name,
      engine,
      engineVersion: versionOf(info),
      host: host(),
      environment: env.name,
      testOnly: env.testOnly,
      stacks,
      systemFaceSha256: systemHash,
      served: requested.map((entry) => ({
        ...entry,
        sourceUrl: `${distUrl}${entry.path}`,
        record:
          faces.find((face) => face.distPath === entry.path)?.sha256 ?? null,
      })),
      reflow,
      roles: rows,
    };
    const path = info.outputPath(`font-evidence-${env.name}.json`);
    await info.attach(`font-evidence-${env.name}.json`, {
      body: writeEvidence(path, record),
      contentType: "application/json",
    });

    // Only the faces the environment renders are requested, and their bytes are the recorded bytes.
    expect(requested.map((entry) => entry.path)).toEqual(wanted);
    for (const entry of record.served)
      expect(entry.sha256, entry.path).toBe(entry.record);
    // A viewport still at its old width would let the reflow comparison pass without testing 390.
    expect(reflow.clientWidth, "the viewport is 390 wide").toBe(390);
    expect(reflow.scrollWidth, "reflow at 390").toBeLessThanOrEqual(
      reflow.clientWidth,
    );

    for (const row of rows) {
      const where = `${env.name} ${row.role}`;
      // Each candidate is told apart from the control: an absent face would equal it.
      for (const [id, value] of Object.entries(measured))
        if (
          id.startsWith(`${row.role}-ref:`) ||
          id.startsWith(`${row.role}-system:`)
        )
          expect(
            same(value.widths, measured[`${row.role}-control`]?.widths ?? []),
            `${where}: ${id} equals the control`,
          ).toBe(false);
      expect(
        row.matches,
        `${where}: the target renders exactly the expected face`,
      ).toEqual(expectedMatches(engine, row.expected));
      expect(
        row.controlMatches.filter((id) => !id.startsWith("generic:")),
        `${where}: the negative control matches no face`,
      ).toEqual(["control"]);
      expect(
        row.signature.every((width) => width > 0),
        `${where}: every glyph has an advance`,
      ).toBe(true);
      // The rendered glyphs are the expected face's own, and the control's are not.
      expect(row.glyph.target, `${where}: glyphs equal the reference`).toBe(
        row.glyph.reference,
      );
      expect(
        row.glyph.target,
        `${where}: glyphs differ from the control`,
      ).not.toBe(row.glyph.control);
      if (row.role === "code")
        expect(
          new Set(row.signature).size,
          `${where}: code advances are fixed`,
        ).toBe(1);
      // The covered glyphs of a mixed run come from the expected face, the uncovered one from later in the stack.
      const at = Array.from(mixed).indexOf(uncovered);
      row.mixed.target.forEach((width, i) => {
        const source = i === at ? row.mixed.rest : row.mixed.alone;
        expect(
          layoutUnits(engine, width),
          `${where}: mixed glyph ${String(i)}`,
        ).toBe(layoutUnits(engine, source[i] ?? Number.NaN));
      });
      expect(row.mixed.target).toHaveLength(Array.from(mixed).length);
      if (row.platformFonts !== null) {
        expect(row.platformFonts, `${where}: one platform font`).toHaveLength(
          1,
        );
        expect(row.platformFonts[0]?.split("|")[2]).toBe(
          env.expect[row.role].kind === "shipped" ? "custom" : "system",
        );
        expect(
          row.mixed.platformFonts,
          `${where}: the uncovered glyph is another font`,
        ).toHaveLength(2);
        expect(row.mixed.platformFonts).toContain(
          row.platformFonts[0]?.replace(
            /\|\d+$/,
            `|${String(Array.from(mixed).length - 1)}`,
          ),
        );
      }
    }
    // Baselines last, so a missing baseline never hides a substitution finding.
    const reviewed = loadBaselines();
    const checked = rows.map((row) => {
      const identity: BaselineIdentity = {
        platform,
        arch: record.host.arch,
        engine,
        engineVersion: record.engineVersion,
        project: info.project.name,
        environment: env.name,
        role: row.role,
        face: row.face,
        faceSha256: row.faceSha256,
        witness: row.witness,
        glyphText: row.glyph.text,
        size: row.size,
        glyphSize,
        weight: row.weight,
        style: row.style,
        stretch: row.stretch,
        featureSettings: row.featureSettings,
        variationSettings: row.variationSettings,
        opticalSizing: row.opticalSizing,
        ligatures: row.ligatures,
      };
      const evidence = {
        os: record.host.os,
        signature: row.signature,
        platformFonts: row.platformFonts,
        glyphSha256: row.glyph.target,
      };
      return {
        row,
        identity,
        evidence,
        found: review(reviewed, identity, evidence),
      };
    });
    // Unreviewed identities are kept in the baseline file's own shape for a reviewer, never admitted.
    const unknown = checked.filter((entry) => !entry.found.known);
    const observed = info.outputPath(`font-observed-${env.name}.json`);
    if (unknown.length > 0)
      await info.attach(`font-observed-${env.name}.json`, {
        body: writeObserved(
          observed,
          unknown.map(({ identity, evidence }) => ({ identity, evidence })),
        ),
        contentType: "application/json",
      });
    const drift = checked.map(({ row, identity, found }) => {
      const where = `${env.name} ${row.role}`;
      // An identity nobody reviewed fails closed; admitting one is a reviewed edit of the file.
      expect(
        found,
        `${where}: no reviewed baseline for ${JSON.stringify(identity)}; the measured record is in ${path}, the observed entries in ${observed}`,
      ).toMatchObject({ known: true });
      return { role: row.role, drift: found.known ? found.drift : [] };
    });
    // Historical values that moved are reported for review, never failed and never rewritten.
    const moved = drift.filter((entry) => entry.drift.length > 0);
    if (moved.length > 0) {
      info.annotations.push({
        type: "font-baseline-drift",
        description: moved
          .map(
            (entry) =>
              `${env.name} ${entry.role}: ${entry.drift.map((d) => d.field).join(", ")}`,
          )
          .join("; "),
      });
      await info.attach(`font-baseline-drift-${env.name}.json`, {
        body: `${JSON.stringify(moved, null, 2)}\n`,
        contentType: "application/json",
      });
    }
  });
}

const shippedEnv = environments(platform).find((env) =>
  roleNames.every((role) => env.expect[role].kind === "shipped"),
);

test("served fonts are exactly the recorded build faces", async ({
  page,
}, info) => {
  const served = watchFonts(page);
  await page.goto(distUrl);
  const declared = await page.evaluate(async () =>
    Promise.all(
      Array.from(document.fonts, async (face) => {
        await face.load().catch(() => undefined);
        return {
          family: face.family.replace(/^"|"$/g, ""),
          status: face.status,
          weight: face.weight,
          style: face.style,
          stretch: face.stretch,
        };
      }),
    ),
  );
  // A response can still be arriving once the faces have loaded, so the set is polled.
  let got: Awaited<ReturnType<typeof served>> = [];
  await expect
    .poll(async () => {
      got = await served();
      return got.map((entry) => entry.path);
    }, "the served font responses")
    .toEqual(faces.map((face) => face.distPath).sort());
  const record = {
    project: info.project.name,
    engine: engineOf(info),
    engineVersion: versionOf(info),
    host: host(),
    declared,
    served: got,
  };
  writeEvidence(info.outputPath("font-served.json"), record);
  expect(declared.map((face) => face.family).sort()).toEqual(
    faces.map((face) => face.family).sort(),
  );
  expect(got.map((entry) => entry.path)).toEqual(
    faces.map((face) => face.distPath).sort(),
  );
  for (const face of faces) {
    const entry = got.find((item) => item.path === face.distPath);
    expect({ sha256: entry?.sha256, bytes: entry?.bytes }, face.family).toEqual(
      { sha256: face.sha256, bytes: face.byteLength },
    );
    expect(
      declared.find((item) => item.family === face.family)?.status,
      face.family,
    ).toBe("loaded");
  }
});

// Face status while its request is held or aborted, observed per engine at the pinned versions.
const loading: Record<string, { failed: string; delayed: string }> = {
  chromium: { failed: "error", delayed: "loading" },
  firefox: { failed: "error", delayed: "loading" },
  // WebKit eventually reports a held request as an error, yet still swaps the face in once it arrives.
  webkit: { failed: "error", delayed: "error" },
};

// One face is held or aborted at a time, so each stack's own substitution is proved and the others are unaffected.
for (const mode of ["failed", "delayed"] as const)
  for (const held of faces)
    test(`${mode} load of ${held.family} is detected and layout stays usable`, async ({
      page,
    }, info) => {
      test.skip(
        shippedEnv === undefined,
        "no environment on this platform renders every shipped face",
      );
      if (shippedEnv === undefined) return;
      let release: () => void = () => undefined;
      const released = new Promise<void>((done) => {
        release = done;
      });
      let hit = false;
      await page.route(`${distUrl}${held.distPath}`, async (route) => {
        hit = true;
        if (mode === "failed") await route.abort();
        else {
          await released;
          await route.continue();
        }
      });
      // Firefox and WebKit hold the load event for a pending font, so only the document is awaited.
      await page.goto(distUrl, { waitUntil: "domcontentloaded" });
      await applyEnvironment(page, shippedEnv);
      const targets = roleNames.map((role) => ({
        id: `${role}-target`,
        role,
        family: null,
        text: witness[role],
      }));
      // The delayed load is still pending here, so the readiness wait cannot be used for this render.
      await page.evaluate(
        ({ targets, roles }) => {
          const box = document.createElement("div");
          box.dataset["fontProbes"] = "";
          for (const target of targets) {
            const element = document.createElement(roles[target.role]);
            element.textContent = target.text;
            box.append(element);
          }
          document.body.append(box);
        },
        { targets, roles },
      );
      await expect.poll(() => hit, `${held.family} is requested`).toBe(true);
      const status = async () =>
        page.evaluate(() =>
          Array.from(
            document.fonts,
            (face) => `${face.family.replace(/^"|"$/g, "")}:${face.status}`,
          ).sort(),
        );
      const want = loading[engineOf(info)]?.[mode] ?? "unrecorded engine";
      let before: string[] = [];
      if (mode === "failed") {
        await settle(page);
        before = await status();
      } else {
        // The held face's status can lag its request, so it is sampled until it shows the held state.
        await expect
          .poll(async () => {
            before = await status();
            return before;
          }, `${held.family} while held`)
          .toContain(`${held.family}:${want}`);
      }
      const pending =
        mode === "failed"
          ? await measure(page, targets)
          : await measureNow(page, targets);
      release();
      await page.unrouteAll({ behavior: "wait" });
      await settle(page);
      await register(page, await references(page));
      const stacks = Object.fromEntries(
        roleNames.map((role) => [
          role,
          pending[`${role}-target`]?.family ?? "",
        ]),
      );
      const compare = roleNames.flatMap((role): Probe[] => [
        { id: `${role}-target`, role, family: null, text: witness[role] },
        {
          id: `${role}-ref`,
          role,
          family: `"${alias(faceOf(shippedEnv.expect[role].family))}"`,
          text: witness[role],
        },
        {
          id: `${role}-rest`,
          role,
          family: remainder(stacks[role] ?? "", shippedEnv.expect[role].family),
          text: witness[role],
        },
      ]);
      const after = await measure(page, compare);
      const record = {
        project: info.project.name,
        engine: engineOf(info),
        engineVersion: versionOf(info),
        host: host(),
        environment: shippedEnv.name,
        mode,
        held: held.family,
        statusBefore: before,
        roles: roleNames.map((role) => ({
          role,
          held: shippedEnv.expect[role].family === held.family,
          pending: pending[`${role}-target`]?.widths ?? [],
          after: after[`${role}-target`]?.widths ?? [],
          reference: after[`${role}-ref`]?.widths ?? [],
          rest: after[`${role}-rest`]?.widths ?? [],
        })),
      };
      const name = `font-${mode}-${held.distPath.replace(/\W/g, "-")}.json`;
      await info.attach(name, {
        body: writeEvidence(info.outputPath(name), record),
        contentType: "application/json",
      });

      expect(before, held.family).toContain(`${held.family}:${want}`);
      if (mode === "failed")
        for (const face of faces.filter((face) => face !== held))
          expect(before, face.family).toContain(`${face.family}:loaded`);
      expect(
        record.roles.filter((row) => row.held),
        `${held.family} is some role's expected face`,
      ).not.toHaveLength(0);
      for (const row of record.roles) {
        const where = `${mode} ${held.family} ${row.role}`;
        expect(
          row.pending.length > 0 && row.pending.every((width) => width > 0),
          `${where}: laid out before the face`,
        ).toBe(true);
        if (!row.held) {
          expect(row.after, `${where}: the other faces are unaffected`).toEqual(
            row.reference,
          );
          if (mode === "failed")
            expect(row.pending, `${where}: rendered in its own face`).toEqual(
              row.reference,
            );
          continue;
        }
        // Without the face the role renders its fallback, which the evidence must call substitution.
        expect(
          same(row.pending, row.reference),
          `${where}: substitution detected`,
        ).toBe(false);
        expect(
          row.pending,
          `${where}: the fallback is the rest of the stack`,
        ).toEqual(row.rest);
        if (mode === "delayed")
          expect(row.after, `${where}: the face swaps in`).toEqual(
            row.reference,
          );
        else
          expect(row.after, `${where}: a failed face stays failed`).toEqual(
            row.rest,
          );
      }
    });

test("code: ligatures stay off and synthetic styles are recorded", async ({
  page,
}, info) => {
  await page.goto(distUrl);
  const code = faceOf("SL Code");
  const refs = await references(page);
  await register(
    page,
    refs.filter((ref) => ref.face === code),
  );
  const text = "!= -> => <= === www";
  const rows = [
    { name: "role", style: "" },
    {
      name: "ref-off",
      style: `font-family:"${alias(code)}";font-variant-ligatures:none;`,
    },
    {
      name: "ref-on",
      style: `font-family:"${alias(code)}";font-variant-ligatures:normal;`,
    },
    { name: "bold", style: "font-weight:700;" },
    { name: "italic", style: "font-style:italic;" },
  ];
  await page.evaluate(
    ({ rows, text }) => {
      // An opaque layer over the app, so each shot holds only its own specimen line.
      const layer = document.createElement("div");
      layer.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:var(--bg);";
      document.body.append(layer);
      rows.forEach((row, i) => {
        const element = document.createElement("code");
        element.dataset["code"] = row.name;
        element.style.cssText = `position:absolute;left:0;top:${String(i * 50)}px;font-size:20px;line-height:40px;white-space:pre;${row.style}`;
        element.textContent = text;
        layer.append(element);
      });
    },
    { rows, text },
  );
  await settle(page);
  const shots: Record<string, Uint8Array> = {};
  const widths: Record<string, number> = {};
  for (const [i, row] of rows.entries()) {
    const box = await page.locator(`[data-code="${row.name}"]`).boundingBox();
    widths[row.name] = box?.width ?? 0;
    shots[row.name] = await shot(page, {
      x: 0,
      y: i * 50,
      width: 300,
      height: 40,
    });
  }
  const diff = async (a: string, b: string) =>
    differing(page, shots[a] ?? new Uint8Array(), shots[b] ?? new Uint8Array());
  const ligatures = await page
    .locator('[data-code="role"]')
    .evaluate((el) => getComputedStyle(el).fontVariantLigatures);
  const record = {
    project: info.project.name,
    engine: engineOf(info),
    engineVersion: versionOf(info),
    host: host(),
    text,
    ligatures,
    widths,
    roleVsLigaturesOff: await diff("role", "ref-off"),
    roleVsLigaturesOn: await diff("role", "ref-on"),
    syntheticBoldInk: await diff("role", "bold"),
    syntheticItalicInk: await diff("role", "italic"),
  };
  await info.attach("font-code.json", {
    body: writeEvidence(info.outputPath("font-code.json"), record),
    contentType: "application/json",
  });
  expect(ligatures).toBe("none");
  expect(
    record.roleVsLigaturesOff,
    "the role renders the shipped face with ligatures off",
  ).toBe(0);
  expect(
    record.roleVsLigaturesOn,
    "the shipped face has ligatures the role keeps off",
  ).toBeGreaterThan(0);
  expect(widths["role"]).toBe(widths["ref-on"]);
});

test("control: unauthenticated, broken, circular and absent references are refused", async ({
  page,
}) => {
  await page.goto(distUrl);
  const [first] = faces;
  if (first === undefined) throw new Error("no shipped face");
  const response = await page.request.get(`${distUrl}${first.distPath}`);
  const bytes = Uint8Array.from(await response.body());
  const tampered = Uint8Array.from(bytes);
  tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
  expect(() => authenticate(first, tampered)).toThrow(/font bytes/);
  await expect(
    register(page, [
      {
        alias: "sl-ref-broken",
        face: first,
        data: base64(bytes.subarray(0, 1024)),
      },
    ]),
  ).rejects.toThrow(/not loaded/);
  await expect(
    register(page, [{ alias: first.family, face: first, data: base64(bytes) }]),
  ).rejects.toThrow(/independent alias/);
  await register(page, [
    { alias: "sl-ref-once", face: first, data: base64(bytes) },
  ]);
  await expect(
    register(page, [
      { alias: "sl-ref-once", face: first, data: base64(bytes) },
    ]),
  ).rejects.toThrow(/independent alias/);
  expect(() => systemFace("absent-face.ttf")).toThrow(/absent/);
  expect(() => environments("darwin")).toThrow(/no environment/);
});
