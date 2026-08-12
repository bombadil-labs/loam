// §11 reach into the structures a LIVE READER holds, and the H1 debt the live door was carrying
// (ticket T45). Erasure purges every tier and re-seats the gateway on the post-purge ground — but a
// subscription is a third place bytes live: the Channel between the store and a reader, and the
// closure that keeps evaluating for it — and the REGISTERED SET is a fourth. Four defects, each
// proven RED against the pre-T45 code:
//
//   1. A membership `watch` channel was never registered in `gw.channels`, so neither `reseat()`
//      nor `close()` could reach it. A reader parked ACROSS the cut was handed the erased delta —
//      full content and signature, from a live Loam API — and then froze forever on the replaced
//      reactor: no further frame, no `done`, no way to notice.
//   2. `Channel.close()` left its undrained value in the queue, and `next()` reads the queue
//      BEFORE the closed flag — so a slow reader drained a pre-cut patch (a resolved view, erased
//      field value and all) after the purge had completed.
//   3. `watchImpl` never carried the NEGATION CLOSURE of what its Term selected (hazard H1), and it
//      was the only narrowing door that didn't. A negation carries just its `negates` pointer — no
//      entity, no context — so an entity- or context-scoped Term structurally CANNOT select the
//      retraction of a claim it selects, and a reader lifting that frame resolves a retracted claim
//      as LIVE. Order is load-bearing where the two fixes meet: close first, forget last.
//   4. `reseat()` re-bound the in-memory `registered` set instead of re-deriving it, and that set is
//      a PARSED COPY of definition content — hyperschema body, schema, resolver SOURCE. So erasing a
//      published lens purged the bytes, reported a settled erasure, and kept serving the lens from
//      RAM for the life of the process: the store and its own ground disagreed about what had been
//      forgotten until a restart.
//
// ASSERTED AT BOTH LEVELS. Delta/structure: the channel is REGISTERED while open (by identity, not
// by count) and GONE from `gw.channels` after the cut — torn down, not merely inert — and a left
// Channel serves nothing it was holding. Object/reader: what the two live doors actually hand a
// reader across the cut, and — through the shared H1 rail in `narrowing.ts` — what a reader
// RESOLVES from a frame, landed in a fresh store and read through a Schema. The at-rest verdict
// rides along so "in-memory only" means something.
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT. Each is a real residual, named with the rail that
// would close it, because an honest-looking test over a gap is worse than a stated gap:
//
//   - The ESM cache (`esm.ts`). Erasing a §22 resolver or §23 renderer delta leaves its module
//     loaded, and Loam cannot evict it — the source rides a `data:` URL into Node's registry, which
//     retains it for the process lifetime. Nothing reports this either: `healthImpl` probes the
//     backend tiers and the pools, so the store calls such an erasure SETTLED while the code is
//     resident. THE RAIL: erase a published resolver, assert `loadedEsm(bundle)` is undefined and
//     that the verdict does not claim settled. It is unwritten because eviction is unavailable to
//     satisfy it — see the header of `esm.ts`.
//   - A `ModuleVersion` a caller holds in its own variable (`container-identity.ts`). The gateway
//     caches no `freeze()` result, so the retention is entirely caller-side, past the reach of the
//     purge and the fan-out. THE RAIL would have to reach into a caller's variable; there is none.
//     What CAN be railed is `freeze` refusing to mint a version over condemned members — the same
//     door-level gap `select` and `offeredDeltas` have, tracked as T90 and not fixed here.
//   - Tier completeness of the at-rest leg. It reads `backend.deltasSince`, honest for the
//     single-tier `MemoryBackend` here and primary-only under a `MirrorBackend`; `holds`/`heldAmong`
//     is the tier-complete probe, and `erase.test.ts` owns that question.

import { describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Channel } from "../../src/gateway/channel.js";
import { eraseClaims } from "../../src/gateway/erase.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, SURVEYOR, SURVEYOR_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden, governedBootstrap } from "./fixtures.js";
import { assertClosureDoesNotLeak, assertPreservesSuppression, retraction } from "./narrowing.js";

// A generous hang-guard for genuine breakage; every passing path here resolves in microseconds.
vi.setConfig({ testTimeout: 20_000 });

const KEEPER_SEED = "c3".repeat(32);
const KEEPER = authorForSeed(KEEPER_SEED);
const FORGOTTEN = "a-reader-must-not-outlive-the-cut";

