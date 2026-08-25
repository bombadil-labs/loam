// SPEC §23 renderers, v1. A renderer is a surface whose door is PIXELS — a UI unit pushed as deltas,
// bound to a Schema and a route, served by a host that hands it a resolved View and nothing else. This
// module is the read side of §17 arriving at the screen: a renderer BINDING is the twin of a registration
// binding (§21) — it names a route, the schema it reads, the version it pins, the fields it consumes, and
// the runnable bundle — and `readRenderers` derives the served set exactly as `readRegistrations` derives
// the surface. v1 is a HEADLESS host: the bundle is `export default (node) => html`, executed server-side,
// so a GET returns HTML rendered from the store's live view. The live browser React host, write-enabled
// renderers, the ocap sandbox, binary assets, and name@hash schema-snapshot pinning are later slices
// (spec/23 §23.11) — v1 pins a schema by its §17 version (vN), which already freezes the reading,
// resolvers included (§22), so the resolver-in-snapshot fold defers cleanly until a renderer pins by
// schema content-hash.
//
// A renderer at rest is directly-runnable ESM (§22.3 snapshot doctrine): the signature attests exactly
// what mounts — one hash, no signed-vs-executed gap. It no longer rides a resolver's in-process floor
// (T172): a renderer bundle NEVER evaluates on this thread. Both of its call classes — the render, and
// the MODULE BODY that runs at publish, bind and bless — evaluate inside `render-worker.ts`'s confined
// realm, which has no filesystem, no network and no process authority. What this module holds is a set
// of ADMITTED content addresses; what it hands a door is HTML or a refusal.

import { authorForSeed, signClaims, type Primitive } from "@bombadil/rhizomatic";
import type { Claims, Delta, Reactor } from "@bombadil/rhizomatic";
import { bytesEnvelope, findBytesByRef } from "./bytes.js";
import { esmAddress } from "./esm.js";
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
import { lawfulNegated, lawfulSnapshot, lensOf, type LensName } from "./registration.js";

export const CTX_RENDERER = "loam.renderer";

// A pen's PUBLIC half, on the ground (SPEC §23.3, T102). The seed itself never lands — custody is
// the filesystem — but WHICH AUTHOR a named pen signs as is not a secret, and without it a pen's
// standing outlives every trace of the pen it belonged to. That is the re-keying hole: an operator
// whose seed leaked deletes the file and mints a new one, and the leaked key keeps full write
// standing under an author derivable only from the file they were told to delete. This record is
// how a later `loam pen create` NAMES the key it replaces, which is what lets it strike it.
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

// What a route + schema + UI share, at input and at rest.
interface RendererCore {
  readonly route: string;
  readonly schemaName: LensName;
  readonly consumes: readonly string[];
  readonly bundle: string;
  // Write-enabled renderers (SPEC §23.3). `writable` is the fields this renderer's forms may write — a
  // door-level narrowing atop the registration's own writable (§14/§21); `pen` is the granted-author
  // identity the server signs form-submits AS (never the caller's token). Both absent → READ-ONLY (v1's
  // default); both-or-neither is enforced at parse (a writing renderer needs a pen; a pen needs fields).
  readonly writable?: readonly string[];
  readonly pen?: string;
}

// A renderer, as PUSHED. `route` is the path it claims (`/:mount/app/<route>/<entity>`); `schemaName` the
// lens it reads; `version` an optional §17 vN the author names for convenience; `consumes` the fields it
// reads (checked at push against the PINNED version's schema so it never references what the lens cannot
// fill, §23.4); `bundle` the runnable ESM (`export default (node) => html`). Inline for v1.
export interface RendererSpec extends RendererCore {
  readonly version?: number;
}

// A surviving renderer binding, as the host receives it. The version is FROZEN to the registration
// version's content address (`versionId`, the version's TRUE NAME, §17) — NOT the numeric vN alias,
// which shifts when an earlier version is withdrawn. So a pin resolves the exact frozen reading forever,
// and if that version is later struck the renderer goes dark (§23.6), rather than silently sliding to a
// different version. `deltaId` is the binding's own true name; `timestamp` its ground order.
export interface RendererBinding extends RendererCore {
  readonly versionId?: string;
  readonly deltaId: string;
  readonly timestamp: number;
}

// The floor's refusal vocabulary (SPEC §30). HOST-NEUTRAL by construction: the artifact broker's own
// codes (`needs_reauth`, `server_not_connected`, …) exist only where a broker does, and the
// server-rendered host resolving a `?read=` in-process has none — so a bundle branching on one would
// behave differently on the two hosts behind a single content address. Each host maps its own failures
// onto these four at its own seam, and a renderer only ever sees these.
export type ReadCode = "not_served" | "refused" | "unavailable" | "needs_connection";

// One mediated read's answer: the same shape the root node has, or a refusal. Absence is NOT a refusal —
// a read at an entity the store has nothing for is a success carrying an empty view, and only the app
// knows what its own emptiness should look like.
export type ReadResult =
  | { readonly entity: string; readonly view: Record<string, unknown>; readonly hex: string }
  | { readonly error: { readonly code: ReadCode; readonly message: string } };

// What the host hands a renderer: the resolved node, and nothing else (§23.2 — a renderer speaks lens, the
// host holds the keys). A bytes leaf is handed over as the §23.7 envelope { mime, ref, base64url? } — the
// same face gql/REST show — so a renderer builds `<img src>` from `ref` (the byte-door) or the inline
// `base64url`, never juggling raw Uint8Arrays; every non-bytes value passes through unchanged.
//
// `reads` and `state` are the mediated request channel's two members (SPEC §30). Both are ALWAYS PRESENT
// and ALWAYS OBJECTS — empty until a gesture is honored — because an optional member is a divergence
// behind one content address: a bundle that draws it would throw on the host where it is absent. `reads`
// is keyed `<lens>@<entity>`; `state` is the gesture's own `data-loam-*` attributes echoed verbatim, and
// it exists because a per-render realm gives UI state (a page index) nowhere else to live.
export interface RenderNode {
  readonly entity: string;
  readonly view: Record<string, unknown>;
  readonly hex: string;
  readonly reads: Record<string, ReadResult>;
  readonly state: Record<string, string>;
}

// A read gesture as a host receives it, before it is resolved: the lens and the entity, and nothing
// else — which is all Loam's entity-addressed read root has to offer. The key it lands under.
export interface ReadGesture {
  readonly lens: string;
  readonly entity: string;
}

