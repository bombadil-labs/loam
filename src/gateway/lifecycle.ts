import type { Peer } from "./peer.js";
import { seedSigner } from "./signer.js";
import {
  DeltaSet,
  SchemaRegistry,
  evalTermRaw,
  loadHyperSchema,
  makeDelta,
  schemaToJson,
  publishHyperSchemaClaims,
  termHash,
  type Delta,
  type HyperSchema,
  type Primitive,
  type Schema,
} from "@bombadil/rhizomatic";
import { openerStands } from "./container.js";
import { readContainerTable, receivesNow, subtreeUnder } from "./container-law.js";
import { fenceAdmits } from "./accounts.js";
import type { Bound, Gateway, RequestContext } from "./gateway.js";
import { NUL } from "./alphabet.js";
import { buildGqlSchema } from "./gql.js";
import {
  readLawfulContested,
  readLawfulRegistrations,
  type Registration,
  lensOf,
  programOf,
  readinglessExpandRole,
  parseClaimTemplates,
  type Boundary,
  referenceProps,
  registrationDeltaClaims,
  schemaEntityFor,
  type ClaimTemplates,
  type ContestedBinding,
  type RefSpecs,
  type ResolverSpecs,
  lensNameFor,
} from "./registration.js";
import { lawfulScopeAt } from "./lawful.js";
import {
  admitRenderers,
  readRenderers,
  rendererAdmissionBudget,
  reportUnmounted,
} from "./renderers.js";
import {
  interpretBindingPolicy,
  readBindingPolicy,
  type ResolvedBindings,
} from "./binding-policy.js";
import { loadResolvers } from "./resolvers.js";
import { stamped, withStamp, type Stamp } from "./stamp.js";
import { governedHook, governedProgram } from "./governed-trust.js";
import { userGroundOf } from "./user-root.js";
import { channelBindingPrefix } from "../federation/channel.js";

const RAW = { raw: true } as const;

function assertTemplatesVisible(
  schema: HyperSchema,
  templates: ClaimTemplates | undefined,
  registry: SchemaRegistry,
  specimenAuthor: string,
): void {
  for (const [name, template] of Object.entries(templates ?? {})) {
    const pointers = template.pointers.map((p) => {
      if (p.at !== undefined) {
        return {
          role: p.role,
          target: {
            kind: "entity" as const,
            entity: { id: `loam:specimen:${p.at.arg}`, context: p.context ?? p.role },
          },
        };
      }
      const value =
        typeof p.value === "object" && p.value !== null ? "loam:specimen" : (p.value as Primitive);
      return { role: p.role, target: { kind: "primitive" as const, value } };
    });
    const specimen = makeDelta({ timestamp: 1, validFrom: 1, author: specimenAuthor, pointers });
    const ground = DeltaSet.from([specimen]);
    const sentinels = [
      ...new Set(pointers.flatMap((p) => (p.target.kind === "entity" ? [p.target.entity.id] : []))),
    ];
    const seen = sentinels.some((root) => {
      const program = governedProgram(schema.body, registry, ground, RAW, undefined);
      const result = evalTermRaw(program.term, ground, root, program.registry);
      if (result.sort !== "hview") return false;
      for (const entries of result.hview.props.values()) {
        if (entries.some((e) => e.delta.id === specimen.id)) return true;
      }
      return false;
    });
    if (!seen) {
      throw new Error(
        `schema ${schema.name}: template "${name}" emits a delta this schema cannot see ` +
          `from any entity it touches — a write its own reads would never show`,
      );
    }
  }
}

function assertMaterializable(schema: HyperSchema, registry: SchemaRegistry): void {
  const empty = DeltaSet.from([]);
  const program = governedProgram(schema.body, registry, empty, RAW, undefined);
  const trial = evalTermRaw(program.term, empty, "loam:trial", program.registry);
  if (trial.sort !== "hview") {
    throw new Error(
      `schema ${schema.name}: its body must yield a hyperview (a group over the gathered ` +
        `deltas), not a ${trial.sort}`,
    );
  }
}

