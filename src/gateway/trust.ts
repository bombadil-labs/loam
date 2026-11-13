import type { Claims } from "@bombadil/rhizomatic";
import { lawfulDeltasAt } from "./lawful.js";
import { negatedAt } from "./negation.js";
import type { Ground } from "./ground.js";

export const TRUST_ENTITY = "loam:trust";
export const CTX_TRUST = "loam.trust";

export type TrustMode = "open" | "roster" | "closed";

export interface TrustPolicy {
  readonly mode: TrustMode;
  readonly roster: ReadonlySet<string>;
}

const MODES = new Set<string>(["open", "roster", "closed"]);

export function trustClaims(
  mode: TrustMode,
  authors: readonly string[],
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "declares",
        target: { kind: "entity", entity: { id: TRUST_ENTITY, context: CTX_TRUST } },
      },
      { role: "mode", target: { kind: "primitive", value: mode } },
      ...authors.map((a) => ({
        role: "admit-author",
        target: { kind: "primitive" as const, value: a },
      })),
    ],
  };
}

export function trustDefect(claims: Claims): string | undefined {
  const declares = claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === TRUST_ENTITY &&
      p.target.entity.context === CTX_TRUST,
  );
  if (!declares) return undefined;
  const modes = claims.pointers.filter((p) => p.role === "mode");
  if (
    modes.length !== 1 ||
    modes[0]!.target.kind !== "primitive" ||
    typeof modes[0]!.target.value !== "string" ||
    !MODES.has(modes[0]!.target.value)
  ) {
    return 'a trust declaration carries exactly one mode: "open", "roster", or "closed"';
  }
  for (const p of claims.pointers) {
    if (p.role !== "admit-author") continue;
    if (p.target.kind !== "primitive" || typeof p.target.value !== "string") {
      return "a trust declaration's admit-author entries are author strings";
    }
  }
  return undefined;
}

export function readTrustPolicy(reactor: Ground, now: number, operator?: string): TrustPolicy {
  return readTrustPolicyAt(reactor, now, TRUST_ENTITY, operator);
}

export function readTrustPolicyAt(
  reactor: Ground,
  now: number,
  subject: string,
  operator?: string,
): TrustPolicy {
  if (operator === undefined) return { mode: "open", roster: new Set() };
  const negated = negatedAt(reactor, now, operator);
  const roster = new Set<string>();
  let latest: { mode: TrustMode; timestamp: number; id: string } | undefined;
  for (const delta of lawfulDeltasAt(
    reactor,
    now,
    { entity: subject, context: CTX_TRUST },
    operator,
  )) {
    if (negated(delta.id)) continue;

    let mode: string | undefined;
    for (const p of delta.claims.pointers) {
      if (p.target.kind !== "primitive" || typeof p.target.value !== "string") continue;
      if (p.role === "mode" && mode === undefined && MODES.has(p.target.value)) {
        mode = p.target.value;
      }
      if (p.role === "admit-author") roster.add(p.target.value);
    }
    if (mode === undefined) continue;

    if (
      latest === undefined ||
      delta.claims.timestamp > latest.timestamp ||
      (delta.claims.timestamp === latest.timestamp && delta.id > latest.id)
    ) {
      latest = { mode: mode as TrustMode, timestamp: delta.claims.timestamp, id: delta.id };
    }
  }
  return latest === undefined ? { mode: "open", roster } : { mode: latest.mode, roster };
}

export function declaresTrust(reactor: Ground, now: number, operator: string): boolean {
  const negated = negatedAt(reactor, now, operator);
  return lawfulDeltasAt(reactor, now, { entity: TRUST_ENTITY, context: CTX_TRUST }, operator).some(
    (d) =>
      !negated(d.id) &&
      d.claims.pointers.some(
        (p) =>
          p.role === "mode" &&
          p.target.kind === "primitive" &&
          typeof p.target.value === "string" &&
          MODES.has(p.target.value),
      ),
  );
}

export function trustRosterPred(operator: string): unknown {
  return {
    or: [
      { match: { field: "author", cmp: "eq", const: operator } },
      {
        inView: {
          term: {
            op: "select",
            pred: {
              and: [
                { hasPointer: { targetEntity: TRUST_ENTITY, context: { exact: CTX_TRUST } } },
                { match: { field: "author", cmp: "eq", const: operator } },
              ],
            },
            in: {
              op: "mask",
              policy: { trust: { match: { field: "author", cmp: "eq", const: operator } } },
              in: "input",
            },
          },
          field: "author",
          extract: { role: "admit-author" },
        },
      },
    ],
  };
}
