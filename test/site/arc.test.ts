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
// The arc here is "A Store of Your Own" (T227): fifteen lessons in five acts. The engine's
// assertions are written against the arc's SHAPE and its lesson ROLES, never against a lesson
// number, so a later rewrite of the content leaves them standing. The CONTENT assertions — the
// term manifest, the vocabulary scan, the glossary trail — name the arc on purpose, because
// that is what they are for.
//
// FOUR GAPS, NAMED. (1) The progress-claims case asserts the CLAIMS and the reading over them;
// the page's revert rail renders its checkpoint rows from the BLOB KEYS instead, so the two can
// legitimately differ. The ordinary cause is a REVERT — restoring an earlier boundary drops the
// later blobs while the claims that recorded them stay in the ground, which is right: the
// claims are history and the blobs are what you can still return to. (A refused boundary cannot
// cause it: the claim is never written unless a blob backs it, which is its own case below.)
// (2) Nothing here drives the page: the render, the in-page confirm and the reload belong to
// `test/browser/tutorial.test.ts`. (3) The finale's own sweep observable is deliberately
// ONE-SIDED — it may not require a surviving checkpoint, because the frozen browser suite
// requires that lesson to be passable with every blob deleted. The other side (a bystander blob
// is SPARED) is asserted here, in "the finale sweeps the real checkpoints", where this file owns
// the fixture and can guarantee a bystander exists. (4) The vocabulary scan reads the arc's own
// copy, not the page's furniture: a pane LABEL in `index.html` is not a lesson's word, and the
// scan says so by allowing the capitalised pane names and nothing else.

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
  MOVIE_NIGHT,
  TERMS,
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

// --- the vocabulary scan ------------------------------------------------------------------------
//
// One rule, mechanically: NO TERM APPEARS IN LESSON COPY BEFORE THE LESSON THAT INTRODUCES IT.
// Lesson granularity is deliberate. A lesson's own terms are planted the moment the student
// arrives, before a word of it is on screen, so a lesson may use what it introduces; a term
// planted from inside a STEP (the reveal's payoff) still belongs to its lesson, because the
// lesson that earns a word is the lesson allowed to say it.
//
// PANE NAMES ARE FURNITURE, NOT VOCABULARY. `index.html` labels a tab "Ground" and another
// "View", and lesson one has to be able to say which tab to open. The scan therefore allows a
// match whose exact text is one of those labels — capitalised, as the page prints them — and
// nothing else. A lowercase "ground" in lesson one is still a violation, which is the point.

const PANE_LABELS = ["View", "Views", "Ground", "Glossary"] as const;

interface CopyUnit {
  readonly lesson: number;
  readonly where: string;
  readonly text: string;
}

/** Every sentence the arc SHOWS a student, in reading order, tagged with its lesson. */
function copyUnits(arc: Lesson[]): CopyUnit[] {
  const units: CopyUnit[] = [];
  for (const lesson of arc) {
    const at = (where: string, text: string): void => {
      units.push({ lesson: lesson.id, where: `lesson ${lesson.id} ${where}`, text });
    };
    at("title", lesson.title);
    at("copy", lesson.copy);
    for (const t of lesson.terms) at(`glossary entry "${t.term}"`, t.meaning);
    for (const step of lesson.steps) {
      at(`step ${step.id} label`, step.label);
      at(`step ${step.id} have`, step.have);
      at(`step ${step.id} want`, step.want);
      at(`step ${step.id} how`, step.how);
    }
    if (lesson.quiz !== undefined) {
      for (const q of lesson.quiz.questions) {
        at(`quiz ${lesson.quiz.id} question`, q.ask);
        for (const choice of q.choices) at(`quiz ${lesson.quiz.id} choice`, choice);
      }
    }
  }
  return units;
}

/** Every place a word of the arc's vocabulary is used before the lesson that introduces it. */
function earlyUses(arc: Lesson[]): string[] {
  const found: string[] = [];
  for (const unit of copyUnits(arc)) {
    for (const term of TERMS) {
      if (term.lesson <= unit.lesson) continue;
      for (const form of term.forms) {
        const hits = unit.text.match(new RegExp(`\\b${form}\\b`, "gi")) ?? [];
        for (const hit of hits) {
          if ((PANE_LABELS as readonly string[]).includes(hit)) continue;
          found.push(
            `"${term.term}" (introduced in lesson ${term.lesson}) is used as "${hit}" in ` +
              `${unit.where}`,
          );
        }
      }
    }
  }
  return found;
}

