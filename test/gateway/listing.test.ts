// The listing door (ticket T110), railed at BOTH levels (the P3 rule):
//
//   OBJECT — what the door serves: `plants(limit, after)` on the AUTHED GraphQL surface names
//   the distinct entities holding Plant evidence, resolved through the lens, sparse views and
//   all; the public/read surface refuses the field exactly as it refuses one that never existed.
//
//   DELTA — what the container actually holds: the first listing declares a lawful shared
//   container backing the hyperschema (`container:hyperschema:Plant`), its membership Term is
//   the gather's selection un-rooted, its member set is exactly the evidence deltas, and the
//   container ALGEBRA is load-bearing — excluding the container empties the listing, which a
//   bespoke scan could never honor.
//
// Deliberate gaps, named: `select` applies no dead-set filter, so a condemned-but-not-yet-purged
// delta still lists until its purge lands — T90 owns aligning the point-read doors, and the rail
// that closes it belongs there. Claims in contexts no registered lens reads as a prop are not
// members (evidence-level membership is "bucketed how", and the buckets are the props); a
// dynamic-only entity is invisible to the listing by design.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  parseTerm,
  signClaims,
  type HyperSchema,
} from "@bombadil/rhizomatic";
import { governedGatherBody, grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  LISTING_MAX_LIMIT,
  listingContainerName,
  listingMembershipJson,
} from "../../src/gateway/listing.js";
import {
  containerClaims,
  detachClaims,
  exclusionClaims,
  termClaims,
} from "../../src/gateway/container.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, pickLatest } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const MALLORY_SEED = "ee".repeat(32);
const MALLORY = authorForSeed(MALLORY_SEED);
const MOSS = "plant:moss";
const OAK = "plant:oak";

async function governedGarden(): Promise<Gateway> {
  const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gw.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1), OPERATOR_SEED),
  ]);
  gw.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return gw;
}

const entitiesOf = (nodes: readonly { entity: string }[]): string[] => nodes.map((n) => n.entity);

