// The tutorial's data layer, headless (§48). The page and this suite drive EXACTLY the same
// two modules — `demos/tutorial/lessons.mjs` (the arc as data) and `demos/tutorial/player.mjs`
// (the engine that plays any arc of that shape) — over the browser barrel. That identity is the
// anti-rot guarantee: a step whose `run` stops doing its work fails here, named.
//
// WHAT THIS SUITE ASSERTS AND WHAT IT DELIBERATELY DOES NOT. Every step carries two observe
// predicates; only the STORE one is checkable without a DOM, so that is what this file asserts,
// on every step of the arc. The PAGE predicate, the rendered rail, the in-page revert confirm,
// and the reload are `test/browser/tutorial.test.ts`'s — a real Chrome over the real page. Both
// levels are covered; neither file covers both, and the split is the T143 lesson kept honest.
//
// The arc here is the STUB (T226): two or three lessons that exercise every mechanic the real
// fifteen will need. T227 replaces the arc and extends this file; the engine's assertions are
// written against the arc's SHAPE and its lesson ROLES, never against a lesson number.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as loam from "../../src/browser/index.js";
import { run } from "../../src/cli/cli.js";
import { storePath } from "../../src/cli/config.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemStorage } from "../store/mem-storage.js";
import {
  DIARY,
  VIEWING,
  bootTutorialStore,
  buildArc,
  buildExport,
  type Lesson,
  type LessonCtx,
  type LessonStep,
} from "../../demos/tutorial/lessons.mjs";
import {
  CKPT_PREFIX,
  SEED_KEY,
  STORE_PREFIX,
  TUTORIAL_CONTEXTS,
  answerQuiz,
  bankCheckpoint,
  checkpointLessons,
  clearCheckpoints,
  completeStep,
  enterLesson,
  readCheckpoint,
  readGlossary,
  readProgress,
  restoreCheckpoint,
  resumeState,
  skipQuiz,
  sweepCheckpoints,
  takeCheckpoint,
} from "../../demos/tutorial/player.mjs";
import { classifyDelta } from "../../demos/tutorial/instruments.mjs";

// A hang guard, not a performance bound (the T73/T75 shape): the whole arc plus a CLI round
// trip runs in seconds unloaded and legitimately takes tens under contention.
vi.setConfig({ testTimeout: 120_000 });

let clock = 1_753_000_000_000;
const nextTs = (): number => ++clock;

async function makeCtx(storage: MemStorage): Promise<LessonCtx> {
  const { gateway, seed, author } = await bootTutorialStore(loam, storage);
  return { gateway, storage, seed, author, ts: nextTs };
}

/** The page's own motion, minus the theater: enter, then complete every step in order. */
async function playLesson(lesson: Lesson, ctx: LessonCtx): Promise<void> {
  await enterLesson(loam, ctx, lesson);
  for (const step of lesson.steps) {
    const outcome = await completeStep(loam, ctx, lesson, step);
    expect(outcome.ok, `step ${step.id}: ${outcome.ok ? "" : outcome.message}`).toBe(true);
  }
}

const lessonOfRole = (arc: Lesson[], role: string): Lesson => {
  const found = arc.find((l) => l.role === role);
  expect(found, `the arc declares no lesson with role "${role}"`).toBeDefined();
  return found!;
};

/** The ids of the deltas a store's rows hold, read from storage rather than from the gateway. */
const rowIds = (storage: MemStorage): string[] =>
  storage
    .keys()
    .filter((k) => k.startsWith(STORE_PREFIX) && k !== SEED_KEY)
    .map((k) => k.slice(STORE_PREFIX.length))
    .sort();

const claimsWithContext = (ctx: LessonCtx, context: string): unknown[] =>
  ctx.gateway
    .offeredDeltas()
    .filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === context,
      ),
    );

