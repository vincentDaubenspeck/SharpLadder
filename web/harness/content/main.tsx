import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ContentView } from "../../src/content/ContentView.tsx";
import { buildSlugMap } from "../../src/content/href.ts";
import { BuildController } from "./BuildController.tsx";
import { HintsController } from "./HintsController.tsx";
import { witness as build } from "../../src/generated/witness/chapters/fixture-basics/build.ts";
import { witness as cards } from "../../src/generated/witness/chapters/fixture-basics/cards.ts";
import { witness as basics } from "../../src/generated/witness/chapters/fixture-basics/chapter.ts";
import { witness as drill } from "../../src/generated/witness/chapters/fixture-basics/drill.ts";
import { witness as gotchas } from "../../src/generated/witness/chapters/fixture-basics/gotchas.ts";
import { witness as hints } from "../../src/generated/witness/chapters/fixture-basics/hints.catalogue.ts";
import { witness as idioms } from "../../src/generated/witness/chapters/fixture-basics/idioms.ts";
import { witness as library } from "../../src/generated/witness/chapters/fixture-basics/library.ts";
import { witness as syntax } from "../../src/generated/witness/chapters/fixture-basics/syntax.ts";
import { witness as second } from "../../src/generated/witness/chapters/fixture-second/chapter.ts";
import { witness as unassigned } from "../../src/generated/witness/errors/err-fixture-cs0165.ts";
import { witness as nullCall } from "../../src/generated/witness/errors/err-fixture-null.ts";
import { witness as offByOne } from "../../src/generated/witness/errors/err-fixture-off-by-one.ts";
import { witness as loopTerm } from "../../src/generated/witness/glossary/term-fixture-loop.ts";
import { witness as setTerm } from "../../src/generated/witness/glossary/term-fixture-set.ts";

// The production output check refuses any dist file holding this string.
const marker = "sharpladder-content-harness";

// The harness build sets this to the digest of the records its preflight accepted.
const certificate: unknown = import.meta.env["SHARPLADDER_HARNESS_PREFLIGHT"];
if (typeof certificate !== "string" || !/^[0-9a-f]{64}$/u.test(certificate))
  throw new Error("content harness: built without the compiler preflight");

const slugs = buildSlugMap([basics, second]);
const parts = [syntax, gotchas, build, idioms, library, cards, drill].sort(
  (a, b) => a.order - b.order,
);
// Entries live on pages of their own; here they follow the chapter so one page shows every view.
const entries = [loopTerm, setTerm, unassigned, nullCall, offByOne];
const host = document.body.appendChild(document.createElement("div"));

// The hosting page owns the single h1 and puts the chapter title there.
createRoot(host).render(
  <StrictMode>
    <main data-harness={marker} data-preflight={certificate}>
      <h1>{basics.title}</h1>
      <ContentView doc={basics} slugs={slugs} />
      {parts.map((part) =>
        part.kind === "build" ? (
          <BuildController key={part.kind} part={part} slugs={slugs} />
        ) : (
          <ContentView key={part.kind} doc={part} slugs={slugs} />
        ),
      )}
      <HintsController
        catalogue={hints}
        references={["ladder-lone-word", "ladder-lone-word-alt"]}
      />
      {entries.map((entry) => (
        <ContentView key={entry.id} doc={entry} slugs={slugs} />
      ))}
    </main>
  </StrictMode>,
);
