// The ordinary PRIMARY read door, routed (SPEC-16 M5 trial). Each read is classified BEFORE any
// dispatch: an eligible read runs the package's batch gather then resolve over Loam's own signed
// source; every other read takes the native branch, with its reason named. Once a portable read is
// dispatched, its errors surface: there is no retry and no fallback to native.

import {
  collectRefs,
  schemaCanonicalHex,
  schemaHash,
  termCanonicalHex,
  termHash,
  type Delta,
  type HyperSchema,
  type Schema,
  type Term,
  type View,
} from "@bombadil/rhizomatic";
import type { ConnectionBinding, Gateway } from "./gateway.js";
import type { ResolvedNode } from "./gql.js";
import { needsLowering } from "./governed-trust.js";
import {
  portableBoot,
  preflightPortableRead,
  preparePortableRead,
  runPortableRead,
  type PortableBoot,
  type PreparedPortableRead,
  type PortableProgram,
} from "./portable-read.js";
import { channelLens, finishNodeImpl, primaryGroundImpl, resolvedNodeImpl } from "./reads.js";
import { lensOf } from "./registration.js";
import type { Signer } from "./signer.js";

/** Why a read stays native. Each is decided before dispatch, from state this read is frozen at. */
export type NativeReason =
  | "bound-connection"
  | "channel"
  | "no-signer"
  | "governed-lowering"
  | "reading-predicate"
  | "unpublished-law"
  | "input-capacity";

export type PortableRoute =
  | { readonly route: "portable"; readonly prepared: PreparedPortableRead; readonly signer: Signer }
  | { readonly route: "native"; readonly reason: NativeReason };

const HYPER_TERM = "rhizomatic.hyperschema.term",
  HYPER_NAME = "rhizomatic.hyperschema.name",
  SCHEMA_TERM = "rhizomatic.schema.term",
  SCHEMA_NAME = "rhizomatic.schema.name";

const textAt = (d: Delta, role: string): string | undefined => {
  const t = d.claims.pointers.find((x) => x.role === role)?.target;
  return t?.kind === "primitive" && typeof t.value === "string" ? t.value : undefined;
};

/** A definition act stands at `now` when it is in its own window and no standing strike binds it. */
function standing(gw: Gateway, d: Delta, now: number): boolean {
  const inWindow = (x: Delta) =>
    x.claims.validFrom <= now && (x.claims.validUntil === undefined || now < x.claims.validUntil);
  return (
    inWindow(d) &&
    !gw.reactor.negationsOf(d.id).some((n) => {
      const strike = gw.reactor.get(n);
      return strike !== undefined && inWindow(strike);
    })
  );
}

/** The exact original act for one definition body, chosen by act identity among standing copies. */
function actFor(
  law: readonly Delta[],
  gw: Gateway,
  now: number,
  termRole: string,
  nameRole: string,
  name: string,
  bodyHex: string,
): Delta | undefined {
  return law
    .filter(
      (d) =>
        textAt(d, termRole) === bodyHex && textAt(d, nameRole) === name && standing(gw, d, now),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
}

const namedReading = (schema: Schema, name: string): Schema => ({
  ...schema,
  name,
  alg: schema.alg ?? 1,
});

/** Every reading named by an `expand`, anywhere in a body. */
function expandReadings(term: Term): string[] {
  const names: string[] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x !== null && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const reading = o["reading"] as { kind?: string; name?: string } | undefined;
      if (o["kind"] === "expand" && reading?.kind === "name" && typeof reading.name === "string")
        names.push(reading.name);
      Object.values(o).forEach(walk);
    }
  };
  walk(term);
  return names;
}

const usesPredicateOrder = (schema: Schema): boolean => JSON.stringify(schema).includes("byPred");

type Selection =
  | { readonly status: "selected"; readonly program: PortableProgram }
  | { readonly status: "unpublished" }
  | { readonly status: "reading-predicate" };

/**
 * The selected program's original signed acts under current law. A registration with no published
 * top acts is a native-only bystander. A published one whose closure has a missing act is an error:
 * its promised law is gone, and the receiver never re-signs it.
 */
