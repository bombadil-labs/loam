// T32 — the containment tree, enforced at BOTH levels (criteria 8, 16, 20, 21). A cycle has two
// arrival paths and only one passes a door: the DOOR refuses a declaration that would close a
// cycle — on the initial build and on the latest-wins re-point alike — while the READER restores
// acyclicity deterministically for what federation or a replayed ground delivers (per remaining
// cycle, the latest edge is not-binding and surfaced as a defect, until the graph is a forest; a
// boot never refuses, a walk never hangs). Immutability rides the same reader guard: a federated
// trust flip is not-binding, and the earliest surviving declaration keeps its word.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { containerClaims } from "../../src/gateway/container.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "3a".repeat(32);
const OP = authorForSeed(OP_SEED);

const boot = (backend?: MemoryBackend): Promise<Gateway> =>
  Gateway.boot(
    backend ?? new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

const declare = (spec: Parameters<typeof containerClaims>[0], ts: number) =>
  signClaims(containerClaims(spec, OP, ts), OP_SEED);

describe("T32 criteria 8 & 20 — the door refuses a closing edge", () => {
  it("an initial build cannot close a cycle, and the tree stays sound after the refusal", async () => {
    const gw = await boot();
    // A's parent names a container that does not exist yet — no cycle, lawfully dangling.
    await gw.append([
      declare(
        { container: "container:a", trust: "curated", posture: "wall", parent: "container:c" },
        16_000,
      ),
    ]);
    await gw.append([
      declare(
        { container: "container:b", trust: "curated", posture: "wall", parent: "container:a" },
        16_001,
      ),
    ]);
    // C under B would close C → B → A → C: refused at declaration time, naming the cycle.
    await expect(
      gw.append([
        declare(
          { container: "container:c", trust: "curated", posture: "wall", parent: "container:b" },
          16_002,
        ),
      ]),
    ).rejects.toThrow(/cycle/);
    // The refusal left the tree sound: the table resolves and a read answers, no hang.
    const table = gw.containers();
    expect(table.containers.has("container:a")).toBe(true);
    expect(table.containers.has("container:c")).toBe(false);
    await gw.close();
  });

  it("a re-declared parent cannot close a cycle — the latest-wins path (criterion 20)", async () => {
    const gw = await boot();
    await gw.append([
      declare({ container: "container:a", trust: "curated", posture: "wall" }, 17_000),
    ]);
    await gw.append([
      declare(
        { container: "container:b", trust: "curated", posture: "wall", parent: "container:a" },
        17_001,
      ),
    ]);
    await gw.append([
      declare(
        { container: "container:c", trust: "curated", posture: "wall", parent: "container:b" },
        17_002,
      ),
    ]);
    // The likely arrival in the wild: not an initial build but a RE-POINT of a standing parent.
    await expect(
      gw.append([
        declare(
          { container: "container:a", trust: "curated", posture: "wall", parent: "container:c" },
          17_003,
        ),
      ]),
    ).rejects.toThrow(/cycle/);
    await gw.close();
  });
});

describe("T32 criterion 16 — federated cycles, PLURAL, cannot hang a read", () => {
  it("two disjoint cycles resolve with each latest edge not-binding, and a reopen agrees", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    // Two devices, each locally acyclic, unioned: X→Y arrives beside Y→X, and U→V beside V→U.
    // No door sees either closing — they land by federation, as data.
    const edges = [
      declare(
        { container: "container:x", trust: "curated", posture: "wall", parent: "container:y" },
        18_000,
      ),
      declare(
        { container: "container:y", trust: "curated", posture: "wall", parent: "container:x" },
        18_001,
      ),
      declare(
        { container: "container:u", trust: "curated", posture: "wall", parent: "container:v" },
        18_002,
      ),
      declare(
        { container: "container:v", trust: "curated", posture: "wall", parent: "container:u" },
        18_003,
      ),
    ];
    await gw.federate(edges, { admit: () => true });

    const table = gw.containers();
    // Acyclicity is RESTORED, not spot-fixed: both cycles broken, both defects named.
    expect(table.defects.filter((d) => /cycle/.test(d)).length).toBe(2);
    // Within each cycle the LATEST edge (by timestamp) is the one not binding: Y keeps no parent,
    // X keeps its Y; V keeps no parent, U keeps its V.
    expect(table.containers.get("container:x")?.parent).toBe("container:y");
    expect(table.containers.get("container:y")?.parent).toBeUndefined();
    expect(table.containers.get("container:u")?.parent).toBe("container:v");
    expect(table.containers.get("container:v")?.parent).toBeUndefined();

    // A reopened store holding the same ground boots, answers, and resolves the same forest.
    const reopened = await Gateway.open(backend, { seed: OP_SEED });
    const again = reopened.containers();
    expect(again.containers.get("container:y")?.parent).toBeUndefined();
    expect(again.containers.get("container:v")?.parent).toBeUndefined();
    expect(again.defects.filter((d) => /cycle/.test(d)).length).toBe(2);
    await gw.close();
  });
});

describe("T32 criterion 21 — a federated trust flip is not-binding", () => {
  it("the reader resolves the ORIGINAL trust, names the flip, and a reopen agrees", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const h = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([h]);
    await gw.append([
      declare({ container: "container:fixed", trust: "curated", posture: "wall" }, 19_000),
    ]);
    // The flip arrives with no door involved — a replayed ground, the operator's own other
    // device — as a LATER declaration differing in the immutable knob.
    const flip = declare(
      { container: "container:fixed", trust: "untrusted", posture: "wall" },
      19_100,
    );
    await gw.federate([flip], { admit: () => true });
    expect(gw.reactor.get(flip.id)).toBeDefined(); // it landed — data, not law

    const table = gw.containers();
    expect(table.containers.get("container:fixed")?.trust).toBe("curated"); // earliest surviving wins
    expect(table.defects.some((d) => /container:fixed/.test(d) && /trust/.test(d))).toBe(true);

    const reopened = await Gateway.open(backend, { seed: OP_SEED });
    expect(reopened.containers().containers.get("container:fixed")?.trust).toBe("curated");
    expect(
      reopened.containers().defects.some((d) => /container:fixed/.test(d) && /trust/.test(d)),
    ).toBe(true);
    await gw.close();
  });
});
