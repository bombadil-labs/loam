import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as loam from "../../src/browser/index.js";
import { run } from "../../src/cli/cli.js";
import { storePath } from "../../src/cli/config.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemStorage } from "../store/mem-storage.js";
import {
  CHASE,
  DIARY,
  asStored,
  claimedIdOf,
  MOVIE_NIGHT,
  RAE,
  TENET,
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
import { stamped } from "../../src/gateway/stamp.js";

vi.setConfig({ testTimeout: 120_000 });

let clock = 1_753_000_000_000;
const nextTs = (): number => ++clock;

async function makeCtx(storage: MemStorage): Promise<LessonCtx> {
  const { gateway, seed, author } = await bootTutorialStore(loam, storage);
  return { gateway, storage, seed, author, ts: nextTs };
}

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

const PANE_LABELS = ["View", "Views", "Ground", "Glossary"] as const;

interface CopyUnit {
  readonly lesson: number;
  readonly where: string;
  readonly text: string;
}

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

const BANNED = ["schema", "hyperschema", "gather"] as const;

function bannedUses(arc: Lesson[]): string[] {
  const found: string[] = [];
  for (const unit of copyUnits(arc)) {
    for (const word of BANNED) {
      if (new RegExp(`\\b${word}s?\\b`, "i").test(unit.text))
        found.push(`"${word}" in ${unit.where}`);
    }
  }
  return found;
}

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
      await enterLesson(loam, ctx, lesson);

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
    expect(readProgress(ctx).steps.has(step.id)).toBe(false);
    await ctx.gateway.close();
  });
});

