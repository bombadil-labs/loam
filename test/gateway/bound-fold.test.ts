import { describe, expect, it } from "vitest";
import { authorForSeed, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import type { ClaimTemplates } from "../../src/gateway/registration.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  lensOf,
  readRegistrations,
  readRegistrationVersions,
} from "../../src/gateway/registration.js";
import { refusalKey } from "../../src/gateway/lifecycle.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const OWNER_SEED = GARDENER_SEED;
const OWNER = GARDENER;
const HOME = "home:alice";
const LENS = "home:alice:x";

const ALICES_OWN = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: OWNER } },
  in: "input",
};

async function twoPools(): Promise<{ gw: Gateway; first: string; second: string }> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  await gw.append([signClaims(grantClaims(STORE_ENTITY, OWNER, "write", OP, 500), OP_SEED)]);
  await gw.append([
    signClaims(
      containerClaims(
        { container: HOME, trust: "curated", posture: "shared", membership: ALICES_OWN },
        OP,
        600,
      ),
      OP_SEED,
    ),
  ]);
  const one = (
    await gw.bindConnection({
      container: HOME,
      connectionKey: authorForSeed("a1".repeat(32)),
      ownerSeed: OWNER_SEED,
    })
  ).entity!;
  const two = (
    await gw.bindConnection({
      container: HOME,
      connectionKey: authorForSeed("b2".repeat(32)),
      ownerSeed: OWNER_SEED,
    })
  ).entity!;
  const [early, late] = [one, two].sort();
  return { gw, first: late!, second: early! };
}

const pool = (gw: Gateway, inbox: string): Gateway => gw.connectionInboxes.get(inbox)!.gateway!;
const publish = (gw: Gateway, inbox: string, prop = "height"): Promise<unknown> =>
  pool(gw, inbox).publishRegistration(
    { ...PLANT, name: LENS },
    { ...PLANT_POLICY, name: LENS, props: new Map([[prop, PLANT_POLICY.default]]) },
    [FERN],
  );
const expanding = (name: string, into: string): typeof PLANT => ({
  ...PLANT,
  name,
  body: parseTerm({
    op: "expand",
    role: { exact: "grows" },
    schema: into,
    reading: into,
    in: {
      op: "group",
      key: "byTargetContext",
      in: {
        op: "select",
        pred: { hasPointer: { targetEntity: { var: "root" } } },
        in: { op: "mask", policy: "drop", in: "input" },
      },
    },
  }),
});
const strike = (p: Gateway, deltaId: string): Promise<unknown> =>
  p.append([
    p.signer!.sign({
      ...p.stamp(p.operatorAuthor),
      author: p.operatorAuthor!,
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: deltaId } } }],
    }),
  ]);
const servedBy = (gw: Gateway, asker: string, lens: string): string | undefined =>
  gw.boundSurface({ container: HOME, inbox: asker }).registered.find((r) => lensOf(r) === lens)
    ?.channel;
const winner = (gw: Gateway, asker: string): string | undefined => servedBy(gw, asker, LENS);
const OTHER_BODY = parseTerm({
  op: "group",
  key: "byTargetContext",
  in: { op: "mask", policy: "drop", in: "input" },
});
const stake = (
  gw: Gateway,
  inbox: string,
  lens: string,
  program = lens,
  body: typeof PLANT.body = PLANT.body,
): Promise<unknown> =>
  pool(gw, inbox).publishRegistration(
    { ...PLANT, name: program, body },
    { ...PLANT_POLICY, name: lens },
    [FERN],
  );
const templateNamed = (name: string): ClaimTemplates => ({
  [name]: {
    pointers: [
      { role: "subject", at: { arg: "plant" }, context: "watered" },
      { role: "value", value: true },
    ],
  },
});
const stakeWith = (
  gw: Gateway,
  inbox: string,
  lens: string,
  mutations: ClaimTemplates | undefined,
  hyperschema: typeof PLANT = { ...PLANT, name: lens },
): Promise<unknown> =>
  pool(gw, inbox).publishRegistration(
    hyperschema,
    { ...PLANT_POLICY, name: lens },
    [FERN],
    undefined,
    undefined,
    mutations,
  );
const stakeWithRefs = (
  gw: Gateway,
  inbox: string,
  lens: string,
  hyperschema: typeof PLANT = { ...PLANT, name: lens },
): Promise<unknown> =>
  pool(gw, inbox).publishRegistration(
    hyperschema,
    { ...PLANT_POLICY, name: lens },
    [FERN],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { height: { role: "grows" } },
  );