function assertReadingsNamed(schema: HyperSchema): void {
  const role = readinglessExpandRole(schema.body);
  if (role === undefined) return;
  throw new Error(
    `schema ${schema.name}: its \`expand\` of role "${role}" names no \`reading\` — an expanded ` +
      `child resolves through its OWN resolution Schema (rhizomatic issue #23), so the gather must ` +
      `name it`,
  );
}

export interface PublishOutcome {
  readonly persisted: true;

  readonly lens: string;
  readonly bound: boolean;

  readonly reason?: string;

  readonly warnings?: readonly string[];
}

export interface PublishInternals {
  readonly clock?: () => number;
  readonly negates?: readonly string[];
}

export function boundKey(r: Bound): string {
  return [
    r.hyperschema.name,
    termHash(r.hyperschema.body),
    JSON.stringify(schemaToJson(r.schema)),
    JSON.stringify(r.roots),
    JSON.stringify(r.mutations ?? null),
    JSON.stringify(r.writable ?? null),
    JSON.stringify(r.resolvers ?? null),
    JSON.stringify(r.refs ?? null),
    r.entity ?? "",
    r.origin,
  ].join(NUL);
}

export function matNameImpl(gw: Gateway, name: string): string {
  return ["", `g${gw.generation}`, name].join(NUL);
}

export function lazyMatNameImpl(gw: Gateway, name: string, entity: string): string {
  return [matNameImpl(gw, name), entity].join(NUL);
}

const MAX_LAZY_MATS = 1024;
const DEFAULT_MAX_PUBLIC_WATCHES = 256;

export function matForImpl(
  gw: Gateway,
  name: string,
  entity: string,
  door: "full" | "public" = "full",
): string {
  const def = gw.def(name);
  const program = def.hyperschema.name;
  if (def.roots.includes(entity)) return matNameImpl(gw, program);
  const matName = lazyMatNameImpl(gw, program, entity);
  if (!gw.lazyMats.has(matName)) {
    if (gw.lazyMats.size >= MAX_LAZY_MATS) {
      throw new Error(
        `this gateway already watches ${MAX_LAZY_MATS} unregistered entities — ` +
          `register the roots you mean to hold live`,
      );
    }
    if (door === "public") {
      const cap = gw.options.maxPublicWatches ?? DEFAULT_MAX_PUBLIC_WATCHES;
      if (gw.publicLazyMats.size >= cap) {
        throw new Error(
          `the public door already holds ${cap} unregistered entities live — ` +
            `query instead, or ask the operator to register the roots that matter`,
        );
      }
      gw.publicLazyMats.add(matName);
    }
    gw.reactor.register(
      matName,
      def.hyperschema.body,
      [entity],
      gw.validityNow(),
      gw.registry,
      governedHook(def.hyperschema.body, gw.registry, () => userGroundOf(gw.reactor), gw.reactor),
    );
    gw.lazyMats.add(matName);
  }
  return matName;
}

export interface Program {
  readonly hyperschema: HyperSchema;
  readonly roots: readonly string[];
  readonly lenses: Map<string, Bound>;
}

export function groupPrograms(regs: readonly Bound[]): Map<string, Program> {
  const programs = new Map<
    string,
    { hyperschema: HyperSchema; hash: string; roots: Set<string>; lenses: Map<string, Bound> }
  >();
  for (const reg of regs) {
    const name = reg.hyperschema.name;
    const hash = termHash(reg.hyperschema.body);
    const lens = lensOf(reg);
    const group = programs.get(name);
    if (group === undefined) {
      programs.set(name, {
        hyperschema: reg.hyperschema,
        hash,
        roots: new Set(reg.roots),
        lenses: new Map([[lens, reg]]),
      });
      continue;
    }
    if (group.hash !== hash) {
      throw new Error(
        `hyperschema "${name}": two bindings carry DIFFERENT bodies (termHash ${group.hash.slice(0, 12)}… vs ` +
          `${hash.slice(0, 12)}…) — one name, one gather; a rival body is a different schema and wants a different name`,
      );
    }
    for (const r of reg.roots) group.roots.add(r);
    group.lenses.set(lens, reg);
  }
  const out = new Map<string, Program>();
  for (const [name, g] of programs) {
    out.set(name, { hyperschema: g.hyperschema, roots: [...g.roots], lenses: g.lenses });
  }
  return out;
}

