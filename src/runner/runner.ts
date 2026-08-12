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

// A definition that reads perfectly and still cannot be honored: it names a materialization no
// registered schema provides, so the host would watch a name nothing ever changes and the binding
// would compute nothing, forever, while reporting `installed`. That is the H7 shape at the binding
// layer — a success whose visible effect has not happened and never will — so the definition is
// refused at install and named here instead, with the cure in its own sentence.
export interface UnboundBinding {
  readonly name: string; // the binding
  readonly materialization: string; // the name it asked for and did not get
  readonly reason: string;
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

// The contexts of the ONE admissible JSON emit strategy, `{keyed: ["<context>", …]}` — or
// undefined for anything else that happens to parse. Three shapes are refused here that a bare
// `JSON.parse` admits, and each fails at a different distance from the definition:
//   - `null` — `typeof null === "object"`, so rhizomatic reads `.keyed` off it and THROWS inside
//     a later ingest, wearing the face of a write failure.
//   - `{}` (and any object without `keyed`) — `keyed` is undefined, so every emission takes the
//     empty key and APPENDS. Nothing errors, ever; the store just writes a different shape than
//     its definition asked for. The silent one is the dangerous one.
//   - `{"keyed": []}` — the same silent degradation by a different road: the key of an emission
//     is built from the substantive pointers whose context is in the set, so an empty set keys
//     everything as "", which is append under a keyed spelling.
const keyedContexts = (parsed: unknown): string[] | undefined => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const keyed = (parsed as { keyed?: unknown }).keyed;
  if (!Array.isArray(keyed) || keyed.length === 0) return undefined;
  if (!keyed.every((c) => typeof c === "string" && c.length > 0)) return undefined;
  return keyed as string[];
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(emitRaw);
      } catch {
        sinks.onMalformed?.({
          deltaId: delta.id,
          reason: `emit is neither "append"/"supersede" nor JSON: ${JSON.stringify(emitRaw)}`,
        });
        continue;
      }
      // "It parsed" is not "it is a strategy". The gate used to be the parse alone, so a payload
      // that parsed to anything at all installed and then failed later, far from the definition
      // that caused it (keyedContexts names the three shapes and their distances). Refuse here,
      // and name what IS admissible — the sentence is the cure.
      const keyed = keyedContexts(parsed);
      if (keyed === undefined) {
        sinks.onMalformed?.({
          deltaId: delta.id,
          reason:
            `emit parses but is not an emit strategy: ${JSON.stringify(emitRaw)} — ` +
            `admissible are "append", "supersede", or {"keyed": ["<context>", …]} ` +
            `naming at least one context`,
        });
        continue;
      }
      emit = { keyed };
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

// The five lists account for every binding delta the reader CONSIDERED — that is, every surviving,
// operator-blessed delta filed at a `loam.binding` entity. Each such delta is either the law for
// its name (counted once, by name, in `installed`, `skipped` or `unbound`), or it is named in
// `superseded` or `malformed`. So `installed + skipped + unbound + superseded + malformed` equals
// the number of considered deltas, since exactly one delta wins each name.
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
  readonly unbound: UnboundBinding[]; // definitions naming a materialization nothing provides
  readonly superseded: SupersededBinding[]; // definitions a later one of the same name replaced
  readonly malformed: MalformedBinding[]; // binding deltas that would not read as a definition
}

// Attach a runner to a gateway: install every stored binding whose implementation is on hand AND
// whose materialization this store provides, and animate the gateway so its ingest drains
// derivations. Bindings whose fnId the runner does not hold are skipped (another runner may hold
// them) — an orphan definition simply waits.
export const Runner = {
  attach(gateway: Gateway, options: RunnerOptions): Runner {
    const host = new DerivationHost(gateway.reactor);
    const installed: string[] = [];
    const skipped: string[] = [];
    const unbound: UnboundBinding[] = [];
    const malformed: MalformedBinding[] = [];
    const superseded: SupersededBinding[] = [];
    // The names a definition may bind to, asked once. `materializationFor` falls back to the raw
    // name on a miss, which is what let an unhonorable definition install; this is the same
    // lookup, kept, so the refusal below can never disagree with the resolution above it.
    const provided = gateway.materializationNames();
    for (const spec of readBindingDefinitions(gateway.reactor, gateway.operator, {
      onMalformed: (m) => malformed.push(m),
      onSuperseded: (s) => superseded.push(s),
    })) {
      // The materialization is checked BEFORE the implementation on purpose: a missing fnId is a
      // fact about THIS runner ("another one may hold it"), while a materialization nothing
      // provides is damage in the store that no runner could honor. Report the damage.
      if (!provided.includes(spec.materialization)) {
        unbound.push({
          name: spec.name,
          materialization: spec.materialization,
          // Read by whoever attached the runner, and they already hold the gateway — so naming
          // the alternatives tells them nothing they could not read for themselves. It is a cure,
          // not an oracle.
          reason:
            `no registered schema answers to "${spec.materialization}", so this binding would ` +
            `watch a name nothing ever changes and compute nothing. ` +
            (provided.length === 0
              ? "This store has registered no schema yet — register one, then attach again."
              : `Name one this store already serves: ${provided.join(", ")}.`),
        });
        continue;
      }
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
    return { host, installed, skipped, unbound, superseded, malformed };
  },
};
