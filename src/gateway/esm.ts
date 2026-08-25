// Executable code at rest (SPEC §22.3 snapshot doctrine): a delta asserts directly-runnable ESM, and
// what you audit IS what runs — one hash, no signed-vs-executed gap. The module is loaded ONCE from a
// `data:` URL and cached by CONTENT ADDRESS, so identical source loads once across the process and a
// changed byte is a fresh key. Loading is async (a `data:` import); the caller pre-loads at bind time so
// its hot path stays synchronous.
//
// THIS LOADER IS §22 RESOLVERS ONLY, and the narrowing is the point (T172). It used to carry §23
// renderers too, which meant a renderer's MODULE BODY — top-level code in a bundle that could arrive by
// federation and be blessed — evaluated HERE, on the serving thread, with the server's whole ambient
// authority. A renderer now evaluates only inside `render-worker.ts`'s confined realm; what crosses back
// to this thread is a boolean and a content address, never a namespace. Nothing in this file executes a
// renderer any more.
//
// WHAT REMAINS, EXACTLY, AND IT IS NOT SMALL. A §22 resolver still evaluates in this process, on the
// serving thread, with no confinement of any kind: it can reach `node:fs`, open a socket, read
// `process.env`. That is deliberate and it is not reachable by the T172 mechanism — a resolver is a
// DERIVED FUNCTION the resolution program calls SYNCHRONOUSLY while resolving a view, and a function
// cannot cross a thread boundary. A renderer could be confined precisely because its protocol is
// "source in, string out"; a resolver's is "be a function". What makes the in-process floor tolerable is
// §7, not this file: a governed store binds only the OPERATOR'S law, so a federated stranger's resolver
// is inert data here and never loads. Read that as the floor's PRECONDITION, not as a bound on the
// code — if operator law ever became untrusted, this loader would be the widest hole in the system.
// Closing it needs a resolver protocol that survives a thread boundary, and there is none today.
//
// WHAT ERASURE CANNOT REACH HERE (SPEC §11). Erasing the delta that carried a unit of code does
// not unload the code: the source rides a `data:` URL into NODE'S OWN ESM registry, which retains
// it for the life of the process and offers no eviction — re-importing the same URL hands back the
// identical namespace. So clearing the Map below cannot make the bytes gone; it can only drop
// Loam's own handle to them.
//
// THAT RESIDUAL IS NOW A RESOLVER'S ALONE. A renderer's bytes never enter this registry: its module
// body is evaluated in a worker that is TERMINATED when the render or the admission ends, so the
// eviction the registry cannot offer is what the thread's death performs, and this process keeps only
// the bundle's content address — a hash of forgotten bytes is not the forgotten bytes. The disclosure
// `erase.ts` publishes still names "a resolver or renderer", which is now BROADER than the truth: it
// over-discloses, and over-disclosure is the safe direction, so it is left for the erasure surface to
// narrow rather than narrowed from here.
//
// T105 (a) named the tier honestly: `health().nonSwept` and the compliance receipt's `nonClaim`
// carry the ESM-residency disclosure unconditionally — the tier is in erasure's scope but no byte
// probe can ask it, so it reads as UNPROVEN beside the probed tiers, never as swept. The verdict
// itself still reads settled; moving it is the teardown half's decision (T105 b), since eviction
// is not available to say it with. The rail that would close the residual: erase a published
// resolver, then assert its source is no longer loadable — `loadedEsm(bundle)` undefined, and the
// erasure verdict not claiming settled while it is.
//
// What bounds the exposure, and neither bound is a fix: the Map is keyed BY the source's content
// address, so no door reads a namespace out of it without already holding the erased bytes; and the
// byte is law the operator published, not a data subject's record. Read that first bound precisely —
// it is about this Map, not about the system. A cut now re-derives the registered set, so an erased
// STORE-origin registration no longer hands its own source back through `surface()`; a MANUAL
// registration still holds it, because that code came from the running process rather than the
// ground, and no erasure has ever had standing over it. The honest remedy for erasable
// executable law is a disposable realm (§6 confinement / §24's pools) whose teardown IS the
// eviction — not a cache sweep here. §23 renderers TOOK that remedy (T172); §22 resolvers cannot,
// for the protocol reason at the top of this file.
//
// This loader is now §22 RESOLVERS ONLY. §24.6's install-by-federation lets an operator bless a
// peer's app into a pool, but since T172 a renderer never arrives here: it evaluates — module body
// and render call alike — inside `render-worker.ts`'s confined realm, and what crosses back to this
// thread is a boolean and a content address, never a namespace. So the only code this loader now
// imports is the operator's OWN resolver law in a governed store, where only the operator's law
// binds (§7). It is the plain in-process floor, and it deliberately invents no parallel sandbox:
// the object-capability confinement §6 names is built once, in `render-worker.ts`, for the code
// whose protocol can cross a thread. A §22 resolver still evaluates here with no confinement of any
// kind — tolerable only because §7 binds operator law alone; if that ever became untrusted, this
// loader would be the widest hole in the system.

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