const programHyperschemas = (regs: readonly Bound[]): HyperSchema[] =>
  [...groupPrograms(regs).values()].map((p) => p.hyperschema);

const programReadings = (regs: readonly Bound[]): Schema[] => {
  const byName = new Map<string, Schema>();
  for (const program of groupPrograms(regs).values()) {
    for (const [lens, bound] of program.lenses) {
      byName.set(lens, bound.schema.name === lens ? bound.schema : { ...bound.schema, name: lens });
    }
  }
  return [...byName.values()];
};

export function rebindImpl(gw: Gateway, next: Bound[]): void {
  const programs = groupPrograms(next);
  const registry = SchemaRegistry.build(
    [...programs.values()].map((p) => p.hyperschema),
    programReadings(next),
  );
  const gql = buildGqlSchema(next, gw.gqlHooks());
  gw.generation += 1;
  for (const program of programs.values()) {
    gw.reactor.register(
      matNameImpl(gw, program.hyperschema.name),
      program.hyperschema.body,
      program.roots,
      gw.validityNow(),
      registry,
      governedHook(program.hyperschema.body, registry, () => userGroundOf(gw.reactor), gw.reactor),
    );
  }
  gw.lazyMats.clear();
  gw.publicLazyMats.clear();
  gw.registered = next;
  gw.registry = registry;
  gw.gql = gql;
}

const bindFailures = new WeakMap<Gateway, Map<string, string>>();
const failureKey = (entity: string, lens: string): string => [entity, lens].join(NUL);
const rememberBindFailure = (gw: Gateway, key: string, err: unknown): void => {
  const seen = bindFailures.get(gw) ?? new Map<string, string>();
  bindFailures.set(gw, seen);
  seen.set(key, err instanceof Error ? err.message : String(err));
};
const forgetBindFailure = (gw: Gateway, key: string): void => {
  bindFailures.get(gw)?.delete(key);
};
const lastBindFailure = (gw: Gateway, key: string): string | undefined =>
  bindFailures.get(gw)?.get(key);

const lawfulRegistrations = (g: Peer, boundary?: Boundary): Registration[] =>
  readLawfulRegistrations(g.reactor, g.validityNow(), g.lawAuthors("registrations"), boundary);

function storeBindings(gw: Gateway, boundary?: Boundary): Bound[] {
  const rows: Bound[] = lawfulRegistrations(gw, boundary).map((r) => ({
    ...r,
    origin: "store" as const,
  }));
  for (const standing of gw.channelStatus()) {
    if (standing.openedBy !== undefined) continue;
    const pool = gw.store.channels(gw).get(standing.name)?.gateway;
    if (pool === undefined) continue;
    const read = lawfulRegistrations(pool, boundary);
    for (const r of read) {
      const prefix = channelBindingPrefix(gw, standing);
      if (prefix === undefined || !lensOf(r).startsWith(`${prefix}:`)) continue;
      rows.push({ ...r, origin: "store" as const, channel: standing.name });
    }
  }
  return rows;
}

function trialBind(gw: Gateway, accepted: readonly Bound[], candidate: Bound): void {
  const trial = [...accepted, candidate];
  const registry = SchemaRegistry.build(programHyperschemas(trial), programReadings(trial));
  assertReadingsNamed(candidate.hyperschema);
  assertMaterializable(candidate.hyperschema, registry);
  assertTemplatesVisible(
    candidate.hyperschema,
    candidate.mutations,
    registry,
    gw.operatorAuthor ?? "loam:specimen",
  );
  buildGqlSchema(trial, gw.gqlHooks());
}

export interface BoundFold {
  readonly registered: readonly Bound[];
  readonly registry: SchemaRegistry;

  readonly refused: ReadonlyMap<string, string>;
  readonly key: string;
}

