import type { Peer } from "./peer.js";
import { seedSigner } from "./signer.js";
import { authorForSeed, type Primitive } from "@bombadil/rhizomatic";
import type { Claims, Delta, Reactor } from "@bombadil/rhizomatic";
import { bytesEnvelope, findBytesByRef } from "./bytes.js";
import { esmAddress } from "./esm.js";
import { plainText } from "./plain-text.js";
import type { Gateway, RequestContext } from "./gateway.js";
import type { ResolvedNode } from "./gql.js";
import { holdsGrant } from "./accounts.js";
import { STORE_ENTITY } from "./genesis.js";
import { frameAsOf } from "./asof.js";
import { frameProbation } from "./probation.js";
import {
  admitInWorker,
  renderInWorker,
  type Admission,
  type RenderWorkerOptions,
} from "./render-worker.js";
import { workerLimitsOf } from "./envelope.js";
import { byLens, lensOf, type LensName } from "./registration.js";
import { lawfulSnapshot } from "./lawful.js";
import { negatedAt } from "./negation.js";
import {
  createRootRendererContext,
  rendererContextStands,
  rendererContextRefusal,
  type RendererContext,
} from "./renderer-context.js";
import { withStamp } from "./stamp.js";

export const CTX_RENDERER = "loam.renderer";

export const CTX_PEN = "loam.pen";
export const penEntity = (name: string): string => `pen:${name}`;

export function penRecordClaims(
  name: string,
  penAuthor: string,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "pen",
        target: { kind: "entity", entity: { id: penEntity(name), context: CTX_PEN } },
      },
      { role: "author", target: { kind: "primitive", value: penAuthor } },
    ],
  };
}

interface RendererCore {
  readonly route: string;
  readonly schemaName: LensName;
  readonly consumes: readonly string[];
  readonly bundle: string;
  readonly writable?: readonly string[];
  readonly pen?: string;
}

export interface RendererSpec extends RendererCore {
  readonly version?: number;
}

export interface RendererBinding extends RendererCore {
  readonly versionId?: string;
  readonly deltaId: string;
  readonly timestamp: number;
}

export type ReadCode = "not_served" | "refused" | "unavailable" | "needs_connection";

export type ReadResult =
  | { readonly entity: string; readonly view: Record<string, unknown>; readonly hex: string }
  | { readonly error: { readonly code: ReadCode; readonly message: string } };

export interface RenderNode {
  readonly entity: string;
  readonly view: Record<string, unknown>;
  readonly hex: string;
  readonly reads: Record<string, ReadResult>;
  readonly state: Record<string, string>;
}

export interface ReadGesture {
  readonly lens: string;
  readonly entity: string;
}

export const readKey = (lens: string, entity: string): string => `${lens}@${entity}`;

export function parseReadGesture(raw: string): ReadGesture | undefined {
  const i = raw.indexOf(":");
  if (i <= 0 || i >= raw.length - 1) return undefined;
  return { lens: raw.slice(0, i), entity: raw.slice(i + 1) };
}

export type RenderFn = (node: RenderNode) => string;

const primitive = (claims: Claims, role: string): string | number | boolean | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};

const rendererEntity = (route: string): string => `renderer:${route}`;

