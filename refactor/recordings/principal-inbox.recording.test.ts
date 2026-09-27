// Records Loam's answers about a bound connection's inbox before step 5 moves a connection's
// standing onto the principal read. Today the connection key acts by one sealed delegation, held in
// its inbox pool's own ground; the parent container's read composes that pool through `inboxOf`.
//
// Cast: `writer` is ada, the owner of container `ada` (membership `authoredBy(writer)`). `subadmin`
// is her bound connection. `peer` is the key that replaces ada's first key in the slate case.
//
// Recorded:
// - `principal.inbox-boundary`: the owner's delegation carries a `validUntil` T. Before and after
//   T: the pool door's verdict on a write by the connection key, the parent reads (the bound
//   resolution and `containerScope`), the delegation's own state, and how many frames a live
//   `watch` over the root's container term and over the pool received when the clock crossed T
//   with nothing written. Neither term reads delegations, so those counts cannot show whether the
//   boundary timer fired; PR 3h's rail needs a term that does.
// - `principal.inbox-revoked`: after `revokeConnection`, the parent reads of the connection's
//   earlier write, the pool door, and who struck each delegation record in the pool.
// - `principal.clear-connection-writes`: the owner clears a field only her connection wrote,
//   unbound and bound. What each call answered, the parent reads, and the strikes in the pool.
// - `principal.slate-owner`: a slate over ada's writes, before and after her key is replaced by a
//   fresh write grant for `peer` (the present-day rotation), and whether `peer`'s write joins it.
//
// Deliberately not recorded: a slate cannot stand over the owner's container itself, because a
// slate's container must carry a frozen `membershipAt`/`version`; the slate case condemns ada's
// writes by id instead. GraphQL subscriptions (a bound context is refused, and the unbound one reads
// the root's materialization, which the root `watch` already covers). Restart and on-disk pools
// (see `connection-delegation.test.ts`). The owner's own writes to the parent after a revoke.

import { afterEach, describe, it, vi } from "vitest";
import { makeNegationClaims, type Claims, type Delta, type Schema } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import {
  containerClaims,
  inboxName,
  survivingWriteGrantIds,
  termClaims,
} from "../../src/gateway/container.js";
import { Gateway, type ConnectionBinding } from "../../src/gateway/gateway.js";
import { entityGatherBody } from "../../src/gateway/gather.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { delegationClaims, delegationStatesFor } from "../../src/gateway/principal.js";
import { frozenMembershipTerm, slateClaims } from "../../src/gateway/slate.js";
import { withStamp } from "../../src/gateway/stamp.js";
import { authoredBy } from "../../src/server/provision.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { KEY, nameOf, record, SEEDS, signed, type Who } from "./corpus.js";

const NOW = 1_000_000;

afterEach(() => {
  vi.useRealTimers();
});

const pickLatest = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } } as const;
const NOTE_SCHEMA: Schema = {
  props: new Map([["tag", { kind: "all", order: { kind: "byTimestamp", dir: "asc" } }]]),
  default: pickLatest,
};
const NOTE_REG = {
  hyperschema: { name: "Note", alg: 1, body: entityGatherBody() },
  schema: NOTE_SCHEMA,
  roots: ["note:ada"],
  writable: ["tag"],
};

const INBOX = inboxName("ada", KEY.subadmin);
const BINDING: ConnectionBinding = { container: "ada", inbox: INBOX };

const prim = (d: Delta, role: string): unknown => {
  const t = d.claims.pointers.find((p) => p.role === role)?.target;
  return t?.kind === "primitive" ? t.value : undefined;
};

// What a delta says, by signing key: `@who: value`, or its roles when it carries no value.
const said = (d: Delta): string => {
  const v = prim(d, "value") ?? prim(d, "text");
  return `${nameOf(d.claims.author)}: ${v === undefined ? d.claims.pointers.map((p) => p.role).join("+") : JSON.stringify(v)}`;
};