describe("the arc, headless: every step earns its store observable", () => {
  it("walks the whole arc in order; no lesson is green before it runs; every step's store predicate turns true", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    expect(arc.length).toBeGreaterThanOrEqual(2);

    for (const lesson of arc) {
      expect(await lesson.check(ctx), `lesson ${lesson.id} green before it ran`).toBe(false);
      // ARRIVING is part of playing a lesson, exactly as it is on the page: the entry claim and
      // the lesson's glossary terms land before a word of it is on screen. A walk that skipped
      // it would run the steps in a store no student could ever be standing in.
      await enterLesson(loam, ctx, lesson);

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

  it("refuses to bank a step whose work THREW, and says what the store said", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const lesson = arc[0]!;
    const step = lesson.steps[0]!;
    await enterLesson(loam, ctx, lesson);

    // The store refuses a write — a real path, since every step writes through the door.
    const throwing: LessonStep = {
      ...step,
      run: () => Promise.reject(new Error("the door said no")),
    };
    const outcome = await completeStep(loam, ctx, lesson, throwing);
    expect(outcome.ok, "a step whose work threw was banked anyway").toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain(String(lesson.id));
    expect(outcome.message).toContain(step.id);
    expect(outcome.message, "the refusal hides what the store actually said").toContain(
      "the door said no",
    );
    expect(readProgress(ctx).steps.has(step.id)).toBe(false);
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

describe("the satisfiability rule", () => {
  it("every step's page observable roots at an element the SHELL declares", () => {
    // THE F1 CLASS, caught at authoring time. A selector that names an element some `ui` field
    // conjures is satisfiable only while that field is set — so a step observing it can become
    // impossible to complete after a reload, or after an irreversible act whose one-time notice
    // has passed. Rooting every observable at an id in `index.html` makes the predicate a
    // question about STATE rather than about an event, because those elements are always there
    // and their content is rendered from the store.
    const shell = readFileSync(join(process.cwd(), "demos", "tutorial", "index.html"), "utf8");
    const declared = new Set([...shell.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!));
    expect(declared.size, "the shell declares no ids at all").toBeGreaterThan(4);

    for (const lesson of buildArc(loam)) {
      for (const step of lesson.steps) {
        const selector = step.observe.page?.selector;
        expect(selector, `step ${step.id} has no page observable`).toBeDefined();
        const root = /^#([A-Za-z0-9_-]+)/.exec(selector!)?.[1];
        expect(
          root,
          `step ${step.id} observes "${selector!}", which does not root at an id`,
        ).toBeDefined();
        expect(
          declared.has(root!),
          `step ${step.id} observes #${root!}, which index.html does not declare — ` +
            `an element the page conjures can stop existing, and the step becomes impossible`,
        ).toBe(true);
      }
    }
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
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.checkpoint).length).toBeGreaterThanOrEqual(
      arc.length,
    );

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

    // ...and the same holds for a constitutional context the CLASSIFIER DOES NOT NAME. There
    // are more `loam.*` contexts in this codebase than that list knows, so the badge cannot be
    // decided by enumerating them: a hybrid is an ordinary claim, and it stays on screen.
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
                entity: { id: "tutorial:step:0.1", context: TUTORIAL_CONTEXTS.step },
              },
            },
            { role: "name", target: { kind: "primitive", value: "0.1" } },
            {
              role: "declares",
              target: { kind: "entity", entity: { id: "loam:store", context: "loam.tenant" } },
            },
          ],
        },
        ctx.seed,
      ),
    ]);
    const unnamed = ctx.gateway
      .offeredDeltas()
      .find((d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.id === "tutorial:step:0.1",
        ),
      );
    expect(unnamed, "the unnamed-context delta never landed").toBeDefined();
    expect(
      classifyDelta(unnamed!, ctx.author).kind,
      "a hybrid was claimed for the tutorial by a badge that only enumerates",
    ).toBe("fact");
    expect(readProgress(ctx).steps.size).toBe(before);
    await ctx.gateway.close();
  });

  it("a skipped quiz is recorded as skipped, and manufactures no answer", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const withQuiz = arc.find((l) => l.quiz !== undefined);
    expect(withQuiz, "the arc declares no quiz").toBeDefined();
    const quiz = withQuiz!.quiz!;

    // From the top: a quiz closes an ACT, and its lesson stands on the ones before it.
    for (const lesson of arc) {
      await playLesson(lesson, ctx);
      if (lesson.id === withQuiz!.id) break;
    }
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

  it("a checkpoint copies only what the STORE vouches for — a misfiled row never enters one", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    await playLesson(buildArc(loam)[0]!, ctx);
    const rows = rowIds(storage);
    const real = rows[rows.length - 1]!;
    const smuggled = storage.getItem(`${STORE_PREFIX}${real}`)!;

    // The row's bytes, filed under a key naming something else. The driver quarantines exactly
    // this (the key and the claims disagree) and leaves it lying in localStorage — so a blob
    // that copied every hex key would carry bytes no id names truthfully, and the sweep, which
    // can only ask about ids, would call that checkpoint clean.
    const decoy = "ab".repeat(34);
    storage.setItem(`${STORE_PREFIX}${decoy}`, smuggled);
    expect((await bankCheckpoint(loam, ctx, 7)).ok).toBe(true);

    const blob = readCheckpoint(storage, 7)!;
    expect(
      Object.keys(blob.rows),
      "a checkpoint copied a row the store does not hold",
    ).not.toContain(`${STORE_PREFIX}${decoy}`);
    // ...and the real row, which the store DOES hold, is in there.
    expect(Object.keys(blob.rows)).toContain(`${STORE_PREFIX}${real}`);
    await ctx.gateway.close();
  });

  it("a revert keeps a forgiveness whose tombstone is INSIDE the checkpoint too", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const finale = lessonOfRole(arc, "erasure-finale");
    for (const lesson of arc) {
      await playLesson(lesson, ctx);
      if (lesson.id === finale.id) break;
    }
    // The checkpoint is taken AFTER the erasure, so the tombstone is in the BLOB rather than
    // only in the store. The forgiveness comes later still, and lives nowhere but the store.
    expect((await bankCheckpoint(loam, ctx, finale.id)).ok).toBe(true);
    const tombstone = ctx.gateway
      .offeredDeltas()
      .find((d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "loam.erasure",
        ),
      )!;
    expect(Object.keys(readCheckpoint(storage, finale.id)!.rows)).toContain(
      `${STORE_PREFIX}${tombstone.id}`,
    );
    const forgiveness = loam.signClaims(
      loam.makeNegationClaims(ctx.author, ctx.ts(), tombstone.id, "on reflection"),
      ctx.seed,
    );
    await ctx.gateway.append([forgiveness]);
    expect(loam.readTombstones(ctx.gateway.reactor, ctx.author).size).toBe(0);
    await ctx.gateway.close();

    // Reverting to that boundary restores the tombstone from the blob. The forgiveness is not
    // in the blob — so a guard that only looked at what SURVIVES outside it would delete the
    // strike and re-assert a forgetting the operator had withdrawn.
    const restored = restoreCheckpoint(storage, finale.id, { erasedIds: [] });
    expect(restored.ok).toBe(true);
    const back = await makeCtx(storage);
    expect(
      loam.readTombstones(back.gateway.reactor, back.author).size,
      "a revert re-asserted a forgetting the operator had withdrawn",
    ).toBe(0);
    await back.gateway.close();
  });

  it("a refused checkpoint claims nothing: no blob, and no signed record that one was taken", async () => {
    const roomy = new MemStorage();
    const ctx = await makeCtx(roomy);
    await playLesson(buildArc(loam)[0]!, ctx);
    await ctx.gateway.close();

    // A storage that takes the store's rows and refuses the BLOB.
    const tight = new MemStorage();
    for (const key of roomy.keys()) tight.setItem(key, roomy.getItem(key)!);
    const failing = {
      get length() {
        return tight.length;
      },
      key: (i: number) => tight.key(i),
      getItem: (k: string) => tight.getItem(k),
      removeItem: (k: string) => tight.removeItem(k),
      setItem: (k: string, v: string) => {
        if (k.startsWith(CKPT_PREFIX)) {
          throw new DOMException("the quota has been exceeded", "QuotaExceededError");
        }
        tight.setItem(k, v);
      },
    };
    const on = await makeCtx(failing as unknown as MemStorage);
    const outcome = await bankCheckpoint(loam, on, 1, { label: "lesson 1" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // THE CLAIM MUST NOT OUTLIVE THE BLOB. A signed "a checkpoint was taken here" with nothing
    // behind it is a record of a thing that did not happen (H7) — and the rail reads it back.
    expect(
      readProgress(on).checkpoints,
      "the store says a checkpoint was taken, and no blob backs it",
    ).not.toContain(1);
    expect(checkpointLessons(failing as unknown as MemStorage)).toEqual([]);
    // ...and the refusal does not pretend the lesson is unaffected: a later lesson may reach
    // back for this boundary, so it says the checkpoint was not taken.
    expect(outcome.message).toContain("lesson 1");
    expect(outcome.message).toMatch(/no checkpoint/i);
    await on.gateway.close();
  });

  it("a revert keeps the receipt AND the strike that forgave it — an undo does not re-assert a withdrawn forgetting", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const finale = lessonOfRole(arc, "erasure-finale");
    await playLesson(arc[0]!, ctx);
    expect((await bankCheckpoint(loam, ctx, arc[0]!.id)).ok).toBe(true);
    for (const lesson of arc) {
      if (lesson.id === arc[0]!.id) continue;
      await playLesson(lesson, ctx);
      if (lesson.id === finale.id) break;
    }

    // The operator forgives: striking a tombstone withdraws the erasure order (the gateway's
    // own reader treats a struck tombstone as forgiven).
    const tombstone = ctx.gateway
      .offeredDeltas()
      .find((d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "loam.erasure",
        ),
      )!;
    const forgiveness = loam.signClaims(
      loam.makeNegationClaims(ctx.author, ctx.ts(), tombstone.id, "on reflection"),
      ctx.seed,
    );
    await ctx.gateway.append([forgiveness]);
    expect(loam.readTombstones(ctx.gateway.reactor, ctx.author).size).toBe(0);
    await ctx.gateway.close();

    // Revert past both. The receipt stays — and so must its forgiveness, or the store
    // re-asserts a forgetting the operator took back.
    const restored = restoreCheckpoint(storage, arc[0]!.id, { erasedIds: [] });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.keptOrders, "the erasure receipt was deleted by a revert").toContain(
      tombstone.id,
    );
    expect(restored.keptOrders, "the forgiveness was deleted while its receipt stayed").toContain(
      forgiveness.id,
    );

    const back = await makeCtx(storage);
    expect(
      loam.readTombstones(back.gateway.reactor, back.author).size,
      "a revert re-asserted a forgetting the operator had withdrawn",
    ).toBe(0);
    await back.gateway.close();
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

    // The id the finale is about to condemn, named while it is still readable. The sweep is
    // exercised HERE, against these real boundaries, BEFORE the lesson runs its own — so this
    // case pins the function's rule (destroy what holds it, spare what does not) rather than
    // whatever the arc happens to have already cleaned up. The arc's own trigger is the case
    // "the finale sweeps the REAL checkpoints" below.
    const condemned = ctx.gateway
      .offeredDeltas()
      .filter((d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "primitive" && String(p.target.value).includes("jamie texted"),
        ),
      )
      .map((d) => d.id);
    expect(condemned.length, "nothing in the ground is what the finale erases").toBe(1);

    const report = sweepCheckpoints(storage, condemned);
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
      for (const id of condemned) expect(Object.keys(blob!.rows)).not.toContain(STORE_PREFIX + id);
    }
    // No surviving blob anywhere holds the condemned id — the claim the page makes on screen.
    for (const lesson of checkpointLessons(storage)) {
      const blob = readCheckpoint(storage, lesson)!;
      for (const id of condemned) expect(Object.keys(blob.rows)).not.toContain(STORE_PREFIX + id);
    }
    // IDEMPOTENT: a second pass finds nothing to destroy and says so, rather than taking the
    // survivors on a second look. The page runs this on every render, so it had better be.
    const again = sweepCheckpoints(storage, condemned);
    expect(again.destroyed, "a second sweep destroyed a checkpoint it had already spared").toEqual(
      [],
    );
    expect(again.kept.length).toBe(report.kept.length);
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

  it("the homecoming's forgetting travels: the erased words are in no byte of the export, and the diary around them is", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const finale = lessonOfRole(arc, "erasure-finale");

    // Play up to the finale and take the erased record's own words out of the ground BEFORE it
    // is erased — after the erasure there is nowhere left to read them from, which is the point,
    // and a rail that asked for them afterwards would be asserting against an empty string.
    for (const lesson of arc) {
      if (lesson.id === finale.id) break;
      await playLesson(lesson, ctx);
    }
    const condemned = ctx.gateway
      .offeredDeltas()
      .filter((d) =>
        d.claims.pointers.some(
          (p) =>
            p.target.kind === "entity" &&
            p.target.entity.id === MOVIE_NIGHT &&
            p.target.entity.context === "note",
        ),
      )
      .map((d) => {
        const words = d.claims.pointers.find((p) => p.target.kind === "primitive");
        return words?.target.kind === "primitive" ? String(words.target.value) : "";
      })
      .filter((w) => w.length > 0);
    expect(condemned.length, "the movie-night entry carries no notes to forget").toBe(2);

    for (const lesson of arc) {
      if (lesson.id < finale.id) continue;
      await playLesson(lesson, ctx);
    }

    const text = buildExport(loam, ctx);
    const erased = [...loam.readTombstones(ctx.gateway.reactor, ctx.author)];
    expect(erased.length, "the finale erased nothing").toBeGreaterThan(0);

    // TWO-SIDED, at the bytes of the file the student walks out with: one of those two notes is
    // gone from it entirely, and the other is still in there. A file that carried neither would
    // pass a one-sided check while having quietly lost the diary.
    //
    // THE NEEDLE IS ESCAPED THE WAY THE HAYSTACK IS. `text` is `JSON.stringify` output, so a
    // sentence containing a quote is spelled with backslashes in it. Searching for the raw
    // sentence finds nothing whether the words are in the file or not — a guard that can only
    // ever say "clean", which is the worst shape an erasure check can have.
    const stored = (w: string): string => JSON.stringify(w).slice(1, -1);
    const gone = condemned.filter((w) => !text.includes(stored(w)));
    const survived = condemned.filter((w) => text.includes(stored(w)));
    // ...and the escaping is not theoretical: at least one of these two really does need it.
    expect(
      condemned.some((w) => stored(w) !== w),
      "neither note needs escaping — this rail would pass with the naive comparison too",
    ).toBe(true);
    expect(gone.length, "the export still carries the erased words").toBe(1);
    expect(survived.length, "the export lost the note that was never condemned").toBe(1);
    for (const id of erased) {
      expect(
        (JSON.parse(text) as { deltas: { id: string }[] }).deltas.map((d) => d.id),
        `the export carries the erased record ${id}`,
      ).not.toContain(id);
    }
    // ...and the receipt DOES travel, so the other machine knows a forgetting happened here.
    expect(text, "the export dropped the receipt along with the bytes").toContain("loam.erasure");
    await ctx.gateway.close();
  });
});

