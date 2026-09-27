// Step 5 (SPEC-14) through Loam's principal seam, README ruling 6: a delegated key WRITES for its
// user and does nothing else; its delegation is scoped, cannot be passed on, and can be revoked by
// the user's root and by the pinned operator. Evidence records are built literally (rhizomatic
// exports no builder) and appended through a real Gateway. Every case asks two levels: the seam
// (`keyActsFor` / `keysActingFor` / `keysEverOf` over the reactor) and the door — an append signed
// by the key is admitted or refused — or, for history, what a Plant view shows after a clear.
//
// Named gaps:
//   - The door is driven through `Gateway.append`, not over HTTP; the HTTP door calls the same
//     `authorize`, and no later PR changes that.
//   - Delegations here are written by hand into a ground that declares the store scope. The
//     connection path (bind, inbox-name scope, revoke) is test/gateway/connection-delegation.test.ts.
//   - A delegate's writes are not "yours" to clear: `keysEverOf` follows association (bindings),
//     not authority (delegations). Provisioning will sign a binding beside each delegation.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  computeId,
  makeNegationClaims,
  signClaims,
  type Delta,
  type Pointer,
} from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { keyActsFor, keysActingFor, keysEverOf } from "../../src/gateway/principal.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const seedOf = (b: string) => b.repeat(32);
const OP_SEED = seedOf("0a");
const R_SEED = seedOf("1b"); // the user's root
const C_SEED = seedOf("2c"); // a connection key
const D_SEED = seedOf("3d"); // a key C tries to pass its delegation on to
const K_SEED = seedOf("4e"); // the user's old key (history)
const X_SEED = seedOf("5f"); // a bystander with no delegation
const OP = authorForSeed(OP_SEED);
const R = authorForSeed(R_SEED);
const C = authorForSeed(C_SEED);
const D = authorForSeed(D_SEED);
const K = authorForSeed(K_SEED);
const X = authorForSeed(X_SEED);

const T0 = 1_000_000;
const T1 = 2_000_000;
const T2 = 3_000_000;

afterEach(() => {
  vi.useRealTimers();
});

const prim = (role: string, value: string | boolean): Pointer => ({
  role,
  target: { kind: "primitive", value },
});

/** A SPEC-14 §2 evidence record: one `principal` pointer at R, one `kind`, the listed roles. */
function evidence(
  seed: string,
  kind: "binding" | "delegation",
  extra: readonly Pointer[],
  t: number,
  window: { validFrom?: number; validUntil?: number } = {},
): Delta {
  return signClaims(
    {
      timestamp: t,
      validFrom: t,
      ...window,
      author: authorForSeed(seed),
      pointers: [
        {
          role: "principal",
          target: { kind: "entity", entity: { id: R, context: "rhizomatic.principal" } },
        },
        prim("kind", kind),
        ...extra,
      ],
    },
    seed,
  );
}

const delegation = (
  seed: string,
  key: string,
  scope: string,
  delegable: boolean,
  t: number,
  window: { validFrom?: number; validUntil?: number } = {},
): Delta =>
  evidence(
    seed,
    "delegation",
    [prim("key", key), prim("scope", scope), prim("delegable", delegable)],
    t,
    window,
  );

const binding = (key: string, t: number): Delta =>
  evidence(R_SEED, "binding", [prim("key", key)], t);

const negation = (seed: string, target: Delta, t: number): Delta =>
  signClaims(makeNegationClaims(authorForSeed(seed), t, target.id), seed);

let noteCount = 0;
const note = (seed: string, t: number): Delta =>
  signClaims(
    {
      timestamp: t,
      validFrom: t,
      author: authorForSeed(seed),
      pointers: [
        { role: "note", target: { kind: "entity", entity: { id: "note:p", context: "n" } } },
        prim("text", `note ${noteCount++}`),
      ],
    },
    seed,
  );

/** A governed store at T0: the operator grants R (named by root) `verb` standing. */
async function store(verb: "write" | "admin" = "write", others: readonly string[] = []) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  const gw = await ground(verb, others);
  // These cases are about a delegation's SHAPE, so the ground declares the store scope they ask
  // at. Only an inbox pool declares one in production; see "a ground that declares no scope".
  gw.honorDelegationsAt(STORE_ENTITY);
  return gw;
}