beforeAll(() => {
  // The packets are committed data the arc's federation lessons stand on; a drifted generator
  // fails here rather than inside a lesson that is confused by it.
  execFileSync(process.execPath, [join("scripts", "gen-packets.mjs"), "--check"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
});

describe("the arc, headless: every step earns its store observable", () => {
  it("walks the whole arc in order; no lesson is green before it runs; every step's store predicate turns true", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    expect(arc.length).toBeGreaterThanOrEqual(2);

    for (const lesson of arc) {
      expect(await lesson.check(ctx), `lesson ${lesson.id} green before it ran`).toBe(false);

      // A step is EARNED when its store predicate is false before its run — the property the
      // browser suite's red-probe needs, and the anti-vacuity bar for the arc: a lesson made
      // only of look-steps would teach a click and prove nothing.
      const earned: string[] = [];
      for (const step of lesson.steps) {
        if (!(await step.observe.store(ctx))) earned.push(step.id);
        const outcome = await completeStep(loam, ctx, lesson, step);
        expect(outcome.ok, `step ${step.id}: ${outcome.ok ? "" : outcome.message}`).toBe(true);
        expect(
          await step.observe.store(ctx),
          `step ${step.id}'s store observable is false after its run`,
        ).toBe(true);
      }
      expect(
        earned.length,
        `lesson ${lesson.id} has no step that earns its observable`,
      ).toBeGreaterThan(0);
      expect(await lesson.check(ctx), `lesson ${lesson.id} (${lesson.title})`).toBe(true);
    }
    await ctx.gateway.close();
  });

  it("refuses to bank a step whose work did not land, naming the lesson and the step", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    // The same arc-agnostic choice the browser probe makes: the first step whose store
    // predicate is false before it runs.
    let target: { lesson: Lesson; step: LessonStep } | undefined;
    for (const lesson of arc) {
      await enterLesson(loam, ctx, lesson);
      for (const step of lesson.steps) {
        if (!(await step.observe.store(ctx))) {
          target = { lesson, step };
          break;
        }
        await completeStep(loam, ctx, lesson, step);
      }
      if (target !== undefined) break;
    }
    expect(target, "no step in this arc earns its own observable").toBeDefined();
    const { lesson, step } = target!;

    const neutered: LessonStep = { ...step, run: async () => {} };
    const outcome = await completeStep(loam, ctx, lesson, neutered);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain(String(lesson.id));
    expect(outcome.message).toContain(step.id);
    // and nothing was banked: the store holds no step claim for it
    expect(readProgress(ctx).steps.has(step.id)).toBe(false);
    await ctx.gateway.close();
  });
});