describe("the satisfiability rule", () => {
  it("every step's page observable roots at an element the SHELL declares", () => {
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

    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.entered).length).toBeGreaterThanOrEqual(
      arc.length,
    );
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.step).length).toBeGreaterThanOrEqual(steps);
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.quiz).length).toBeGreaterThanOrEqual(quizzes);
    expect(claimsWithContext(ctx, TUTORIAL_CONTEXTS.checkpoint).length).toBeGreaterThanOrEqual(
      arc.length,
    );

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
    expect(classifyDelta(landed!, again.author).kind).toBe("tutorial");
    await again.gateway.close();
  });

  it("a record that is also a grant is a GRANT — one delta cannot be progress at one level and law at the other", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    await playLesson(buildArc(loam)[0]!, ctx);
    const before = readProgress(ctx).steps.size;

    await ctx.gateway.federate([
      loam.signClaims(
        {
          ...stamped(ctx.ts()),
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

    await ctx.gateway.federate([
      loam.signClaims(
        {
          ...stamped(ctx.ts()),
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

    for (const lesson of arc) {
      await playLesson(lesson, ctx);
      if (lesson.id === withQuiz!.id) break;
    }
    expect(readProgress(ctx).skipped.has(quiz.id)).toBe(false);
    await skipQuiz(loam, ctx, quiz);

    const after = readProgress(ctx);
    expect(after.skipped.has(quiz.id), "the skip was not recorded").toBe(true);
    expect([...after.quiz.keys()]).toEqual([]);
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

    const strangerSeed = "5a".repeat(32);
    const stranger = loam.authorForSeed(strangerSeed);
    const forged = loam.signClaims(
      {
        ...stamped(ctx.ts()),
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

    const mine = loam.signClaims(
      loam.makeNegationClaims(ctx.author, ctx.ts(), stepClaim.id, "not really"),
      ctx.seed,
    );
    await ctx.gateway.append([mine]);
    expect(readProgress(ctx).steps.has(banked)).toBe(false);

    const undo = loam.signClaims(
      loam.makeNegationClaims(ctx.author, ctx.ts(), mine.id, "yes it was"),
      ctx.seed,
    );
    await ctx.gateway.append([undo]);
    expect(readProgress(ctx).steps.has(banked), "a struck strike did not revive its target").toBe(
      true,
    );

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
      expect(ctx.gateway.offeredDeltas().some((d) => d.id === entry.deltaId)).toBe(true);
    }

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
    storage.setItem(`${STORE_PREFIX}ui:junk`, "not a delta");

    expect(takeCheckpoint(storage, 1).ok).toBe(true);
    const blob = readCheckpoint(storage, 1)!;
    for (const key of Object.keys(blob.rows)) {
      expect(key, "a checkpoint copied something that is not a delta row").toMatch(
        /^loam:tutorial:[0-9a-f]+$/,
      );
    }
    expect(JSON.stringify(blob)).not.toContain(ctx.seed);
    expect(storage.getItem(SEED_KEY)).toBe(ctx.seed);

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
    for (const d of discarded) expect(ids.has(d.id), `${d.id} survived the revert`).toBe(false);
    expect(ids.has(survivor!.id), "the pre-checkpoint claim did not survive the revert").toBe(true);
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

    storage.removeItem(`${STORE_PREFIX}${condemned}`);
    const restored = restoreCheckpoint(storage, arc[0]!.id, { erasedIds: [condemned] });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.refused, "the erased record was not named").toContain(condemned);
    expect(rowIds(storage), "a revert resurrected an erased record").not.toContain(condemned);
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
    await playLesson(arc[1]!, ctx);
    const later = rowIds(roomy).filter((id) => !frozen.includes(id));
    expect(
      later.length,
      "the second lesson landed nothing that lives only in the store",
    ).toBeGreaterThan(0);
    await ctx.gateway.close();

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
    takeCheckpoint(storage, arc[0]!.id);
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

    const tight = new MemStorage(2048);
    for (const key of roomy.keys()) {
      try {
        tight.setItem(key, roomy.getItem(key)!);
      } catch {
        break;
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

    const decoy = "ab".repeat(34);
    storage.setItem(`${STORE_PREFIX}${decoy}`, smuggled);
    expect((await bankCheckpoint(loam, ctx, 7)).ok).toBe(true);

    const blob = readCheckpoint(storage, 7)!;
    expect(
      Object.keys(blob.rows),
      "a checkpoint copied a row the store does not hold",
    ).not.toContain(`${STORE_PREFIX}${decoy}`);
    expect(Object.keys(blob.rows)).toContain(`${STORE_PREFIX}${real}`);
    await ctx.gateway.close();
  });

  it("a revert keeps a negation whose erasure is INSIDE the checkpoint too", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const finale = lessonOfRole(arc, "erasure-finale");
    for (const lesson of arc) {
      await playLesson(lesson, ctx);
      if (lesson.id === finale.id) break;
    }
    expect((await bankCheckpoint(loam, ctx, finale.id)).ok).toBe(true);
    const erasure = ctx.gateway
      .offeredDeltas()
      .find((d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "loam.erasure",
        ),
      )!;
    expect(Object.keys(readCheckpoint(storage, finale.id)!.rows)).toContain(
      `${STORE_PREFIX}${erasure.id}`,
    );
    const negation = loam.signClaims(
      loam.makeNegationClaims(ctx.author, ctx.ts(), erasure.id, "on reflection"),
      ctx.seed,
    );
    await ctx.gateway.append([negation]);
    expect(loam.readErasures(ctx.gateway.reactor, ctx.gateway.validityNow(), ctx.author).size).toBe(
      0,
    );
    await ctx.gateway.close();

    const restored = restoreCheckpoint(storage, finale.id, { erasedIds: [] });
    expect(restored.ok).toBe(true);
    const back = await makeCtx(storage);
    expect(
      loam.readErasures(back.gateway.reactor, back.gateway.validityNow(), back.author).size,
      "a revert re-asserted a forgetting the operator had withdrawn",
    ).toBe(0);
    await back.gateway.close();
  });

  it("a refused checkpoint claims nothing: no blob, and no signed record that one was taken", async () => {
    const roomy = new MemStorage();
    const ctx = await makeCtx(roomy);
    await playLesson(buildArc(loam)[0]!, ctx);
    await ctx.gateway.close();

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
    expect(
      readProgress(on).checkpoints,
      "the store says a checkpoint was taken, and no blob backs it",
    ).not.toContain(1);
    expect(checkpointLessons(failing as unknown as MemStorage)).toEqual([]);
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

    const erasure = ctx.gateway
      .offeredDeltas()
      .find((d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "loam.erasure",
        ),
      )!;
    const negation = loam.signClaims(
      loam.makeNegationClaims(ctx.author, ctx.ts(), erasure.id, "on reflection"),
      ctx.seed,
    );
    await ctx.gateway.append([negation]);
    expect(loam.readErasures(ctx.gateway.reactor, ctx.gateway.validityNow(), ctx.author).size).toBe(
      0,
    );
    await ctx.gateway.close();

    const restored = restoreCheckpoint(storage, arc[0]!.id, { erasedIds: [] });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.keptOrders, "the erasure receipt was deleted by a revert").toContain(
      erasure.id,
    );
    expect(restored.keptOrders, "the negation was deleted while its receipt stayed").toContain(
      negation.id,
    );

    const back = await makeCtx(storage);
    expect(
      loam.readErasures(back.gateway.reactor, back.gateway.validityNow(), back.author).size,
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
    const erased = [
      ...loam.readErasures(ctx.gateway.reactor, ctx.gateway.validityNow(), ctx.author),
    ];
    expect(erased.length, "the erasure lesson erased nothing").toBeGreaterThan(0);

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

    for (const lesson of arc) {
      if (lesson.id === finale.id) break;
      await playLesson(lesson, ctx);
      expect(takeCheckpoint(storage, lesson.id).ok).toBe(true);
    }
    const boundaries = checkpointLessons(storage);
    expect(boundaries.length, "the arc reaches its erasure with no checkpoints").toBeGreaterThan(1);

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
    for (const lesson of checkpointLessons(storage)) {
      const blob = readCheckpoint(storage, lesson)!;
      for (const id of condemned) expect(Object.keys(blob.rows)).not.toContain(STORE_PREFIX + id);
    }
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
    const erased = [
      ...loam.readErasures(ctx.gateway.reactor, ctx.gateway.validityNow(), ctx.author),
    ];
    expect(erased.length, "the finale erased nothing").toBeGreaterThan(0);

    const stored = (w: string): string => JSON.stringify(w).slice(1, -1);
    const gone = condemned.filter((w) => !text.includes(stored(w)));
    const survived = condemned.filter((w) => text.includes(stored(w)));
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
    expect(text, "the export dropped the receipt along with the bytes").toContain("loam.erasure");
    await ctx.gateway.close();
  });
});

describe("the vocabulary is earned before it is used", () => {
  it("the manifest is the arc script's twenty-one, in the script's order", () => {
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
      "negation",
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
    const planted: Lesson = { ...early, copy: `${early.copy} Every delta here is signed.` };
    const violations = earlyUses(arc.map((l) => (l.id === early.id ? planted : l)));
    expect(violations.length, "the scan did not notice a term used eight lessons early").toBe(1);
    expect(violations[0]).toContain("delta");
    expect(violations[0]).toContain("lesson 3");
    expect(violations[0]).toContain("lesson 11");

    const inStep: Lesson = {
      ...early,
      steps: early.steps.map((st, i) => (i === 0 ? { ...st, want: `${st.want} A delta.` } : st)),
    };
    const stepHits = earlyUses(arc.map((l) => (l.id === early.id ? inStep : l)));
    expect(stepHits.length, "a term used early in a step's framing went unscanned").toBe(1);
    expect(stepHits[0]).toContain(`step ${early.steps[0]!.id} want`);

    const withQuiz = arc.find((l) => l.quiz !== undefined && l.id < 11)!;
    const inChoice: Lesson = {
      ...withQuiz,
      quiz: {
        ...withQuiz.quiz!,
        questions: withQuiz.quiz!.questions.map((q, i) =>
          i === 0 ? { ...q, choices: [...q.choices, "Every delta, in order"] } : q,
        ),
      },
    };
    const choiceHits = earlyUses(arc.map((l) => (l.id === withQuiz.id ? inChoice : l)));
    expect(choiceHits.length, "a term used early in a quiz choice went unscanned").toBe(1);
    expect(choiceHits[0]).toContain("choice");

    const shell = readFileSync(join(process.cwd(), "demos", "tutorial", "index.html"), "utf8");
    for (const label of PANE_LABELS) {
      expect(shell, `"${label}" is not a label this page prints`).toContain(label);
    }
    const furniture: Lesson = { ...early, copy: `${early.copy} Open the Ground pane.` };
    expect(earlyUses(arc.map((l) => (l.id === early.id ? furniture : l)))).toEqual([]);

    const idea: Lesson = { ...early, copy: `${early.copy} It all sits in the ground together.` };
    const ideaHits = earlyUses(arc.map((l) => (l.id === early.id ? idea : l)));
    expect(
      ideaHits.length,
      "lowercase `ground` passed as a pane name — the carve-out stopped reading case",
    ).toBe(1);
    expect(ideaHits[0]).toContain('"ground"');
  });

  it("every word the arc introduces is a word the arc actually says — in a lesson, not in the glossary", () => {
    const arc = buildArc(loam);
    const spoken = copyUnits(arc).filter((u) => !u.where.includes("glossary entry"));
    const orphans: string[] = [];
    for (const term of TERMS) {
      const said = spoken.some(
        (u) =>
          u.lesson >= term.lesson &&
          term.forms.some((form) => new RegExp(`\\b${form}\\b`, "i").test(u.text)),
      );
      if (!said) orphans.push(term.term);
    }
    expect(orphans, "the glossary defines words the arc never says").toEqual([]);
    const inMeaningsOnly = TERMS.filter((t) =>
      TERMS.some(
        (other) => other.term !== t.term && new RegExp(`\\b${t.term}\\b`, "i").test(other.meaning),
      ),
    );
    expect(
      inMeaningsOnly.length,
      "no term is used inside another's meaning — this exclusion is measuring nothing",
    ).toBeGreaterThan(0);
  });

  it("the names this arc refuses to use never appear — and the scan for them is not asleep", () => {
    const arc = buildArc(loam);
    expect(bannedUses(arc)).toEqual([]);

    const withQuiz = arc.find((l) => l.quiz !== undefined)!;
    const inStep: Lesson = {
      ...withQuiz,
      steps: withQuiz.steps.map((st, i) =>
        i === 0 ? { ...st, want: `${st.want} The schema decides.` } : st,
      ),
    };
    const caughtInStep = bannedUses(arc.map((l) => (l.id === withQuiz.id ? inStep : l)));
    expect(caughtInStep.length, "a banned name in a step's framing went unscanned").toBe(1);
    expect(caughtInStep[0]).toContain("step");

    const inChoice: Lesson = {
      ...withQuiz,
      quiz: {
        ...withQuiz.quiz!,
        questions: withQuiz.quiz!.questions.map((q, i) =>
          i === 0 ? { ...q, choices: [...q.choices, "By running a gather"] } : q,
        ),
      },
    };
    const caughtInChoice = bannedUses(arc.map((l) => (l.id === withQuiz.id ? inChoice : l)));
    expect(caughtInChoice.length, "a banned name in a quiz choice went unscanned").toBe(1);
    expect(caughtInChoice[0]).toContain("choice");
  });
});

describe("the byte-level guards, at the level bytes are spelled", () => {
  it("asStored is the row's own escaping: a needle it produces round-trips back to the words", () => {
    for (const words of [
      "plain words",
      'a line with "quotes" in it',
      "a back\\slash and a \ttab",
      "a newline\nand another",
      "unicode — em dash, curly ’quote’",
    ]) {
      expect(JSON.parse(`"${asStored(words)}"`), `asStored mangled: ${words}`).toBe(words);
    }
    const condemned = 'jamie texted me tonight: "i can\'t do this on my own any more."';
    expect(asStored(condemned)).not.toBe(condemned);
    expect(asStored(condemned)).toContain('\\"');
  });

  it("claimedIdOf reads a row's own id, and refuses to invent one", () => {
    expect(claimedIdOf(JSON.stringify({ id: "abc123", claims: {} }))).toBe("abc123");
    expect(claimedIdOf(JSON.stringify({ id: 7 }))).toBe("");
    expect(claimedIdOf(JSON.stringify({ claims: {} }))).toBe("");
    expect(claimedIdOf("not json at all")).toBe("");
    expect(claimedIdOf(JSON.stringify(null))).toBe("");
    expect(claimedIdOf(JSON.stringify(["a"]))).toBe("");
  });

  it("the finale's verdict catches a MISFILED row: innocent key, condemned bytes", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    const finale = lessonOfRole(arc, "erasure-finale");
    for (const lesson of arc) {
      await playLesson(lesson, ctx);
      if (lesson.id === finale.id) break;
    }
    const sweepStep = finale.steps.find((s) => s.id === "14.3")!;
    expect(sweepStep, "the finale has no 14.3 to ask about the checkpoints").toBeDefined();
    const erased = [
      ...loam.readErasures(ctx.gateway.reactor, ctx.gateway.validityNow(), ctx.author),
    ];
    expect(erased.length, "the finale erased nothing").toBeGreaterThan(0);

    expect(await sweepStep.observe.store(ctx)).toBe(true);

    const innocent = "cd".repeat(34);
    storage.setItem(
      `${CKPT_PREFIX}99`,
      JSON.stringify({
        version: 1,
        lesson: 99,
        rows: { [`${STORE_PREFIX}${innocent}`]: JSON.stringify({ id: erased[0]!, claims: {} }) },
      }),
    );
    expect(
      await sweepStep.observe.store(ctx),
      "a checkpoint holding the erased record under another name passed the finale's verdict",
    ).toBe(false);

    storage.setItem(
      `${CKPT_PREFIX}99`,
      JSON.stringify({
        version: 1,
        lesson: 99,
        rows: { [`${STORE_PREFIX}${innocent}`]: JSON.stringify({ id: innocent, claims: {} }) },
      }),
    );
    expect(
      await sweepStep.observe.store(ctx),
      "a blob holding nothing condemned was refused anyway",
    ).toBe(true);
    await ctx.gateway.close();
  });
});

describe("the arc's names are durable", () => {
  it("pins every id a banked record already points at — renaming one orphans a student mid-arc", () => {
    expect({ DIARY, VIEWING, TENET, MOVIE_NIGHT, CHASE, RAE }).toEqual({
      DIARY: "diary:mine",
      VIEWING: "viewing:arrival",
      TENET: "viewing:tenet",
      MOVIE_NIGHT: "viewing:paddington-2",
      CHASE: "viewing:fast-and-furious",
      RAE: "person:rae",
    });

    const arc = buildArc(loam);
    expect(arc.map((l) => `${l.id}:${l.role}`)).toEqual([
      "1:opening",
      "2:describe",
      "3:first-write",
      "4:rewatch",
      "5:unsay",
      "6:as-of",
      "7:second-hand",
      "8:policies",
      "9:shelves",
      "10:evolution",
      "11:reveal",
      "12:stranger",
      "13:revocation",
      "14:erasure-finale",
      "15:homecoming",
    ]);
    expect(arc.flatMap((l) => l.steps.map((s) => s.id))).toEqual([
      "1.1",
      "1.2",
      "1.3",
      "1.4",
      "2.1",
      "3.1",
      "3.2",
      "3.3",
      "4.1",
      "4.2",
      "5.1",
      "6.1",
      "6.2",
      "6.3",
      "7.1",
      "7.2",
      "7.3",
      "8.1",
      "8.2",
      "8.3",
      "9.1",
      "10.1",
      "10.2",
      "10.3",
      "10.4",
      "11.1",
      "11.2",
      "12.1",
      "12.2",
      "13.1",
      "13.2",
      "13.3",
      "13.4",
      "14.1",
      "14.2",
      "14.3",
      "14.4",
      "15.1",
      "15.2",
      "15.3",
    ]);
    expect(arc.filter((l) => l.quiz !== undefined).map((l) => l.quiz!.id)).toEqual([
      "act-i",
      "act-ii",
      "act-iii",
      "act-iv",
      "act-v",
    ]);
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

    const glossary = readGlossary(ctx);
    expect(glossary.map((e) => e.term)).toEqual(TERMS.map((t) => t.term));
    expect(glossary.map((e) => e.meaning)).toEqual(TERMS.map((t) => t.meaning));
    for (const entry of glossary) {
      expect(entry.lesson).toBe(TERMS.find((t) => t.term === entry.term)!.lesson);
      expect(ctx.gateway.offeredDeltas().some((d) => d.id === entry.deltaId)).toBe(true);
    }

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
    expect(arc.filter((l) => l.quiz !== undefined).length).toBe(5);
    expect([...progress.quiz.values()].every((r) => r.correct)).toBe(true);
    await ctx.gateway.close();
  });

  it("a stranger's STRIKE reaches the plain description and neither shelf — the mask half of a narrowed reading", async () => {
    const storage = new MemStorage();
    const ctx = await makeCtx(storage);
    const arc = buildArc(loam);
    for (const lesson of arc) {
      await playLesson(lesson, ctx);
      if (lesson.id === 9) break;
    }

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

    const plain = (await ctx.gateway.query(`{ viewing(entity: "${VIEWING}") { rating } }`)) as {
      data?: { viewing: { rating: number } };
    };
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

    for (const lesson of arc) {
      if (lesson.id === finale.id) break;
      await playLesson(lesson, ctx);
      expect((await bankCheckpoint(loam, ctx, lesson.id)).ok).toBe(true);
    }
    const before = checkpointLessons(storage);
    expect(before.length, "the arc reaches its forgetting with no checkpoints").toBeGreaterThan(1);
    const bystander = before[0]!;
    const bystanderHeld = Object.keys(readCheckpoint(storage, bystander)!.rows);
    expect(
      bystanderHeld.length,
      "the bystander checkpoint holds nothing to be spared",
    ).toBeGreaterThan(0);
    const doomed = before.filter((lesson) => {
      const blob = readCheckpoint(storage, lesson)!;
      return Object.values(blob.rows).some((row) => String(row).includes("jamie texted me"));
    });
    expect(doomed.length, "no checkpoint was holding the words the finale erases").toBe(1);

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
    const erased = [
      ...loam.readErasures(ctx.gateway.reactor, ctx.gateway.validityNow(), ctx.author),
    ];
    expect(erased.length, "the finale erased nothing").toBeGreaterThan(0);
    for (const lesson of doomed) {
      expect(after, `checkpoint ${lesson} held the erased words and survived`).not.toContain(
        lesson,
      );
      expect(storage.getItem(`${CKPT_PREFIX}${lesson}`)).toBeNull();
    }
    expect(after, "the sweep took a checkpoint that held none of those bytes").toContain(bystander);
    expect(Object.keys(readCheckpoint(storage, bystander)!.rows)).toEqual(bystanderHeld);
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
