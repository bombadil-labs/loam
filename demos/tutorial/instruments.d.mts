// Types for demos/tutorial/instruments.mjs — the module stays plain JS (bundled into the
// page); this declaration keeps the classifier's CI pin typed.

import type { Delta } from "@bombadil/rhizomatic";

export interface DeltaClass {
  readonly kind:
    | "constitution"
    | "registration"
    | "schema"
    | "fact"
    | "negation"
    | "tombstone"
    | "public"
    | "trust"
    | "grant"
    | "derived";
  readonly foreign: boolean;
  readonly note?: string;
}

export declare function classifyDelta(delta: Delta, selfAuthor?: string): DeltaClass;
export declare function isReadOnlyDocument(source: string): boolean;
export declare function summarizePointer(p: Delta["claims"]["pointers"][number]): string;
export declare function renderGround(
  holder: unknown,
  deltas: readonly Delta[],
  selfAuthor: string,
  toWire: unknown,
  state: { seen: Set<string>; expanded: Set<string> },
): void;
export declare function renderViews(holder: unknown, ctx: unknown, ui: unknown): Promise<void>;
