// T150 item 4 — the empty-surface refusal says WHICH emptiness: nothing at all, or law that
// binds nothing. The inert case is the one a pull lands in — a governed store whose only
// registrations are a peer's — and the refusal must name the operator's own register as the cure.
// The cause is named as a pair, never attributed: foreign law is inert, and an own definition
// that does not resolve binds nothing either.

import { describe, expect, it } from "vitest";
import { authorForSeed, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { registrationDeltaClaims } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT_POLICY } from "./fixtures.js";
import { FERN } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const FOREIGN_SEED = "ee".repeat(32);
const FOREIGN = authorForSeed(FOREIGN_SEED);

const governed = async (): Promise<Gateway> =>
  Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }));

describe("the empty-surface refusal names its shape", () => {
  it("a store with no law names the register cure", async () => {
    const gw = await governed();
    await expect(gw.query(`{ plant(entity: "${FERN}") { height } }`)).rejects.toThrow(
      /nothing is registered.*loam register/,
    );
    await gw.close();
  });

  it("a store whose only law is foreign says so, and names the operator's register as the cure", async () => {
    const gw = await governed();
    const { publishHyperSchemaClaims } = await import("@bombadil/rhizomatic");
    const byRole = parseTerm({ op: "group", key: "byRole", in: "input" });
    const intruder = registrationDeltaClaims(
      "hyperschema:Intruder",
      "Intruder",
      PLANT_POLICY,
      [FERN],
      FOREIGN,
      () => 51,
    );
    const report = await gw.federate([
      signClaims(
        publishHyperSchemaClaims(
          { name: "Intruder", alg: 1, body: byRole },
          "hyperschema:Intruder",
          FOREIGN,
          50,
        ),
        FOREIGN_SEED,
      ),
      signClaims(intruder.living, FOREIGN_SEED),
      signClaims(intruder.snapshot, FOREIGN_SEED),
      signClaims(intruder.binding, FOREIGN_SEED),
    ]);
    expect(report.accepted).toBe(4);
    await expect(gw.query(`{ plant(entity: "${FERN}") { height } }`)).rejects.toThrow(
      /nothing is registered.*store holds registrations that do not bind \(foreign law is inert on a governed store; an own definition that does not resolve binds nothing either\).*loam register/,
    );
    await gw.close();
  });
});