export const readKey = (lens: string, entity: string): string => `${lens}@${entity}`;

// A gesture as it rides a URL: `read=<lens>:<entity>`, split on the FIRST colon so an entity id may
// carry its own. Undefined for a malformed pair — a gesture that names no lens or no entity is not a
// narrower read, it is nothing, and it is dropped rather than resolved as a guess.
export function parseReadGesture(raw: string): ReadGesture | undefined {
  const i = raw.indexOf(":");
  if (i <= 0 || i >= raw.length - 1) return undefined;
  return { lens: raw.slice(0, i), entity: raw.slice(i + 1) };
}

// A v1 renderer: a resolved node in, HTML out. Pure and synchronous (server-rendered). A React renderer
// bundles its own React and returns `renderToString(...)`; the host is framework-agnostic and just calls
// the default export — for all a renderer knows it is a component against a bundled service (§23.2).
export type RenderFn = (node: RenderNode) => string;

const primitive = (claims: Claims, role: string): string | number | boolean | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};

// The at-rest entity a renderer binding files under — `renderer:<route>`, in the constitutional renderer
// context. One binding per route, latest wins (the same latest-per-key law registrations run). The route
// is the identity: re-pushing at the same route evolves it; a different route is a different face.
const rendererEntity = (route: string): string => `renderer:${route}`;

// Parse and validate a renderer input into a RendererSpec. Throws a plain-English reason — the door
// renders it (a 400 / CLI exit / MCP error), so the surfaces never drift on what a renderer looks like.
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
  // A route names a path segment, not a tree — it may not carry the router's own separators, so a
  // renderer can never claim a route it does not spell exactly (no `/`, no NUL).
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
  // Write-enabling (SPEC §23.3): `writable` is the form's field allow-list, `pen` the granted-author it
  // writes as. Both or neither — a writing renderer with no pen could not sign, a pen with no writable
  // could write nothing; absent both, the renderer stays read-only (v1's default).
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
    // Parse boundary: validated a non-empty string above, now blessed as a lens name (§21.7 keys
    // renderers on the lens). The one legitimate crossing — untrusted input entering the typed zone.
    schemaName: schemaName as LensName,
    ...(o.version === undefined ? {} : { version: o.version }),
    consumes: o.consumes as string[],
    bundle: o.bundle,
    ...(o.writable === undefined ? {} : { writable: o.writable as string[] }),
    ...(o.pen === undefined ? {} : { pen: o.pen }),
  };
}

// Serialize a renderer binding's claims: the `renders` key (files under `renderer:<route>`), the route /
// schema / consumes / bundle, and — for a pinned renderer — the version's CONTENT ADDRESS (`versionId`,
// its §17 true name, resolved from the author's vN at publish). No definitions travel here — a renderer
// binding NAMES a schema and carries its own UI, exactly as a registration binding names entities (§21).
export function rendererBindingClaims(
  core: RendererCore,
  versionId: string | undefined,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
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
      // Write-enabling (SPEC §23.3), present only for a writing renderer. The pen NAME rides at rest (the
      // SEED is custody, held in config — never on the ground); revocation is striking its grant, not this.
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

// Every SURVIVING renderer binding, the latest per route (SPEC §23.5 — latest-per-route wins, like the
// latest registration per schema entity). Lawful slice only: in a governed store a foreign renderer
// merges as data and mounts nothing (§8/§12 inert-by-default). A binding missing route/schema/bundle
// binds nothing — unmounted, never a crash.
export function readRenderers(reactor: Reactor, operator?: string): RendererBinding[] {
  const negated = lawfulNegated(reactor, operator);
  return latestPerRoute(lawfulSnapshot(reactor, operator), (d) => !negated(d.id));
}

/**
 * ONE renderer binding, parsed from its delta — or undefined when the delta is not one, or is
 * malformed (a binding missing route/schema/bundle binds nothing: unmounted, never a crash).
 *
 * Extracted so every reader of renderer law parses it the same way. Two parsers would drift, and the
 * drift would land on which bundle a caller believes is bound.
 */
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
  // Write-enabling (SPEC §23.3): read the form allow-list and the pen name. A binding with one but not
  // the other is malformed and stays READ-ONLY (both dropped) — the parse gate keeps them paired, and a
  // reader never trusts a half-written binding to sign.
  const writable = jsonList("writable");
  const penRaw = primitive(delta.claims, "pen");
  const pen = typeof penRaw === "string" && penRaw !== "" ? penRaw : undefined;
  const writeReady = writable !== undefined && writable.length > 0 && pen !== undefined;
  return {
    route,
    // Parse boundary: reconstructed from a lawful delta, validated string above (see the guard).
    schemaName: schemaName as LensName,
    ...(versionId === undefined ? {} : { versionId }),
    consumes: jsonList("consumes") ?? [],
    bundle,
    ...(writeReady ? { writable, pen } : {}),
    deltaId: delta.id,
    timestamp: delta.claims.timestamp,
  };
}

