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
// what mounts — one hash, no signed-vs-executed gap. It rides the same in-process execution floor as a
// resolver (§22): operator-authored in a governed store, only operator law binds (§7). Object-capability
// confinement for UNTRUSTED code (SES / Worker / wasm, §6) is §24's quarantine and a named §23 hardening
// slice, not invented here.

import { authorForSeed, signClaims, type Primitive } from "@bombadil/rhizomatic";
import type { Claims, Reactor } from "@bombadil/rhizomatic";
import { bytesEnvelope, findBytesByRef } from "./bytes.js";
import { importEsm, loadedEsm } from "./esm.js";
import type { Gateway, RequestContext } from "./gateway.js";
import type { ResolvedNode } from "./gql.js";
import { renderInWorker } from "./render-worker.js";
import { lawfulNegated, lawfulSnapshot, lensOf, type LensName } from "./registration.js";

export const CTX_RENDERER = "loam.renderer";

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

// What the host hands a renderer: the resolved node, and nothing else (§23.2 — a renderer speaks lens, the
// host holds the keys). v1 is read-only, so it is exactly a `ResolvedNode`'s public face. A bytes leaf is
// handed over as the §23.7 envelope { mime, ref, base64url? } — the same face gql/REST show — so a
// renderer builds `<img src>` from `ref` (the byte-door) or the inline `base64url`, never juggling raw
// Uint8Arrays; every non-bytes value passes through unchanged.
export interface RenderNode {
  readonly entity: string;
  readonly view: Record<string, unknown>;
  readonly hex: string;
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
  const lawful = lawfulSnapshot(reactor, operator);
  const negated = lawfulNegated(reactor, operator);
  const latest = new Map<string, RendererBinding>();
  for (const delta of lawful) {
    const key = delta.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_RENDERER,
    );
    if (key?.target.kind !== "entity" || !isRoute(key.target.entity.id)) continue;
    if (negated(delta.id)) continue;
    const route = primitive(delta.claims, "route");
    const schemaName = primitive(delta.claims, "schema");
    const bundle = primitive(delta.claims, "bundle");
    if (typeof route !== "string" || typeof schemaName !== "string" || typeof bundle !== "string") {
      continue; // a malformed renderer binds nothing
    }
    const versionIdRaw = primitive(delta.claims, "versionId");
    const versionId = typeof versionIdRaw === "string" ? versionIdRaw : undefined;
    let consumes: string[] = [];
    const consumesRaw = primitive(delta.claims, "consumes");
    if (typeof consumesRaw === "string") {
      try {
        const parsed: unknown = JSON.parse(consumesRaw);
        if (Array.isArray(parsed) && parsed.every((f) => typeof f === "string")) consumes = parsed;
      } catch {
        consumes = [];
      }
    }
    // Write-enabling (SPEC §23.3): read the form allow-list and the pen name. A binding with one but not
    // the other is malformed and stays READ-ONLY (both dropped) — the parse gate keeps them paired, and a
    // reader never trusts a half-written binding to sign.
    const penRaw = primitive(delta.claims, "pen");
    let writable: string[] | undefined;
    const writableRaw = primitive(delta.claims, "writable");
    if (typeof writableRaw === "string") {
      try {
        const parsed: unknown = JSON.parse(writableRaw);
        if (Array.isArray(parsed) && parsed.every((f) => typeof f === "string")) writable = parsed;
      } catch {
        writable = undefined;
      }
    }
    const pen = typeof penRaw === "string" && penRaw !== "" ? penRaw : undefined;
    const writeReady = writable !== undefined && writable.length > 0 && pen !== undefined;
    const binding: RendererBinding = {
      route,
      // Parse boundary: reconstructed from a lawful delta, validated string above (see the guard).
      schemaName: schemaName as LensName,
      ...(versionId === undefined ? {} : { versionId }),
      consumes,
      bundle,
      ...(writeReady ? { writable: writable as readonly string[], pen } : {}),
      deltaId: delta.id,
      timestamp: delta.claims.timestamp,
    };
    // Latest per route: (timestamp, id) ascending, the same tie-break every latest-wins reader uses.
    const held = latest.get(key.target.entity.id);
    if (
      held === undefined ||
      binding.timestamp > held.timestamp ||
      (binding.timestamp === held.timestamp && binding.deltaId > held.deltaId)
    ) {
      latest.set(key.target.entity.id, binding);
    }
  }
  return [...latest.values()];
}