// Context-scoped: the shape a retraction can never satisfy, and the shape nearly every real Term
// takes. Selects the garden's height claims and CANNOT select a strike against either.
const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};
// Every tag-bearing delta, UNION the operator's own. The erased delta is a member of the left side
// and the TOMBSTONE joins the right, so landing the removal-order moves this membership — which is
// what wakes a parked reader mid-cut. A tag-only Term would leave the pulse unfired and the leak
// unobserved (the freeze would still show; the erased frame would not).
const WATCHED = {
  op: "union",
  left: { op: "select", pred: { hasPointer: { context: { exact: "tag" } } }, in: "input" },
  right: {
    op: "select",
    pred: { match: { field: "author", cmp: "eq", const: KEEPER } },
    in: "input",
  },
};
// Author-scoped: the one shape that DOES select a retraction — so it is where §11 withholding a
// strike, rather than a Term failing to select one, is what could strand a claim.
const SURVEYORS = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: SURVEYOR } },
  in: "input",
};

const SUBSCRIPTION = `subscription {
  plant(entity: "${FERN}") { _hex tag }
}`;

async function keeperStore(): Promise<{ gw: Gateway; backend: MemoryBackend }> {
  const backend = new MemoryBackend();
  const gw = await Gateway.open(backend, { seed: KEEPER_SEED });
  await gw.append(governedBootstrap(KEEPER_SEED)); // the keeper is the operator, so the keeper erases
  await gw.append(garden);
  gw.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return { gw, backend };
}

// A read that must not park. A torn-down stream answers `done` in a microtask; a FROZEN one answers
// never, and this turns that into a named failure instead of a suite timeout.
async function promptly<T>(p: Promise<T>): Promise<T | "still parked"> {
  return Promise.race([
    p,
    new Promise<"still parked">((resolve) => {
      setTimeout(() => resolve("still parked"), 1000).unref?.();
    }),
  ]);
}

const idsOf = (frame: unknown): string[] => ((frame ?? []) as Delta[]).map((d) => d.id);

// Land a frame where a READER lives: a fresh store holding exactly the delta set the door served.
// The H1 question is never "did this id cross" but "what does a reader resolve", so every frame
// assertion below goes through one of these.
async function readerOf(frame: readonly Delta[]): Promise<Gateway> {
  const dest = await Gateway.open(new MemoryBackend(), {});
  await dest.federate(frame, { admit: () => true });
  dest.register(PLANT, PLANT_POLICY, [FERN], undefined, [...PLANT_WRITABLE]);
  return dest;
}

async function heightSeenBy(dest: Gateway): Promise<unknown> {
  const res = await dest.query(`{ Plant(entity: "${FERN}") { height } }`);
  return (res.data?.Plant as { height?: unknown } | undefined)?.height ?? null;
}

describe("§11 — a live membership watch does not outlive the cut", () => {
  it("a reader parked across the cut is handed no erased bytes, and the stream ends", async () => {
    const { gw, backend } = await keeperStore();
    const secret = observed(FERN, "tag", FORGOTTEN, 3000, GARDENER_SEED);
    await gw.append([secret]);

    const stream = gw.watch(WATCHED);
    const first = await stream.next();
    expect(idsOf(first.value)).toContain(secret.id); // pre-cut, and lawfully so
    // Registered where teardown can reach it, by IDENTITY — `watch` returns the very channel it
    // registers. Asserted while the stream is OPEN, because "empty after the cut" is also what a
    // never-registered channel looks like.
    expect(gw.channels.has(stream)).toBe(true);

    const parked = stream.next(); // park ACROSS the cut: the erase is what wakes this read
    await gw.erase(secret.id, { reason: "a watcher is a tier too" });

    const woken = await promptly(parked);
    expect(woken).not.toBe("still parked");
    // A FRAME must actually have arrived. Without this, everything below passes vacuously on a
    // `done` result (whose value is undefined), and the fixture's guarantee that the tombstone's
    // pulse lands before the teardown would be a comment rather than an assertion.
    expect(woken === "still parked" ? undefined : woken.done).toBe(false);
    const served = woken === "still parked" ? undefined : woken.value;
    expect(Array.isArray(served)).toBe(true);
    expect(idsOf(served)).not.toContain(secret.id);
    expect(JSON.stringify(served ?? [])).not.toContain(FORGOTTEN);

    // Ended, not frozen on the replaced reactor — the reader learns to resubscribe.
    const after = await promptly(stream.next());
    expect(after).not.toBe("still parked");
    expect(after === "still parked" ? undefined : after.done).toBe(true);
    // Torn down, not merely inert: nothing dead is left in the set.
    expect(gw.channels.has(stream)).toBe(false);

    // Object level, after the cut: the same door, freshly asked, and the bytes at rest.
    const reopened = gw.watch(WATCHED);
    const fresh = await reopened.next();
    expect(idsOf(fresh.value)).not.toContain(secret.id);
    expect(JSON.stringify(fresh.value ?? [])).not.toContain(FORGOTTEN);
    await reopened.return?.(undefined);
    expect(JSON.stringify(await backend.deltasSince(new Set()))).not.toContain(FORGOTTEN);
    await gw.close();
  });
});

