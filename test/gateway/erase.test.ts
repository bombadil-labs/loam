import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeDelta,
  makeNegationClaims,
  signClaims,
  type Delta,
} from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { sealCommitment } from "../../src/gateway/erase.js";
import {
  ERASE_ENTITY,
  eraseClaims,
  isErasure,
  readErasures,
  erasuresIn,
} from "../../src/gateway/erase-law.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, SURVEYOR_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OP_SEED);
const SURVEYOR = authorForSeed(SURVEYOR_SEED);

async function grove(): Promise<{ gateway: Gateway; backend: MemoryBackend; fact: Delta }> {
  const backend = new MemoryBackend();
  const gateway = await Gateway.open(backend, { seed: OP_SEED });
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
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

describe("erasures are law: validated at the door while the evidence exists", () => {
  it("an erasure lying about spoken-by is refused while the target is present", async () => {
    const { gateway, fact } = await grove();
    const lying = signClaims(eraseClaims(fact.id, OPERATOR, OPERATOR, 2000), OP_SEED);
    await expect(gateway.append([lying])).rejects.toThrow(/spoken-by/);
    await gateway.close();
  });

  it("erasure is the operator's alone — a bystander with write standing is refused", async () => {
    const { gateway, fact } = await grove();
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, 3), OP_SEED),
    ]);
    const overreach = signClaims(eraseClaims(fact.id, GARDENER, SURVEYOR, 2000), SURVEYOR_SEED);
    await expect(gateway.append([overreach])).rejects.toThrow(/operator/);
    await gateway.close();
  });

  it("malformed erasures are malformed law: shape refused for everyone", async () => {
    const { gateway, fact } = await grove();
    const noSpokenBy = makeDelta({
      timestamp: 2000,
      validFrom: 2000,
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
    const strike = signClaims(makeNegationClaims(OPERATOR, 1500, fact.id), OP_SEED);
    await gateway.append([strike]);
    expect(heights(gateway).length).toBe(0);

    const report = await gateway.erase(fact.id, { reason: "unsaid by request" });
    expect(report.citations).toContain(strike.id);
    const ground = await backend.deltasSince(new Set());
    expect(ground.some((d) => d.id === fact.id)).toBe(false);
    expect(gateway.reactor.get(fact.id)).toBeUndefined();
    expect(heights(gateway).length).toBe(0);
    expect(readErasures(gateway.reactor, gateway.validityNow(), OPERATOR).has(fact.id)).toBe(true);
    await gateway.close();
  });

  it("only the operator may order erasure — even the record's own author cannot", async () => {
    const { gateway, fact } = await grove();
    const selfTomb = signClaims(eraseClaims(fact.id, GARDENER, GARDENER, 2000), GARDENER_SEED);
    await expect(gateway.append([selfTomb])).rejects.toThrow(/operator/);
    expect(readErasures(gateway.reactor, gateway.validityNow(), OPERATOR).has(fact.id)).toBe(false);
    await gateway.erase(fact.id, { reason: "honoring a subject's request" });
    expect(readErasures(gateway.reactor, gateway.validityNow(), OPERATOR).has(fact.id)).toBe(true);
    await gateway.close();
  });

  it("the door remembers the hole: append and federate both refuse the erased id", async () => {
    const { gateway, fact } = await grove();
    await gateway.erase(fact.id);
    await expect(gateway.append([fact])).rejects.toThrow(/was erased/);
    const report = await gateway.federate([fact]);
    expect(report.accepted).toBe(0);
    expect(report.rejected).toBe(1);
    await gateway.close();
  });

  it("negating the erasure retracts the record, and the id still never returns", async () => {
    const { gateway, fact } = await grove();
    await gateway.erase(fact.id);
    const erasure = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "delta" && p.target.deltaRef.delta === fact.id,
      ),
    );
    await gateway.append([signClaims(makeNegationClaims(OPERATOR, 9000, erasure!.id), OP_SEED)]);
    expect(readErasures(gateway.reactor, gateway.validityNow(), OPERATOR).has(fact.id)).toBe(false);
    await expect(gateway.append([fact])).rejects.toThrow(/was erased/);
    expect(heights(gateway).length).toBe(0);
    await gateway.close();
  });

  it("the gateway lives on after the re-seat: queries answer, writes persist", async () => {
    const { gateway, backend, fact } = await grove();
    await gateway.erase(fact.id);
    const after = observed(FERN, "height", 44, 3000, GARDENER_SEED);
    await gateway.append([after]);
    expect(heights(gateway).length).toBe(1);
    await gateway.flush();
    const ground = await backend.deltasSince(new Set());
    expect(ground.some((d) => d.id === after.id)).toBe(true);
    await gateway.close();
  });
});

