// Admission is serialized per gateway: a batch is checked against the state the batches before it
// left, never a state they are still writing. Each case starts two admissions without awaiting the
// first, so an unserialized door would check both against the same state. Asserted at both levels:
// what the store holds, and what the pause reports.

import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { refusedIds } from "../../src/gateway/erase.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { activeIncarnation, cutClaims, pausedKeys } from "../../src/gateway/recovery-cut.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const K1_SEED = "b1".repeat(32);
const K1 = authorForSeed(K1_SEED);
const op = (c: Claims): Delta => signClaims(c, OP_SEED);

const open: Gateway[] = [];
afterEach(async () => {
  for (const gw of open.splice(0)) await gw.close();
});

// A store where K1 may write, and a prepared cut that would pause K1 (no record, so no commit).
async function world(): Promise<{ gw: Gateway; cut: Delta }> {
  const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
  open.push(gw);
  await gw.append([op(grantClaims(STORE_ENTITY, K1, "write", OP, 11))]);
  const marker = activeIncarnation(gw.reactor, OP, new Set())!;
  const p = marker.claims.pointers.find((x) => x.role === "incarnation")!.target;
  const cut = op(
    cutClaims(
      {
        store: p.kind === "primitive" ? String(p.value) : "",
        attempt: "a",
        recovery: "no-such-record",
        key: K1,
      },
      OP,
      20,
    ),
  );
  return { gw, cut };
}

describe("admission lock", () => {
  it("an append started after a pausing append is judged after it: the paused key is refused", async () => {
    const { gw, cut } = await world();
    const late = observed(FERN, "height", 1, 30, K1_SEED);
    const [first, second] = await Promise.allSettled([gw.append([cut]), gw.append([late])]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    expect(pausedKeys(gw.reactor, OP, refusedIds(gw.reactor, OP)).has(K1)).toBe(true);
    expect(gw.reactor.get(late.id)).toBeUndefined();
  });

  it("a federate started after a pausing append is judged after it: the paused key is dropped", async () => {
    const { gw, cut } = await world();
    const late = observed(FERN, "height", 2, 31, K1_SEED);
    const [, report] = await Promise.all([gw.append([cut]), gw.federate([late])]);
    expect(report.accepted).toBe(0);
    expect(gw.reactor.get(late.id)).toBeUndefined();
  });

  it("a refused batch does not stall the door: the next admission runs", async () => {
    const { gw } = await world();
    const bad = { ...observed(FERN, "height", 3, 32, K1_SEED), id: "0".repeat(64) };
    const good = observed(FERN, "height", 4, 33, K1_SEED);
    const [a, b] = await Promise.allSettled([gw.append([bad]), gw.append([good])]);
    expect([a.status, b.status]).toEqual(["rejected", "fulfilled"]);
    expect(gw.reactor.get(good.id)).toBeDefined();
  });
});
