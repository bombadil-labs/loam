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

const cinelogEntry = (ts: number, film = STALKER): Delta =>
  signClaims(
    {
      timestamp: ts,
      validFrom: ts,
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

const RENDERINGS_ONLY: Term = parseTerm({
  op: "select",
  pred: { hasPointer: { role: { exact: "guest" } } },
  in: "input",
});

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
    signClaims(grantClaims(STORE_ENTITY, CINELOG, "write", OPERATOR, 2), OPERATOR_SEED),
    signClaims(
      translationClaims("cinelog", CINELOG_SPEC.recognize, CINELOG_SPEC.emit, OPERATOR, 3),
      OPERATOR_SEED,
    ),
  ]);
  readings(gateway);
  return gateway;
}

const renderingOf = (gateway: Gateway, sourceId: string): Delta | undefined =>
  [...gateway.reactor.snapshot()].find((d) =>
    d.claims.pointers.some(
      (p) =>
        p.role === "translates" &&
        p.target.kind === "delta" &&
        p.target.deltaRef.delta === sourceId,
    ),
  );

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
    expect(await serves(gateway, "attendance")).toContain(STALKER);
    expect(await serves(gateway, "guarded")).toContain(STALKER);

    await gateway.append([retraction(foreign.id, OPERATOR, OPERATOR_SEED, 6000)]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report.retracted).toBe(1);

    expect(isSuppressed(gateway, rendering.id)).toBe(true);
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
    expect(again.retracted ?? 0).toBe(0);
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
    assertPreservesSuppression({
      what: "translate under an offered lens selecting renderings only",
      source: gateway,
      destination: peer,
      struckClaim: rendering.id,
    });
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

    await gateway.append([retraction(rendering.id, OPERATOR, OPERATOR_SEED, 6000)]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report.retracted ?? 0).toBe(0);
    expect(isSuppressed(gateway, foreign.id)).toBe(false);
    expect(isPresent(gateway, foreign.id)).toBe(true);
    await gateway.close();
  });

  it("the pass speaks only for its OWN renderings: a stranger's citation is untouched", async () => {
    const gateway = await translatedWorld();
    const foreign = cinelogEntry(5000);
    await gateway.federate([foreign]);
    await gateway.append([retraction(foreign.id, OPERATOR, OPERATOR_SEED, 6000)]);

    const theirs = signClaims(
      {
        timestamp: 5001,
        validFrom: 5001,
        author: CINELOG,
        pointers: [
          {
            role: "guest",
            target: { kind: "entity", entity: { id: WREN, context: "events_attended" } },
          },
          { role: "translates", target: { kind: "delta", deltaRef: { delta: foreign.id } } },
        ],
      },
      CINELOG_SEED,
    );
    await gateway.append([theirs]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report.retracted ?? 0).toBe(0);
    expect(report.stranded).toBe(1);
    expect(isSuppressed(gateway, theirs.id)).toBe(false);
    expect(isPresent(gateway, theirs.id)).toBe(true);
    await gateway.close();
  });

  it("a rotated seed cannot retract the old seed's renderings — and the report names them", async () => {
    const gateway = await translatedWorld();
    const foreign = cinelogEntry(5000);
    await gateway.federate([foreign]);
    await translate(gateway, { seed: TRANSLATOR_SEED });
    const rendering = renderingOf(gateway, foreign.id)!;
    await gateway.append([retraction(foreign.id, OPERATOR, OPERATOR_SEED, 6000)]);

    const rotated = await translate(gateway, { seed: OPERATOR_SEED });
    expect(rotated.stranded).toBe(1);
    expect(rotated.retracted ?? 0).toBe(0);
    expect(isSuppressed(gateway, rendering.id)).toBe(false);
    expect(await serves(gateway, "attendance")).toContain(STALKER);

    const byItsAuthor = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(byItsAuthor.retracted).toBe(1);
    expect(byItsAuthor.stranded ?? 0).toBe(0);
    expect(isSuppressed(gateway, rendering.id)).toBe(true);
    expect(await serves(gateway, "attendance")).not.toContain(STALKER);
    await gateway.close();
  });

  it("an operator's revival of a retracted rendering survives the next pass", async () => {
    const gateway = await translatedWorld();
    const foreign = cinelogEntry(5000);
    await gateway.federate([foreign]);
    await translate(gateway, { seed: TRANSLATOR_SEED });
    const rendering = renderingOf(gateway, foreign.id)!;
    await gateway.append([retraction(foreign.id, OPERATOR, OPERATOR_SEED, 6000)]);
    expect((await translate(gateway, { seed: TRANSLATOR_SEED })).retracted).toBe(1);

    const theRetraction = gateway.reactor.negationsOf(rendering.id)[0]!;
    await gateway.append([retraction(theRetraction, OPERATOR, OPERATOR_SEED, 7000)]);
    expect(await serves(gateway, "attendance")).toContain(STALKER);

    const after = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(after.retracted ?? 0).toBe(0);
    expect(gateway.reactor.negationsOf(rendering.id)).toHaveLength(1);
    expect(await serves(gateway, "attendance")).toContain(STALKER);
    await gateway.close();
  });
});

describe("T58 — the pass evaluates a source's survival as DATA, not as law", () => {
  it("a grantee's retraction of their own claim is honored by the pass, not undone by it", async () => {
    const gateway = await translatedWorld();
    const own = cinelogEntry(5000);
    await gateway.append([own]);
    await gateway.append([retraction(own.id, CINELOG, CINELOG_SEED, 5500)]);
    expect(await serves(gateway, "guarded")).not.toContain(STALKER);

    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(renderingOf(gateway, own.id)).toBeUndefined();
    expect(report.emitted).toBe(0);
    expect(await serves(gateway, "attendance")).not.toContain(STALKER);
    expect(await serves(gateway, "guarded")).not.toContain(STALKER);
    await gateway.close();
  });

  it("...and the same fixture DOES render when nothing struck the source", async () => {
    const gateway = await translatedWorld();
    await gateway.append([cinelogEntry(5000)]);
    expect((await translate(gateway, { seed: TRANSLATOR_SEED })).emitted).toBe(1);
    expect(await serves(gateway, "attendance")).toContain(STALKER);
    expect(await serves(gateway, "guarded")).toContain(STALKER);
    await gateway.close();
  });

  it("a stranger's strike is still inert: the heckler's veto ends at the pass too", async () => {
    const gateway = await translatedWorld();
    const foreign = cinelogEntry(5000);
    await gateway.federate([foreign]);
    const MALLORY_SEED = "ee".repeat(32);
    await gateway.federate([
      retraction(foreign.id, authorForSeed(MALLORY_SEED), MALLORY_SEED, 5500),
    ]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report.emitted).toBe(1);
    expect(await serves(gateway, "guarded")).toContain(STALKER);
    await gateway.close();
  });
});
