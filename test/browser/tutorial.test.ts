import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Browser } from "./cdp.js";
import {
  TutorialPage,
  buildSiteInto,
  dropSite,
  serveSite,
  type ArcLesson,
  type SiteHandle,
} from "./tutorial-driver.js";
import * as loam from "../../src/browser/index.js";
import { buildArc } from "../../demos/tutorial/lessons.mjs";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

let browser: Browser;
let site: SiteHandle;
let dir: string | undefined;
let page: TutorialPage;

beforeAll(async () => {
  dir = buildSiteInto();
  site = await serveSite(dir);
  browser = await Browser.launch();
  page = await TutorialPage.open(browser, site.base);
});

afterAll(async () => {
  page?.close();
  await browser?.close();
  await site?.close();
  dropSite(dir);
});

const roleOf = (arc: ArcLesson[], role: string): ArcLesson => {
  const found = arc.find((l) => l.role === role);
  expect(found, `the arc declares no lesson with role "${role}"`).toBeDefined();
  return found!;
};

async function playLesson(
  lesson: ArcLesson,
  opts: { quiz?: "skip" | "wrong" } = {},
): Promise<void> {
  for (let i = 0; i < lesson.steps.length; i++) {
    await page.runPending();
    expect(await page.text("#step-refusal"), `lesson ${lesson.id} refused a step`).toBe("");
  }
  if (lesson.quiz !== null) {
    if (opts.quiz === "wrong") await page.answerFirstQuestion("wrong");
    await page.click("#quiz-skip");
  }
  if (await page.exists("[data-next-lesson]")) await page.click("[data-next-lesson]");
  else expect((await page.position()).pending, `lesson ${lesson.id} is not done`).toBeNull();
}

async function playUntil(role: string): Promise<{ arc: ArcLesson[]; target: ArcLesson }> {
  await page.reset();
  const arc = await page.arc();
  const target = roleOf(arc, role);
  for (const lesson of arc) {
    if (lesson.id === target.id) break;
    await playLesson(lesson);
  }
  return { arc, target };
}

