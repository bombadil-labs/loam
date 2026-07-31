// T140 — a hyperschema's `alg` is its ALGEBRA VERSION, and it is load-bearing at rest.
//
// WHAT `alg` IS (rhizomatic, frozen): `HyperSchema.alg` is the L2 algebra version the gather body
// is written against (`schema.ts`, "L2 algebra version"). It is NOT an input to resolution — no
// View ever changes because of it — and it is NOT in rhizomatic's registry index, which keys on
// `termHash(s.body)` alone. It is IDENTITY METADATA, and it becomes load-bearing in exactly two
// places, which are the two levels this file asserts:
//
//   DELTA LEVEL — `publishHyperSchemaClaims` emits it as a `rhizomatic.hyperschema.alg` pointer, so
//   it is in the definition delta's bytes and therefore in that delta's content address.
//   `loadHyperSchema` reads it back out.
//
//   OBJECT LEVEL — Loam folds it into the law addresses adopt-law does arithmetic on
//   (`loam.law.hyperschema|name|alg|body` and `loam.law.schema|…`). The entity-capture guard
//   compares those addresses, so `alg` decides whether a door ACCEPTS or REFUSES a stranger's
//   blessing at one of the operator's own definition entities.
//
// WHY THIS FILE EXISTS: the mutation gate flipped `TENANT.alg` 1 → 2 (accounts.ts:91) and the whole
// suite stayed green — `alg` was round-tripped everywhere and compared nowhere. `gather.test.ts`
// named that gap and correctly declined to close it with `expect(TENANT.alg).toBe(1)`, which
// asserts a constant against itself. The rails below go the other way: they publish the shipped
// constants into a real store and read the algebra version back out of the DELTAS, then make a door
// decide on it. `tenantSchemaFor`'s `alg` (accounts.ts:183) is pinned the same way.
//
// NAMED GAP — no door SERVES `alg` to a client. `POST /schemas` accepts it (http.ts) and nothing
// reads it back out over the wire, so "what a reader resolves through a Schema" is genuinely
// out of scope here: `alg` never reaches a View by construction. The object level is therefore the
// LAW door (adoptLaw), which is the surface that does read it. The rail that would close the
// remaining gap is a schema-describe endpoint that reports a lens's algebra version; nothing needs
// one yet.
//
// NAMED GAP — the entity-capture refusal says "with a DIFFERENT gather body" while the bodies here
// are byte-identical and only `alg` differs. The guard is right to refuse; its sentence is narrower
// than its rule. Asserted below on the parts of the message that are true in both cases.

import { describe, expect, it } from "vitest";
import {
  VOCAB_PREFIX,
  authorForSeed,
  loadHyperSchema,
  publishHyperSchemaClaims,
  signClaims,
  type Delta,
  type HyperSchema,
} from "@bombadil/rhizomatic";
import { TENANT, TENANT_POLICY, tenantSchemaFor } from "../../src/gateway/accounts.js";
import { manifestExportClaims } from "../../src/gateway/adopt-law.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  lawfulSnapshot,
  readRegistrations,
  registrationDeltaClaims,
} from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";

const ROLE_DEFINES = `${VOCAB_PREFIX}.hyperschema.defines`;
const ROLE_ALG = `${VOCAB_PREFIX}.hyperschema.alg`;
const TENANT_ENTITY = "hyperschema:Tenant";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const STRANGER_SEED = "5d".repeat(32);
const STRANGER = authorForSeed(STRANGER_SEED);

// The algebra version this store ships, written out as its own literal. Every observation below is
// read from DELTAS; this is the only place the expected number appears, so changing `accounts.ts`
// moves the observation and leaves the expectation where it is.
const SHIPPED_ALG = 1;

const boot = (hyperschema: HyperSchema): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema, schema: TENANT_POLICY, roots: [STORE_ENTITY] }],
    }),
  );

// The definition delta the store actually holds at an entity — the bytes, not the constant.
const definitionAt = (gw: Gateway, entity: string): Delta => {
  const hit = [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) => p.role === ROLE_DEFINES && p.target.kind === "entity" && p.target.entity.id === entity,
    ),
  );
  if (hit.length !== 1) throw new Error(`expected one definition at ${entity}, saw ${hit.length}`);
  return hit[0]!;
};

const algPointerOf = (d: Delta): unknown => {
  const p = d.claims.pointers.find((x) => x.role === ROLE_ALG);
  if (p === undefined || p.target.kind !== "primitive") {
    throw new Error(`definition delta ${d.id} carries no ${ROLE_ALG} pointer`);
  }
  return p.target.value;
};

