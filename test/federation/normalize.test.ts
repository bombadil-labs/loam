// Step 14's contract: divergent dialects are normalized, never mutated. A foreign app says
// "watched a film with someone" in its own shape; a TRANSLATION spec (data, operator-blessed)
// recognizes it and emits the local dialect's rendering — a new delta, signed by the
// translator, CITING its source. The originals are immortal; re-runs translate nothing twice
// (content addressing); a spec from a stranger binds nothing.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { readTranslations, translate, translationClaims } from "../../src/federation/translate.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, pickLatest } from "../gateway/fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const TRANSLATOR_SEED = "0d".repeat(32);
const TRANSLATOR = authorForSeed(TRANSLATOR_SEED);
const CINELOG_SEED = "ab".repeat(32);
const CINELOG = authorForSeed(CINELOG_SEED);
const MALLORY_SEED = "ee".repeat(32);

// The cinelog dialect: a stranger's app records "viewer watched film on date" its own way.
const cinelogEntry = (viewer: string, film: string, date: string, ts: number): Delta =>
  signClaims(
    {
      timestamp: ts,
      author: CINELOG,
      pointers: [
        { role: "film_watched", target: { kind: "entity", entity: { id: film, context: "log" } } },
        {
          role: "viewer",
          target: { kind: "entity", entity: { id: viewer, context: "watch_history" } },
        },
        { role: "on", target: { kind: "primitive", value: date } },
      ],
    },
    CINELOG_SEED,
  );

// The village's rendering of the same idea: attendance the Dossier-style gathers can see.
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

async function normalizedWorld(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, TRANSLATOR, "write", OPERATOR, 1), OPERATOR_SEED),
    signClaims(
      translationClaims("cinelog", CINELOG_SPEC.recognize, CINELOG_SPEC.emit, OPERATOR, 2),
      OPERATOR_SEED,
    ),
  ]);
  // the local dialect's lens: a person's attendances
  gateway.register(
    { ...PLANT, name: "Attendance" },
    {
      props: new Map([
        ["events_attended", { kind: "all", order: { kind: "byTimestamp", dir: "asc" } }],
      ]),
      default: pickLatest,
    },
    ["person:wren"],
  );
  return gateway;
}

