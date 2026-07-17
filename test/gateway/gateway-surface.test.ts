// The Gateway public-surface rail (ticket T19) — written BEFORE the first decomposition slice and kept
// green through all of them. The invariant it pins: THE OUTSIDE CANNOT TELL THE REFACTOR HAPPENED — every
// public method the class served before the move still exists and is callable after it.
//
// Deliberately ONE-WAY (`frozen ⊆ prototype`), not an exact match: TypeScript `private` is compile-time
// only, so private methods sit on the runtime prototype too — and the decomposition MOVES private bodies
// out, which an exact-match list would flag on every slice and get "edited around", a formality instead of
// an invariant. A PRIVATE method leaving is invisible here (correct — it was never the API); a PUBLIC
// method dropped or renamed fails loudly (correct — that is the regression this rail exists to catch).
// The complementary direction — no NEW public surface appearing — is not runtime-decidable for the same
// private-is-erased reason; `test/cli/pack.test.ts` pins the package's exported surface and covers it.

import { describe, expect, it } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";

// The Gateway's public API, frozen 2026-07-16 (pre-decomposition), derived from the class declaration:
// every TypeScript-public instance method. Grown only when a ticket deliberately adds API — never edited
// to make a decomposition slice pass.
const PUBLIC_METHODS = [
  // reads & queries
  "query",
  "subscribe",
  "queryPublic",
  "subscribePublic",
  "surface",
  "resolvePinned",
  "materializationFor",
  "hasPublicSurface",
  // public door & versions
  "isPublicLatest",
  "isPublicPin",
  "registrationVersions",
  "withdrawnRegistrations",
  "declarePublic",
  // ingest doors
  "append",
  "federate",
  "admitFor",
  "offeredDeltas",
  // membership is a query (§27.6, ticket T15 — deliberate API growth, added with the ticket)
  "select",
  "watch",
  // lifecycle & binding
  "register",
  "publishRegistration",
  "loadHyperSchema",
  "animate",
  "flush",
  "close",
  // renderers & serving
  "renderers",
  "publishRenderer",
  "prepareRoute",
  "serveRoute",
  "writeRoute",
  "serveBytes",
  // erasure · quarantine · promotion
  "erase",
  "eraseReplica",
  "openQuarantine",
  "promote",
  "adoptions",
] as const;

const PUBLIC_GETTERS = ["reactor", "operator"] as const;
const PUBLIC_STATICS = ["open", "boot"] as const;

describe("T19 surface rail — the outside cannot tell the decomposition happened", () => {
  it("every frozen public method still exists on the prototype and is a function", () => {
    for (const name of PUBLIC_METHODS) {
      expect(typeof Gateway.prototype[name], `Gateway.prototype.${name}`).toBe("function");
    }
  });

  it("every frozen public getter still exists as an accessor", () => {
    for (const name of PUBLIC_GETTERS) {
      const desc = Object.getOwnPropertyDescriptor(Gateway.prototype, name);
      expect(typeof desc?.get, `Gateway.prototype getter ${name}`).toBe("function");
    }
  });

  it("every frozen static entry point still exists", () => {
    for (const name of PUBLIC_STATICS) {
      expect(typeof Gateway[name], `Gateway.${name}`).toBe("function");
    }
  });
});
