export type NodeKind = "delta" | "entity" | "prim" | "dead" | "ghost";

export interface FigNode {
  kind: NodeKind;
  x: number;
  y: number;
  r?: number;
  color?: string;
  fill?: string;
  dim?: number;
  label?: string | string[];
  meta?: string[];
  metaSide?: 1 | -1;
  tip?: string;
  ports?: Record<string, number>;
}

export interface FigEdge {
  from: string;
  to: string;
  fromPort?: string;
  toPort?: string;
  color?: string;
  dash?: string;
  dim?: number;
}

export interface Figure {
  w: number;
  h: number;
  alt: string;
  nodes: Record<string, FigNode>;
  edges?: FigEdge[];
  extra?: (svg: SVGElement, nodes: Record<string, FigNode>, ports: Map<string, unknown>) => void;
}

export const FIGURES: Record<string, () => Figure>;
