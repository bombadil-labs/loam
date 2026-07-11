// Types for site/lessons.mjs — the module stays plain JS (it is bundled into the page and
// imported by the headless arc test alike); this declaration keeps the test typed.

import type { Gateway } from "../src/gateway/gateway.js";

export interface LessonStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LessonCtx {
  gateway: Gateway;
  storage: LessonStorage;
  seed: string;
  author: string;
  packets: { circle: unknown[]; adversary: unknown[] };
  ts(): number;
}

export interface Lesson {
  id: number;
  title: string;
  copy: string;
  perform(ctx: LessonCtx): Promise<void>;
  check(ctx: LessonCtx): Promise<boolean>;
}

export declare const FILM: string;
export declare const ALICE: string;
export declare const SEED_KEY: string;
export declare const FILM_POLICY_V1: unknown;
export declare const FILM_POLICY_V2: unknown;
export declare const BOOK_POLICY: unknown;
export declare const PERSON_POLICY: unknown;
export declare function filmPolicyTrusted(author: string): unknown;

export declare function bootTutorialStore(
  loam: unknown,
  storage: LessonStorage,
): Promise<{ gateway: Gateway; seed: string; author: string }>;

export declare function buildArc(loam: unknown): Lesson[];

export declare function buildExport(loam: unknown, ctx: LessonCtx): string;