describe("progress is claims", () => {
  it("lands one claim per kind, counts at or above the actions performed, and reads back as the rail", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    let steps = 0;
    let quizzes = 0;
    for (const lesson of arc) {
      await playLesson(lesson, ctx);
      steps += lesson.steps.length;
      await bankCheckpoint(loam, ctx, lesson.id);
      if (lesson.quiz !== undefined) {
        for (const [i] of lesson.quiz.questions.entries()) {
          await answerQuiz(loam, ctx, lesson.quiz, i, 0);
          quizzes += 1;
        }
      }
    }

    // DELTA LEVEL: every kind is really in the ground, under the tutorial vocabulary.
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.entered).length).toBeGreaterThanOrEqual(
      arc.length,
    );
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.step).length).toBeGreaterThanOrEqual(steps);
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.quiz).length).toBeGreaterThanOrEqual(quizzes);
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.checkpoint).length).toBeGreaterThanOrEqual(1);

    // OBJECT LEVEL: the rail is a reading of those claims, not a parallel counter.
    const progress = readProgress(ctx);
    expect(progress.entered).toEqual(arc.map((l) => l.id));
    expect(progress.steps.size).toBe(steps);
    expect(progress.quiz.size).toBe(quizzes);
    await ctx.gateway.close();
  });

  it("an UNSIGNED row naming the student moves nothing — and is not hidden from them either", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    await playLesson(arc[0]!, ctx);
    const before = readProgress(ctx).steps.size;

    // Take one of the student's OWN progress claims and strip its signature where it lies. The
    // driver quarantines a signature that FAILS, not one that is missing, so this row is
    // admitted to the ground and reads as the student's own — unless the reading asks.
    const signed = ctx.gateway
      .offeredDeltas()
      .find(
        (d) =>
          d.claims.author === ctx.author &&
          d.sig !== undefined &&
          d.claims.pointers.some(
            (p) => p.target.kind === "entity" && p.target.entity.context === TUTORIAL_CONTEXTS.step,
          ),
      )!;
    const row = JSON.parse(storage.getItem(`${STORE_PREFIX}${signed.id}`)!) as Record<
      string,
      unknown
    >;
    delete row["sig"];
    storage.setItem(`${STORE_PREFIX}${signed.id}`, JSON.stringify(row));
    await ctx.gateway.close();

    const again = await makeCtx(storage);
    const landed = again.gateway.offeredDeltas().find((d) => d.id === signed.id);
    expect(landed, "the unsigned row did not land — this rail would prove nothing").toBeDefined();
    expect(landed!.sig, "the row is still signed — this rail would prove nothing").toBeUndefined();
    expect(
      readProgress(again).steps.size,
      "an unsigned row was counted as the student's own progress",
    ).toBeLessThan(before);
    // ...and the Ground pane must SHOW it: a row nobody signed is exactly what a student needs
    // to see, so it may not fall into the tutorial filter's blind spot.
    expect(classifyDelta(landed!, again.author).kind).toBe("tutorial");
    await again.gateway.close();
  });

  it("a record that is also a grant is a GRANT — one delta cannot be progress at one level and law at the other", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    await playLesson(buildArc(loam)[0]!, ctx);
    const before = readProgress(ctx).steps.size;

    // A single delta wearing both hats: the tutorial's step vocabulary AND the constitutional
    // grant context. The classifier decides `grant`; progress must agree and not bank it.
    // Through the FEDERATION door: the law door refuses a malformed grant outright, which is
    // its job. What lands as data is what a reader then has to make sense of.
    await ctx.gateway.federate([
      loam.signClaims(
        {
          timestamp: ctx.ts(),
          author: ctx.author,
          pointers: [
            {
              role: "step",
              target: {
                kind: "entity",
                entity: { id: "tutorial:step:0.0", context: TUTORIAL_CONTEXTS.step },
              },
            },
            { role: "name", target: { kind: "primitive", value: "0.0" } },
            {
              role: "subject",
              target: { kind: "entity", entity: { id: "loam:store", context: "loam.grants" } },
            },
          ],
        },
        ctx.seed,
      ),
    ]);
    const wearingBoth = ctx.gateway
      .offeredDeltas()
      .find((d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.id === "tutorial:step:0.0",
        ),
      );
    expect(
      wearingBoth,
      "the two-hatted delta never landed — this rail proves nothing",
    ).toBeDefined();
    expect(classifyDelta(wearingBoth!, ctx.author).kind).toBe("grant");
    expect(
      readProgress(ctx).steps.size,
      "a delta the pane calls a grant was banked as progress",
    ).toBe(before);
    await ctx.gateway.close();
  });

  it("a skipped quiz is recorded as skipped, and manufactures no answer", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const withQuiz = arc.find((l) => l.quiz !== undefined);
    expect(withQuiz, "the arc declares no quiz").toBeDefined();
    const quiz = withQuiz!.quiz!;

    await playLesson(withQuiz!, ctx);
    expect(readProgress(ctx).skipped.has(quiz.id)).toBe(false);
    await skipQuiz(loam, ctx, quiz);

    const after = readProgress(ctx);
    expect(after.skipped.has(quiz.id), "the skip was not recorded").toBe(true);
    // A skip is not an answer: it must not appear among the results the rail renders.
    expect([...after.quiz.keys()]).toEqual([]);
    // ...and it survives a reboot, so the arc does not re-ask on the next visit.
    await ctx.gateway.close();
    const back = await makeCtx(storage);
    expect(readProgress(back).skipped.has(quiz.id)).toBe(true);
    await back.gateway.close();
  });

  it("reads only the student's own LIVE claims: a stranger's progress claim and a struck one move nothing", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const first = arc[0]!;
    await playLesson(first, ctx);
    const banked = first.steps[first.steps.length - 1]!.id;
    expect(readProgress(ctx).steps.has(banked)).toBe(true);

    // A STRANGER signs a claim in the tutorial's own vocabulary and federates it in. It lands
    // in the ground — the store does not burn mail — and it must move nothing: progress is what
    // the student did, and someone else's word about it is data.
    const strangerSeed = "5a".repeat(32);
    const stranger = loam.authorForSeed(strangerSeed);
    const forged = loam.signClaims(
      {
        timestamp: ctx.ts(),
        author: stranger,
        pointers: [
          {
            role: "step",
            target: {
              kind: "entity",
              entity: { id: "tutorial:step:9.9", context: "tutorial.step" },
            },
          },
          { role: "name", target: { kind: "primitive", value: "9.9" } },
          { role: "lesson", target: { kind: "primitive", value: 9 } },
        ],
      },
      strangerSeed,
    );
    await ctx.gateway.federate([forged]);
    expect(
      ctx.gateway.offeredDeltas().some((d) => d.id === forged.id),
      "the forged progress claim never landed — this rail would prove nothing",
    ).toBe(true);
    expect(readProgress(ctx).steps.has("9.9")).toBe(false);

    // ...and a claim of the student's OWN stops counting once it is struck: presence is not
    // survival, and a reading that counted a retracted claim is the store lying upward (H1).
    const stepClaim = ctx.gateway
      .offeredDeltas()
      .find(
        (d) =>
          d.claims.author === ctx.author &&
          d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === banked),
      );
    expect(stepClaim, "no step claim to strike").toBeDefined();
    await ctx.gateway.append([
      loam.signClaims(
        loam.makeNegationClaims(ctx.author, ctx.ts(), stepClaim!.id, "not really done"),
        ctx.seed,
      ),
    ]);
    expect(readProgress(ctx).steps.has(banked)).toBe(false);
    await ctx.gateway.close();
  });

  it("a STRANGER'S strike retires nothing, and a struck strike gives the claim back", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const first = arc[0]!;
    await playLesson(first, ctx);
    const banked = first.steps[first.steps.length - 1]!.id;
    const stepClaim = ctx.gateway
      .offeredDeltas()
      .find(
        (d) =>
          d.claims.author === ctx.author &&
          d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === banked),
      )!;

    // A stranger's strike LANDS in the ground and retires nothing: standing is not something a
    // federated packet can take away.
    const strangerSeed = "5a".repeat(32);
    const theirStrike = loam.signClaims(
      loam.makeNegationClaims(loam.authorForSeed(strangerSeed), 9_000_001, stepClaim.id, "no"),
      strangerSeed,
    );
    await ctx.gateway.federate([theirStrike]);
    expect(
      ctx.gateway.offeredDeltas().some((d) => d.id === theirStrike.id),
      "the stranger's strike never landed — this rail would prove nothing",
    ).toBe(true);
    expect(readProgress(ctx).steps.has(banked), "a stranger un-banked the student's work").toBe(
      true,
    );

    // The student's own strike DOES retire it...
    const mine = loam.signClaims(
      loam.makeNegationClaims(ctx.author, ctx.ts(), stepClaim.id, "not really"),
      ctx.seed,
    );
    await ctx.gateway.append([mine]);
    expect(readProgress(ctx).steps.has(banked)).toBe(false);

    // ...and striking THAT strike gives the claim back. Presence is not survival, and one link
    // of the chain is not the answer (H1).
    const undo = loam.signClaims(
      loam.makeNegationClaims(ctx.author, ctx.ts(), mine.id, "yes it was"),
      ctx.seed,
    );
    await ctx.gateway.append([undo]);
    expect(readProgress(ctx).steps.has(banked), "a struck strike did not revive its target").toBe(
      true,
    );

    // ...and one more link flips it back again: a reader that stopped at two would say live.
    const redo = loam.signClaims(
      loam.makeNegationClaims(ctx.author, ctx.ts(), undo.id, "no it wasn't"),
      ctx.seed,
    );
    await ctx.gateway.append([redo]);
    expect(readProgress(ctx).steps.has(banked), "the third link was not followed").toBe(false);
    await ctx.gateway.close();
  });

  it("reconstructs where the student stood from the claims alone — every other key deleted", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const first = arc[0]!;
    const second = arc[1]!;
    await playLesson(first, ctx);
    takeCheckpoint(storage, first.id);
    await enterLesson(loam, ctx, second);
    await completeStep(loam, ctx, second, second.steps[0]!);
    if (first.quiz !== undefined) await answerQuiz(loam, ctx, first.quiz, 0, 0);
    const before = resumeState(arc, readProgress(ctx));
    expect(before.lessonId).toBe(second.id);
    expect(before.stepIndex).toBe(1);
    await ctx.gateway.close();

    // THE FALSIFIER: delete every key that is not a store row and not the seed — the
    // checkpoints, and anything a future build might be tempted to remember position in.
    for (const key of storage.keys()) {
      if (key === SEED_KEY) continue;
      if (key.startsWith(STORE_PREFIX) && /^[0-9a-f]+$/.test(key.slice(STORE_PREFIX.length))) {
        continue;
      }
      storage.removeItem(key);
    }
    expect(storage.keys().some((k) => k.startsWith(CKPT_PREFIX))).toBe(false);

    const again = await makeCtx(storage);
    const after = resumeState(buildArc(loam), readProgress(again));
    expect(after.lessonId).toBe(before.lessonId);
    expect(after.stepIndex).toBe(before.stepIndex);
    expect([...after.quiz.keys()].sort()).toEqual([...before.quiz.keys()].sort());
    await again.gateway.close();
  });
});

