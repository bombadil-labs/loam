// T263 — DERIVED STANDING: a bound connection registers law under its own container path
// (SPEC §58, position 2). Bound to `C`, it may name law under `C:` — the path AND ITS COLON, so a
// sibling sharing the letters is outside the fence. The law publishes on the connection's own
// inbox pool, and the §47 aggregation folds it into the served surface.
//
// WHAT CHANGED. Before this slice, registration was the named exception: its standing was an
// operator's explicit `register` grant and never the binding's, and its deltas landed in the
// primary under the store's own signature. A connection with no grant could shape nothing.
//
// THE FENCE IS ENFORCED TWICE, and that is the subject of this file. At the DOOR, so a name
// outside `C:` is refused before anything is written. At the FOLD, so a registration that reached
// a pool by some other road still does not reach the surface. Either one alone leaves the other
// open — the door is bypassable by a pool write, and the fold cannot explain itself to a caller.
//
// Railed at BOTH LEVELS: which reactor holds the registration delta (the pool's, never the
// primary's) AND what the served surface answers for the lens.
//
// Deliberately NOT here: receive, offer, the helper key, and the retirement of
// `loam grant --verb=register` for connections. Each is its own slice, and until the last one
// lands a connection holding a real grant keeps everything it had.

//
// REVERT PROBES, MEASURED against this file as it stands — 3 cases. Re-measure when you add one.
//   the binding grants no register fence          → 2 red, 1 green
//   the fence drops the COLON                     → 1 red, 2 green
//   a bound registration publishes to the primary → 1 red, 2 green
//   the FOLD applies no fence                     → 1 red, 2 green
//   inbox pools are not folded at all             → 2 red, 1 green
//   no refold after a bound publish               → 1 red, 2 green
//
// RAILS-RED on origin/main, this file copied in: 2 red, 1 green. The green one is the FENCE case,
// and it is a CONTROL rather than a gate: on main every one of those names is refused because a
// connection may register nothing at all. It earns its place by pinning that the fence did not
// widen — but it proves nothing about the fence itself, and says so here rather than padding a
// count.

import { describe, expect, it } from "vitest";
import { closeAll, connect, connectionServer } from "../helpers/connection-fixture.js";
import { readRegistrations } from "../../src/gateway/registration.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { FERN } from "../spike/garden.js";
import type { Gateway } from "../../src/gateway/gateway.js";

const afterAll = closeAll;

/** A minimal, valid registration for one lens name — the canonical entity program. */
const envelope = (name: string): unknown => ({
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
    props: { note: { pick: { order: { byTimestamp: "desc" } } } },
    default: { pick: { order: { byTimestamp: "desc" } } },
  },
  roots: [`${name}:1`],
  writable: ["note"],
});

const register = (base: string, bearer: string, name: string): Promise<Response> =>
  fetch(`${base}/default/register`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify(envelope(name)),
  });

/**
 * The lens names a reactor holds, for the DELTA-level assertions. Reads `lensName`, falling back to
 * the hyperschema's — the field a registration actually serves on. An earlier draft read a field
 * that does not exist, so every array came back empty and every `not.toContain` passed while
 * proving nothing.
 */
const lensesIn = (gw: Gateway): string[] =>
  readRegistrations(gw.reactor, gw.operatorAuthor).map((r) => r.lensName ?? r.hyperschema.name);

describe("§58 position 2 — the binding is the register grant, with the colon", () => {
  it("registers under its own container path with NO grant of any kind", async () => {
    const { base, gateway } = await connectionServer();
    const token = await connect(base, "ada", "journal");

    const res = await register(base, token, "ada:journal:log");
    expect(res.status).toBe(200);

    // DELTA LEVEL: the law is in the connection's POOL, and the primary never saw it.
    expect(lensesIn(gateway)).not.toContain("ada:journal:log");
    const pools = [...gateway.connectionInboxes.values()]
      .map((c) => c.gateway)
      .filter((g): g is NonNullable<typeof g> => g !== undefined);
    expect(pools.flatMap(lensesIn)).toContain("ada:journal:log");

    // OBJECT LEVEL: the fold carries it, so the surface serves the lens.
    const read = await fetch(`${base}/default/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: `{ ada_journal_log(entity: "ada:journal:log:1") { note } }` }),
    });
    expect(((await read.json()) as { errors?: unknown[] }).errors).toBeUndefined();
    await afterAll();
  });

  it("refuses every name outside the fence, INCLUDING the container's own bare name", async () => {
    const { base, gateway } = await connectionServer();
    const token = await connect(base, "ada", "journal");

    for (const name of [
      "ada:other:log", // a sibling container
      "ada:journalx:log", // THE COLON: a sibling sharing the letters
      "ada:journal", // the container itself is not UNDER `ada:journal:`
      "log", // the root
      "ada", // the home above the binding
    ]) {
      const res = await register(base, token, name);
      expect(res.status, `expected ${name} to be refused`).toBe(403);
    }
    // Two-sided at the bytes: none of them reached any store.
    const everywhere = [
      ...lensesIn(gateway),
      ...[...gateway.connectionInboxes.values()]
        .map((c) => c.gateway)
        .filter((g): g is NonNullable<typeof g> => g !== undefined)
        .flatMap(lensesIn),
    ];
    for (const name of ["ada:other:log", "ada:journalx:log", "ada:journal", "log", "ada"]) {
      expect(everywhere).not.toContain(name);
    }
    await afterAll();
  });

  it("the FOLD refuses what the door refuses, for law that reached a pool another way", async () => {
    // The door is not the only road into a pool: a restore, a migration, or an operator-signed
    // delta written out of band can put law there. The fold carries only names under the bound
    // container's path, so the surface never serves what the door would have refused.
    const { base, gateway } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    expect((await register(base, token, "ada:journal:kept")).status).toBe(200);

    const pool = [...gateway.connectionInboxes.values()].map((c) => c.gateway).find(Boolean)!;

    // Publish an out-of-fence lens STRAIGHT ONTO THE POOL, never through the door. It must exist
    // only there: registering it as the operator first would put it in the primary, where it is
    // legitimately served, and the case would prove nothing about the fold.
    await pool.publishRegistration({ ...PLANT, name: "ada:other:smuggled" }, PLANT_POLICY, [FERN]);
    expect(lensesIn(pool)).toContain("ada:other:smuggled"); // it IS in the pool
    // AND THE FOLD MUST ACTUALLY RUN WITH IT PRESENT, or the fence is not what keeps it out. A
    // pool publish rebinds the pool alone, so without this the served surface was simply built
    // before the lens existed — and an earlier draft of this case passed with the fence deleted.
    gateway.replayRegistrations();

    // ...and the surface still does not serve it, while the in-fence lens is served.
    // Asks whether the SURFACE CARRIES THE FIELD, not whether a query succeeds. `_entity` is on
    // every view, so a served lens resolves; an unserved one draws GraphQL's own "Cannot query
    // field" and nothing else. Matching that sentence matters: any other error would otherwise
    // count as "not served" and the case would pass for the wrong reason.
    const ask = async (field: string): Promise<boolean> => {
      const res = await fetch(`${base}/default/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: `{ ${field}(entity: "x:1") { _entity } }` }),
      });
      const errors = ((await res.json()) as { errors?: string[] }).errors ?? [];
      if (errors.length === 0) return true;
      expect(errors.join(" ")).toMatch(new RegExp(`Cannot query field "${field}"`));
      return false;
    };
    expect(await ask("ada_journal_kept")).toBe(true);
    expect(await ask("ada_other_smuggled")).toBe(false);
    await afterAll();
  });
});
