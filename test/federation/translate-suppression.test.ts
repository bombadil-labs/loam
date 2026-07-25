// T58 — suppression must follow the `translates` edge. A translation is a COPY of a claim out of
// the ground into a fresh id (H4: a different author mints a different delta), so no negation of
// the source can ever reach the rendering: the pass checks survival ONCE, at emit time, and
// nothing links the two afterwards. A strike on the source on Tuesday therefore leaves Monday's
// canonical rendering LIVE — for every lens, every door, and every peer pulling the offer — and
// re-running the pass cannot repair it, because union swallows the identical emission whole. That
// is hazard H1 at its most durable: the narrowing is a RE-ASSERTION rather than a filter.
//
// The rails assert at BOTH levels: what the deltas say (a surviving negation of the emission,
// through the shared `isSuppressed`) AND what a reader resolves — two registered lenses, the
// `drop`-masked canonical one and the trust-masked governed one, plus a PEER that pulled the
// offer, checked through `assertPreservesSuppression`.
//
// Two rails guard against an OVER-broad fix rather than against the defect, and so are green
// before it as well: the one-way rail (a strike on the rendering must never retract its source)
// and the `assertClosureDoesNotLeak` leg (a peer receives the strike by the forward closure, never
// by the offer widening backward onto a source it excluded).
//
// Not asserted here, deliberately: the HTTP doors — the peer leg goes through `offeredDeltas`,
// which is what `GET /federate` serves (pinned byte-for-byte in offer.test.ts), so the door adds no
// third behavior to pin. Nor an ERASED (§11-purged) source: a rendering whose source's bytes are
// gone is an erasure-completeness question, and `dataStruck` answers only for deltas the store
// still holds. The rail that would close it belongs with erasure — a tombstone on a source must
// reach the renderings that cite it — and it is not a suppression rail.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  parseTerm,
  signClaims,
  type Delta,
  type Policy,
  type Schema,
  type Term,
} from "@bombadil/rhizomatic";
import { governedGatherBody, grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { translate, translationClaims } from "../../src/federation/translate.js";
import { MemoryBackend } from "../../src/store/memory.js";
import {
  assertClosureDoesNotLeak,
  assertPreservesSuppression,
  isPresent,
  isSuppressed,
  retraction,
} from "../gateway/narrowing.js";
import { PLANT, pickLatest } from "../gateway/fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const TRANSLATOR_SEED = "0d".repeat(32);
const TRANSLATOR = authorForSeed(TRANSLATOR_SEED);
const CINELOG_SEED = "ab".repeat(32);
const CINELOG = authorForSeed(CINELOG_SEED);

const WREN = "person:wren";
const STALKER = "film:stalker";

// A foreign dialect's entry: "viewer watched film on date", the cinelog app's own shape.
const cinelogEntry = (ts: number, film = STALKER): Delta =>
  signClaims(
    {
      timestamp: ts,
      author: CINELOG,
      pointers: [
        { role: "film_watched", target: { kind: "entity", entity: { id: film, context: "log" } } },
        {
          role: "viewer",
          target: { kind: "entity", entity: { id: WREN, context: "watch_history" } },
        },
        { role: "on", target: { kind: "primitive", value: "2026-07-08" } },
      ],
    },
    CINELOG_SEED,
  );

const CINELOG_SPEC = {
  recognize: {
    and: [
      { hasPointer: { role: { exact: "film_watched" } } },
      { hasPointer: { role: { exact: "viewer" } } },
    ],
  },
  emit: {
    pointers: [
      { role: "guest", at: { from: { role: "viewer" } }, context: "events_attended" },
      { role: "film", at: { from: { role: "film_watched" } }, context: "screenings" },
      { role: "date", value: { from: { role: "on" } } },
      { role: "origin", value: "cinelog" },
    ],
  },
};

const ATTENDANCE_SCHEMA: Schema = {
  props: new Map<string, Policy>([
    ["events_attended", { kind: "all", order: { kind: "byTimestamp", dir: "asc" } }],
  ]),
  default: pickLatest,
};

// An offered lens that selects the RENDERINGS and nothing else — the emission carries a `guest`
// pointer, a bare negation does not. So the strike reaches a peer only through the offer's forward
// negation closure, which is what makes the leak leg load-bearing.
const RENDERINGS_ONLY: Term = parseTerm({
  op: "select",
  pred: { hasPointer: { role: { exact: "guest" } } },
  in: "input",
});

// Both readings over the same root: `attendance` masks with `drop` (every negation present binds)
// and `guarded` with the governed trust mask (only the operator and their grantees strike). A fix
// that satisfies one reader and not the other is the drift T58 exists to close.
function readings(gateway: Gateway): void {
  gateway.register({ ...PLANT, name: "Attendance" }, ATTENDANCE_SCHEMA, [WREN]);
  gateway.register(
    { name: "Guarded", alg: 1, body: governedGatherBody(OPERATOR) },
    ATTENDANCE_SCHEMA,
    [WREN],
  );
}

async function translatedWorld(offeredLens?: Term): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), {
    seed: OPERATOR_SEED,
    ...(offeredLens === undefined ? {} : { offeredLens }),
  });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, TRANSLATOR, "write", OPERATOR, 1), OPERATOR_SEED),
    // The cinelog app publishes THROUGH this store, so its own strikes are the community's —
    // honored by every governed reader, which is the standing the pass must evaluate under.
    signClaims(grantClaims(STORE_ENTITY, CINELOG, "write", OPERATOR, 2), OPERATOR_SEED),
    signClaims(
      translationClaims("cinelog", CINELOG_SPEC.recognize, CINELOG_SPEC.emit, OPERATOR, 3),
      OPERATOR_SEED,
    ),
  ]);
  readings(gateway);
  return gateway;
}