describe("the glossary is made of deltas", () => {
  it("plants a lesson's terms as claims when the lesson is entered, and reads them back in order", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const first = arc[0]!;
    expect(first.terms.length, "the opening lesson introduces no term").toBeGreaterThan(0);

    expect(readGlossary(ctx)).toHaveLength(0);
    await enterLesson(loam, ctx, first);
    const planted = readGlossary(ctx);
    expect(planted.map((e) => e.term)).toEqual(first.terms.map((t) => t.term));
    for (const entry of planted) {
      expect(entry.meaning.length).toBeGreaterThan(0);
      expect(entry.lesson).toBe(first.id);
      // the entry names the claim it is made of — the "where does this live?" control's target
      expect(ctx.gateway.offeredDeltas().some((d) => d.id === entry.deltaId)).toBe(true);
    }

    // The reveal lesson plants a term from a STEP, not from its entry — the payoff needs the
    // student to do something for it. So the snapshot is taken AFTER entering that lesson (its
    // entry terms are already planted by then): whatever appears now was planted by a step.
    const reveal = lessonOfRole(arc, "reveal");
    for (const lesson of arc) {
      if (lesson.id >= reveal.id) break;
      await playLesson(lesson, ctx);
    }
    await enterLesson(loam, ctx, reveal);
    const beforeSteps = new Set(readGlossary(ctx).map((e) => e.term));
    for (const step of reveal.steps) await completeStep(loam, ctx, reveal, step);
    const revealed = readGlossary(ctx).filter((e) => !beforeSteps.has(e.term));
    expect(
      revealed.map((e) => e.term),
      "the reveal lesson plants no term from inside a step — its role is unmet",
    ).not.toEqual([]);
    await ctx.gateway.close();
  });

  it("badges the tutorial's own records `tutorial`, and leaves the student's facts alone", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    await playLesson(arc[0]!, ctx);
    const ground = ctx.gateway.offeredDeltas();

    const contexts = new Set(Object.values(TUTORIAL_CONTEXTS));
    const progressClaims = ground.filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && contexts.has(p.target.entity.context ?? ""),
      ),
    );
    expect(progressClaims.length).toBeGreaterThan(0);
    for (const d of progressClaims) {
      expect(classifyDelta(d, ctx.author).kind, `${d.id} is the tutorial's own record`).toBe(
        "tutorial",
      );
    }
    // ...and the student's own claim — the diary's name — is still a plain fact.
    const mine = ground.find((d) =>
      d.claims.pointers.some((p) => p.target.kind === "entity" && p.target.entity.id === DIARY),
    );
    expect(mine, "lesson one lands no claim of the student's own").toBeDefined();
    expect(classifyDelta(mine!, ctx.author).kind).toBe("fact");
    await ctx.gateway.close();
  });
});

