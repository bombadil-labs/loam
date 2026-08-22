// The tutorial, in a real Chrome (§48). T143 is why this file exists: every gate can be green
// while no person can use the page, and only a rail that drives the real surface can see it.
// ONE suite for the whole tutorial — four Chrome suites racing the site build is a flake this
// repo has already paid for, so every case below shares one browser and one served build.
//
// THE CASES ARE ARC-AGNOSTIC ON PURPOSE. This file freezes at its landing and T227 lands a
// whole new fifteen-lesson arc under it. So nothing here names a lesson title, a lesson number,
// or a step's prose: mechanics are found by lesson ROLE ("reveal", "erasure-finale"), by
// POSITION in whatever arc the page loaded, and by the player's `data-*` markers. A case that
// cannot be written that way is a case that would have to be rewritten with every content
// change — and a rewritten frozen rail is no rail at all.
//
// WHAT THIS FILE DOES NOT ASSERT: the store-side predicates of the whole arc walked headlessly
// (that is `test/site/arc.test.ts`, which drives the same two modules with no DOM at all).
// Both levels are covered between the two files; this one owns the page, the reload, the bytes
// in localStorage, and every claim the student can actually see.

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

/** Play one lesson the way a student would: every step, then the quiz card, then advance. */
async function playLesson(
  lesson: ArcLesson,
  opts: { quiz?: "skip" | "wrong" } = {},
): Promise<void> {
  for (let i = 0; i < lesson.steps.length; i++) await page.runPending();
  if (lesson.quiz !== null) {
    if (opts.quiz === "wrong") await page.answerFirstQuestion("wrong");
    await page.click("#quiz-skip");
  }
  if (await page.exists("[data-next-lesson]")) await page.click("[data-next-lesson]");
}

/** Play from the top of the arc up to (and not including) the lesson with this role. */
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
  it("renders exactly one pending step, banks it only when BOTH observables hold, and greens the lesson", async () => {
    await page.reset();
    const arc = await page.arc();
    expect(arc.length).toBeGreaterThanOrEqual(2);

    for (const lesson of arc) {
      expect((await page.position()).lesson, `the page is not on lesson ${lesson.id}`).toBe(
        lesson.id,
      );
      // The lesson pane states its own role — the marker every case below targets by.
      expect(await page.attrs("#lesson-pane", "data-role")).toEqual([lesson.role]);

      for (const step of lesson.steps) {
        const before = await page.position();
        expect(before.pending, "more than one step is pending at once").toBe(step.id);
        expect(await page.attrs(`[data-step="${step.id}"] [data-have]`, "data-have")).toHaveLength(
          1,
        );
        expect(await page.attrs(`[data-step="${step.id}"] [data-want]`, "data-want")).toHaveLength(
          1,
        );
        expect(await page.attrs(`[data-step="${step.id}"] [data-how]`, "data-how")).toHaveLength(1);

        await page.runPending();

        const seen = await page.observes(lesson.id, step.id);
        expect(seen.page, `step ${step.id}: the page observable is false after its run`).toBe(true);
        expect(seen.store, `step ${step.id}: the store observable is false after its run`).toBe(
          true,
        );
        const after = await page.position();
        expect(after.banked, `step ${step.id} did not bank`).toContain(step.id);
        expect(after.pending).not.toBe(step.id);
      }

      // A green lesson takes its checkpoint at the boundary, before the student moves on.
      expect(await page.checkpointLessons()).toContain(lesson.id);
      if (lesson.quiz !== null) expect(await page.exists("#quiz-card")).toBe(true);
      if (lesson.quiz !== null) await page.click("#quiz-skip");
      if (await page.exists("[data-next-lesson]")) await page.click("[data-next-lesson]");
    }
  });

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
});