// The rendering this pass minted for `sourceId`, or undefined if it never minted one.
const renderingOf = (gateway: Gateway, sourceId: string): Delta | undefined =>
  [...gateway.reactor.snapshot()].find((d) =>
    d.claims.pointers.some(
      (p) =>
        p.role === "translates" &&
        p.target.kind === "delta" &&
        p.target.deltaRef.delta === sourceId,
    ),
  );

// What a READER resolves through a named lens — the object level, never the negation index.
const serves = async (gateway: Gateway, lens: string): Promise<string> =>
  JSON.stringify((await gateway.query(`{ ${lens}(entity: "${WREN}") { events_attended } }`)).data);

describe("T58 — a retraction reaches the canonical rendering across the `translates` edge", () => {
  it("a strike on the source AFTER the pass retracts the rendering, at both levels", async () => {
    const gateway = await translatedWorld();
    const foreign = cinelogEntry(5000);
    await gateway.federate([foreign]);
    expect((await translate(gateway, { seed: TRANSLATOR_SEED })).emitted).toBe(1);
    const rendering = renderingOf(gateway, foreign.id)!;
    expect(rendering).toBeDefined();
    // The fixture must be FORCEFUL: both readers serve the rendered fact before the strike, or
    // the absences below would prove nothing.
    expect(await serves(gateway, "attendance")).toContain(STALKER);
    expect(await serves(gateway, "guarded")).toContain(STALKER);

    // Tuesday: the operator lawfully strikes the source. The rendering is a different delta with
    // a different author — nothing in the ground says it is dead.
    await gateway.append([retraction(foreign.id, OPERATOR, OPERATOR_SEED, 6000)]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report.retracted).toBe(1);

    // Delta level: the copy now carries a surviving strike of its own.
    expect(isSuppressed(gateway, rendering.id)).toBe(true);
    // Object level: neither reading serves the retired fact.
    expect(await serves(gateway, "attendance")).not.toContain(STALKER);
    expect(await serves(gateway, "guarded")).not.toContain(STALKER);
    await gateway.close();
  });

  it("the pass is idempotent: a second reconciliation mints no second strike", async () => {
    const gateway = await translatedWorld();
    const foreign = cinelogEntry(5000);
    await gateway.federate([foreign]);
    await translate(gateway, { seed: TRANSLATOR_SEED });
    const rendering = renderingOf(gateway, foreign.id)!;
    await gateway.append([retraction(foreign.id, OPERATOR, OPERATOR_SEED, 6000)]);

    expect((await translate(gateway, { seed: TRANSLATOR_SEED })).retracted).toBe(1);
    const again = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(again.retracted ?? 0).toBe(0); // nothing left to reconcile
    // One strike, not one per pass: the retraction's timestamp is derived, so its id converges.
    expect(gateway.reactor.negationsOf(rendering.id)).toHaveLength(1);
    expect(isSuppressed(gateway, rendering.id)).toBe(true);
    await gateway.close();
  });

  it("a retired spec does not strand its renderings: reconciliation is not gated on specs", async () => {
    const gateway = await translatedWorld();
    const foreign = cinelogEntry(5000);
    await gateway.federate([foreign]);
    await translate(gateway, { seed: TRANSLATOR_SEED });
    const rendering = renderingOf(gateway, foreign.id)!;

    // The operator retires the spec, THEN strikes the source. No spec survives to recognize
    // anything — and the held rendering still has to die.
    const spec = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === "loam.translation",
      ),
    )!;
    await gateway.append([
      retraction(spec.id, OPERATOR, OPERATOR_SEED, 6000),
      retraction(foreign.id, OPERATOR, OPERATOR_SEED, 6001),
    ]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report).toMatchObject({ matched: 0, emitted: 0, retracted: 1 });
    expect(isSuppressed(gateway, rendering.id)).toBe(true);
    expect(await serves(gateway, "attendance")).not.toContain(STALKER);
    await gateway.close();
  });

  it("a peer pulling the offer receives the rendering only with what struck it", async () => {
    const gateway = await translatedWorld();
    const foreign = cinelogEntry(5000);
    await gateway.federate([foreign]);
    await translate(gateway, { seed: TRANSLATOR_SEED });
    const rendering = renderingOf(gateway, foreign.id)!;
    await gateway.append([retraction(foreign.id, OPERATOR, OPERATOR_SEED, 6000)]);
    await translate(gateway, { seed: TRANSLATOR_SEED });

    const peer = await Gateway.open(new MemoryBackend(), {});
    await peer.federate(gateway.offeredDeltas(), { admit: () => true });
    assertPreservesSuppression({
      what: "translate (a rendering offered onward across the `translates` edge)",
      source: gateway,
      destination: peer,
      struckClaim: rendering.id,
    });
    // And the object level at the DESTINATION: a peer's own lens must not serve it either.
    readings(peer);
    expect(await serves(peer, "attendance")).not.toContain(STALKER);
    await peer.close();
    await gateway.close();
  });

  it("the strike crosses a narrowed offer forward, and drags nothing backward", async () => {
    const gateway = await translatedWorld(RENDERINGS_ONLY);
    const foreign = cinelogEntry(5000);
    await gateway.federate([foreign]);
    await translate(gateway, { seed: TRANSLATOR_SEED });
    const rendering = renderingOf(gateway, foreign.id)!;
    const strike = retraction(foreign.id, OPERATOR, OPERATOR_SEED, 6000);
    await gateway.append([strike]);
    await translate(gateway, { seed: TRANSLATOR_SEED });

    const peer = await Gateway.open(new MemoryBackend(), {});
    await peer.federate(gateway.offeredDeltas(), { admit: () => true });
    // The offer selects renderings only, so the rendering's strike rides the forward closure.
    assertPreservesSuppression({
      what: "translate under an offered lens selecting renderings only",
      source: gateway,
      destination: peer,
      struckClaim: rendering.id,
    });
    // ...and the closure runs forward ONLY: the excluded foreign source, and the negation that
    // struck it, must not be dragged across by the remedy.
    assertClosureDoesNotLeak({
      what: "translate under an offered lens selecting renderings only",
      destination: peer,
      excludedTarget: foreign.id,
      itsRetraction: strike.id,
    });
    await peer.close();
    await gateway.close();
  });

  it("the edge is one-way: striking a rendering never retracts its source", async () => {
    const gateway = await translatedWorld();
    const foreign = cinelogEntry(5000);
    await gateway.federate([foreign]);
    await translate(gateway, { seed: TRANSLATOR_SEED });
    const rendering = renderingOf(gateway, foreign.id)!;

    // The operator strikes the RENDERING — a reading they disagree with. The foreign claim it
    // was read from stands: a copy's death says nothing about its original.
    await gateway.append([retraction(rendering.id, OPERATOR, OPERATOR_SEED, 6000)]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report.retracted ?? 0).toBe(0);
    expect(isSuppressed(gateway, foreign.id)).toBe(false);
    expect(isPresent(gateway, foreign.id)).toBe(true);
    await gateway.close();
  });
});

