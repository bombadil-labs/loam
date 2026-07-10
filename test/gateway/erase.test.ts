// SPEC §11's contract: erasure. The store remembers THAT it forgot — who asked, when, which
// id — never what. Authority is verified while the evidence exists (the tombstone's spoken-by
// is checked against the live target at the door); the bytes are purged from the ground; the
// gateway re-seats on what remains; and the door refuses the id's return until the tombstone
// is lawfully struck. Degrees of forgetting compose from erase + append — never mutation.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeDelta,
  makeNegationClaims,
  signClaims,
  type Delta,
} from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import {
  ERASE_ENTITY,
  eraseClaims,
  readTombstones,
  sealCommitment,
  tombstonesIn,
} from "../../src/gateway/erase.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, SURVEYOR_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OP_SEED);
const SURVEYOR = authorForSeed(SURVEYOR_SEED);

// A governed plant store where the gardener holds standing and one height is on record.
async function grove(): Promise<{ gateway: Gateway; backend: MemoryBackend; fact: Delta }> {
  const backend = new MemoryBackend();
  const gateway = await Gateway.open(backend, { seed: OP_SEED });
  gateway.register(PLANT, PLANT_POLICY, [FERN]);
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1), OP_SEED),
  ]);
  const fact = observed(FERN, "height", 30, 1000, GARDENER_SEED);
  await gateway.append([fact]);
  return { gateway, backend, fact };
}

const heights = (gateway: Gateway): readonly unknown[] =>
  gateway.reactor
    .materializedView(gateway.materializationFor("Plant"), FERN)
    ?.props.get("height") ?? [];

describe("tombstones are law: validated at the door while the evidence exists", () => {
  it("a tombstone lying about spoken-by is refused while the target is present", async () => {
    const { gateway, fact } = await grove();
    const lying = signClaims(
      eraseClaims(fact.id, OPERATOR /* not the gardener */, OPERATOR, 2000),
      OP_SEED,
    );
    await expect(gateway.append([lying])).rejects.toThrow(/spoken-by/);
    await gateway.close();
  });

  it("erasure authority is the author or the operator — a bystander with standing is refused", async () => {
    const { gateway, fact } = await grove();
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, 3), OP_SEED),
    ]);
    const overreach = signClaims(eraseClaims(fact.id, GARDENER, SURVEYOR, 2000), SURVEYOR_SEED);
    await expect(gateway.append([overreach])).rejects.toThrow(/authority/);
    await gateway.close();
  });

  it("malformed tombstones are malformed law: shape refused for everyone", async () => {
    const { gateway, fact } = await grove();
    const noSpokenBy = makeDelta({
      timestamp: 2000,
      author: OPERATOR,
      pointers: [
        {
          role: "declares",
          target: { kind: "entity", entity: { id: ERASE_ENTITY, context: "loam.erasure" } },
        },
        { role: "erases", target: { kind: "delta", deltaRef: { delta: fact.id } } },
      ],
    });
    await expect(gateway.append([signClaims(noSpokenBy.claims, OP_SEED)])).rejects.toThrow(
      /spoken-by/,
    );
    await gateway.close();
  });
});

