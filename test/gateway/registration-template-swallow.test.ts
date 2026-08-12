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
// Deliberately not asserted here: publish-time refusals (claims.test.ts owns those), and any
// OPERATOR-FACING display of a shed — today a bind-time shed reaches a later publishRegistration
// outcome's reason and a parse-time drop reaches `Registration.mutationsDefect`, but no page or
// `store health` line prints either. That report is T96's open (c).

import { describe, expect, it } from "vitest";
import { STORE_ENTITY, assembleGenesis } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { lensOf, type ClaimTemplates } from "../../src/gateway/registration.js";
import { authorForSeed, publishHyperSchemaClaims, signClaims } from "@bombadil/rhizomatic";
import { registrationDeltaClaims } from "../../src/gateway/registration.js";
import { FERN, GARDENER, GARDENER_SEED } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);

// T96's exact measured payload: a half-converted at-pointer — `context` beside a literal value,
// alongside a real entity pointer. Nothing downstream reads that stray key, so this template has
// always bound and served; the rail below pins that it still does.
const HALF_CONVERTED = {
  water: {
    pointers: [
      { role: "subject", at: { arg: "plant" }, context: "watered" },
      { role: "value", context: "watered", value: true },
    ],
  },
} as unknown as ClaimTemplates;

// Genuinely unreadable: a pointer that is neither an entity reference nor a value. No reading of
// this payload exists, so the mint refuses it rather than minting a binding that can only shed.
const UNREADABLE = {
  water: { pointers: [{ role: "value" }] },
} as unknown as ClaimTemplates;

// Unreadable AT REST, planted as raw JSON: `pointers` is not a list at all.
const UNREADABLE_JSON = '{"water":{"pointers":"watered"}}';

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

// The lens name deliberately DIFFERS from the program name ("Plant"): a name-coincident
// fixture cannot see a fallback that drops `lensName` and lands on the hyperschema's (H6).
const genesisWith = (mutations: ClaimTemplates) =>
  assembleGenesis({
    operatorSeed: OPERATOR_SEED,
    registrations: [
      {
        hyperschema: PLANT,
        schema: { ...PLANT_POLICY, name: "PlantView" },
        roots: [FERN],
        writable: ["height", "tag"],
        mutations,
      },
    ],
    grants: [grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 2)],
  });

