// Legacy on-wire shapes, forged by hand for the migration suite. A migration is about historical
// bytes: to prove it lifts an old store forward, the test must be able to MINT the old store, and the
// production code no longer speaks these shapes. So the shapes live here, frozen, owned by the tests.
//
// `legacyInlineRegistrationClaims` is exactly what `registrationClaims` emitted before §21 slice 2:
// the resolution Schema quoted INLINE in the `schema` role as canonical JSON, with no living-entity
// or snapshot references. The §21 slice-1 store (a `hyperschema:`-prefixed entity, an explicit
// `writable`) and the pre-slice-1 store (`schema:`-prefixed, no `writable`) are both this shape,
// differing only in the arguments passed.

import {
  cborToJson,
  decode,
  parseTerm,
  schemaToJson,
  signClaims,
  termCanonicalHex,
  termToJson,
  type Claims,
  type Delta,
  type Schema,
} from "@bombadil/rhizomatic";
import { CTX_REGISTRATION } from "../../src/gateway/registration.js";

const HS_TERM = "rhizomatic.hyperschema.term";
const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

// Strip `reading` from every `expand` in a term's JSON — the inverse of rhizomatic 0.8's addition,
// so the tests can MINT a genuine pre-0.8 (readingless) body from a native 0.8 one.
const stripReading = (json: unknown): unknown => {
  if (Array.isArray(json)) return json.map(stripReading);
  if (json !== null && typeof json === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if ((json as Record<string, unknown>).op === "expand" && k === "reading") continue;
      out[k] = stripReading(v);
    }
    return out;
  }
  return json;
};

// Downgrade a native 0.8 store to a 0.7-era one: re-sign every hyperschema DEFINITION whose body
// carries a `reading`-bearing `expand`, with the reading stripped from the blob. Everything else
// (bindings, living Schemas, data) passes through untouched — the exact shape the 0.8 migration heals.
export function stripReadingFromExpandDefinitions(deltas: readonly Delta[], seed: string): Delta[] {
  return deltas.map((d) => {
    const termPtr = d.claims.pointers.find(
      (p) =>
        p.role === HS_TERM && p.target.kind === "primitive" && typeof p.target.value === "string",
    );
    if (termPtr?.target.kind !== "primitive" || typeof termPtr.target.value !== "string") return d;
    const bodyJson = cborToJson(decode(hexToBytes(termPtr.target.value)));
    const stripped = stripReading(bodyJson);
    if (JSON.stringify(stripped) === JSON.stringify(bodyJson)) return d; // no reading to strip
    const rehex = termCanonicalHex(parseTerm(stripped));
    const claims: Claims = {
      timestamp: d.claims.timestamp,
      author: d.claims.author,
      pointers: d.claims.pointers.map((p) =>
        p.role === HS_TERM ? { ...p, target: { kind: "primitive" as const, value: rehex } } : p,
      ),
    };
    return signClaims(claims, seed);
  });
}

// A hyperschema definition's body, decoded back to JSON — for asserting a migrated body names `reading`.
export function definitionBodyJson(delta: Delta): unknown {
  const termPtr = delta.claims.pointers.find((p) => p.role === HS_TERM);
  if (termPtr?.target.kind !== "primitive" || typeof termPtr.target.value !== "string") {
    return undefined;
  }
  return termToJson(parseTerm(cborToJson(decode(hexToBytes(termPtr.target.value)))));
}

export function legacyInlineRegistrationClaims(
  schemaEntity: string,
  schema: Schema,
  roots: readonly string[],
  author: string,
  timestamp: number,
  writable?: readonly string[],
): Claims {
  return {
    timestamp,
    author,
    pointers: [
      ...(writable === undefined
        ? []
        : [
            {
              role: "writable",
              target: { kind: "primitive" as const, value: JSON.stringify(writable) },
            },
          ]),
      {
        role: "registers",
        target: {
          kind: "entity" as const,
          entity: { id: `registration:${schemaEntity}`, context: CTX_REGISTRATION },
        },
      },
      {
        role: "hyperschema",
        target: { kind: "entity" as const, entity: { id: schemaEntity, context: "registration" } },
      },
      {
        role: "schema",
        target: { kind: "primitive" as const, value: JSON.stringify(schemaToJson(schema)) },
      },
      { role: "roots", target: { kind: "primitive" as const, value: JSON.stringify(roots) } },
    ],
  };
}
