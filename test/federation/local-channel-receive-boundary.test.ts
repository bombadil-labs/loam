// T288 P3 addendum: the service must perform admission, never sign caller-selected receipt IDs.
// Direct calls below own the ordinary per-name commit queue, as the internal API requires.
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway, type FederationReport } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import * as ingest from "../../src/gateway/ingest.js";
import { trustClaims } from "../../src/gateway/trust.js";
import {
  localChannelEvidence,
  withChannelCommit,
  type LocalChannelOpening,
} from "../../src/federation/local-channel-events.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const SEED = "cc".repeat(32);
const PEER_SEED = "a1".repeat(32);
const PEER = authorForSeed(PEER_SEED);
const homes: Gateway[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const gw of homes.splice(0)) await gw.close();
});
const fact = (n: number) => observed(FERN, "height", n, 1000 + n, PEER_SEED);
const ids = (deltas: Iterable<Delta>) => [...deltas].map((d) => d.id).sort();
const events = (gw: Gateway) =>
  [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === "loam.local.channel.event",
    ),
  );
function evidence(gw: Gateway, name: string) {
  const result = localChannelEvidence(gw, name);
  if (result.state !== "open") throw new Error(`fixture expected open, got ${result.state}`);
  return result;
}
async function fixture() {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: SEED, registrations: [] }),
    { channelBackend: () => new MemoryBackend() },
  );
  homes.push(gw);
  const offering: Delta[] = [];
  const ch = await gw.openChannel({
    into: "friends",
    prefix: "peer",
    from: "https://peer.example/default",
    source: { pull: () => Promise.resolve([...offering]) },
  });
  return { gw, ch, offering, pool: ch.pool.gateway!, opening: evidence(gw, ch.name).opening };
}
type ReceiveResult =
  | { ok: true; report: FederationReport }
  | { ok: false; report: FederationReport; error: unknown; missingAdmittedIds: boolean };
function receive(
  gw: Gateway,
  opening: LocalChannelOpening,
  offer: readonly Delta[],
): Promise<ReceiveResult> {
  // Missing export is intentionally an API-shape red before repair, not a behavioral verdict.
  return withChannelCommit(gw, opening.channel, () =>
    ingest.receiveChannelOfferInCommit(gw, opening, offer),
  );
}