describe("§48 — revert is re-seed and reload", () => {
  it("reverting to a boundary restores exactly that id set: the later work gone, the earlier claim alive", async () => {
    await page.reset();
    const arc = await page.arc();
    await playLesson(arc[0]!);
    const boundary = arc[0]!.id;
    const frozen = await page.checkpointIds(boundary);
    const survivor = frozen[frozen.length - 1]!;

    // do real work in the next lesson, then revert over it
    for (let i = 0; i < arc[1]!.steps.length; i++) await page.runPending();
    const dirty = await page.storeIds();
    const discarded = dirty.filter((id) => !frozen.includes(id));
    expect(discarded.length, "the next lesson landed nothing to discard").toBeGreaterThan(0);

    // The confirmation is IN THE PAGE — a native dialog would hang this driver forever.
    await page.click(`[data-revert="${boundary}"]`);
    expect(await page.exists(`[data-confirm-revert="${boundary}"]`)).toBe(true);
    await page.clickAndReload("[data-confirm-yes]");

    // THE WHOLE ID SET, sorted: the store is the checkpoint's again — nothing of the discarded
    // future survived, nothing from before it was lost, and the page reopened on the boundary
    // it restored without writing a thing.
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

  it("a query pinned to the Views pane is still there after a reload", async () => {
    await page.reset();
    const arc = await page.arc();
    await playLesson(arc[0]!); // a store with something to ask about
    await page.click('.tabs button[data-pane="gql"]');
    await page.fill("#gql-pin-label", "my pin");
    await page.click("#gql-pin");
    expect(await page.text("#view-cards")).toContain("my pin");

    await page.reload();
    // The pin is the page's own memory rather than the store's, and it lives OUTSIDE the delta
    // namespace on purpose — so this rail is the one that notices if it stops being read at all.
    expect(await page.text("#view-cards")).toContain("my pin");
  });

  it("the Ground pane hides the tutorial's own records until the student asks, then badges them `tutorial`", async () => {
    await page.reset();
    const arc = await page.arc();
    await playLesson(arc[0]!);
    await page.click('.tabs button[data-pane="ground"]');

    expect(await page.attrs('#ground-rows .delta[data-kind="tutorial"]', "data-kind")).toEqual([]);
    const hiddenNote = await page.text("#ground-filter-note");
    expect(hiddenNote).toMatch(/\d/); // it says how many it is holding back

    await page.click("#ground-show-tutorial");
    const revealed = await page.attrs('#ground-rows .delta[data-kind="tutorial"]', "data-kind");
    expect(revealed.length).toBeGreaterThan(0);
    expect(await page.text('#ground-rows .delta[data-kind="tutorial"] .badge')).toContain(
      "tutorial",
    );
    // the student's own facts were never hidden
    expect(
      (await page.attrs('#ground-rows .delta[data-kind="fact"]', "data-kind")).length,
    ).toBeGreaterThan(0);
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
    // the control opens the Ground, reveals the tutorial's records, and marks the one row
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

    // Before any lens is described the store answers nothing, and the drawer says so rather
    // than printing an empty schema.
    expect(before).not.toContain("type ");

    // Walk until the schema grows — the registration step, wherever this arc puts it.
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

    // The SDL is the LIVE gateway's: every lens this store now holds a registration for is in
    // it, by name. A fixture could not have known what the student just registered.
    const lenses = (await page.tab.eval(`window.tutorial.lensNames()`)) as string[];
    expect(
      lenses.length,
      "the store holds no registration after the step that made one",
    ).toBeGreaterThan(0);
    for (const lens of lenses) expect(grew).toContain(lens);

    // ...and the step's own before/after: every id the drawer lists is really in the ground.
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
    // the link names the step in the student's words, not by id alone
    const label = withQuiz!.steps.find((s) => s.id === teaches)!.label;
    expect(await page.text("#quiz-card [data-teaches]")).toContain(label);
    // and following it lands on that step, marked
    await page.click("#quiz-card [data-teaches]");
    expect(await page.attrs(".step.highlight", "data-step")).toEqual([teaches]);

    // the arc never blocks on a quiz
    await page.click("#quiz-skip");
    expect(await page.exists("#quiz-card")).toBe(false);
    if (await page.exists("[data-next-lesson]")) await page.click("[data-next-lesson]");
    expect((await page.position()).lesson).toBeGreaterThan(withQuiz!.id);
  });
});

describe("§48 — the right to be forgotten reaches the checkpoints", () => {
  it("the sweep is two-sided at the bytes: the condemned blobs are gone, a named bystander is whole", async () => {
    const { target } = await playUntil("erasure-finale");
    const before = await page.checkpointLessons();
    expect(before.length, "the arc reaches its erasure with no checkpoints").toBeGreaterThan(1);
    const heldBefore = new Map<number, string[]>();
    for (const lesson of before) heldBefore.set(lesson, await page.checkpointIds(lesson));

    for (let i = 0; i < target.steps.length; i++) await page.runPending();

    // The page names what it destroyed, and why, and what it kept.
    const swept = await page.attrs("#sweep-notice [data-swept]", "data-swept");
    expect(swept.length, "the erasure destroyed no checkpoint").toBeGreaterThan(0);
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

    // AT THE BYTES: every swept blob is gone from localStorage, and no surviving blob holds an
    // erased id — while the bystander checkpoint still holds exactly what it held before.
    const after = await page.checkpointLessons();
    for (const gone of swept) expect(after).not.toContain(Number(gone));
    for (const lesson of after) {
      const ids = await page.checkpointIds(lesson);
      for (const dead of erased)
        expect(ids, `checkpoint ${lesson} still holds ${dead}`).not.toContain(dead);
    }
    for (const lesson of kept.map(Number)) {
      expect(after).toContain(lesson);
      expect(await page.checkpointIds(lesson)).toEqual(heldBefore.get(lesson));
    }
    // and the student's store itself no longer holds the erased bytes
    const rows = await page.storeIds();
    for (const dead of erased) expect(rows).not.toContain(dead);
  });
});
