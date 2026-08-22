// Types for demos/tutorial/player.mjs — the engine stays plain JS (it is bundled into the page);
// this declaration keeps the headless suite that drives it typed.

import type { Delta } from "@bombadil/rhizomatic";
import type { StorageLike } from "../../src/store/local-storage.js";
import type { Lesson, LessonCtx, LessonStep, Quiz } from "./lessons.mjs";

export declare const STORE_PREFIX: string;
export declare const SEED_KEY: string;
export declare const CKPT_PREFIX: string;

export declare const TUTORIAL_CONTEXTS: {
  readonly entered: string;
  readonly step: string;
  readonly quiz: string;
  readonly checkpoint: string;
  readonly glossary: string;
};

export declare function isTutorialDelta(delta: Delta): boolean;

export interface QuizResult {
  readonly choice: number;
  readonly correct: boolean;
}

export interface Progress {
  readonly entered: number[];
  readonly steps: Set<string>;
  readonly quiz: Map<string, QuizResult>;
  readonly skipped: Set<string>;
  readonly checkpoints: number[];
}

export interface GlossaryEntry {
  readonly term: string;
  readonly meaning: string;
  readonly lesson: number;
  readonly deltaId: string;
}

export interface ResumePoint {
  readonly lessonId: number;
  readonly stepIndex: number;
  readonly quiz: Map<string, QuizResult>;
}

export declare function readProgress(ctx: LessonCtx): Progress;
export declare function readGlossary(ctx: LessonCtx): GlossaryEntry[];
/** The furthest lesson entered, and the first step in it not yet banked. */
export declare function resumeState(arc: readonly Lesson[], progress: Progress): ResumePoint;

export declare function enterLesson(loam: unknown, ctx: LessonCtx, lesson: Lesson): Promise<void>;
export declare function plantTerm(
  loam: unknown,
  ctx: LessonCtx,
  lessonId: number,
  term: string,
  meaning: string,
): Promise<void>;

export type StepOutcome =
  | { readonly ok: true; readonly banked: string }
  | { readonly ok: false; readonly failed: "run" | "page" | "store"; readonly message: string };

export declare function completeStep(
  loam: unknown,
  ctx: LessonCtx,
  lesson: Lesson,
  step: LessonStep,
  opts?: {
    seePage?(want: LessonStep["observe"]["page"]): boolean;
    afterRun?(): Promise<void>;
  },
): Promise<StepOutcome>;

export declare function answerQuiz(
  loam: unknown,
  ctx: LessonCtx,
  quiz: Quiz,
  index: number,
  choice: number,
): Promise<{ correct: boolean; teaches: string; chose: number }>;

export declare function skipQuiz(loam: unknown, ctx: LessonCtx, quiz: Quiz): Promise<void>;

export type CheckpointOutcome =
  | { readonly ok: true; readonly lesson: number; readonly rows: number }
  | { readonly ok: false; readonly message: string };

export interface CheckpointBlob {
  readonly version: number;
  readonly lesson: number;
  readonly takenAt: number;
  readonly rows: Record<string, string>;
}

export declare function takeCheckpoint(
  storage: StorageLike,
  lesson: number,
  opts?: { label?: string },
): CheckpointOutcome;

export declare function bankCheckpoint(
  loam: unknown,
  ctx: LessonCtx,
  lesson: number,
  opts?: { label?: string },
): Promise<CheckpointOutcome>;

export declare function readCheckpoint(storage: StorageLike, lesson: number): CheckpointBlob | null;
export declare function checkpointLessons(storage: StorageLike): number[];
export declare function restoreCheckpoint(
  storage: StorageLike,
  lesson: number,
  /** The ids an erasure condemned: proof, at the moment of the write, never an inference. */
  opts?: { erasedIds?: readonly string[] },
):
  | { ok: true; restored: number; refused: string[] }
  | { ok: false; refused?: string[]; message: string };
export declare function clearCheckpoints(storage: StorageLike): void;

export interface SweepReport {
  readonly destroyed: { lesson: number; ids: string[]; reason: string }[];
  readonly kept: { lesson: number }[];
}

export declare function sweepCheckpoints(
  storage: StorageLike,
  erasedIds: readonly string[],
): SweepReport;