describe("Gateway.erase: the manifest, the purge, the re-seat, the hole", () => {
  it("erases the bytes everywhere, keeps the signed hole, and the view thins", async () => {
    const { gateway, backend, fact } = await grove();
    // a negation citing the fact — the manifest must name it
    const strike = signClaims(makeNegationClaims(OPERATOR, 1500, fact.id), OP_SEED);
    await gateway.append([strike]);
    expect(heights(gateway).length).toBe(0); // struck, but the bytes still exist

    const report = await gateway.erase(fact.id, { reason: "unsaid by request" });
    expect(report.citations).toContain(strike.id);
    // the bytes are gone from the ground…
    const ground = await backend.deltasSince(new Set());
    expect(ground.some((d) => d.id === fact.id)).toBe(false);
    // …the reactor was re-seated without them…
    expect(gateway.reactor.get(fact.id)).toBeUndefined();
    expect(heights(gateway).length).toBe(0);
    // …and the tombstone is ground: who asked, which id — never what
    expect(readTombstones(gateway.reactor, OPERATOR).has(fact.id)).toBe(true);
    await gateway.close();
  });

  it("the author may unsay their own words (actorSeed), a stranger may not", async () => {
    const { gateway, fact } = await grove();
    await expect(gateway.erase(fact.id, { actorSeed: SURVEYOR_SEED })).rejects.toThrow(/authority/);
    await gateway.erase(fact.id, { actorSeed: GARDENER_SEED });
    expect(readTombstones(gateway.reactor, OPERATOR).has(fact.id)).toBe(true);
    await gateway.close();
  });

  it("the door remembers the hole: append and federate both refuse the erased id", async () => {
    const { gateway, fact } = await grove();
    await gateway.erase(fact.id);
    await expect(gateway.append([fact])).rejects.toThrow(/was erased/);
    const report = await gateway.federate([fact]); // open trust — but the hole outranks it
    expect(report.accepted).toBe(0);
    expect(report.rejected).toBe(1);
    await gateway.close();
  });

  it("forgiveness is striking the tombstone: the id may then return", async () => {
    const { gateway, fact } = await grove();
    await gateway.erase(fact.id);
    const tombstone = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "delta" && p.target.deltaRef.delta === fact.id,
      ),
    );
    await gateway.append([signClaims(makeNegationClaims(OPERATOR, 9000, tombstone!.id), OP_SEED)]);
    expect(readTombstones(gateway.reactor, OPERATOR).has(fact.id)).toBe(false);
    await gateway.append([fact]); // welcomed back
    expect(heights(gateway).length).toBe(1);
    await gateway.close();
  });

  it("the gateway lives on after the re-seat: queries answer, writes persist", async () => {
    const { gateway, backend, fact } = await grove();
    await gateway.erase(fact.id);
    const after = observed(FERN, "height", 44, 3000, GARDENER_SEED);
    await gateway.append([after]);
    expect(heights(gateway).length).toBe(1);
    await gateway.flush();
    // and the post-erase write reached the ground through the re-attached persistence
    const ground = await backend.deltasSince(new Set());
    expect(ground.some((d) => d.id === after.id)).toBe(true);
    await gateway.close();
  });
});

describe("degrees of forgetting compose from erase + append", () => {
  it("anonymous reassertion: the fact survives in another voice, with no on-record link", async () => {
    const { gateway, fact } = await grove();
    // the replacement inherits the timestamp (content, time — same fact) but speaks as the store
    const replacement = signClaims({ ...fact.claims, author: OPERATOR }, OP_SEED);
    await gateway.erase(fact.id);
    await gateway.append([replacement]);
    expect(heights(gateway).length).toBe(1);
    // no pointer anywhere links the replacement to the erased id (the hash oracle stays cold)
    expect(replacement.claims.pointers.some((p) => p.target.kind === "delta")).toBe(false);
    await gateway.close();
  });

  it("sealed authorship: anonymous today, provably yours on reveal", () => {
    const salt = "1f".repeat(16);
    const commitment = sealCommitment(salt, GARDENER);
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(sealCommitment(salt, GARDENER)).toBe(commitment); // reveal verifies
    expect(sealCommitment(salt, OPERATOR)).not.toBe(commitment); // and discriminates
  });
});

describe("erasure federates: the request travels, the refusal is testable", () => {
  it("a peer that admits the author's tombstone refuses the id thereafter", async () => {
    const { gateway: source, fact } = await grove();
    const peer = await Gateway.open(new MemoryBackend(), { seed: "0f".repeat(32) });
    // the fact crossed before the unsaying (open trust)
    await peer.federate([fact]);
    expect(peer.reactor.get(fact.id)).toBeDefined();
    // the author unsays at the source; the tombstone federates like any claim
    await source.erase(fact.id, { actorSeed: GARDENER_SEED });
    const tombstone = [...source.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "delta" && p.target.deltaRef.delta === fact.id,
      ),
    );
    await peer.federate([tombstone!]);
    // the peer's own operator finishes the forgetting (compliance is a choice, and testable)
    await peer.erase(fact.id);
    expect(peer.reactor.get(fact.id)).toBeUndefined();
    const again = await peer.federate([fact]);
    expect(again.accepted).toBe(0); // ask any store for the id and see what returns
    await source.close();
    await peer.close();
  });
});