describe("§48 — one step at a time, and every step observed twice", () => {
  const REGISTERED_ARC = buildArc(loam);

  it("the arc opens at its beginning, and the page's arc is the module's", async () => {
    await page.reset();
    const arc = await page.arc();
    expect(arc.length).toBeGreaterThanOrEqual(2);
    expect(arc[0]!.role, "the arc's first lesson does not declare the opening role").toBe(
      "opening",
    );
    expect(arc.map((l) => l.id)).toEqual(REGISTERED_ARC.map((l) => l.id));
    expect(arc.map((l) => l.role)).toEqual(REGISTERED_ARC.map((l) => l.role));
  });

  for (const [at, lesson] of REGISTERED_ARC.entries()) {
    it(`lesson ${at + 1} of ${REGISTERED_ARC.length}: one pending step, banked only when BOTH observables hold`, async () => {
      expect((await page.position()).lesson, `the page is not on lesson ${lesson.id}`).toBe(
        lesson.id,
      );
      expect(await page.attrs("#lesson-pane", "data-role")).toEqual([lesson.role]);

      for (const step of lesson.steps) {
        const before = await page.position();
        expect(await page.pendingSteps(), "more than one step is pending at once").toEqual([
          step.id,
        ]);
        expect(before.pending).toBe(step.id);
        expect(await page.text(`[data-step="${step.id}"] [data-have]`)).toContain(step.have);
        expect(await page.text(`[data-step="${step.id}"] [data-want]`)).toContain(step.want);
        expect(await page.text(`[data-step="${step.id}"] [data-how]`)).toContain(step.how);
        expect(await page.frameOrder(step.id)).toEqual(["have", "want", "how"]);

        await page.runPending();

        const seen = await page.observes(lesson.id, step.id);
        expect(seen.page, `step ${step.id}: the page observable is false after its run`).toBe(true);
        expect(seen.store, `step ${step.id}: the store observable is false after its run`).toBe(
          true,
        );
        const after = await page.position();
        expect(after.banked, `step ${step.id} did not bank`).toContain(step.id);
        expect(after.pending).not.toBe(step.id);
        expect(await page.text(`[data-step="${step.id}"] .step-mark`)).toBe("✓");
        if (after.pending !== null) {
          expect(await page.text(`[data-step="${after.pending}"] .step-mark`)).toBe("○");
          const left = lesson.steps.length - after.banked.length - 1;
          if (left > 0) {
            expect(await page.text("#lesson-pane")).toContain(`${left} more step`);
          }
        }
      }

      expect(await page.checkpointLessons()).toContain(lesson.id);
      if (lesson.quiz) expect(await page.exists("#quiz-card")).toBe(true);
      if (lesson.quiz) await page.click("#quiz-skip");
      if (await page.exists("[data-next-lesson]")) await page.click("[data-next-lesson]");
    });
  }

  it("the red probe: a step whose work is neutralized refuses to bank, naming its lesson and step", async () => {
    await page.reset();
    const target = await page.advanceToEarningStep();
    expect(target, "no step in this arc earns its own observable").not.toBeNull();
    const { lesson, step } = target!;

    await page.neutralize(lesson, step);
    await page.runPending();

    const refusal = await page.text("#step-refusal");
    expect(refusal).toContain(String(lesson));
    expect(refusal).toContain(step);
    const after = await page.position();
    expect(after.banked, "a step with no effect banked anyway").not.toContain(step);
    expect(after.pending, "the neutralized step stopped being the pending one").toBe(step);
    expect(await page.checkpointLessons()).not.toContain(lesson);
  });

  it("the red probe, other half: the PAGE observable gates too — work that lands unseen does not bank", async () => {
    await page.reset();
    const target = await page.advanceToEarningStep();
    expect(target, "no step in this arc earns its own observable").not.toBeNull();
    const { lesson, step } = target!;

    const missing = await page.blindPageObserve(lesson, step, "selector");
    await page.runPending();
    expect(await page.text("#step-refusal")).toContain(missing);
    expect(await page.text("#step-refusal")).toContain(step);
    expect((await page.position()).banked, "a step nobody could see banked anyway").not.toContain(
      step,
    );

    const unsaid = await page.blindPageObserve(lesson, step, "text");
    await page.runPending();
    expect(await page.text("#step-refusal")).toContain(unsaid);
    expect(
      (await page.position()).banked,
      "a step whose pane says something else banked anyway",
    ).not.toContain(step);

    const afterFirst = await page.storeIds();
    await page.runPending();
    expect(
      await page.storeIds(),
      "retrying a step whose work had landed wrote it a second time",
    ).toEqual(afterFirst);
  });
});

describe("§48 — revert is re-seed and reload", () => {
  it("reverting to a boundary restores exactly that id set: the later work gone, the earlier claim alive", async () => {
    await page.reset();
    const arc = await page.arc();
    await playLesson(arc[0]!);
    const boundary = arc[0]!.id;
    const frozen = await page.checkpointIds(boundary);
    const survivor = frozen[frozen.length - 1]!;

    for (let i = 0; i < arc[1]!.steps.length; i++) await page.runPending();
    const dirty = await page.storeIds();
    const discarded = dirty.filter((id) => !frozen.includes(id));
    expect(discarded.length, "the next lesson landed nothing to discard").toBeGreaterThan(0);

    await page.click(`[data-revert="${boundary}"]`);
    expect(await page.exists(`[data-confirm-revert="${boundary}"]`)).toBe(true);
    await page.clickAndReload("[data-confirm-yes]");

    const restored = await page.storeIds();
    expect(restored).toEqual([...frozen].sort());
    for (const id of discarded) expect(restored, `${id} survived the revert`).not.toContain(id);
    expect(restored, "the pre-checkpoint claim did not survive").toContain(survivor);
    expect((await page.position()).lesson).toBe(boundary);
    expect(await page.checkpointLessons()).toContain(boundary);
  });

  it("start over clears the checkpoints too, and asks in the page rather than in a dialog", async () => {
    await page.reset();
    const arc = await page.arc();
    await playLesson(arc[0]!);
    expect((await page.checkpointLessons()).length).toBeGreaterThan(0);

    await page.click("#start-over");
    expect(await page.exists("#confirm-start-over")).toBe(true);
    await page.clickAndReload("[data-confirm-yes]");

    expect(await page.checkpointLessons()).toEqual([]);
    expect((await page.position()).lesson).toBe(arc[0]!.id);
    expect((await page.position()).banked).toEqual([]);
  });
});