describe("T288 receive service boundary", () => {
  it("positive control: normal sync receives a previously held but unattested source only after an actual offer", async () => {
    const f = await fixture();
    const a = fact(11);
    await f.pool.federate([a]);
    const before = ids(events(f.gw));
    await f.ch.sync();
    expect(ids(events(f.gw))).toEqual(before);
    expect(evidence(f.gw, f.ch.name).received).toEqual([]);
    const actual = vi.spyOn(f.pool, "federate");
    f.offering.push(a);
    const report = await f.ch.sync();
    expect(report.accepted).toBe(0);
    expect(actual).toHaveBeenCalledWith([a], { ids: true, admittedIds: true });
    expect(ids(evidence(f.gw, f.ch.name).received)).toEqual([a.id]);
    expect(events(f.gw)).toHaveLength(before.length + 1);
  });

  it("refuses the old received action at runtime without history changes; a later real offer receives the same held source", async () => {
    const f = await fixture();
    const a = fact(1);
    await f.pool.federate([a]);
    expect(evidence(f.gw, f.ch.name).received).toEqual([]);
    const before = ids(events(f.gw));
    const durableBefore = ids(await f.gw.backend.deltasSince(new Set()));
    let refused = false;
    try {
      // Exercise the JavaScript boundary even after the TypeScript union narrows.
      const oldInput = {
        action: "received",
        channel: f.ch.name,
        opening: f.opening.id,
        received: [a.id],
      } as unknown as Parameters<typeof ingest.issueChannelEvent>[1];
      await ingest.issueChannelEvent(f.gw, oldInput);
    } catch {
      refused = true;
    }
    const afterAttempt = ids(events(f.gw));
    const durableAfterAttempt = ids(await f.gw.backend.deltasSince(new Set()));
    const receivedAfterAttempt = ids(evidence(f.gw, f.ch.name).received);
    // Execute the real positive control even when the forbidden writer wrongly succeeds.
    f.offering.push(a);
    const report = await f.ch.sync();
    expect(report.accepted).toBe(0);
    expect(ids(evidence(f.gw, f.ch.name).received)).toEqual([a.id]);
    expect.soft(refused).toBe(true);
    expect.soft(afterAttempt).toEqual(before);
    expect.soft(durableAfterAttempt).toEqual(durableBefore);
    expect.soft(receivedAfterAttempt).toEqual([]);
  });

  it("direct receive calls actual pool federation once and attests only its sorted unique admitted IDs", async () => {
    const f = await fixture();
    const a = fact(2),
      heldUnoffered = fact(3),
      b = fact(4);
    await f.pool.federate([heldUnoffered]);
    const call = vi.spyOn(f.pool, "federate");
    const result = await receive(f.gw, f.opening, [b, a, b]);
    expect(result.ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith([b, a, b], { ids: true, admittedIds: true });
    expect(result.report.acceptedIds?.slice().sort()).toEqual([a.id, b.id].sort());
    expect(ids(evidence(f.gw, f.ch.name).received)).toEqual([a.id, b.id].sort());
    expect(await f.pool.backend.holds(a.id)).toBe(true);
    expect(await f.pool.backend.holds(heldUnoffered.id)).toBe(true);
  });

  it.each(["id", "from", "poolDeclaration", "openedBy"] as const)(
    "refuses a changed exact opening %s before any federation or history write",
    async (field) => {
      const f = await fixture();
      const a = fact(5);
      const before = ids(f.gw.reactor.snapshot());
      const pooled = ids(f.pool.reactor.snapshot());
      const call = vi.spyOn(f.pool, "federate");
      const changed = {
        ...f.opening,
        [field]: field === "id" || field === "poolDeclaration" ? a.id : "foreign",
      };
      await expect(receive(f.gw, changed, [a])).rejects.toThrow();
      expect(call).not.toHaveBeenCalled();
      expect(ids(f.gw.reactor.snapshot())).toEqual(before);
      expect(ids(f.pool.reactor.snapshot())).toEqual(pooled);
      expect((await receive(f.gw, f.opening, [a])).ok).toBe(true);
      expect(ids(evidence(f.gw, f.ch.name).received)).toEqual([a.id]);
    },
  );

  it("actual roster policy carries forward negation closure while refusing an unrelated author and forged strike", async () => {
    const f = await fixture();
    await f.pool.append([
      signClaims(trustClaims("roster", [PEER], authorForSeed(SEED), f.pool.nextTimestamp()), SEED),
    ]);
    const a = fact(6);
    const strangerSeed = "b2".repeat(32);
    const strike = signClaims(
      makeNegationClaims(authorForSeed(strangerSeed), 9001, a.id),
      strangerSeed,
    );
    const strikeAgain = signClaims(
      makeNegationClaims(authorForSeed(strangerSeed), 9002, strike.id),
      strangerSeed,
    );
    const unrelated = observed(FERN, "height", 7, 1007, strangerSeed);
    const forged = {
      ...signClaims(
        makeNegationClaims(authorForSeed(strangerSeed), 9003, strikeAgain.id),
        strangerSeed,
      ),
      sig: a.sig!,
    };
    const result = await receive(f.gw, f.opening, [unrelated, forged, strikeAgain, strike, a]);
    expect(result.ok).toBe(true);
    expect(result.report.rejected).toBe(2);
    expect(ids(evidence(f.gw, f.ch.name).received)).toEqual(
      [a.id, strike.id, strikeAgain.id].sort(),
    );
    expect(f.pool.reactor.get(unrelated.id)).toBeUndefined();
    expect(f.pool.reactor.get(forged.id)).toBeUndefined();
  });

  it("a counts-only actual report refuses new receipts but permits already-attested and empty quiet offers", async () => {
    const f = await fixture();
    const a = fact(8),
      b = fact(9);
    expect((await receive(f.gw, f.opening, [a])).ok).toBe(true);
    const before = ids(events(f.gw));
    const real = f.pool.federate.bind(f.pool);
    f.pool.federate = async (offer, options) => {
      const report = await real(offer, options);
      return {
        offered: report.offered,
        accepted: report.accepted,
        rejected: report.rejected,
        held: report.held,
      };
    };
    expect((await receive(f.gw, f.opening, [a])).ok).toBe(true);
    expect((await receive(f.gw, f.opening, [])).ok).toBe(true);
    const failed = await receive(f.gw, f.opening, [b]);
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error("missing admission IDs must fail");
    expect(failed.missingAdmittedIds).toBe(true);
    expect(failed.report.accepted).toBe(1);
    expect(ids(events(f.gw))).toEqual(before);
    expect(await f.pool.backend.holds(b.id)).toBe(true);
    f.pool.federate = real;
    expect((await receive(f.gw, f.opening, [b])).ok).toBe(true);
    expect(ids(evidence(f.gw, f.ch.name).received)).toEqual([a.id, b.id].sort());
  });

  it("receipt-stage refusal returns the actual successful source report and only a later offer can prove those bytes", async () => {
    const f = await fixture();
    const a = fact(10);
    const real = f.gw.backend.append.bind(f.gw.backend);
    const fault = vi.spyOn(f.gw.backend, "append").mockImplementation(async (offer) => {
      const batch = [...offer];
      if (
        batch.some((d) =>
          d.claims.pointers.some(
            (p) =>
              p.role === "action" && p.target.kind === "primitive" && p.target.value === "received",
          ),
        )
      )
        throw new Error("receipt boundary fault");
      return real(batch);
    });
    const result = await receive(f.gw, f.opening, [a]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("receipt failure must be explicit");
    expect(result.error).toEqual(new Error("receipt boundary fault"));
    expect(result.missingAdmittedIds).toBe(false);
    expect(result.report.acceptedIds).toEqual([a.id]);
    expect(await f.pool.backend.holds(a.id)).toBe(true);
    expect(evidence(f.gw, f.ch.name).received).toEqual([]);
    fault.mockRestore();
    expect((await receive(f.gw, f.opening, [])).ok).toBe(true);
    expect(evidence(f.gw, f.ch.name).received).toEqual([]);
    expect((await receive(f.gw, f.opening, [a])).ok).toBe(true);
    expect(ids(evidence(f.gw, f.ch.name).received)).toEqual([a.id]);
  });
});
