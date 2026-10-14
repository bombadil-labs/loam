// The ordinary PRIMARY read door, routed (SPEC-16 M5 trial). Each read is classified BEFORE any
// dispatch: an eligible read runs the package's batch gather then resolve over Loam's own signed
// source; every other read takes the native branch, with its reason named. Once a portable read is
// dispatched, its errors surface: there is no retry and no fallback to native.

import {
  anchorAnalysis,
  collectRefs,
  MaterializationSourceError,
  scopeIds,
  type Admits,
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
import { channelLens, finishNodeImpl, resolvedNodeImpl } from "./reads.js";
import { readClosedIds } from "./slate-law.js";
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
  | "unanchored"
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
  candidates: readonly Delta[],
  gw: Gateway,
  now: number,
  termRole: string,
  nameRole: string,
  name: string,
  bodyHex: string,
): Delta | undefined {
  return candidates
    .filter(
      (d) =>
        textAt(d, termRole) === bodyHex && textAt(d, nameRole) === name && standing(gw, d, now),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
}

/**
 * The readable law at one entity, from the index. A definition act points at its own entity
 * (`hyperschema:<name>`, `schema:<lens>`), so program selection reads only those entities and
 * never the whole store. Law published under any other entity is not found, and its read stays
 * native as `unpublished-law`.
 */
const lawAt = (gw: Gateway, admits: Admits, entity: string): Delta[] =>
  gw.reactor
    .byTarget(entity)
    .map((id) => gw.reactor.get(id))
    .filter((d): d is Delta => d !== undefined && admits(d));

/** Whether a lens was published: its registration binding stands in law. */
const bound = (gw: Gateway, admits: Admits, hyperschemaName: string): boolean =>
  lawAt(gw, admits, `registration:hyperschema:${hyperschemaName}`).length > 0;

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
function selectProgram(gw: Gateway, name: string, now: number, admits: Admits): Selection {
  const def = gw.def(name);
  const top = def.hyperschema;
  const topReading = namedReading(def.schema, lensOf(def));
  const hyperAct = actFor(
    lawAt(gw, admits, `hyperschema:${top.name}`),
    gw,
    now,
    HYPER_TERM,
    HYPER_NAME,
    top.name,
    termCanonicalHex(top.body),
  );
  const schemaAct = actFor(
    lawAt(gw, admits, `schema:${lensOf(def)}`),
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
  // A missing act is a broken promise when its lens was published (its binding stands in law), and
  // native-only law otherwise: a `register()` lens never had acts, so the read stays native.
  const broken: string[] = [];
  let nativeOnly = false,
    predicate = false;
  const missing = (lens: string, what: string) => {
    if (bound(gw, admits, lens)) broken.push(what);
    else nativeOnly = true;
  };
  const seenBodies = new Set<string>();
  const visit = (body: Term): void => {
    for (const ref of collectRefs(body)) {
      const hs: HyperSchema | undefined = gw.registry.resolve(ref);
      if (hs === undefined) {
        broken.push(`hyperschema ${ref.kind === "name" ? ref.name : ref.hash}`);
        continue;
      }
      const key = `${hs.name}:${termCanonicalHex(hs.body)}`;
      if (seenBodies.has(key)) continue;
      seenBodies.add(key);
      const act = actFor(
        lawAt(gw, admits, `hyperschema:${hs.name}`),
        gw,
        now,
        HYPER_TERM,
        HYPER_NAME,
        hs.name,
        termCanonicalHex(hs.body),
      );
      if (act === undefined) missing(hs.name, `hyperschema ${hs.name}`);
      else if (act.id !== hyperAct.id) extra.set(act.id, act);
      visit(hs.body);
    }
    for (const readingName of expandReadings(body)) {
      const reading = gw.registered.find((r) => lensOf(r) === readingName);
      if (reading === undefined) {
        broken.push(`reading ${readingName}`);
        continue;
      }
      const named = namedReading(reading.schema, readingName);
      if (usesPredicateOrder(named)) predicate = true;
      const act = actFor(
        lawAt(gw, admits, `schema:${readingName}`),
        gw,
        now,
        SCHEMA_TERM,
        SCHEMA_NAME,
        readingName,
        schemaCanonicalHex(named),
      );
      if (act === undefined) missing(reading.hyperschema.name, `reading ${readingName}`);
      else if (act.id !== schemaAct.id) extra.set(act.id, act);
    }
  };
  visit(top.body);
  if (broken.length > 0)
    throw new Error(
      `portable read of ${name}: its published law is missing ${broken.join(", ")}; ` +
        `the receiver never re-signs a missing act`,
    );
  if (nativeOnly) return { status: "unpublished" };
  if (predicate) return { status: "reading-predicate" };
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
  // Law is selected from the present readable law, whatever moment the operands are read at.
  const closed = readClosedIds(gw, now);
  const selection = selectProgram(gw, name, now, (d) => !closed.has(d.id));
  if (selection.status === "unpublished") return { route: "native", reason: "unpublished-law" };
  if (selection.status === "reading-predicate")
    return { route: "native", reason: "reading-predicate" };
  // The read's scope comes from an anchored read over the reactor's index (SPEC-17 §6): its root,
  // its constant anchors and every expanded child. The capture carries exactly S(scope) under the
  // read closure and, for an as-of read, the cut; never the whole store.
  const term = gw.def(name).hyperschema.body;
  if (!anchorAnalysis(term, gw.registry).anchored) return { route: "native", reason: "unanchored" };
  const selected =
    (closedIds: ReadonlySet<string>): Admits =>
    (d) =>
      !closedIds.has(d.id) && (asOf === undefined || d.claims.timestamp <= asOf);
  const read = gw.reactor.evalAnchored(
    term,
    asOf ?? gw.validityNow(now),
    entity,
    gw.registry,
    undefined,
    selected(closed),
  );
  const members = (ids: readonly string[]) => ids.map((id) => gw.reactor.get(id)!);
  let prepared: PreparedPortableRead;
  try {
    prepared = preparePortableRead(signer, bootFor(signer), {
      root: entity,
      at: asOf ?? now,
      receivedAt: now,
      ...(asOf === undefined ? {} : { historicalCutoff: asOf }),
      program: selection.program,
      scope: read.scope,
      source: members(read.members),
      currentSource: () =>
        members(scopeIds(gw.reactor, read.scope, selected(readClosedIds(gw, now)))),
    });
  } catch (err) {
    // The producer applies the source limits before the input preflight runs.
    if (err instanceof MaterializationSourceError && err.code === "resource-limit")
      return { route: "native", reason: "input-capacity" };
    throw err;
  }
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
  const report = gw.options.onReadRoute;
  if (gw.options.portableReads !== true) {
    report?.({ lens: name, entity, route: "native", reason: "portable-reads-off" });
    return resolvedNodeImpl(gw, name, entity, now, asOf, binding);
  }
  const route = classifyPortableRead(gw, name, entity, now, asOf, binding);
  report?.({
    lens: name,
    entity,
    route: route.route,
    ...(route.route === "native" ? { reason: route.reason } : {}),
  });
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
