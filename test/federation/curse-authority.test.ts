import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Claims } from "@bombadil/rhizomatic";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { cursesOf, type Channel } from "../../src/federation/channel.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { withStamp } from "../../src/gateway/stamp.js";

const OPERATOR_SEED = "17".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const STRANGER_SEED = "b0".repeat(32);
const STRANGER = authorForSeed(STRANGER_SEED);
const SPROUT = { name: "Sprout", alg: 1, body: PLANT.body } as typeof PLANT;

const grounds: Gateway[] = [];
afterEach(async () => {
  while (grounds.length > 0) await grounds.pop()!.close();
});

async function store(seed: string): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
  grounds.push(gw);
  return gw;
}

async function peerWithTwoLenses(): Promise<Gateway> {
  const alice = await store("a1".repeat(32));
  await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, "hyperschema:Plant");
  await alice.publishRegistration(SPROUT, PLANT_POLICY, [FERN], undefined, "hyperschema:Sprout");
  return alice;
}

async function meAndAlice(): Promise<{ me: Gateway; alice: Gateway; ch: Channel }> {
  const alice = await peerWithTwoLenses();
  const me = await store(OPERATOR_SEED);
  await me.append([
    signClaims(
      withStamp(me.stamp(OPERATOR), (t) =>
        grantClaims(STORE_ENTITY, STRANGER, "write", OPERATOR, t),
      ),
      OPERATOR_SEED,
    ),
  ]);
  const ch = await me.openChannel({
    into: "friends",
    prefix: "alice",
    source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
  });
  const first = await ch.sync();
  expect(first.bound).toContain("alice:Plant");
  expect(first.bound).toContain("alice:Sprout");
  return { me, alice, ch };
}

async function strangerNegates(me: Gateway, targetId: string): Promise<string> {
  const forged = signClaims(
    withStamp(me.stamp(STRANGER), (t) => makeNegationClaims(STRANGER, t, targetId)),
    STRANGER_SEED,
  );
  await me.append([forged]);
  return forged.id;
}

const throws = (fn: () => unknown): boolean => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const livingNames = (me: Gateway, ch: Channel): string[] =>
  cursesOf(me, ch.name)
    .map((c) => c.living)
    .sort();

describe("T232 — a write-granted stranger cannot lift an operator's curse", () => {
  it("(a) the stranger's negation leaves the lens retired at the door across the next poll", async () => {
    const { me, alice, ch } = await meAndAlice();

    await me.curseChannelLaw(ch.name, "alice:Plant");
    expect(throws(() => me.def("alice:Plant"))).toBe(true);
    expect(me.def("alice:Sprout")).toBeDefined();

    const curseId = cursesOf(me, ch.name).find((c) => c.living === "alice:Plant")!.deltaId;
    const forgedId = await strangerNegates(me, curseId);

    expect(me.reactor.get(forgedId)).toBeDefined();
    expect(me.reactor.negationsOf(curseId)).toContain(forgedId);
    expect(me.reactor.negationsOf(forgedId)).toHaveLength(0);
    expect(me.reactor.get(forgedId)!.claims.author).toBe(STRANGER);

    await alice.publishRegistration(
      { ...PLANT, alg: 1 },
      PLANT_POLICY,
      [FERN],
      undefined,
      "hyperschema:Plant",
    );
    const again = await ch.sync();

    expect(again.bound).not.toContain("alice:Plant");
    expect(throws(() => me.def("alice:Plant"))).toBe(true);
    const answer = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
    expect(answer.errors, JSON.stringify(answer)).toBeDefined();
    expect(answer.data ?? undefined).toBeUndefined();

    expect(me.def("alice:Sprout")).toBeDefined();
    const sprout = await me.query(`{ alice_Sprout(entity: "${FERN}") { height } }`);
    expect(sprout.errors, JSON.stringify(sprout)).toBeUndefined();

    await me.curseChannelLaw(ch.name, "alice:Plant", { lift: true });
    const lifted = await ch.sync();
    expect([...lifted.bound, ...lifted.witnessed]).toContain("alice:Plant");
    expect(me.def("alice:Plant")).toBeDefined();
    const revived = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
    expect(revived.errors, JSON.stringify(revived)).toBeUndefined();
  });

  it("(b) the stranger's negation is present in the ground and inert; the operator's lift is not", async () => {
    const { me, ch } = await meAndAlice();

    await me.curseChannelLaw(ch.name, "alice:Plant");
    await me.curseChannelLaw(ch.name, "alice:Sprout");
    const curseP = cursesOf(me, ch.name).find((c) => c.living === "alice:Plant")!.deltaId;
    const curseS = cursesOf(me, ch.name).find((c) => c.living === "alice:Sprout")!.deltaId;

    const forgedId = await strangerNegates(me, curseP);
    await strangerNegates(me, curseS);

    expect(me.reactor.get(forgedId)).toBeDefined();
    expect(me.reactor.negationsOf(curseP)).toContain(forgedId);
    expect(me.reactor.negationsOf(forgedId)).toHaveLength(0);
    expect(me.reactor.get(forgedId)!.claims.author).toBe(STRANGER);
    expect(
      me.reactor.negationsOf(curseP).every((n) => me.reactor.get(n)!.claims.author === STRANGER),
    ).toBe(true);

    expect(livingNames(me, ch)).toEqual(["alice:Plant", "alice:Sprout"]);

    await me.curseChannelLaw(ch.name, "alice:Plant", { lift: true });
    expect(livingNames(me, ch)).toEqual(["alice:Sprout"]);
    expect(me.reactor.get(curseS)).toBeDefined();
  });

  it("(author) a stranger cannot RECORD a curse this store never made", async () => {
    const { me, ch } = await meAndAlice();

    await me.curseChannelLaw(ch.name, "alice:Plant");
    const curseId = cursesOf(me, ch.name).find((c) => c.living === "alice:Plant")!.deltaId;
    const template = me.reactor.get(curseId)!.claims;

    const forged: Claims = {
      ...template,
      author: STRANGER,
      ...me.stamp(STRANGER),
      pointers: template.pointers.map((p) =>
        p.role === "living" ? { ...p, target: { kind: "primitive", value: "alice:Sprout" } } : p,
      ),
    };
    const strangerCurse = signClaims(forged, STRANGER_SEED);
    await me.append([strangerCurse]);

    expect(me.reactor.get(strangerCurse.id)).toBeDefined();
    expect(me.reactor.negationsOf(strangerCurse.id)).toHaveLength(0);
    expect(me.reactor.get(strangerCurse.id)!.claims.author).toBe(STRANGER);

    expect(livingNames(me, ch)).toEqual(["alice:Plant"]);

    expect(me.def("alice:Sprout")).toBeDefined();
    const before = await me.query(`{ alice_Sprout(entity: "${FERN}") { height } }`);
    expect(before.errors, JSON.stringify(before)).toBeUndefined();
    await ch.sync();
    expect(me.def("alice:Sprout")).toBeDefined();
    const after = await me.query(`{ alice_Sprout(entity: "${FERN}") { height } }`);
    expect(after.errors, JSON.stringify(after)).toBeUndefined();
  });
});
