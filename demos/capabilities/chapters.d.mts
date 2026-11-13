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
  covers: string[];
  body: Block[];
}

export const CHAPTERS: Chapter[];
export const TERMS: Term[];
export function termIndex(): Map<string, Term>;