describe("the algebra version reaches the bytes", () => {
  it("puts TENANT's alg in the definition delta as a primitive pointer", async () => {
    const gw = await boot(TENANT);
    expect(algPointerOf(definitionAt(gw, TENANT_ENTITY))).toBe(SHIPPED_ALG);
  });

  it("puts tenantSchemaFor's alg in the definition delta too", async () => {
    const gw = await boot(tenantSchemaFor(OP));
    expect(algPointerOf(definitionAt(gw, TENANT_ENTITY))).toBe(SHIPPED_ALG);
  });

  // The half that is NOT a restatement of the constant: `alg` is inside the content address, so a
  // definition published at a different algebra version is a different delta — same author, same
  // timestamp, same entity, same body. This is the claim that makes the pins above meaningful.
  it("mints a different definition delta when only alg changes", () => {
    const at = (alg: number): Delta =>
      signClaims(publishHyperSchemaClaims({ ...TENANT, alg }, TENANT_ENTITY, OP, 7_000), OP_SEED);
    expect(at(SHIPPED_ALG).id).not.toBe(at(SHIPPED_ALG + 1).id);
  });
});

describe("a reader resolves the algebra version back", () => {
  it("hands TENANT's alg back through loadHyperSchema over the lawful slice", async () => {
    const gw = await boot(TENANT);
    const held = loadHyperSchema(lawfulSnapshot(gw.reactor, gw.operator), TENANT_ENTITY);
    expect(held.alg).toBe(SHIPPED_ALG);
  });

  it("hands it back through Loam's own registration reader", async () => {
    const gw = await boot(TENANT);
    const reg = readRegistrations(gw.reactor, gw.operator).find(
      (r) => r.hyperschema.name === "Tenant",
    );
    expect(reg?.hyperschema.alg).toBe(SHIPPED_ALG);
  });

  it("hands tenantSchemaFor's alg back the same way", async () => {
    const gw = await boot(tenantSchemaFor(OP));
    const held = loadHyperSchema(lawfulSnapshot(gw.reactor, gw.operator), TENANT_ENTITY);
    expect(held.alg).toBe(SHIPPED_ALG);
  });
});

// --- the object level: a door decides on the algebra version --------------------------------------
//
// A stranger ships a module whose manifest exports a hyperschema at the OPERATOR's own
// `hyperschema:Tenant` entity, with the operator's own gather body. The only thing that can differ
// is `alg`. adopt-law's entity-capture guard compares `loam.law.hyperschema` addresses, and `alg`
// is one of that address's four fields — so the SAME bytes at a DIFFERENT algebra version is a
// capture, and the door must refuse it.

async function moduleShipping(gw: Gateway, alg: number): Promise<ReturnType<Gateway["freeze"]>> {
  await gw.append([
    signClaims(
      containerClaims(
        { container: "container:tenancy", trust: "untrusted", posture: "separate" },
        OP,
        40_000,
      ),
      OP_SEED,
    ),
  ]);
  const wall = await gw.openContainer({ name: "container:tenancy", backend: new MemoryBackend() });
  const definition = signClaims(
    publishHyperSchemaClaims({ ...TENANT, alg }, TENANT_ENTITY, STRANGER, 41_000),
    STRANGER_SEED,
  );
  let t = 41_001;
  const reg = registrationDeltaClaims(
    TENANT_ENTITY,
    "Tenant",
    TENANT_POLICY,
    [STORE_ENTITY],
    STRANGER,
    () => t++,
  );
  const manifest = signClaims(
    manifestExportClaims(
      { alias: "Tenant", targetEntity: TENANT_ENTITY, kind: "schema" },
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

describe("the law door refuses a capture that differs only in algebra version", () => {
  it("refuses a module shipping the operator's Tenant body at another alg", async () => {
    const gw = await boot(TENANT);
    const version = await moduleShipping(gw, SHIPPED_ALG + 1);
    await expect(gw.adoptLaw(version, "Tenant")).rejects.toThrow(
      /may not name one of your entities/,
    );
  });

  // The control that makes the refusal above attributable to `alg` and nothing else: the identical
  // module at the SHIPPED algebra version is the idempotent case and passes the guard untouched.
  it("passes the same module at the shipped alg", async () => {
    const gw = await boot(TENANT);
    const version = await moduleShipping(gw, SHIPPED_ALG);
    const outcome = await gw.adoptLaw(version, "Tenant");
    expect(outcome.kind).toBe("witnessed");
  });
});
