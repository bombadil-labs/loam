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

import type { Claims, Reactor, View } from "@bombadil/rhizomatic";
import { importEsm, loadedEsm } from "./esm.js";
import { lawfulNegated, lawfulSnapshot } from "./registration.js";

export const CTX_RENDERER = "loam.renderer";

// What a route + schema + UI share, at input and at rest.
interface RendererCore {
  readonly route: string;
  readonly schemaName: string;
  readonly consumes: readonly string[];
  readonly bundle: string;
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
// host holds the keys). v1 is read-only, so it is exactly a `ResolvedNode`'s public face.
export interface RenderNode {
  readonly entity: string;
  readonly view: Record<string, View>;
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
  return {
    route: o.route,
    schemaName,
    ...(o.version === undefined ? {} : { version: o.version }),
    consumes: o.consumes as string[],
    bundle: o.bundle,
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
    const binding: RendererBinding = {
      route,
      schemaName,
      ...(versionId === undefined ? {} : { versionId }),
      consumes,
      bundle,
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
