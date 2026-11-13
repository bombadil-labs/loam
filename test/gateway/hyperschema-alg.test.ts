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
import { manifestExportClaims } from "../../src/gateway/adopt-vocab.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { readRegistrations, registrationDeltaClaims } from "../../src/gateway/registration.js";
import { lawfulSnapshot } from "../../src/gateway/lawful.js";
import { MemoryBackend } from "../../src/store/memory.js";

const ROLE_DEFINES = `${VOCAB_PREFIX}.hyperschema.defines`;
const ROLE_ALG = `${VOCAB_PREFIX}.hyperschema.alg`;
const TENANT_ENTITY = "hyperschema:Tenant";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const STRANGER_SEED = "5d".repeat(32);
const STRANGER = authorForSeed(STRANGER_SEED);

const SHIPPED_ALG = 1;

const boot = (hyperschema: HyperSchema): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema, schema: TENANT_POLICY, roots: [STORE_ENTITY] }],
    }),
  );

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

  it("mints a different definition delta when only alg changes", () => {
    const at = (alg: number): Delta =>
      signClaims(publishHyperSchemaClaims({ ...TENANT, alg }, TENANT_ENTITY, OP, 7_000), OP_SEED);
    expect(at(SHIPPED_ALG).id).not.toBe(at(SHIPPED_ALG + 1).id);
  });
});

describe("a reader resolves the algebra version back", () => {
  it("hands TENANT's alg back through loadHyperSchema over the lawful slice", async () => {
    const gw = await boot(TENANT);
    const held = loadHyperSchema(
      lawfulSnapshot(gw.reactor, gw.validityNow(), gw.operator),
      TENANT_ENTITY,
      Date.now(),
    );
    expect(held.alg).toBe(SHIPPED_ALG);
  });

  it("hands it back through Loam's own registration reader", async () => {
    const gw = await boot(TENANT);
    const reg = readRegistrations(gw.reactor, gw.validityNow(), gw.operator).find(
      (r) => r.hyperschema.name === "Tenant",
    );
    expect(reg?.hyperschema.alg).toBe(SHIPPED_ALG);
  });

  it("hands tenantSchemaFor's alg back the same way", async () => {
    const gw = await boot(tenantSchemaFor(OP));
    const held = loadHyperSchema(
      lawfulSnapshot(gw.reactor, gw.validityNow(), gw.operator),
      TENANT_ENTITY,
      Date.now(),
    );
    expect(held.alg).toBe(SHIPPED_ALG);
  });
});

async function moduleShipping(
  gw: Gateway,
  alg: number,
  at: { entity: string; lens: string } = { entity: TENANT_ENTITY, lens: "Tenant" },
): Promise<ReturnType<Gateway["freeze"]>> {
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
    publishHyperSchemaClaims({ ...TENANT, alg }, at.entity, STRANGER, 41_000),
    STRANGER_SEED,
  );
  let t = 41_001;
  const reg = registrationDeltaClaims(
    at.entity,
    at.lens,
    TENANT_POLICY,
    [STORE_ENTITY],
    STRANGER,
    () => t++,
  );
  const manifest = signClaims(
    manifestExportClaims(
      { alias: "Tenant", targetEntity: at.entity, kind: "schema" },
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

  it("passes the same module at the shipped alg", async () => {
    const gw = await boot(TENANT);
    const version = await moduleShipping(gw, SHIPPED_ALG);
    const outcome = await gw.adoptLaw(version, "Tenant");
    expect(outcome.kind).toBe("witnessed");
  });
});

const ELSEWHERE = { entity: "hyperschema:TenantMirror", lens: "TenantMirror" };

describe("the already-bound address carries the algebra version too", () => {
  it("witnesses a module whose law matches the operator's, at the shipped alg", async () => {
    const gw = await boot(TENANT);
    const version = await moduleShipping(gw, SHIPPED_ALG, ELSEWHERE);
    const outcome = await gw.adoptLaw(version, "Tenant");
    expect(outcome.kind).toBe("witnessed");
  });

  it("publishes the same law at another alg — a different address, so nothing is bound", async () => {
    const gw = await boot(TENANT);
    const version = await moduleShipping(gw, SHIPPED_ALG + 1, ELSEWHERE);
    const outcome = await gw.adoptLaw(version, "Tenant");
    expect(outcome.kind).toBe("adopted-from");
  });
});
