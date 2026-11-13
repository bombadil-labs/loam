import type { Gateway } from "../../src/gateway/gateway.js";
import type { StorageLike } from "../../src/store/local-storage.js";

export interface LessonCtx {
  gateway: Gateway;
  storage: StorageLike;
  seed: string;
  author: string;
  ts(): number;
}

export interface PageObserve {
  readonly selector: string;
  readonly contains?: string;
}

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
  readonly answer: number;
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
  readonly role: string;
  readonly title: string;
  readonly copy: string;
  readonly terms: readonly GlossaryTerm[];
  readonly quiz?: Quiz;
  readonly steps: readonly LessonStep[];
  check(ctx: LessonCtx): Promise<boolean>;
}

export interface ArcTerm {
  readonly term: string;
  readonly lesson: number;
  readonly step?: string;
  readonly forms: readonly string[];
  readonly meaning: string;
}

export declare const TERMS: readonly ArcTerm[];

export declare function asStored(words: string): string;

export declare function claimedIdOf(row: string): string;

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