describe("the vocabulary is earned before it is used", () => {
  it("the manifest is the arc script's twenty-one, in the script's order", () => {
    // The list from `.adlc/specs/48-arc-script.md`, written out rather than derived: a manifest
    // that checked itself would agree with any drift it introduced.
    expect(TERMS.map((t) => t.term)).toEqual([
      "store",
      "record",
      "key",
      "operator",
      "lens",
      "shape",
      "claim",
      "signature",
      "ground",
      "view",
      "strike",
      "moment",
      "author",
      "policy",
      "version",
      "delta",
      "trust",
      "grant",
      "revoke",
      "erase",
      "receipt",
    ]);
    for (const term of TERMS) {
      expect(term.meaning.length, `"${term.term}" has no plain-words meaning`).toBeGreaterThan(20);
      expect(term.forms, `"${term.term}" lists no forms for the scan`).toContain(term.term);
    }
    // `delta` is withheld until the reveal EARNS it: it is the one term a step plants.
    const fromSteps = TERMS.filter((t) => t.step !== undefined);
    expect(fromSteps.map((t) => t.term)).toEqual(["delta"]);
    const reveal = lessonOfRole(buildArc(loam), "reveal");
    expect(reveal.steps.map((s) => s.id)).toContain(fromSteps[0]!.step);
  });

  it("no lesson uses a word before the lesson that introduces it", () => {
    expect(earlyUses(buildArc(loam))).toEqual([]);
  });

  it("...and the scan is not vacuous: a term slipped in early is named, with its lesson", () => {
    const arc = buildArc(loam);
    const early = arc.find((l) => l.id === 3)!;
    // The exact failure this rail exists to catch: a lesson reaching for a word the student has
    // not met. Lesson 3 has no business saying "delta" — the reveal is eight lessons away.
    const planted: Lesson = { ...early, copy: `${early.copy} Every delta here is signed.` };
    const violations = earlyUses(arc.map((l) => (l.id === early.id ? planted : l)));
    expect(violations.length, "the scan did not notice a term used eight lessons early").toBe(1);
    expect(violations[0]).toContain("delta");
    expect(violations[0]).toContain("lesson 3");
    expect(violations[0]).toContain("lesson 11"); // and it says where the word is introduced

    // ...and the OTHER half: it does not fire on the page's own furniture. "Ground" is a tab
    // label in `index.html`, and lesson one has to be able to name the tab it is pointing at.
    const shell = readFileSync(join(process.cwd(), "demos", "tutorial", "index.html"), "utf8");
    for (const label of PANE_LABELS) {
      if (label === "Views") continue; // rendered by app.mjs, not declared in the shell
      expect(shell, `"${label}" is not a pane label in the shell`).toContain(`>${label}<`);
    }
    const furniture: Lesson = { ...early, copy: `${early.copy} Open the Ground pane.` };
    expect(earlyUses(arc.map((l) => (l.id === early.id ? furniture : l)))).toEqual([]);
  });

  it("every word the arc introduces is a word the arc actually says", () => {
    const arc = buildArc(loam);
    const units = copyUnits(arc);
    const orphans: string[] = [];
    for (const term of TERMS) {
      const said = units.some(
        (u) =>
          u.lesson >= term.lesson &&
          term.forms.some((form) => new RegExp(`\\b${form}\\b`, "i").test(u.text)),
      );
      if (!said) orphans.push(term.term);
    }
    // A term planted in the glossary and never used in a lesson is a definition for a word the
    // student never meets — the mirror of the failure above, and just as dishonest.
    expect(orphans, "the glossary defines words the arc never says").toEqual([]);
  });

  it("the names this arc refuses to use never appear", () => {
    // A workshop decision: schema, hyperschema and gather are the deeper names, and this arc
    // teaches without them. They belong to the glossary's appendix, never to a lesson.
    const banned = ["schema", "hyperschema", "gather"];
    const found: string[] = [];
    for (const unit of copyUnits(buildArc(loam))) {
      for (const word of banned) {
        if (new RegExp(`\\b${word}s?\\b`, "i").test(unit.text)) {
          found.push(`"${word}" in ${unit.where}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});

describe("the fifteen lessons, end to end", () => {
  it("plants every term as a claim, in the manifest's order, and every quiz teaches its own lesson", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    expect(arc.length, "the arc is not the fifteen").toBe(15);
    expect(arc[0]!.role).toBe("opening");

    let steps = 0;
    let quizzes = 0;
    for (const lesson of arc) {
      await playLesson(lesson, ctx);
      steps += lesson.steps.length;
      await bankCheckpoint(loam, ctx, lesson.id);
      if (lesson.quiz === undefined) continue;
      // A wrong answer names the step that teaches it, and the page can only LINK a step in the
      // lesson the card belongs to — so a pointer out of the lesson renders nothing at all.
      const own = new Set(lesson.steps.map((s) => s.id));
      for (const [i, q] of lesson.quiz.questions.entries()) {
        expect(
          own.has(q.teaches),
          `quiz ${lesson.quiz.id} question ${i} teaches ${q.teaches}, which is not in lesson ${lesson.id}`,
        ).toBe(true);
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(q.choices.length);
        await answerQuiz(loam, ctx, lesson.quiz, i, q.answer);
        quizzes += 1;
      }
    }

    // THE GLOSSARY TRAIL: one claim per term, in the order the arc earns them, each naming a
    // record the ground really holds.
    const glossary = readGlossary(ctx);
    expect(glossary.map((e) => e.term)).toEqual(TERMS.map((t) => t.term));
    expect(glossary.map((e) => e.meaning)).toEqual(TERMS.map((t) => t.meaning));
    for (const entry of glossary) {
      expect(entry.lesson).toBe(TERMS.find((t) => t.term === entry.term)!.lesson);
      expect(ctx.gateway.offeredDeltas().some((d) => d.id === entry.deltaId)).toBe(true);
    }

    // PER-KIND COUNTS, honest ones: the arc's own totals rather than a floor that any arc meets.
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.glossary).length).toBe(TERMS.length);
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.entered).length).toBe(15);
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.step).length).toBe(steps);
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.quiz).length).toBe(quizzes);
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.checkpoint).length).toBe(15);

    const progress = readProgress(ctx);
    expect(progress.entered).toEqual(arc.map((l) => l.id));
    expect(progress.steps.size).toBe(steps);
    expect(progress.quiz.size).toBe(quizzes);
    expect(progress.checkpoints).toEqual(arc.map((l) => l.id));
    // five acts close with a quiz, and every answer above was the right one
    expect(arc.filter((l) => l.quiz !== undefined).length).toBe(5);
    expect([...progress.quiz.values()].every((r) => r.correct)).toBe(true);
    await ctx.gateway.close();
  });

  it("a stranger's strike reaches the plain description and neither shelf: trust is the reading's, not the store's", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    // Through lesson 9, so both shelves exist and Rae has written.
    for (const lesson of arc) {
      await playLesson(lesson, ctx);
      if (lesson.id === 9) break;
    }

    // The claim a stranger is about to try to retract: YOUR rating of 7, the one My Diary
    // answers with. A shelf that names whose word it hears, and then obeys a stranger's
    // taking-back, is not narrowed at all — it only looks it (H1, the mask half).
    const mine = ctx.gateway
      .offeredDeltas()
      .find(
        (d) =>
          d.claims.author === ctx.author &&
          d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === 7),
      );
    expect(mine, "no rating of your own to strike").toBeDefined();
    const before = (await ctx.gateway.query(`{ myDiary(entity: "${VIEWING}") { rating } }`)).data;
    expect((before as { myDiary: { rating: number } }).myDiary.rating).toBe(7);

    // AND Rae's 4, which is what the plain description currently answers with. Striking only
    // YOUR 7 would leave the plain answer at 4 either way, and the second half of this rail
    // would pass whether the strike bound or not.
    const raes = ctx.gateway
      .offeredDeltas()
      .find(
        (d) =>
          d.claims.author !== ctx.author &&
          d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === 4),
      );
    expect(raes, "Rae has written no rating to strike").toBeDefined();

    const strangerSeed = "5c".repeat(32);
    const stranger = loam.authorForSeed(strangerSeed);
    const strikes = [mine!.id, raes!.id].map((target, i) =>
      loam.signClaims(
        loam.makeNegationClaims(stranger, 9_100_001 + i, target, "no it isn't"),
        strangerSeed,
      ),
    );
    await ctx.gateway.federate(strikes);
    for (const strike of strikes) {
      expect(
        ctx.gateway.offeredDeltas().some((d) => d.id === strike.id),
        "the stranger's strike never landed — this rail would prove nothing",
      ).toBe(true);
    }

    // THE SHELVES DO NOT HEAR IT. Both of them name their hands, and a hand they never named
    // cannot retract what one of them wrote.
    const shelves = (await ctx.gateway.query(
      `{ mine: myDiary(entity: "${VIEWING}") { rating } house: houseDiary(entity: "${VIEWING}") { rating } }`,
    )) as { data?: { mine: { rating: number }; house: { rating: number[] } } };
    expect(
      shelves.data?.mine.rating,
      "a stranger struck the student's own word off their private shelf",
    ).toBe(7);
    expect(shelves.data?.house.rating, "a stranger struck a rating off the house shelf").toEqual([
      9, 7, 4,
    ]);

    // ...and the plain description from lesson two, which hears anybody, DOES obey it. That is
    // the contrast lesson 12 teaches, and a rail that only proved the first half would leave
    // "trust lives in the reading" as decoration.
    const plain = (await ctx.gateway.query(`{ viewing(entity: "${VIEWING}") { rating } }`)) as {
      data?: { viewing: { rating: number } };
    };
    // Both of its top two ratings have been struck by somebody it never agreed to hear, and it
    // obeyed: it falls all the way back to the 9 from lesson three.
    expect(
      plain.data?.viewing.rating,
      "the plain description ignored a strike it has no rule to ignore",
    ).toBe(9);
    await ctx.gateway.close();
  });

  it("the finale sweeps the REAL checkpoints — the arc does it, not this rail, and a bystander survives", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const finale = lessonOfRole(arc, "erasure-finale");

    // Every boundary before the forgetting gets a real checkpoint, exactly as the page takes
    // them. Nothing below calls `sweepCheckpoints`: if lesson 14 stopped triggering it, this
    // goes red.
    for (const lesson of arc) {
      if (lesson.id === finale.id) break;
      await playLesson(lesson, ctx);
      expect((await bankCheckpoint(loam, ctx, lesson.id)).ok).toBe(true);
    }
    const before = checkpointLessons(storage);
    expect(before.length, "the arc reaches its forgetting with no checkpoints").toBeGreaterThan(1);
    const bystander = before[0]!;
    const bystanderHeld = Object.keys(readCheckpoint(storage, bystander)!.rows);
    // The blob that WILL be holding the condemned bytes when the sweep runs — named before the
    // erasure, because afterwards there is no way to identify it.
    const doomed = before.filter((lesson) => {
      const blob = readCheckpoint(storage, lesson)!;
      return Object.values(blob.rows).some((row) => String(row).includes("jamie texted me"));
    });
    expect(doomed.length, "no checkpoint was holding the words the finale erases").toBe(1);

    // THE ESCAPING TRAP, proven rather than commented. A stored row is `JSON.stringify` output,
    // so the condemned sentence lives in it with its quotes backslashed. Searching a row for the
    // sentence as it is written in the source finds NOTHING — a byte-level guard that can only
    // ever report "clean". The lesson's own verdict escapes its needle for this reason, and this
    // is the assertion that would notice if it stopped.
    const rowsOfDoomed = Object.values(readCheckpoint(storage, doomed[0]!)!.rows).map(String);
    const sentence = ctx.gateway
      .offeredDeltas()
      .flatMap((d) => d.claims.pointers)
      .map((pt) => (pt.target.kind === "primitive" ? String(pt.target.value) : ""))
      .find((v) => v.startsWith("jamie texted me"))!;
    expect(sentence, "the condemned sentence is not in the ground").toContain('"');
    expect(
      rowsOfDoomed.some((row) => row.includes(sentence)),
      "the raw sentence WAS findable in a stored row — the escaping hazard has gone away, and " +
        "the lesson's escaped needle is now over-careful rather than necessary",
    ).toBe(false);
    expect(
      rowsOfDoomed.some((row) => row.includes(JSON.stringify(sentence).slice(1, -1))),
      "the escaped sentence is not in the blob either — this rail is measuring nothing",
    ).toBe(true);

    await playLesson(finale, ctx);

    const after = checkpointLessons(storage);
    const erased = [...loam.readTombstones(ctx.gateway.reactor, ctx.author)];
    expect(erased.length, "the finale erased nothing").toBeGreaterThan(0);
    // TWO-SIDED. The blob that held the words is gone from storage entirely...
    for (const lesson of doomed) {
      expect(after, `checkpoint ${lesson} held the erased words and survived`).not.toContain(
        lesson,
      );
      expect(storage.getItem(`${CKPT_PREFIX}${lesson}`)).toBeNull();
    }
    // ...and the bystander is untouched, down to the rows it was keeping.
    expect(after, "the sweep took a checkpoint that held none of those bytes").toContain(bystander);
    expect(Object.keys(readCheckpoint(storage, bystander)!.rows)).toEqual(bystanderHeld);
    // No surviving blob holds the record, by key or by its own words.
    for (const lesson of after) {
      const blob = readCheckpoint(storage, lesson)!;
      for (const id of erased) expect(Object.keys(blob.rows)).not.toContain(STORE_PREFIX + id);
      for (const row of Object.values(blob.rows)) {
        expect(String(row), `checkpoint ${lesson} still carries the words`).not.toContain(
          "jamie texted me",
        );
      }
    }
    await ctx.gateway.close();
  });
});