describe("degrees of forgetting compose from erase + append", () => {
  it("anonymous reassertion: the fact survives in another voice, with no on-record link", async () => {
    const { gateway, fact } = await grove();
    const replacement = signClaims({ ...fact.claims, author: OPERATOR }, OP_SEED);
    await gateway.erase(fact.id);
    await gateway.append([replacement]);
    expect(heights(gateway).length).toBe(1);
    expect(replacement.claims.pointers.some((p) => p.target.kind === "delta")).toBe(false);
    await gateway.close();
  });

  it("sealed authorship: anonymous today, provably yours on reveal", () => {
    const salt = "1f".repeat(16);
    const commitment = sealCommitment(salt, GARDENER);
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(sealCommitment(salt, GARDENER)).toBe(commitment);
    expect(sealCommitment(salt, OPERATOR)).not.toBe(commitment);
  });
});

describe("erasure is per-instance: each operator governs their own ground", () => {
  it("one store's operator erasure does NOT compel a peer; the peer's own operator decides", async () => {
    const { gateway: source, fact } = await grove();
    const peer = await Gateway.open(new MemoryBackend(), { seed: "0f".repeat(32) });
    await peer.federate([fact]);
    expect(peer.reactor.get(fact.id)).toBeDefined();

    await source.erase(fact.id);
    const erasure = [...source.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "delta" && p.target.deltaRef.delta === fact.id,
      ),
    );
    const crossed = await peer.federate([erasure!]);
    expect(crossed.rejected).toBe(1);
    expect(peer.reactor.get(fact.id)).toBeDefined();

    await peer.erase(fact.id);
    expect(peer.reactor.get(fact.id)).toBeUndefined();
    const again = await peer.federate([fact]);
    expect(again.accepted).toBe(0);
    await source.close();
    await peer.close();
  });
});

describe("the door admits only the operator's removal-orders", () => {
  it("a federated erasure by a non-operator is refused, whatever it claims", async () => {
    const { gateway, fact } = await grove();
    const lie = signClaims(eraseClaims(fact.id, SURVEYOR, SURVEYOR, 2000), SURVEYOR_SEED);
    const report = await gateway.federate([lie]);
    expect(report.accepted).toBe(0);
    expect(report.rejected).toBe(1);
    expect(readErasures(gateway.reactor, gateway.validityNow(), OPERATOR).has(fact.id)).toBe(false);
    expect(gateway.reactor.get(fact.id)).toBeDefined();
    await gateway.close();
  });

  it("a pre-emptive erasure for an absent id (non-operator) is refused at the door", async () => {
    const { gateway } = await grove();
    const ghostId = `1e20${"cd".repeat(32)}`;
    const preempt = signClaims(eraseClaims(ghostId, SURVEYOR, SURVEYOR, 2000), SURVEYOR_SEED);
    const report = await gateway.federate([preempt]);
    expect(report.rejected).toBe(1);
    expect(readErasures(gateway.reactor, gateway.validityNow(), OPERATOR).has(ghostId)).toBe(false);
    await gateway.close();
  });

  it("a federated erasure delta from anyone but this store's operator is refused", async () => {
    const { gateway, fact } = await grove();
    const honest = signClaims(eraseClaims(fact.id, GARDENER, GARDENER, 2000), GARDENER_SEED);
    const report = await gateway.federate([honest]);
    expect(report.rejected).toBe(1);
    expect(readErasures(gateway.reactor, gateway.validityNow(), OPERATOR).has(fact.id)).toBe(false);
    expect(gateway.reactor.get(fact.id)).toBeDefined();
    await gateway.close();
  });

  it("the operator may still erase, present target or not; that authority is real", async () => {
    const { gateway, fact } = await grove();
    const ghostId = `1e20${"ab".repeat(32)}`;
    await gateway.append([
      signClaims(eraseClaims(fact.id, GARDENER, OPERATOR, 2000), OP_SEED),
      signClaims(eraseClaims(ghostId, "did:key:zAnon", OPERATOR, 2001), OP_SEED),
    ]);
    const dead = readErasures(gateway.reactor, gateway.validityNow(), OPERATOR);
    expect(dead.has(fact.id)).toBe(true);
    expect(dead.has(ghostId)).toBe(true);
    await gateway.close();
  });
});