describe("the listing door — object level: what the authed door serves", () => {
  it("lists the distinct entities holding evidence, ascending, sparse views intact", async () => {
    const gw = await governedGarden();
    await gw.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(FERN, "tag", "shade", 1100, GARDENER_SEED),
      observed(MOSS, "tag", "soft", 1200, GARDENER_SEED), // no height: resolves sparse
      observed(OAK, "height", 900, 1300, GARDENER_SEED),
    ]);
    const read = await gw.query(`{ plants { _entity height tag } }`);
    expect(read.errors).toBeUndefined();
    const plants = (read.data as { plants: { _entity: string; height: unknown; tag: unknown }[] })
      .plants;
    // Ascending by entity id, and NOT bounded by the registered roots: moss and oak are no
    // gateway root, and the listing still finds them — enumeration reads the container, not
    // the root list.
    expect(plants.map((p) => p._entity)).toEqual([FERN, MOSS, OAK]);
    // The §14 edge rides along: evidence-level membership, per-lens resolution — moss holds
    // Plant evidence yet resolves with no height. Absence stays absence.
    expect(plants[1]!.height).toBeNull();
    expect(plants[1]!.tag).toEqual(["soft"]);
    await gw.close();
  });

  it("paginates on an exclusive after-cursor over the ascending order", async () => {
    const gw = await governedGarden();
    const names = ["plant:a", "plant:b", "plant:c", "plant:d", "plant:e"];
    await gw.append(names.map((n, i) => observed(n, "height", i, 1000 + i, GARDENER_SEED)));
    const one = await gw.list("Plant", { limit: 2 });
    expect(entitiesOf(one)).toEqual(["plant:a", "plant:b"]);
    const two = await gw.list("Plant", { limit: 2, after: "plant:b" });
    expect(entitiesOf(two)).toEqual(["plant:c", "plant:d"]);
    const three = await gw.list("Plant", { limit: 2, after: "plant:d" });
    expect(entitiesOf(three)).toEqual(["plant:e"]);
    // Through the door, the same page: the args ride the field.
    const read = await gw.query(`{ plants(limit: 1, after: "plant:c") { _entity } }`);
    expect((read.data as { plants: { _entity: string }[] }).plants.map((p) => p._entity)).toEqual([
      "plant:d",
    ]);
    await gw.close();
  });

  it("bounds the page: each listed entity costs a resolution", async () => {
    const gw = await governedGarden();
    await expect(gw.list("Plant", { limit: 0 })).rejects.toThrow(/between 1 and/);
    await expect(gw.list("Plant", { limit: LISTING_MAX_LIMIT + 1 })).rejects.toThrow(
      /between 1 and/,
    );
    // The bounds are PROMISES, pinned as literals so a drifted constant is a red bar, not a
    // silently wider door (a hollow-test survivor bought these two lines). The literal is 25
    // because a resolution costs ~655ms at a 10k-delta ground: 25 is ~16s of work for one caller
    // and the old 500 was ~330s. Widening it is a measurement, not a preference.
    await expect(gw.list("Plant", { limit: 26 })).rejects.toThrow(/between 1 and 25/);
    await expect(gw.list("Plant", { limit: 25 })).resolves.toEqual([]);
    await gw.close();
  });

  it("defaults to a modest page: exactly 10 entities when none is asked for", async () => {
    const gw = await governedGarden();
    const names = Array.from({ length: 30 }, (_, i) => `plant:p${String(i).padStart(2, "0")}`);
    await gw.append(names.map((n, i) => observed(n, "height", i, 1000 + i, GARDENER_SEED)));
    const page = await gw.list("Plant");
    expect(page).toHaveLength(10); // the literal IS the promise; widen it deliberately or not at all
    expect(entitiesOf(page)).toEqual(names.slice(0, 10));
    await gw.close();
  });

  it("yields the event loop between resolutions — one page cannot stall the process", async () => {
    const gw = await governedGarden();
    const names = Array.from({ length: 8 }, (_, i) => `plant:y${i}`);
    await gw.append(names.map((n, i) => observed(n, "height", i, 1000 + i, GARDENER_SEED)));
    // Warm first: the FIRST listing declares the container, and that `append` is real async I/O
    // which would let a timer through on its own. After it, the only macrotask a listing schedules
    // is the deliberate yield — so this measures the yield and nothing else.
    await gw.list("Plant", { limit: 1 });
    const tickDuring = async (limit: number): Promise<boolean> => {
      let ticked = false;
      const timer = setTimeout(() => {
        ticked = true;
      }, 0);
      await gw.list("Plant", { limit });
      clearTimeout(timer);
      return ticked;
    };
    // A one-entity page resolves in one run and needs no yield — the negative control that keeps
    // this from passing on some other await hiding in the door.
    expect(await tickDuring(1)).toBe(false);
    // An eight-entity page yields between resolutions: the timer fires mid-page. Under the old
    // synchronous `page.map` every other mount waited for the whole page.
    expect(await tickDuring(8)).toBe(true);
    await gw.close();
  });

  it("a lens whose name IS another lens's listing field refuses at build, both orders", async () => {
    // "Plant" serves `plant` + `plants`; a lens named "Plants" serves `plants`. One word, two
    // meanings — the build refuses whichever arrives second, never silently picking a winner.
    const first = await governedGarden(); // Plant is registered
    expect(() => first.register({ ...PLANT, name: "Plants" }, PLANT_POLICY, [FERN])).toThrowError(
      /collides/,
    );
    await first.close();
    const second = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    second.register({ ...PLANT, name: "Plants" }, PLANT_POLICY, [FERN]);
    expect(() => second.register(PLANT, PLANT_POLICY, [FERN])).toThrowError(/collides/);
    await second.close();
  });

  it("refuses an unregistered lens in the door's own voice", async () => {
    const gw = await governedGarden();
    await expect(gw.list("Nope")).rejects.toThrow(/no registered schema named Nope/);
    await gw.close();
  });

  it("refuses on an ungoverned store: no operator, no container, no silent fallback", async () => {
    const gw = await Gateway.open(new MemoryBackend()); // no seed
    gw.register(PLANT, PLANT_POLICY, [FERN]);
    await expect(gw.list("Plant")).rejects.toThrow(/ungoverned store has no operator/);
    await gw.close();
  });
});

