import type { Claims } from "@bombadil/rhizomatic";
import { lawfulDeltasAt } from "./lawful.js";
import { negatedAt } from "./negation.js";
import type { Ground } from "./ground.js";

export const BINDING_POLICY_ENTITY = "loam:binding-policy";
export const CTX_BINDING_POLICY = "loam.binding-policy";

export type BindingPolicyMode = "byTimestamp" | "byAuthorRank" | "conflicts";
const MODES = new Set<string>(["byTimestamp", "byAuthorRank", "conflicts"]);

export function bindingPolicyClaims(
  mode: BindingPolicyMode,
  author: string,
  timestamp: number,
  container?: string,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "declares",
        target: {
          kind: "entity",
          entity: { id: BINDING_POLICY_ENTITY, context: CTX_BINDING_POLICY },
        },
      },
      { role: "mode", target: { kind: "primitive", value: mode } },
      ...(container === undefined
        ? []
        : [{ role: "container", target: { kind: "primitive" as const, value: container } }]),
    ],
  };
}

export function bindingPolicyDefect(claims: Claims): string | undefined {
  const declares = claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === BINDING_POLICY_ENTITY &&
      p.target.entity.context === CTX_BINDING_POLICY,
  );
  if (!declares) return undefined;
  const modes = claims.pointers.filter((p) => p.role === "mode");
  if (
    modes.length !== 1 ||
    modes[0]!.target.kind !== "primitive" ||
    typeof modes[0]!.target.value !== "string" ||
    !MODES.has(modes[0]!.target.value)
  ) {
    return (
      'a binding-policy declaration carries exactly one mode: "byTimestamp", "byAuthorRank", or ' +
      '"conflicts"'
    );
  }
  const containers = claims.pointers.filter((p) => p.role === "container");
  if (
    containers.length > 1 ||
    (containers.length === 1 &&
      (containers[0]!.target.kind !== "primitive" ||
        typeof containers[0]!.target.value !== "string" ||
        containers[0]!.target.value.length === 0))
  ) {
    return "a binding-policy declaration carries at most one container, as a non-empty string";
  }
  return undefined;
}

export function readBindingPolicy(
  reactor: Ground,
  now: number,
  operator?: string,
  container?: string,
): BindingPolicyMode | undefined {
  let latest: { at: number; id: string; mode: BindingPolicyMode } | undefined;
  const negated = negatedAt(reactor, now, operator);
  for (const d of lawfulDeltasAt(
    reactor,
    now,
    { entity: BINDING_POLICY_ENTITY, context: CTX_BINDING_POLICY },
    operator,
  )) {
    if (negated(d.id)) continue;
    const of = (role: string): string | undefined => {
      const p = d.claims.pointers.find((q) => q.role === role);
      return p?.target.kind === "primitive" && typeof p.target.value === "string"
        ? p.target.value
        : undefined;
    };
    if (of("container") !== container) continue;
    const mode = of("mode");
    if (mode === undefined || !MODES.has(mode)) continue;
    if (
      latest === undefined ||
      d.claims.timestamp > latest.at ||
      (d.claims.timestamp === latest.at && d.id > latest.id)
    ) {
      latest = { at: d.claims.timestamp, id: d.id, mode: mode as BindingPolicyMode };
    }
  }
  return latest?.mode;
}

export interface BindingCandidate {
  readonly lens: string;

  readonly entity: string;
  readonly author: string;
  readonly timestamp: number;
  readonly deltaId: string;
}

export interface ResolvedBindings {
  readonly winners: ReadonlyMap<string, string>;

  readonly contested: ReadonlyMap<string, readonly BindingCandidate[]>;
}

const later = (a: BindingCandidate, b: BindingCandidate): BindingCandidate =>
  a.timestamp > b.timestamp || (a.timestamp === b.timestamp && a.deltaId > b.deltaId) ? a : b;

export function interpretBindingPolicy(
  candidates: readonly BindingCandidate[],
  mode: BindingPolicyMode,
  operator?: string,
): ResolvedBindings {
  const perEntity = new Map<string, BindingCandidate>();
  const NUL = "\u0000";
  for (const c of candidates) {
    const key = `${c.entity}${NUL}${c.lens}`;
    const held = perEntity.get(key);
    perEntity.set(key, held === undefined ? c : later(held, c));
  }
  const perLens = new Map<string, BindingCandidate[]>();
  for (const c of perEntity.values()) {
    const list = perLens.get(c.lens) ?? [];
    list.push(c);
    perLens.set(c.lens, list);
  }
  const winners = new Map<string, string>();
  const contested = new Map<string, readonly BindingCandidate[]>();
  for (const [lens, list] of perLens) {
    if (list.length === 1) {
      winners.set(lens, list[0]!.deltaId);
      continue;
    }
    if (mode === "conflicts") {
      contested.set(
        lens,
        [...list].sort((a, b) => a.timestamp - b.timestamp || (a.deltaId < b.deltaId ? -1 : 1)),
      );
      continue;
    }
    const ranked =
      mode === "byAuthorRank" && operator !== undefined
        ? (() => {
            const mine = list.filter((c) => c.author === operator);
            return mine.length > 0 ? mine : list;
          })()
        : list;
    winners.set(lens, ranked.reduce(later).deltaId);
  }
  return { winners, contested };
}