const growInto = async (
  gw: Gateway,
  inbox: string,
  lens: string,
  dep: string,
  program = lens,
): Promise<void> => {
  await stake(gw, inbox, dep);
  await pool(gw, inbox).publishRegistration(
    expanding(program, dep),
    { ...PLANT_POLICY, name: lens },
    [FERN],
  );
};

describe("§58 — two pools in one container contest a name by who staked it first", () => {
  it("the first registrant keeps the name, whichever pool was attached or sorts first", async () => {
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    for (const asker of [first, second]) {
      expect(winner(gw, asker), `asked from ${asker}`).toBe(first);
      expect(
        gw.boundSurface({ container: HOME, inbox: asker }).refused.get(refusalKey(second, LENS)),
      ).toMatch(/collides/);
    }
    expect(gw.registered.map(lensOf)).toEqual(["Plant"]);
  });

  it("answers the same after the pools are re-attached in the other order", async () => {
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    expect(winner(gw, first)).toBe(first);
    const handles = new Map(gw.connectionInboxes);
    gw.connectionInboxes.clear();
    for (const name of [...handles.keys()].reverse())
      gw.connectionInboxes.set(name, handles.get(name)!);
    await publish(gw, first, "watered");
    expect(winner(gw, first)).toBe(first);
    expect(winner(gw, second)).toBe(first);
  });

  it("the holder keeps the name through an identical republish and through an evolution", async () => {
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    await publish(gw, first);
    expect(winner(gw, first)).toBe(first);
    await publish(gw, first, "watered");
    expect(winner(gw, first)).toBe(first);
    expect(
      gw.boundSurface({ container: HOME, inbox: second }).refused.get(refusalKey(second, LENS)),
    ).toMatch(/collides/);
  });

  it("a dependency whose FIRST binding is struck still sorts where its dependent needs it", async () => {
    const { gw, first } = await twoPools();
    const p = pool(gw, first);
    const A = "home:alice:a";
    const B = "home:alice:b";
    const expandsIntoA = expanding(B, A);
    await p.publishRegistration({ ...PLANT, name: A }, { ...PLANT_POLICY, name: A }, [FERN]);
    await p.publishRegistration(expandsIntoA, { ...PLANT_POLICY, name: B }, [FERN]);
    await p.publishRegistration(
      { ...PLANT, name: A },
      { ...PLANT_POLICY, name: A, props: new Map([["watered", PLANT_POLICY.default]]) },
      [FERN],
    );
    const firstA = readRegistrationVersions(p.reactor, p.validityNow(), p.operatorAuthor)
      .filter((v) => v.lensName === A)
      .sort((x, y) => x.timestamp - y.timestamp)[0]!;
    await strike(p, firstA.deltaId);
    const rows = readRegistrations(p.reactor, p.validityNow(), p.operatorAuthor);
    const firstClaim = (name: string): number =>
      rows.find((r) => lensOf(r) === name)!.firstBoundAt!;
    expect(firstClaim(A)).toBeGreaterThan(firstClaim(B));
    const surface = gw.boundSurface({ container: HOME, inbox: first });
    expect(surface.registered.map(lensOf)).toEqual(expect.arrayContaining([A, B]));
    expect(surface.refused.has(refusalKey(first, B))).toBe(false);
  });

  it("the rounds do not reopen the contest: a holder refused for want of a reading keeps its name", async () => {
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    const A = "home:alice:a";
    await pool(gw, first).publishRegistration({ ...PLANT, name: A }, { ...PLANT_POLICY, name: A }, [
      FERN,
    ]);
    await pool(gw, first).publishRegistration(expanding(LENS, A), { ...PLANT_POLICY, name: LENS }, [
      FERN,
    ]);
    for (const asker of [first, second]) {
      expect(winner(gw, asker), `asked from ${asker}`).toBe(first);
      expect(
        gw.boundSurface({ container: HOME, inbox: asker }).refused.get(refusalKey(second, LENS)),
      ).toMatch(/collides|DIFFERENT bodies/);
    }
    expect(gw.boundSurface({ container: HOME, inbox: first }).registered.map(lensOf)).toContain(A);
  });

  it("two pools refused under one name are each told their own fault", async () => {
    const { gw, first, second } = await twoPools();
    const p = pool(gw, first);
    const A = "home:alice:a";
    await p.publishRegistration({ ...PLANT, name: A }, { ...PLANT_POLICY, name: A }, [FERN]);
    await p.publishRegistration(expanding(LENS, A), { ...PLANT_POLICY, name: LENS }, [FERN]);
    await publish(gw, second);
    for (const v of readRegistrationVersions(p.reactor, p.validityNow(), p.operatorAuthor).filter(
      (v) => v.lensName === A,
    ))
      await strike(p, v.deltaId);
    const refused = gw.boundSurface({ container: HOME, inbox: first }).refused;
    expect(refused.get(refusalKey(first, LENS))).toMatch(/home:alice:a/);
    expect(refused.get(refusalKey(first, LENS))).not.toMatch(/earlier claim/);
    expect(refused.get(refusalKey(second, LENS))).toMatch(/^lens home:alice:x: an earlier claim/);
    expect(winner(gw, second)).toBeUndefined();
  });

  it("the hold covers the QUERY FIELD: two spellings that mint one field", async () => {
    const { gw, first, second } = await twoPools();
    const AB = "home:alice:a:b";
    const A_B = "home:alice:a_b";
    await stake(gw, first, AB);
    await stake(gw, second, A_B);
    expect(servedBy(gw, first, AB)).toBe(first);
    await growInto(gw, first, AB, "home:alice:dep");
    for (const asker of [first, second]) {
      expect(servedBy(gw, asker, AB), `asked from ${asker}`).toBe(first);
      expect(servedBy(gw, asker, A_B)).toBeUndefined();
      expect(
        gw.boundSurface({ container: HOME, inbox: asker }).refused.get(refusalKey(second, A_B)),
      ).toMatch(/collides|earlier claim/);
    }
  });

  it("the hold covers the LISTING FIELD: `x`'s listing field is `xs`'s query field", async () => {
    const { gw, first, second } = await twoPools();
    const XS = `${LENS}s`;
    await stake(gw, first, LENS);
    await stake(gw, second, XS);
    expect(winner(gw, first)).toBe(first);
    await growInto(gw, first, LENS, "home:alice:dep");
    expect(winner(gw, second)).toBe(first);
    expect(servedBy(gw, second, XS)).toBeUndefined();
    expect(
      gw.boundSurface({ container: HOME, inbox: second }).refused.get(refusalKey(second, XS)),
    ).toMatch(/collides|earlier claim/);
  });

  it("the hold covers the PROGRAM: a rival body under the holder's program name", async () => {
    const { gw, first, second } = await twoPools();
    const P = "home:alice:p";
    await stake(gw, first, "home:alice:p1", P);
    await stake(gw, second, "home:alice:p2", P, OTHER_BODY);
    expect(servedBy(gw, first, "home:alice:p1")).toBe(first);
    expect(servedBy(gw, first, "home:alice:p2")).toBeUndefined();
    await growInto(gw, first, "home:alice:p1", "home:alice:dep", P);
    for (const asker of [first, second]) {
      expect(servedBy(gw, asker, "home:alice:p1"), `asked from ${asker}`).toBe(first);
      expect(servedBy(gw, asker, "home:alice:p2")).toBeUndefined();
      expect(
        gw
          .boundSurface({ container: HOME, inbox: asker })
          .refused.get(refusalKey(second, "home:alice:p2")),
      ).toMatch(/DIFFERENT bodies|earlier claim/);
    }
  });

  it("a sibling reading of the SAME body is not held behind a claimant the root blocks", async () => {
    const { gw, first, second } = await twoPools();
    const P = "home:alice:p";
    await gw.publishRegistration(
      { ...PLANT, name: "home:alice:q" },
      { ...PLANT_POLICY, name: "home:alice:p1" },
      [FERN],
    );
    await stake(gw, first, "home:alice:p1", P);
    await stake(gw, second, "home:alice:p2", P);
    expect(servedBy(gw, second, "home:alice:p2")).toBe(second);
    expect(servedBy(gw, first, "home:alice:p1")).toBeUndefined();
    expect(
      gw
        .boundSurface({ container: HOME, inbox: first })
        .refused.get(refusalKey(first, "home:alice:p1")),
    ).toMatch(/collides/);
  });

  it("the hold covers the MUTATION namespace: a rival's template named after the holder's field", async () => {
    const { gw, first, second } = await twoPools();
    const Y = "home:alice:y";
    await stake(gw, first, LENS);
    await stakeWith(gw, second, Y, templateNamed("home_alice_x"));
    expect(winner(gw, first)).toBe(first);
    expect(servedBy(gw, first, Y)).toBeUndefined();
    await growInto(gw, first, LENS, "home:alice:dep");
    for (const asker of [first, second]) {
      expect(winner(gw, asker), `asked from ${asker}`).toBe(first);
      expect(servedBy(gw, asker, Y)).toBeUndefined();
      expect(
        gw.boundSurface({ container: HOME, inbox: asker }).refused.get(refusalKey(second, Y)),
      ).toMatch(/collides|contests it/);
    }
  });

  it("the hold covers the MUTATION namespace: the holder's own template named after the rival's field", async () => {
    const { gw, first, second } = await twoPools();
    const Y = "home:alice:y";
    await stakeWith(gw, first, LENS, templateNamed("home_alice_y"));
    await stake(gw, second, Y);
    expect(winner(gw, first)).toBe(first);
    expect(servedBy(gw, first, Y)).toBeUndefined();
    await stake(gw, first, "home:alice:dep");
    await stakeWith(
      gw,
      first,
      LENS,
      templateNamed("home_alice_y"),
      expanding(LENS, "home:alice:dep"),
    );
    for (const asker of [first, second]) {
      expect(winner(gw, asker), `asked from ${asker}`).toBe(first);
      expect(servedBy(gw, asker, Y)).toBeUndefined();
    }
  });

  it("the hold covers lens-DERIVED mutation verbs across distinct query fields", async () => {
    const { gw, first, second } = await twoPools();
    const Y = "home:alice:y";
    const YH = "home:alice:y_height";
    await stakeWithRefs(gw, first, Y);
    await stake(gw, second, "home:alice:rdep");
    await stakeWith(gw, second, YH, undefined, expanding(YH, "home:alice:rdep"));
    expect(servedBy(gw, first, Y)).toBe(first);
    expect(servedBy(gw, first, YH)).toBeUndefined();
    await stake(gw, first, "home:alice:dep");
    await stakeWithRefs(gw, first, Y, expanding(Y, "home:alice:dep"));
    for (const asker of [first, second]) {
      expect(servedBy(gw, asker, Y), `asked from ${asker}`).toBe(first);
      expect(servedBy(gw, asker, YH)).toBeUndefined();
    }
  });

  it("a claimant DEFERRED behind a holder holds what it staked, exactly as a refused one does", async () => {
    const { gw, first, second } = await twoPools();
    const Y = "home:alice:y";
    const Z = "home:alice:z";
    await stake(gw, first, LENS);
    await stakeWith(gw, second, Y, templateNamed("home_alice_x"));
    await stakeWith(gw, first, Z, templateNamed("home_alice_y"));
    const refusedZ = (): string | undefined =>
      gw.boundSurface({ container: HOME, inbox: first }).refused.get(refusalKey(first, Z));
    expect(servedBy(gw, first, Z)).toBeUndefined();
    const plain = refusedZ();
    expect(plain).toMatch(/home:alice:y/);
    await growInto(gw, first, LENS, "home:alice:dep");
    expect(winner(gw, first)).toBe(first);
    expect(servedBy(gw, first, Y)).toBeUndefined();
    expect(servedBy(gw, first, Z), "z bound into y's slot while y waited behind x").toBeUndefined();
    expect(refusedZ()).toBe(plain);
  });

  it("a claimant the ROOT refuses is told so, whatever else it contests", async () => {
    const { gw, first, second } = await twoPools();
    const C = "home:alice:c";
    await gw.publishRegistration({ ...PLANT, name: "home:alice:q" }, { ...PLANT_POLICY, name: C }, [
      FERN,
    ]);
    await stakeWith(gw, first, LENS, templateNamed("home_alice_c"));
    await stakeWith(gw, second, C, templateNamed("home_alice_x"));
    const refused = gw.boundSurface({ container: HOME, inbox: second }).refused;
    expect(winner(gw, first)).toBeUndefined();
    expect(servedBy(gw, second, C)).toBeUndefined();
    expect(refused.get(refusalKey(first, LENS))).toMatch(/home_alice_c.*collides/);
    expect(refused.get(refusalKey(second, C))).toMatch(/home_alice_c.*collides/);
    expect(refused.get(refusalKey(second, C))).not.toMatch(/earlier claim/);
  });

  it("the rival does not take the name by republishing", async () => {
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    await publish(gw, second, "watered");
    await publish(gw, second);
    expect(winner(gw, second)).toBe(first);
  });
});
