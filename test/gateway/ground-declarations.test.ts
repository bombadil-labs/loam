// A ground's declarations hold across a reseat: the user ground and what a door read withholds.
// The Gateway seats one record on each reactor it sets (ground-declarations.ts). A reseat that left
// it behind would read users from the bare reactor, and would count erased, held grants again.
//
// Each case holds an erased delta ACROSS the reseat. An order admitted through a door takes its
// target out of the admitted set, so a reseat would drop the bytes and prove nothing. The order
// here lands by direct ingest, the way a derived emission lands: the journal keeps the target.
// Each case is two-sided: the erased delta stops counting, and a named bystander still counts.
//
// The other two declarations have their reseat rails elsewhere. The delegation scope:
// test/gateway/connection-delegation.test.ts ("the pool keeps its scope when its reactor is
// replaced"). The erasure pins: test/gateway/ground-revision.test.ts (the pin case) and the pool
// cases of test/gateway/erasure-fanout.test.ts.
//
// Named gap: the read-withheld case asks `dataStruck`, the one reader of that declaration. The
// door that consumes it is federation translation, which this file does not drive.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { dataStruck, grantClaims } from "../../src/gateway/accounts.js";
import { eraseClaims } from "../../src/gateway/erase-law.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { subjectKeyAt } from "../../src/gateway/user-root.js";
import { rootClaims, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5d".repeat(32);
const OP = authorForSeed(OP_SEED);
const K1_SEED = "a3".repeat(32);
const K1 = authorForSeed(K1_SEED);
const K2_SEED = "a4".repeat(32);
const K2 = authorForSeed(K2_SEED);
const X_SEED = "b5".repeat(32);
const X = authorForSeed(X_SEED);

const store = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

const op = (claims: Parameters<typeof signClaims>[0]) => signClaims(claims, OP_SEED);

async function door(gw: Gateway, d: Delta): Promise<"admitted" | "refused"> {
  try {
    await gw.append([d]);
    return "admitted";
  } catch {
    return "refused";
  }
}

/** Order `target` erased with no door: its bytes stay held, here and across a reseat. */
function orderHeld(gw: Gateway, target: Delta): void {
  const order = op(eraseClaims(target.id, target.claims.author, OP, 5000));
  expect(gw.reactor.ingest(order).status).toBe("accepted");
}

async function reseated(gw: Gateway): Promise<void> {
  const before = gw.reactor;
  await gw.reseat();
  expect(gw.reactor).not.toBe(before);
}

describe("a ground's declarations hold across a reseat", () => {
  it("the user ground: an erased, held root claim stays gone; the earlier root still writes", async () => {
    const gw = await store();
    await gw.append([
      op(userClaims("ada", OP, 10)),
      op(rootClaims("ada", K1, OP, 11)),
      op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, 12)),
    ]);
    const second = op(rootClaims("ada", K2, OP, 13));
    await gw.append([second]);
    const root = () => subjectKeyAt(gw.reactor, gw.validityNow(), OP, "user:ada");
    expect(root()).toBe(K2); // control: the later claim wins while it stands

    orderHeld(gw, second);
    expect(root()).toBe(K1);

    await reseated(gw);
    expect(gw.reactor.get(second.id)).toBeDefined(); // still held: only the declaration hides it
    expect(root()).toBe(K1);
    expect(await door(gw, observed(FERN, "height", 1, 6000, K1_SEED))).toBe("admitted");
    expect(await door(gw, observed(FERN, "height", 2, 6001, K2_SEED))).toBe("refused");
    await gw.close();
  });

  it("what a door read withholds: an erased, held grant makes no striker; the operator's strike still holds", async () => {
    const gw = await store();
    const grant = op(grantClaims(STORE_ENTITY, X, "write", OP, 10));
    const byWriter = observed(FERN, "height", 30, 1000, OP_SEED);
    const byOperator = observed(FERN, "tag", "shade", 1001, OP_SEED);
    await gw.append([grant, byWriter, byOperator]);
    await gw.append([
      signClaims(makeNegationClaims(X, 2000, byWriter.id), X_SEED),
      op(makeNegationClaims(OP, 2001, byOperator.id)),
    ]);
    const struck = (d: Delta) => dataStruck(gw.reactor, gw.validityNow(), OP)(d.id);
    expect(struck(byWriter)).toBe(true); // control: the granted key's strike binds
    expect(struck(byOperator)).toBe(true);

    orderHeld(gw, grant);
    expect(struck(byWriter)).toBe(false);

    await reseated(gw);
    expect(gw.reactor.get(grant.id)).toBeDefined(); // still held: only the declaration hides it
    expect(struck(byWriter)).toBe(false);
    expect(struck(byOperator)).toBe(true);
    await gw.close();
  });
});
