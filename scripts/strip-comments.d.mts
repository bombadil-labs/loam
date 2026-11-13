export interface Comment {
  readonly pos: number;
  readonly end: number;
  readonly block: boolean;
}
export interface Stripped {
  readonly text: string;
  readonly removed: readonly Comment[];
  readonly refused: readonly Comment[];
  readonly kept: number;
  readonly comments: readonly Comment[];
}
export const SCOPE: readonly string[];
export function classify(raw: string): "keep" | "refuse" | "prose";
export function findComments(text: string, file?: string): Comment[];
export function strip(text: string, file?: string): Stripped;
export function tokenStream(text: string, file?: string): string[];
export function listFiles(root: string, args: readonly string[]): string[];