describe("checkpoints, revert, and the sweep", () => {
  it("a checkpoint holds delta rows and NOTHING else — never the seed, never a stray key", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    await playLesson(buildArc(loam)[0]!, ctx);
    // a key someone else parked under the shared prefix, after boot healed the store
    storage.setItem(`${STORE_PREFIX}ui:junk`, "not a delta");

    expect(takeCheckpoint(storage, 1).ok).toBe(true);
    const blob = readCheckpoint(storage, 1)!;
    for (const key of Object.keys(blob.rows)) {
      expect(key, "a checkpoint copied something that is not a delta row").toMatch(
        /^loam:tutorial:[0-9a-f]+$/,
      );
    }
    // THE BYTES, not the key list: the seed is key material, and a checkpoint that carried it
    // would put a copy of the student's key in a blob no erasure and no start-over thinks about.
    expect(JSON.stringify(blob)).not.toContain(ctx.seed);
    expect(storage.getItem(SEED_KEY)).toBe(ctx.seed);

    // ...and restoring puts back exactly those rows, leaving the seed where it was. The stray
    // is not the store's and the restore does not touch it; the next boot heals it away.
    expect(restoreCheckpoint(storage, 1).ok).toBe(true);
    expect(storage.getItem(SEED_KEY)).toBe(ctx.seed);
    await ctx.gateway.close();
    const back = await makeCtx(storage);
    expect(storage.getItem(`${STORE_PREFIX}ui:junk`)).toBeNull();
    await back.gateway.close();
  });

  it("a checkpoint is the store's rows frozen; restoring it yields exactly that id set, two-sided", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const first = arc[0]!;
    const second = arc[1]!;

    await playLesson(first, ctx);
    expect(takeCheckpoint(storage, first.id).ok).toBe(true);
    const frozen = rowIds(storage);
    const survivor = ctx.gateway
      .offeredDeltas()
      .find((d) =>
        d.claims.pointers.some((p) => p.target.kind === "entity" && p.target.entity.id === DIARY),
      );
    expect(survivor, "lesson one lands no claim to survive the revert").toBeDefined();

    await playLesson(second, ctx);
    const discarded = ctx.gateway.offeredDeltas().filter((d) => !frozen.includes(d.id));
    expect(discarded.length, "the second lesson landed nothing to discard").toBeGreaterThan(0);
    await ctx.gateway.close();

    expect(restoreCheckpoint(storage, first.id).ok).toBe(true);
    expect(rowIds(storage)).toEqual(frozen);

    const back = await makeCtx(storage);
    const ids = new Set(back.gateway.offeredDeltas().map((d) => d.id));
    // TWO-SIDED: the discarded work is gone AND the pre-checkpoint claim survived.
    for (const d of discarded) expect(ids.has(d.id), `${d.id} survived the revert`).toBe(false);
    expect(ids.has(survivor!.id), "the pre-checkpoint claim did not survive the revert").toBe(true);
    // and the student stands exactly where the checkpoint was taken — the later lesson was
    // never entered in this ground, so reopening it writes nothing at all
    expect(resumeState(buildArc(loam), readProgress(back)).lessonId).toBe(first.id);
    expect(rowIds(storage)).toEqual(frozen);
    await back.gateway.close();
  });

  it("a revert never writes an erased record back, and says which ones it would not", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    await playLesson(arc[0]!, ctx);
    expect(takeCheckpoint(storage, arc[0]!.id).ok).toBe(true);
    const held = rowIds(storage);
    const condemned = held[held.length - 1]!;

    // The store moves on and that record is erased — so the checkpoint is the only copy left.
    // A revert that trusted an earlier sweep would write it straight back into the ground.
    storage.removeItem(`${STORE_PREFIX}${condemned}`);
    const restored = restoreCheckpoint(storage, arc[0]!.id, { erasedIds: [condemned] });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.refused, "the erased record was not named").toContain(condemned);
    expect(rowIds(storage), "a revert resurrected an erased record").not.toContain(condemned);
    // ...and everything else the checkpoint held IS back — refusing one row is not a licence
    // to drop the rest.
    for (const id of held) {
      if (id === condemned) continue;
      expect(rowIds(storage), `${id} was lost by a revert that refused another row`).toContain(id);
    }
    await ctx.gateway.close();
  });

  it("a revert that cannot be written loses nothing: no row is removed before every row is back", async () => {
    const roomy = new MemStorage();
    const ctx = await makeCtx(roomy);
    const arc = buildArc(loam);
    await playLesson(arc[0]!, ctx);
    expect(takeCheckpoint(roomy, 1).ok).toBe(true);
    const frozen = rowIds(roomy);
    // Work AFTER the checkpoint: these rows are in no blob, so they exist in exactly one place.
    // They are what a remove-first restore destroys before it discovers it cannot finish.
    await playLesson(arc[1]!, ctx);
    const later = rowIds(roomy).filter((id) => !frozen.includes(id));
    expect(
      later.length,
      "the second lesson landed nothing that lives only in the store",
    ).toBeGreaterThan(0);
    await ctx.gateway.close();

    // A storage that refuses EVERY row write, with one checkpoint row missing so the restore
    // has real work to attempt.
    const tight = new MemStorage();
    for (const key of roomy.keys()) tight.setItem(key, roomy.getItem(key)!);
    tight.removeItem(`${STORE_PREFIX}${frozen[0]!}`);
    const failing = {
      get length() {
        return tight.length;
      },
      key: (i: number) => tight.key(i),
      getItem: (k: string) => tight.getItem(k),
      removeItem: (k: string) => tight.removeItem(k),
      setItem: (k: string, v: string) => {
        if (k.startsWith(STORE_PREFIX)) {
          throw new DOMException("the quota has been exceeded", "QuotaExceededError");
        }
        tight.setItem(k, v);
      },
    };

    const refused = restoreCheckpoint(failing, 1);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toMatch(/nothing was removed/);
    // THE POINT: every row that was there before the attempt is STILL there — including the
    // later work, whose only copy is the store itself. A restore that deleted first would have
    // destroyed exactly those before discovering it could not write the checkpoint back.
    for (const id of [...frozen.slice(1), ...later]) {
      expect(
        tight.getItem(`${STORE_PREFIX}${id}`),
        `${id} was lost by a refused revert`,
      ).not.toBeNull();
    }
  });

  it("one checkpoint per boundary, superseded in place; start-over clears them all", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    await playLesson(arc[0]!, ctx);
    takeCheckpoint(storage, arc[0]!.id);
    const firstRows = readCheckpoint(storage, arc[0]!.id)!.rows;
    await playLesson(arc[1]!, ctx);
    takeCheckpoint(storage, arc[0]!.id); // the same boundary again
    expect(checkpointLessons(storage)).toEqual([arc[0]!.id]);
    expect(Object.keys(readCheckpoint(storage, arc[0]!.id)!.rows).length).toBeGreaterThan(
      Object.keys(firstRows).length,
    );

    takeCheckpoint(storage, arc[1]!.id);
    expect(checkpointLessons(storage)).toEqual([arc[0]!.id, arc[1]!.id]);
    clearCheckpoints(storage);
    expect(checkpointLessons(storage)).toEqual([]);
    expect(storage.keys().some((k) => k.startsWith(CKPT_PREFIX))).toBe(false);
    await ctx.gateway.close();
  });

  it("refuses an over-quota checkpoint, naming the boundary, and leaves no half-written blob", async () => {
    const roomy = new MemStorage();
    const ctx = await makeCtx(roomy);
    const arc = buildArc(loam);
    await playLesson(arc[0]!, ctx);

    // A storage whose quota is smaller than the blob it is asked to hold.
    const tight = new MemStorage(2048);
    for (const key of roomy.keys()) {
      try {
        tight.setItem(key, roomy.getItem(key)!);
      } catch {
        break; // the rows themselves may not fit; the refusal is what this rail is about
      }
    }
    const refused = takeCheckpoint(tight, arc[0]!.id, { label: `lesson ${arc[0]!.id}` });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain(`lesson ${arc[0]!.id}`);
    expect(tight.keys().some((k) => k.startsWith(CKPT_PREFIX))).toBe(false);
    await ctx.gateway.close();
  });

  it("a MISFILED erased row is caught by its own bytes, not by the key it hides under", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    await playLesson(buildArc(loam)[0]!, ctx);
    const rows = rowIds(storage);
    const condemned = rows[rows.length - 1]!;
    const smuggled = storage.getItem(`${STORE_PREFIX}${condemned}`)!;
    await ctx.gateway.close();

    // The row's bytes, filed under a key that names something else entirely. Only reading the
    // VALUE can tell that this checkpoint is still carrying the record.
    const decoy = "ab".repeat(34);
    storage.removeItem(`${STORE_PREFIX}${condemned}`);
    storage.setItem(`${STORE_PREFIX}${decoy}`, smuggled);
    expect(takeCheckpoint(storage, 7).ok).toBe(true);
    expect(Object.keys(readCheckpoint(storage, 7)!.rows)).not.toContain(
      `${STORE_PREFIX}${condemned}`,
    );

    const report = sweepCheckpoints(storage, [condemned]);
    expect(
      report.destroyed.map((d) => d.lesson),
      "a checkpoint carrying the erased bytes under another name survived",
    ).toContain("7");
    expect(storage.getItem(`${CKPT_PREFIX}7`)).toBeNull();
  });

  it("a checkpoint that only REMEMBERS the erasure survives it — the receipt is not the bytes", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const finale = lessonOfRole(arc, "erasure-finale");
    for (const lesson of arc) {
      await playLesson(lesson, ctx);
      if (lesson.id === finale.id) break;
    }
    const erased = [...loam.readTombstones(ctx.gateway.reactor, ctx.author)];
    expect(erased.length, "the erasure lesson erased nothing").toBeGreaterThan(0);

    // A checkpoint taken AFTER the forgetting holds the receipt, and a receipt names the id it
    // forgot. It holds none of the bytes, so the sweep must leave it alone: destroying it would
    // take the student's undo for the crime of remembering that something was forgotten.
    expect(takeCheckpoint(storage, finale.id).ok).toBe(true);
    const blob = readCheckpoint(storage, finale.id)!;
    expect(
      JSON.stringify(blob).includes(erased[0]!),
      "the checkpoint does not mention the erasure at all — this rail proves nothing",
    ).toBe(true);
    for (const id of erased) expect(Object.keys(blob.rows)).not.toContain(STORE_PREFIX + id);

    const report = sweepCheckpoints(storage, erased);
    expect(
      report.kept.map((k) => String(k.lesson)),
      "a checkpoint was destroyed for holding the receipt",
    ).toContain(String(finale.id));
    expect(readCheckpoint(storage, finale.id)).not.toBeNull();
    await ctx.gateway.close();
  });

  it("an erasure destroys every checkpoint that could hold the bytes, and spares the ones that cannot", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const finale = lessonOfRole(arc, "erasure-finale");

    // Play up to (not including) the erasure lesson, taking a checkpoint at every boundary.
    for (const lesson of arc) {
      if (lesson.id === finale.id) break;
      await playLesson(lesson, ctx);
      expect(takeCheckpoint(storage, lesson.id).ok).toBe(true);
    }
    const boundaries = checkpointLessons(storage);
    expect(boundaries.length, "the arc reaches its erasure with no checkpoints").toBeGreaterThan(1);

    await playLesson(finale, ctx);
    const erased = [...loam.readTombstones(ctx.gateway.reactor, ctx.author)];
    expect(erased.length, "the erasure lesson erased nothing").toBeGreaterThan(0);

    const report = sweepCheckpoints(storage, erased);
    // TWO-SIDED, at the bytes: the condemned checkpoints are gone from storage entirely, and a
    // named bystander checkpoint is still there AND still readable.
    expect(report.destroyed.length, "no checkpoint held the erased bytes").toBeGreaterThan(0);
    expect(
      report.kept.length,
      "every checkpoint was destroyed — this is over-purging",
    ).toBeGreaterThan(0);
    for (const gone of report.destroyed) {
      expect(gone.reason.length).toBeGreaterThan(0);
      expect(storage.getItem(`${CKPT_PREFIX}${gone.lesson}`)).toBeNull();
    }
    for (const kept of report.kept) {
      const blob = readCheckpoint(storage, kept.lesson);
      expect(blob, `the bystander checkpoint ${kept.lesson} was destroyed`).not.toBeNull();
      for (const id of erased) expect(Object.keys(blob!.rows)).not.toContain(STORE_PREFIX + id);
    }
    // No surviving blob anywhere holds an erased id — the claim the page makes on screen.
    for (const lesson of checkpointLessons(storage)) {
      const blob = readCheckpoint(storage, lesson)!;
      for (const id of erased) expect(Object.keys(blob.rows)).not.toContain(STORE_PREFIX + id);
    }
    await ctx.gateway.close();
  });
});