const note = (by: Who, t: number, text: string): Delta =>
  signed(
    {
      timestamp: t,
      validFrom: t,
      author: KEY[by],
      pointers: [
        { role: "note", target: { kind: "entity", entity: { id: "note:1", context: "n" } } },
        { role: "text", target: { kind: "primitive", value: text } },
      ],
    },
    by,
  );

const door = async (ground: Gateway, d: Delta): Promise<unknown> => {
  try {
    await ground.append([d]);
    return "admitted";
  } catch (err) {
    return { refused: nameOf(err instanceof Error ? err.message : String(err)) };
  }
};

const settle = async <T>(p: Promise<T>): Promise<unknown> => {
  try {
    return await p;
  } catch (err) {
    return { refused: nameOf(err instanceof Error ? err.message : String(err)) };
  }
};

// The clock is faked from boot; `tick` moves it one second, so every stamp is fixed.
function clock() {
  let at = NOW;
  vi.setSystemTime(at);
  return {
    tick: () => vi.setSystemTime((at += 1_000)),
    get at() {
      return at;
    },
  };
}

// A gateway whose operator is the store seed, ada holding write, her container declared.
async function bootAda(tick: () => void): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: SEEDS.operator,
      registrations: [NOTE_REG],
      grants: [grantClaims(STORE_ENTITY, KEY.writer, "write", KEY.operator, 2)],
    }),
  );
  tick();
  await gw.append([
    signed(
      withStamp(gw.stamp(KEY.operator), (t) =>
        containerClaims(
          {
            container: "ada",
            trust: "curated",
            posture: "shared",
            membership: authoredBy(KEY.writer),
          },
          KEY.operator,
          t,
        ),
      ),
      "operator",
    ),
  ]);
  return gw;
}

const delegationsIn = (pool: Gateway): Delta[] =>
  [...pool.reactor.snapshot()]
    .filter((d) => prim(d, "kind") === "delegation" && prim(d, "key") === KEY.subadmin)
    .sort((a, b) => a.claims.timestamp - b.claims.timestamp);

// Both reads of the parent: the bound resolution of `note:ada` and the composed container scope.
const attempt = (read: () => unknown): unknown => {
  try {
    return read();
  } catch (err) {
    return { refused: nameOf(err instanceof Error ? err.message : String(err)) };
  }
};
const resolveParent = (gw: Gateway) => ({
  boundTag: attempt(
    () => gw.resolvedNode("Note", "note:ada", undefined, undefined, BINDING).view["tag"] ?? null,
  ),
  unboundTag: gw.resolvedNode("Note", "note:ada").view["tag"] ?? null,
  containerScope: attempt(() =>
    gw
      .containerScope({ containers: ["ada"] })
      .filter((d) => d.claims.author === KEY.subadmin || d.claims.author === KEY.writer)
      .map(said)
      .sort(),
  ),
});

// Takes the next frame if one is already queued, else answers `none` after the event loop turns.
const pending = async (it: AsyncGenerator<Delta[], void, unknown>): Promise<Delta[] | "none"> => {
  const next = it.next().then((r) => (r.done === true ? "none" : r.value));
  const idle = new Promise<"none">((res) => setImmediate(() => res("none")));
  return Promise.race([next, idle]);
};

