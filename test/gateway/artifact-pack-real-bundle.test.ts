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
    expect(scanHostReferences(REACT_BUNDLE)).toEqual([]);
    expect(REACT_BUNDLE).toContain("typeof window");
    expect(REACT_BUNDLE).toContain("Function.prototype.bind");
    expect(REACT_BUNDLE.length).toBeGreaterThan(100_000);
  });

  it("the real bundle PACKS, round-trips through the page, and RENDERS in the worker realm", async () => {
    const gw = await ready(REACT_BUNDLE);
    const { page } = gw.packArtifact("plant", FERN, { server: "My Loam" });
    expect(bundleFromPage(page)).toBe(REACT_BUNDLE);
    const served = await gw.serveRoute("plant", FERN, "full");
    expect(served.status).toBe(200);
    expect(served.body).toContain('<p class="plant">h=42 tag=-');
    await gw.close();
  }, 30_000);

  it("a dead arm without braces ends at its own statement — not before it, not after it", () => {
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
    expect(scanHostReferences(REACHING_BUNDLE)).toEqual([{ name: "document", family: "browser" }]);
    const gw = await ready(REACHING_BUNDLE);
    let refusal = "";
    try {
      gw.packArtifact("plant", FERN, { server: "My Loam" });
    } catch (e) {
      refusal = e instanceof Error ? e.message : String(e);
    }
    expect(refusal).toContain("document (browser)");
    expect(refusal).not.toContain("window");
    expect(refusal).not.toContain("process");
    expect(refusal).not.toContain("Function");
    await gw.close();
  }, 30_000);
});