export function parseRendererInput(raw: unknown): RendererSpec {
  const o = raw as {
    route?: unknown;
    schema?: unknown;
    schemaName?: unknown;
    version?: unknown;
    consumes?: unknown;
    bundle?: unknown;
    writable?: unknown;
    pen?: unknown;
  } | null;
  if (o === null || typeof o !== "object") {
    throw new Error("register-renderer wants { route, schema, consumes, bundle, version? }");
  }
  const schemaName = o.schema ?? o.schemaName;
  if (typeof o.route !== "string" || o.route === "") {
    throw new Error("renderer: route must be a non-empty string");
  }
  if (o.route.includes("/") || o.route.includes(String.fromCharCode(0))) {
    throw new Error("renderer: route may not contain '/' or NUL");
  }
  if (typeof schemaName !== "string" || schemaName === "") {
    throw new Error("renderer: schema must be a non-empty schema name");
  }
  if (
    o.version !== undefined &&
    (typeof o.version !== "number" || !Number.isInteger(o.version) || o.version < 1)
  ) {
    throw new Error("renderer: version must be a positive integer (a §17 vN) when given");
  }
  if (!Array.isArray(o.consumes) || o.consumes.some((f) => typeof f !== "string" || f === "")) {
    throw new Error("renderer: consumes must be an array of field names");
  }
  if (typeof o.bundle !== "string" || o.bundle.trim() === "") {
    throw new Error("renderer: bundle must be non-empty runnable ESM");
  }
  if (
    o.writable !== undefined &&
    (!Array.isArray(o.writable) || o.writable.some((f) => typeof f !== "string" || f === ""))
  ) {
    throw new Error("renderer: writable must be an array of field names when given");
  }
  if (o.pen !== undefined && (typeof o.pen !== "string" || o.pen === "")) {
    throw new Error("renderer: pen must be a non-empty granted-author identity when given");
  }
  if ((o.writable === undefined) !== (o.pen === undefined)) {
    throw new Error(
      "renderer: writable and pen must be given together — a writing renderer needs a pen to sign as",
    );
  }
  return {
    route: o.route,
    schemaName: schemaName as LensName,
    ...(o.version === undefined ? {} : { version: o.version }),
    consumes: o.consumes as string[],
    bundle: o.bundle,
    ...(o.writable === undefined ? {} : { writable: o.writable as string[] }),
    ...(o.pen === undefined ? {} : { pen: o.pen }),
  };
}

export function rendererBindingClaims(
  core: RendererCore,
  versionId: string | undefined,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "renders",
        target: {
          kind: "entity",
          entity: { id: rendererEntity(core.route), context: CTX_RENDERER },
        },
      },
      { role: "route", target: { kind: "primitive", value: core.route } },
      { role: "schema", target: { kind: "primitive", value: core.schemaName } },
      ...(versionId === undefined
        ? []
        : [{ role: "versionId", target: { kind: "primitive" as const, value: versionId } }]),
      { role: "consumes", target: { kind: "primitive", value: JSON.stringify(core.consumes) } },
      { role: "bundle", target: { kind: "primitive", value: core.bundle } },
      ...(core.writable === undefined
        ? []
        : [
            {
              role: "writable" as const,
              target: { kind: "primitive" as const, value: JSON.stringify(core.writable) },
            },
          ]),
      ...(core.pen === undefined
        ? []
        : [{ role: "pen" as const, target: { kind: "primitive" as const, value: core.pen } }]),
    ],
  };
}

const isRoute = (id: string): boolean => id.startsWith("renderer:");

export function readRenderers(
  reactor: Reactor,
  now: number,
  operator?: string | readonly string[],
): RendererBinding[] {
  if (typeof operator !== "object") {
    const negated = negatedAt(reactor, now, operator);
    return latestPerRoute(lawfulSnapshot(reactor, now, operator), (d) => !negated(d.id));
  }
  const holder = operator[0];
  const byAuthor = new Map<string, (id: string) => boolean>();
  const strikesOf = (author: string) => {
    let f = byAuthor.get(author);
    if (f === undefined) byAuthor.set(author, (f = negatedAt(reactor, now, author)));
    return f;
  };
  const struck = (d: Delta): boolean =>
    strikesOf(d.claims.author)(d.id) || (holder !== undefined && strikesOf(holder)(d.id));
  return latestPerRoute(lawfulSnapshot(reactor, now, operator), (d) => !struck(d));
}