describe("the listing door — delta level: what the container actually holds", () => {
  it("the first listing declares the backing container, and its members are the evidence", async () => {
    const gw = await governedGarden();
    const evidence = [
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(MOSS, "tag", "soft", 1200, GARDENER_SEED),
    ];
    await gw.append(evidence);
    expect(gw.containers().containers.size).toBe(0); // nothing declared before the first list
    await gw.list("Plant");
    const name = listingContainerName("Plant");
    const declared = gw.containers().containers.get(name);
    expect(declared).toBeDefined();
    expect(declared!.trust).toBe("curated");
    expect(declared!.posture).toBe("shared");
    // The membership Term is the gather's selection un-rooted: the lens's prop contexts, sorted.
    expect(declared!.membership).toEqual(
      listingMembershipJson(["height", "readings", "tag", "watered"], "drop"),
    );
    // And the container HOLDS exactly the evidence, as deltas.
    const members = gw.containerScope({ containers: [name] });
    expect(members.map((d) => d.id).sort()).toEqual(evidence.map((d) => d.id).sort());
    await gw.close();
  });

  it("a claim in a context no lens reads is not a member — bucketed how, not merely at whom", async () => {
    const gw = await governedGarden();
    await gw.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(MOSS, "aroma", "loamy", 1100, GARDENER_SEED), // no lens reads "aroma" as a prop
    ]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]);
    const members = gw.containerScope({ containers: [listingContainerName("Plant")] });
    expect(members.some((d) => d.claims.timestamp === 1100)).toBe(false);
    await gw.close();
  });

  it("a sibling lens widens the membership: latest-wins refresh, both levels", async () => {
    const gw = await governedGarden();
    await gw.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(MOSS, "note", "check weekly", 1100, GARDENER_SEED),
    ]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]); // "note" is nobody's prop yet
    // A sibling lens over the SAME hyperschema (§21.7) reads "note" as a prop.
    await gw.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["note", pickLatest]]), default: pickLatest },
      [FERN],
    );
    // Delta level: the container's membership re-declares with the widened context union...
    await gw.list("Sketch");
    const declared = gw.containers().containers.get(listingContainerName("Plant"));
    expect(declared!.membership).toEqual(
      listingMembershipJson(["height", "note", "readings", "tag", "watered"], "drop"),
    );
    // ...and object level: the ONE maintained candidate set now feeds EVERY lens over the
    // hyperschema — moss lists through Sketch and through Plant alike.
    expect(entitiesOf(await gw.list("Sketch"))).toEqual([FERN, MOSS]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN, MOSS]);
    await gw.close();
  });

  it("suppression closes at both levels: the struck claim's entity drops, bystanders stay", async () => {
    const gw = await governedGarden();
    const mossTag = observed(MOSS, "tag", "soft", 1200, GARDENER_SEED);
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED), mossTag]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN, MOSS]);
    // The author retracts their own claim — an ordinary negation delta.
    await gw.append([signClaims(makeNegationClaims(GARDENER, 2000, mossTag.id), GARDENER_SEED)]);
    // Delta level: the struck claim is no longer a member (mask "drop" runs over the ground).
    const members = gw.containerScope({ containers: [listingContainerName("Plant")] });
    expect(members.some((d) => d.id === mossTag.id)).toBe(false);
    // Object level: the door no longer names moss; the live bystander survives (two-sided).
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]);
    await gw.close();
  });

  it("an evolved lens narrows the membership: the superseded binding's contexts do not linger", async () => {
    const gw = await governedGarden();
    await gw.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(MOSS, "note", "check weekly", 1100, GARDENER_SEED),
    ]);
    // A sibling lens reads "note"; moss lists.
    await gw.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["note", pickLatest]]), default: pickLatest },
      [FERN],
    );
    expect(entitiesOf(await gw.list("Sketch"))).toEqual([FERN, MOSS]);
    // The lens EVOLVES in place and stops reading "note". The flat registration list still
    // holds the superseded binding beside the survivor; the membership must follow the
    // survivor (a P5 lens's finding: a union drawn from the flat list keeps admitting
    // contexts no surviving lens reads).
    await gw.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["watered", pickLatest]]), default: pickLatest },
      [FERN],
    );
    expect(entitiesOf(await gw.list("Sketch"))).toEqual([FERN]); // the refresh rides the read
    const declared = gw.containers().containers.get(listingContainerName("Plant"));
    expect(declared!.membership).toEqual(
      listingMembershipJson(["height", "readings", "tag", "watered"], "drop"),
    );
    await gw.close();
  });

  it("refuses a name squatted by a container with other knobs — never reads through it", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    // The operator already declared this exact name curated/SEPARATE. Trust and posture are
    // immutable (§28.4), so the listing can never repair it — and a separate posture would
    // read a pool's snapshot as "the Plants". The door must refuse, loudly, up front.
    await gw.append([
      signClaims(
        containerClaims(
          { container: listingContainerName("Plant"), trust: "curated", posture: "separate" },
          OPERATOR,
          2000,
        ),
        OPERATOR_SEED,
      ),
    ]);
    // Pinned to the GUARD's own voice, not the append door's immutability refusal: the guard
    // must fire up front, before the short-circuit path could ever read through a separate
    // pool's snapshot (with an equal membership term the short-circuit skips the append door
    // entirely, so the downstream refusal cannot be the rail).
    await expect(gw.list("Plant")).rejects.toThrow(
      /reads only through the curated\/shared container it declares itself/,
    );
    await gw.close();
  });

  it("refuses a DETACHED backing container instead of serving a complete-looking empty page", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]);
    const name = listingContainerName("Plant");
    await gw.append([signClaims(detachClaims(name, undefined, OPERATOR, 3000), OPERATOR_SEED)]);
    // Detach means "off the record", and this caller never named a container: an empty page
    // would read as "no plants" (H9). Exclusion is the deliberate way to empty a listing.
    await expect(gw.list("Plant")).rejects.toThrow(/DETACHED/);
    await gw.close();
  });

  it("a refresh carries the standing knobs — a read never re-roots a nested container", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await gw.list("Plant");
    const name = listingContainerName("Plant");
    // The operator nests the listing container under a parent and cites a version. Both are
    // knobs this door never sets, and a declaration is latest-wins over the WHOLE record.
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: "container:garden",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { hasPointer: { context: { exact: "nothing" } } },
              in: "input",
            },
          },
          OPERATOR,
          gw.nextTimestamp(),
        ),
        OPERATOR_SEED,
      ),
      signClaims(
        containerClaims(
          {
            container: name,
            trust: "curated",
            posture: "shared",
            parent: "container:garden",
            version: "deadbeef",
            membership: gw.containers().containers.get(name)!.membership,
          },
          OPERATOR,
          gw.nextTimestamp(),
        ),
        OPERATOR_SEED,
      ),
    ]);
    // A sibling lens widens the context union, so the next read MUST re-declare.
    await gw.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["note", pickLatest]]), default: pickLatest },
      [FERN],
    );
    await gw.list("Sketch");
    const after = gw.containers().containers.get(name)!;
    expect(after.membership).toEqual(
      listingMembershipJson(["height", "note", "readings", "tag", "watered"], "drop"),
    );
    // The knobs the refresh knew nothing about survive it. Dropping them would silently un-nest
    // a container the operator placed — a read undoing a write.
    expect(after.parent).toBe("container:garden");
    expect(after.version).toBe("deadbeef");
    await gw.close();
  });

  it("refuses a backing container whose membership lives at an address, not inline", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    const name = listingContainerName("Plant");
    const published = signClaims(
      termClaims(
        listingMembershipJson(["height", "readings", "tag", "watered"], "drop"),
        OPERATOR,
        2000,
      ),
      OPERATOR_SEED,
    );
    await gw.append([published]);
    await gw.append([
      signClaims(
        containerClaims(
          { container: name, trust: "curated", posture: "shared", membershipAt: published.id },
          OPERATOR,
          2100,
        ),
        OPERATOR_SEED,
      ),
    ]);
    // The door compares the INLINE Term. An addressed membership can never match it, so serving
    // would mint one operator-signed declaration per read, forever. Refuse instead.
    await expect(gw.list("Plant")).rejects.toThrow(/membership at a published address/);
    await gw.close();
  });

  it("the container algebra is load-bearing: excluding the container empties the listing", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    expect(entitiesOf(await gw.list("Plant"))).toEqual([FERN]);
    const name = listingContainerName("Plant");
    await gw.append([signClaims(exclusionClaims(name, OPERATOR, 3000), OPERATOR_SEED)]);
    // A listing that bypassed the container scope would still serve fern here. It must not:
    // the enumeration IS a container read, so the operator's exclusion governs it.
    expect(await gw.list("Plant")).toEqual([]);
    const read = await gw.query(`{ plants { _entity } }`);
    expect((read.data as { plants: unknown[] }).plants).toEqual([]);
    await gw.close();
  });
});

