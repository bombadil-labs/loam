// Executable code at rest (SPEC §22.3 snapshot doctrine): a delta asserts directly-runnable ESM, and
// what you audit IS what runs — one hash, no signed-vs-executed gap. This is the shared loader for both
// consumers of that doctrine: §22 resolvers (ground in, value out) and §23 renderers (view in, UI out).
// The module is loaded ONCE from a `data:` URL and cached by CONTENT ADDRESS, so identical source loads
// once across the process and a changed byte is a fresh key. Loading is async (a `data:` import); the
// callers pre-load at bind time so their hot paths stay synchronous.
//
// WHAT ERASURE CANNOT REACH HERE, stated plainly because the gap is real (SPEC §11). Erasing the
// delta that carried a unit of code does not unload the code: the source rides a `data:` URL into
// NODE'S OWN ESM registry, which retains it for the life of the process and offers no eviction —
// re-importing the same URL hands back the identical namespace. Clearing the Map below would
// therefore claim a completeness it cannot deliver, and §11's verdict is byte-presence, not
// bookkeeping: a tier that cannot be ASKED answers HELD. Two things bound the exposure and neither
// is a fix: the Map is keyed BY the source's content address, so nothing can be read out of it
// without already holding the erased bytes; and code is law the operator published, not a subject's
// record. The honest remedy for erasable executable law is a disposable realm (§6 confinement /
// §24's pools) whose teardown IS the eviction — not a cache sweep here.
//
// v1 runs the operator's OWN code in a governed store — only the operator's law binds (§7), so a
// federated stranger's code never loads here. Confinement for UNTRUSTED executable law (object-capability
// SES / Worker / wasm compartments, §6) is §24's quarantine and §23's renderer trust; this loader is the
// plain in-process floor beneath that, and deliberately invents no parallel sandbox.

import { contentAddress } from "@bombadil/rhizomatic";

// The content address of a unit of ESM — its identity, the cache key, and (via the delta it rides) part
// of its version. Two peers with the same source agree; a changed byte is a new address.
export const esmAddress = (code: string): string => contentAddress(new TextEncoder().encode(code));

const cache = new Map<string, Record<string, unknown>>();

// Import one unit of ESM to its module namespace, cached by content address. Throws on a syntax error or
// an un-importable body — the caller surfaces it loudly (at publish), never silently at serve time.
export async function importEsm(code: string): Promise<Record<string, unknown>> {
  const address = esmAddress(code);
  const hit = cache.get(address);
  if (hit !== undefined) return hit;
  const url = `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;
  const mod = (await import(url)) as Record<string, unknown>;
  cache.set(address, mod);
  return mod;
}

// The already-loaded module for a content address, or undefined — the synchronous-path lookup a caller
// uses after pre-loading (an unloaded unit falls back rather than blocking the hot path to import).
export const loadedEsm = (code: string): Record<string, unknown> | undefined =>
  cache.get(esmAddress(code));