describe("normalization: foreign dialects become more deltas, never mutations", () => {
  it("a cinelog entry is rendered into the village dialect, cited, and the lens lights up", async () => {
    const gateway = await normalizedWorld();
    const foreign = cinelogEntry("person:wren", "film:stalker", "2026-07-08", 5000);
    await gateway.federate([foreign]); // open door: the stranger's dialect arrives

    const before = await gateway.query(`{ attendance(entity: "person:wren") { events_attended } }`);
    expect(
      (before.data as { attendance: { events_attended: unknown[] | null } }).attendance
        .events_attended ?? [],
    ).toEqual([]); // the foreign shape is invisible to the local lens

    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report).toEqual({ emitted: 1, matched: 1, unbound: 0 });

    const emission = [...gateway.reactor.snapshot()].find(
      (d) =>
        d.claims.author === TRANSLATOR &&
        d.claims.pointers.some((p) => p.role === "translates" && p.target.kind === "delta"),
    )!;
    expect(emission).toBeDefined();
    const cite = emission.claims.pointers.find((p) => p.role === "translates")!;
    expect(cite.target.kind === "delta" && cite.target.deltaRef.delta).toBe(foreign.id); // provenance
    const origin = emission.claims.pointers.find((p) => p.role === "origin")!;
    expect(origin.target.kind === "primitive" && origin.target.value).toBe("cinelog");

    // the local lens now sees the stranger-recorded fact — and the original is still there
    const after = await gateway.query(`{ attendance(entity: "person:wren") { events_attended } }`);
    expect(JSON.stringify(after.data)).toContain("film:stalker");
    expect([...gateway.reactor.snapshot()].some((d) => d.id === foreign.id)).toBe(true);
    await gateway.close();
  });

  it("re-running translates nothing twice: content addressing IS the idempotence", async () => {
    const gateway = await normalizedWorld();
    await gateway.federate([cinelogEntry("person:wren", "film:stalker", "2026-07-08", 5000)]);
    expect((await translate(gateway, { seed: TRANSLATOR_SEED })).emitted).toBe(1);
    const second = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(second.matched).toBe(1); // the recognizer still matches...
    expect(second.emitted).toBe(0); // ...and union swallows the identical emission whole
    await gateway.close();
  });

  it("translations are terminal: an emission is never itself translated", async () => {
    const gateway = await normalizedWorld();
    // a second spec that would match the EMISSIONS (role "guest") — a chain in waiting
    await gateway.append([
      signClaims(
        translationClaims(
          "chainer",
          { hasPointer: { role: { exact: "guest" } } },
          { pointers: [{ role: "echo", value: "looped" }] },
          OPERATOR,
          3,
        ),
        OPERATOR_SEED,
      ),
    ]);
    await gateway.federate([cinelogEntry("person:wren", "film:stalker", "2026-07-08", 5000)]);
    await translate(gateway, { seed: TRANSLATOR_SEED });
    const after = await translate(gateway, { seed: TRANSLATOR_SEED }); // and again
    expect(after.emitted).toBe(0);
    const echoes = [...gateway.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some((p) => p.role === "echo"),
    );
    expect(echoes).toHaveLength(0); // the chain never started
    await gateway.close();
  });

  it("a stranger's spec binds nothing; a recognizer miss emits nothing", async () => {
    const gateway = await normalizedWorld();
    // Mallory federates her own spec (would translate ANYTHING into her echo)
    await gateway.federate(
      [
        signClaims(
          translationClaims(
            "hostile",
            { hasPointer: { role: { exact: "viewer" } } },
            { pointers: [{ role: "smear", value: "raccoon-certified" }] },
            authorForSeed(MALLORY_SEED),
            9_000_000_000,
          ),
          MALLORY_SEED,
        ),
      ],
      { admit: () => true },
    );
    expect(readTranslations(gateway.reactor, OPERATOR).map((t) => t.name)).toEqual(["cinelog"]);

    // and an unrelated delta is untouched by the lawful spec
    await gateway.append([
      signClaims(
        {
          timestamp: 6000,
          author: OPERATOR,
          pointers: [
            {
              role: "subject",
              target: { kind: "entity", entity: { id: "colony:1", context: "yield" } },
            },
            { role: "value", target: { kind: "primitive", value: 12 } },
          ],
        },
        OPERATOR_SEED,
      ),
    ]);
    await gateway.federate([cinelogEntry("person:wren", "film:stalker", "2026-07-08", 5000)]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report.matched).toBe(1); // only the cinelog entry — never the yield claim
    const smears = [...gateway.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some((p) => p.role === "smear"),
    );
    expect(smears).toHaveLength(0);
    await gateway.close();
  });

  it("a recognizer evalPred cannot run is refused at publish and skipped at read", async () => {
    const gateway = await normalizedWorld();
    // inView, aliased, holes, {var:"root"}: parsePred accepts them all; a bare evalPred
    // throws on each — one such spec would kill every future pass. Refused structurally.
    expect(() =>
      translationClaims(
        "reflective",
        { inView: { term: "input", field: "author", extract: { role: "x" } } },
        { pointers: [{ role: "echo", value: "boom" }] },
        OPERATOR,
        9,
      ),
    ).toThrow(/runnable/);
    expect(() =>
      translationClaims(
        "rooted",
        { hasPointer: { targetEntity: { var: "root" } } },
        { pointers: [{ role: "echo", value: "boom" }] },
        OPERATOR,
        9,
      ),
    ).toThrow(/runnable/);
    // hand-planted past the guard: read-side defense drops it, the pass survives
    await gateway.append([
      signClaims(
        {
          timestamp: 9,
          author: OPERATOR,
          pointers: [
            {
              role: "defines",
              target: {
                kind: "entity",
                entity: { id: "translation:poison", context: "loam.translation" },
              },
            },
            { role: "name", target: { kind: "primitive", value: "poison" } },
            {
              role: "recognize",
              target: {
                kind: "primitive",
                value: JSON.stringify({ hasPointer: { targetEntity: { var: "root" } } }),
              },
            },
            {
              role: "emit",
              target: {
                kind: "primitive",
                value: JSON.stringify({ pointers: [{ role: "echo", value: "boom" }] }),
              },
            },
          ],
        },
        OPERATOR_SEED,
      ),
    ]);
    expect(readTranslations(gateway.reactor, OPERATOR).map((t) => t.name)).toEqual(["cinelog"]);
    await gateway.federate([cinelogEntry("person:wren", "film:stalker", "2026-07-08", 5000)]);
    await expect(translate(gateway, { seed: TRANSLATOR_SEED })).resolves.toMatchObject({
      emitted: 1,
    });
    await gateway.close();
  });

  it("a source the operator struck is never re-rendered into the living dialect", async () => {
    const gateway = await normalizedWorld();
    const foreign = cinelogEntry("person:wren", "film:stalker", "2026-07-08", 5000);
    await gateway.federate([foreign]);
    const { makeNegationClaims } = await import("@bombadil/rhizomatic");
    await gateway.append([
      signClaims(makeNegationClaims(OPERATOR, 6000, foreign.id), OPERATOR_SEED),
    ]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report).toEqual({ emitted: 0, matched: 0, unbound: 0 }); // retired facts stay retired
    await gateway.close();
  });

  it("an ambiguous hole refuses the whole emission (no half-translated facts)", async () => {
    const gateway = await normalizedWorld();
    const shared = signClaims(
      {
        timestamp: 5001,
        author: CINELOG,
        pointers: [
          {
            role: "film_watched",
            target: { kind: "entity", entity: { id: "film:solaris", context: "log" } },
          },
          {
            role: "viewer",
            target: { kind: "entity", entity: { id: "person:wren", context: "watch_history" } },
          },
          {
            role: "viewer", // TWO viewers: the template's single hole is ambiguous
            target: { kind: "entity", entity: { id: "person:miles", context: "watch_history" } },
          },
          { role: "on", target: { kind: "primitive", value: "2026-07-09" } },
        ],
      },
      CINELOG_SEED,
    );
    await gateway.federate([shared]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report).toEqual({ emitted: 0, matched: 1, unbound: 1 }); // recognized, refused whole
    await gateway.close();
  });

  it("spec evolution: a republished spec renders anew; the old renderings stand", async () => {
    const gateway = await normalizedWorld();
    await gateway.federate([cinelogEntry("person:wren", "film:stalker", "2026-07-08", 5000)]);
    await translate(gateway, { seed: TRANSLATOR_SEED });

    // the operator republishes the spec at the same entity — richer rendering
    await gateway.append([
      signClaims(
        translationClaims(
          "cinelog",
          CINELOG_SPEC.recognize,
          {
            pointers: [...CINELOG_SPEC.emit.pointers, { role: "rendition", value: "v2" }],
          },
          OPERATOR,
          10_000,
        ),
        OPERATOR_SEED,
      ),
    ]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report.emitted).toBe(1); // the new rendering lands beside the old
    const renderings = [...gateway.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some((p) => p.role === "translates"),
    );
    expect(renderings).toHaveLength(2); // both stand — a better spec later is another pass
    await gateway.close();
  });

  it("a source that decorates itself with a translates ref opts out — by design", async () => {
    const gateway = await normalizedWorld();
    const evasive = signClaims(
      {
        timestamp: 5002,
        author: CINELOG,
        pointers: [
          ...cinelogEntry("person:wren", "film:stalker", "2026-07-08", 5000).claims.pointers,
          // the decorative self-exemption: translates pointing at any delta id
          {
            role: "translates",
            target: { kind: "delta", deltaRef: { delta: `1e20${"77".repeat(32)}` } },
          },
        ],
      },
      CINELOG_SEED,
    );
    await gateway.federate([evasive]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    // terminal means terminal: shape, not authorship — the reserved role opts the source out
    expect(report).toEqual({ emitted: 0, matched: 0, unbound: 0 });
    await gateway.close();
  });

  it("the translator needs standing like anyone else", async () => {
    const gateway = await normalizedWorld();
    await gateway.federate([cinelogEntry("person:wren", "film:stalker", "2026-07-08", 5000)]);
    await expect(translate(gateway, { seed: MALLORY_SEED })).rejects.toThrow(/not permitted/);
    await gateway.close();
  });

  it("a negated spec stops translating; its past emissions remain (nothing is deleted)", async () => {
    const gateway = await normalizedWorld();
    await gateway.federate([cinelogEntry("person:wren", "film:stalker", "2026-07-08", 5000)]);
    await translate(gateway, { seed: TRANSLATOR_SEED });

    const { makeNegationClaims } = await import("@bombadil/rhizomatic");
    const spec = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === "loam.translation",
      ),
    )!;
    await gateway.append([signClaims(makeNegationClaims(OPERATOR, 7000, spec.id), OPERATOR_SEED)]);
    expect(readTranslations(gateway.reactor, OPERATOR)).toEqual([]);

    await gateway.federate([cinelogEntry("person:miles", "film:mirror", "2026-07-09", 8000)]);
    const report = await translate(gateway, { seed: TRANSLATOR_SEED });
    expect(report.matched).toBe(0); // the retired spec recognizes nothing new
    const emissions = [...gateway.reactor.snapshot()].filter((d) => d.claims.author === TRANSLATOR);
    expect(emissions).toHaveLength(1); // the earlier rendering stands — nothing is deleted
    await gateway.close();
  });
});