/** The same ground with no declared scope, as the root store boots. */
async function ground(verb: "write" | "admin" = "write", others: readonly string[] = []) {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
      grants: [
        grantClaims(STORE_ENTITY, R, verb, OP, 1),
        ...others.map((who, i) => grantClaims(STORE_ENTITY, who, "write", OP, i + 2)),
      ],
    }),
  );
}

const at = (t: number) => vi.setSystemTime(t);

async function door(gw: Gateway, d: Delta): Promise<"admitted" | "refused"> {
  try {
    await gw.append([d]);
    return "admitted";
  } catch {
    return "refused";
  }
}

const acts = (gw: Gateway, key: string, scope: string = STORE_ENTITY) =>
  keyActsFor(gw.reactor, gw.validityNow(), { root: R }, key, scope, gw.operatorAuthor);

describe("a ground that declares no scope honors no delegate", () => {
  it("the root store's door refuses a delegate the same record would admit in a declaring ground", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const root = await ground();
    at(T0 + 10);
    await root.append([delegation(R_SEED, C, STORE_ENTITY, false, T0 + 10)]);
    at(T0 + 20);
    expect(await door(root, note(C_SEED, T0 + 20))).toBe("refused");
    expect(await door(root, note(R_SEED, T0 + 21))).toBe("admitted");
    // Control: the same record in a ground that declares the scope admits C.
    root.honorDelegationsAt(STORE_ENTITY);
    expect(await door(root, note(C_SEED, T0 + 22))).toBe("admitted");
  });
});

describe("a delegated key writes for its user, within its scope", () => {
  it("a store-scoped delegation admits C's write; the root, not a bystander, stands beside it", async () => {
    const gw = await store();
    at(T0 + 10);
    expect(await door(gw, note(C_SEED, T0 + 10))).toBe("refused");
    expect(await door(gw, delegation(R_SEED, C, STORE_ENTITY, false, T0 + 10))).toBe("admitted");
    at(T0 + 20);
    expect(acts(gw, C)).toBe(true);
    expect(await door(gw, note(C_SEED, T0 + 20))).toBe("admitted");
    expect(await door(gw, note(R_SEED, T0 + 21))).toBe("admitted");
    expect(acts(gw, X)).toBe(false);
    expect(await door(gw, note(X_SEED, T0 + 22))).toBe("refused");
    expect(
      [...keysActingFor(gw.reactor, gw.validityNow(), { root: R }, STORE_ENTITY, OP)].sort(),
    ).toEqual([R, C].sort());
  });

  it("the scope is exact: a child, a sibling, and the universal request all miss", async () => {
    const gw = await store();
    at(T0 + 10);
    await gw.append([delegation(R_SEED, C, "loam:store:ada", false, T0 + 10)]);
    at(T0 + 20);
    expect(acts(gw, C, "loam:store:ada")).toBe(true);
    expect(acts(gw, C, "loam:store:ada:notes")).toBe(false);
    expect(acts(gw, C, "loam:store:adam")).toBe(false);
    expect(acts(gw, C, "*")).toBe(false);
    expect(acts(gw, C)).toBe(false);
    expect(await door(gw, note(C_SEED, T0 + 20))).toBe("refused");
  });

  it("a delegation valid over [T1, T2) admits C exactly inside the window", async () => {
    const gw = await store();
    at(T0 + 10);
    await gw.append([
      delegation(R_SEED, C, STORE_ENTITY, false, T0 + 10, { validFrom: T1, validUntil: T2 }),
    ]);
    const outcomes: Record<string, string> = {};
    for (const [label, t] of [
      ["before", T1 - 1],
      ["opens", T1],
      ["last", T2 - 1],
      ["closes", T2],
    ] as const) {
      at(t);
      outcomes[label] = `${acts(gw, C)}/${await door(gw, note(C_SEED, t))}`;
    }
    expect(outcomes).toEqual({
      before: "false/refused",
      opens: "true/admitted",
      last: "true/admitted",
      closes: "false/refused",
    });
  });
});

