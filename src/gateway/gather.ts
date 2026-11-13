import { parseTerm, type Term } from "@bombadil/rhizomatic";

export type GatherMask = "drop" | "annotate" | { readonly trust: unknown };

export interface GatherSpec {
  readonly mask?: GatherMask;

  readonly authoredBy?: string;
}

export function entityGatherJson(spec: GatherSpec = {}): Record<string, unknown> {
  const atRoot = { hasPointer: { targetEntity: { var: "root" } } };
  return {
    op: "group",
    key: "byTargetContext",
    in: {
      op: "select",
      pred:
        spec.authoredBy === undefined
          ? atRoot
          : { and: [atRoot, { match: { field: "author", cmp: "eq", const: spec.authoredBy } }] },
      in: { op: "mask", policy: spec.mask ?? "drop", in: "input" },
    },
  };
}

export function entityGatherBody(spec: GatherSpec = {}): Term {
  return parseTerm(entityGatherJson(spec));
}

export interface ExpandedGatherSpec extends GatherSpec {
  readonly role: string;
  readonly schema: string;
  readonly reading?: string;
}

export function expandedGatherJson(spec: ExpandedGatherSpec): Record<string, unknown> {
  return {
    op: "expand",
    role: { exact: spec.role },
    schema: spec.schema,
    ...(spec.reading === undefined ? {} : { reading: spec.reading }),
    in: entityGatherJson(spec),
  };
}

export function expandedGatherBody(spec: ExpandedGatherSpec): Term {
  return parseTerm(expandedGatherJson(spec));
}