// The candidate set suppresses by the PROGRAM'S OWN mask, never by a hardcoded posture. Every
// rail above strikes with the AUTHOR'S OWN retraction, which binds under `drop` and under a trust
// mask alike — so none of them can see the difference, and a hardcoded `drop` passed all of them
// while handing a federated stranger a veto over the enumeration. These strike with a STRANGER:
// no standing, no grant, arriving by `federate`, which asks for none.
describe("the listing door — the candidate set reads under the program's own mask", () => {
  const GUARDED: HyperSchema = { name: "Guarded", alg: 1, body: governedGatherBody(OPERATOR) };
  // No mask at all: nothing suppresses, and the membership must invent no suppression either.
  const UNMASKED: HyperSchema = {
    name: "Unmasked",
    alg: 1,
    body: parseTerm({
      op: "group",
      key: "byTargetContext",
      in: { op: "select", pred: { hasPointer: { targetEntity: { var: "root" } } }, in: "input" },
    }),
  };

  // A governed store where the gardener has made moss's ONLY claim, and a stranger has struck it.
  async function heckled(hyperschema: HyperSchema): Promise<{ gw: Gateway; struck: string }> {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gw.append([
      signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1), OPERATOR_SEED),
    ]);
    gw.register(hyperschema, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const mossTag = observed(MOSS, "tag", "soft", 1200, GARDENER_SEED);
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED), mossTag]);
    // Federation asks for no standing: mallory holds no grant and is nobody's trusted striker.
    await gw.federate([signClaims(makeNegationClaims(MALLORY, 3000, mossTag.id), MALLORY_SEED)]);
    return { gw, struck: mossTag.id };
  }

  it("a stranger's strike cannot delete an entity from a governed listing", async () => {
    const { gw, struck } = await heckled(GUARDED);
    // The point door still resolves moss — the trust mask makes the stranger inert (the rail at
    // test/gateway/lenses.test.ts pins that for the reading). The listing must AGREE: an entity
    // missing from an enumeration reads as "there is no such entity", a bigger claim than any
    // point read makes, and it must not be a stranger's to make.
    const point = await gw.query(`{ guarded(entity: "${MOSS}") { tag } }`);
    expect((point.data as { guarded: { tag: string[] } }).guarded.tag).toEqual(["soft"]);
    // Object level: moss is listed, beside its live bystander.
    expect(entitiesOf(await gw.list("Guarded"))).toEqual([FERN, MOSS]);
    // Delta level: the struck claim is still a member, and the membership Term says why — a
    // TRUST policy, hand-read here rather than recomputed from the code under test (H10).
    const name = listingContainerName("Guarded");
    expect(gw.containerScope({ containers: [name] }).some((d) => d.id === struck)).toBe(true);
    const membership = gw.containers().containers.get(name)!.membership as {
      in: { op: string; policy: Record<string, unknown> };
    };
    expect(membership.in.op).toBe("mask");
    expect(membership.in.policy).not.toBe("drop");
    expect(Object.keys(membership.in.policy)).toEqual(["trust"]);
    await gw.close();
  });

  it("a LAWFUL striker still empties it — the mask is honored, not merely bypassed", async () => {
    const { gw } = await heckled(GUARDED);
    // The gardener holds a surviving operator grant, so she is in the trusted set: her own
    // retraction binds where mallory's did not. Without this the rail above would pass equally
    // well against a listing that suppressed NOTHING.
    const mine = [...gw.reactor.snapshot()].find(
      (d) => d.claims.author === GARDENER && d.claims.timestamp === 1200,
    )!;
    await gw.append([signClaims(makeNegationClaims(GARDENER, 4000, mine.id), GARDENER_SEED)]);
    expect(entitiesOf(await gw.list("Guarded"))).toEqual([FERN]); // two-sided: fern survives
    await gw.close();
  });

  it("an unmasked body masks nothing in its candidate set either — no invented suppression", async () => {
    const { gw, struck } = await heckled(UNMASKED);
    const name = listingContainerName("Unmasked");
    expect(entitiesOf(await gw.list("Unmasked"))).toEqual([FERN, MOSS]);
    // `in: "input"` — the select runs over the raw ground, because the reading does too.
    expect(gw.containers().containers.get(name)!.membership).toEqual({
      op: "select",
      pred: { hasPointer: { context: { inSet: ["height", "readings", "tag", "watered"] } } },
      in: "input",
    });
    expect(gw.containerScope({ containers: [name] }).some((d) => d.id === struck)).toBe(true);
    // And the author's OWN retraction leaves it listed too: an unmasked body suppresses nothing,
    // so a candidate set that dropped anything here would be narrower than its own reading.
    await gw.append([signClaims(makeNegationClaims(GARDENER, 4000, struck), GARDENER_SEED)]);
    expect(entitiesOf(await gw.list("Unmasked"))).toEqual([FERN, MOSS]);
    await gw.close();
  });

  it("refuses a body that masks two ways — one listing, one candidate set", async () => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    // `annotate` over the ordinary `drop`: two postures in one program, and no answer to "which
    // one is the candidate set". Guessing would silently pick a suppression rule the operator
    // never wrote; the door names the problem instead.
    gw.register(
      {
        name: "TwoMinds",
        alg: 1,
        body: parseTerm({
          op: "group",
          key: "byTargetContext",
          in: {
            op: "select",
            pred: { hasPointer: { targetEntity: { var: "root" } } },
            in: { op: "mask", policy: "annotate", in: { op: "mask", policy: "drop", in: "input" } },
          },
        }),
      },
      PLANT_POLICY,
      [FERN],
    );
    await expect(gw.list("TwoMinds")).rejects.toThrow(/masks negations 2 different ways/);
    await gw.close();
  });
});

describe("the listing door — the refusal shapes: authed only", () => {
  it("the public surface refuses the field exactly as one that never existed", async () => {
    const gw = await governedGarden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await gw.declarePublic(["Plant"]);
    // The public read surface serves the singular field...
    const point = await gw.queryPublic(`{ plant(entity: "${FERN}") { height } }`);
    expect((point.data as { plant: { height: number } }).plant.height).toBe(30);
    // ...and the listing field is a validation impossibility on it, byte-for-byte the refusal
    // a never-registered field gets (modulo the name asked for): no oracle distinguishes "this
    // exists behind a token" from "this does not exist".
    const listing = await gw.queryPublic(`{ plants { _entity } }`);
    const nonsense = await gw.queryPublic(`{ plantz { _entity } }`);
    expect(listing.data).toBeUndefined();
    expect(listing.errors).toHaveLength(1);
    expect(listing.errors![0]!.replace(`"plants"`, `"plantz"`)).toBe(nonsense.errors![0]);
    await gw.close();
  });
});