export function rendererBindingOf(delta: Delta): RendererBinding | undefined {
  const key = delta.claims.pointers.find(
    (p) => p.target.kind === "entity" && p.target.entity.context === CTX_RENDERER,
  );
  if (key?.target.kind !== "entity" || !isRoute(key.target.entity.id)) return undefined;
  const route = primitive(delta.claims, "route");
  const schemaName = primitive(delta.claims, "schema");
  const bundle = primitive(delta.claims, "bundle");
  if (typeof route !== "string" || typeof schemaName !== "string" || typeof bundle !== "string") {
    return undefined;
  }
  const versionIdRaw = primitive(delta.claims, "versionId");
  const versionId = typeof versionIdRaw === "string" ? versionIdRaw : undefined;
  const jsonList = (role: string): string[] | undefined => {
    const raw = primitive(delta.claims, role);
    if (typeof raw !== "string") return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((f) => typeof f === "string")) return parsed;
    } catch {
      return undefined;
    }
    return undefined;
  };
  const writable = jsonList("writable");
  const penRaw = primitive(delta.claims, "pen");
  const pen = typeof penRaw === "string" && penRaw !== "" ? penRaw : undefined;
  const writeReady = writable !== undefined && writable.length > 0 && pen !== undefined;
  return {
    route,
    schemaName: schemaName as LensName,
    ...(versionId === undefined ? {} : { versionId }),
    consumes: jsonList("consumes") ?? [],
    bundle,
    ...(writeReady ? { writable, pen } : {}),
    deltaId: delta.id,
    timestamp: delta.claims.timestamp,
  };
}

function latestPerRoute(
  deltas: Iterable<Delta>,
  survives: (d: Delta) => boolean,
): RendererBinding[] {
  const latest = new Map<string, RendererBinding>();
  for (const delta of deltas) {
    if (!survives(delta)) continue;
    const binding = rendererBindingOf(delta);
    if (binding === undefined) continue;
    const held = latest.get(binding.route);
    if (
      held === undefined ||
      binding.timestamp > held.timestamp ||
      (binding.timestamp === held.timestamp && binding.deltaId > held.deltaId)
    ) {
      latest.set(binding.route, binding);
    }
  }
  return [...latest.values()];
}

export function readPoolRenderers(pool: Peer, host: Gateway): RendererBinding[] {
  if (pool.operatorAuthor === undefined) return [];
  const negated = negatedAt(pool.reactor, pool.validityNow(), pool.operatorAuthor);
  return latestPerRoute(
    lawfulSnapshot(pool.reactor, pool.validityNow(), pool.operatorAuthor),
    (d) => !negated(d.id) && host.reactor.get(d.id) === undefined,
  );
}

export function readForeignRenderers(
  reactor: Reactor,
  now: number,
  operator: string | readonly string[],
): RendererBinding[] {
  const local = new Set(typeof operator === "string" ? [operator] : operator);
  const negated = new Map<string, (id: string) => boolean>();
  const survives = (d: Delta): boolean => {
    if (local.has(d.claims.author)) return false;
    let owned = negated.get(d.claims.author);
    if (owned === undefined) {
      owned = negatedAt(reactor, now, d.claims.author);
      negated.set(d.claims.author, owned);
    }
    return !owned(d.id);
  };
  return latestPerRoute(reactor.snapshot(), survives);
}

const keyOf = (bundle: string, budget: AdmissionBudget): string =>
  [
    esmAddress(bundle),
    budget.timeoutMs ?? "",
    budget.maxOldMb ?? "",
    budget.maxYoungMb ?? "",
    budget.spawnTimeoutMs ?? "",
  ].join("|");

export type AdmissionBudget = RenderWorkerOptions & { readonly timeoutMs?: number };

const admitted = new Set<string>();
const refused = new Map<string, { why: string; until?: number }>();
const memoOf = (key: string): string | undefined => {
  const held = refused.get(key);
  if (held === undefined) return undefined;
  if (held.until !== undefined && Date.now() >= held.until) {
    refused.delete(key);
    return undefined;
  }
  return held.why;
};

const inFlight = new Map<string, Promise<Admission>>();

