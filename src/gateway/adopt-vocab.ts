// Adoption's vocabulary and its pure readers: the manifest row, the receiver's refusing resolver
// stub, the registration-binding test, and why a schema definition is missing. A leaf: channel.ts,
// gql.ts and resolvers.ts read these without importing adopt-law.ts, whose doors publish through
// lifecycle.ts and renderers.ts.

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

// --- the manifest mint (SPEC §27.8: the row shape; T33 owns it) ---------------------------------

/**
 * One export row of a module's manifest: the consumer-facing ALIAS, and the export named by its
 * kind's most stable identifier — an ENTITY for schema law and for exported plain entities, a
 * CONTENT ADDRESS for a renderer binding or a byte-blob. `kind` is DISPLAY COPY: every guard in
 * this module classifies from the bytes at the target, never from this label.
 */
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
  // Each shape refuses ALONE (a conjunction here is satisfied by neither, and the mutation gate
  // found exactly that mutant surviving): an empty alias names nothing a consumer could ask for,
  // and NUL is the gateway's own separator.
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

/** A manifest row as read back out of a module's members. */
export interface ManifestRow {
  readonly alias: string;
  /** The entity id or the content address the row names — its identity for re-point arithmetic. */
  readonly target: string;
  readonly by: "entity" | "address";
  /** The stranger's own label. Reported, never trusted. */
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

// A manifest row declares the manifest entity, exactly as an adoption record declares its own
// (isAdoption's shape). The alias and target roles hang beside that key, role-qualified.
const isManifestRow = (claims: Claims): boolean =>
  claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === MANIFEST_ENTITY &&
      p.target.entity.context === CTX_MANIFEST,
  );

export const byAge = (a: { timestamp: number; deltaId: string }, b: typeof a): number =>
  a.timestamp - b.timestamp || (a.deltaId < b.deltaId ? -1 : a.deltaId > b.deltaId ? 1 : 0);

/**
 * The manifest a module version publishes, LATEST PER ALIAS (by (timestamp, id) — the tie-break
 * every latest-wins reader here uses). A bumped module re-states an alias to re-point it, so the
 * newest row is what the alias means now; the older one survives on the ground, which is what
 * makes the re-point a three-way DIFF rather than a guess.
 *
 * Malformed rows are LOUD, not skipped: a stranger's manifest gets no silent drops, because a
 * skip is how a crafted manifest hides a row.
 *
 * A manifest is frozen history: every row is read whatever its own validity interval. Only the
 * strikes on rows are read at `now`. This is not a present-validity view of the rows.
 */
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

// --- survival inside a version's members --------------------------------------------------------

// The negation algebra over a version's MEMBERS, scoped by AUTHORSHIP — the rule every sibling
// constitutional reader keeps (`lawfulNegated`), stated here for a
// member set rather than a store:
//
//   **A strike binds a member only when the member's OWN AUTHOR signed it.**
//
// A shipper takes back their own word; nobody takes it back for them. The membership is NOT one
// trust domain and must not be read as one: `Gateway.freeze` is `freezeMembers(withNegationClosure(
// …))`, and that closure walks `negationsOf` with no author filter precisely so foreign strikes
// travel with what they strike — so "in the members" means "somebody, anybody, struck this", and
// multi-author freeze terms are a supported shape. Unscoped, the algebra had two failures at once:
// a hostile co-tenant's strike on a shipper's law would REFUSE a lawful adoption, and a foreign
// negation-of-the-negation would REVIVE law the shipper genuinely withdrew (the second defeats the
// survival refusal outright — H1's shape at the blessing door).
//
// Recursion is unchanged: a strike retires its target only while it survives itself, so the
// shipper negating their own retraction revives their law. The scope applies at every rung — a
// foreign strike on a strike counts for nothing.
//
// A strike counts only inside its own validity window at `now`. The members' own windows are not
// asked here: this answers "was it taken back", not "does it hold".
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
    if (target === undefined) return false; // not a member: nothing in this set speaks about it
    memo.set(id, false); // in-progress: surviving (content addressing keeps the chain acyclic)
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

/**
 * THE RECEIVER'S REFUSING STUB, byte for byte — the whole source of a withheld resolver.
 *
 * It is DERIVED from the lens and the field rather than recognised by a marker, and that is the
 * guard, not a detail. A substring test over source a PEER authors is a test the peer can pass:
 * prefix your module with the marker, and every reader here calls your code withheld while
 * `publishRegistration` imports and evaluates it — the guarantee inverted, with every
 * operator-facing signal agreeing that nothing ran. Equality cannot be gamed that way: source
 * identical to this IS this, and what runs is the refusal. Nothing about a stub is read from what
 * arrived.
 */
export function withheldResolverCode(lens: string, field: string): string {
  const why =
    `"${field}" on "${lens}" is computed by RESOLVER CODE the peer wrote, and this store has ` +
    "not been told to run it. Law that arrives on a channel binds a NAME; running code is a " +
    "second decision. Bless it with `loam federate bless-app --channel <name> --resolvers " +
    `"${lens}"\`, or read the fields this lens resolves without a resolver.`;
  return `export default () => { throw new Error(${JSON.stringify(why)}); };`;
}

/** Is this EXACTLY the stub this store would write for that field — not merely something like it? */
export const isWithheldResolver = (code: string, lens: string, field: string): boolean =>
  code === withheldResolverCode(lens, field);

/**
 * Why no schema definition holds for `entity` at `now`: none ever survives, or one first survives
 * at a later time. That time can be a definition's own `validFrom` (a peer whose clock runs ahead),
 * or the moment a negation of it expires. It is not always the signed `validFrom`.
 */
export function explainMissingDefinition(dset: DeltaSet, entity: string, now: number): string {
  // The error path only. Each future validity boundary in the set is a moment the answer can
  // change, so evaluate there, in order, and report the first moment a definition survives.
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
