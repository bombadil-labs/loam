// §47 — LAW RESOLVES LIKE DATA. The binding table (which living name serves which law) was resolved
// by one hand-rolled rule: last write wins, in ground order, per (entity, lens). That is a Policy —
// `pick byTimestamp desc` — written as a loop instead of declared as law, and nobody ever chose it.
//
// This module makes the rule a DECLARATION, mirroring `loam:trust` piece for piece: a claims
// builder, a door validator (wired into authorize, because a predicate sees pointers rather than
// shape rules), and a live reader with latest-surviving semantics. And it carries the PURE
// INTERPRETER — the spec as code. Production may keep its optimized loop; the equivalence rail
// asserts loop and interpreter agree, which is what turns the fast path from an unexamined shortcut
// into a cache with a proof (Myk, 2026-08-19).
//
// A store that declares NOTHING behaves exactly as it always has (§47 criterion 12): contested
// names stay a build-time collision, and no reader's surface changes shape by upgrading.

import type { Claims, Reactor } from "@bombadil/rhizomatic";
import { lawfulDeltasAt, lawfulNegated } from "./registration.js";

export const BINDING_POLICY_ENTITY = "loam:binding-policy";
export const CTX_BINDING_POLICY = "loam.binding-policy";

export type BindingPolicyMode = "byTimestamp" | "byAuthorRank" | "conflicts";
const MODES = new Set<string>(["byTimestamp", "byAuthorRank", "conflicts"]);

/**
 * One declaration: the mode, and optionally the CONTAINER it governs (§47 criterion 13). An
 * unqualified declaration governs the root. The qualifier exists NOW so per-container policy is a
 * later delta rather than a migration — the same path trust walked from §8 to §28.
 */
export function bindingPolicyClaims(
  mode: BindingPolicyMode,
  author: string,
  timestamp: number,
  container?: string,
): Claims {
  return {
    timestamp,
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

/** The door's shape check, same posture as `trustDefect`: refuse malformed law at append, so every
 * reader downstream reads ground the door already validated. */
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

/**
 * The mode in force for a container (undefined = the root): the LATEST surviving lawful
 * declaration whose qualifier matches. Undeclared is `undefined`, deliberately distinct from any
 * mode — an undeclared store keeps today's hand-rolled behavior whole (criterion 12), including
 * its build-time collision on contested names.
 */
export function readBindingPolicy(
  reactor: Reactor,
  operator?: string,
  container?: string,
): BindingPolicyMode | undefined {
  let latest: { at: number; id: string; mode: BindingPolicyMode } | undefined;
  // lawfulDeltasAt carries NO negation closure — its own header says every caller runs
  // lawfulNegated over what it returns, and every sibling reader (trust, public, budget, artifact,
  // envelope) does. This one omitted it and a STRUCK declaration stayed in force: withdrawn law
  // kept evicting contest losers from every door, and striking the latest declaration left the
  // corpse shadowing the earlier live one instead of reviving it. Latest-SURVIVING, as the doc
  // comment always claimed (H1 — the suppression lens's finding, reproduced red before this line).
  const negated = lawfulNegated(reactor, operator);
  for (const d of lawfulDeltasAt(
    reactor,
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

/** What the interpreter resolves over: one live binding candidate, reduced to what a policy can
 * see. The reading side's full Candidate carries more; a policy needs exactly this. */
export interface BindingCandidate {
  /** The living name this binding wants to serve. */
  readonly lens: string;
  /** The HYPERSCHEMA entity the definition lives at — identity per §21, so a policy never confuses
   * versions of one law with a contest between two. (Not the `registration:` filing entity: the
   * door mints them bijectively, and the identity a version evolves at is this one.) */
  readonly entity: string;
  readonly author: string;
  readonly timestamp: number;
  readonly deltaId: string;
}

export interface ResolvedBindings {
  /** Per lens name: the winner's deltaId, or absent when the name is deliberately not served. */
  readonly winners: ReadonlyMap<string, string>;
  /** Names withheld under `conflicts`, each with EVERY candidate named — the refusal a person can
   * act on (§47 criterion 4). */
  readonly contested: ReadonlyMap<string, readonly BindingCandidate[]>;
}

// Ground order, everywhere: (timestamp, id) — the same tie-break the registration reader uses.
const later = (a: BindingCandidate, b: BindingCandidate): BindingCandidate =>
  a.timestamp > b.timestamp || (a.timestamp === b.timestamp && a.deltaId > b.deltaId) ? a : b;

/**
 * THE SPEC AS CODE — the pure resolution of a binding set under a declared mode. The equivalence
 * rail holds production's optimized reader to this function's answers, so the two can never drift
 * silently: a divergence goes red at the moment it is introduced, not when someone notices.
 *
 * Within one ENTITY, versions supersede by ground order under every mode — a republish is
 * evolution, never a contest. A CONTEST is two entities wanting one name, and only there do the
 * modes differ: `byTimestamp` picks the later, `byAuthorRank` lets the operator's own binding
 * outrank any other author's (ground order within a rank), and `conflicts` serves neither and
 * names both.
 */
export function interpretBindingPolicy(
  candidates: readonly BindingCandidate[],
  mode: BindingPolicyMode,
  operator?: string,
): ResolvedBindings {
  // Version resolution first: latest per (entity, lens). Identity is the entity (§21).
  const perEntity = new Map<string, BindingCandidate>();
  // NUL-joined, like every sibling reader (registration.ts's NUL_SEP): a space is legal inside an
  // explicit entity, so a space join lets ("hyperschema:A B", "C") and ("hyperschema:A", "B C")
  // collapse into one version family and silently drop a law — the exact confusion this key's own
  // contract forbids (the lens-name lens's finding, one byte of defect).
  const NUL = "\u0000";
  for (const c of candidates) {
    const key = `${c.entity}${NUL}${c.lens}`;
    const held = perEntity.get(key);
    perEntity.set(key, held === undefined ? c : later(held, c));
  }
  // Then the contest: entities per lens name.
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