describe("§48 — the progress is in the store, and nowhere else", () => {
  it("resume, falsified: every non-store key deleted, the page reopens on the same lesson, step and quiz results", async () => {
    await page.reset();
    const arc = await page.arc();
    const withQuiz = arc.find((l) => l.quiz !== null);
    expect(withQuiz, "the stub arc declares no quiz").toBeDefined();
    for (const lesson of arc) {
      if (lesson.id > withQuiz!.id) break;
      for (let i = 0; i < lesson.steps.length; i++) await page.runPending();
      if (lesson.quiz !== null) await page.answerFirstQuestion("wrong");
      if (lesson.id !== withQuiz!.id && (await page.exists("[data-next-lesson]"))) {
        await page.click("[data-next-lesson]");
      }
    }
    const before = await page.position();
    expect(before.quiz.length, "no quiz result to reconstruct").toBeGreaterThan(0);

    const deleted = await page.deleteNonStoreKeys();
    expect(
      deleted,
      "there was no non-store key to delete — the falsifier proved nothing",
    ).toBeGreaterThan(0);
    await page.reload();

    const after = await page.position();
    expect(after.lesson).toBe(before.lesson);
    expect(after.pending).toBe(before.pending);
    expect(after.banked.sort()).toEqual([...before.banked].sort());
    expect(after.quiz).toEqual(before.quiz);
  });

  it("exporting says, every time, that the file carries the student's key", async () => {
    await page.reset();
    await playLesson((await page.arc())[0]!);
    await page.click("#export");
    const said = await page.text("#step-notice");
    expect(said.toLowerCase()).toContain("key");
    expect(said).toMatch(/progress|records/i);
  });

  it("a query pinned to the Views pane is still there after a reload", async () => {
    await page.reset();
    const arc = await page.arc();
    for (const lesson of arc) {
      if ((await page.lensNames()).length > 0) break;
      await playLesson(lesson);
    }
    expect(
      (await page.lensNames()).length,
      "no lesson in this arc registers a lens",
    ).toBeGreaterThan(0);
    await page.click('.tabs button[data-pane="gql"]');
    await page.fill("#gql-pin-label", "my pin");
    await page.click("#gql-pin");
    expect(await page.text("#view-cards")).toContain("my pin");

    await page.reload();
    expect(await page.text("#view-cards")).toContain("my pin");
  });

  it("the Ground pane hides the tutorial's own records until the student asks, then badges them `tutorial`", async () => {
    await page.reset();
    const arc = await page.arc();
    await playLesson(arc[0]!);
    await page.click('.tabs button[data-pane="ground"]');

    expect(await page.attrs('#ground-rows .delta[data-kind="tutorial"]', "data-kind")).toEqual([]);
    const hiddenNote = await page.text("#ground-filter-note");

    await page.click("#ground-show-tutorial");
    const revealed = await page.attrs('#ground-rows .delta[data-kind="tutorial"]', "data-kind");
    expect(revealed.length).toBeGreaterThan(0);
    expect(hiddenNote, "the filter note does not say how many it held back").toMatch(
      new RegExp(`(^|\\D)${revealed.length} more`),
    );
    expect(await page.text('#ground-rows .delta[data-kind="tutorial"] .badge')).toContain(
      "tutorial",
    );
    expect(
      (await page.attrs('#ground-rows .delta[data-kind="fact"]', "data-kind")).length,
    ).toBeGreaterThan(0);

    await page.click("#ground-show-tutorial");
    const foreign = await page.plantForeignTutorialClaim();
    expect(
      await page.attrs(`.delta[data-delta-id="${foreign}"]`, "data-kind"),
      "a stranger's record was hidden by the tutorial filter",
    ).toEqual(["tutorial"]);

    const hybrid = await page.plantHybridTutorialClaim();
    expect(
      await page.exists(`.delta[data-delta-id="${hybrid}"]`),
      "a record that is more than the tutorial's own bookkeeping was hidden",
    ).toBe(true);
  });
});

