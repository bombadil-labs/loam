import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  publishHyperSchemaClaims,
  signClaims,
  type Schema,
} from "@bombadil/rhizomatic";
import { manifestExportClaims } from "../../src/gateway/adopt-vocab.js";
import { containerClaims } from "../../src/gateway/container-law.js";
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
      expect(gw.def("Held").entity).toBe(incumbent);
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
