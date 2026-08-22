// Types for demos/tutorial/lessons.mjs — the module stays plain JS (it is bundled into the page
// and imported by the headless arc suite alike); this declaration keeps both typed.

import type { Gateway } from "../../src/gateway/gateway.js";
import type { StorageLike } from "../../src/store/local-storage.js";

export interface LessonCtx {
  gateway: Gateway;
  storage: StorageLike;
  seed: string;
  author: string;
  ts(): number;
}

/** A step's PAGE observable: a selector, and optionally the text it must show. */
export interface PageObserve {
  readonly selector: string;
  readonly contains?: string;
}

/**
 * One step: the T106 three-way framing, the work, and TWO machine-checkable observables. The
 * page predicate and the store predicate must both hold after `run` — prose is never compared
 * to the DOM it produced.
 */
export interface LessonStep {
  readonly id: string;
  readonly label: string;
  readonly have: string;
  readonly want: string;
  readonly how: string;
  run(ctx: LessonCtx): Promise<void>;
  readonly observe: {
    readonly page?: PageObserve;
    store(ctx: LessonCtx): Promise<boolean>;
  };
}

export interface QuizQuestion {
  readonly ask: string;
  readonly choices: readonly string[];
  /** The index of the right choice; checked locally, never sent anywhere. */
  readonly answer: number;
  /** The id of the step that teaches this — a wrong answer links it rather than scolding. */
  readonly teaches: string;
}

export interface Quiz {
  readonly id: string;
  readonly questions: readonly QuizQuestion[];
}

export interface GlossaryTerm {
  readonly term: string;
  readonly meaning: string;
}

export interface Lesson {
  readonly id: number;
  /** The browser suite's targeting contract: "opening", "reveal", "erasure-finale". */
  readonly role: string;
  readonly title: string;
  readonly copy: string;
  readonly terms: readonly GlossaryTerm[];
  readonly quiz?: Quiz;
  readonly steps: readonly LessonStep[];
  check(ctx: LessonCtx): Promise<boolean>;
}

/**
 * One word the arc introduces, and where. `step` marks the term a STEP plants rather than the
 * lesson's arrival; `forms` are the shapes the vocabulary scan hunts for, written out rather
 * than stemmed (this arc's subject is a "viewing", which is not an inflection of "view").
 */
export interface ArcTerm {
  readonly term: string;
  readonly lesson: number;
  readonly step?: string;
  readonly forms: readonly string[];
  readonly meaning: string;
}

/** The glossary manifest, in the order a student meets it. */
export declare const TERMS: readonly ArcTerm[];

export declare const DIARY: string;
export declare const VIEWING: string;
export declare const TENET: string;
export declare const MOVIE_NIGHT: string;
export declare const CHASE: string;
export declare const RAE: string;

export declare function bootTutorialStore(
  loam: unknown,
  storage: StorageLike,
): Promise<{ gateway: Gateway; seed: string; author: string }>;

export declare function buildArc(loam: unknown): Lesson[];

export declare function buildExport(loam: unknown, ctx: LessonCtx): string;
