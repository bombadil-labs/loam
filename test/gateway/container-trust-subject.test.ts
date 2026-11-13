import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { CTX_TRUST, readTrustPolicy } from "../../src/gateway/trust.js";
import { containerAdmission, containerClaims } from "../../src/gateway/container-law.js";
import { FERN, GARDENER, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "3c".repeat(32);
const OP = authorForSeed(OP_SEED);

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

const trustAt = (
  subject: string,
  mode: "open" | "roster" | "closed",
  authors: readonly string[],
  ts: number,
): Claims => ({
  timestamp: ts,
  validFrom: ts,
  author: OP,
  pointers: [
    {
      role: "declares",
      target: { kind: "entity", entity: { id: subject, context: CTX_TRUST } },
    },
    { role: "mode", target: { kind: "primitive", value: mode } },
    ...authors.map((a) => ({
      role: "admit-author",
      target: { kind: "primitive" as const, value: a },
    })),
  ],
});

const declare = (spec: Parameters<typeof containerClaims>[0], ts: number) =>
  signClaims(containerClaims(spec, OP, ts), OP_SEED);

describe("T32 criterion 10 — admission and effectiveness are independent axes", () => {
  it("a subject trust declaration resolves at the container without disturbing the root's", async () => {
    const gw = await boot();
    await gw.append([
      declare({ container: "container:w", trust: "curated", posture: "separate" }, 25_000),
    ]);
    await gw.append([signClaims(trustAt("container:w", "roster", [GARDENER], 25_100), OP_SEED)]);

    const atContainer = containerAdmission(gw.reactor, gw.validityNow(), OP, "container:w");
    expect(atContainer.mode).toBe("roster");
    expect(atContainer.roster.has(GARDENER)).toBe(true);
    expect(readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode).toBe("open");
    await gw.close();
  });

  it("tightening the roster changes ADMISSION only — the knob and the copy rule are unmoved", async () => {
    const gw = await boot();
    await gw.append([
      declare({ container: "container:w", trust: "curated", posture: "separate" }, 26_000),
    ]);
    await gw.append([signClaims(trustAt("container:w", "roster", [GARDENER], 26_100), OP_SEED)]);
    const before = gw.containers().containers.get("container:w");

    await gw.append([signClaims(trustAt("container:w", "closed", [], 26_200), OP_SEED)]);
    expect(containerAdmission(gw.reactor, gw.validityNow(), OP, "container:w").mode).toBe("closed");
    const after = gw.containers().containers.get("container:w");
    expect(after?.trust).toBe(before?.trust);
    expect(after?.posture).toBe(before?.posture);
    expect(after?.trust).toBe("curated");
    expect(after?.posture).toBe("separate");
    await gw.close();
  });

  it("a closed roster does not touch the copy rule: the wall still opens and still pays copies", async () => {
    const gw = await boot();
    const h = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([h]);
    await gw.append([
      declare(
        {
          container: "container:shut",
          trust: "curated",
          posture: "separate",
          membership: {
            op: "select",
            pred: { hasPointer: { context: { exact: "height" } } },
            in: "input",
          },
        },
        28_000,
      ),
    ]);
    await gw.append([signClaims(trustAt("container:shut", "closed", [], 28_100), OP_SEED)]);
    const wallStore = new MemoryBackend();
    const c = await gw.openContainer({ name: "container:shut", backend: wallStore });
    expect(c.posture).toBe("separate");
    expect(await wallStore.holds(h.id)).toBe(true);
    await c.drop();
    await gw.close();
  });

  it("different knobs, same roster: admission does not read the knob at all", async () => {
    const gw = await boot();
    await gw.append([
      declare({ container: "container:c1", trust: "curated", posture: "separate" }, 27_000),
      declare({ container: "container:c2", trust: "untrusted", posture: "separate" }, 27_001),
    ]);
    await gw.append([
      signClaims(trustAt("container:c1", "roster", [GARDENER], 27_100), OP_SEED),
      signClaims(trustAt("container:c2", "roster", [GARDENER], 27_101), OP_SEED),
    ]);
    const a1 = containerAdmission(gw.reactor, gw.validityNow(), OP, "container:c1");
    const a2 = containerAdmission(gw.reactor, gw.validityNow(), OP, "container:c2");
    expect(a1.mode).toBe(a2.mode);
    expect([...a1.roster].sort()).toEqual([...a2.roster].sort());
    await gw.close();
  });
});