describe("§11 — an undrained frame does not survive the cut", () => {
  it("a slow subscriber drains no pre-cut view once the erase has closed its stream", async () => {
    const { gw, backend } = await keeperStore();
    // TWO identical subscriptions. One WITNESSES that the patch exists and carries the plaintext;
    // its twin is left undrained across the cut. Without the witness, `done` alone would pass even
    // if the fixture had stopped producing a patch at all — and then the queue-drop would never be
    // exercised at this door.
    const witness = await gw.subscribe(SUBSCRIPTION);
    const slow = await gw.subscribe(SUBSCRIPTION);
    await witness.next(); // both initial snapshots drained; the queues are empty behind them
    await slow.next();

    const secret = observed(FERN, "tag", FORGOTTEN, 3000, GARDENER_SEED);
    await gw.append([secret]);
    const witnessed = await promptly(witness.next());
    expect(witnessed).not.toBe("still parked");
    expect(JSON.stringify(witnessed === "still parked" ? {} : witnessed.value)).toContain(
      FORGOTTEN,
    );
    await witness.return?.(undefined);
    // `slow` now holds that same patch, undrained, and the cut lands on top of it.
    await gw.erase(secret.id, { reason: "an undrained patch is a tier too" });

    const after = await promptly(slow.next());
    expect(after).not.toBe("still parked");
    const payload: unknown = after === "still parked" ? undefined : after.value;
    expect(JSON.stringify(payload ?? {})).not.toContain(FORGOTTEN);
    expect(after === "still parked" ? undefined : after.done).toBe(true);

    // Object level: a subscription opened after the cut sees the post-purge view, and the bytes
    // are gone at rest — the leak was the reader's channel, and it is closed.
    const reopened = await gw.subscribe(SUBSCRIPTION);
    const snapshot = await reopened.next();
    expect(JSON.stringify(snapshot.value ?? {})).not.toContain(FORGOTTEN);
    await reopened.return?.(undefined);
    expect(JSON.stringify(await backend.deltasSince(new Set()))).not.toContain(FORGOTTEN);
    await gw.close();
  });

  it("a channel that has been left forgets what it was holding", async () => {
    const ch = new Channel<string>();
    ch.push(FORGOTTEN);
    await ch.return();
    const after = await ch.next();
    expect(after.done).toBe(true);
    expect(JSON.stringify(after)).not.toContain(FORGOTTEN);
  });
});

describe("H1 — a membership frame carries what struck its members", () => {
  it("a context-scoped Term cannot select a strike, so the frame must carry the closure", async () => {
    const { gw } = await keeperStore();
    // The garden's newest height (34, the surveyor's) is retracted in her own voice. A reader over
    // the whole ground resolves 30; a frame that dropped the strike resolves 34.
    const struck = garden[1]!;
    await gw.append([retraction(struck.id, SURVEYOR, SURVEYOR_SEED, 2500)]);

    const stream = gw.watch(HEIGHTS);
    const frame = (await stream.next()).value as Delta[];
    const dest = await readerOf(frame);
    assertPreservesSuppression({
      what: "watch frame (context-scoped Term over a retracted claim)",
      source: gw,
      destination: dest,
      struckClaim: struck.id,
    });
    // The top level, not the negation index: a Schema-resolved View must not serve the struck value.
    expect(await heightSeenBy(dest)).not.toBe(34);

    await stream.return?.(undefined);
    await dest.close();
    await gw.close();
  });

  it("the closure runs forward only: a strike never drags its excluded target in", async () => {
    const { gw } = await keeperStore();
    const tag = garden[2]!; // a tag claim — outside HEIGHTS
    const tagStrike = retraction(tag.id, KEEPER, KEEPER_SEED, 2600);
    await gw.append([tagStrike]);

    const stream = gw.watch(HEIGHTS);
    const frame = (await stream.next()).value as Delta[];
    const dest = await readerOf(frame);
    assertClosureDoesNotLeak({
      what: "watch frame",
      destination: dest,
      excludedTarget: tag.id,
      itsRetraction: tagStrike.id,
    });

    await stream.return?.(undefined);
    await dest.close();
    await gw.close();
  });

  it("withholding a condemned strike withholds its target too, rather than reviving it", async () => {
    const { gw } = await keeperStore();
    // An author-scoped Term DOES select a retraction, so here §11 — not the Term — is what removes
    // it. The surveyor retracts her own height claim; the operator then condemns THE RETRACTION.
    const struck = garden[1]!;
    const strike = retraction(struck.id, SURVEYOR, SURVEYOR_SEED, 2500);
    await gw.append([strike]);
    await gw.append([
      signClaims(
        eraseClaims(strike.id, SURVEYOR, KEEPER, 4000, "the strike is condemned, not the claim"),
        KEEPER_SEED,
      ),
    ]); // a removal order that has not purged: the bytes are still ground

    const stream = gw.watch(SURVEYORS);
    const frame = (await stream.next()).value as Delta[];
    // Delta level: neither the condemned strike nor the claim it was holding down.
    expect(idsOf(frame)).not.toContain(strike.id);
    expect(idsOf(frame)).not.toContain(struck.id);
    // Reader level: nothing resolves the claim the strike was suppressing.
    const dest = await readerOf(frame);
    expect(await heightSeenBy(dest)).not.toBe(34);

    await stream.return?.(undefined);
    await dest.close();
    await gw.close();
  });
});

