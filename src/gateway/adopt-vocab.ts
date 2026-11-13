import {
  DeltaSet,
  HYPER_SCHEMA_SCHEMA,
  SCHEMA_SCHEMA,
  evalTerm,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { CTX_REGISTRATION } from "./registration.js";

export const CTX_MANIFEST = "loam.manifest";

export const MANIFEST_ENTITY = "loam:manifest";

export const NUL = "\u0000";

export interface ManifestExport {
  readonly alias: string;
  readonly targetEntity?: string;
  readonly targetAddress?: string;
  readonly kind?: string;
}

export function manifestExportClaims(
  row: ManifestExport,
  author: string,
  timestamp: number,
): Claims {
  const byEntity = row.targetEntity !== undefined;
  const byAddress = row.targetAddress !== undefined;
  if (byEntity === byAddress) {
    throw new Error(
      "a manifest row names its export by targetEntity OR targetAddress, never both and never " +
        "neither — the kind's most stable identifier is the one the consumer can verify (§27.8)",
    );
  }
  if (row.alias === "" || row.alias.includes(NUL)) {
    throw new Error("a manifest alias must be a non-empty name without NUL");
  }
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "exports",
        target: { kind: "entity", entity: { id: MANIFEST_ENTITY, context: CTX_MANIFEST } },
      },
      { role: "alias", target: { kind: "primitive", value: row.alias } },
      ...(row.targetEntity === undefined
        ? []
        : [
            {
              role: "target-entity" as const,
              target: {
                kind: "entity" as const,
                entity: { id: row.targetEntity, context: CTX_MANIFEST },
              },
            },
          ]),
      ...(row.targetAddress === undefined
        ? []
        : [
            {
              role: "target-address" as const,
              target: { kind: "primitive" as const, value: row.targetAddress },
            },
          ]),
      ...(row.kind === undefined
        ? []
        : [{ role: "kind" as const, target: { kind: "primitive" as const, value: row.kind } }]),
    ],
  };
}

export interface ManifestRow {
  readonly alias: string;
  readonly target: string;
  readonly by: "entity" | "address";
  readonly declaredKind?: string;
  readonly deltaId: string;
  readonly timestamp: number;
  readonly author: string;
}

export const primitiveOf = (
  claims: Claims,
  role: string,
): string | number | boolean | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};

export const entityOf = (claims: Claims, role: string): string | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "entity" ? p.target.entity.id : undefined;
};

const isManifestRow = (claims: Claims): boolean =>
  claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === MANIFEST_ENTITY &&
      p.target.entity.context === CTX_MANIFEST,
  );

export const byAge = (a: { timestamp: number; deltaId: string }, b: typeof a): number =>
  a.timestamp - b.timestamp || (a.deltaId < b.deltaId ? -1 : a.deltaId > b.deltaId ? 1 : 0);

export function readManifest(members: readonly Delta[], now: number): ManifestRow[] {
  const survives = survivalOver(members, now);
  const latest = new Map<string, ManifestRow>();
  for (const d of members) {
    if (!isManifestRow(d.claims) || !survives(d.id)) continue;
    const alias = primitiveOf(d.claims, "alias");
    const targetEntity = entityOf(d.claims, "target-entity");
    const address = primitiveOf(d.claims, "target-address");
    if (typeof alias !== "string" || alias === "") {
      throw new Error(`manifest row ${d.id} names no alias — a row nobody can ask for hides law`);
    }
    if ((targetEntity === undefined) === (address === undefined)) {
      throw new Error(
        `manifest row "${alias}" (${d.id}) names its export neither once nor unambiguously — ` +
          `exactly one of target-entity / target-address (§27.8)`,
      );
    }
    const declared = primitiveOf(d.claims, "kind");
    const row: ManifestRow = {
      alias,
      target: targetEntity ?? String(address),
      by: targetEntity === undefined ? "address" : "entity",
      ...(typeof declared === "string" ? { declaredKind: declared } : {}),
      deltaId: d.id,
      timestamp: d.claims.timestamp,
      author: d.claims.author,
    };
    const held = latest.get(alias);
    if (held === undefined || byAge(held, row) < 0) latest.set(alias, row);
  }
  return [...latest.values()].sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
}

export function survivalOver(members: readonly Delta[], now: number): (id: string) => boolean {
  const byId = new Map(members.map((d) => [d.id, d]));
  const strikes = new Map<string, string[]>();
  for (const d of members) {
    for (const p of d.claims.pointers) {
      if (p.role !== "negates" || p.target.kind !== "delta") continue;
      const target = p.target.deltaRef.delta;
      const list = strikes.get(target) ?? [];
      list.push(d.id);
      strikes.set(target, list);
    }
  }
  const memo = new Map<string, boolean>();
  const negated = (id: string): boolean => {
    const seen = memo.get(id);
    if (seen !== undefined) return seen;
    const target = byId.get(id);
    if (target === undefined) return false;
    memo.set(id, false);
    const verdict = (strikes.get(id) ?? []).some((n) => {
      const strike = byId.get(n);
      return (
        strike?.claims.author === target.claims.author &&
        strike.claims.validFrom <= now &&
        (strike.claims.validUntil === undefined || now < strike.claims.validUntil) &&
        !negated(n)
      );
    });
    memo.set(id, verdict);
    return verdict;
  };
  return (id) => !negated(id);
}

export const isRegistrationBinding = (claims: Claims): boolean =>
  claims.pointers.some(
    (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
  );

export function withheldResolverCode(lens: string, field: string): string {
  const why =
    `"${field}" on "${lens}" is computed by RESOLVER CODE the peer wrote, and this store has ` +
    "not been told to run it. Law that arrives on a channel binds a NAME; running code is a " +
    "second decision. Bless it with `loam federate bless-app --channel <name> --resolvers " +
    `"${lens}"\`, or read the fields this lens resolves without a resolver.`;
  return `export default () => { throw new Error(${JSON.stringify(why)}); };`;
}

export const isWithheldResolver = (code: string, lens: string, field: string): boolean =>
  code === withheldResolverCode(lens, field);

export function explainMissingDefinition(dset: DeltaSet, entity: string, now: number): string {
  const boundaries = new Set<number>();
  for (const d of dset) {
    for (const t of [d.claims.validFrom, d.claims.validUntil]) {
      if (t !== undefined && t > now) boundaries.add(t);
    }
  }
  for (const t of [...boundaries].sort((a, b) => a - b)) {
    for (const bootstrap of [HYPER_SCHEMA_SCHEMA, SCHEMA_SCHEMA]) {
      const at = evalTerm(bootstrap.body, dset, t, entity);
      if (at.sort === "hview" && (at.hview.props.get("definition") ?? []).length > 0) {
        return `a schema definition for ${entity} first survives at ${t}; this store reads at ${now}`;
      }
    }
  }
  return `no surviving schema definition for ${entity}`;
}