describe("tombstone readers verify authority, not just self-consistency", () => {
  it("a federated tombstone that misnames itself the author is refused at the door", async () => {
    // A held record authored by the gardener. A tombstone arrives by federation claiming
    // author === spoken-by === SURVEYOR — a self-erasure of a record SURVEYOR did not write.
    // The live target disagrees, so the federation door refuses it: it is never stored.
    const { gateway, fact } = await grove();
    const lie = signClaims(eraseClaims(fact.id, SURVEYOR, SURVEYOR, 2000), SURVEYOR_SEED);
    const report = await gateway.federate([lie]);
    expect(report.accepted).toBe(0);
    expect(report.rejected).toBe(1);
    expect(readTombstones(gateway.reactor, OPERATOR).has(fact.id)).toBe(false);
    expect(gateway.reactor.get(fact.id)).toBeDefined(); // the record is untouched
    await gateway.close();
  });

  it("a pre-emptive self-tombstone for an absent id (non-operator) is refused at the door", async () => {
    const { gateway } = await grove();
    const ghostId = `1e20${"cd".repeat(32)}`;
    const preempt = signClaims(eraseClaims(ghostId, SURVEYOR, SURVEYOR, 2000), SURVEYOR_SEED);
    const report = await gateway.federate([preempt]);
    expect(report.rejected).toBe(1);
    expect(readTombstones(gateway.reactor, OPERATOR).has(ghostId)).toBe(false);
    await gateway.close();
  });

  it("a record author's self-erasure DOES federate and bind (their words, anywhere)", async () => {
    // Distinguish from the refusals above: an honest self-erasure by the record's actual
    // author, arriving where the target is present, is admitted and binds.
    const { gateway, fact } = await grove();
    const honest = signClaims(eraseClaims(fact.id, GARDENER, GARDENER, 2000), GARDENER_SEED);
    const report = await gateway.federate([honest]);
    expect(report.accepted).toBe(1);
    expect(readTombstones(gateway.reactor, OPERATOR).has(fact.id)).toBe(true);
    await gateway.close();
  });

  it("the operator may still erase, present target or not; that authority is real", async () => {
    const { gateway, fact } = await grove();
    const ghostId = `1e20${"ab".repeat(32)}`;
    await gateway.append([
      signClaims(eraseClaims(fact.id, GARDENER, OPERATOR, 2000), OP_SEED),
      signClaims(eraseClaims(ghostId, "did:key:zAnon", OPERATOR, 2001), OP_SEED),
    ]);
    const dead = readTombstones(gateway.reactor, OPERATOR);
    expect(dead.has(fact.id)).toBe(true);
    expect(dead.has(ghostId)).toBe(true); // operator pre-emptive refusal is legitimate
    await gateway.close();
  });
});

describe("tombstonesIn (pre-boot) matches the running store's verdict", () => {
  it("a lawfully struck tombstone is NOT dead pre-boot — heal will not drop the forgiven record", async () => {
    // The exact heal-vs-forgiveness interaction SPEC §11 says to pin first.
    const { gateway, fact } = await grove();
    await gateway.erase(fact.id); // operator tombstone
    const all1 = [...gateway.reactor.snapshot()];
    expect(tombstonesIn(all1, OPERATOR).has(fact.id)).toBe(true); // dead while the tombstone stands
    const tombstone = all1.find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "delta" && p.target.deltaRef.delta === fact.id,
      ),
    );
    await gateway.append([signClaims(makeNegationClaims(OPERATOR, 9000, tombstone!.id), OP_SEED)]);
    const all2 = [...gateway.reactor.snapshot()];
    // forgiven: the pre-boot reader agrees, so a boot heal would carry (not drop) the record
    expect(tombstonesIn(all2, OPERATOR).has(fact.id)).toBe(false);
    await gateway.close();
  });

  it("does not drift from the running store's verdict (an operator erasure is dead both ways)", async () => {
    const { gateway, fact } = await grove();
    await gateway.erase(fact.id);
    const all = [...gateway.reactor.snapshot()];
    expect(tombstonesIn(all, OPERATOR)).toEqual(readTombstones(gateway.reactor, OPERATOR));
    expect(tombstonesIn(all, OPERATOR).has(fact.id)).toBe(true);
    await gateway.close();
  });
});

describe("the erasure log stays append-only", () => {
  it("a tombstone cannot itself be erased", async () => {
    const { gateway, fact } = await grove();
    await gateway.erase(fact.id);
    const tombstone = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "delta" && p.target.deltaRef.delta === fact.id,
      ),
    );
    await expect(gateway.erase(tombstone!.id)).rejects.toThrow(/append-only/);
    await gateway.close();
  });
});
