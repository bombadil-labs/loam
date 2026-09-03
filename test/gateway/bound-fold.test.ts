// T263 — THE BOUND FOLD at the library seam (SPEC §58 position 2; Myk's ruling 2026-09-03: a
// bound connection's law serves only its container). Two inbox pools in ONE container may each
// publish the same lens name, and the fold must answer the contest the same way whoever asks,
// however the pools were attached, and however often the holder republishes. The rule is WHO
// STAKED THE NAME FIRST: the earlier surviving claim keeps it, the rival is refused with the
// collision named, a reboot that re-attaches in another order answers the same, and the holder's
// own evolutions never move its claim.
//
// Why here and not through the doors: consent binds one pool per (user, container), so two pools
// in one container need two connection keys bound at this seam, the way `binding-route.test.ts`
// binds its one. The door-level rails for the same fold are in test/server/derived-standing.test.ts.
//
// THE CONFOUND THIS FILE REMOVES: the earlier registrant must NOT also be the lexically-earlier
// pool name, or a comparator that sorted by name alone would pass. So the pool that registers
// first is chosen at runtime to be the one with the lexically LATER inbox name.
//
// The sort settles the contest; it does not settle DEPENDENCY order, and the rounds that do must
// not reopen the contest. A first claim never moves — but a dependency's first claim can be
// STRUCK, which moves it later than a dependent's, and (in derived-standing) a lens can be evolved
// to expand into one staked after it. So the fold trials in rounds to a fixpoint. And a holder
// refused in a round for want of a reading keeps what it STAKED through that round: trialled into
// the gap, a rival staked second took the name and the holder collided with it a round later.
// What is held is every name the trial contests, not the lens string — two spellings mint one
// query field, `x`'s listing field is `xs`'s query field, and one program name admits one body —
// and a shared program is a contest only under a rival body, since the same body under another
// reading is a sibling the trial admits. A refusal belongs to one pool's candidate
// (`refusalKey`), so two pools refused under one name are each told their own fault.
//
// REVERT PROBES, MEASURED on these 11 cases:
//   drop the candidate sort                         →  1 red, 10 green
//   key the sort on `boundAt` (the latest binding)  →  6 red,  5 green
//   trial in ONE pass instead of to a fixpoint      →  5 red,  6 green (+1 in derived-standing)
//   drop the hold within a round                    →  5 red,  6 green
//   hold on the lens string alone                   →  3 red,  8 green (field, listing, program)
//   drop the same-body program exception            →  1 red, 10 green (the sibling case)
//   share one reason per lens across pools          →  1 red, 10 green (the two-faults case)
// The no-sort probe reds one case because attach order happens to agree with the right answer
// for one of the two orderings, so exactly one of the attach-order and re-attach cases sees it.
//
// RAILS-RED on origin/main: every case red, because `boundSurface` does not exist there. An
// honest red and a WEAK one; the probes above are the measurement.
//
// NOT HERE, and said so: the root replay binds a stored row whose templates alone fail WITHOUT its
// templates; this fold refuses such a row whole, and names the template fault. The door cannot
// plant one — it refuses invisible templates before writing — so only an out-of-band pool write
// reaches it. A rail would append such a row to a pool directly and assert the refusal's text.

import { describe, expect, it } from "vitest";
import { authorForSeed, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  lensOf,
  readRegistrations,
  readRegistrationVersions,
} from "../../src/gateway/registration.js";
import { refusalKey } from "../../src/gateway/lifecycle.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const OWNER_SEED = GARDENER_SEED;
const OWNER = GARDENER;
const HOME = "home:alice";
const LENS = "home:alice:x";

const ALICES_OWN = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: OWNER } },
  in: "input",
};

/** Two pools in one container. `first` registers first and has the lexically LATER inbox name. */
async function twoPools(): Promise<{ gw: Gateway; first: string; second: string }> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  await gw.append([signClaims(grantClaims(STORE_ENTITY, OWNER, "write", OP, 500), OP_SEED)]);
  await gw.append([
    signClaims(
      containerClaims(
        { container: HOME, trust: "curated", posture: "shared", membership: ALICES_OWN },
        OP,
        600,
      ),
      OP_SEED,
    ),
  ]);
  const one = (
    await gw.bindConnection({
      container: HOME,
      connectionKey: authorForSeed("a1".repeat(32)),
      ownerSeed: OWNER_SEED,
    })
  ).entity!;
  const two = (
    await gw.bindConnection({
      container: HOME,
      connectionKey: authorForSeed("b2".repeat(32)),
      ownerSeed: OWNER_SEED,
    })
  ).entity!;
  const [early, late] = [one, two].sort();
  return { gw, first: late!, second: early! };
}