describe("T58 — the pass evaluates a source's survival as DATA, not as law", () => {
  it("a grantee's retraction of their own claim is honored by the pass, not undone by it", async () => {
    const gateway = await translatedWorld();
    const own = cinelogEntry(5000);
    await gateway.append([own]);
    // The cinelog app retracts its own claim, in its OWN voice — the shape `clearEntity` writes.
    // Every governed reader now sees it struck; a pass reading operator-only standing would not.
    await gateway.append([retraction(own.id, CINELOG, CINELOG_SEED, 5500)]);
    expect(await serves(gateway, "guarded")).not.toContain(STALKER); // the reader honors it

    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    // Delta level: no rendering cites the retracted source.
    expect(renderingOf(gateway, own.id)).toBeUndefined();
    expect(report.emitted).toBe(0);
    // Object level: the canonical reading stays empty — the retraction is not re-spoken into it
    // by a third author the tenant cannot retract.
    expect(await serves(gateway, "attendance")).not.toContain(STALKER);
    expect(await serves(gateway, "guarded")).not.toContain(STALKER);
    await gateway.close();
  });

  it("...and the same fixture DOES render when nothing struck the source", async () => {
    // The control that stops the rail above from passing vacuously: same world, same claim, no
    // retraction. If the recognizer never matched, or renderings never reached the lens, this
    // fails and the absence above proves nothing.
    const gateway = await translatedWorld();
    await gateway.append([cinelogEntry(5000)]);
    expect((await translate(gateway, { seed: TRANSLATOR_SEED })).emitted).toBe(1);
    expect(await serves(gateway, "attendance")).toContain(STALKER);
    expect(await serves(gateway, "guarded")).toContain(STALKER);
    await gateway.close();
  });

  it("a stranger's strike is still inert: the heckler's veto ends at the pass too", async () => {
    // The widening honors the operator's community, not everyone. A federated stranger striking a
    // source must not be able to suppress its rendering — that would be a veto by any author.
    const gateway = await translatedWorld();
    const foreign = cinelogEntry(5000);
    await gateway.federate([foreign]);
    const MALLORY_SEED = "ee".repeat(32);
    await gateway.federate([
      retraction(foreign.id, authorForSeed(MALLORY_SEED), MALLORY_SEED, 5500),
    ]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report.emitted).toBe(1); // the stranger shrinks nothing
    expect(await serves(gateway, "guarded")).toContain(STALKER);
    await gateway.close();
  });
});