describe("§48 — the glossary is made of the same records", () => {
  it("the reveal: 'where does this live?' highlights the term's own claim in the Ground", async () => {
    const { target } = await playUntil("reveal");
    for (let i = 0; i < target.steps.length; i++) await page.runPending();

    const terms = await page.attrs("#glossary-entries [data-term]", "data-term");
    expect(terms.length, "the glossary pane is empty at the reveal").toBeGreaterThan(0);
    const term = terms[terms.length - 1]!;
    const deltaId = (
      await page.attrs(`#glossary-entries [data-term="${term}"]`, "data-delta-id")
    )[0]!;
    expect(deltaId.length).toBeGreaterThan(0);

    await page.click(`button[data-where="${term}"]`);
    expect(await page.exists("#pane-ground.active")).toBe(true);
    expect(await page.attrs(".delta.highlight", "data-delta-id")).toEqual([deltaId]);
    expect(await page.attrs(`.delta[data-delta-id="${deltaId}"]`, "data-kind")).toEqual([
      "tutorial",
    ]);
  });

  it("the drawer reads the LIVE gateway: the SDL grows with the lens the student just registered", async () => {
    await page.reset();
    const arc = await page.arc();
    await page.click("[data-drawer-toggle]");
    const before = await page.text("#drawer-sdl");

    expect(before).not.toContain("type ");

    let grew = "";
    outer: for (const lesson of arc) {
      for (let i = 0; i < lesson.steps.length; i++) {
        await page.runPending();
        const now = await page.text("#drawer-sdl");
        if (now.includes("type ")) {
          grew = now;
          break outer;
        }
      }
      if (lesson.quiz !== null) await page.click("#quiz-skip");
      if (await page.exists("[data-next-lesson]")) await page.click("[data-next-lesson]");
    }
    expect(grew, "no step in this arc grew the store's own schema").not.toBe("");

    const lenses = (await page.tab.eval(`window.tutorial.lensNames()`)) as string[];
    expect(
      lenses.length,
      "the store holds no registration after the step that made one",
    ).toBeGreaterThan(0);
    for (const lens of lenses) expect(grew).toContain(lens);

    const listed = await page.attrs("#drawer-deltas [data-delta-id]", "data-delta-id");
    expect(
      listed.length,
      "the drawer showed no new record for a step that wrote one",
    ).toBeGreaterThan(0);
    const inGround = await page.tab.eval(
      `(() => {
         const ids = new Set(window.tutorial.ctx.gateway.offeredDeltas().map((d) => d.id));
         return ${JSON.stringify(listed)}.every((id) => ids.has(id));
       })()`,
    );
    expect(inGround, "the drawer listed a record the gateway does not hold").toBe(true);
  });
});

