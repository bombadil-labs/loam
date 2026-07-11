// Types for site/lessons.mjs — the module stays plain JS (it is bundled into the page and
// imported by the headless arc test alike); this declaration keeps the test typed.

import type { Gateway } from "../../src/gateway/gateway.js";

export interface LessonStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LessonCtx {
  gateway: Gateway;
  storage: LessonStorage;
  seed: string;
  author: string;
  packets: { circle: unknown[]; adversary: unknown[]; dialect: unknown[] };
  ts(): number;
}

// One clickable step: a button label, the "where to look / what to notice" line shown once it
// has run, and the slice of work it performs. The lessons are a SEQUENCE of these now — a
// learner walks them one at a time so every intermediary state is actually seen.
export interface LessonStep {
  label: string;
  look: string;
  run(ctx: LessonCtx): Promise<void>;
}

export interface Lesson {
  id: number;
  title: string;
  copy: string;
  steps: LessonStep[];
  check(ctx: LessonCtx): Promise<boolean>;
}

export declare const FILM: string;
export declare const ALICE: string;
export declare const SEED_KEY: string;

export declare function bootTutorialStore(
  loam: unknown,
  storage: LessonStorage,
): Promise<{ gateway: Gateway; seed: string; author: string }>;

export declare function buildArc(loam: unknown): Lesson[];

export declare function buildExport(loam: unknown, ctx: LessonCtx): string;

export declare function recordHomecoming(
  loam: unknown,
  ctx: LessonCtx,
  matchedHex: string,
): Promise<void>;