const MAX_CONCURRENT_ADMISSIONS = 4;
let admitting = 0;
const waiting: Array<() => void> = [];
const takeSlot = async (): Promise<void> => {
  if (admitting < MAX_CONCURRENT_ADMISSIONS) {
    admitting += 1;
    return;
  }
  await new Promise<void>((release) => waiting.push(release));
  admitting += 1;
};
const dropSlot = (): void => {
  admitting -= 1;
  waiting.shift()?.();
};

async function attempt(bundle: string, budget: AdmissionBudget): Promise<Admission> {
  const key = keyOf(bundle, budget);
  if (admitted.has(key)) return { ok: true, settled: true };
  const held = inFlight.get(key);
  if (held !== undefined) return held;
  const { timeoutMs, ...limits } = budget;
  const flight = (async () => {
    await takeSlot();
    try {
      const verdict = await admitInWorker(bundle, timeoutMs, limits);
      if (verdict.ok) {
        admitted.add(key);
        refused.delete(key);
      } else if (verdict.settled) {
        refused.set(key, {
          why: verdict.why ?? "it did not evaluate",
          ...(verdict.memoMs === undefined ? {} : { until: Date.now() + verdict.memoMs }),
        });
      }
      return verdict;
    } finally {
      dropSlot();
    }
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, flight);
  return flight;
}

export async function admitRenderer(bundle: string, budget: AdmissionBudget = {}): Promise<void> {
  const verdict = await attempt(bundle, budget);
  if (!verdict.ok) {
    throw new Error(`renderer: the bundle did not load — ${verdict.why ?? "it did not evaluate"}`);
  }
}

export async function admitRenderers(
  bundles: ReadonlyArray<string>,
  budget: AdmissionBudget = {},
): Promise<Array<{ bundle: string; why: string; fresh: boolean }>> {
  const seen = [...new Set(bundles)];
  const out: Array<{ bundle: string; why: string; fresh: boolean }> = [];
  await Promise.all(
    seen.map(async (bundle) => {
      const key = keyOf(bundle, budget);
      if (admitted.has(key)) return;
      const memo = memoOf(key);
      if (memo !== undefined) {
        out.push({ bundle, why: memo, fresh: false });
        return;
      }
      const verdict = await attempt(bundle, budget).catch(() => ({
        ok: false,
        settled: false,
        why: "the confined thread did not answer",
      }));
      if (!verdict.ok) out.push({ bundle, why: verdict.why ?? "it did not evaluate", fresh: true });
    }),
  );
  return out;
}

export const rendererAdmitted = (bundle: string, budget: AdmissionBudget = {}): boolean =>
  admitted.has(keyOf(bundle, budget));

const DEFAULT_MAX_PUBLIC_RENDERS = 16;

export interface RendererInternals {
  readonly timestamp?: number;
  readonly negates?: readonly string[];
}

export async function publishRendererImpl(
  gw: Gateway,
  input: unknown,
  context?: RequestContext,
  internals?: RendererInternals,
): Promise<void> {
  const signer = context?.actor !== undefined ? seedSigner(context.actor) : gw.signer;
  if (signer === undefined) {
    throw new Error("this gateway holds no signing seed and cannot publish a renderer");
  }
  if (gw.operatorAuthor !== undefined && signer.author !== gw.operatorAuthor) {
    throw new Error("append rejected: only the operator may publish a renderer");
  }
  const spec = parseRendererInput(input);
  const bound = byLens(gw.registered, spec.schemaName);
  if (bound === undefined) {
    throw new Error(
      `renderer: no registered schema "${spec.schemaName}" — a renderer reads a lens the store serves`,
    );
  }
  let versionId: string | undefined;
  let coverage = bound.schema;
  if (spec.version !== undefined) {
    const versions = gw.registrationVersions().filter((v) => lensOf(v) === spec.schemaName);
    const pinned = versions[spec.version - 1];
    if (pinned === undefined) {
      throw new Error(
        `renderer: schema "${spec.schemaName}" has no version v${spec.version} (it has ${versions.length})`,
      );
    }
    versionId = pinned.deltaId;
    coverage = pinned.schema;
  }
  for (const field of spec.consumes) {
    if (!coverage.props.has(field)) {
      throw new Error(
        `renderer: consumes "${field}", but ${
          spec.version === undefined ? "the latest" : `v${spec.version} of`
        } schema "${spec.schemaName}" has no such field`,
      );
    }
  }
  await admitRenderer(spec.bundle, rendererAdmissionBudget(gw));
  const author = signer.author;
  const binding =
    internals?.timestamp === undefined
      ? withStamp(gw.stamp(author), (t) => rendererBindingClaims(spec, versionId, author, t))
      : rendererBindingClaims(spec, versionId, author, internals.timestamp);
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
  await gw.append([signer.sign(filed)]);
}

function channelApp(
  gw: Gateway,
  route: string,
  door: "full" | "public",
): { pool: Peer; route: string } | undefined {
  if (door !== "full" || gw.store.channels(gw).size === 0) return undefined;
  if (!route.includes(":")) return undefined;
  let owner: { name: string; prefix: string } | undefined;
  for (const c of gw.channelStatus()) {
    if (c.prefix === "" || !route.startsWith(`${c.prefix}:`)) continue;
    if (route.length <= c.prefix.length + 1) continue;
    if (owner === undefined || c.prefix.length > owner.prefix.length) {
      owner = { name: c.name, prefix: c.prefix };
    }
  }
  if (owner === undefined) return undefined;
  const bare = route.slice(owner.prefix.length + 1);
  const pool = gw.store.channels(gw).get(owner.name)?.gateway;
  if (pool?.operatorAuthor === undefined) return undefined;
  const binding = pool.renderers().find((r) => r.route === bare);
  if (binding === undefined || gw.reactor.get(binding.deltaId) !== undefined) return undefined;
  return { pool, route: bare };
}

export function rendererAdmissionBudget(gw: Gateway): RenderWorkerOptions & { timeoutMs?: number } {
  const envelope = gw.envelope;
  if (envelope === undefined) return {};
  const limits = envelope.resolve();
  return { timeoutMs: limits.renderTimeoutMs, ...workerLimitsOf(limits) };
}

export async function prepareRouteImpl(
  gw: Gateway,
  route: string,
  door: "full" | "public" = "full",
): Promise<void> {
  const binding = gw.renderers().find((r) => r.route === route);
  if (binding !== undefined) {
    if (routeServableOn(gw, binding, door)) {
      await prepareRendererInContext(binding, createRootRendererContext(gw, door, Date.now));
    }
    return;
  }
  const app = channelApp(gw, route, door);
  if (app !== undefined) await app.pool.prepareRoute(app.route, door);
}

function contextAllows(context: RendererContext, binding: RendererBinding, asOf?: number): boolean {
  if (!rendererContextStands(context)) return false;
  return (
    context.kind === "root" ||
    (binding.pen === undefined &&
      binding.writable === undefined &&
      binding.versionId === undefined &&
      asOf === undefined)
  );
}

export async function prepareRendererInContext(
  binding: RendererBinding,
  context: RendererContext,
): Promise<void> {
  if (!contextAllows(context, binding)) throw rendererContextRefusal();
  const now = context.now();
  if (!Number.isFinite(now)) throw rendererContextRefusal();
  const servable =
    context.kind === "root"
      ? routeServableOn(context.execution, binding, context.door)
      : context.authority
          .boundSurface(context.binding)
          .registered.some((r) => lensOf(r) === binding.schemaName);
  if (!servable) throw rendererContextRefusal();
  const refusals = await admitRenderers(
    [binding.bundle],
    rendererAdmissionBudget(context.execution),
  );
  if (!contextAllows(context, binding)) throw rendererContextRefusal();
  for (const r of refusals) if (r.fresh) reportUnmounted([binding], r.bundle, r.why);
}

export function reportUnmounted(
  bindings: readonly RendererBinding[],
  bundle: string,
  why: string,
): void {
  const write = globalThis.process?.stderr?.write?.bind(globalThis.process.stderr);
  if (write === undefined) return;
  const routes = bindings
    .filter((r) => r.bundle === bundle)
    .map((r) => `"${plainText(r.route, 80)}"`)
    .join(", ");
  write(`loam: the renderer at ${routes} is unmounted — ${plainText(why)}\n`);
}

export async function serveRouteImpl(
  gw: Gateway,
  route: string,
  entity: string,
  door: "full" | "public",
  gesture?: { readonly reads: readonly ReadGesture[]; readonly state: Record<string, string> },
  asOf?: number,
): Promise<{ status: number; contentType: string; body: string }> {
  const gone = { status: 404, contentType: "text/plain; charset=utf-8", body: "no such route" };
  const binding = gw.renderers().find((r) => r.route === route);
  if (binding === undefined) {
    const app = channelApp(gw, route, door);
    return app === undefined ? gone : app.pool.serveRoute(app.route, entity, door, gesture, asOf);
  }
  return renderRendererInContext(binding, entity, createRootRendererContext(gw, door, Date.now), {
    ...(gesture === undefined ? {} : { gesture }),
    ...(asOf === undefined ? {} : { asOf }),
  });
}

export async function renderRendererInContext(
  binding: RendererBinding,
  entity: string,
  context: RendererContext,
  options?: {
    readonly gesture?: {
      readonly reads: readonly ReadGesture[];
      readonly state: Record<string, string>;
    };
    readonly asOf?: number;
  },
): Promise<{ status: number; contentType: string; body: string }> {
  const gone = { status: 404, contentType: "text/plain; charset=utf-8", body: "no such route" };
  if (!contextAllows(context, binding, options?.asOf)) return gone;
  const now = context.now();
  if (!Number.isFinite(now)) return gone;
  const gw = context.execution;
  const door = context.door;
  const { gesture, asOf } = options ?? {};
  let node: ResolvedNode;
  try {
    if (context.kind === "bound") {
      const surface = context.authority.boundSurface(context.binding);
      if (!surface.registered.some((r) => lensOf(r) === binding.schemaName)) return gone;
      node = context.authority.resolvedNode(
        binding.schemaName,
        entity,
        undefined,
        now,
        context.binding,
      );
    } else if (binding.versionId === undefined) {
      const surface = gw.surface(door);
      if (
        surface === undefined ||
        !surface.registered.some((r) => lensOf(r) === binding.schemaName)
      ) {
        return gone;
      }
      node = gw.resolvedNode(binding.schemaName, entity, asOf, now);
    } else {
      if (door === "public" && !gw.isPublicPin(binding.schemaName, binding.versionId)) return gone;
      const pinned = gw
        .registrationVersions()
        .find((v) => v.deltaId === binding.versionId && lensOf(v) === binding.schemaName);
      if (pinned === undefined) return gone;
      node = gw.resolvePinned(pinned, entity, asOf, now);
    }
  } catch (err) {
    if (context.kind === "bound") return gone;
    if (door === "public") return { ...gone, status: 400, body: "the route could not be rendered" };
    return {
      status: 400,
      contentType: "text/plain; charset=utf-8",
      body: err instanceof Error ? err.message : String(err),
    };
  }
  const framed = (r: { status: number; contentType: string; body: string }) => {
    if (!contextAllows(context, binding, asOf)) return gone;
    if (r.status !== 200 || !r.contentType.startsWith("text/html")) return r;
    let body = frameAsOf(r.body, node);
    const p = gw.probation;
    if (p !== undefined) body = frameProbation(body, p, door);
    return body === r.body ? r : { ...r, body };
  };
  if (!rendererAdmitted(binding.bundle, rendererAdmissionBudget(gw))) return gone;
  const reads: Record<string, ReadResult> = {};
  const state: Record<string, string> = door === "public" ? {} : (gesture?.state ?? {});
  if (door === "full") {
    try {
      for (const g of gesture?.reads ?? []) {
        const result = resolveGesture(context, g, now, asOf);
        if (context.kind === "bound" && "error" in result && result.error.code === "refused") {
          return gone;
        }
        reads[readKey(g.lens, g.entity)] = result;
      }
    } catch (err) {
      if (context.kind === "bound") return gone;
      throw err;
    }
  }
  const payload = (): Record<string, unknown> => ({
    entity,
    view: bytesEnvelope(node.view),
    hex: node.hex,
    reads,
    state,
  });
  const envelope = gw.envelope;
  if (envelope !== undefined) {
    const limits = envelope.resolve();
    if (envelope.inFlight >= limits.maxConcurrentRenders) {
      envelope.refusedForSlots += 1;
      return {
        status: 503,
        contentType: "text/plain; charset=utf-8",
        body: "the renderer is busy",
      };
    }
    envelope.inFlight += 1;
    try {
      return framed(
        await renderInWorker(binding.bundle, payload(), limits.renderTimeoutMs, {
          ...workerLimitsOf(limits),
          spawnTimeoutMs: limits.renderTimeoutMs,
          onOutcome: (outcome) => {
            if (outcome === "timeout") envelope.timedOut += 1;
            else if (outcome === "fault") envelope.faulted += 1;
            else if (outcome === "notHtml") envelope.malformed += 1;
          },
        }),
      );
    } finally {
      envelope.inFlight -= 1;
    }
  }
  if (door === "public") {
    const cap = gw.options.maxPublicRenders ?? DEFAULT_MAX_PUBLIC_RENDERS;
    if (gw.publicRendersInFlight >= cap) {
      return {
        status: 503,
        contentType: "text/plain; charset=utf-8",
        body: "the renderer is busy",
      };
    }
    gw.publicRendersInFlight += 1;
    try {
      return framed(
        await renderInWorker(binding.bundle, payload(), gw.options.renderTimeoutMs, {
          spawnTimeoutMs: gw.options.renderSpawnTimeoutMs,
        }),
      );
    } finally {
      gw.publicRendersInFlight -= 1;
    }
  }
  return framed(
    await renderInWorker(binding.bundle, payload(), gw.options.renderTimeoutMs, {
      spawnTimeoutMs: gw.options.renderSpawnTimeoutMs,
    }),
  );
}

function resolveGesture(
  context: RendererContext,
  g: ReadGesture,
  now: number,
  asOf?: number,
): ReadResult {
  const gw = context.kind === "bound" ? context.authority : context.execution;
  const bound = context.kind === "bound" ? context.binding : undefined;
  const surface = bound === undefined ? gw.surface("full") : gw.boundSurface(bound);
  const lens = g.lens as LensName;
  if (surface === undefined || !surface.registered.some((r) => lensOf(r) === lens)) {
    return {
      error: { code: "not_served", message: `this store does not serve the lens "${g.lens}"` },
    };
  }
  try {
    const node = gw.resolvedNode(lens, g.entity, asOf, now, bound);
    return {
      entity: g.entity,
      view: bytesEnvelope(node.view) as Record<string, unknown>,
      hex: node.hex,
    };
  } catch (err) {
    return {
      error: { code: "refused", message: err instanceof Error ? err.message : String(err) },
    };
  }
}

export function routeServableOn(
  gw: Peer,
  binding: RendererBinding,
  door: "full" | "public",
): boolean {
  if (binding.versionId === undefined) {
    const surface = gw.surface(door);
    return (
      surface !== undefined && surface.registered.some((r) => lensOf(r) === binding.schemaName)
    );
  }
  if (door === "public") return gw.isPublicPin(binding.schemaName, binding.versionId);
  return gw
    .registrationVersions()
    .some((v) => v.deltaId === binding.versionId && lensOf(v) === binding.schemaName);
}

function rootAuthorityOf(gw: Gateway): Peer | undefined {
  const root = gw.store.authorityOf(gw);
  return root !== undefined && root.probation === undefined ? root : undefined;
}

export async function writeRouteImpl(
  gw: Gateway,
  route: string,
  entity: string,
  fields: Record<string, Primitive>,
  door: "full" | "public",
): Promise<{ status: number; contentType: string; body: string }> {
  const text = "text/plain; charset=utf-8";
  const gone = { status: 404, contentType: text, body: "no such route" };
  const binding = gw.renderers().find((r) => r.route === route);
  if (binding === undefined) {
    const app = channelApp(gw, route, door);
    return app === undefined ? gone : app.pool.writeRoute(app.route, entity, fields, door);
  }
  if (!routeServableOn(gw, binding, door)) return gone;
  const authority = gw.probation === undefined ? undefined : rootAuthorityOf(gw);
  if (gw.probation !== undefined && door === "public") {
    if (authority === undefined || !routeServableOn(authority, binding, "public")) return gone;
  }
  if (
    binding.pen === undefined ||
    binding.writable === undefined ||
    binding.writable.length === 0
  ) {
    return { status: 405, contentType: text, body: "this route is read-only" };
  }
  const posted = Object.keys(fields);
  if (posted.length === 0)
    return { status: 400, contentType: text, body: "the form wrote no fields" };
  for (const f of posted) {
    if (!binding.writable.includes(f)) {
      return {
        status: 400,
        contentType: text,
        body: `field "${f}" is not writable by this renderer`,
      };
    }
  }
  const penSeed = gw.options.pens?.[binding.pen];
  if (penSeed === undefined) {
    if (door === "public") {
      return { status: 403, contentType: text, body: "the write was refused" };
    }
    return {
      status: 403,
      contentType: text,
      body:
        `this renderer's pen ("${binding.pen}") is not provisioned — no seed was supplied for it, ` +
        `so the store has nothing to sign this write with. A CLI-served store provisions a pen ` +
        `from a pen.${binding.pen}.seed file in its home: \`loam pen create ${binding.pen}\` mints ` +
        `the seed and grants the pen write standing, and the next \`loam serve\` reads it. An ` +
        `embedding provisions it in GatewayOptions.pens.`,
    };
  }
  if (gw.probation !== undefined) {
    if (authority === undefined) {
      return {
        status: 403,
        contentType: text,
        body: "this pool is not attached to a store that can answer for its pen",
      };
    }
    if (
      !holdsGrant(
        authority.reactor,
        authority.validityNow(),
        STORE_ENTITY,
        authorForSeed(penSeed),
        "write",
        authority.operatorAuthor,
      )
    ) {
      return {
        status: 403,
        contentType: text,
        body: "this renderer's pen holds no write grant in the store this pool reads",
      };
    }
  }
  try {
    await gw.mutateEntity(binding.schemaName, entity, fields, penSeed);
  } catch (err) {
    if (door === "public") return { status: 403, contentType: text, body: "the write was refused" };
    return {
      status: 403,
      contentType: text,
      body: err instanceof Error ? err.message : String(err),
    };
  }
  return gw.serveRoute(route, entity, door);
}

export function serveBytesImpl(
  gw: Gateway,
  ref: string,
  fromLens: LensName,
  fromEntity: string,
  door: "full" | "public",
): { status: number; contentType: string; body: Uint8Array } {
  const gone = {
    status: 404,
    contentType: "text/plain; charset=utf-8",
    body: new TextEncoder().encode("no such bytes"),
  };
  const surface = gw.surface(door);
  if (surface === undefined || !surface.registered.some((r) => lensOf(r) === fromLens)) {
    return gone;
  }
  let node: ResolvedNode;
  try {
    node = surface.hooks.resolve(fromLens, fromEntity);
  } catch {
    return gone;
  }
  const found = findBytesByRef(node.view, ref);
  if (found === undefined) return gone;
  return { status: 200, contentType: found.mime, body: found.value };
}
