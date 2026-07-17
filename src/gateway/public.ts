// The open door is data (SPEC §12). One operator-authored declaration at `loam:public` names
// which REGISTERED schemas this store answers WITHOUT a token — query and subscribe only;
// every write path stays gated exactly as before. Like trust (trust.ts), the policy is a
// derived view over deltas that are always updating: the open set is the UNION of `schema`
// pointers across all surviving lawful declarations, a fresh declaration only ADDS, and
// removal is negation — strike the declaration that opened it, live on the next request.
//
// Lawful reads apply: in a governed store only the operator's declarations bind (a federated
// stranger cannot open someone else's door), and an UNGOVERNED store exposes nothing publicly
// — with no operator there is no lawful voice to open a door with, and anonymous read is an
// explicit grant, never a default.

import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import type { Claims, Reactor } from "@bombadil/rhizomatic";
import type { Gateway, RequestContext } from "./gateway.js";
import { lawfulNegated, lawfulSnapshot } from "./registration.js";

export const PUBLIC_ENTITY = "loam:public";
export const CTX_PUBLIC = "loam.public";

// One declaration: the schemas opened to tokenless reads — each a repeatable `schema`
// primitive, so the open set is auditable pointer by pointer.
export function publicClaims(
  schemas: readonly string[],
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    author,
    pointers: [
      {
        role: "declares",
        target: { kind: "entity", entity: { id: PUBLIC_ENTITY, context: CTX_PUBLIC } },
      },
      ...schemas.map((s) => ({
        role: "schema",
        target: { kind: "primitive" as const, value: s },
      })),
    ],
  };
}

// Is this delta a public-read declaration, and if so, is it WELL-FORMED law? A declaration
// opens at least one schema, and every `schema` pointer is a non-empty string. The DOOR
// refuses malformed declarations at append (wired into authorize), so nothing can sit at
// `loam:public` looking like an open door while opening nothing.
export function publicDefect(claims: Claims): string | undefined {
  const declares = claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === PUBLIC_ENTITY &&
      p.target.entity.context === CTX_PUBLIC,
  );
  if (!declares) return undefined;
  const schemas = claims.pointers.filter((p) => p.role === "schema");
  if (schemas.length === 0) {
    return "a public-read declaration names at least one schema";
  }
  for (const p of schemas) {
    if (
      p.target.kind !== "primitive" ||
      typeof p.target.value !== "string" ||
      p.target.value === ""
    ) {
      return "a public-read declaration's schema entries are non-empty schema names";
    }
  }
  return undefined;
}

// The schemas currently open to tokenless reads: the union of `schema` pointers across ALL
// surviving lawful declarations. Governed stores only — an ungoverned store answers with the
// empty set, always.
export function readPublicSchemas(reactor: Reactor, operator?: string): ReadonlySet<string> {
  const open = new Set<string>();
  if (operator === undefined) return open;
  const negated = lawfulNegated(reactor, operator);
  for (const delta of lawfulSnapshot(reactor, operator)) {
    const declares = delta.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === PUBLIC_ENTITY &&
        p.target.entity.context === CTX_PUBLIC,
    );
    if (!declares || negated(delta.id)) continue;
    for (const p of delta.claims.pointers) {
      // The same shape the door enforces (publicDefect): non-empty strings only, so a
      // declaration that slipped past a door somewhere still reads exactly as the law says.
      if (
        p.role === "schema" &&
        p.target.kind === "primitive" &&
        typeof p.target.value === "string" &&
        p.target.value !== ""
      ) {
        open.add(p.target.value);
      }
    }
  }
  return open;
}

// --- the Gateway's public-declaration behavior (ticket T19: the body lives beside its vocabulary) ---

// Declare lenses public (the body of `Gateway.declarePublic`, SPEC §12/§17, amended by §23.8). Each
// entry is a BARE name (the latest version, served anonymously — unchanged) or a `Name@vN` PIN, which
// this FREEZES to the version's content address (`Name@<deltaId>`) at declare time, exactly as a
// renderer pins (§23.6): the operator named a version for convenience, and the true name that cannot
// slide when an earlier version is withdrawn is the deltaId. A declaration is publication, not a
// probe — so a pinned version becomes anonymously servable BECAUSE the operator chose to reveal it;
// every other `@hash` stays 404. Operator only, exactly like any `loam.public` write (a governed
// store binds only operator law).
export async function declarePublicImpl(
  gw: Gateway,
  entries: readonly string[],
  context?: RequestContext,
): Promise<void> {
  const seed = context?.actor ?? gw.options.seed;
  if (seed === undefined) {
    throw new Error("this gateway holds no signing seed and cannot declare a lens public");
  }
  if (gw.operatorAuthor !== undefined && authorForSeed(seed) !== gw.operatorAuthor) {
    throw new Error("append rejected: only the operator may declare a lens public");
  }
  const resolved = entries.map((entry) => freezePublicEntry(gw, entry));
  await gw.append([
    signClaims(publicClaims(resolved, authorForSeed(seed), gw.nextTimestamp()), seed),
  ]);
}

// Resolve one declaration entry to the string that goes on the record. A bare name and an already-frozen
// `Name@<deltaId>` pass through unchanged (idempotent re-declare); a `Name@vN` is resolved to the Nth
// surviving version's deltaId — the same filter-then-index publishRenderer uses — and refused if absent.
function freezePublicEntry(gw: Gateway, entry: string): string {
  const at = entry.indexOf("@");
  if (at < 0) return entry;
  const name = entry.slice(0, at);
  const ver = entry.slice(at + 1);
  const m = /^v([1-9]\d*)$/.exec(ver);
  if (m === null) return entry; // already an @<deltaId> (or opaque): freeze it as given
  const versions = gw.registrationVersions().filter((v) => v.hyperschema.name === name);
  const pinned = versions[Number(m[1]) - 1];
  if (pinned === undefined) {
    throw new Error(`public: schema "${name}" has no version v${m[1]} (it has ${versions.length})`);
  }
  return `${name}@${pinned.deltaId}`;
}
