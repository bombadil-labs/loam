// Who may hand a pool a local-control erasure order (the channel-event erasures). A pool admits one
// only when a container above it holds that very order, or when its NEAREST parent holds a binding
// local-control erasure of the target and re-signed the order naming the pool as its receiver. A
// re-signed order from further up does not reach past the parent. The chain is the verified chain
// above the pool, nearest first (Store.chainAbove, railed in store.test.ts); these cases hand the
// rule real signed deltas in real reactors.

import { Reactor, type Delta } from "@bombadil/rhizomatic";
import { describe, expect, it } from "vitest";
import { localOrderAuthorized } from "../../src/gateway/erase.js";
import { eraseClaims, LOCAL_CONTROL, orderForPool } from "../../src/gateway/erase-law.js";
import { seedSigner, type Signer } from "../../src/gateway/signer.js";
import { FERN, observed } from "../spike/garden.js";

const GRANDPARENT = seedSigner("a1".repeat(32));
const PARENT = seedSigner("a2".repeat(32));
const POOL = seedSigner("a3".repeat(32));
const OTHER = seedSigner("a4".repeat(32));
const TARGET = observed(FERN, "height", 5, 1000, "a5".repeat(32));

// A container's own local-control erasure of TARGET, in the shape the channel-event erase mints.
const localErasure = (by: Signer): Delta => {
  const claims = eraseClaims(TARGET.id, TARGET.claims.author, by.author, 10_000);
  const primitive = (role: string, value: string | number) => ({
    role,
    target: { kind: "primitive" as const, value },
  });
  return by.sign({
    ...claims,
    pointers: [
      ...claims.pointers,
      {
        role: "local-control",
        target: { kind: "entity", entity: { id: TARGET.id, context: LOCAL_CONTROL } },
      },
      primitive("local-control-version", 1),
      primitive("local-control-kind", "erase"),
      primitive("local-control-channel", "channel:x"),
    ],
  });
};
const reSigned = (by: Signer, erasure: Delta, receiver: Signer): Delta =>
  orderForPool({ operatorAuthor: by.author, signer: by }, erasure, {
    operatorAuthor: receiver.author,
  });
const ground = (by: Signer, held: readonly Delta[]) => {
  const reactor = new Reactor();
  for (const d of held) expect(reactor.ingest(d).status).not.toBe("rejected");
  return { reactor, operatorAuthor: by.author };
};

describe("local-control orders a pool admits", () => {
  it("the nearest parent's re-signed order, when the parent holds the erasure", () => {
    const order = reSigned(PARENT, localErasure(PARENT), POOL);
    const chain = [ground(PARENT, [localErasure(PARENT)]), ground(GRANDPARENT, [])];
    expect(localOrderAuthorized(chain, order, POOL.author, TARGET.id)).toBe(true);
  });

  it("not a grandparent's re-signed order that skips the parent", () => {
    const order = reSigned(GRANDPARENT, localErasure(GRANDPARENT), POOL);
    const chain = [ground(PARENT, []), ground(GRANDPARENT, [localErasure(GRANDPARENT)])];
    expect(localOrderAuthorized(chain, order, POOL.author, TARGET.id)).toBe(false);
  });

  it("the very order, held by any container above", () => {
    const order = reSigned(GRANDPARENT, localErasure(GRANDPARENT), POOL);
    const chain = [ground(PARENT, []), ground(GRANDPARENT, [order])];
    expect(localOrderAuthorized(chain, order, POOL.author, TARGET.id)).toBe(true);
  });

  it("not an order naming another receiver, and nothing without a chain", () => {
    const order = reSigned(PARENT, localErasure(PARENT), OTHER);
    const chain = [ground(PARENT, [localErasure(PARENT)])];
    expect(localOrderAuthorized(chain, order, POOL.author, TARGET.id)).toBe(false);
    const own = reSigned(PARENT, localErasure(PARENT), POOL);
    expect(localOrderAuthorized([], own, POOL.author, TARGET.id)).toBe(false);
  });
});