describe("Loam honors one delegation shape: sealed, scoped, direct", () => {
  it("a delegable delegation is honored for no one: neither C nor the key C passes it to", async () => {
    const gw = await store();
    at(T0 + 10);
    await gw.append([delegation(R_SEED, C, STORE_ENTITY, true, T0 + 10)]);
    // C is not honored, so its record for D cannot pass the door; it arrives raw, as by federation.
    expect(gw.reactor.ingest(delegation(C_SEED, D, STORE_ENTITY, false, T0 + 11)).status).toBe(
      "accepted",
    );
    at(T0 + 20);
    expect(acts(gw, C)).toBe(false);
    expect(acts(gw, D)).toBe(false);
    expect(await door(gw, note(C_SEED, T0 + 20))).toBe("refused");
    expect(await door(gw, note(D_SEED, T0 + 21))).toBe("refused");
    // Control: a sealed delegation from R to D does reach D.
    at(T0 + 30);
    await gw.append([delegation(R_SEED, D, STORE_ENTITY, false, T0 + 30)]);
    at(T0 + 40);
    expect(await door(gw, note(D_SEED, T0 + 40))).toBe("admitted");
  });

  it("a `*`-scoped delegation is honored nowhere, and a `*` request answers the root alone", async () => {
    const gw = await store();
    at(T0 + 10);
    await gw.append([delegation(R_SEED, C, "*", false, T0 + 10)]);
    at(T0 + 20);
    expect(acts(gw, C)).toBe(false);
    expect(acts(gw, C, "*")).toBe(false);
    expect(await door(gw, note(C_SEED, T0 + 20))).toBe("refused");
    expect([...keysActingFor(gw.reactor, gw.validityNow(), { root: R }, "*", OP)]).toEqual([R]);
  });

  it("a write grant to a subject that is not a key breaks no one else's write", async () => {
    const gw = await store("write", ["ed25519:not-a-key", X]);
    at(T0 + 10);
    expect(await door(gw, note(X_SEED, T0 + 10))).toBe("admitted");
    expect(await door(gw, note(C_SEED, T0 + 11))).toBe("refused");
  });
});

describe("a delegated key writes and does nothing else", () => {
  it("C acting for an admin R cannot mint a grant; R itself can", async () => {
    const gw = await store("admin");
    at(T0 + 10);
    await gw.append([delegation(R_SEED, C, STORE_ENTITY, false, T0 + 10)]);
    at(T0 + 20);
    // R's admin covers write, so C writes for R.
    expect(await door(gw, note(C_SEED, T0 + 20))).toBe("admitted");
    // Any writer may ASSERT a grant; it binds only if its issuer is an effective admin, and that
    // issuer check matches R's own key only. So C's grant lands and gives X nothing.
    expect(
      await door(gw, signClaims(grantClaims(STORE_ENTITY, X, "write", C, T0 + 21), C_SEED)),
    ).toBe("admitted");
    at(T0 + 30);
    expect(await door(gw, note(X_SEED, T0 + 30))).toBe("refused");
    // Control: the same grant signed by R is admitted, and X then writes.
    expect(
      await door(gw, signClaims(grantClaims(STORE_ENTITY, X, "write", R, T0 + 31), R_SEED)),
    ).toBe("admitted");
    at(T0 + 40);
    expect(await door(gw, note(X_SEED, T0 + 40))).toBe("admitted");
  });
});