describe("§48 — the quiz teaches rather than scolds", () => {
  it("is offered after the lesson that declares it, names and links the teaching step, and skips without blocking", async () => {
    await page.reset();
    const arc = await page.arc();
    const withQuiz = arc.find((l) => l.quiz !== null);
    expect(withQuiz).toBeDefined();
    for (const lesson of arc) {
      if (lesson.id === withQuiz!.id) break;
      await playLesson(lesson);
    }
    expect(await page.exists("#quiz-card"), "the quiz was offered before its lesson").toBe(false);
    for (let i = 0; i < withQuiz!.steps.length; i++) await page.runPending();
    expect(await page.exists("#quiz-card")).toBe(true);

    await page.answerFirstQuestion("wrong");
    const teaches = (await page.attrs("#quiz-card [data-teaches]", "data-teaches"))[0];
    expect(teaches, "a wrong answer named no teaching step").toBeDefined();
    const stepIds = withQuiz!.steps.map((s) => s.id);
    expect(stepIds).toContain(teaches);
    const label = withQuiz!.steps.find((s) => s.id === teaches)!.label;
    expect(await page.text("#quiz-card [data-teaches]")).toContain(label);
    await page.click("#quiz-card [data-teaches]");
    expect(await page.attrs(".step.highlight", "data-step")).toEqual([teaches]);

    const right = await page.answerFirstQuestion("right");
    expect(
      await page.attrs(`[data-quiz-result="${right}"]`, "data-correct"),
      "a right answer was not recorded as right",
    ).toEqual(["true"]);
    expect(await page.text(`#quiz-card [data-question="${right}"] .verdict`)).not.toBe("");
    expect(
      await page.attrs(`#quiz-card [data-question="${right}"] [data-teaches]`, "data-teaches"),
      "a right answer was pointed at a teaching step anyway",
    ).toEqual([]);

    const quizId = withQuiz!.quiz!.id;
    while (await page.exists("#quiz-card [data-question] button[data-choice]:not([disabled])")) {
      await page.answerFirstQuestion("right");
    }
    expect(await page.text("#quiz-skip"), "an answered card still offers to skip itself").toBe(
      "done",
    );
    await page.click("#quiz-skip");
    expect(await page.exists("#quiz-card")).toBe(false);
    expect(
      await page.skippedQuizzes(),
      "a fully answered quiz was recorded as skipped",
    ).not.toContain(quizId);
    if (await page.exists("[data-next-lesson]")) await page.click("[data-next-lesson]");
    expect((await page.position()).lesson).toBeGreaterThan(withQuiz!.id);
  });
});

