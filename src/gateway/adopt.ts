// Promotion provenance (SPEC §24.3 / §27) — the `loam.adoption` vocabulary. When the operator adopts a
// delta a quarantine produced (promote-outputs), the operator RE-SPEAKS its content as their own claim into
// the primary, PLUS a provenance pointer set recording where it came from. Kept forever — so a merged value
// always carries its origin, which is what makes fork and pull-request native (§27): you always know what a
// thing is, whose it was, and which container it crossed from. This is the §8 `translates` / §11
// anonymous-reassertion shape pointed at the quarantine: a normal claim with provenance pointers, no new
// delta kind, one reserved context. HALF of §20's re-sign-and-negate (re-sign, no negation — the pool is
// dropped wholesale, so there is nothing to negate delta-by-delta).

import type { Claims, Reactor } from "@bombadil/rhizomatic";

export const ADOPTION_ENTITY = "loam:adoption";
export const CTX_ADOPTION = "loam.adoption";

// The provenance an adoption records (SPEC §24.3): where it came from, what made it, who blessed it, when.
export interface Adoption {
  readonly adoptedDelta: string; // the operator's re-signed delta (the one now living in the primary)
  readonly from: string; // a label for the source container (the quarantine pool)
  readonly sourceDelta: string; // the source delta's id in that container (WHAT was adopted)
  readonly producedBy: string; // the granted-author it wrote under in the pool (WHAT made the output)
  readonly adoptedBy: string; // the operator (WHO blessed it)
  readonly at: number; // the promotion timestamp (WHEN)
}

// Build the ADOPTION RECORD's claims — a SEPARATE delta from the re-signed content, citing it. Keeping the
// provenance off the content delta is deliberate and idiomatic (a tombstone is separate from what it erases,
// §11): if the provenance pointers rode ON the content delta, the content's own gather would pick them up as
// part of the value and a `pick` field would resolve to a compound object instead of the value. So promotion
// lands TWO deltas — the clean re-signed content, and this record pointing at it with the loam.adoption trail.
export function adoptionRecordClaims(
  adoptedDeltaId: string,
  from: string,
  sourceDelta: string,
  producedBy: string,
  operator: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    author: operator,
    pointers: [
      {
        role: "adopts",
        target: { kind: "entity", entity: { id: ADOPTION_ENTITY, context: CTX_ADOPTION } },
      },
      { role: "adopted", target: { kind: "delta", deltaRef: { delta: adoptedDeltaId } } },
      { role: "adopted-from", target: { kind: "primitive", value: from } },
      { role: "source-delta", target: { kind: "primitive", value: sourceDelta } },
      { role: "produced-by", target: { kind: "primitive", value: producedBy } },
      { role: "adopted-by", target: { kind: "primitive", value: operator } },
      { role: "at", target: { kind: "primitive", value: timestamp } },
    ],
  };
}

// Promote-outputs adopts DOMAIN FACTS; it never adopts LAW, because operator authorship is exactly
// what gives a delta force here. A quarantined app's "output" that is shaped like law — a grant, a
// trust edge, a registration, a tombstone, a schema definition, an adoption record (the trail must
// not be forgeable through its own door) — is refused: law crosses only by §24.4's own ceremony
// (promote-law via the ordinary publish path), never blind by id. Likewise a NEGATION: re-signed by
// the operator it would strike a canonical claim, and a retraction is the operator's own deliberate
// §14 act, not an adoptable output. The reserved namespaces are the law/data boundary the spec
// already draws: `loam.*` / `rhizomatic.*` contexts and `loam:` entity ids are vocabulary, not facts.
export function promotionRefusal(claims: Claims): string | undefined {
  for (const p of claims.pointers) {
    if (p.role === "negates" && p.target.kind === "delta") {
      return "it is a negation — a retraction is the operator's own §14 act, never an adopted output";
    }
    const ctx =
      p.target.kind === "entity"
        ? p.target.entity.context
        : p.target.kind === "delta"
          ? p.target.deltaRef.context
          : undefined;
    if (ctx !== undefined && (ctx.startsWith("loam.") || ctx.startsWith("rhizomatic."))) {
      return `it declares the reserved context ${ctx} — law crosses by promote-law (§24.4), not adoption`;
    }
    if (p.target.kind === "entity" && p.target.entity.id.startsWith("loam:")) {
      return `it points at the reserved entity ${p.target.entity.id} — law crosses by promote-law (§24.4), not adoption`;
    }
  }
  return undefined;
}

// Is this delta an adoption (promote-outputs)? It declares the loam.adoption context.
export function isAdoption(claims: Claims): boolean {
  return claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === ADOPTION_ENTITY &&
      p.target.entity.context === CTX_ADOPTION,
  );
}

// The adoptions the operator has made (SPEC §24.3), read live for audit/review — the visible trail from a
// canonical value back to the quarantine that produced it (the raw material of a "review what's in here"
// interface, §27). `operator` filters the trail to one author's adoptions; absent, every adoption record
// in the ground is read (an optional filter filters — it never empties).
export function readAdoptions(reactor: Reactor, operator?: string): Adoption[] {
  const out: Adoption[] = [];
  for (const d of reactor.snapshot()) {
    if ((operator !== undefined && d.claims.author !== operator) || !isAdoption(d.claims)) continue;
    const prim = (role: string): string | undefined => {
      const p = d.claims.pointers.find((x) => x.role === role);
      return p?.target.kind === "primitive" ? String(p.target.value) : undefined;
    };
    const adoptedPtr = d.claims.pointers.find((x) => x.role === "adopted");
    const adoptedDelta =
      adoptedPtr?.target.kind === "delta" ? adoptedPtr.target.deltaRef.delta : undefined;
    const from = prim("adopted-from");
    const sourceDelta = prim("source-delta");
    const producedBy = prim("produced-by");
    const adoptedBy = prim("adopted-by");
    const at = prim("at");
    if (
      adoptedDelta === undefined ||
      from === undefined ||
      sourceDelta === undefined ||
      producedBy === undefined ||
      adoptedBy === undefined ||
      at === undefined
    ) {
      continue; // a malformed adoption records no trail
    }
    out.push({ adoptedDelta, from, sourceDelta, producedBy, adoptedBy, at: Number(at) });
  }
  return out;
}
