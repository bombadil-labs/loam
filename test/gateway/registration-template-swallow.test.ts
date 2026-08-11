// T96: a malformed claim template must never take `writable` down with it. Under
// immutable-by-default (SPEC §14) an absent writable list and a deliberately locked store are the
// same bytes to every reader, so the swallow booted stores read-only against the operator's own
// declaration — silently. The rail is two-sided at both levels:
//   - LOUD MINT: a genesis mutations payload that cannot be read faithfully refuses at
//     assembleGenesis with the defect named (delta never minted), exactly as publish refuses.
//   - BYSTANDER SURVIVES: a minted template that cannot bind costs the TEMPLATES and nothing
//     else — the binding delta still carries both payloads (delta level), and the booted
//     gateway's surface still names the declared writable set and accepts a write on a declared
//     field (object level). The well-formed control pins that a good template still binds whole.
// Deliberately not asserted here: publish-time refusals (claims.test.ts owns those) and the
// bind-failure record's wording (an internal breadcrumb, not a served surface).

import { describe, expect, it } from "vitest";
import { STORE_ENTITY, assembleGenesis } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { lensOf, type ClaimTemplates } from "../../src/gateway/registration.js";
import { authorForSeed } from "@bombadil/rhizomatic";
import { FERN, GARDENER, GARDENER_SEED } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);

// T96's exact measured payload: a half-converted at-pointer — `context` beside a literal value.
const HALF_CONVERTED = {
  water: { pointers: [{ role: "value", context: "watered", value: true }] },
} as unknown as ClaimTemplates;

// Parses cleanly, but names no entity its own schema could ever see the write through — so it
// reaches the replay and fails there, which is the path that used to swallow `writable`.
const INVISIBLE: ClaimTemplates = {
  orphanNote: { pointers: [{ role: "note", value: { arg: "note" } }] },
};

// The control: an ordinary visible template over the Plant gather.
const WELL_FORMED: ClaimTemplates = {
  water: {
    pointers: [
      { role: "subject", at: { arg: "plant" }, context: "watered" },
      { role: "value", value: true },
    ],
  },
};

const genesisWith = (mutations: ClaimTemplates) =>
  assembleGenesis({
    operatorSeed: OPERATOR_SEED,
    registrations: [
      {
        hyperschema: PLANT,
        schema: PLANT_POLICY,
        roots: [FERN],
        writable: ["height", "tag"],
        mutations,
      },
    ],
    grants: [grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 2)],
  });

describe("T96: a template fault never narrows the write surface", () => {
  it("a mutations payload that cannot be read faithfully refuses at the mint, defect named", () => {
    expect(() => genesisWith(HALF_CONVERTED)).toThrow(
      /genesis: lens "Plant" carries a mutations payload that cannot be read faithfully/,
    );
    expect(() => genesisWith(HALF_CONVERTED)).toThrow(/context belongs to an at pointer/);
  });

  it("a minted template that cannot bind costs the templates; writable survives, at both levels", async () => {
    const genesis = genesisWith(INVISIBLE);

    // DELTA level: the binding carries BOTH payloads — the bytes were never the bug.
    const binding = genesis.deltas.find((d) =>
      d.claims.pointers.some((p) => p.role === "writable"),
    );
    expect(binding).toBeDefined();
    const payload = (role: string): unknown => {
      const p = binding!.claims.pointers.find((x) => x.role === role);
      return p?.target.kind === "primitive" ? JSON.parse(String(p.target.value)) : undefined;
    };
    expect(payload("writable")).toEqual(["height", "tag"]);
    expect(payload("mutations")).toHaveProperty("orphanNote");

    // OBJECT level: the booted surface sheds the template and NOTHING else.
    const gw = await Gateway.boot(new MemoryBackend(), genesis);
    const reg = gw.registered.find((r) => lensOf(r) === "Plant");
    expect(reg).toBeDefined();
    expect(reg!.writable).toEqual(["height", "tag"]); // the bystander, alive
    expect(reg!.mutations).toBeUndefined(); // the cost, exactly one field wide

    // The template's mutation is honestly absent from the door…
    const shed = await gw.query(`mutation { orphanNote(note: "n") { delta } }`, undefined, {
      actor: GARDENER_SEED,
    });
    expect(shed.errors?.join(" ")).toMatch(/orphanNote/);

    // …and a write on a DECLARED writable field still lands: the operator's surface holds.
    const write = await gw.query(
      `mutation { plant(entity: "${FERN}", height: 40) { height } }`,
      undefined,
      { actor: GARDENER_SEED },
    );
    expect(write.errors).toBeUndefined();
    expect((write.data as { plant: { height: number } }).plant.height).toBe(40);
    await gw.close();
  });

  it("a well-formed template still binds whole: templates AND writable, exactly as declared", async () => {
    const gw = await Gateway.boot(new MemoryBackend(), genesisWith(WELL_FORMED));
    const reg = gw.registered.find((r) => lensOf(r) === "Plant");
    expect(reg).toBeDefined();
    expect(reg!.writable).toEqual(["height", "tag"]);
    expect(Object.keys(reg!.mutations ?? {})).toEqual(["water"]);

    // The template serves as a door, not just a field on the Bound.
    const watered = await gw.query(`mutation { water(plant: "${FERN}") { delta } }`, undefined, {
      actor: GARDENER_SEED,
    });
    expect(watered.errors).toBeUndefined();
    await gw.close();
  });
});
