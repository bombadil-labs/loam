// T263 — DERIVED STANDING: a bound connection registers law under its own container path, and
// THAT LAW SERVES ONLY ITS CONTAINER (SPEC §58 position 2; Myk's ruling, 2026-09-03).
//
// Two fences and one wall, and each has a case below. The fence at the DOOR: bound to `C`, a
// connection may name law under `C:` — the path AND ITS COLON — and nothing else. The fence at the
// FOLD: the same three names (program, reading, entity) are checked again for law that reached a
// pool by any other road. The WALL: a connection's law never enters the root fold, so it is served
// to the connection and to nobody else — not the operator, not a sibling container's connection,
// not the public door. Before this wall the operator was served a connection's lens evaluated over
// the operator's own ground (measured: `secret: "THE-SECRET"`).
//
// Railed at BOTH LEVELS: which reactor holds the registration delta (the pool's, never the
// primary's) AND what each door serves — asked as "does the surface CARRY the field", matched on
// GraphQL's own "Cannot query field", so no other error can pass for "not served".
//
// NOT HERE, and said so rather than padded: a restart — the pools re-attach through S1's
// `resumeInboxesImpl`, which S1 railed, and this fold is a pure function over the attached pools,
// so what a boot needs is exactly what S1 proves.

//
// RAILS-RED on origin/main, this file copied in: 14 red, 2 green — 16 cases. Both greens are
// CONTROLS and say so: the door-fence case (on main a connection may register nothing, so every
// name outside the fence is refused for a different reason) and the two-grant case (it pins that
// a plain grant-holder's mixed pair still lands, which main already did). Each pins that this
// slice did not widen or narrow something; neither proves the slice, and neither pads the count.
//
// REVERT PROBES, MEASURED against this file as it stands — 16 cases. Re-measure when you add one.
//   the binding grants no register fence                          → 13 red,  3 green
//   the fence drops the COLON                                     →  3 red, 13 green
//   every bound identity is routed to its pool (granted law dies) →  1 red, 15 green
//   container law is routed to the PRIMARY                        → 11 red,  5 green
//   a half-inside pair takes the primary road                     →  1 red, 15 green
//   the FOLD fences none of its three names                       →  1 red, 15 green
//   the fold drops the PROGRAM fence alone                        →  1 red, 15 green
//   the fold drops the READING fence alone                        →  1 red, 15 green
//   the fold drops the ENTITY fence alone                         →  1 red, 15 green
//   inbox law back in the ROOT fold, with a root refold           →  8 red,  8 green
//   the query door ignores the binding                            →  8 red,  8 green
//   the door reports the pool's answer, not the container's       →  2 red, 14 green
//   the door matches ANY row under the name, not this pool's      →  1 red, 15 green
//   whoami re-derives standing beside the door                    →  2 red, 14 green
//   the listing groups the ROOT's rows for a bound reader         →  1 red, 15 green
//   NUL admitted in a READING name, at door and fold              →  1 red, 15 green
// Ten of these isolate exactly one case, which is what makes them worth keeping. The root-fold
// probe is restored WHOLE (loop and refold): the loop alone leaves every case green, which is how
// an earlier draft of these probes misread a hollow rail as a sound one. The contest between two
// pools in one container, and the order the fold trials in, are railed at the library seam in
// test/gateway/bound-fold.test.ts.

import { describe, expect, it } from "vitest";
import {
  closeAll,
  connect,
  connectionServer,
  grantOf,
  OPERATOR,
  OPERATOR_SEED,
} from "../helpers/connection-fixture.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { readRegistrations } from "../../src/gateway/registration.js";
import type { Gateway } from "../../src/gateway/gateway.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