export function boundBindingsImpl(
  gw: Gateway,
  container: string,
  held?: { readonly key: string; readonly fold: BoundFold },
): BoundFold {
  const table = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  const reach = new Set(subtreeUnder(table, container));
  const candidates: Bound[] = [];
  for (const [name, inbox] of gw.store.inboxes(gw)) {
    const owner = table.containers.get(name)?.inboxOf;
    if (owner === undefined || !reach.has(owner) || inbox.gateway === undefined) continue;
    const prefix = `${owner}:`;
    for (const r of lawfulRegistrations(inbox.gateway)) {
      if (!fenceAdmits(prefix, r.hyperschema.name)) continue;
      if (!fenceAdmits(prefix, lensOf(r))) continue;
      if (lensOf(r).includes(NUL)) continue;
      if (r.entity !== undefined && r.entity !== schemaEntityFor(r.hyperschema)) continue;
      candidates.push({ ...r, origin: "store" as const, channel: name });
    }
  }
  for (const standing of gw.channelStatus()) {
    if (standing.openedBy === undefined || !reach.has(standing.openedBy)) continue;
    if (!openerStands(gw, standing)) continue;
    if (!receivesNow(table, standing.into)) continue;
    const pool = gw.store.channels(gw).get(standing.name)?.gateway;
    if (pool === undefined) continue;
    for (const r of lawfulRegistrations(pool)) {
      const prefix = channelBindingPrefix(gw, standing);
      if (prefix === undefined || !lensOf(r).startsWith(`${prefix}:`)) continue;
      if (lensOf(r).includes(NUL)) continue;
      candidates.push({ ...r, origin: "store" as const, channel: standing.name });
    }
  }
  candidates.sort(
    (a, b) =>
      (a.firstBoundAt ?? a.boundAt ?? 0) - (b.firstBoundAt ?? b.boundAt ?? 0) ||
      (a.channel ?? "").localeCompare(b.channel ?? ""),
  );
  const key = [
    ...gw.registered.map((r) => boundKey(r)),
    NUL,
    ...candidates.map((r) => `${r.channel ?? ""}${NUL}${boundKey(r)}`),
  ].join(NUL);
  if (held !== undefined && held.key === key) return held.fold;

  const accepted: Bound[] = [...gw.registered];
  const reasons = new Map<Bound, string>();
  const rootFault = new Map<Bound, string>();
  if (buildsAlone(gw, gw.registered) === undefined)
    for (const candidate of candidates) {
      if (buildsAlone(gw, [candidate]) !== undefined) continue;
      const fault = buildsAlone(gw, [...gw.registered, candidate]);
      if (fault !== undefined) rootFault.set(candidate, fault);
    }
  let pending = candidates;
  for (;;) {
    const still: Bound[] = [];
    const holders: Bound[] = [];
    let progressed = false;
    for (const candidate of pending) {
      const fault = rootFault.get(candidate);
      if (fault !== undefined) {
        reasons.set(candidate, fault);
        holders.push(candidate);
        still.push(candidate);
        continue;
      }
      const contest = contestedBy(gw, candidate, holders);
      if (contest !== undefined) {
        reasons.set(
          candidate,
          `lens ${lensOf(candidate)}: an earlier claim, ${lensOf(contest.holder)}, contests it — ${contest.on} — and that claim is refused: ${reasons.get(contest.holder) ?? "did not bind"}`,
        );
        holders.push(candidate);
        still.push(candidate);
        continue;
      }
      try {
        trialBind(gw, accepted, candidate);
        accepted.push(candidate);
        progressed = true;
      } catch (err) {
        reasons.set(candidate, err instanceof Error ? err.message : String(err));
        holders.push(candidate);
        still.push(candidate);
      }
    }
    pending = still;
    if (!progressed || pending.length === 0) break;
  }
  const refused = new Map<string, string>();
  for (const left of pending)
    refused.set(refusalKey(left.channel ?? "", lensOf(left)), reasons.get(left) ?? "did not bind");
  const registry = SchemaRegistry.build(programHyperschemas(accepted), programReadings(accepted));
  return { registered: accepted, registry, refused, key };
}