/** Latest per route, over whatever deltas the caller hands in, keeping only those that survive. */
function latestPerRoute(
  deltas: Iterable<Delta>,
  survives: (d: Delta) => boolean,
): RendererBinding[] {
  const latest = new Map<string, RendererBinding>();
  for (const delta of deltas) {
    if (!survives(delta)) continue;
    const binding = rendererBindingOf(delta);
    if (binding === undefined) continue;
    // Latest per route: (timestamp, id) ascending, the same tie-break every latest-wins reader uses.
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

/**
 * The renderer bindings a POOL holds OF ITS OWN — operator-authored, and absent from the host's
 * ground (SPEC §24.6).
 *
 * A pool is one-way seeded with the host's whole ground and the edge re-pulses on every attach, so
 * every renderer the host owns has an operator-signed twin in here, minted fresh each reseed.
 * Custody is what tells them apart: a blessing is published on the pool's gateway and never travels
 * back, so its binding is absent from the host's ground while a twin is present by construction.
 *
 * LATEST-PER-ROUTE IS TAKEN AMONG THE POOL'S OWN, deliberately. Filtering `readRenderers`
 * afterwards would ask a different question — "is the pool's WINNER at this route ours?" — and
 * answer "no app here" for a route where a re-seeded twin merely out-timestamped a standing
 * blessing. That difference is exactly a mounted-but-shadowed app, and a caller that cannot see it
 * cannot say so.
 */
export function readPoolRenderers(pool: Gateway, host: Gateway): RendererBinding[] {
  // No operator is no answer, not every answer: unscoped, `lawfulSnapshot` returns the whole pool
  // and a peer's own binding would count as something this store had mounted.
  if (pool.operatorAuthor === undefined) return [];
  const negated = lawfulNegated(pool.reactor, pool.operatorAuthor);
  return latestPerRoute(
    lawfulSnapshot(pool.reactor, pool.operatorAuthor),
    (d) => !negated(d.id) && host.reactor.get(d.id) === undefined,
  );
}

/**
 * Every surviving renderer binding NOT authored by `operator`, latest per route — the arrivals a
 * channel pool holds (SPEC §24.6).
 *
 * ONE PASS, and that is the point (H8). Asking `readRenderers` once per author would re-materialize
 * the whole pool per author, and the author set is PEER-CONTROLLED: a renderer binding under a fresh
 * keypair costs a peer nothing, and this runs on every sync and every listing. `lawfulNegated` reads
 * the substrate's own negation index rather than the ground, so per-author survival stays cheap.
 *
 * Survival is scoped to each binding's OWN author — a shipper takes back their own word and nobody
 * takes it back for them, the same algebra the blessing door keeps over a module's members.
 */
export function readForeignRenderers(reactor: Reactor, operator: string): RendererBinding[] {
  const negated = new Map<string, (id: string) => boolean>();
  const survives = (d: Delta): boolean => {
    if (d.claims.author === operator) return false;
    let owned = negated.get(d.claims.author);
    if (owned === undefined) {
      owned = lawfulNegated(reactor, d.claims.author);
      negated.set(d.claims.author, owned);
    }
    return !owned(d.id);
  };
  return latestPerRoute(reactor.snapshot(), survives);
}

// ADMISSION, not loading — and the difference is the whole of T172. This used to import the bundle
// through the shared ESM loader, which EVALUATED A STRANGER'S MODULE BODY ON THE SERVING THREAD with
// the server's own authority, at publish, at bind, and (since the bless path) on every federation poll.
// Admission asks the same question — does this bundle `export default` a function? — inside the same
// confined realm the render will meet (§23.9, `render-worker.ts`). What crosses back is a boolean and,
// on refusal, a reason; no namespace and no callable ever reaches this thread.
//
// So the process holds CONTENT ADDRESSES, not code. That is also why erasure reaches further here than
// it does for a §22 resolver: a hash of forgotten bytes is not the forgotten bytes, and a renderer
// admitted before an erasure keeps nothing executable behind (`esm.ts` states the resolver half, which
// is unchanged).
// THE KEY IS THE SOURCE AND THE BUDGET, NOT THE SOURCE ALONE. Admissibility looks like a property of
// the bytes, and it is not: a module body that finishes inside the primary's 5s clock and blows a
// pool's declared 500ms is admissible under one bill and not the other. Keying by content address
// alone would let a verdict earned on the primary satisfy a quarantine that declared a tighter
// ceiling — §24.5's one undelegatable power, waved through by a cache. So the ceilings ride the key,
// and a pool asks its own question.
//
// The maps span the PROCESS, which is the same reach the ESM cache they replace always had. That is
// safe now precisely because the budget is in the key: what is shared is "these bytes, under this
// bill", and two gateways sharing an entry agree on both halves of it.
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
// REFUSALS ARE REMEMBERED TOO, and this is a bound rather than an optimisation. `prepareRoute` runs on
// EVERY request for a route, ahead of the anonymous fan cap and ahead of a pool's slot count — so a
// binding that arrived past the publish door with an unadmittable body would buy one confined worker
// and its whole admit budget per GET, at unbounded concurrency. Measured before this map existed: six
// concurrent requests behind a fan cap of one spawned six workers and burned five CPU-seconds each.
// Only a SETTLED verdict lands here (`Admission.settled`): a host that could not start a thread is the
// moment, not the bundle, and caching it would darken a route until the process restarts.
const refused = new Map<string, string>();
// One flight per key. Two requests arriving together for the same un-admitted bundle must share a
// worker, not race to spawn two — the memo above only helps the SECOND request if there was a first.
const inFlight = new Map<string, Promise<Admission>>();

async function attempt(bundle: string, budget: AdmissionBudget): Promise<Admission> {
  const key = keyOf(bundle, budget);
  if (admitted.has(key)) return { ok: true, settled: true };
  const held = inFlight.get(key);
  if (held !== undefined) return held;
  const { timeoutMs, ...limits } = budget;
  const flight = admitInWorker(bundle, timeoutMs, limits)
    .then((verdict) => {
      if (verdict.ok) admitted.add(key);
      else if (verdict.settled) refused.set(key, verdict.why ?? "it did not evaluate");
      return verdict;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, flight);
  return flight;
}

// Admit ONE bundle, LOUDLY. The publish door's "proven at push, not hoped at runtime" (§23.4) — the
// reason names what the realm refused, because the reader is the operator publishing it.
//
// It does NOT consult the refusal memo. Publishing is an operator's deliberate act, it is rare, and an
// operator who republishes the same bytes is entitled to a fresh attempt rather than an answer from
// the last one. The memo exists to bound the per-REQUEST path, and only that path reads it.
export async function admitRenderer(bundle: string, budget: AdmissionBudget = {}): Promise<void> {
  const verdict = await attempt(bundle, budget);
  if (!verdict.ok) {
    throw new Error(`renderer: the bundle did not load — ${verdict.why ?? "it did not evaluate"}`);
  }
}

// Admit a set, TOLERANTLY, and SAY WHAT WAS REFUSED. Bind and prepare-route run over whatever law is
// already on the ground, including law that arrived by federation past the publish door, so one
// unadmittable bundle must leave one route unmounted (a uniform 404, §23.5's own discipline) rather
// than fail the boot. The reason is RETURNED rather than swallowed: this is the path a stranger's
// bundle actually takes, and a route that goes dark with nobody able to say why is a swallowed error
// with extra steps (H9). The caller decides who hears it.
export async function admitRenderers(
  bundles: ReadonlyArray<string>,
  budget: AdmissionBudget = {},
): Promise<Array<{ bundle: string; why: string }>> {
  const seen = [...new Set(bundles)];
  const held = seen.map((b) => keyOf(b, budget));
  const out: Array<{ bundle: string; why: string }> = [];
  await Promise.all(
    seen.map(async (bundle, i) => {
      const memo = refused.get(held[i]!);
      if (memo !== undefined) {
        out.push({ bundle, why: memo });
        return;
      }
      const verdict = await attempt(bundle, budget).catch(() => ({
        ok: false,
        settled: false,
        why: "the confined thread did not answer",
      }));
      if (!verdict.ok) out.push({ bundle, why: verdict.why ?? "it did not evaluate" });
    }),
  );
  return out;
}

// Has this bundle been admitted UNDER THIS BILL (the synchronous serve-path lookup)? An un-admitted
// renderer is UNMOUNTED — a 404, never a 500 — which is exactly what `loadedRenderer` meant before it,
// and now answers without holding the code.
export const rendererAdmitted = (bundle: string, budget: AdmissionBudget = {}): boolean =>
  admitted.has(keyOf(bundle, budget));

// --- the Gateway's renderer-serving behaviors (ticket T19: the bodies live beside their vocabulary) ---
// The implementations behind `Gateway.publishRenderer` / `prepareRoute` / `serveRoute` / `writeRoute` /
// `serveBytes` — thin delegating methods on the class, bodies here where the binding vocabulary and the
// bundle cache already live. They reach the gateway only through its declared internals seam (the
// `@internal` members on the class — see the seam note in gateway.ts).

// Publish a renderer as data (the body of `Gateway.publishRenderer`, SPEC §23), so a UI route survives
// reopen with no code. PROVEN AT PUSH, not hoped at runtime (§23.4): the operator alone may publish (a
// governed store binds only operator law); the schema it reads must be REGISTERED and, if version-pinned,
// that version must EXIST; every field it declares consuming must be a property the schema names; and its
// bundle must LOAD to a function. Only then does the binding persist and the route go live.
const DEFAULT_MAX_PUBLIC_RENDERS = 16;

/**
 * The renderer door's internal seam (ticket T33), mirroring `PublishInternals`: a blessing reuses
 * THIS door — schema-must-be-registered, field coverage, the bundle must load — and needs only the
 * source's timestamp (so the blessed binding re-mints the source's id) and the incumbent it retires.
 */
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
  const seed = context?.actor ?? gw.options.seed;
  if (seed === undefined) {
    throw new Error("this gateway holds no signing seed and cannot publish a renderer");
  }
  if (gw.operatorAuthor !== undefined && authorForSeed(seed) !== gw.operatorAuthor) {
    throw new Error("append rejected: only the operator may publish a renderer");
  }
  const spec = parseRendererInput(input); // one shape for every door (HTTP / CLI / MCP / direct)
  // The schema must be registered — a renderer over a lens the store does not serve mounts nothing.
  const bound = gw.registered.find((r) => lensOf(r) === spec.schemaName);
  if (bound === undefined) {
    throw new Error(
      `renderer: no registered schema "${spec.schemaName}" — a renderer reads a lens the store serves`,
    );
  }
  // FREEZE the pin to the version's CONTENT ADDRESS, not the numeric vN (SPEC §17/§23.6): the author
  // names a vN for convenience, and we resolve it — at push — to that surviving registration version's
  // true name (its deltaId), which cannot slide when an earlier version is later withdrawn. The pinned
  // version's own schema is also what field-coverage is checked against, so the guarantee holds for the
  // reading the renderer will ACTUALLY resolve, not the latest.
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
  // Field coverage (§23.4): every consumed field must be one the PINNED reading names — refuse a
  // renderer that reads what its lens can never fill, at push, rather than painting undefined at serve.
  for (const field of spec.consumes) {
    if (!coverage.props.has(field)) {
      throw new Error(
        `renderer: consumes "${field}", but ${
          spec.version === undefined ? "the latest" : `v${spec.version} of`
        } schema "${spec.schemaName}" has no such field`,
      );
    }
  }
  // The bundle must be ADMISSIBLE now (loud here, never a serve-time surprise): its module body has to
  // evaluate to a default function inside the confined realm. A bundle that reaches for the filesystem
  // or the network at import is refused HERE, with the reason, and nothing is appended.
  await admitRenderer(spec.bundle, rendererAdmissionBudget(gw));
  const author = authorForSeed(seed);
  const binding = rendererBindingClaims(
    spec,
    versionId,
    author,
    internals?.timestamp ?? gw.nextTimestamp(),
  );
  // Taking a ROUTE the same way a blessing takes a schema name (§23.5 is latest-per-route, so the
  // route is a living name too): the negation rides the binding, so striking the binding resurfaces
  // whoever held the route before it.
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
  await gw.append([signClaims(filed, seed)]);
}

/**
 * A CHANNEL'S APP SERVES UNDER THE CHANNEL'S PREFIX (SPEC §46.2), and it serves FROM THE POOL.
 *
 * The receiver names a peer's app exactly as it names a peer's lens — `alice:hello`, because the
 * receiver called the channel `alice`. What it must NOT do is fold the peer's binding into this
 * store's own renderer table: the render has to run on the POOL's ground, behind the pool's
 * probation frame (§24.7), with its writes sequestered there. A copied binding would run a
 * stranger's code against the receiver's own ground, which is the one thing a blessing may not buy.
 * So the prefix is a DELEGATION, resolved per request, and nothing about a channel is cached here.
 *
 * TWO GATES, AND NEITHER IS OPTIONAL.
 *
 * FULL DOOR ONLY. A pool decides its own anonymous surface from its own `loam:public` deltas, and a
 * pool's copy of the receiver's ground is FROZEN at seeding — so a public declaration the operator
 * has since STRUCK still stands in there (`container.ts` states that staleness; `writeRouteImpl`
 * re-reads the root's live word precisely because of it). Delegating the anonymous door would put a
 * second, stale, tokenless view of this store on its own front door. Exposing a channel app to
 * strangers is a decision this seam does not make; the pool's own container mount is unchanged.
 *
 * AND THE BINDING MUST BE THE POOL'S OWN. A pool is one-way seeded with the receiver's whole ground,
 * so every renderer this store owns has an operator-signed twin inside every channel pool — and
 * without this check `alice:<any route of mine>` would serve MY app over the PEER's claims, with no
 * blessing anywhere in the story. Custody is the discriminator: a blessing is published on the
 * pool's gateway and never travels back, so its binding is absent from this store's own ground,
 * while a seeded twin is present by construction. One indexed lookup, and it fails closed.
 *
 * The receiver's OWN law wins its own name: every caller reaches this only after finding nothing at
 * `route` in its own table. And the cheap gates come first — a store with no channels, or a route
 * with no prefix, never pays for the channel reading (H8: `channelStatus` walks the ground).
 *
 * Reads `channelPools` rather than `federationChannels` deliberately: a booted store whose peer
 * credential is missing has the pool attached and the channel unresumable, and a blessed app must
 * go on serving whether or not this store can currently reach the peer it came from.
 */
function channelApp(
  gw: Gateway,
  route: string,
  door: "full" | "public",
): { pool: Gateway; route: string } | undefined {
  if (door !== "full" || gw.channelPools.size === 0) return undefined;
  if (!route.includes(":")) return undefined;
  // MATCH THE DECLARED PREFIX, never "everything before the first colon". A prefix may CONTAIN a
  // colon — nothing refuses one at `federate open` — and splitting instead of matching would look
  // for a channel called `a` when the operator named one `a:b`, so a blessed app would answer 404
  // while every other surface said it was mounted. The LONGEST match wins, because `a` and `a:b`
  // can both stand and only the longer one is the specific answer.
  // WHOSE NAMESPACE IS THIS, decided BEFORE anything is looked up in it. The longest declared
  // prefix owns the name outright: falling back to a shorter one when the longer channel happens to
  // hold nothing would make "who answers `alice:sub:note`" depend on what someone had mounted, so
  // opening a channel would silently move names in and out of another's namespace. One owner, and
  // if it has nothing there the name answers nothing.
  let owner: { name: string; prefix: string } | undefined;
  for (const c of gw.channelStatus()) {
    if (c.prefix === "" || !route.startsWith(`${c.prefix}:`)) continue;
    if (route.length <= c.prefix.length + 1) continue; // the bare name would be empty
    if (owner === undefined || c.prefix.length > owner.prefix.length) {
      owner = { name: c.name, prefix: c.prefix };
    }
  }
  if (owner === undefined) return undefined;
  const bare = route.slice(owner.prefix.length + 1);
  const pool = gw.channelPools.get(owner.name)?.gateway;
  // No operator is no answer: `lawfulSnapshot` would otherwise hand back every delta in the pool,
  // and a peer's own binding would read as something this store had mounted.
  if (pool?.operatorAuthor === undefined) return undefined;
  const binding = pool.renderers().find((r) => r.route === bare);
  // Absent, or a seeded twin of law this store already owns: not this channel's app.
  if (binding === undefined || gw.reactor.get(binding.deltaId) !== undefined) return undefined;
  return { pool, route: bare };
}

// The BUDGET one admission runs on. It composes with §23.9's and §24.5's clocks rather than inventing a
// third discipline — and the composition is not "inherit everything", because the two knobs a door
// carries answer a question admission is not asking.
//
//   THE SPAWN KNOB IS A DOOR'S, AND ADMISSION DOES NOT TAKE IT. `renderSpawnTimeoutMs` exists so a
//   REQUEST fails fast when the host cannot start a thread; an operator who tightens it has asked for
//   quick refusals at the door, not for publishing to become impossible. Inheriting it made a store
//   configured with a 1ms spawn budget unable to accept any renderer at all — authoring blocked by a
//   serving knob. Admission takes §23.9's own host-scheduling ceiling instead, which is what a spawn
//   window actually measures, and holds no pool slot while it waits.
//
//   THE COMPUTE CEILING IS THE OPERATOR'S, AND ADMISSION DOES TAKE IT. A quarantine pool admits on the
//   `renderTimeoutMs` and memory split its operator DECLARED (§24.5): a stranger's module body is real
//   computation on the operator's host, so it gets exactly the bill that was written down and fails
//   closed against it. Measured cost of that choice: a real 200KB packed React bundle evaluates in
//   ~20ms, comfortably inside the 500ms floor, so failing closed here refuses slow code rather than
//   ordinary code. The primary takes the separate admission clock instead — a module body runs at
//   publish, bind and bless, never on a request, and has room to be a real bundle.
export function rendererAdmissionBudget(gw: Gateway): RenderWorkerOptions & { timeoutMs?: number } {
  const envelope = gw.envelope;
  if (envelope === undefined) return {};
  const limits = envelope.resolve();
  return { timeoutMs: limits.renderTimeoutMs, ...workerLimitsOf(limits) };
}

// Ensure a route's bundle is ADMITTED (the body of `Gateway.prepareRoute`, SPEC §23) — async, so a
// renderer binding that arrived by any path (a raw `/append`, a fresh reactor in another process) is
// runnable before the synchronous serveRoute. Idempotent (keyed by content address). A no-op for an
// unknown route, and TOLERANT: a bundle the realm will not admit leaves its route unmounted rather than
// failing the request that asked for it.
export async function prepareRouteImpl(
  gw: Gateway,
  route: string,
  door: "full" | "public" = "full",
): Promise<void> {
  const binding = gw.renderers().find((r) => r.route === route);
  if (binding !== undefined) {
    // THE DOOR DECIDES HERE TOO, on every gateway and not only where a channel is involved.
    // Admitting is EVALUATING a module body (now in §23.9's confined realm), and this branch runs on
    // a pool's own mount as readily as on the root — so a route this door could never serve must not
    // be a route this door can make it run. Admitting only what could be served is the same rule the
    // serve path keeps.
    if (routeServableOn(gw, binding, door)) {
      await admitRenderers([binding.bundle], rendererAdmissionBudget(gw));
    }
    return;
  }
  // THE DOOR REACHES THIS SIDE TOO, and leaving it out was the whole hazard. Admitting means
  // EVALUATING a peer's module body, and the door calls prepare BEFORE it decides anything about the
  // request — so a hard-coded "full" here let a tokenless caller make this store run a stranger's
  // top-level code by asking for a route it would then refuse. Delegation serves the token door only;
  // preparing for it must be the token door's business only. The recursive call resolves the POOL's
  // own admission budget on the pool's gateway.
  const app = channelApp(gw, route, door);
  if (app !== undefined) await app.pool.prepareRoute(app.route, door);
}

// Serve a route (the body of `Gateway.serveRoute`, SPEC §23): resolve the renderer's node under the
// door's discipline and execute its bundle to HTML. Read-only in v1 — a renderer receives the resolved
// view and nothing else (§23.2). Every refusal is a UNIFORM 404 "no such route" (unknown route, a lens
// this door may not read, a withdrawn/erased pin, an unmounted bundle) — an anonymous prober learns
// nothing about what exists (§17). Synchronous, so the bundle must already be loaded (see prepareRoute);
// an unloaded bundle is treated as UNMOUNTED (404), never a 500. A faulting bundle refuses cleanly
// without leaking.
export async function serveRouteImpl(
  gw: Gateway,
  route: string,
  entity: string,
  door: "full" | "public",
  gesture?: { readonly reads: readonly ReadGesture[]; readonly state: Record<string, string> },
  asOf?: number,
): Promise<{ status: number; contentType: string; body: string }> {
  // One refusal, everywhere — history is not anonymous, and neither is "which routes exist" (§17).
  const gone = { status: 404, contentType: "text/plain; charset=utf-8", body: "no such route" };
  const binding = gw.renderers().find((r) => r.route === route);
  if (binding === undefined) {
    const app = channelApp(gw, route, door);
    return app === undefined ? gone : app.pool.serveRoute(app.route, entity, door, gesture, asOf);
  }
  let node: ResolvedNode;
  try {
    if (binding.versionId === undefined) {
      // A LATEST renderer: its lens must be in THIS door's surface — registered (full) or bare-name
      // publicly declared (public). A schema withdrawn after the renderer was published thus darkens the
      // route too — the app is a view over surviving law (§23.6). No 404-vs-error oracle.
      const surface = gw.surface(door);
      if (
        surface === undefined ||
        !surface.registered.some((r) => lensOf(r) === binding.schemaName)
      ) {
        return gone;
      }
      // THE TIME PIN RIDES THE SAME HOOK EVERY OTHER DOOR READS THROUGH (SPEC §26): one resolve,
      // one narrower ground, nothing about the render time-cased. Threaded HERE rather than at each
      // door, because the app door is two call sites and one of them would otherwise keep quietly
      // answering the present.
      node = surface.hooks.resolve(binding.schemaName, entity, asOf);
    } else {
      // A PINNED renderer. The anonymous door serves it IFF the operator publicly declared THAT pin
      // (§23.8 — a declaration is publication, not a probe); every undeclared pin stays a uniform 404,
      // so history is not anonymously probable. The full door serves any surviving registered version.
      if (door === "public" && !gw.isPublicPin(binding.schemaName, binding.versionId)) return gone;
      // Pinned by the version's CONTENT ADDRESS, but resolve the WHOLE key it authorized: the pair
      // (lens, versionId). The gate checked `isPublicPin(schemaName, versionId)`; matching versionId
      // alone would serve a sibling reading sharing the hyperschema if one carried that address
      // (§21.7). Or — if the version was withdrawn or erased — go dark (§23.6).
      const pinned = gw
        .registrationVersions()
        .find((v) => v.deltaId === binding.versionId && lensOf(v) === binding.schemaName);
      if (pinned === undefined) return gone;
      // Both pins at once (SPEC §26): an OLD lens over an OLD ground. They are orthogonal, so a
      // pinned route reads the past through the reading it froze rather than through the latest.
      node = gw.resolvePinned(pinned, entity, asOf);
    }
  } catch (err) {
    // A resolve fault is unusual (the lens is registered); leak the reason only to the full (token)
    // door, never to a stranger.
    if (door === "public") return { ...gone, status: 400, body: "the route could not be rendered" };
    return {
      status: 400,
      contentType: "text/plain; charset=utf-8",
      body: err instanceof Error ? err.message : String(err),
    };
  }
  // THE SEQUESTERED FRAME (SPEC §24.7): a route served by a QUARANTINE POOL's own gateway is chrome-
  // wrapped, so a person sees the probation without reading the spec. Applied to the rendered HTML only —
  // a refusal is already text and says nothing about the ground. This is the one place it can live: the
  // bundle is untrusted and would simply not draw it, and the door below serves whatever bytes it is
  // handed. A store that is not a quarantine is untouched, and that is what keeps canonical reads honest.
  //
  // THE TIME FRAME (SPEC §26) rides the same seam, for the same reason: the reader is a person and
  // the code between them is a bundle that predates the pin, so a page served from a MOMENT has to
  // say so in bytes the bundle never touched. Applied FIRST, so §24.7's banner still lands first in
  // the body — a probationary store's most urgent statement stays the one at the top.
  const framed = (r: { status: number; contentType: string; body: string }) => {
    if (r.status !== 200 || !r.contentType.startsWith("text/html")) return r;
    let body = frameAsOf(r.body, node);
    const p = gw.probation;
    if (p !== undefined) body = frameProbation(body, p, door);
    return body === r.body ? r : { ...r, body };
  };
  // The bundle must have been ADMITTED (un-admitted → unmounted, a 404, not a 500 — prepareRoute admits
  // it on the serve path). The read-discipline + resolve above stayed on THIS thread (authority never
  // leaves it); the untrusted render runs in the confined, bounded worker (SPEC §23.9), and so did the
  // module body that got it admitted.
  if (!rendererAdmitted(binding.bundle, rendererAdmissionBudget(gw))) return gone;
  // The floor's mediated reads (SPEC §30), resolved HERE, in the gateway, under this door's own
  // discipline — the request never leaves the authority boundary. FULL DOOR ONLY: the anonymous door's
  // whole posture is that every refusal is a uniform 404 leaking nothing about what exists (§17), so a
  // per-lens `not_served` there would be exactly the lens-existence oracle that door closed. On the
  // public door a `?read=` is ignored and the route renders as it always has.
  const reads: Record<string, ReadResult> = {};
  const state: Record<string, string> = door === "public" ? {} : (gesture?.state ?? {});
  if (door === "full") {
    for (const g of gesture?.reads ?? []) {
      reads[readKey(g.lens, g.entity)] = resolveGesture(gw, g, asOf);
    }
  }
  // Built LAZILY: a refused render must cost nothing, and `bytesEnvelope` walks the whole view. The
  // §23.9 cap's own comment ("the slot is acquired after every refusal that costs nothing") is only
  // true while this stays behind the gates.
  const payload = (): Record<string, unknown> => ({
    entity,
    view: bytesEnvelope(node.view),
    hex: node.hex,
    reads,
    state,
  });
  // A QUARANTINE POOL renders on its OWN envelope (SPEC §24.5, ticket T34) — slots, wall clock, and
  // memory the operator declared on the PARENT's ground, re-resolved here so a widening is a delta
  // and not a restart. It supersedes the §23.9 cap on BOTH doors, deliberately: on the primary the
  // token door is the operator's own, but inside a quarantine every render is untrusted code whichever
  // door asked for it. The slot is acquired after every refusal that costs nothing, covers exactly the
  // worker execution, and is released in `finally` so a completed, timed-out or faulted render always
  // gives it back. Over the cap: a clean 503 leaking no route, lens or entity — the operator learns
  // which pool hit which limit from `envelopeReports()`, never the caller.
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
      // FRAMED like every other render path (SPEC §24.7). An enveloped pool is an untrusted one, so
      // this branch is where the sequestered frame matters MOST — a metered render that skipped the
      // wrap would drop the probation chrome exactly where the app is least trusted. The refusal above
      // is left bare on purpose: `framed` touches only a 200 text/html body, so a 503 says nothing
      // about whether it came from a quarantine.
      return framed(
        await renderInWorker(binding.bundle, payload(), limits.renderTimeoutMs, {
          ...workerLimitsOf(limits),
          // The pool's spawn window is the POOL'S clock, not the host's ceiling — the one place
          // §23.9's spawn budget deliberately does not reach. A slot is held across BOTH windows,
          // so the host's 10s ceiling here would let a pool that declared `renderTimeoutMs: 120`
          // occupy its single slot for 10120ms: a ceiling the operator never declared and cannot
          // read in `envelopeReports()`. §24.5 promises the envelope is the pool's WHOLE bill, and
          // a bound that big and that invisible would falsify it. Stated rather than omitted,
          // because omitting the key falls back to RENDER_SPAWN_TIMEOUT_MS — the 10s, not the 120.
          // The cost is honest and accepted: a host too slow to spawn inside the pool's own clock
          // refuses that render. Untrusted code fails closed, and the operator holds the lever.
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
  // The anonymous render fan is CAPPED (SPEC §23.9, ticket T18): the slot is acquired only here —
  // after every refusal that costs nothing — and covers exactly the worker execution, released in
  // finally so a completed (or timed-out, or faulted) render always gives its slot back. Over the
  // cap: a clean 503 that names no route, no lens, no entity — the refusal leaks nothing.
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
  // Execute the renderer in a worker_threads Worker with a hard timeout + resourceLimits: a hanging or
  // heavy bundle cannot wedge the event loop or OOM the host, and every route keeps answering. The
  // renderer is a view consumer like gql/REST — hand it the §23.7 envelope (a bytes leaf becomes
  // { mime, ref, base64url? }, primitives pass through), which is also what makes the node JSON/clone-safe
  // to cross the thread boundary. renderInWorker never rejects; every fault folds to a clean refusal.
  return framed(
    await renderInWorker(binding.bundle, payload(), gw.options.renderTimeoutMs, {
      spawnTimeoutMs: gw.options.renderSpawnTimeoutMs,
    }),
  );
}

// Resolve ONE mediated read on the server-rendered host, mapping every failure onto the floor's own
// host-neutral enum (§30). The boundary asserted is exactly the pair the artifact host's boundary is:
// the lens must be REGISTERED on this door's surface, and `hooks.resolve` carries no identity — a token
// individuates WRITE standing, and §7's isolation unit for reads is the mount. There is no shadow
// allow-list: the door adjudicates nothing the store would not.
//
// THE MOMENT REACHES HERE TOO (SPEC §26), and it is not optional. A gesture and a pin ride the SAME
// request — `?asOf=T&read=Lens:entity` is one GET — so a mediated read left at the present would put
// today's value inside a page the frame stamps "as of T". That is worse than an unpinned read: the
// door's own chrome vouches for the wrong number.
function resolveGesture(gw: Gateway, g: ReadGesture, asOf?: number): ReadResult {
  const surface = gw.surface("full");
  const lens = g.lens as LensName;
  if (surface === undefined || !surface.registered.some((r) => lensOf(r) === lens)) {
    return {
      error: { code: "not_served", message: `this store does not serve the lens "${g.lens}"` },
    };
  }
  try {
    const node = surface.hooks.resolve(lens, g.entity, asOf);
    // Absence is an answer, not an error: an entity the store has nothing for resolves to an EMPTY
    // view, and the renderer draws its own "nothing here". Only a fault is a refusal. An entity that
    // had not been spoken of yet at T is exactly that same absence, reached down the time axis.
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

// May THIS door serve THIS renderer's route (SPEC §23.5/§23.8)? The same read discipline serveRoute
// applies — a latest renderer's lens must be in the door's surface (public = a bare-name declaration); a
// pinned renderer's version must be publicly declared (public) or simply survive (full). writeRoute
// reuses it so a stranger can only POST to a route they could GET, and an undeclared route stays 404.
export function routeServableOn(
  gw: Gateway,
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

// The store that can answer for a pool, LIVE (SPEC §24.7). A pool holds a seeded COPY of the host's
// law, frozen until someone re-pulses the edge, and nothing re-pulses it on its own — so any question
// whose stale answer would make a REVOCATION never arrive is asked of the root instead.
//
// The chain is VERIFIED, not chased. Following `attachedTo` alone would trust whatever store the
// pointer lands on, and a detached intermediate is exactly that: still readable, permanently frozen,
// and now the end of the chain. So each link must still be a live attachment, and the terminal store
// must not itself be a pool. Undefined means "I cannot tell", which every caller must read as a
// refusal rather than a permission (H9).
function rootAuthorityOf(gw: Gateway): Gateway | undefined {
  let child = gw;
  let root = gw.attachedTo;
  while (root !== undefined && root.quarantinePools.has(child) && root.attachedTo !== undefined) {
    child = root;
    root = root.attachedTo;
  }
  return root !== undefined && root.quarantinePools.has(child) && root.probation === undefined
    ? root
    : undefined;
}

// Write through a rendered route (the body of `Gateway.writeRoute`, SPEC §23.3): a form on a mounted
// renderer POSTs its fields, and the STORE signs the resulting delta as the renderer's PEN — a
// granted-author identity whose seed is provisioned in config (options.pens), NEVER the caller's token.
// Provenance thus shows the mediating code (the pen author is the §19 write attribution), and revocation
// is striking the pen's grant. The write runs the gateway's normal §14 mutate — assertWritable (the
// schema's own writable) AND authorize (the pen must actually HOLD write standing: provisioning is not
// authorization, §6's two keys). A field outside the renderer's OWN `writable` allow-list is refused at
// the door. On the anonymous door a public renderer's form writes ONLY if the operator BOTH declared the
// lens public AND provisioned+granted a pen — no anonymous writes by default (§12).
//
// SEAM NOTE (T19): this is the one renderer body that reaches a §14 WRITE VERB (`gw.mutateEntity`) — the
// renderer door genuinely mediates a write, so the coupling is real, not incidental. When the write-verbs
// concern gets its own module, this call is the named edge between the two.
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
  // Visible on this door (the same discipline as a GET), so a stranger can only write where they could
  // read, and an undeclared route stays a uniform 404 rather than revealing itself.
  if (!routeServableOn(gw, binding, door)) return gone;
  // THE ANONYMOUS DOOR'S OPENNESS IS THE ROOT'S LIVE WORD TOO (SPEC §24.7). `loam:public` is a READ
  // declaration everywhere else, and stale copies of a read are the documented cost of a seeded pool.
  // Here it is a WRITE GATE: it is the only thing standing between a stranger's form and an anonymous
  // author, so a pool's frozen copy of it would keep an anonymous write door open after the operator
  // struck the declaration that opened it. `mounts.ts` asks the host WHETHER any public surface is
  // open; this asks the root about THIS route's own lens, which is the half a write turns on. The
  // refusal is the same uniform 404 an undeclared route gives, so the door gains no oracle.
  const authority = gw.probation === undefined ? undefined : rootAuthorityOf(gw);
  if (gw.probation !== undefined && door === "public") {
    if (authority === undefined || !routeServableOn(authority, binding, "public")) return gone;
  }
  // A read-only renderer (no pen/writable) declared no way to author — refuse the write, not the route.
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
  // Every posted field must be in the renderer's OWN writable allow-list (§14/§21 at the renderer door),
  // narrower than (and atop) the schema's own writable, which mutateEntity re-checks.
  for (const f of posted) {
    if (!binding.writable.includes(f)) {
      return {
        status: 400,
        contentType: text,
        body: `field "${f}" is not writable by this renderer`,
      };
    }
  }
  // The pen must be PROVISIONED (its seed in config) — custody. Absent → refuse (nothing to sign
  // with). The refusal NAMES THE CURE, but only on the token door: a stranger gets the same uniform
  // body as any refused write below, because the pen's name and the store's file layout are the
  // operator's business, not the anonymous fan's.
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
  // A PROBATIONARY POOL ASKS ITS HOST'S LIVE WORD (SPEC §24.7, following the §12 precedent in
  // mounts.ts). A pool holds a SEEDED COPY of the operator's grants, frozen until someone calls
  // reseed() — and nothing calls it on its own. Asking the pool alone would make a revocation
  // unrevocable at every quarantine mount: strike the pen's grant in the primary and the pool would
  // go on signing with it forever, anonymously wherever the route is public. So the pen must hold
  // write standing at the ROOT store as well as here, re-read per request. `authorize` still asks
  // this store's own question below; this is the second key, not a replacement for the first.
  //
  // ONLY where the grant is a seeded copy — i.e. a QUARANTINE. A curated container and a §39 inbox
  // pool build authority in their OWN ground on purpose (container.ts's grant chain), and asking
  // the host about a grant the host was never meant to hold would refuse every write there with a
  // reason that is not true. Climbing to the root matters for the same reason the check exists: an
  // intermediate pool's copy is frozen too, so a pool of a pool must not ask its frozen parent.
  if (gw.probation !== undefined) {
    // `rootAuthorityOf` above verified the chain. A chain that cannot be verified — a detached pool, a
    // handle held past a failed drop — refuses: "I cannot tell" is not "permitted" (H9).
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
        STORE_ENTITY,
        authorForSeed(penSeed),
        "write",
        authority.operatorAuthor,
      )
    ) {
      // States the CONDITION rather than asserting a revocation happened: the pen may have been
      // struck, or may never have held standing outside this pool at all.
      return {
        status: 403,
        contentType: text,
        body: "this renderer's pen holds no write grant in the store this pool reads",
      };
    }
  }
  try {
    // Sign AS the pen (not the caller). append→authorize checks the pen's GRANT — provisioning is not
    // authorization; a pen with no surviving write grant is refused here exactly as any actor would be.
    await gw.mutateEntity(binding.schemaName, entity, fields, penSeed);
  } catch (err) {
    // A refused write leaks its reason only to the full (token) door; a stranger gets a uniform refusal.
    if (door === "public") return { status: 403, contentType: text, body: "the write was refused" };
    return {
      status: 403,
      contentType: text,
      body: err instanceof Error ? err.message : String(err),
    };
  }
  // Re-render the now-updated route so a browser form submit lands on the fresh page (§23.3).
  return gw.serveRoute(route, entity, door);
}

// The byte-door (the body of `Gateway.serveBytes`, SPEC §23.7): serve the raw bytes a caller names by
// content address `ref`, but only by PROOF OF READ — the fetch names the lens+entity it got the ref
// from, and this RE-RESOLVES that view under this door's own discipline (full: any registered lens;
// public: only a declared one, §17) and serves the bytes only if the resolved view actually contains a
// BytesView whose content address is `ref`. A bare ref-to-bytes endpoint would be exactly the
// content-address existence oracle §17 closed; this is not — the re-resolution IS the lookup (no store
// scan), and every failure (unknown ref, wrong `from`, a lens this door may not read) collapses to the
// SAME uniform 404, so a stranger learns nothing. §11 erasure then falls out for free: a purged source
// delta is no longer in the live re-resolved view, so its ref 404s by construction — the door NEVER
// caches the bytes.
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
    // A resolve fault collapses to the same silence — the door reveals nothing a normal read wouldn't.
    return gone;
  }
  const found = findBytesByRef(node.view, ref);
  if (found === undefined) return gone;
  return { status: 200, contentType: found.mime, body: found.value };
}
