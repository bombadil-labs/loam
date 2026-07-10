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

import type { Claims, Reactor } from "@bombadil/rhizomatic";
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
      if (
        p.role === "schema" &&
        p.target.kind === "primitive" &&
        typeof p.target.value === "string"
      ) {
        open.add(p.target.value);
      }
    }
  }
  return open;
}