describe("§11 — erased law stops being SERVED, not just stops being ground", () => {
  it("re-seating re-derives the store's registrations, so an erased lens leaves the surface", async () => {
    const SECRET_LAW = "export default (bucket) => bucket.length; // law-with-a-subject-in-it";
    const backend = new MemoryBackend();
    const gw = await Gateway.open(backend, { seed: KEEPER_SEED });
    await gw.append(governedBootstrap(KEEPER_SEED));
    await gw.append(garden);
    // PUBLISHED, not registered in code: a store-origin registration is the ground's, so the cut
    // has standing over it. A manual one is this process's own and no erasure can reach it.
    const published = await gw.publishRegistration(
      PLANT,
      PLANT_POLICY,
      [FERN],
      undefined,
      undefined,
      undefined,
      [...PLANT_WRITABLE],
      { height: { rung: "a", type: "number", code: SECRET_LAW } },
    );
    expect(published.bound).toBe(true);
    expect(JSON.stringify(gw.surface()?.registered)).toContain("law-with-a-subject-in-it");

    const carriers = [...gw.reactor.snapshot()]
      .filter((d) => JSON.stringify(d.claims).includes("law-with-a-subject-in-it"))
      .map((d) => d.id);
    expect(carriers.length).toBeGreaterThan(0); // the fixture must really put the code in the ground
    for (const id of carriers) await gw.erase(id, { reason: "law is bytes too" });

    // Both levels: gone at rest, and gone from what any door is built from (`surface()` is the
    // door-neutral accessor — GraphQL, REST and OpenAPI are all generated from exactly this).
    expect(JSON.stringify(await backend.deltasSince(new Set()))).not.toContain(
      "law-with-a-subject-in-it",
    );
    expect(JSON.stringify(gw.surface()?.registered ?? [])).not.toContain(
      "law-with-a-subject-in-it",
    );
    await gw.close();
  });
});

describe("§11 — forgiveness returns a member to the live frame", () => {
  it("a struck tombstone restores what it condemned, on the very next pulse", async () => {
    const { gw } = await keeperStore();
    const held = garden[1]!;
    const tombstone = signClaims(
      eraseClaims(held.id, SURVEYOR, KEEPER, 4000, "condemned, then forgiven"),
      KEEPER_SEED,
    );
    await gw.append([tombstone]);

    const stream = gw.watch(HEIGHTS);
    const condemned = (await stream.next()).value as Delta[];
    expect(idsOf(condemned)).not.toContain(held.id); // the order binds while it stands

    // Forgiveness is striking the tombstone, in the operator's own voice — never a lucky re-send.
    // Recovery rides the dead set being RE-READ per pulse: a memo that outlived a pulse would leave
    // this member condemned for the life of the process, which is what this rail is here to stop.
    await gw.append([retraction(tombstone.id, KEEPER, KEEPER_SEED, 4100)]);
    const forgiven = await promptly(stream.next());
    expect(forgiven).not.toBe("still parked");
    expect(idsOf(forgiven === "still parked" ? undefined : forgiven.value)).toContain(held.id);

    await stream.return?.(undefined);
    await gw.close();
  });
});
