// Promotion provenance (SPEC §24.3 / §27) — the `loam.adoption` vocabulary. When the operator adopts a
// delta a quarantine produced (promote-outputs), the operator RE-SPEAKS its content as their own claim into
// the primary, PLUS a provenance pointer set recording where it came from. Kept forever — so a merged value
// always carries its origin, which is what makes fork and pull-request native (§27): you always know what a
// thing is, whose it was, and which container it crossed from. This is the §8 `translates` / §11
// anonymous-reassertion shape pointed at the quarantine: a normal claim with provenance pointers, no new
// delta kind, one reserved context. HALF of §20's re-sign-and-negate (re-sign, no negation — the pool is
// dropped wholesale, so there is nothing to negate delta-by-delta).

import { signClaims } from "@bombadil/rhizomatic";
import type { Claims, Reactor } from "@bombadil/rhizomatic";
import type { Gateway } from "./gateway.js";
import { lawfulNegated } from "./registration.js";

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
  // A struck record is not a record: every sibling constitutional reader gates on the negation
  // algebra, and `adopt.ts` was the one that did not (H1 at the audit surface). Without this, a
  // withdrawn provenance keeps appearing in the trail, and `promoteImpl`'s presence short-circuit
  // rides that stale trail — re-promoting a value whose record was struck reports success and lands
  // nothing. Forgiveness (striking the record) must let promotion re-establish it.
  const negated = lawfulNegated(reactor, operator);
  for (const d of reactor.snapshot()) {
    if ((operator !== undefined && d.claims.author !== operator) || !isAdoption(d.claims)) continue;
    if (negated(d.id)) continue; // the operator withdrew this provenance record
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

// --- the Gateway's promotion behavior (ticket T19: the body lives beside its vocabulary) --------

// Promote a delta a quarantine produced into the primary (the body of `Gateway.promote`, SPEC §24.3 —
// promote-outputs, the first container operation of §27): the operator RE-SPEAKS the source delta's
// content as their OWN claim, carrying `loam.adoption` provenance back to the pool. The re-assertion
// INHERITS the source timestamp (§11 rung 2's translation trick), so promotion is content-addressed and
// idempotent: promoting the same output twice converges on one adopted delta, and an adopted delta the
// operator later ERASED stays dead — its tombstone refuses the very id a re-promotion would mint. The
// value crosses by re-assertion, never federation — so the pool can be dropped wholesale and the adopted
// value survives in the operator's voice. This is MERGE-load with kept provenance: where an
// interpretation in a sandbox becomes a claim in your canonical history, and always remembers where it
// came from (which is what makes fork/pull-request native).
export async function promoteImpl(
  gw: Gateway,
  source: Gateway,
  deltaId: string,
  opts: { from?: string } = {},
): Promise<{ promoted: string }> {
  if (gw.options.seed === undefined || gw.operatorAuthor === undefined) {
    throw new Error("only an operated store may promote (an adoption is the operator's own claim)");
  }
  const src = source.reactor.get(deltaId);
  if (src === undefined) {
    throw new Error(`nothing to promote: ${deltaId} is not held in the source`);
  }
  // Promote-OUTPUTS adopts domain facts only. Law-shaped deltas — grants, trust, registrations,
  // tombstones, schema definitions, adoption records, negations — are refused here; operator
  // authorship is force, and law crosses only by §24.4's own ceremony.
  const refusal = promotionRefusal(src.claims);
  if (refusal !== undefined) {
    throw new Error(`promotion refused: ${deltaId} — ${refusal}`);
  }
  // Reference closure (§24.3/§27): a promoted delta must resolve in its new home. A cited delta the
  // primary holds passes as-is; one the primary knows only THROUGH AN ADOPTION is REWRITTEN to cite its
  // adopted counterpart (promotion re-signs, so a pool id can never appear in the primary — the trail is
  // the bridge). A citation satisfying neither is refused: adopt the cited delta first, then this one.
  const trail = new Map(gw.adoptions().map((a) => [a.sourceDelta, a.adoptedDelta]));
  const pointers = src.claims.pointers.map((p) => {
    if (p.target.kind !== "delta") return p;
    const cited = p.target.deltaRef.delta;
    if (gw.reactor.get(cited) !== undefined) return p;
    const counterpart = trail.get(cited);
    if (counterpart !== undefined && gw.reactor.get(counterpart) !== undefined) {
      return {
        ...p,
        target: { ...p.target, deltaRef: { ...p.target.deltaRef, delta: counterpart } },
      };
    }
    throw new Error(
      `promotion would dangle: ${deltaId} cites ${cited}, not held here — promote ${cited} first ` +
        `and its adopted counterpart will be cited in its place`,
    );
  });
  // Land TWO deltas: the source's content RE-SPOKEN by the operator (clean, so it resolves as itself),
  // and a separate loam.adoption RECORD citing it with the provenance trail (kept off the content so it
  // never pollutes the value's own gather — §11's tombstone-is-separate discipline, applied to adoption).
  const adopted = signClaims(
    {
      timestamp: src.claims.timestamp, // inherited — content-addressed, idempotent, honest ordering
      author: gw.operatorAuthor,
      pointers,
    },
    gw.options.seed,
  );
  // Idempotence: an adoption that already stands is returned, never re-landed — one output, one
  // adopted delta, one trail record, however many times the operator says yes.
  if (trail.get(deltaId) === adopted.id && gw.reactor.get(adopted.id) !== undefined) {
    return { promoted: adopted.id };
  }
  const record = signClaims(
    adoptionRecordClaims(
      adopted.id,
      opts.from ?? "quarantine",
      deltaId,
      src.claims.author, // the granted-author it wrote under in the pool
      gw.operatorAuthor,
      gw.nextTimestamp(),
    ),
    gw.options.seed,
  );
  await gw.append([adopted, record]);
  return { promoted: adopted.id };
}