describe("a delegation is revocable by the root and by the operator", () => {
  async function delegated() {
    const gw = await store("write", [X]);
    at(T0 + 10);
    const toC = delegation(R_SEED, C, STORE_ENTITY, false, T0 + 10);
    await gw.append([toC]);
    at(T0 + 20);
    expect(await door(gw, note(C_SEED, T0 + 20))).toBe("admitted");
    return { gw, toC };
  }

  it("R's negation revokes C; C's counter-negation does not restore it; R's own does", async () => {
    const { gw, toC } = await delegated();
    at(T0 + 30);
    const revoke = negation(R_SEED, toC, T0 + 30);
    await gw.append([revoke]);
    at(T0 + 40);
    expect(acts(gw, C)).toBe(false);
    expect(await door(gw, note(C_SEED, T0 + 40))).toBe("refused");
    // C is refused at the door, so its counter-negation arrives raw, as a federated delta would.
    at(T0 + 50);
    const counter = negation(C_SEED, revoke, T0 + 50);
    expect(gw.reactor.ingest(counter).status).toBe("accepted");
    at(T0 + 60);
    expect(acts(gw, C)).toBe(false);
    expect(await door(gw, note(C_SEED, T0 + 60))).toBe("refused");
    at(T0 + 70);
    await gw.append([negation(R_SEED, revoke, T0 + 70)]);
    at(T0 + 80);
    expect(acts(gw, C)).toBe(true);
    expect(await door(gw, note(C_SEED, T0 + 80))).toBe("admitted");
  });

  it("the pinned operator's negation revokes C", async () => {
    const { gw, toC } = await delegated();
    at(T0 + 30);
    await gw.append([negation(OP_SEED, toC, T0 + 30)]);
    at(T0 + 40);
    expect(acts(gw, C)).toBe(false);
    expect(await door(gw, note(C_SEED, T0 + 40))).toBe("refused");
    expect(await door(gw, note(R_SEED, T0 + 41))).toBe("admitted");
  });

  it("the operator's revocation strikes one record: a NEW delegation from R stands", async () => {
    // Ruling 6 as stated: revocation ends a delegation, not the key. Barring the key for good is
    // the operator revoking R's own standing, which ends every delegate with it.
    const { gw, toC } = await delegated();
    at(T0 + 30);
    await gw.append([negation(OP_SEED, toC, T0 + 30)]);
    at(T0 + 40);
    expect(acts(gw, C)).toBe(false);
    await gw.append([delegation(R_SEED, C, STORE_ENTITY, false, T0 + 40)]);
    at(T0 + 50);
    expect(acts(gw, C)).toBe(true);
    expect(await door(gw, note(C_SEED, T0 + 50))).toBe("admitted");
  });

  it("the operator cannot undo R's revocation; it can undo its own", async () => {
    const { gw, toC } = await delegated();
    at(T0 + 30);
    const byRoot = negation(R_SEED, toC, T0 + 30);
    await gw.append([byRoot]);
    at(T0 + 40);
    await gw.append([negation(OP_SEED, byRoot, T0 + 40)]);
    at(T0 + 50);
    expect(acts(gw, C)).toBe(false);
    expect(await door(gw, note(C_SEED, T0 + 50))).toBe("refused");
    // Control: the operator's own revocation of a second delegate, struck by the operator, lifts.
    const toD = delegation(R_SEED, D, STORE_ENTITY, false, T0 + 60);
    at(T0 + 60);
    await gw.append([toD]);
    at(T0 + 70);
    const byOperator = negation(OP_SEED, toD, T0 + 70);
    await gw.append([byOperator]);
    at(T0 + 80);
    expect(acts(gw, D)).toBe(false);
    await gw.append([negation(OP_SEED, byOperator, T0 + 80)]);
    at(T0 + 90);
    expect(acts(gw, D)).toBe(true);
    expect(await door(gw, note(D_SEED, T0 + 90))).toBe("admitted");
  });

  it("a revocation with its own end restores C when it expires (ruling 1)", async () => {
    const { gw, toC } = await delegated();
    at(T0 + 30);
    const timed = signClaims({ ...makeNegationClaims(R, T0 + 30, toC.id), validUntil: T1 }, R_SEED);
    await gw.append([timed]);
    at(T1 - 1);
    expect(acts(gw, C)).toBe(false);
    expect(await door(gw, note(C_SEED, T1 - 1))).toBe("refused");
    at(T1);
    expect(acts(gw, C)).toBe(true);
    expect(await door(gw, note(C_SEED, T1))).toBe("admitted");
  });

  it("an UNSIGNED negation naming the operator revokes nothing", async () => {
    const { gw, toC } = await delegated();
    at(T0 + 30);
    // Unsigned deltas are legal at L1, so one can arrive raw; its author claim proves nothing.
    const signed = negation(OP_SEED, toC, T0 + 30);
    const unsigned: Delta = { id: signed.id, claims: signed.claims };
    expect(gw.reactor.ingest(unsigned).status).toBe("accepted");
    at(T0 + 40);
    expect(gw.reactor.negationsOf(toC.id)).toHaveLength(1);
    expect(acts(gw, C)).toBe(true);
    expect(await door(gw, note(C_SEED, T0 + 40))).toBe("admitted");
  });

  it("a checked negation rewritten in place, claims and id together, is verified afresh", async () => {
    const { gw, toC } = await delegated();
    at(T0 + 30);
    const revoke = negation(R_SEED, toC, T0 + 30);
    const counter = negation(R_SEED, revoke, T0 + 31);
    await gw.append([revoke, counter]);
    at(T0 + 40);
    expect(acts(gw, C)).toBe(true); // R's counter is read, its signature checked, and it lifts
    // The held counter changes in place: new claims, a matching id, the old signature.
    const held = gw.reactor.get(counter.id)! as { id: string; claims: Delta["claims"] };
    held.claims = { ...held.claims, timestamp: held.claims.timestamp + 1 };
    held.id = computeId(held.claims);
    expect(acts(gw, C)).toBe(false);
    expect(await door(gw, note(C_SEED, T0 + 41))).toBe("refused");
  });

  it("a bystander's negation revokes nothing, even one who holds write standing", async () => {
    const { gw, toC } = await delegated();
    at(T0 + 30);
    expect(await door(gw, negation(X_SEED, toC, T0 + 30))).toBe("admitted");
    at(T0 + 40);
    expect(gw.reactor.negationsOf(toC.id)).toHaveLength(1);
    expect(acts(gw, C)).toBe(true);
    expect(await door(gw, note(C_SEED, T0 + 40))).toBe("admitted");
  });
});