describe("recordings: a bound connection's inbox", () => {
  it("a delegation that ends: the door, the parent read, and the watchers at the boundary", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const c = clock();
    const gw = await bootAda(c.tick);
    c.tick();
    const handle = await gw.bindConnection({
      container: "ada",
      connectionKey: KEY.subadmin,
      ownerSeed: SEEDS.writer,
    });
    const pool = handle.gateway!;
    // The owner re-signs her delegation with an end, and strikes the open-ended one.
    const T = c.at + 10_000;
    c.tick();
    const [open] = delegationsIn(pool);
    await pool.append([
      signed(
        withStamp(pool.stamp(KEY.writer), (t) => ({
          ...delegationClaims(KEY.writer, KEY.subadmin, INBOX, t),
          validUntil: T,
        })),
        "writer",
        "ada's delegation until T",
      ),
    ]);
    c.tick();
    await pool.append([
      signed(
        withStamp(pool.stamp(KEY.writer), (t) => makeNegationClaims(KEY.writer, t, open!.id)),
        "writer",
      ),
    ]);
    c.tick();
    await gw
      .gqlHooks()
      .mutate("Note", "note:ada", { tag: "by-connection" }, SEEDS.subadmin, BINDING);
    c.tick();
    const states = () =>
      delegationStatesFor(
        pool.reactor,
        pool.validityNow(),
        [KEY.writer],
        KEY.subadmin,
        KEY.operator,
      );
    const before = {
      delegationStates: states(),
      parent: resolveParent(gw),
      poolDoor: await door(pool, note("subadmin", c.at, "connection's write before T")),
    };
    // Watchers over the root's container term and over the pool, then the clock crosses T.
    const rootWatch = gw.watch(authoredBy(KEY.writer));
    const poolWatch = pool.watch({
      op: "select",
      pred: { match: { field: "author", cmp: "eq", const: KEY.subadmin } },
      in: "input",
    });
    const rootInitial = await rootWatch.next();
    const poolInitial = await poolWatch.next();
    await vi.advanceTimersByTimeAsync(T - c.at + 1);
    const framesAtBoundary = { root: 0, pool: 0 };
    while ((await pending(rootWatch)) !== "none") framesAtBoundary.root++;
    while ((await pending(poolWatch)) !== "none") framesAtBoundary.pool++;
    const after = {
      delegationStates: states(),
      parent: resolveParent(gw),
      poolDoor: await door(pool, note("subadmin", Date.now(), "connection's write after T")),
    };
    await rootWatch.return();
    await poolWatch.return();
    await record("principal.inbox-boundary", {
      before,
      after,
      watch: {
        initialMembers: {
          root: (rootInitial.value as Delta[]).length,
          pool: (poolInitial.value as Delta[]).length,
        },
        framesAtBoundary,
      },
    });
    await gw.close();
  });

  it("a revoked connection: the parent read and the strikes in the pool", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const c = clock();
    const gw = await bootAda(c.tick);
    c.tick();
    const handle = await gw.bindConnection({
      container: "ada",
      connectionKey: KEY.subadmin,
      ownerSeed: SEEDS.writer,
    });
    const pool = handle.gateway!;
    c.tick();
    await gw
      .gqlHooks()
      .mutate("Note", "note:ada", { tag: "by-connection" }, SEEDS.subadmin, BINDING);
    c.tick();
    const beforeRevoke = resolveParent(gw);
    await gw.revokeConnection({
      inbox: handle,
      connectionKey: KEY.subadmin,
      ownerSeed: SEEDS.writer,
    });
    c.tick();
    await record("principal.inbox-revoked", {
      beforeRevoke,
      afterRevoke: resolveParent(gw),
      delegations: delegationsIn(pool).map((d) => ({
        author: d.claims.author,
        struckBy: pool.reactor.negationsOf(d.id).map((n) => pool.reactor.get(n)!.claims.author),
      })),
      delegationStates: delegationStatesFor(
        pool.reactor,
        pool.validityNow(),
        [KEY.writer],
        KEY.subadmin,
        KEY.operator,
      ),
      poolDoor: await door(pool, note("subadmin", c.at, "connection's write after revoke")),
    });
    await gw.close();
  });

  it("the owner clears a field only her connection wrote", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const c = clock();
    const gw = await bootAda(c.tick);
    c.tick();
    const handle = await gw.bindConnection({
      container: "ada",
      connectionKey: KEY.subadmin,
      ownerSeed: SEEDS.writer,
    });
    const pool = handle.gateway!;
    const hooks = gw.gqlHooks();
    c.tick();
    await hooks.mutate("Note", "note:ada", { tag: "by-connection" }, SEEDS.subadmin, BINDING);
    const write = [...pool.reactor.snapshot()].find(
      (d) => d.claims.author === KEY.subadmin && prim(d, "value") === "by-connection",
    )!;
    const strikesInPool = () =>
      pool.reactor.negationsOf(write.id).map((n) => pool.reactor.get(n)!.claims.author);
    const steps: Record<string, unknown> = {};
    c.tick();
    steps["the connection wrote"] = { ...resolveParent(gw), strikesInPool: strikesInPool() };
    const tagOf = (r: unknown) =>
      typeof r === "object" && r !== null && "view" in r
        ? ((r as { view: Record<string, unknown> }).view["tag"] ?? null)
        : r;
    const unbound = await settle(hooks.clear("Note", "note:ada", ["tag"], SEEDS.writer));
    c.tick();
    steps["the owner clears, unbound"] = {
      answered: tagOf(unbound),
      ...resolveParent(gw),
      strikesInPool: strikesInPool(),
    };
    const bound = await settle(hooks.clear("Note", "note:ada", ["tag"], SEEDS.writer, BINDING));
    c.tick();
    steps["the owner clears, bound"] = {
      answered: tagOf(bound),
      ...resolveParent(gw),
      strikesInPool: strikesInPool(),
    };
    await record("principal.clear-connection-writes", steps);
    await gw.close();
  });

  it("a slate over the owner's writes, across a key replacement", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const c = clock();
    const gw = await bootAda(c.tick);
    const byOperator = (claims: (t: number) => Claims, label?: string): Delta =>
      signed(withStamp(gw.stamp(KEY.operator), claims), "operator", label);
    c.tick();
    const first = [
      note("writer", c.at, "ada's first note"),
      note("writer", c.at + 1, "ada's second note"),
    ];
    await gw.append(first);
    c.tick();
    const term = frozenMembershipTerm(first.map((d) => d.id).sort());
    const published = byOperator((t) => termClaims(term, KEY.operator, t));
    await gw.append([published]);
    const version = gw.freeze(term).id;
    c.tick();
    await gw.append([
      byOperator((t) =>
        containerClaims(
          {
            container: "ada:condemned",
            trust: "curated",
            posture: "shared",
            membershipAt: published.id,
            version,
          },
          KEY.operator,
          t,
        ),
      ),
    ]);
    c.tick();
    await gw.append([
      byOperator((t) =>
        slateClaims(
          {
            container: "ada:condemned",
            membershipAt: published.id,
            version,
            requestedBy: "ada",
            requestedByForm: "plain",
            requestedAt: c.at,
            deadline: c.at + 1_000_000,
            closes: ["egress", "cite"],
          },
          KEY.operator,
          t,
        ),
      ),
    ]);
    c.tick();
    const byId = new Map(first.map((d) => [d.id, d]));
    const verdict = () =>
      gw.slates(Date.now()).map((s) => ({
        members: s.members.map((id) => (byId.has(id) ? said(byId.get(id)!) : id)),
        enforced: s.enforced,
        lapsed: s.lapsed,
        affected: s.affected,
        disagreement: s.disagreement ?? null,
        unresolved: s.unresolved ?? null,
      }));
    const before = verdict();
    // The rotation: the operator grants the new key write and strikes the first key's grant.
    const [firstGrant] = survivingWriteGrantIds(
      gw.reactor,
      gw.validityNow(),
      KEY.writer,
      KEY.operator,
    );
    await gw.append([
      byOperator((t) => grantClaims(STORE_ENTITY, KEY.peer, "write", KEY.operator, t)),
      byOperator((t) => makeNegationClaims(KEY.operator, t, firstGrant!)),
    ]);
    c.tick();
    const rotatedWrite = note("peer", c.at, "ada's note, new key");
    const rotatedWrites = await door(gw, rotatedWrite);
    const firstKeyWrites = await door(gw, note("writer", c.at + 1, "ada's note, first key"));
    byId.set(rotatedWrite.id, rotatedWrite);
    c.tick();
    await record("principal.slate-owner", {
      before,
      rotatedWrites,
      firstKeyWrites,
      after: verdict(),
    });
    await gw.close();
  });
});
