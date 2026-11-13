export type LawContext =
  "containers" | "registrations" | "trust" | "grants" | "renderers" | "public";

export interface ChildLaw {
  readonly hosts: readonly string[];
  readonly selects: ReadonlySet<LawContext>;
  readonly hostReviews: boolean;
}

export const inboxLaw = (hosts: readonly string[]): ChildLaw => ({
  hosts,
  selects: new Set(),
  hostReviews: false,
});

export const seededLaw = (hosts: readonly string[]): ChildLaw => ({
  hosts,
  selects: new Set<LawContext>([
    "containers",
    "registrations",
    "trust",
    "grants",
    "renderers",
    "public",
  ]),
  hostReviews: true,
});

export function hostChain(ownerKey: string, ownerLaw: ChildLaw | undefined): string[] {
  return [...new Set([ownerKey, ...(ownerLaw?.hosts ?? [])])];
}

export function lawAuthors(
  own: string | undefined,
  law: ChildLaw | undefined,
  context: LawContext,
): string[] {
  const out = own === undefined ? [] : [own];
  if (law !== undefined && law.selects.has(context)) {
    for (const h of law.hosts) if (!out.includes(h)) out.push(h);
  }
  return out;
}

export function localAuthors(own: string | undefined, law: ChildLaw | undefined): string[] {
  const out = own === undefined ? [] : [own];
  for (const h of law?.hosts ?? []) if (!out.includes(h)) out.push(h);
  return out;
}
