// The runner: a peer client that plays the execution role, not a tier of the core. Function
// DEFINITIONS live in the store as data (a BindingSpec filed as a delta); the runner reads them,
// installs each into a DerivationHost over the gateway's reactor with an implementation it holds
// (fnId → DerivedFn, in-process — the pure-first runtime), and routes the gateway's ingest
// through the host so bindings fire on relevant change. A store with definitions but no runner
// is PASSIVE (the definitions sit inert); a store with one attached is ANIMATE. Same store,
// same deltas — a deploy choice, not a fork.

import {
  DerivationHost,
  type BindingSpec,
  type Claims,
  type DerivedFn,
  type Reactor,
} from "@bombadil/rhizomatic";
import type { Gateway } from "../gateway/gateway.js";
import { lawfulNegated } from "../gateway/registration.js";

export const CTX_BINDING = "loam.binding";

// A binding definition, filed at a binding entity under `loam.binding`. The emit strategy
// travels as a string: "append" / "supersede", or JSON for a keyed emit. Authored by whoever
// plants it (a definition is a signed delta like any other).
export function bindingDefinitionClaims(
  spec: BindingSpec,
  author: string,
  timestamp: number,
): Claims {
  const emit = typeof spec.emit === "string" ? spec.emit : JSON.stringify(spec.emit);
  return {
    timestamp,
    author,
    pointers: [
      {
        role: "defines",
        target: { kind: "entity", entity: { id: `binding:${spec.name}`, context: CTX_BINDING } },
      },
      { role: "name", target: { kind: "primitive", value: spec.name } },
      { role: "fnId", target: { kind: "primitive", value: spec.fnId } },
      { role: "materialization", target: { kind: "primitive", value: spec.materialization } },
      { role: "pure", target: { kind: "primitive", value: spec.pure } },
      { role: "budget", target: { kind: "primitive", value: spec.budget } },
      { role: "emit", target: { kind: "primitive", value: emit } },
    ],
  };
}

// A binding delta that could not be read as a definition: which delta, and why. Dropping a
// malformed definition is deliberate (never fatal to the attach of every other binding); dropping
// it from the ACCOUNTING is not (H7) — a deploy check like "skipped is empty" would pass while a
// typo'd definition sits inert, computing nothing.
export interface MalformedBinding {
  readonly deltaId: string;
  readonly reason: string;
}

// A well-formed definition that a later definition of the same name replaced. Ordinary evolution,
// never damage — but it is a delta the reader considered and did not turn into law, so it belongs
// in the accounting. Without it the lists read as covering every binding delta and did not: a
// re-blessed binding left its older definition in no list at all.
export interface SupersededBinding {
  readonly deltaId: string;
  readonly name: string;
}

// The two ways a considered binding delta fails to become law. They are kept apart on purpose:
// `malformed` is a damage report an operator must act on, `superseded` is a healthy recipe that
// evolved. Folding one into the other would either hide damage or accuse a working binding.
export interface BindingDropSinks {
  readonly onMalformed?: (m: MalformedBinding) => void;
  readonly onSuperseded?: (s: SupersededBinding) => void;
}

const primitive = (claims: Claims, role: string): string | number | boolean | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};

