// T32 — the curated/property scope is zero-copy and flippably excluded (criteria 4 and 6).
// Property = a query over shared ground: pointer arrangement, zero copies. Exclusion is a CLAIM
// and re-inclusion is its lawful negation — no member delta is ever re-signed by either
// direction, which is why the property model costs nothing (member ids are pinned across the
// round-trip). And a property container never copies: opening and reading one adds ZERO deltas
// to any backend — the dual of container-wall's real-bytes assertion.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { containerClaims, exclusionClaims } from "../../src/gateway/container.js";
import { retraction } from "./narrowing.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "2d".repeat(32);
const OP = authorForSeed(OP_SEED);

const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};
const MESSAGES = {
  op: "select",
  pred: { hasPointer: { context: { exact: "message" } } },
  in: "input",
};

describe("T32 criteria 4 & 6 — property is flippable exclusion at zero churn", () => {
  it("exclude removes, negation returns, and the member ids never move", async () => {
    const backend = new MemoryBackend();
    const gw = await Gateway.boot(
      backend,
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: PLANT_POLICY,
            roots: [FERN],
            writable: [...PLANT_WRITABLE],
          },
        ],
      }),
    );
    const h1 = observed(FERN, "height", 30, 1000, OP_SEED);
    const h2 = observed(FERN, "height", 34, 1100, OP_SEED);
    const m1 = observed(FERN, "message", "hello", 1200, OP_SEED);
    await gw.append([h1, h2, m1]);
    await gw.append([
      signClaims(
        containerClaims(
          { container: "container:h", trust: "curated", posture: "shared", membership: HEIGHTS },
          OP,
          8000,
        ),
        OP_SEED,
      ),
      signClaims(
        containerClaims(
          { container: "container:m", trust: "curated", posture: "shared", membership: MESSAGES },
          OP,
          8001,
        ),
        OP_SEED,
      ),
    ]);

    const before = gw
      .containerScope({ containers: ["container:h", "container:m"] })
      .map((d) => d.id)
      .sort();
    expect(before).toContain(h1.id);
    expect(before).toContain(h2.id);
    expect(before).toContain(m1.id);
    const groundBefore = (await backend.deltasSince(new Set())).length;

    // EXCLUDE: one claim lands; the members leave the scoped read; nothing re-signs.
    const exclusion = signClaims(exclusionClaims("container:m", OP, 8100), OP_SEED);
    await gw.append([exclusion]);
    const excluded = gw
      .containerScope({ containers: ["container:h", "container:m"] })
      .map((d) => d.id)
      .sort();
    expect(excluded).toContain(h1.id);
    expect(excluded).not.toContain(m1.id);

    // RE-INCLUDE: negating the exclusion claim — authorship never changed, so nothing re-signs.
    await gw.append([retraction(exclusion.id, OP, OP_SEED, 8200)]);
    const after = gw
      .containerScope({ containers: ["container:h", "container:m"] })
      .map((d) => d.id)
      .sort();
    expect(after).toEqual(before); // IDENTICAL ids across the round-trip — zero churn

    // The ground never moved beyond the exclusion claims themselves: one exclusion + one negation.
    const groundAfter = (await backend.deltasSince(new Set())).length;
    expect(groundAfter).toBe(groundBefore + 2);
    await gw.close();
  });

  it("a property container never copies: opening and reading adds ZERO deltas anywhere", async () => {
    const backend = new MemoryBackend();
    const gw = await Gateway.boot(
      backend,
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: PLANT_POLICY,
            roots: [FERN],
            writable: [...PLANT_WRITABLE],
          },
        ],
      }),
    );
    const h1 = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([h1]);
    await gw.append([
      signClaims(
        containerClaims(
          { container: "container:h", trust: "curated", posture: "shared", membership: HEIGHTS },
          OP,
          8300,
        ),
        OP_SEED,
      ),
    ]);
    await gw.flush();
    const groundBefore = (await backend.deltasSince(new Set())).map((d) => d.id).sort();

    const c = await gw.openContainer({ name: "container:h" });
    expect(c.posture).toBe("shared");
    expect(c.trust).toBe("curated");
    expect(c.gateway).toBeUndefined(); // no second backend EXISTS for it
    expect(c.members().map((d) => d.id)).toContain(h1.id);
    expect(gw.containerScope({ containers: ["container:h"] }).map((d) => d.id)).toContain(h1.id);

    await gw.flush();
    const groundAfter = (await backend.deltasSince(new Set())).map((d) => d.id).sort();
    expect(groundAfter).toEqual(groundBefore); // pointer arrangement, zero copies
    await gw.close();
  });
});