describe("erasuresIn (pre-boot) matches the running store's verdict", () => {
  it("a lawfully struck erasure is NOT dead pre-boot — heal will not drop the negated record", async () => {
    const { gateway, fact } = await grove();
    await gateway.erase(fact.id);
    const all1 = [...gateway.reactor.snapshot()];
    expect(erasuresIn(all1, Date.now(), OPERATOR).has(fact.id)).toBe(true);
    const erasure = all1.find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "delta" && p.target.deltaRef.delta === fact.id,
      ),
    );
    await gateway.append([signClaims(makeNegationClaims(OPERATOR, 9000, erasure!.id), OP_SEED)]);
    const all2 = [...gateway.reactor.snapshot()];
    expect(erasuresIn(all2, Date.now(), OPERATOR).has(fact.id)).toBe(false);
    await gateway.close();
  });

  it("does not drift from the running store's verdict (an operator erasure is dead both ways)", async () => {
    const { gateway, fact } = await grove();
    await gateway.erase(fact.id);
    const all = [...gateway.reactor.snapshot()];
    expect(erasuresIn(all, Date.now(), OPERATOR)).toEqual(
      readErasures(gateway.reactor, gateway.validityNow(), OPERATOR),
    );
    expect(erasuresIn(all, Date.now(), OPERATOR).has(fact.id)).toBe(true);
    await gateway.close();
  });
});

describe("the erasure log stays append-only", () => {
  it("an erasure cannot itself be erased", async () => {
    const { gateway, fact } = await grove();
    await gateway.erase(fact.id);
    const erasure = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "delta" && p.target.deltaRef.delta === fact.id,
      ),
    );
    await expect(gateway.erase(erasure!.id)).rejects.toThrow(/append-only/);
    await gateway.close();
  });
});

describe("erase refuses to report a completion it cannot evidence", () => {
  it("a backend whose purge removes nothing makes erase throw rather than return erased", async () => {
    const { gateway, backend, fact } = await grove();
    backend.purge = () => Promise.resolve(0);
    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HELD by the store/,
    );
    await gateway.close();
  });

  it("a retry after a partial purge completes without minting a second erasure", async () => {
    const { gateway, backend, fact } = await grove();
    const real = backend.purge.bind(backend);
    const realHolds = backend.holds.bind(backend);
    let debtOwed = false;
    backend.holds = (id) => (debtOwed ? Promise.resolve(true) : realHolds(id));
    backend.purge = async (ids) => {
      await real(ids);
      debtOwed = true;
      throw new Error(
        "purge: the rows were deleted but the write-ahead log could not be truncated",
      );
    };
    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /wal|WAL|write-ahead/,
    );
    const tombstonesAfterFirst = [...gateway.reactor.snapshot()].filter((d) =>
      isErasure(d.claims),
    ).length;

    backend.purge = async (ids) => {
      const n = await real(ids);
      debtOwed = false;
      return n;
    };
    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: fact.id,
    });
    expect([...gateway.reactor.snapshot()].filter((d) => isErasure(d.claims)).length).toBe(
      tombstonesAfterFirst,
    );
    await gateway.close();
  });

  it("the ordinary path still reports the erasure, and the bytes are actually gone", async () => {
    const { gateway, fact } = await grove();
    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: fact.id,
    });
    expect(gateway.reactor.get(fact.id)).toBeUndefined();
    await gateway.close();
  });
});