// Every surviving binding definition in the store. In a governed store (an operator is named)
// only the operator's definitions are honored — otherwise a definition planted while the store
// was ungoverned, or by any writer of `loam.binding`, would make the runner a confused deputy:
// computing and signing emissions under its own authority for someone who never held it. This
// is the same discipline registrations keep; the trust boundary is "the operator blessed this
// function," and SPEC §6 reserves sandboxing of untrusted (federated) code for a later runtime.
// (Scans the whole set for a small constitutional slice — fine at this scale; indexable later.)
// `sinks` hear every binding delta this reader CONSIDERED and did not return — unparseable ones
// through `onMalformed`, replaced ones through `onSuperseded`. They keep the return type stable
// while letting a caller (Runner.attach) account for the drops. "Considered" is the exact word:
// the two filters below run FIRST and are deliberate exclusions, not drops — a lawfully struck
// delta is retired, and another author's definition was never this store's law. Neither is
// reported, and neither is counted in the accounting Runner.attach documents.
export function readBindingDefinitions(
  reactor: Reactor,
  operator?: string,
  sinks: BindingDropSinks = {},
): BindingSpec[] {
  // A recipe evolves: the LATEST surviving definition per binding name is the law (timestamp,
  // then id, for a total order) — the same latest-per-entity discipline registrations and
  // translations keep. Without it, a re-blessed binding would hand attach two definitions of
  // one name, and the host refuses duplicate installs.
  const best = new Map<string, { spec: BindingSpec; timestamp: number; id: string }>();
  // Retirement follows the same lawful negation algebra as registrations: only the operator's
  // strikes retire the operator's definitions (a write-granted author's negation — or a
  // federated stranger's — lands as data and unbinds nothing), and a struck strike revives.
  const negated = lawfulNegated(reactor, operator);
  for (const delta of reactor.snapshot()) {
    const files = delta.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_BINDING,
    );
    if (!files || negated(delta.id)) continue;
    if (operator !== undefined && delta.claims.author !== operator) continue;

    const name = primitive(delta.claims, "name");
    const fnId = primitive(delta.claims, "fnId");
    const materialization = primitive(delta.claims, "materialization");
    const pure = primitive(delta.claims, "pure");
    const budget = primitive(delta.claims, "budget");
    const emitRaw = primitive(delta.claims, "emit");
    if (
      typeof name !== "string" ||
      typeof fnId !== "string" ||
      typeof materialization !== "string" ||
      typeof pure !== "boolean" ||
      typeof budget !== "number" ||
      typeof emitRaw !== "string"
    ) {
      const bad = [
        ...(typeof name !== "string" ? ["name (a string)"] : []),
        ...(typeof fnId !== "string" ? ["fnId (a string)"] : []),
        ...(typeof materialization !== "string" ? ["materialization (a string)"] : []),
        ...(typeof pure !== "boolean" ? ["pure (a boolean)"] : []),
        ...(typeof budget !== "number" ? ["budget (a number)"] : []),
        ...(typeof emitRaw !== "string" ? ["emit (a string)"] : []),
      ];
      sinks.onMalformed?.({
        deltaId: delta.id,
        reason: `roles missing or mistyped: ${bad.join(", ")}`,
      });
      continue;
    }
    let emit: BindingSpec["emit"];
    if (emitRaw === "append" || emitRaw === "supersede") {
      emit = emitRaw;
    } else {
      // A hand-planted typo ("supercede") is a malformed definition like any other: dropped,
      // never fatal to the attach of every OTHER binding in the store.
      try {
        emit = JSON.parse(emitRaw) as { keyed: string[] };
      } catch {
        sinks.onMalformed?.({
          deltaId: delta.id,
          reason: `emit is neither "append"/"supersede" nor JSON: ${JSON.stringify(emitRaw)}`,
        });
        continue;
      }
    }
    const { timestamp } = delta.claims;
    const prev = best.get(name);
    const wins =
      prev === undefined ||
      timestamp > prev.timestamp ||
      (timestamp === prev.timestamp && delta.id > prev.id);
    // Whichever definition loses the total order is REPLACED, not dropped on the floor: it is a
    // delta the reader read and did not return, and the accounting says so.
    if (!wins) {
      sinks.onSuperseded?.({ deltaId: delta.id, name });
      continue;
    }
    if (prev !== undefined) sinks.onSuperseded?.({ deltaId: prev.id, name });
    best.set(name, {
      spec: { name, fnId, materialization, pure, budget, emit },
      timestamp,
      id: delta.id,
    });
  }
  return [...best.values()].map((b) => b.spec);
}

export interface RunnerOptions {
  readonly seed: string; // the runner's signing identity — every emission is authored by it
  readonly implementations: Record<string, DerivedFn>; // fnId → the code to run
}

// The four lists account for every binding delta the reader CONSIDERED — that is, every surviving,
// operator-blessed delta filed at a `loam.binding` entity. Each such delta is either the law for
// its name (counted once, by name, in `installed` or `skipped`), or it is named in `superseded` or
// `malformed`. So `installed + skipped + superseded + malformed` equals the number of considered
// deltas, since exactly one delta wins each name.
//
// Two deltas are deliberately NOT considered and so appear nowhere: one lawfully struck (retired),
// and one authored by anybody but the operator of a governed store (never this store's law).
//
// `installed` and `skipped` alone READ as a partition and were not: a typo'd definition sat inert
// while "skipped is empty" passed (H7), and a re-blessed binding left its older definition in no
// list at all. `malformed` is a damage report — a delta stays named until it is lawfully struck,
// so planting a corrected definition beside a broken one repairs the BINDING and leaves the broken
// delta accused; negate it to clear the report.
export interface Runner {
  readonly host: DerivationHost;
  readonly installed: string[]; // binding names the runner could run
  readonly skipped: string[]; // binding names whose implementation it lacks
  readonly superseded: SupersededBinding[]; // definitions a later one of the same name replaced
  readonly malformed: MalformedBinding[]; // binding deltas that would not read as a definition
}

// Attach a runner to a gateway: install every stored binding whose implementation is on hand,
// and animate the gateway so its ingest drains derivations. Bindings whose fnId the runner does
// not hold are skipped (another runner may hold them) — an orphan definition simply waits.
export const Runner = {
  attach(gateway: Gateway, options: RunnerOptions): Runner {
    const host = new DerivationHost(gateway.reactor);
    const installed: string[] = [];
    const skipped: string[] = [];
    const malformed: MalformedBinding[] = [];
    const superseded: SupersededBinding[] = [];
    for (const spec of readBindingDefinitions(gateway.reactor, gateway.operator, {
      onMalformed: (m) => malformed.push(m),
      onSuperseded: (s) => superseded.push(s),
    })) {
      const fn = options.implementations[spec.fnId];
      if (fn === undefined) {
        skipped.push(spec.name);
        continue;
      }
      // A spec names its materialization by the SCHEMA name (data outlives process details);
      // the gateway resolves it to the generation-qualified materialization backing it now.
      host.install(
        { ...spec, materialization: gateway.materializationFor(spec.materialization) },
        fn,
        options.seed,
      );
      installed.push(spec.name);
    }
    gateway.animate(host);
    return { host, installed, skipped, superseded, malformed };
  },
};
