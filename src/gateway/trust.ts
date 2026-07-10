// Trust is data (SPEC §8, step 13). What a store admits at federation is CONFIGURATION, and
// configuration — like everything else here — is a derived view over deltas that are always
// updating. One operator-authored declaration at `loam:trust` names the mode:
//
//   open    admit every delta that verifies (the aggregator's posture — union is the
//           substrate's nature, and the DEFAULT when no declaration survives)
//   roster  admit the operator and the named authors, nobody else
//   closed  admit nothing
//
// A roster edit is a delta; the next pull obeys it. No restart, no config file, and the full
// history of who was trusted when is a query like any other. Lawful reads apply: in a governed
// store only the operator's declarations bind (a federated stranger cannot close someone
// else's door), and the negation algebra is the shared one — a struck declaration falls, a
// struck strike revives.
//
// With rhizomatic 0.2.0, the SAME roster reaches eval-time masks: `trustRosterPred(operator)`
// builds an `inView` predicate over the very declaration deltas admission reads — one live
// source of truth for the door and the lenses.

import type { Claims, Reactor } from "@bombadil/rhizomatic";
import { lawfulNegated, lawfulSnapshot } from "./registration.js";

export const TRUST_ENTITY = "loam:trust";
export const CTX_TRUST = "loam.trust";

export type TrustMode = "open" | "roster" | "closed";

export interface TrustPolicy {
  readonly mode: TrustMode;
  readonly roster: ReadonlySet<string>;
}

const MODES = new Set<string>(["open", "roster", "closed"]);

// One declaration: the mode, and (for roster) the admitted authors — each a repeatable
// `admit-author` primitive, so the roster is auditable pointer by pointer.
export function trustClaims(
  mode: TrustMode,
  authors: readonly string[],
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
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

// The policy in force. MODE is the latest surviving lawful declaration's word (a store is
// open, rostered, or closed — one answer). The ROSTER is the UNION of `admit-author` pointers
// across ALL surviving declarations — a fresh declaration only ADDS; removal is negation
// (strike the declaration that admitted them), like everything else here. That union is
// exactly what the inView lens (`trustRosterPred`) resolves, so the door and the masks can
// never disagree about membership. A malformed declaration (unknown mode, non-string entry)
// binds nothing — the previous lawful word survives it. No declaration at all means OPEN.
export function readTrustPolicy(reactor: Reactor, operator?: string): TrustPolicy {
  const negated = lawfulNegated(reactor, operator);
  const roster = new Set<string>();
  let latest: { mode: TrustMode; timestamp: number; id: string } | undefined;
  for (const delta of lawfulSnapshot(reactor, operator)) {
    const declares = delta.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === TRUST_ENTITY &&
        p.target.entity.context === CTX_TRUST,
    );
    if (!declares || negated(delta.id)) continue;

    let mode: string | undefined;
    const named = new Set<string>();
    let malformed = false;
    for (const p of delta.claims.pointers) {
      if (p.target.kind !== "primitive") continue;
      if (p.role === "mode") {
        if (mode !== undefined || typeof p.target.value !== "string") malformed = true;
        else mode = p.target.value;
      }
      if (p.role === "admit-author") {
        if (typeof p.target.value !== "string") malformed = true;
        else named.add(p.target.value);
      }
    }
    if (malformed || mode === undefined || !MODES.has(mode)) continue;

    for (const a of named) roster.add(a);
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

// The roster as an eval-time predicate (rhizomatic 0.2.0 inView): satisfied when the
// candidate delta's author is the operator, or appears among the `admit-author` pointers of
// the operator's surviving trust declarations. The SAME deltas `readTrustPolicy` reads — so a
// mask built from this and the federation door share one live source of truth. (Depth note:
// the sub-term keeps declarations alive under the operator's own strikes only — the same
// one-link fidelity as the governed lenses in accounts.ts.)
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
