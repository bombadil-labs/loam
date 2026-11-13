import type { Claims, Delta, Reactor } from "@bombadil/rhizomatic";
import type { Gateway } from "./gateway.js";
import { negatedAt } from "./negation.js";
import { dataStrikeWitnesses } from "./accounts.js";
import { withStamp } from "./stamp.js";

export const ADOPTION_ENTITY = "loam:adoption";
export const CTX_ADOPTION = "loam.adoption";

export interface Adoption {
  readonly adoptedDelta: string;
  readonly from: string;
  readonly sourceDelta: string;
  readonly producedBy: string;
  readonly adoptedBy: string;
  readonly at: number;
}

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
    validFrom: timestamp,
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

export function promotionRefusal(claims: Claims): string | undefined {
  for (const p of claims.pointers) {
    if (p.role === "negates" && p.target.kind === "delta") {
      return "it is a negation — a retraction is the operator's own §14 act, never an adopted output";
    }
    if (p.role.startsWith("loam.") || p.role.startsWith("rhizomatic.")) {
      return `it speaks the reserved role ${p.role} — law crosses by adoptLaw (§24.4), not adoption`;
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

export function isAdoption(claims: Claims): boolean {
  return claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === ADOPTION_ENTITY &&
      p.target.entity.context === CTX_ADOPTION,
  );
}

export function readAdoptions(
  reactor: Reactor,
  now: number,
  operator?: string,
  opts?: { includeStruck?: boolean },
): Adoption[] {
  const out: Adoption[] = [];
  const negatedByAuthor = new Map<string, (id: string) => boolean>();
  const struck = (d: Delta): boolean => {
    if (opts?.includeStruck === true) return false;
    let f = negatedByAuthor.get(d.claims.author);
    if (f === undefined) {
      f = negatedAt(reactor, now, d.claims.author);
      negatedByAuthor.set(d.claims.author, f);
    }
    return f(d.id);
  };
  for (const d of reactor.snapshot()) {
    if ((operator !== undefined && d.claims.author !== operator) || !isAdoption(d.claims)) continue;
    if (struck(d)) continue;
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
      continue;
    }
    out.push({ adoptedDelta, from, sourceDelta, producedBy, adoptedBy, at: Number(at) });
  }
  return out;
}

export async function promoteImpl(
  gw: Gateway,
  source: Gateway,
  deltaId: string,
  opts: { from?: string } = {},
): Promise<{ promoted: string }> {
  const signer = gw.signer;
  if (signer === undefined || gw.operatorAuthor === undefined) {
    throw new Error("only an operated store may promote (an adoption is the operator's own claim)");
  }
  const src = source.reactor.get(deltaId);
  if (src === undefined) {
    throw new Error(`nothing to promote: ${deltaId} is not held in the source`);
  }
  const sourceNow = source.validityNow();
  const ownStrikes = source.reactor
    .negationWitnesses(
      sourceNow,
      (n) => n.claims.author === src.claims.author,
    )(src.id)
    .map((n) => n.id);
  if (ownStrikes.length > 0) {
    throw new Error(
      `promotion refused: ${deltaId} — its author ${src.claims.author} retracted it where it was ` +
        `made (${ownStrikes.join(", ")}), and an output taken back at the source must not re-enter ` +
        `in the operator's voice. Only its author can stand behind it again; to assert it anyway, ` +
        `publish the claim as your own act rather than adopt it.`,
    );
  }
  const reviewers =
    source.operator === undefined
      ? [undefined]
      : [source.operator, ...(source.childLaw?.hostReviews === true ? source.childLaw.hosts : [])];
  const standing = [
    ...new Set(
      reviewers.flatMap((r) =>
        dataStrikeWitnesses(source.reactor, sourceNow, r)(src.id).map((n) => n.id),
      ),
    ),
  ];
  if (standing.length > 0) {
    throw new Error(
      `promotion refused: ${deltaId} — the source's own reading has it negated (${standing.join(", ")}), ` +
        `and promotion must not re-speak what that store already retired. Negate the retraction ` +
        `there to restore it, or publish the claim as your own act.`,
    );
  }
  const refusal = promotionRefusal(src.claims);
  if (refusal !== undefined) {
    throw new Error(
      `promotion refused: ${deltaId} — ${refusal}. Law is blessed per EXPORT, through the ` +
        `manifest: adoptLaw(version, alias) (or blessAll for the whole manifest), which runs the ` +
        `root-name guard and classifies from the export's own bytes.`,
    );
  }
  const bridge = new Map(
    readAdoptions(gw.reactor, gw.validityNow(), gw.operatorAuthor, { includeStruck: true }).map(
      (a) => [a.sourceDelta, a.adoptedDelta],
    ),
  );
  const pointers = src.claims.pointers.map((p) => {
    if (p.target.kind !== "delta") return p;
    const cited = p.target.deltaRef.delta;
    if (gw.reactor.get(cited) !== undefined) return p;
    const counterpart = bridge.get(cited);
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
  const adopted = signer.sign({
    timestamp: src.claims.timestamp,
    validFrom: src.claims.validFrom,
    ...(src.claims.validUntil === undefined ? {} : { validUntil: src.claims.validUntil }),
    author: gw.operatorAuthor,
    pointers,
  });
  const live = new Map(gw.adoptions().map((a) => [a.sourceDelta, a.adoptedDelta]));
  if (live.get(deltaId) === adopted.id && gw.reactor.get(adopted.id) !== undefined) {
    const standing = dataStrikeWitnesses(
      gw.reactor,
      gw.validityNow(),
      gw.operatorAuthor,
    )(adopted.id).map((n) => n.id);
    if (standing.length > 0) {
      throw new Error(
        `promotion refused: ${deltaId} was already adopted as ${adopted.id}, and that claim is ` +
          `negated here (${standing.join(", ")}) — re-promoting would report a success no reader can ` +
          `see. Lift the retraction to stand behind it again; promotion will not undo it for you.`,
      );
    }
    return { promoted: adopted.id };
  }
  const operator = gw.operatorAuthor;
  const record = signer.sign(
    withStamp(gw.stamp(operator), (t) =>
      adoptionRecordClaims(
        adopted.id,
        opts.from ?? "quarantine",
        deltaId,
        src.claims.author,
        operator,
        t,
      ),
    ),
  );
  await gw.append([adopted, record]);
  return { promoted: adopted.id };
}
