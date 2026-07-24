// T32 — the two trust axes are independent, both ways (criterion 10). The knob's `trust` role is
// the EFFECTIVENESS axis (whose trust domain the content belongs to — posture lawfulness, where
// bytes are paid); the `loam:trust` declaration filed AT the container entity (§28.6, DECIDED) is
// the ADMISSION axis (who may federate INTO it). Admission resolves from the subject declaration
// and NEVER from the knob; posture legality gates on the knob and NEVER on the roster. Each axis
// is driven here with the other held fixed.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { CTX_TRUST, readTrustPolicy } from "../../src/gateway/trust.js";
import { containerAdmission, containerClaims } from "../../src/gateway/container.js";
import { FERN } from "../spike/garden.js";
import { GARDENER } from "../spike/garden.js";
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

// A trust declaration whose SUBJECT is the container entity — the existing loam:trust shape,
// §28.6's mechanism: the root needs no migration, the entity just gains a subject.
const trustAt = (
  subject: string,
  mode: "open" | "roster" | "closed",
  authors: readonly string[],
  ts: number,
): Claims => ({
  timestamp: ts,
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
      declare({ container: "container:w", trust: "curated", posture: "wall" }, 25_000),
    ]);
    await gw.append([signClaims(trustAt("container:w", "roster", [GARDENER], 25_100), OP_SEED)]);

    const atContainer = containerAdmission(gw.reactor, OP, "container:w");
    expect(atContainer.mode).toBe("roster");
    expect(atContainer.roster.has(GARDENER)).toBe(true);
    // The root's policy is untouched: no declaration at loam:trust itself survives, so the store
    // stays open — a container's roster is not the store's.
    expect(readTrustPolicy(gw.reactor, OP).mode).toBe("open");
    await gw.close();
  });

  it("tightening the roster changes ADMISSION only — the knob and the copy rule are unmoved", async () => {
    const gw = await boot();
    await gw.append([
      declare({ container: "container:w", trust: "curated", posture: "wall" }, 26_000),
    ]);
    await gw.append([signClaims(trustAt("container:w", "roster", [GARDENER], 26_100), OP_SEED)]);
    const before = gw.containers().containers.get("container:w");

    await gw.append([signClaims(trustAt("container:w", "closed", [], 26_200), OP_SEED)]);
    expect(containerAdmission(gw.reactor, OP, "container:w").mode).toBe("closed");
    // Effectiveness held fixed: trust and posture exactly as declared, the whole time.
    const after = gw.containers().containers.get("container:w");
    expect(after?.trust).toBe(before?.trust);
    expect(after?.posture).toBe(before?.posture);
    expect(after?.trust).toBe("curated");
    expect(after?.posture).toBe("wall");
    await gw.close();
  });

  it("different knobs, same roster: admission does not read the knob at all", async () => {
    const gw = await boot();
    await gw.append([
      declare({ container: "container:c1", trust: "curated", posture: "wall" }, 27_000),
      declare({ container: "container:c2", trust: "untrusted", posture: "wall" }, 27_001),
    ]);
    await gw.append([
      signClaims(trustAt("container:c1", "roster", [GARDENER], 27_100), OP_SEED),
      signClaims(trustAt("container:c2", "roster", [GARDENER], 27_101), OP_SEED),
    ]);
    const a1 = containerAdmission(gw.reactor, OP, "container:c1");
    const a2 = containerAdmission(gw.reactor, OP, "container:c2");
    expect(a1.mode).toBe(a2.mode);
    expect([...a1.roster].sort()).toEqual([...a2.roster].sort());
    await gw.close();
  });
});