const pool = (gw: Gateway, inbox: string): Gateway => gw.connectionInboxes.get(inbox)!.gateway!;
const publish = (gw: Gateway, inbox: string, prop = "height"): Promise<unknown> =>
  pool(gw, inbox).publishRegistration(
    { ...PLANT, name: LENS },
    { ...PLANT_POLICY, name: LENS, props: new Map([[prop, PLANT_POLICY.default]]) },
    [FERN],
  );
/** A lens `name` whose body expands into `into` — a real dependency the trial checks. */
const expanding = (name: string, into: string): typeof PLANT => ({
  ...PLANT,
  name,
  body: parseTerm({
    op: "expand",
    role: { exact: "grows" },
    schema: into,
    reading: into,
    in: {
      op: "group",
      key: "byTargetContext",
      in: {
        op: "select",
        pred: { hasPointer: { targetEntity: { var: "root" } } },
        in: { op: "mask", policy: "drop", in: "input" },
      },
    },
  }),
});
/** Strike one registration delta in a pool out of band, signed by the root operator. */
const strike = (p: Gateway, deltaId: string): Promise<unknown> =>
  p.append([
    signClaims(
      {
        timestamp: p.nextTimestamp(),
        author: OP,
        pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: deltaId } } }],
      },
      OP_SEED,
    ),
  ]);
const servedBy = (gw: Gateway, asker: string, lens: string): string | undefined =>
  gw.boundSurface({ container: HOME, inbox: asker }).registered.find((r) => lensOf(r) === lens)
    ?.channel;
const winner = (gw: Gateway, asker: string): string | undefined => servedBy(gw, asker, LENS);
/** A program body that is not PLANT's: the same group, no select beneath it. */
const OTHER_BODY = parseTerm({
  op: "group",
  key: "byTargetContext",
  in: { op: "mask", policy: "drop", in: "input" },
});
/** Stake `lens` on pool `inbox` under program `program` with body `body`. */
const stake = (
  gw: Gateway,
  inbox: string,
  lens: string,
  program = lens,
  body: typeof PLANT.body = PLANT.body,
): Promise<unknown> =>
  pool(gw, inbox).publishRegistration(
    { ...PLANT, name: program, body },
    { ...PLANT_POLICY, name: lens },
    [FERN],
  );
/** The holder stakes `dep` and evolves `lens` to expand into it — the ordinary way a lens grows. */
const growInto = async (
  gw: Gateway,
  inbox: string,
  lens: string,
  dep: string,
  program = lens,
): Promise<void> => {
  await stake(gw, inbox, dep);
  await pool(gw, inbox).publishRegistration(
    expanding(program, dep),
    { ...PLANT_POLICY, name: lens },
    [FERN],
  );
};