// Load a renderer bundle to a callable, via the shared content-addressed ESM loader (§22.3). `export
// default` must be a function; anything else is a malformed renderer and throws (loud at publish).
export async function loadRenderer(bundle: string): Promise<RenderFn> {
  const mod = await importEsm(bundle);
  if (typeof mod.default !== "function") {
    throw new Error("a renderer's ESM must `export default` a function (node) => html");
  }
  return mod.default as RenderFn;
}

// Pre-load every renderer bundle in a set (idempotent — the ESM cache dedups by content address). Called
// at bind and publish time so the synchronous serve path always finds its function.
export async function loadRenderers(bundles: ReadonlyArray<string>): Promise<void> {
  await Promise.all([...new Set(bundles)].map((b) => loadRenderer(b)));
}

// The already-loaded render function for a bundle, or undefined (the sync-serve lookup — an unloaded
// renderer is treated as unmounted rather than blocking the request to import).
export function loadedRenderer(bundle: string): RenderFn | undefined {
  const mod = loadedEsm(bundle);
  return typeof mod?.default === "function" ? (mod.default as RenderFn) : undefined;
}

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

export async function publishRendererImpl(
  gw: Gateway,
  input: unknown,
  context?: RequestContext,
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
  // The bundle must load to a function NOW (loud here, never a serve-time surprise), and pre-load into
  // the content-addressed cache so the synchronous serve path finds it.
  await loadRenderers([spec.bundle]);
  const author = authorForSeed(seed);
  await gw.append([
    signClaims(rendererBindingClaims(spec, versionId, author, gw.nextTimestamp()), seed),
  ]);
}

// Ensure a route's bundle is loaded (the body of `Gateway.prepareRoute`, SPEC §23) — async, so a renderer
// binding that arrived by any path (a raw `/append`, a fresh reactor in another process) is runnable
// before the synchronous serveRoute. Idempotent (the ESM cache dedups by content address). A no-op for an
// unknown route.
export async function prepareRouteImpl(gw: Gateway, route: string): Promise<void> {
  const binding = gw.renderers().find((r) => r.route === route);
  if (binding !== undefined) await loadRenderers([binding.bundle]);
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
): Promise<{ status: number; contentType: string; body: string }> {
  // One refusal, everywhere — history is not anonymous, and neither is "which routes exist" (§17).
  const gone = { status: 404, contentType: "text/plain; charset=utf-8", body: "no such route" };
  const binding = gw.renderers().find((r) => r.route === route);
  if (binding === undefined) return gone;
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
      node = surface.hooks.resolve(binding.schemaName, entity);
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
      node = gw.resolvePinned(pinned, entity);
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
  // The bundle must be loadable (unloaded → unmounted, a 404, not a 500 — prepareRoute pre-loads it on
  // the serve path). The read-discipline + resolve above stayed on THIS thread (authority never leaves
  // it); only the untrusted render runs in the bounded worker (SPEC §23.9).
  if (loadedRenderer(binding.bundle) === undefined) return gone;
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
      return await renderInWorker(
        binding.bundle,
        {
          entity,
          view: bytesEnvelope(node.view) as Record<string, unknown>,
          hex: node.hex,
        },
        gw.options.renderTimeoutMs,
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
  return renderInWorker(
    binding.bundle,
    {
      entity,
      view: bytesEnvelope(node.view) as Record<string, unknown>,
      hex: node.hex,
    },
    gw.options.renderTimeoutMs,
  );
}

// May THIS door serve THIS renderer's route (SPEC §23.5/§23.8)? The same read discipline serveRoute
// applies — a latest renderer's lens must be in the door's surface (public = a bare-name declaration); a
// pinned renderer's version must be publicly declared (public) or simply survive (full). writeRoute
// reuses it so a stranger can only POST to a route they could GET, and an undeclared route stays 404.
function routeServableOn(gw: Gateway, binding: RendererBinding, door: "full" | "public"): boolean {
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
  if (binding === undefined) return gone;
  // Visible on this door (the same discipline as a GET), so a stranger can only write where they could
  // read, and an undeclared route stays a uniform 404 rather than revealing itself.
  if (!routeServableOn(gw, binding, door)) return gone;
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
  // The pen must be PROVISIONED (its seed in config) — custody. Absent → refuse (nothing to sign with).
  const penSeed = gw.options.pens?.[binding.pen];
  if (penSeed === undefined) {
    return { status: 403, contentType: text, body: "this renderer's pen is not provisioned" };
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
