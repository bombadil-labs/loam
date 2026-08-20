// §47 — `as` NAMES, and never TAKES. The door's own refusal presents the choices as a pair:
// `{ supersede: true }` to take the name, `{ as }` to serve side by side. `mayTake` nonetheless
// included `opts.as !== undefined`, so an operator following the door's OWN guidance onto an
// OCCUPIED name performed the supersede: the incumbent's binding was negated, silently, with the
// outcome reading "adopted-from" and no note that a naming request had become a retirement (the
// suppression lens's finding on T200's review). §47's witness change made the state newly
// reachable, because the same law bound under another name no longer witnesses before the name
// guard runs.
//
// Its own file rather than adopt-law.test.ts, which is T87's frozen rail — appending is an edit.
// The staging mirrors hyperschema-alg.test.ts's compact module fixture; the shipped entity is the
// STRANGER's own, so the capture guard has nothing to say and the name guard alone decides.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  publishHyperSchemaClaims,
  signClaims,
  type Schema,
} from "@bombadil/rhizomatic";
import { manifestExportClaims } from "../../src/gateway/adopt-law.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { registrationDeltaClaims } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, pickLatest } from "./fixtures.js";

const OP_SEED = "cc".repeat(32);
const STRANGER_SEED = "d4".repeat(32);
const STRANGER = authorForSeed(STRANGER_SEED);
const named = (name: string): Schema => ({ ...PLANT_POLICY, name });

/** A stranger's module shipping DIFFERENT-content law at the stranger's own entity. */
async function strangerModule(gw: Gateway): Promise<ReturnType<Gateway["freeze"]>> {
  await gw.append([
    signClaims(
      containerClaims(
        { container: "container:mirror", trust: "untrusted", posture: "separate" },
        gw.operatorAuthor!,
        40_000,
      ),
      OP_SEED,
    ),
  ]);
  const wall = await gw.openContainer({ name: "container:mirror", backend: new MemoryBackend() });
  const definition = signClaims(
    publishHyperSchemaClaims(
      { name: "Mirror", alg: 1, body: PLANT.body },
      "hyperschema:Mirror",
      STRANGER,
      41_000,
    ),
    STRANGER_SEED,
  );
  let t = 41_001;
  // Different CONTENT from the operator's law: a different default policy changes the schema hash,
  // which changes the law address — the contested-name case, never the idempotent one.
  const reg = registrationDeltaClaims(
    "hyperschema:Mirror",
    "Mirror",
    { ...named("Mirror"), default: { kind: "all", order: { kind: "byTimestamp", dir: "desc" } } },
    [FERN],
    STRANGER,
    () => t++,
  );
  const manifest = signClaims(
    manifestExportClaims(
      { alias: "Mirror", targetEntity: "hyperschema:Mirror", kind: "schema" },
      STRANGER,
      41_020,
    ),
    STRANGER_SEED,
  );
  const registration = [reg.living, reg.snapshot, reg.binding].map((c) =>
    signClaims(c, STRANGER_SEED),
  );
  await wall.gateway!.federate([definition, ...registration, manifest], { admit: () => true });
  return wall.gateway!.freeze({
    op: "select",
    pred: { match: { field: "author", cmp: "eq", const: STRANGER } },
    in: "input",
  });
}

describe("§47 — `as` names, and never takes", () => {
  it("blessing { as } onto an OCCUPIED name refuses rather than striking the incumbent", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
    );
    try {
      await gw.publishRegistration(PLANT, named("Held"), [FERN], undefined, "hyperschema:Plant");
      const incumbent = gw.def("Held").entity;
      const version = await strangerModule(gw);

      await expect(gw.adoptLaw(version, "Mirror", { as: "Held" })).rejects.toThrow(
        /already answered here by DIFFERENT-content law/,
      );
      // Two-sided, at the level that matters: the incumbent still SERVES, from ITS entity — a
      // re-point keeps the name and swaps what it means, so asserting the name alone is not enough.
      expect(gw.def("Held").entity).toBe(incumbent);
      // The sanctioned path — explicit supersede — is proven by T33's frozen rails for the
      // same-program case. Cross-PROGRAM supersede trips the publish trial's survivor filter (it
      // keys on program+lens, so a different-program incumbent is not excluded from the trial
      // build) — a pre-existing wrinkle recorded on T202, not asserted here.
    } finally {
      await gw.close();
    }
  });

  it("{ as } onto an UNOCCUPIED name still serves side by side — the refusal is not a blanket one", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
    );
    try {
      await gw.publishRegistration(PLANT, named("Held"), [FERN], undefined, "hyperschema:Plant");
      const version = await strangerModule(gw);
      const outcome = await gw.adoptLaw(version, "Mirror", { as: "Fresh" });
      expect(outcome.kind).toBe("adopted-from");
      expect(gw.def("Fresh")).toBeDefined();
      expect(gw.def("Held")).toBeDefined();
      void pickLatest;
    } finally {
      await gw.close();
    }
  });
});
