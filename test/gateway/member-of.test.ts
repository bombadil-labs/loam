// A membership that names a user (`loam.memberOf`, step 5 PR 3f): PRESENT authority only. It selects
// what the user's current root, and the keys that root delegates to for exactly the named scope,
// wrote; never a key a recovery retired. Asked at the delta level (what `select` returns) and live
// (what a `watch` pushes when the host's users move). What an earlier key wrote before a recovery
// is NOT a member yet: that is ruling 8's M1, and its cross-store cut is an open decision. The
// "known gap" cases below pin today's answer so the change is visible when it comes.

import { afterEach, describe, expect, it } from "vitest";
import { appendWithHostCut } from "../helpers/recovery-cut.js";
import {
  authorForSeed,
  parseTerm,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { authoredBy } from "../../src/gateway/membership.js";
import {
  hasMemberOf,
  lowerMembershipJson,
  membershipForValidation,
  writtenByUser,
} from "../../src/gateway/member-of.js";
import { delegationClaims } from "../../src/gateway/principal.js";
import { freezeAgreement } from "../../src/gateway/slate.js";
import { lineageClaims, recoveryClaims } from "../../src/gateway/user-root.js";
import { rootClaims, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const seed = (h: string) => h.repeat(32);
const [K1_SEED, K2_SEED, B_SEED, CONN_SEED, D_SEED] = ["a7", "a8", "ab", "ac", "ad"].map(seed) as [
  string,
  string,
  string,
  string,
  string,
];
const [K1, K2, B, CONN, D] = [K1_SEED, K2_SEED, B_SEED, CONN_SEED, D_SEED].map(authorForSeed) as [
  string,
  string,
  string,
  string,
  string,
];
const SCOPE = "inbox:test";
const op = (claims: Claims): Delta => signClaims(claims, OP_SEED);

const open: Gateway[] = [];
afterEach(async () => {
  for (const gw of open.splice(0)) await gw.close();
});

async function store(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  open.push(gw);
  return gw;
}

// ada (root K1) and bea (key B), both with write standing; each has written one value.
async function world(): Promise<{ gw: Gateway; byK1: Delta; byB: Delta }> {
  const gw = await store();
  await gw.append([
    op(userClaims("ada", OP, 10)),
    op(rootClaims("ada", K1, OP, 10)),
    op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, 11)),
    op(grantClaims(STORE_ENTITY, B, "write", OP, 12)),
  ]);
  const byK1 = observed(FERN, "height", 1, 20, K1_SEED);
  const byB = observed(FERN, "height", 2, 21, B_SEED);
  await gw.append([byK1, byB]);
  return { gw, byK1, byB };
}
const members = (gw: Gateway) => new Set(gw.select(writtenByUser("ada", SCOPE)).map((d) => d.id));

async function recoverToK2(gw: Gateway, t: number): Promise<void> {
  const record = op(
    recoveryClaims({ name: "ada", attempt: "x", previous: K1, root: K2, retired: [K1] }, OP, t),
  );
  await appendWithHostCut(gw, OP_SEED, [
    record,
    op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, t)),
    op(rootClaims("ada", K2, OP, t)),
  ]);
}

describe("the node's shape is validated; its user's state is not", () => {
  it("a container naming a user with no root is a well-formed declaration", async () => {
    const gw = await store();
    await gw.append([op(userClaims("cy", OP, 10))]);
    await gw.append([
      op(
        containerClaims(
          {
            container: "home:cy",
            trust: "curated",
            posture: "shared",
            membership: writtenByUser("cy", SCOPE),
          },
          OP,
          20,
        ),
      ),
    ]);
    expect(gw.containers().containers.has("home:cy")).toBe(true);
    expect(gw.select(writtenByUser("cy", SCOPE))).toEqual([]);
  });

  it("a malformed node is refused at the door, and by validation", async () => {
    const gw = await store();
    const bad = [
      { op: "select", pred: { "loam.memberOf": { user: "ada" } }, in: "input" },
      {
        op: "select",
        pred: { "loam.memberOf": { user: "ada", scope: SCOPE, extra: 1 } },
        in: "input",
      },
      {
        op: "select",
        pred: { "loam.memberOf": { user: "ada", scope: SCOPE }, match: {} },
        in: "input",
      },
    ];
    for (const membership of bad) {
      expect(() => membershipForValidation(membership)).toThrow(/loam.memberOf/);
      await expect(
        gw.append([
          op(
            containerClaims(
              { container: "home:x", trust: "curated", posture: "shared", membership },
              OP,
              30,
            ),
          ),
        ]),
      ).rejects.toThrow(/membership/);
    }
  });

  it("the node's user is held to the user-name rule; a well-formed name with no user is still valid", () => {
    for (const user of ["Ada", ".ada", "ada/x", ""]) {
      expect(() => membershipForValidation(writtenByUser(user, SCOPE))).toThrow(/user name/);
    }
    expect(() => membershipForValidation(writtenByUser("zed", SCOPE))).not.toThrow();
  });

  it("the text loam.memberOf as a value is ordinary data, not the node (a control)", async () => {
    const { gw } = await world();
    const literal = {
      op: "select",
      pred: { match: { field: "author", cmp: "eq", const: "loam.memberOf" } },
      in: "input",
    };
    expect(hasMemberOf(literal)).toBe(false);
    expect(hasMemberOf(writtenByUser("ada", SCOPE))).toBe(true);
    expect(freezeAgreement(gw.reactor, literal, "any") ?? "").not.toMatch(/cannot freeze/);
  });

  it("a key-named membership lowers to itself (a control)", () => {
    const m = authoredBy(K1);
    expect(lowerMembershipJson(m, undefined as never, 0, OP, new Set())).toEqual(m);
  });
});