function buildsAlone(gw: Gateway, rows: readonly Bound[]): string | undefined {
  try {
    groupPrograms(rows);
    buildGqlSchema(rows, gw.gqlHooks());
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function contests(gw: Gateway, holder: Bound, rival: Bound): string | undefined {
  if (buildsAlone(gw, [holder]) !== undefined || buildsAlone(gw, [rival]) !== undefined)
    return undefined;
  return buildsAlone(gw, [holder, rival]);
}

function contestedBy(
  gw: Gateway,
  c: Bound,
  holders: readonly Bound[],
): { readonly holder: Bound; readonly on: string } | undefined {
  for (const holder of holders) {
    const on = contests(gw, holder, c);
    if (on !== undefined) return { holder, on };
  }
  return undefined;
}

export const refusalKey = (channel: string, lens: string): string => `${channel}${NUL}${lens}`;

function crossOriginBindings(gw: Gateway, rows: readonly Bound[]): ResolvedBindings | undefined {
  const mode = readBindingPolicy(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  if (mode === undefined || !rows.some((r) => r.channel !== undefined)) return undefined;
  return interpretBindingPolicy(
    rows
      .filter((r) => r.boundId !== undefined)
      .map((r) => ({
        lens: lensOf(r),
        entity: r.entity ?? "",
        author: r.channel === undefined ? (gw.operatorAuthor ?? "") : `channel:${r.channel}`,
        timestamp: r.boundAt ?? 0,
        deltaId: r.boundId!,
      })),
    mode,
    gw.operatorAuthor,
  );
}

export interface ContestedName extends ContestedBinding {
  readonly origin: string;
  readonly served: boolean;
}

export interface ContestedNameReport {
  readonly contenders: readonly ContestedName[];

  readonly servedByOther?: { readonly origin: string; readonly entity: string };
}

export function contestedNamesImpl(gw: Gateway): Map<string, ContestedNameReport> {
  gw.replayRegistrations();

  const drafts = new Map<string, (ContestedBinding & { origin: string })[]>();
  const rows = storeBindings(gw);
  const originOf = (deltaId: string, ground: string): string =>
    gw.reactor.get(deltaId) === undefined ? ground : "root";
  const add = (lens: string, row: ContestedBinding & { origin: string }): void => {
    const list = drafts.get(lens) ?? [];
    if (list.some((held) => held.deltaId === row.deltaId)) return;
    list.push(row);
    drafts.set(lens, list);
  };
  for (const [lens, list] of readLawfulContested(
    gw.reactor,
    gw.validityNow(),
    gw.lawAuthors("registrations"),
  )) {
    for (const c of list) add(lens, { ...c, origin: "root" });
  }
  for (const standing of gw.channelStatus()) {
    const pool = gw.store.channels(gw).get(standing.name)?.gateway;
    if (pool === undefined) continue;
    for (const [lens, list] of readLawfulContested(
      pool.reactor,
      pool.validityNow(),
      pool.lawAuthors("registrations"),
    )) {
      const prefix = channelBindingPrefix(gw, standing);
      if (prefix === undefined || !lens.startsWith(`${prefix}:`)) continue;
      for (const c of list) add(lens, { ...c, origin: originOf(c.deltaId, standing.name) });
    }
  }
  const byBinding = new Map<string, Bound>();
  for (const r of rows) {
    if (r.boundId === undefined || byBinding.has(r.boundId)) continue;
    byBinding.set(r.boundId, r);
  }
  for (const [lens, list] of crossOriginBindings(gw, rows)?.contested ?? []) {
    for (const c of list) {
      const row = byBinding.get(c.deltaId)!;
      add(lens, {
        entity: c.entity,
        author: row.boundBy!,
        timestamp: c.timestamp,
        deltaId: c.deltaId,
        origin: originOf(c.deltaId, row.channel ?? "root"),
      });
    }
  }

  const out = new Map<string, ContestedNameReport>();
  for (const [lens, list] of drafts) {
    list.sort(
      (a, b) =>
        a.timestamp - b.timestamp || (a.deltaId < b.deltaId ? -1 : a.deltaId > b.deltaId ? 1 : 0),
    );
    const serving = gw.registered.find((r) => (lensOf(r) as string) === lens);
    const servedRow =
      serving?.boundId === undefined ? undefined : list.find((d) => d.deltaId === serving.boundId);
    out.set(lens, {
      contenders: list.map((d) => ({ ...d, served: d === servedRow })),
      ...(serving === undefined || servedRow !== undefined
        ? {}
        : {
            servedByOther: {
              origin: serving.channel ?? "root",
              entity: serving.entity ?? programOf(serving),
            },
          }),
    });
  }
  return out;
}

export function replayRegistrationsImpl(gw: Gateway): void {
  const manual = gw.registered.filter((r) => r.origin === "manual");
  const accepted: Bound[] = [...manual];
  const boundary: Boundary = {};
  const rows = storeBindings(gw, boundary);
  gw.registrationBoundary = boundary.next;
  const resolved = crossOriginBindings(gw, rows);
  let pending: Bound[] =
    resolved === undefined
      ? rows
      : rows.filter((r) => {
          if (r.boundId === undefined) return true;
          const winner = resolved.winners.get(lensOf(r));
          return winner === r.boundId;
        });
  for (;;) {
    const stillPending: Bound[] = [];
    let progressed = false;
    for (const reg of pending) {
      const attempt = (candidate: Bound): boolean => {
        try {
          trialBind(gw, accepted, candidate);
          accepted.push(candidate);
          forgetBindFailure(gw, failureKey(candidate.entity ?? "", lensOf(candidate)));
          return true;
        } catch (err) {
          rememberBindFailure(gw, failureKey(candidate.entity ?? "", lensOf(candidate)), err);
          return false;
        }
      };
      const templateless: Bound = Object.fromEntries(
        Object.entries(reg).filter(([k]) => k !== "mutations" && k !== "mutationsDefect"),
      ) as Bound;
      if (attempt(reg)) {
        progressed = true;
      } else if (reg.mutations !== undefined) {
        const key = failureKey(reg.entity ?? "", lensOf(reg));
        const fault = lastBindFailure(gw, key);
        if (attempt(templateless)) {
          progressed = true;
          rememberBindFailure(
            gw,
            key,
            new Error(`bound without its mutation templates — ${fault ?? "they did not bind"}`),
          );
        } else {
          stillPending.push(reg);
        }
      } else {
        stillPending.push(reg);
      }
    }
    if (!progressed || stillPending.length === 0) break;
    pending = stillPending;
  }

  const currentKeys = new Set(gw.registered.map((r) => boundKey(r)));
  const acceptedKeys = new Set(accepted.map((r) => boundKey(r)));
  if (
    acceptedKeys.size === currentKeys.size &&
    [...currentKeys].every((k) => acceptedKeys.has(k))
  ) {
    return;
  }
  if ([...currentKeys].every((k) => acceptedKeys.has(k))) {
    const prior = groupPrograms(gw.registered);
    const next = groupPrograms(accepted);
    let widened = false;
    const fresh: Program[] = [];
    for (const [name, program] of next) {
      const before = prior.get(name);
      if (before === undefined) {
        fresh.push(program);
        continue;
      }
      const covered = new Set(before.roots);
      if (!program.roots.every((r) => covered.has(r))) widened = true;
    }
    if (widened) {
      rebindImpl(gw, accepted);
      return;
    }
    const registry = SchemaRegistry.build(
      [...next.values()].map((p) => p.hyperschema),
      programReadings(accepted),
    );
    const gql = buildGqlSchema(accepted, gw.gqlHooks());
    for (const program of fresh) {
      gw.reactor.register(
        matNameImpl(gw, program.hyperschema.name),
        program.hyperschema.body,
        program.roots,
        gw.validityNow(),
        registry,
        governedHook(
          program.hyperschema.body,
          registry,
          () => userGroundOf(gw.reactor),
          gw.reactor,
        ),
      );
    }
    gw.registered = accepted;
    gw.registry = registry;
    gw.gql = gql;
    return;
  }
  rebindImpl(gw, accepted);
}

export function registerImpl(
  gw: Gateway,
  hyperschema: HyperSchema,
  schema: Schema,
  roots: readonly string[],
  mutations?: ClaimTemplates,
  writable?: readonly string[],
  refs?: RefSpecs,
): void {
  if (hyperschema.name.includes(NUL)) {
    throw new Error("a schema name may not contain NUL — that alphabet is the gateway's own");
  }
  const templates = mutations === undefined ? undefined : parseClaimTemplates(mutations);
  const next: Bound[] = [
    ...gw.registered,
    {
      hyperschema,
      schema,
      roots,
      origin: "manual",
      lensName: lensNameFor(hyperschema, schema),
      ...(templates ? { mutations: templates } : {}),
      ...(writable ? { writable } : {}),
      ...(refs ? { refs } : {}),
    },
  ];
  const registry = SchemaRegistry.build(programHyperschemas(next), programReadings(next));
  assertReadingsNamed(hyperschema);
  assertMaterializable(hyperschema, registry);
  assertTemplatesVisible(hyperschema, templates, registry, gw.operatorAuthor ?? "loam:specimen");
  const gql = buildGqlSchema(next, gw.gqlHooks());
  const program = groupPrograms(next).get(hyperschema.name)!;
  gw.reactor.register(
    matNameImpl(gw, hyperschema.name),
    hyperschema.body,
    program.roots,
    gw.validityNow(),
    registry,
    governedHook(hyperschema.body, registry, () => userGroundOf(gw.reactor), gw.reactor),
  );
  gw.registered = next;
  gw.registry = registry;
  gw.gql = gql;
}

export async function loadHyperSchemaImpl(
  gw: Gateway,
  deltas: Iterable<Delta>,
  entity: string,
): Promise<HyperSchema> {
  const batch = [...deltas];
  const trial = lawfulScopeAt(
    gw.reactor,
    gw.validityNow(),
    entity,
    gw.operatorAuthor,
    batch.map((d) => d.id),
  );
  for (const d of batch) trial.add(d);
  const schema = loadHyperSchema(trial, entity, gw.validityNow());
  await gw.append(batch);
  return schema;
}

export async function preloadResolversImpl(gw: Gateway): Promise<void> {
  const specs: Array<ResolverSpecs | undefined> = [
    ...gw.registered.map((r) => r.resolvers),
    ...gw.registrationVersions().map((v) => v.resolvers),
  ];
  await loadResolvers(specs);
  const bindings = readRenderers(gw.reactor, gw.validityNow(), gw.lawAuthors("renderers"));
  const refused = await admitRenderers(
    bindings.map((r) => r.bundle),
    rendererAdmissionBudget(gw),
  );
  for (const { bundle, why } of refused) reportUnmounted(bindings, bundle, why);
}

export async function publishRegistrationImpl(
  gw: Gateway,
  hyperschema: HyperSchema,
  schema: Schema,
  roots: readonly string[],
  context?: RequestContext,
  entity?: string,
  mutations?: ClaimTemplates,
  writable?: readonly string[],
  resolvers?: ResolverSpecs,
  refs?: RefSpecs,
  internals?: PublishInternals,
): Promise<PublishOutcome> {
  const signer = context?.actor !== undefined ? seedSigner(context.actor) : gw.signer;
  if (signer === undefined) {
    throw new Error("this gateway holds no signing seed and cannot publish a registration");
  }
  if (gw.operatorAuthor !== undefined && signer.author !== gw.operatorAuthor) {
    throw new Error("append rejected: only the operator may publish a registration");
  }
  if (hyperschema.name.includes(NUL)) {
    throw new Error("a hyperschema name may not contain NUL — that alphabet is the gateway's own");
  }
  const templates = mutations === undefined ? undefined : parseClaimTemplates(mutations);
  if (resolvers !== undefined) {
    for (const field of Object.keys(resolvers)) {
      if (!schema.props.has(field)) {
        throw new Error(
          `resolver "${field}": no such field in the schema — a resolver rides an existing ` +
            `property (synthetic fields with no Policy are SPEC §22 rung (e), not built in v1)`,
        );
      }
    }
    await loadResolvers([resolvers]);
  }
  const lensName = lensNameFor(hyperschema, schema);
  const warnings: string[] = [];
  if (refs !== undefined) {
    for (const prop of Object.keys(refs)) {
      if (!schema.props.has(prop)) {
        throw new Error(
          `refs "${prop}": no such field in the schema — a reference declaration rides an ` +
            `existing property`,
        );
      }
    }
    const opened = new Set(writable ?? []);
    for (const ref of referenceProps(hyperschema.body, refs).values()) {
      if (opened.has(ref.prop)) {
        warnings.push(
          `"${ref.prop}" on "${lensName}" is declared in both \`writable\` and \`refs\`; ` +
            "refs wins — the prop takes no primitive argument, and its writes are the " +
            "link/unlink mutations. Remove it from `writable`.",
        );
      }
      if (ref.links && ref.reciprocal === undefined) {
        warnings.push(
          `reciprocal context for ${lensName}.${ref.prop} undeclared; link deltas will not ` +
            `fold on the ${ref.target ?? "target"} side`,
        );
      }
    }
  }
  const caveats = warnings.length === 0 ? {} : { warnings };
  const schemaEntity = schemaEntityFor(hyperschema, entity);
  const survivors = gw.registered.filter(
    (r) => !(programOf(r) === hyperschema.name && lensOf(r) === lensName),
  );
  const mode = readBindingPolicy(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  const trialSurvivors =
    mode === undefined
      ? survivors
      : survivors.filter((r) => !(lensOf(r) === lensName && r.entity !== schemaEntity));
  const trialLenses: Bound[] = [
    ...trialSurvivors,
    { hyperschema, schema, roots, origin: "store", lensName },
  ];
  const trialRegistry = SchemaRegistry.build(
    programHyperschemas(trialLenses),
    programReadings(trialLenses),
  );
  assertReadingsNamed(hyperschema);
  assertMaterializable(hyperschema, trialRegistry);
  assertTemplatesVisible(hyperschema, templates, trialRegistry, gw.operatorAuthor ?? signer.author);
  buildGqlSchema(
    [
      ...trialSurvivors,
      {
        hyperschema,
        schema,
        roots,
        lensName,
        ...(templates ? { mutations: templates } : {}),
        ...(writable ? { writable } : {}),
        ...(resolvers ? { resolvers } : {}),
        ...(refs ? { refs } : {}),
      },
    ],
    gw.gqlHooks(),
  );

  const author = signer.author;
  const clock = internals?.clock;
  const tick = (): Stamp => (clock === undefined ? gw.stamp(author) : stamped(clock()));
  const definition = signer.sign(
    withStamp(tick(), (t) => publishHyperSchemaClaims(hyperschema, schemaEntity, author, t)),
  );
  await loadHyperSchemaImpl(gw, [definition], schemaEntity);
  const { living, snapshot, binding } = registrationDeltaClaims(
    schemaEntity,
    lensName,
    schema,
    roots,
    author,
    tick,
    templates,
    writable,
    resolvers,
    refs,
  );
  const filed =
    internals?.negates === undefined || internals.negates.length === 0
      ? binding
      : {
          ...binding,
          pointers: [
            ...internals.negates.map((id) => ({
              role: "negates",
              target: { kind: "delta" as const, deltaRef: { delta: id } },
            })),
            ...binding.pointers,
          ],
        };
  await gw.append([signer.sign(living), signer.sign(snapshot), signer.sign(filed)]);
  replayRegistrationsImpl(gw);
  await preloadResolversImpl(gw);
  const bound = gw.registered.some(
    (r) => r.origin === "store" && r.entity === schemaEntity && lensOf(r) === lensName,
  );
  if (bound) {
    const shed = lastBindFailure(gw, failureKey(schemaEntity, lensName));
    return shed === undefined
      ? { persisted: true, lens: lensName, bound: true, ...caveats }
      : { persisted: true, lens: lensName, bound: true, reason: shed, ...caveats };
  }
  return {
    persisted: true,
    lens: lensName,
    bound: false,
    ...caveats,
    reason:
      lastBindFailure(gw, failureKey(schemaEntity, lensName)) ??
      (mode !== undefined && gw.registered.some((r) => lensOf(r) === lensName)
        ? `the declared ${mode} policy resolves "${lensName}" to another registration — the deltas ` +
          `are down, and this one serves if the contest later resolves its way`
        : mode === "conflicts"
          ? `"${lensName}" is contested and the declared conflicts policy serves no contender — ` +
            `the /admin dashboard and gateway.contestedNames() name them all`
          : "it was not among the registrations the store re-derived — check that the operator " +
            "authored it and that its definition survives"),
  };
}
