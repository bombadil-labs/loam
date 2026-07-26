// Types for the book's figure data. The rail imports `FIGURES` and checks every edge names a node
// that exists, which it can only do if the shape is typed — an untyped import would make the whole
// check `any` and pass on a figure with a dangling edge.

export type NodeKind = "delta" | "entity" | "prim" | "dead" | "ghost";

export interface FigNode {
  kind: NodeKind;
  x: number;
  y: number;
  /** Overrides the radius the kind implies. */
  r?: number;
  /** A stroke token, e.g. `var(--alice)` — never a resolved colour. */
  color?: string;
  fill?: string;
  /** Dim a fact to memory: prior claims stay on the page, quieter. */
  dim?: number;
  label?: string | string[];
  /** Lines set beside the node — the first in ink, the rest in the node's own hue. */
  meta?: string[];
  metaSide?: 1 | -1;
  /** What hovering the node says. */
  tip?: string;
  /** Pin a named port to an angle in degrees, when the mean direction reads badly. */
  ports?: Record<string, number>;
}

export interface FigEdge {
  from: string;
  to: string;
  /** The pointer's role on the authoring delta. A named port is shared by every edge that binds it. */
  fromPort?: string;
  /** The property gripped on the far node. */
  toPort?: string;
  color?: string;
  dash?: string;
  dim?: number;
}

export interface Figure {
  w: number;
  h: number;
  /** Required: a figure a screen reader cannot reach is a figure half the readers do not get. */
  alt: string;
  nodes: Record<string, FigNode>;
  edges?: FigEdge[];
  /** Draw-time extras (labels, struck-through lines) — runs in the browser, after the nodes. */
  extra?: (svg: SVGElement, nodes: Record<string, FigNode>, ports: Map<string, unknown>) => void;
}

export const FIGURES: Record<string, () => Figure>;
