// SPEC §30 criterion 20(b), on REAL bundler output (T97). The existing rails prove the scan against a
// hand-authored fixture — every pattern its author thought of, written by the scan's author. This file
// closes the provenance gap the artifact-pack rail's header records: the fixtures here are the OUTPUT OF
// A REAL ESBUILD RUN over a REAL REACT (react-dom/server, minified, production define), vendored under
// test/gateway/fixtures/ with the generating command in each file's header.
//
// TWO-SIDED, at both levels, because a rail measuring only one side stays green while the door breaks:
//   - The target shape PACKS. A renderer that bundles its own React and returns renderToString(...)
//     scans clean, packs, round-trips byte-identical through the page, and RENDERS in the worker realm —
//     the last assertion is what keeps "it packs" from being vacuous about a bundle that cannot run.
//   - A genuine reach is REFUSED, by name. The same real-React shape with a real `document` reach is
//     refused naming `document (browser)` — and NOTHING ELSE, which is the sharp half: react-dom's own
//     dialect (`typeof window == "object"` guards, `Function.prototype.bind`) must not be the reason.
//
// What this file deliberately does not claim: population coverage. One artifact from one bundler at one
// version is a member, not the population — the ticket's option (c) (rollup, webpack, more versions)
// stays open, and a React release can change the emitted dialect. The fixture is frozen so that a red
// bar here is always a Loam regression, never an upstream drift.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { bundleFromPage } from "../../src/gateway/artifact-page.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { scanHostReferences } from "../../src/gateway/artifact-scan.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const PEN = authorForSeed("1a".repeat(32));

const FIXTURES = join(process.cwd(), "test", "gateway", "fixtures");
const REACT_BUNDLE = readFileSync(join(FIXTURES, "react-renderer.bundle.mjs"), "utf8");
const REACHING_BUNDLE = readFileSync(join(FIXTURES, "react-reaching.bundle.mjs"), "utf8");

// A store ready to pack the given bundle at route "plant" — the artifact-pack rail's shape.
const ready = async (bundle: string): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
      grants: [grantClaims(STORE_ENTITY, PEN, "write", OP, 9_001)],
    }),
    { renderTimeoutMs: 10_000 },
  );
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  await gw.publishRenderer({ route: "plant", schema: "Plant", consumes: ["height"], bundle });
  await gw.declareArtifact(["plant"]);
  return gw;
};

describe("§30 criterion 20(b) on real esbuild output (T97)", () => {
  it("a real esbuild-bundled React renderer scans clean — react-dom's dialect is not a reach", () => {
    // Byte level, the cheapest assertion first. The bundle carries the patterns the criterion names —
    // guards and idioms REAL react-dom emits, not imitations of them — and the scan must read through
    // every one. If this line fails, the door refuses the target shape §23.2 names.
    expect(scanHostReferences(REACT_BUNDLE)).toEqual([]);
    // The fixture is genuinely the adversarial artifact, not a stand-in: real react-dom carries the
    // guard dialect (`typeof window`) and the cached prototype method the scan must see through.
    expect(REACT_BUNDLE).toContain("typeof window");
    expect(REACT_BUNDLE).toContain("Function.prototype.bind");
    expect(REACT_BUNDLE.length).toBeGreaterThan(100_000); // a real React, not a stub
  });

  it("the real bundle PACKS, round-trips through the page, and RENDERS in the worker realm", async () => {
    const gw = await ready(REACT_BUNDLE);
    // Object level: the door answers. No refusal, and the page carries the bundle byte-identical.
    const { page } = gw.packArtifact("plant", FERN, { server: "My Loam" });
    expect(bundleFromPage(page)).toBe(REACT_BUNDLE);
    // And the bundle is not merely tolerated but ALIVE: the worker realm runs real renderToString
    // over the resolved view. Without this, "it packs" could be true of a bundle that cannot run.
    const served = await gw.serveRoute("plant", FERN, "full");
    expect(served.status).toBe(200);
    expect(served.body).toContain('<p class="plant">h=42 tag=-');
    await gw.close();
  }, 30_000);

  it("a dead arm without braces ends at its own statement — not before it, not after it", () => {
    // The guard dialect real bundlers emit is usually braced; the unbraced arm is a walk the big
    // fixtures never reach, so it is pinned here at the unit level. Three sides: a plain unbraced
    // else-arm is dead, one with nested brackets is dead THROUGH the brackets, and the range stops
    // at the `;` — a reach in the next statement is still seen.
    expect(scanHostReferences('if (typeof window === "undefined") a(); else window.x();')).toEqual(
      [],
    );
    expect(scanHostReferences('if (typeof window === "undefined") a(); else b.c(window);')).toEqual(
      [],
    );
    expect(
      scanHostReferences('if (typeof window === "undefined") a(); else b(); window.x();'),
    ).toEqual([{ name: "window", family: "browser" }]);
  });

  it("the same real shape with a genuine `document` reach is refused naming ONLY document", async () => {
    // The scan, first: exactly the one reach, nothing from react-dom's own dialect.
    expect(scanHostReferences(REACHING_BUNDLE)).toEqual([{ name: "document", family: "browser" }]);
    // Then the door: the refusal fires and names the reach.
    const gw = await ready(REACHING_BUNDLE);
    let refusal = "";
    try {
      gw.packArtifact("plant", FERN, { server: "My Loam" });
    } catch (e) {
      refusal = e instanceof Error ? e.message : String(e);
    }
    expect(refusal).toContain("document (browser)");
    // The sharp half: react's own patterns must not be co-refused, or the message (and the rail)
    // would pass for the wrong reason on any real bundle.
    expect(refusal).not.toContain("window");
    expect(refusal).not.toContain("process");
    expect(refusal).not.toContain("Function");
    await gw.close();
  }, 30_000);
});
