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
export function readBindingDefinitions(reactor: Reactor, operator?: string): BindingSpec[] {
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
        continue;
      }
    }
    const { timestamp } = delta.claims;
    const prev = best.get(name);
    if (
      prev === undefined ||
      timestamp > prev.timestamp ||
      (timestamp === prev.timestamp && delta.id > prev.id)
    ) {
      best.set(name, {
        spec: { name, fnId, materialization, pure, budget, emit },
        timestamp,
        id: delta.id,
      });
    }
  }
  return [...best.values()].map((b) => b.spec);
}

export interface RunnerOptions {
  readonly seed: string; // the runner's signing identity — every emission is authored by it
  readonly implementations: Record<string, DerivedFn>; // fnId → the code to run
}

export interface Runner {
  readonly host: DerivationHost;
  readonly installed: string[]; // binding names the runner could run
  readonly skipped: string[]; // binding names whose implementation it lacks
}

// Attach a runner to a gateway: install every stored binding whose implementation is on hand,
// and animate the gateway so its ingest drains derivations. Bindings whose fnId the runner does
// not hold are skipped (another runner may hold them) — an orphan definition simply waits.
export const Runner = {
  attach(gateway: Gateway, options: RunnerOptions): Runner {
    const host = new DerivationHost(gateway.reactor);
    const installed: string[] = [];
    const skipped: string[] = [];
    for (const spec of readBindingDefinitions(gateway.reactor, gateway.operator)) {
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
    return { host, installed, skipped };
  },
};
