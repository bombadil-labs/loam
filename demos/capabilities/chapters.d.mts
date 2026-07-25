// Types for the book's content module. The page renders from it and `test/site/capabilities.test.ts`
// asserts against it — one book, two readers.

/** Where a word lives, which is the difference between a name the code uses and a name we made up. */
export type TermHome =
  | { kind: "export"; name: string }
  | { kind: "internal"; at: string }
  | { kind: "spec"; section: string }
  | { kind: "prose" };

export interface Term {
  word: string;
  gloss: string;
  where: TermHome;
}

/**
 * One promise the book makes. `proof` is a test path that fails if the promise stops being true;
 * `null` is allowed and then `gap` must say what is missing — an unproven promise has to admit it.
 */
export interface Claim {
  says: string;
  spec: string;
  proof: string | null;
  door?: string | null;
  gap?: string | null;
}

export type Block =
  | { kind: "prose"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "figure"; figure: string; caption?: string }
  | { kind: "claims"; claims: Claim[] }
  | { kind: "notYet"; items: string[] };

export interface Chapter {
  n: number;
  slug: string;
  title: string;
  thesis: string;
  /** The spec sections this chapter is accountable for. Together the chapters partition `spec/`. */
  covers: string[];
  body: Block[];
}

export const CHAPTERS: Chapter[];
export const TERMS: Term[];
export function termIndex(): Map<string, Term>;