describe("T96: a template fault never narrows the write surface", () => {
  it("a mutations payload that cannot be read faithfully refuses at the mint, defect named", () => {
    expect(() => genesisWith(UNREADABLE)).toThrow(
      /genesis: lens "PlantView" carries a mutations payload that cannot be read faithfully/,
    );
    expect(() => genesisWith(UNREADABLE)).toThrow(/exactly one of at\/value/);
  });

  it("a stray context beside a literal value still binds and still serves its door", async () => {
    // The narrow edge of the mint refusal above. `context` is meaningful only on an `at` pointer,
    // so a template carrying one beside a literal is inert, not malformed — and refusing it would
    // delete a working mutation door from every store that already holds one, with no migration.
    const gw = await Gateway.boot(new MemoryBackend(), genesisWith(HALF_CONVERTED));
    const reg = gw.registered.find((r) => lensOf(r) === "PlantView");
    expect(Object.keys(reg?.mutations ?? {})).toEqual(["water"]);
    expect(reg!.mutationsDefect).toBeUndefined();
    const watered = await gw.query(`mutation { water(plant: "${FERN}") { delta } }`, undefined, {
      actor: GARDENER_SEED,
    });
    expect(watered.errors).toBeUndefined();
    await gw.close();
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
    const reg = gw.registered.find((r) => lensOf(r) === "PlantView");
    expect(reg).toBeDefined();
    expect(reg!.writable).toEqual(["height", "tag"]); // the bystander, alive
    expect(reg!.lensName).toBe("PlantView"); // the OTHER bystander the old rebuild dropped (H6)
    expect(reg!.mutations).toBeUndefined(); // the cost, exactly one field wide

    // The template's mutation is honestly absent from the door…
    const shed = await gw.query(`mutation { orphanNote(note: "n") { delta } }`, undefined, {
      actor: GARDENER_SEED,
    });
    expect(shed.errors?.join(" ")).toMatch(/orphanNote/);

    // …and a write on a DECLARED writable field still lands: the operator's surface holds.
    const write = await gw.query(
      `mutation { plantView(entity: "${FERN}", height: 40) { height } }`,
      undefined,
      { actor: GARDENER_SEED },
    );
    expect(write.errors).toBeUndefined();
    expect((write.data as { plantView: { height: number } }).plantView.height).toBe(40);
    await gw.close();
  });

  it("a well-formed template still binds whole: templates AND writable, exactly as declared", async () => {
    const gw = await Gateway.boot(new MemoryBackend(), genesisWith(WELL_FORMED));
    const reg = gw.registered.find((r) => lensOf(r) === "PlantView");
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

  // The mint refusals above cannot reach a binding that predates them, so both at-rest shapes get
  // their own rail: a payload that PARSES and fails at bind, and one that fails at PARSE.
  const plantBinding = async (mutationsJson: string): Promise<Gateway> => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gw.append([
      signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1), OPERATOR_SEED),
    ]);
    const { living, snapshot, binding } = registrationDeltaClaims(
      "hyperschema:Plant",
      "PlantView",
      { ...PLANT_POLICY, name: "PlantView" },
      [FERN],
      OPERATOR,
      () => 3,
      undefined,
      ["height", "tag"],
    );
    await gw.append([
      signClaims(publishHyperSchemaClaims(PLANT, "hyperschema:Plant", OPERATOR, 2), OPERATOR_SEED),
      signClaims(living, OPERATOR_SEED),
      signClaims(snapshot, OPERATOR_SEED),
      signClaims(
        {
          ...binding,
          pointers: [
            ...binding.pointers,
            {
              role: "mutations",
              target: { kind: "primitive", value: mutationsJson },
            },
          ],
        },
        OPERATOR_SEED,
      ),
    ]);
    gw.replayRegistrations();
    return gw;
  };

  it("a stored template that cannot BIND costs the templates: writable alive, at both levels", async () => {
    // INVISIBLE parses cleanly and dies at bind, which is the path the replay fallback owns — the
    // one that used to rebuild the candidate by hand and take `writable` and the lens name with it.
    const gw = await plantBinding(JSON.stringify(INVISIBLE));
    const reg = gw.registered.find((r) => lensOf(r) === "PlantView");
    expect(reg).toBeDefined();
    expect(reg!.writable).toEqual(["height", "tag"]); // the bystander, alive at rest too
    expect(reg!.lensName).toBe("PlantView"); // the other bystander the old rebuild dropped (H6)
    expect(reg!.mutations).toBeUndefined(); // the poison payload fell away, alone
    const write = await gw.query(
      `mutation { plantView(entity: "${FERN}", height: 41) { height } }`,
      undefined,
      { actor: GARDENER_SEED },
    );
    expect(write.errors).toBeUndefined();
    await gw.close();
  });

  it("a stored template that cannot PARSE costs the templates too, and says so", async () => {
    // The other at-rest shape: the drop happens in readRegistrations, before the replay ever sees
    // a candidate. `writable` must survive that road as well, and the loss must leave a record —
    // a surface quietly missing its declared door is the whole of T96.
    const gw = await plantBinding(UNREADABLE_JSON);
    const reg = gw.registered.find((r) => lensOf(r) === "PlantView");
    expect(reg).toBeDefined();
    expect(reg!.writable).toEqual(["height", "tag"]);
    expect(reg!.mutations).toBeUndefined();
    expect(reg!.mutationsDefect).toMatch(/wants \{ pointers: \[\.\.\.\] \}/);
    const write = await gw.query(
      `mutation { plantView(entity: "${FERN}", height: 42) { height } }`,
      undefined,
      { actor: GARDENER_SEED },
    );
    expect(write.errors).toBeUndefined();
    await gw.close();
  });
});