/** A minimal, valid registration for one lens name — the canonical entity program. */
const envelope = (name: string, prop = "note", roots = [`${name}:1`]): unknown => ({
  hyperschema: {
    name,
    alg: 1,
    body: {
      op: "group",
      key: "byTargetContext",
      in: {
        op: "select",
        pred: { hasPointer: { targetEntity: { var: "root" } } },
        in: { op: "mask", policy: "drop", in: "input" },
      },
    },
  },
  schema: {
    props: { [prop]: { pick: { order: { byTimestamp: "desc" } } } },
    default: { pick: { order: { byTimestamp: "desc" } } },
  },
  roots,
  writable: [prop],
});

const register = (base: string, bearer: string, body: unknown): Promise<Response> =>
  fetch(`${base}/default/register`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });

const gql = async (
  base: string,
  bearer: string,
  query: string,
): Promise<{ data?: unknown; errors?: string[] }> =>
  (await (
    await fetch(`${base}/default/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ query }),
    })
  ).json()) as { data?: unknown; errors?: string[] };

/** Does this door's surface CARRY the field? Only GraphQL's own absence sentence counts as "no". */
const serves = async (base: string, bearer: string, field: string): Promise<boolean> => {
  const res = await gql(base, bearer, `{ ${field}(entity: "x:1") { _entity } }`);
  if ((res.errors ?? []).length === 0) return true;
  expect(res.errors!.join(" ")).toMatch(new RegExp(`Cannot query field "${field}"`));
  return false;
};

/** The lens names a reactor holds — `lensName` falling back to the hyperschema's. */
const lensesIn = (gw: Gateway): string[] =>
  readRegistrations(gw.reactor, gw.operatorAuthor).map((r) => r.lensName ?? r.hyperschema.name);
const pools = (gw: Gateway): Gateway[] =>
  [...gw.connectionInboxes.values()]
    .map((c) => c.gateway)
    .filter((g): g is Gateway => g !== undefined);

describe("§58 position 2 — the binding is the register grant, and the law serves only its container", () => {
  it("registers with NO grant; the law is in the pool and served to the connection alone", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const bea = await connect(base, "bea", "journal");

    const res = await register(base, ada, envelope("ada:journal:log"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { bound: boolean }).bound).toBe(true);

    // DELTA LEVEL: in the connection's pool, never in the primary.
    expect(lensesIn(gateway)).not.toContain("ada:journal:log");
    expect(pools(gateway).flatMap(lensesIn)).toContain("ada:journal:log");

    // OBJECT LEVEL, three doors. The connection's surface carries it. The operator's does not —
    // the root fold never saw it. A sibling home's connection does not either.
    expect(await serves(base, ada, "ada_journal_log")).toBe(true);
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(false);
    expect(await serves(base, bea, "ada_journal_log")).toBe(false);
    await closeAll();
  });

  it("writes through its own lens into its pool, and reads it back — one position for all three", async () => {
    // Register, write, read: the same container position governs each. The generated mutation
    // for a pool lens is served on the connection's surface and lands through `sinkFor`, in the
    // pool, signed by the connection's key — never in the primary, never as the operator.
    const { base, gateway, connectorsHome } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await register(base, ada, envelope("ada:journal:log"))).status).toBe(200);
    const wrote = await gql(
      base,
      ada,
      `mutation { ada_journal_log(entity: "ada:journal:log:1", note: "first") { note } }`,
    );
    expect(wrote.errors).toBeUndefined();
    const read = await gql(base, ada, `{ ada_journal_log(entity: "ada:journal:log:1") { note } }`);
    expect((read.data as { ada_journal_log: { note: string } }).ada_journal_log.note).toBe("first");
    // DELTA LEVEL: the claim is in the pool, not the primary, and the operator's door has no field.
    const inPrimary = [...gateway.reactor.snapshot()].some((d) =>
      JSON.stringify(d).includes('"first"'),
    );
    expect(inPrimary).toBe(false);
    const inPool = pools(gateway).some((p) =>
      [...p.reactor.snapshot()].some((d) => JSON.stringify(d).includes('"first"')),
    );
    expect(inPool).toBe(true);
    // AND THE AUTHOR: the connection's own key signed it, not the operator. Location alone would
    // pass if the operator's key had written into the pool on the connection's behalf.
    const claim = pools(gateway)
      .flatMap((p) => [...p.reactor.snapshot()])
      .find((d) => JSON.stringify(d).includes('"first"'))!;
    expect(claim.claims.author).toBe(authorForSeed(grantOf(connectorsHome, "ada").actorSeed));
    expect(claim.claims.author).not.toBe(gateway.operatorAuthor);
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(false);
    await closeAll();
  });

  it("refuses every name outside the fence, INCLUDING the container's own bare name", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const outside = ["ada:other:log", "ada:journalx:log", "ada:journal", "log", "ada"];
    for (const name of outside) {
      expect((await register(base, ada, envelope(name))).status, `expected ${name} refused`).toBe(
        403,
      );
    }
    const everywhere = [...lensesIn(gateway), ...pools(gateway).flatMap(lensesIn)];
    for (const name of outside) expect(everywhere).not.toContain(name);
    await closeAll();
  });

  it("a lens over ground the connection cannot read answers it null, and is never served to the operator", async () => {
    // THE MEASURED HOLE. Before the wall, this lens was served to the operator, evaluated over the
    // operator's own ground, and answered "THE-SECRET" — for a connection holding no grant at all.
    const { base, gateway } = await connectionServer();
    await gateway.append([
      signClaims(
        {
          timestamp: gateway.nextTimestamp(),
          author: gateway.operatorAuthor!,
          pointers: [
            {
              role: "subject",
              target: { kind: "entity", entity: { id: "vault:1", context: "secret" } },
            },
            { role: "value", target: { kind: "primitive", value: "THE-SECRET" } },
          ],
        },
        OPERATOR_SEED,
      ),
    ]);
    const ada = await connect(base, "ada", "journal");
    expect(
      (await register(base, ada, envelope("ada:journal:peek", "secret", ["vault:1"]))).status,
    ).toBe(200);

    // The operator's surface does not carry it.
    expect(await serves(base, "op-token", "ada_journal_peek")).toBe(false);
    // The connection's does — and resolves it over the CONNECTION'S scope, where vault:1 is not.
    const mine = await gql(base, ada, `{ ada_journal_peek(entity: "vault:1") { secret } }`);
    expect(mine.errors).toBeUndefined();
    expect(
      (mine.data as { ada_journal_peek: { secret: unknown } }).ada_journal_peek.secret,
    ).toBeNull();
    // Two-sided: the operator's own law over the operator's own ground is untouched.
    await gateway.append([observed(FERN, "height", 30, gateway.nextTimestamp(), OPERATOR_SEED)]);
    const theirs = await gql(base, "op-token", `{ plant(entity: "${FERN}") { height } }`);
    expect((theirs.data as { plant: { height: number } }).plant.height).toBe(30);
    await closeAll();
  });

  it("the FOLD fences all three names, for law that reached a pool another way", async () => {
    // The door is not the only road into a pool. Publish straight onto it — no fence, no
    // standing — and see what the connection's surface carries.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await register(base, ada, envelope("ada:journal:kept"))).status).toBe(200);
    const pool = pools(gateway)[0]!;
    const named = (name: string) => ({ ...PLANT_POLICY, name });

    // (a) the PROGRAM name outside the container
    await pool.publishRegistration(
      { ...PLANT, name: "ada:other:program" },
      named("ada:other:program"),
      [FERN],
    );
    // (b) the program inside, the READING outside — the second name the door fences
    await pool.publishRegistration(
      { ...PLANT, name: "ada:journal:inside" },
      named("ada:other:reading"),
      [FERN],
    );
    // (d) the program OUTSIDE with the reading INSIDE — the PROGRAM fence alone catches this
    await pool.publishRegistration(
      { ...PLANT, name: "ada:other:program2" },
      named("ada:journal:reading2"),
      [FERN],
    );
    // (e) both names inside but the ENTITY elsewhere — the third name the door fences
    await pool.publishRegistration(
      { ...PLANT, name: "ada:journal:ent" },
      named("ada:journal:ent"),
      [FERN],
      undefined,
      "hyperschema:ada:journal:elsewhere",
    );
    // (c) both inside: served
    await pool.publishRegistration(
      { ...PLANT, name: "ada:journal:both" },
      named("ada:journal:both"),
      [FERN],
    );
    expect(lensesIn(pool)).toEqual(
      expect.arrayContaining(["ada:other:program", "ada:other:reading", "ada:journal:both"]),
    );

    expect(await serves(base, ada, "ada_journal_kept")).toBe(true);
    expect(await serves(base, ada, "ada_journal_both")).toBe(true);
    expect(await serves(base, ada, "ada_other_program")).toBe(false);
    expect(await serves(base, ada, "ada_other_reading")).toBe(false);
    expect(await serves(base, ada, "ada_journal_reading2")).toBe(false); // (d)
    expect(await serves(base, ada, "ada_journal_ent")).toBe(false); // (e)
    // And none of it ever reaches the root.
    for (const f of [
      "ada_journal_kept",
      "ada_journal_both",
      "ada_other_program",
      "ada_other_reading",
    ]) {
      expect(await serves(base, "op-token", f)).toBe(false);
    }
    await closeAll();
  });

  it("a dropped pool's law serves nobody afterwards, and the operator's law is untouched", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await register(base, ada, envelope("ada:journal:log"))).status).toBe(200);
    expect(await serves(base, ada, "ada_journal_log")).toBe(true);
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(false); // never at root

    const [name] = [...gateway.connectionInboxes.keys()];
    await gateway.connectionInboxes.get(name!)!.drop();
    expect(gateway.connectionInboxes.size).toBe(0);

    // A fresh binding in the same container is served a surface WITHOUT the dropped law...
    const again = await connect(base, "ada", "journal");
    expect(await serves(base, again, "ada_journal_log")).toBe(false);
    // ...the operator still is not, and the operator's own law still serves (the bystander).
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(false);
    expect(await serves(base, "op-token", "plant")).toBe(true);
    await closeAll();
  });

  it("a pool lens that collides with the root's law is refused by the container fold, and the door SAYS so", async () => {
    // The pool's own trial cannot see the root's law, so the pool binds `ada:journal:log`
    // happily. The container's fold trials it BESIDE the root's rows — and the operator already
    // serves a lens whose GraphQL name is `ada_journal_log`. The nearer ground never displaces the
    // operator's law, and the door must report the fold's answer, not the pool's (H7).
    const { base, gateway } = await connectionServer();
    const root = await register(base, "op-token", envelope("ada_journal_log")); // the operator is unfenced
    expect(root.status).toBe(200);
    const ada = await connect(base, "ada", "journal");
    const res = await register(base, ada, envelope("ada:journal:log"));
    expect(res.status).toBe(200); // written — the deltas are down in the pool either way
    const outcome = (await res.json()) as { bound: boolean; reason?: string };
    expect(outcome.bound).toBe(false);
    expect(outcome.reason).toMatch(/ada_journal_log/);
    // What the connection's surface carries under that field is the OPERATOR'S lens, still.
    expect(pools(gateway).flatMap(lensesIn)).toContain("ada:journal:log");
    expect(await serves(base, ada, "ada_journal_log")).toBe(true);
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(true);
    expect(lensesIn(gateway)).toContain("ada_journal_log");
    expect(lensesIn(gateway)).not.toContain("ada:journal:log");
    await closeAll();
  });

  it("a root lens spelled EXACTLY the same refuses the pool's, and the door reports THIS pool's row", async () => {
    // The operator is unfenced and may spell a root lens `ada:journal:log`. The fold refuses the
    // pool's row under that name. A door that asked "does any served row carry the name?" would
    // find the operator's and report the connection's law bound — while the connection is served
    // someone else's fields (H7). The door must ask about THIS pool's row.
    const { base } = await connectionServer();
    expect((await register(base, "op-token", envelope("ada:journal:log", "rootprop"))).status).toBe(
      200,
    );
    const ada = await connect(base, "ada", "journal");
    const res = await register(base, ada, envelope("ada:journal:log", "note"));
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as { bound: boolean; reason?: string };
    expect(outcome.bound).toBe(false);
    expect(outcome.reason).toMatch(/ada_journal_log/);
    const mine = await gql(base, ada, `{ ada_journal_log(entity: "ada:journal:log:1") { note } }`);
    expect((mine.errors ?? []).join(" ")).toMatch(/Cannot query field "note"/);
    const theirs = await gql(
      base,
      "op-token",
      `{ ada_journal_log(entity: "ada:journal:log:1") { rootprop } }`,
    );
    expect(theirs.errors).toBeUndefined();
    await closeAll();
  });

  it("law under a GRANTED prefix still lands in the primary and serves everyone — nothing stops working before its replacement", async () => {
    // A bound key that also holds an explicit `register` grant keeps that grant until the slice
    // that retires it. Routing every bound identity to its pool sent granted law into a pool whose
    // fold fenced it out — written, served to nobody. The route is decided by the NAME.
    const { base, gateway, connectorsHome } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const key = authorForSeed(grantOf(connectorsHome, "ada").actorSeed);
    await gateway.append([
      signClaims(
        grantClaims(STORE_ENTITY, key, "register", OPERATOR, gateway.nextTimestamp(), "zed:"),
        OPERATOR_SEED,
      ),
    ]);
    const who = (await (
      await fetch(`${base}/default/whoami`, { headers: { authorization: `Bearer ${ada}` } })
    ).json()) as { registerPrefixes: string[] };
    expect(who.registerPrefixes).toEqual(expect.arrayContaining(["zed:", "ada:journal:"]));

    const granted = await register(base, ada, envelope("zed:thing"));
    expect(granted.status).toBe(200);
    expect(((await granted.json()) as { bound: boolean }).bound).toBe(true);
    expect(lensesIn(gateway)).toContain("zed:thing"); // the PRIMARY, as before this slice
    expect(pools(gateway).flatMap(lensesIn)).not.toContain("zed:thing");
    expect(await serves(base, "op-token", "zed_thing")).toBe(true);
    expect(await serves(base, ada, "zed_thing")).toBe(true);
    // ...while law under the container path still takes the pool.
    expect((await register(base, ada, envelope("ada:journal:own"))).status).toBe(200);
    expect(lensesIn(gateway)).not.toContain("ada:journal:own");
    expect(await serves(base, "op-token", "ada_journal_own")).toBe(false);

    // A MIXED PAIR — program under the container, reading under the grant, or the reverse — is
    // under NO one prefix and is refused. A fence that admitted each name separately let this
    // pair clear it, and the route sent container-path law to the primary, served to everyone.
    const bea = await connect(base, "bea", "journal");
    for (const [program, reading] of [
      ["ada:journal:p1", "zed:r1"],
      ["zed:p2", "ada:journal:r2"],
    ] as const) {
      const mixed = await register(base, ada, {
        ...(envelope(program) as Record<string, unknown>),
        schema: {
          name: reading,
          props: { note: { pick: { order: { byTimestamp: "desc" } } } },
          default: { pick: { order: { byTimestamp: "desc" } } },
        },
      });
      expect(mixed.status, `${program} / ${reading}`).toBe(403);
    }
    const everywhere = [...lensesIn(gateway), ...pools(gateway).flatMap(lensesIn)];
    for (const name of ["ada:journal:p1", "zed:r1", "zed:p2", "ada:journal:r2"]) {
      expect(everywhere).not.toContain(name);
    }
    expect(await serves(base, "op-token", "ada_journal_r2")).toBe(false);
    expect(await serves(base, bea, "ada_journal_r2")).toBe(false);
    await closeAll();
  });

  it("a PLAIN holder of two grants may still pair a program under one with a reading under the other", async () => {
    // Nothing a grant-holder could do stops working: both names reach only what it owns, and
    // both roads are the primary. Only the CONTAINER's pair must be whole, and only because a
    // half-inside pair would send container-path law down the primary road.
    const TWO_SEED = "d4".repeat(32);
    const { base, gateway } = await connectionServer({
      tokens: { "two-token": { actor: TWO_SEED } },
    });
    const key = authorForSeed(TWO_SEED);
    await gateway.append([
      signClaims(
        grantClaims(STORE_ENTITY, key, "register", OPERATOR, gateway.nextTimestamp(), "zed:"),
        OPERATOR_SEED,
      ),
      signClaims(
        grantClaims(STORE_ENTITY, key, "register", OPERATOR, gateway.nextTimestamp(), "yon:"),
        OPERATOR_SEED,
      ),
    ]);
    const mixed = await register(base, "two-token", {
      ...(envelope("zed:p") as Record<string, unknown>),
      schema: {
        name: "yon:r",
        props: { note: { pick: { order: { byTimestamp: "desc" } } } },
        default: { pick: { order: { byTimestamp: "desc" } } },
      },
    });
    expect(mixed.status).toBe(200);
    expect(lensesIn(gateway)).toContain("yon:r");
    expect(await serves(base, "op-token", "yon_r")).toBe(true);
    await closeAll();
  });

  it("KNOWN LIMIT — a pool lens that expands into the ROOT's reading is refused at the door, by name", async () => {
    // The pool's own trial cannot see the root's readings, so a body that expands into `Plant`
    // fails to materialize at publish. Honest refusal, not a silent fallback; the fix is the
    // context carrying its law source (T274, §59). This case goes RED the day that lands — its
    // body is a well-formed grouped expand, so the only thing between it and 200 is the limit.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const res = await register(base, ada, {
      ...(envelope("ada:journal:expander") as Record<string, unknown>),
      hyperschema: {
        name: "ada:journal:expander",
        alg: 1,
        body: {
          op: "expand",
          role: { exact: "grows" },
          schema: "Plant",
          reading: "Plant",
          in: {
            op: "group",
            key: "byTargetContext",
            in: {
              op: "select",
              pred: { hasPointer: { targetEntity: { var: "root" } } },
              in: { op: "mask", policy: "drop", in: "input" },
            },
          },
        },
      },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Plant/);
    expect(lensesIn(gateway)).not.toContain("ada:journal:expander");
    expect(pools(gateway).flatMap(lensesIn)).not.toContain("ada:journal:expander");
    await closeAll();
  });

  it("LISTS its own pool lens — the page's contexts come from the surface it is served", async () => {
    // The singular door resolved a pool lens while the listing answered an empty page, because
    // the page grouped the ROOT's rows for its contexts and a pool program had none there. An
    // empty page reads as "no such entities", a bigger claim than the read ever made.
    const { base } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await register(base, ada, envelope("ada:journal:log"))).status).toBe(200);
    const wrote = await gql(
      base,
      ada,
      `mutation { ada_journal_log(entity: "ada:journal:log:1", note: "listed") { note } }`,
    );
    expect(wrote.errors).toBeUndefined();
    const page = await gql(base, ada, `{ ada_journal_logs(limit: 5) { _entity } }`);
    expect(page.errors).toBeUndefined();
    expect(
      (page.data as { ada_journal_logs: { _entity: string }[] }).ada_journal_logs.map(
        (n) => n._entity,
      ),
    ).toEqual(["ada:journal:log:1"]);
    expect(await serves(base, "op-token", "ada_journal_logs")).toBe(false);
    await closeAll();
  });

  it("binds a dependent lens whose dependency was EVOLVED later — first-claim order is dependency order", async () => {
    // Lens B expands into lens A; then A is evolved, so A's LATEST binding is stamped later than
    // B's. Trialled in latest-binding order, B would be tried first, find no A, and be refused.
    // The fold trials in FIRST-claim order, which an evolution never moves, so A still comes
    // first and B binds in one pass. (A dependent cannot be staked before its dependency exists —
    // the pool's own door refuses it — so first-claim order is dependency order by construction,
    // and no fixpoint round is needed; this case is what holds that argument to the code.)
    const { base } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await register(base, ada, envelope("ada:journal:a"))).status).toBe(200);
    const b = {
      ...(envelope("ada:journal:b") as Record<string, unknown>),
      hyperschema: {
        name: "ada:journal:b",
        alg: 1,
        body: {
          op: "expand",
          role: { exact: "grows" },
          schema: "ada:journal:a",
          reading: "ada:journal:a",
          // `expand` wants an HView operand (E9): the canonical entity program, grouped.
          in: {
            op: "group",
            key: "byTargetContext",
            in: {
              op: "select",
              pred: { hasPointer: { targetEntity: { var: "root" } } },
              in: { op: "mask", policy: "drop", in: "input" },
            },
          },
        },
      },
    };
    const first = await register(base, ada, b);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { bound: boolean }).bound).toBe(true);
    expect(await serves(base, ada, "ada_journal_b")).toBe(true);
    // Evolve A: a republish at the same name, stamped after B.
    expect((await register(base, ada, envelope("ada:journal:a", "note2"))).status).toBe(200);
    expect(await serves(base, ada, "ada_journal_a")).toBe(true);
    expect(await serves(base, ada, "ada_journal_b")).toBe(true);
    await closeAll();
  });

  it("refuses NUL in a READING name at the door and at the fold", async () => {
    // The publish guards the PROGRAM name against NUL — the gateway's own alphabet — and the
    // reading was unguarded on both fences. An operator has the same gap; the register door is
    // now open to connections, so it is closed here on both sides.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const atDoor = await register(base, ada, {
      ...(envelope("ada:journal:nul") as Record<string, unknown>),
      schema: {
        name: "ada:journal:n\u0000l",
        props: { note: { pick: { order: { byTimestamp: "desc" } } } },
        default: { pick: { order: { byTimestamp: "desc" } } },
      },
    });
    expect(atDoor.status).toBe(403);
    const pool = pools(gateway)[0]!;
    await pool.publishRegistration(
      { ...PLANT, name: "ada:journal:nulled" },
      { ...PLANT_POLICY, name: "ada:journal:nu\u0000lled" },
      [FERN],
    );
    expect(lensesIn(pool)).toContain("ada:journal:nu\u0000lled"); // it IS in the pool
    expect(
      gateway
        .boundSurface({
          container: "ada:journal",
          inbox: [...gateway.connectionInboxes.keys()][0]!,
        })
        .registered.map((r) => r.lensName ?? r.hyperschema.name),
    ).not.toContain("ada:journal:nu\u0000lled");
    await closeAll();
  });

  it("the MCP road takes the same sink, fence and wall", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const call = async (name: string) => {
      const res = await fetch(`${base}/default/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ada}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "loam_register", arguments: envelope(name) },
        }),
      });
      const body = (await res.json()) as {
        result: { content: { text: string }[]; isError?: boolean };
      };
      return body.result;
    };
    const ok = await call("ada:journal:tool");
    expect(ok.isError).not.toBe(true);
    expect((JSON.parse(ok.content[0]!.text) as { bound: boolean }).bound).toBe(true);
    expect(lensesIn(gateway)).not.toContain("ada:journal:tool");
    expect(await serves(base, ada, "ada_journal_tool")).toBe(true);
    expect(await serves(base, "op-token", "ada_journal_tool")).toBe(false);

    const refused = await call("ada:other:tool");
    expect(refused.isError).toBe(true);
    await closeAll();
  });

  it("whoami reports the fence the door applies", async () => {
    const { base } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const who = (await (
      await fetch(`${base}/default/whoami`, { headers: { authorization: `Bearer ${ada}` } })
    ).json()) as { registerPrefixes: string[] };
    expect(who.registerPrefixes).toContain("ada:journal:");
    await closeAll();
  });
});
