// Legacy on-wire shapes, forged by hand for the migration suite. A migration is about historical
// bytes: to prove it lifts an old store forward, the test must be able to MINT the old store, and the
// production code no longer speaks these shapes. So the shapes live here, frozen, owned by the tests.
//
// `legacyInlineRegistrationClaims` is exactly what `registrationClaims` emitted before §21 slice 2:
// the resolution Schema quoted INLINE in the `schema` role as canonical JSON, with no living-entity
// or snapshot references. The §21 slice-1 store (a `hyperschema:`-prefixed entity, an explicit
// `writable`) and the pre-slice-1 store (`schema:`-prefixed, no `writable`) are both this shape,
// differing only in the arguments passed.

import { schemaToJson, type Claims, type Schema } from "@bombadil/rhizomatic";
import { CTX_REGISTRATION } from "../../src/gateway/registration.js";

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