describe("§48 — the right to be forgotten reaches the checkpoints", () => {
  it("the erasure step is passable when there is no checkpoint at all — and the notice says so", async () => {
    const { target } = await playUntil("erasure-finale");
    expect(await page.dropCheckpointRecords()).toBeGreaterThan(0);
    await page.reload();

    for (let i = 0; i < target.steps.length; i++) await page.runPending();

    expect(await page.exists("#sweep-notice"), "the sweep said nothing at all").toBe(true);
    expect(await page.attrs("#sweep-notice [data-swept]", "data-swept")).toEqual([]);
    expect(
      await page.text("#sweep-notice"),
      "the notice appeared but never said the sweep found nothing",
    ).toMatch(/nothing to destroy/i);
    expect(await page.text("#sweep-notice h3")).toBe("the forgetting checked your checkpoints");
    const banked = (await page.position()).banked;
    for (const step of target.steps) {
      expect(banked, `step ${step.id} could not be completed after the erasure`).toContain(step.id);
    }
    expect((await page.position()).pending, "the finale is stuck on a pending step").toBeNull();
  });

  it("the notice is a READING, not a moment: it says the same thing after a reload", async () => {
    const { target } = await playUntil("erasure-finale");
    for (let i = 0; i < target.steps.length; i++) await page.runPending();
    const said = await page.text("#sweep-notice");
    const swept = await page.attrs("#sweep-notice [data-swept]", "data-swept");
    expect(swept.length, "nothing was reported gone").toBeGreaterThan(0);

    await page.reload();
    expect(await page.text("#sweep-notice"), "the notice changed its story after a reload").toBe(
      said,
    );
    expect(await page.attrs("#sweep-notice [data-swept]", "data-swept")).toEqual(swept);
  });

  it("reverting past an erasure does not un-forget it: the receipt stays, the bytes do not come back", async () => {
    const { target } = await playUntil("erasure-finale");
    const surviving = (await page.checkpointLessons())[0]!;
    for (let i = 0; i < target.steps.length; i++) await page.runPending();

    const erased = (await page.attrs("#sweep-notice", "data-erased"))[0]!
      .split(" ")
      .filter(Boolean);
    expect(erased.length).toBeGreaterThan(0);
    const receipts = await page.erasureOrderIds();
    expect(receipts.length, "the erasure left no receipt in the store").toBeGreaterThan(0);
    expect(await page.checkpointLessons(), "no checkpoint survived to revert to").toContain(
      surviving,
    );

    await page.click(`[data-revert="${surviving}"]`);
    await page.clickAndReload("[data-confirm-yes]");

    const rows = await page.storeIds();
    for (const dead of erased)
      expect(rows, `${dead} came back through a revert`).not.toContain(dead);
    for (const receipt of receipts) {
      expect(rows, "the erasure receipt was deleted by a revert").toContain(receipt);
    }
    expect(await page.erasureOrderIds()).toEqual(receipts);
    expect(await page.text("#step-notice")).toMatch(/receipt|forgetting/i);
    expect(await page.text("#step-refusal"), "a completed revert reported a refusal").toBe("");
  });

  it("the sweep is two-sided at the bytes: the condemned blobs are gone, a named bystander is whole", async () => {
    const { target } = await playUntil("erasure-finale");
    const before = await page.checkpointLessons();
    expect(before.length, "the arc reaches its erasure with no checkpoints").toBeGreaterThan(1);
    const heldBefore = new Map<number, string[]>();
    for (const lesson of before) heldBefore.set(lesson, await page.checkpointIds(lesson));
    const wordsById = await page.groundText();

    for (let i = 0; i < target.steps.length; i++) await page.runPending();

    const swept = await page.attrs("#sweep-notice [data-swept]", "data-swept");
    expect(swept.length, "the erasure destroyed no checkpoint").toBeGreaterThan(0);
    expect(await page.text("#sweep-notice h3")).toBe("the forgetting reached your checkpoints");
    expect(await page.text("#sweep-notice")).toMatch(/eras|forgot|forgotten/i);
    const kept = await page.attrs("#sweep-notice [data-kept]", "data-kept");
    expect(
      kept.length,
      "every checkpoint went — that is over-purging, not a sweep",
    ).toBeGreaterThan(0);

    const erased = (await page.attrs("#sweep-notice", "data-erased"))[0]!
      .split(" ")
      .filter(Boolean);
    expect(erased.length).toBeGreaterThan(0);

    const after = await page.checkpointLessons();
    for (const gone of swept) expect(after).not.toContain(Number(gone));
    for (const lesson of after) {
      const ids = await page.checkpointIds(lesson);
      for (const dead of erased)
        expect(ids, `checkpoint ${lesson} still holds ${dead}`).not.toContain(dead);
    }
    for (const lesson of kept.map(Number)) {
      expect(after).toContain(lesson);
      const baseline = heldBefore.get(lesson);
      if (baseline !== undefined) expect(await page.checkpointIds(lesson)).toEqual(baseline);
    }

    for (const dead of erased) {
      const words = wordsById[dead];
      expect(words, "the erased record's text was never captured").toBeTruthy();
      for (const lesson of after) {
        expect(
          await page.checkpointHolds(lesson, words!),
          `checkpoint ${lesson} still carries the erased words`,
        ).toBe(false);
      }
    }
    const keptLesson = kept.map(Number).find((l) => heldBefore.has(l))!;
    expect(keptLesson, "no checkpoint that predates the forgetting survived it").toBeDefined();
    const bystanderId = (heldBefore.get(keptLesson) ?? []).find(
      (id) => !erased.includes(id) && (wordsById[id]?.length ?? 0) > 24,
    );
    expect(
      bystanderId,
      "the kept checkpoint held nothing to check the other side with",
    ).toBeDefined();
    expect(
      await page.checkpointHolds(keptLesson, wordsById[bystanderId!]!),
      "a kept checkpoint lost the records it was keeping",
    ).toBe(true);
    const rows = await page.storeIds();
    for (const dead of erased) expect(rows).not.toContain(dead);
  });
});