function selectProgram(gw: Gateway, name: string, now: number, law: readonly Delta[]): Selection {
  const def = gw.def(name);
  const top = def.hyperschema;
  const topReading = namedReading(def.schema, lensOf(def));
  const hyperAct = actFor(
    law,
    gw,
    now,
    HYPER_TERM,
    HYPER_NAME,
    top.name,
    termCanonicalHex(top.body),
  );
  const schemaAct = actFor(
    law,
    gw,
    now,
    SCHEMA_TERM,
    SCHEMA_NAME,
    lensOf(def),
    schemaCanonicalHex(topReading),
  );
  if (hyperAct === undefined || schemaAct === undefined) return { status: "unpublished" };
  if (usesPredicateOrder(topReading)) return { status: "reading-predicate" };
  const extra = new Map<string, Delta>();
  const missing: string[] = [];
  const seenBodies = new Set<string>();
  const visit = (body: Term): void => {
    for (const ref of collectRefs(body)) {
      const hs: HyperSchema | undefined = gw.registry.resolve(ref);
      if (hs === undefined) {
        missing.push(`hyperschema ${ref.kind === "name" ? ref.name : ref.hash}`);
        continue;
      }
      const key = `${hs.name}:${termCanonicalHex(hs.body)}`;
      if (seenBodies.has(key)) continue;
      seenBodies.add(key);
      const act = actFor(law, gw, now, HYPER_TERM, HYPER_NAME, hs.name, termCanonicalHex(hs.body));
      if (act === undefined) missing.push(`hyperschema ${hs.name}`);
      else if (act.id !== hyperAct.id) extra.set(act.id, act);
      visit(hs.body);
    }
    for (const readingName of expandReadings(body)) {
      const reading = gw.registered.find((r) => lensOf(r) === readingName);
      if (reading === undefined) {
        missing.push(`reading ${readingName}`);
        continue;
      }
      const named = namedReading(reading.schema, readingName);
      if (usesPredicateOrder(named)) {
        missing.push(`reading ${readingName} (predicate order)`);
        continue;
      }
      const act = actFor(
        law,
        gw,
        now,
        SCHEMA_TERM,
        SCHEMA_NAME,
        readingName,
        schemaCanonicalHex(named),
      );
      if (act === undefined) missing.push(`reading ${readingName}`);
      else if (act.id !== schemaAct.id) extra.set(act.id, act);
    }
  };
  visit(top.body);
  if (missing.length > 0)
    throw new Error(
      `portable read of ${name}: its published law is missing ${missing.join(", ")}; ` +
        `the receiver never re-signs a missing act`,
    );
  return {
    status: "selected",
    program: {
      hyperschema: hyperAct,
      hyperschemaPin: termHash(top.body),
      schema: schemaAct,
      schemaPin: schemaHash(topReading),
      definitions: [...extra.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
      definitionAt: now,
    },
  };
}

const boots = new WeakMap<Signer, PortableBoot>();
const bootFor = (signer: Signer): PortableBoot => {
  let boot = boots.get(signer);
  if (boot === undefined) boots.set(signer, (boot = portableBoot(signer)));
  return boot;
};

/**
 * Classify one read, and freeze it. `now` is the host observation, sampled once by the caller:
 * the operand instant of a present read, and the serving time of every read.
 */
export function classifyPortableRead(
  gw: Gateway,
  name: string,
  entity: string,
  now: number,
  asOf?: number,
  binding?: ConnectionBinding,
): PortableRoute {
  if (binding !== undefined) return { route: "native", reason: "bound-connection" };
  if (channelLens(gw, name)) return { route: "native", reason: "channel" };
  const signer = gw.signer;
  if (signer === undefined) return { route: "native", reason: "no-signer" };
  if (needsLowering(gw.def(name).hyperschema.body, gw.registry))
    return { route: "native", reason: "governed-lowering" };
  // Law is selected from the present readable ground, whatever moment the operands are read at.
  const selection = selectProgram(gw, name, now, [...primaryGroundImpl(gw, now)]);
  if (selection.status === "unpublished") return { route: "native", reason: "unpublished-law" };
  if (selection.status === "reading-predicate")
    return { route: "native", reason: "reading-predicate" };
  const source = [...primaryGroundImpl(gw, now, asOf)];
  const prepared = preparePortableRead(signer, bootFor(signer), {
    root: entity,
    at: asOf ?? now,
    receivedAt: now,
    ...(asOf === undefined ? {} : { historicalCutoff: asOf }),
    program: selection.program,
    source,
    currentSource: () => [...primaryGroundImpl(gw, now, asOf)],
  });
  const preflight = preflightPortableRead(prepared);
  if (preflight.status === "over-input-limit") return { route: "native", reason: "input-capacity" };
  if (preflight.status === "invalid-input")
    throw new Error(`portable read of ${name}: the built input is invalid (${preflight.code})`);
  return { route: "portable", prepared, signer };
}

/** One ordinary read through its route. One attempt; a dispatched read never falls back. */
export async function readNodeImpl(
  gw: Gateway,
  name: string,
  entity: string,
  now: number,
  asOf?: number,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  const route = classifyPortableRead(gw, name, entity, now, asOf, binding);
  if (route.route === "native") return resolvedNodeImpl(gw, name, entity, now, asOf, binding);
  const answer = await runPortableRead(route.signer, route.prepared);
  if (answer.status !== "completed")
    throw new Error(
      `portable read of ${name} at ${entity}: ${answer.stage} ${answer.status}: ${answer.code}`,
    );
  return finishNodeImpl(
    gw,
    name,
    entity,
    now,
    answer.hview,
    answer.view as Record<string, View>,
    asOf,
  );
}