describe("present authority: the current root", () => {
  it("before recovery, K1's value is a member and bea's is not", async () => {
    const { gw, byK1, byB } = await world();
    const m = members(gw);
    expect([m.has(byK1.id), m.has(byB.id)]).toEqual([true, false]);
  });

  it("after recovery, K2's new value is a member; K1's and bea's are not (K1's older value: the known M1 gap)", async () => {
    const { gw, byK1, byB } = await world();
    await recoverToK2(gw, 30);
    const byK2 = observed(FERN, "height", 3, 40, K2_SEED);
    await gw.append([byK2]);
    const m = members(gw);
    expect(m.has(byK2.id)).toBe(true);
    // KNOWN GAP (ruling 8, M1): K1 wrote this before the recovery. History is not in this node yet.
    expect(m.has(byK1.id)).toBe(false);
    expect(m.has(byB.id)).toBe(false);
  });

  it("a NEW K1-signed value arriving after recovery is not a member", async () => {
    const { gw } = await world();
    await recoverToK2(gw, 30);
    const late = observed(FERN, "height", 9, 25, K1_SEED); // backdated
    await gw.federate([late]);
    expect(members(gw).has(late.id)).toBe(false);
  });

  it("a broken recovery history selects no one", async () => {
    const { gw } = await world();
    await recoverToK2(gw, 30);
    await gw.append([
      op(recoveryClaims({ name: "ada", attempt: "rival", root: B, retired: [] }, OP, 31)),
    ]);
    expect(gw.select(writtenByUser("ada", SCOPE))).toEqual([]);
  });
});

describe("present authority: delegates for exactly the scope", () => {
  async function pool(host: Gateway): Promise<Gateway> {
    const p = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
    open.push(p);
    p.readUsersFrom(host);
    p.honorDelegationsAt(SCOPE);
    await p.append([op(grantClaims(STORE_ENTITY, "user:ada", "admin", OP, 40))]);
    return p;
  }

  it("the root's scoped delegate is a member; another scope's delegate is not; a retired root's delegate is not", async () => {
    const { gw: host } = await world();
    const p = await pool(host);
    await p.federate([
      signClaims(delegationClaims(K1, D, SCOPE, 41), K1_SEED),
      signClaims(delegationClaims(K1, CONN, "inbox:other", 42), K1_SEED),
    ]);
    const byD = observed(FERN, "height", 5, 43, D_SEED);
    const byConn = observed(FERN, "height", 6, 44, CONN_SEED);
    await p.federate([byD, byConn]);
    let m = new Set(p.select(writtenByUser("ada", SCOPE)).map((d) => d.id));
    expect([m.has(byD.id), m.has(byConn.id)]).toEqual([true, false]);
    // After recovery K1 is retired, and so is what it delegated: D's write is no longer a member.
    await recoverToK2(host, 50);
    m = new Set(p.select(writtenByUser("ada", SCOPE)).map((d) => d.id));
    expect(m.has(byD.id)).toBe(false);
  });

  it("the new root's delegation to the retired key gives it no membership", async () => {
    const { gw: host } = await world();
    const p = await pool(host);
    await recoverToK2(host, 50);
    await p.federate([signClaims(delegationClaims(K2, K1, SCOPE, 51), K2_SEED)]);
    const late = observed(FERN, "height", 9, 52, K1_SEED);
    await p.federate([late]);
    expect(new Set(p.select(writtenByUser("ada", SCOPE)).map((d) => d.id)).has(late.id)).toBe(
      false,
    );
  });

  it("an open watch in a pool moves when the host re-points the user, with no pool write", async () => {
    const { gw: host } = await world();
    const p = await pool(host);
    const byK1 = observed(FERN, "height", 7, 45, K1_SEED);
    const byK2 = observed(FERN, "height", 8, 46, K2_SEED);
    await p.federate([byK1, byK2]);
    const watch = p.watch(writtenByUser("ada", SCOPE));
    const ids = (v: unknown) => new Set((v as Delta[]).map((d) => d.id));
    const first = ids((await watch.next()).value);
    expect([first.has(byK1.id), first.has(byK2.id)]).toEqual([true, false]);
    const size = p.reactor.size;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = Promise.race([
      watch.next().then((r) => r.value as Delta[]),
      new Promise<"no frame">((resolve) => {
        timer = setTimeout(() => resolve("no frame"), 2_000);
      }),
    ]);
    await host.append([op(rootClaims("ada", K2, OP, 60))]);
    const frame = await next;
    clearTimeout(timer);
    expect(frame).not.toBe("no frame");
    const now = ids(frame);
    expect([now.has(byK1.id), now.has(byK2.id)]).toEqual([false, true]);
    expect(p.reactor.size).toBe(size);
    await watch.return(undefined);
  });
});

describe("where the node is refused rather than lowered", () => {
  it("a slate cannot freeze a membership that follows a user's keys", async () => {
    const { gw } = await world();
    expect(freezeAgreement(gw.reactor, writtenByUser("ada", SCOPE), "any")).toMatch(
      /cannot freeze a membership that follows a user's keys/,
    );
  });

  it("the substrate parser rejects the node, so no hyperschema body can carry it", () => {
    expect(() =>
      parseTerm({ op: "group", key: "byTargetContext", in: writtenByUser("ada", SCOPE) }),
    ).toThrow();
  });
});
