import { claimsToJson, computeId, makeDelta, parseClaims, type Delta } from "@bombadil/rhizomatic";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function assertWellFormed(node: unknown, id: string): void {
  if (typeof node === "string") {
    if (LONE_SURROGATE.test(node)) {
      throw new Error(
        `delta ${id} contains a lone surrogate — its bytes and its identity disagree; refused`,
      );
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) assertWellFormed(item, id);
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      assertWellFormed(key, id);
      assertWellFormed(value, id);
    }
  }
}

export function canonicalDelta(d: Delta): Delta {
  if (computeId(d.claims) !== d.id) {
    throw new Error(`delta id ${d.id} does not match its claims — refused, never repaired`);
  }
  const json = claimsToJson(d.claims);
  assertWellFormed(json, d.id);
  const claims = parseClaims(JSON.parse(JSON.stringify(json)));
  return makeDelta(claims, d.sig);
}
