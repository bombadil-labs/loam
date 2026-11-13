import { describe, expect, it } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";

const PUBLIC_METHODS = [
  "query",
  "subscribe",
  "queryPublic",
  "subscribePublic",
  "surface",
  "resolvePinned",
  "materializationFor",
  "hasPublicSurface",
  "isPublicLatest",
  "isPublicPin",
  "registrationVersions",
  "withdrawnRegistrations",
  "declarePublic",
  "append",
  "federate",
  "admitFor",
  "offeredDeltas",
  "select",
  "watch",
  "register",
  "publishRegistration",
  "loadHyperSchema",
  "animate",
  "flush",
  "close",
  "renderers",
  "publishRenderer",
  "prepareRoute",
  "serveRoute",
  "writeRoute",
  "serveBytes",
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
