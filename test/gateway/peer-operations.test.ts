// What one container asks of another (ruling 11, ruling 13). A container holds a child only as a
// Peer, and a Peer has no key: the child performs a signed act itself, with its own governing key,
// or with a key the caller holds for itself. The type rail fails the typecheck if a key-bearing
// member returns to Peer; the cases pin who signs and where each act lands.

import { authorForSeed } from "@bombadil/rhizomatic";
import { describe, expect, it } from "vitest";
import { grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import type { Peer } from "../../src/gateway/peer.js";
import { seedSigner } from "../../src/gateway/signer.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const SEED = "5c".repeat(32);
const ACTOR = seedSigner("5d".repeat(32));

const tree = async (): Promise<{ host: Gateway; pool: Gateway }> => {
  const host = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: SEED }));
  const pool = (await host.openQuarantine()).gateway;
  return { host, pool };
};

describe("operations a container performs when another asks", () => {
  it("a Peer carries no key and no way to sign in the child's name", () => {
    const reach = (p: Peer): unknown[] => [
      // @ts-expect-error a Peer has no signer: no container signs in another's name
      p.signer,
      // @ts-expect-error a Peer has no stamp: the child stamps its own acts
      p.stamp,
      // @ts-expect-error a Peer has no def: a read of what it serves goes through `registered`
      p.def,
      // @ts-expect-error a Peer has no backend: another container asks `probe`, and never purges
      p.backend,
    ];
    expect(typeof reach).toBe("function");
  });

  it("strike signs with the child's own key, in the child only", async () => {
    const { host, pool } = await tree();
    const fact = observed(FERN, "height", 7, 1000, SEED);
    expect((await pool.federate([fact], { admit: () => true })).accepted).toBe(1);
    const peer: Peer = pool;
    await peer.strike([fact.id]);
    const strikes = pool.reactor.negationsOf(fact.id).map((id) => pool.reactor.get(id)!);
    expect(strikes.map((d) => d.claims.author)).toEqual([pool.operatorAuthor]);
    expect(pool.operatorAuthor).not.toBe(host.operatorAuthor);
    expect(host.reactor.negationsOf(fact.id)).toEqual([]); // the host holds no strike of its own
    await host.close();
  });

  it("strike by a caller's own key signs as that caller, one stamp for the batch", async () => {
    const { host, pool } = await tree();
    const a = observed(FERN, "height", 1, 1000, SEED);
    const b = observed(FERN, "height", 2, 1001, SEED);
    expect((await pool.federate([a, b], { admit: () => true })).accepted).toBe(2);
    // The pool's own door decides who may write there: its key grants the actor, as a bind does.
    const law = pool.signer!;
    await pool.append([
      law.sign(grantClaims(STORE_ENTITY, ACTOR.author, "write", law.author, 900)),
    ]);
    await pool.strike([a.id, b.id], ACTOR);
    const strikes = [a, b].flatMap((d) =>
      pool.reactor.negationsOf(d.id).map((id) => pool.reactor.get(id)!),
    );
    expect(strikes.map((d) => d.claims.author)).toEqual([ACTOR.author, ACTOR.author]);
    // One stamp for the batch: one time, two deltas (they point at different targets).
    expect(new Set(strikes.map((d) => d.claims.timestamp)).size).toBe(1);
    expect(new Set(strikes.map((d) => d.id)).size).toBe(2);
    await host.close();
  });

  it("a grant and revocations are signed with the child's own key", async () => {
    const { host, pool } = await tree();
    await pool.issueGrant(ACTOR.author, "write");
    const grant = [...pool.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "primitive" && p.target.value === ACTOR.author,
      ),
    );
    expect(grant?.claims.author).toBe(pool.operatorAuthor);
    expect(host.reactor.get(grant!.id)).toBeUndefined();
    const revs = pool.revocations([grant!.id]);
    expect(revs.map((d) => d.claims.author)).toEqual([pool.operatorAuthor]);
    expect(pool.reactor.get(revs[0]!.id)).toBeUndefined(); // returned, not admitted
    await host.close();
  });

  it("probe answers from the container's own store only", async () => {
    const { host, pool } = await tree();
    const inPool = observed(FERN, "height", 3, 1000, SEED);
    const inHost = observed(FERN, "height", 4, 1001, SEED);
    expect((await pool.federate([inPool], { admit: () => true })).accepted).toBe(1);
    await host.append([inHost]);
    const peer: Peer = pool;
    expect(await peer.probe({ holds: inPool.id })).toBe(true);
    expect(await peer.probe({ holds: inHost.id })).toBe(false);
    const retention = await peer.probe({ retention: [inPool.id, inHost.id] });
    expect([...retention.held]).toEqual([inPool.id]);
    expect(await peer.probe("any")).toBe(true);
    const inventory = await peer.probe("inventory");
    expect(typeof inventory === "string" ? inventory : inventory.has(inPool.id)).toBe(true);
    expect(typeof inventory === "string" ? inventory : inventory.has(inHost.id)).toBe(false);
    expect(await host.probe({ holds: inPool.id })).toBe(false);
    expect(await host.probe({ holds: inHost.id })).toBe(true);
    await host.close();
  });

  it("arrival stamps are the child's own claims, returned unadmitted", async () => {
    const { host, pool } = await tree();
    const stamps = pool.arrivalStamps("channel:x", "", [["a".repeat(64)], ["b".repeat(64)]]);
    expect(stamps.map((d) => d.claims.author)).toEqual([pool.operatorAuthor, pool.operatorAuthor]);
    expect(stamps.every((d) => pool.reactor.get(d.id) === undefined)).toBe(true);
    expect(authorForSeed(SEED)).toBe(host.operatorAuthor);
    await host.close();
  });
});
