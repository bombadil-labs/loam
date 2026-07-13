// Row quarantine (SPEC §25). A store that has run for a year meets bytes the model did not put
// there: a devtools scribble, a row half-written when a crash cut a batch, a foreign key an old
// build left under the prefix. The refusal that governs this whole seam is one line: a single bad
// row must never brick the whole store. So a key-owning driver that meets a row it cannot admit
// does not abort the read — it SETS THE ROW ASIDE, records why, and reads on. The store boots;
// every readable fact resolves; the bad row contributes to no view, exactly as a not-yet-synced
// delta contributes to none (§13). Absence is already a legal state here; an unreadable row reads
// as a row that is not (yet) there.
//
// This is the ROW-corruption sense of "quarantine" — a holding pen for unreadable bytes — and it
// is a different mechanism from §24's federation quarantine (a sandbox where untrusted foreign
// LAW runs behind glass). Same word, two pens: §24 sequesters code it does not trust; §25
// sequesters data it cannot read. They share only the intuition that isolation beats both refusal
// and blind admission.

import type { Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";

// A delta id is a BLAKE3 multihash rendered as lowercase hex: the single-byte [0x1e, 0x20]
// prefix (multicodec + 32-byte length) followed by the 32-byte digest — 68 hex chars in all
// (rhizomatic's hash.js). This fixed shape IS the structural mark that a key under an owned
// prefix names one of THIS driver's deltas: a content address is not a name a UI writer reaches
// for, so it cannot be forged into by accident, and no out-of-band "this-is-loam" sentinel is
// needed (the §20 corollary — identity lives in the bytes — stays satisfied).
export const DELTA_ID = /^1e20[0-9a-f]{64}$/;

export function isDeltaId(s: string): boolean {
  return DELTA_ID.test(s);
}

// Why a row was set aside — the report `loam repair` reads back. Every reason names an honest,
// distinct failure so the operator can tell a devtools scribble from a torn sync at a glance.
export type QuarantineReason =
  | "unparseable" // the bytes under this key are not a delta row at all
  | "id-mismatch" // the row parses but does not recompute to the id it is filed under
  | "invalid-signature" // the row recomputes, but its signature does not verify
  | "foreign-key"; // a non-delta key living under this store's owned prefix (someone else's)

export interface QuarantinedRow {
  // The row's locator as stored — a storage key (localStorage) or a row id (sqlite): exactly
  // what `loam repair discard` needs to remove it from the origin.
  readonly key: string;
  readonly reason: QuarantineReason;
  // A short, safe, single-line preview of the raw bytes — enough to recognize the row, never
  // enough to launder bytes back into a delta.
  readonly preview: string;
}

// A short, safe preview: collapse whitespace, replace control characters, truncate. Repair shows
// it so a human can recognize the row; it is never parsed back into anything.
export function previewOf(raw: string, max = 80): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  const printable = [...oneLine].map((c) => (c >= " " && c !== "\u007f" ? c : "\ufffd")).join("");
  return printable.length > max ? `${printable.slice(0, max)}…` : printable;
}

// A backend that OWNS its own opaque bytes (the boot-path key-owning drivers — sqlite,
// localStorage) can meet a row it cannot read, so it can quarantine. The archive is deliberately
// NOT repairable: it is a content-addressed vault restored only through the mirror's `heal()`,
// whose doctrine is to refuse LOUDLY rather than replant damage as health — a different pen with
// a different rule.
export interface RepairableBackend extends StoreBackend {
  // The rows set aside during the MOST RECENT deltasSince. Recomputed on every read from the
  // origin's own bytes, never a stored countdown — `list` tomorrow shows the same pen unless the
  // origin changed. Empty until a read has walked the origin.
  quarantine(): Promise<QuarantinedRow[]>;

  // Remove a quarantined row's bytes from the origin (repair discard). Returns whether a row was
  // there to remove. MECHANICAL: a quarantined row is never a lawful fact in the ground (it
  // failed admission), so its removal is not an erasure — there was no fact to forget. Forgetting
  // a GOOD ground delta on purpose stays the operator's erase (§11), never this.
  discardRow(key: string): Promise<boolean>;
}

export function isRepairable(b: StoreBackend): b is RepairableBackend {
  return (
    typeof (b as Partial<RepairableBackend>).quarantine === "function" &&
    typeof (b as Partial<RepairableBackend>).discardRow === "function"
  );
}

// The verdict a driver reaches for one candidate row's bytes, before it decides to admit or
// quarantine. Shared by sqlite and localStorage so the two boot-path drivers cannot drift on what
// "admissible" means. `computeId`/`verifyDelta`/`parseClaims` are the rhizomatic authorities; the
// caller supplies them (the drivers already import them) plus the id the row is filed under.
export interface AdmissionDeps {
  parseClaims: (json: unknown) => Delta["claims"];
  computeId: (claims: Delta["claims"]) => string;
  makeDelta: (claims: Delta["claims"], sig?: string) => Delta;
  verifyDelta: (delta: Delta) => "verified" | "unsigned" | "invalid";
}

export type Admission =
  | { readonly ok: true; readonly delta: Delta }
  | { readonly ok: false; readonly reason: Exclude<QuarantineReason, "foreign-key"> };

// Run the same admission a healthy read runs — parse, recompute the id against the id the row is
// filed under, verify the signature — and report the FIRST failure as a quarantine reason instead
// of throwing. `filedId` is the row's stored id (the sqlite id column, or the localStorage key
// suffix); `claimedId` is any id the row's own bytes assert (localStorage carries one), which must
// also agree. A driver whose row carries no self-asserted id passes `claimedId === filedId`.
export function admit(
  filedId: string,
  claimedId: string,
  rawClaims: unknown,
  sig: string | undefined,
  deps: AdmissionDeps,
): Admission {
  let claims: Delta["claims"];
  try {
    claims = deps.parseClaims(rawClaims);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (deps.computeId(claims) !== filedId || claimedId !== filedId) {
    return { ok: false, reason: "id-mismatch" };
  }
  const delta = deps.makeDelta(claims, sig);
  if (deps.verifyDelta(delta) === "invalid") {
    return { ok: false, reason: "invalid-signature" };
  }
  return { ok: true, delta };
}