describe("the tutorial's store is a real store", () => {
  it("boot heals a key poisoned under the store's own prefix", async () => {
    const storage = new MemStorage();
    const first = await bootTutorialStore(loam, storage);
    await first.gateway.close();
    storage.setItem(`${STORE_PREFIX}ui:pins`, JSON.stringify([["a", "{ viewing { title } }"]]));

    const healed = await bootTutorialStore(loam, storage);
    expect(storage.getItem(`${STORE_PREFIX}ui:pins`)).toBeNull();
    expect(storage.getItem(SEED_KEY)).toBe(first.seed);
    expect(healed.gateway.offeredDeltas().length).toBeGreaterThan(0);
    await healed.gateway.close();
  });

  it("what the student exports IS the store: export → init --seed → pull → _hex for _hex", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    for (const lesson of buildArc(loam)) await playLesson(lesson, ctx);

    const inTab = await ctx.gateway.query(`{ viewing(entity: "${VIEWING}") { rating _hex } }`);
    const tabView = inTab.data as { viewing: { rating: number; _hex: string } };
    expect(tabView.viewing._hex.length).toBeGreaterThan(0);

    const dir = mkdtempSync(join(tmpdir(), "loam-tutorial-"));
    const io = { out: () => {}, err: (s: string) => console.error(s) };
    try {
      const file = join(dir, "my-store.json");
      writeFileSync(file, buildExport(loam, ctx));
      const exported = JSON.parse(readFileSync(file, "utf8")) as { seed: string };
      expect(await run(["init", "--home", dir, "--seed", exported.seed], io)).toBe(0);
      expect(await run(["pull", file, "--home", dir], io)).toBe(0);

      const laptop = await Gateway.open(new SqliteBackend(storePath(dir)), { seed: exported.seed });
      const answer = await laptop.query(`{ viewing(entity: "${VIEWING}") { rating _hex } }`);
      const laptopView = answer.data as { viewing: { rating: number; _hex: string } };
      expect(laptopView.viewing._hex).toBe(tabView.viewing._hex);
      await laptop.close();
    } finally {
      await ctx.gateway.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
