// The arc's order clock may run ahead of the wall clock: `ctx.ts()` is `max(now, last + 1)`, so a
// burst of writes inside one tick of a coarse clock (Windows) outruns it. The store reads validity
// at the wall clock, so a claim signed with `validFrom` in the future is not yet true when the
// next step reads it, and the step is refused. This rail plays the whole arc with an order clock
// ten seconds ahead of the wall clock, for the whole run, and asserts every step banks.
//
// Named gap: the browser suite signs at the wall clock and never runs ahead. The page signs
// through the same `lessons.mjs` / `player.mjs` helpers, so this rail covers its signing code, not
// its render. `bankCheckpoint`, `answerQuiz` and `skipQuiz` are not driven here; they share `sign()`.

import { describe, expect, it } from "vitest";
import * as loam from "../../src/browser/index.js";
import { MemStorage } from "../store/mem-storage.js";
import { bootTutorialStore, buildArc, type LessonCtx } from "../../demos/tutorial/lessons.mjs";
import { completeStep, enterLesson } from "../../demos/tutorial/player.mjs";

const AHEAD = 10_000;

async function aheadCtx(storage: MemStorage): Promise<LessonCtx> {
  const { gateway, seed, author } = await bootTutorialStore(loam, storage);
  let clock = 0;
  return {
    gateway,
    storage,
    seed,
    author,
    ts: () => (clock = Math.max(Date.now() + AHEAD, clock + 1)),
  };
}

describe("an order clock ahead of the wall clock", () => {
  it("every step of the arc still banks: validity is never later than now", async () => {
    const ctx = await aheadCtx(new MemStorage());
    for (const lesson of buildArc(loam)) {
      await enterLesson(loam, ctx, lesson);
      for (const step of lesson.steps) {
        const outcome = await completeStep(loam, ctx, lesson, step);
        expect(
          outcome.ok,
          `lesson ${lesson.id} step ${step.id}: ${outcome.ok ? "" : outcome.message}`,
        ).toBe(true);
      }
    }
  }, 120_000);
});