describe("§58 — two pools in one container contest a name by who staked it first", () => {
  it("the first registrant keeps the name, whichever pool was attached or sorts first", async () => {
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    for (const asker of [first, second]) {
      expect(winner(gw, asker), `asked from ${asker}`).toBe(first);
      expect(
        gw.boundSurface({ container: HOME, inbox: asker }).refused.get(refusalKey(second, LENS)),
      ).toMatch(/collides/);
    }
    // Two-sided: the root's own law is untouched, and the root fold never saw either row.
    expect(gw.registered.map(lensOf)).toEqual(["Plant"]);
  });

  it("answers the same after the pools are re-attached in the other order", async () => {
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    expect(winner(gw, first)).toBe(first);
    // Re-attach in the other order, then EVOLVE the winner so the fold's key moves and the next
    // ask refolds from the Map as it now stands — an unchanged key would answer from the cache
    // and prove nothing. (An evolution moves the latest binding, never the first claim.)
    const handles = new Map(gw.connectionInboxes);
    gw.connectionInboxes.clear();
    for (const name of [...handles.keys()].reverse())
      gw.connectionInboxes.set(name, handles.get(name)!);
    await publish(gw, first, "watered");
    expect(winner(gw, first)).toBe(first);
    expect(winner(gw, second)).toBe(first);
  });

  it("the holder keeps the name through an identical republish and through an evolution", async () => {
    // Keyed on the LATEST binding, a holder lost its name the moment it republished — its claim
    // moved later than the rival's — and nothing it did could win it back.
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    await publish(gw, first); // identical
    expect(winner(gw, first)).toBe(first);
    await publish(gw, first, "watered"); // an evolution
    expect(winner(gw, first)).toBe(first);
    expect(
      gw.boundSurface({ container: HOME, inbox: second }).refused.get(refusalKey(second, LENS)),
    ).toMatch(/collides/);
  });

  it("a dependency whose FIRST binding is struck still sorts where its dependent needs it", async () => {
    // `firstBoundAt` is the first SURVIVING claim. Strike a dependency's earliest binding out of
    // band (an operator-signed negation in the pool — the road the fold's header says it fences)
    // and its first claim moves later than its dependent's. Rounds bind the dependent anyway.
    const { gw, first } = await twoPools();
    const p = pool(gw, first);
    const A = "home:alice:a";
    const B = "home:alice:b";
    const expandsIntoA = expanding(B, A);
    await p.publishRegistration({ ...PLANT, name: A }, { ...PLANT_POLICY, name: A }, [FERN]);
    await p.publishRegistration(expandsIntoA, { ...PLANT_POLICY, name: B }, [FERN]);
    await p.publishRegistration(
      { ...PLANT, name: A },
      { ...PLANT_POLICY, name: A, props: new Map([["watered", PLANT_POLICY.default]]) },
      [FERN],
    ); // evolve A: a later binding
    const firstA = readRegistrationVersions(p.reactor, p.operatorAuthor)
      .filter((v) => v.lensName === A)
      .sort((x, y) => x.timestamp - y.timestamp)[0]!;
    await strike(p, firstA.deltaId);
    // The premise, pinned from the reader the fold sorts on: the strike moved A's first
    // surviving claim after B's. Without this line the case stays green under one pass too,
    // once a strike stops counting.
    const rows = readRegistrations(p.reactor, p.operatorAuthor);
    const firstClaim = (name: string): number =>
      rows.find((r) => lensOf(r) === name)!.firstBoundAt!;
    expect(firstClaim(A)).toBeGreaterThan(firstClaim(B));
    const surface = gw.boundSurface({ container: HOME, inbox: first });
    expect(surface.registered.map(lensOf)).toEqual(expect.arrayContaining([A, B]));
    expect(surface.refused.has(refusalKey(first, B))).toBe(false);
  });

  it("the rounds do not reopen the contest: a holder refused for want of a reading keeps its name", async () => {
    // `first` stakes x plain, `second` stakes x, then `first` publishes a and evolves x to expand
    // into a. In round one x@first wants a reading that is not bound yet. Trialled into that gap,
    // x@second bound and x@first collided with it in round two — a name lost to a rival staked
    // second, with no republish able to win it back. The holder holds through the round.
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    const A = "home:alice:a";
    await pool(gw, first).publishRegistration({ ...PLANT, name: A }, { ...PLANT_POLICY, name: A }, [
      FERN,
    ]);
    await pool(gw, first).publishRegistration(expanding(LENS, A), { ...PLANT_POLICY, name: LENS }, [
      FERN,
    ]);
    for (const asker of [first, second]) {
      expect(winner(gw, asker), `asked from ${asker}`).toBe(first);
      // The rival's program shares the holder's name with a different body now, so the trial
      // names the body clash rather than the query-field collision; either is the holder's win.
      expect(
        gw.boundSurface({ container: HOME, inbox: asker }).refused.get(refusalKey(second, LENS)),
      ).toMatch(/collides|DIFFERENT bodies/);
    }
    expect(gw.boundSurface({ container: HOME, inbox: first }).registered.map(lensOf)).toContain(A);
  });

  it("two pools refused under one name are each told their own fault", async () => {
    // x@first expands into a reading whose every binding is struck; x@second is staked after it.
    // Keyed by lens alone, the later refusal overwrote the earlier and `first` was told the
    // rival's fault. A refusal is the candidate's: x@first is told about its reading, x@second
    // that an earlier claim holds the name and why that claim is refused.
    const { gw, first, second } = await twoPools();
    const p = pool(gw, first);
    const A = "home:alice:a";
    await p.publishRegistration({ ...PLANT, name: A }, { ...PLANT_POLICY, name: A }, [FERN]);
    await p.publishRegistration(expanding(LENS, A), { ...PLANT_POLICY, name: LENS }, [FERN]);
    await publish(gw, second);
    for (const v of readRegistrationVersions(p.reactor, p.operatorAuthor).filter(
      (v) => v.lensName === A,
    ))
      await strike(p, v.deltaId);
    const refused = gw.boundSurface({ container: HOME, inbox: first }).refused;
    expect(refused.get(refusalKey(first, LENS))).toMatch(/home:alice:a/);
    expect(refused.get(refusalKey(first, LENS))).not.toMatch(/earlier claim/);
    expect(refused.get(refusalKey(second, LENS))).toMatch(/^lens home:alice:x: an earlier claim/);
    expect(winner(gw, second)).toBeUndefined();
  });

  it("the hold covers the QUERY FIELD: two spellings that mint one field", async () => {
    // `home:alice:a:b` and `home:alice:a_b` are two readings and one GraphQL field. Held by the
    // lens string alone, the holder's evolution let the other spelling take the field in round
    // one, and the holder collided with it in round two.
    const { gw, first, second } = await twoPools();
    const AB = "home:alice:a:b";
    const A_B = "home:alice:a_b";
    await stake(gw, first, AB);
    await stake(gw, second, A_B);
    expect(servedBy(gw, first, AB)).toBe(first); // the sort's answer, before any evolution
    await growInto(gw, first, AB, "home:alice:dep");
    for (const asker of [first, second]) {
      expect(servedBy(gw, asker, AB), `asked from ${asker}`).toBe(first);
      expect(servedBy(gw, asker, A_B)).toBeUndefined();
      expect(
        gw.boundSurface({ container: HOME, inbox: asker }).refused.get(refusalKey(second, A_B)),
      ).toMatch(/collides|earlier claim/);
    }
  });

  it("the hold covers the LISTING FIELD: `x`'s listing field is `xs`'s query field", async () => {
    const { gw, first, second } = await twoPools();
    const XS = `${LENS}s`;
    await stake(gw, first, LENS);
    await stake(gw, second, XS);
    expect(winner(gw, first)).toBe(first);
    await growInto(gw, first, LENS, "home:alice:dep");
    expect(winner(gw, second)).toBe(first);
    expect(servedBy(gw, second, XS)).toBeUndefined();
    expect(
      gw.boundSurface({ container: HOME, inbox: second }).refused.get(refusalKey(second, XS)),
    ).toMatch(/collides|earlier claim/);
  });

  it("the hold covers the PROGRAM: a rival body under the holder's program name", async () => {
    // One program name admits one body. `second` stakes the same program under another reading
    // with a rival body; the holder's evolution must not hand the program to it.
    const { gw, first, second } = await twoPools();
    const P = "home:alice:p";
    await stake(gw, first, "home:alice:p1", P);
    await stake(gw, second, "home:alice:p2", P, OTHER_BODY);
    expect(servedBy(gw, first, "home:alice:p1")).toBe(first);
    expect(servedBy(gw, first, "home:alice:p2")).toBeUndefined();
    await growInto(gw, first, "home:alice:p1", "home:alice:dep", P);
    for (const asker of [first, second]) {
      expect(servedBy(gw, asker, "home:alice:p1"), `asked from ${asker}`).toBe(first);
      expect(servedBy(gw, asker, "home:alice:p2")).toBeUndefined();
      expect(
        gw
          .boundSurface({ container: HOME, inbox: asker })
          .refused.get(refusalKey(second, "home:alice:p2")),
      ).toMatch(/DIFFERENT bodies|earlier claim/);
    }
  });

  it("a sibling reading of the SAME body is not held behind a claimant the root blocks", async () => {
    // The program axis is a contest only under a rival body. `first`'s reading collides with a
    // root lens and never binds; `second` shares the program with the same body under a reading
    // of its own, and the trial admits it. Held on the program name alone, it never bound.
    const { gw, first, second } = await twoPools();
    const P = "home:alice:p";
    await gw.publishRegistration(
      { ...PLANT, name: "home:alice:q" },
      { ...PLANT_POLICY, name: "home:alice:p1" },
      [FERN],
    );
    await stake(gw, first, "home:alice:p1", P);
    await stake(gw, second, "home:alice:p2", P);
    expect(servedBy(gw, second, "home:alice:p2")).toBe(second);
    expect(servedBy(gw, first, "home:alice:p1")).toBeUndefined(); // the root serves that field
    expect(
      gw
        .boundSurface({ container: HOME, inbox: first })
        .refused.get(refusalKey(first, "home:alice:p1")),
    ).toMatch(/collides/);
  });

  it("the rival does not take the name by republishing", async () => {
    const { gw, first, second } = await twoPools();
    await publish(gw, first);
    await publish(gw, second);
    await publish(gw, second, "watered");
    await publish(gw, second);
    expect(winner(gw, second)).toBe(first);
  });
});
