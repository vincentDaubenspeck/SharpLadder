import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ContentView } from "../../src/content/ContentView.tsx";
import { buildSlugMap } from "../../src/content/href.ts";
import { witness as build } from "../../src/generated/witness/chapters/fixture-basics/build.ts";
import { witness as basics } from "../../src/generated/witness/chapters/fixture-basics/chapter.ts";
import { witness as gotchas } from "../../src/generated/witness/chapters/fixture-basics/gotchas.ts";
import { witness as idioms } from "../../src/generated/witness/chapters/fixture-basics/idioms.ts";
import { witness as library } from "../../src/generated/witness/chapters/fixture-basics/library.ts";
import { witness as syntax } from "../../src/generated/witness/chapters/fixture-basics/syntax.ts";
import { witness as second } from "../../src/generated/witness/chapters/fixture-second/chapter.ts";

// The production output check refuses any dist file holding this string.
const marker = "sharpladder-content-harness";

// The harness build sets this to the digest of the records its preflight accepted.
const certificate: unknown = import.meta.env["SHARPLADDER_HARNESS_PREFLIGHT"];
if (typeof certificate !== "string" || !/^[0-9a-f]{64}$/u.test(certificate))
  throw new Error("content harness: built without the compiler preflight");

const slugs = buildSlugMap([basics, second]);
const parts = [syntax, gotchas, build, idioms, library].sort(
  (a, b) => a.order - b.order,
);
const host = document.body.appendChild(document.createElement("div"));

// The hosting page owns the single h1 and puts the chapter title there.
createRoot(host).render(
  <StrictMode>
    <main data-harness={marker} data-preflight={certificate}>
      <h1>{basics.title}</h1>
      <ContentView doc={basics} slugs={slugs} />
      {parts.map((part) => (
        <ContentView key={part.kind} doc={part} slugs={slugs} />
      ))}
    </main>
  </StrictMode>,
);