describe("history: keysEverOf", () => {
  const tags = (gw: Gateway) => gw.resolvedNode("Plant", FERN).view["tag"] ?? null;

  async function oldKeyWrote(): Promise<Gateway> {
    const gw = await store("write", [K]); // K was the user's key before R, and held its own grant
    at(T0 + 10);
    await gw.gqlHooks().mutate("Plant", FERN, { tag: "by-old-key" }, K_SEED);
    return gw;
  }

  it("without a binding, R cannot clear what K wrote", async () => {
    const gw = await oldKeyWrote();
    expect([...keysEverOf(gw.reactor, gw.validityNow(), { root: R })]).toEqual([R]);
    at(T0 + 20);
    await gw.gqlHooks().clear("Plant", FERN, ["tag"], R_SEED);
    expect(tags(gw)).toEqual(["by-old-key"]);
  });

  it("R's binding for K makes K history, not authority, and R clears K's value", async () => {
    const gw = await oldKeyWrote();
    at(T0 + 20);
    expect(await door(gw, binding(K, T0 + 20))).toBe("admitted");
    at(T0 + 30);
    expect([...keysEverOf(gw.reactor, gw.validityNow(), { root: R })].sort()).toEqual(
      [R, K].sort(),
    );
    // A binding grants no authority (SPEC-14 §2).
    expect(acts(gw, K)).toBe(false);
    await gw.gqlHooks().clear("Plant", FERN, ["tag"], R_SEED);
    expect(tags(gw)).toBeNull();
  });

  it("a negated binding stays in history", async () => {
    const gw = await oldKeyWrote();
    at(T0 + 20);
    const bind = binding(K, T0 + 20);
    await gw.append([bind]);
    at(T0 + 30);
    await gw.append([negation(R_SEED, bind, T0 + 30)]);
    at(T0 + 40);
    expect(keysEverOf(gw.reactor, gw.validityNow(), { root: R }).has(K)).toBe(true);
    await gw.gqlHooks().clear("Plant", FERN, ["tag"], R_SEED);
    expect(tags(gw)).toBeNull();
  });
});
