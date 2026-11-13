import {
  DerivationHost,
  type BindingSpec,
  type Claims,
  type DerivedFn,
  type Reactor,
} from "@bombadil/rhizomatic";
import type { Gateway } from "../gateway/gateway.js";
import { NUL } from "../gateway/alphabet.js";
import { negatedAt } from "../gateway/negation.js";

export const CTX_BINDING = "loam.binding";

export function bindingDefinitionClaims(
  spec: BindingSpec,
  author: string,
  timestamp: number,
): Claims {
  const emit = typeof spec.emit === "string" ? spec.emit : JSON.stringify(spec.emit);
  return {
    timestamp,
    validFrom: timestamp,
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

export interface MalformedBinding {
  readonly deltaId: string;
  readonly reason: string;
}

export interface SupersededBinding {
  readonly deltaId: string;
  readonly name: string;
}

export interface UnboundBinding {
  readonly name: string;
  readonly materialization: string;
  readonly reason: string;
}

export interface BindingDropSinks {
  readonly onMalformed?: (m: MalformedBinding) => void;
  readonly onSuperseded?: (s: SupersededBinding) => void;
}

const primitive = (claims: Claims, role: string): string | number | boolean | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};

const keyedContexts = (parsed: unknown): string[] | undefined => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const keyed = (parsed as { keyed?: unknown }).keyed;
  if (!Array.isArray(keyed) || keyed.length === 0) return undefined;
  if (!keyed.every((c) => typeof c === "string" && c.length > 0)) return undefined;
  return keyed as string[];
};

export function readBindingDefinitions(
  reactor: Reactor,
  now: number,
  operator?: string,
  sinks: BindingDropSinks = {},
): BindingSpec[] {
  const best = new Map<string, { spec: BindingSpec; timestamp: number; id: string }>();
  const negated = negatedAt(reactor, now, operator);
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
  readonly seed: string;
  readonly implementations: Record<string, DerivedFn>;

  readonly materializations?: readonly string[];
}

export interface Runner {
  readonly host: DerivationHost;
  readonly installed: string[];
  readonly skipped: string[];
  readonly unbound: UnboundBinding[];
  readonly superseded: SupersededBinding[];
  readonly malformed: MalformedBinding[];
}

export const Runner = {
  attach(gateway: Gateway, options: RunnerOptions): Runner {
    const host = new DerivationHost(gateway.reactor);
    const installed: string[] = [];
    const skipped: string[] = [];
    const unbound: UnboundBinding[] = [];
    const malformed: MalformedBinding[] = [];
    const superseded: SupersededBinding[] = [];
    const declared = options.materializations ?? [];
    const bad = declared.find((m) => m.includes(NUL));
    if (bad !== undefined) {
      throw new Error(
        `a declared materialization may not contain NUL — that alphabet is the gateway's own: ${JSON.stringify(bad)}`,
      );
    }
    const provided = [...gateway.materializationNames(), ...declared];
    for (const spec of readBindingDefinitions(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operator,
      {
        onMalformed: (m) => malformed.push(m),
        onSuperseded: (s) => superseded.push(s),
      },
    )) {
      if (!provided.includes(spec.materialization)) {
        unbound.push({
          name: spec.name,
          materialization: spec.materialization,
          reason:
            `nothing this runner can see provides a materialization named ` +
            `"${spec.materialization}", so this binding would watch a name that never changes ` +
            `and compute nothing. ` +
            (provided.length === 0
              ? "This runner can see none — register a schema on the gateway"
              : `Name one this runner can see: ${provided.join(", ")} — or register a schema`) +
            `, or, if the host registered this materialization on the reactor itself, declare it ` +
            `in RunnerOptions.materializations.`,
        });
        continue;
      }
      const fn = options.implementations[spec.fnId];
      if (fn === undefined) {
        skipped.push(spec.name);
        continue;
      }
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
