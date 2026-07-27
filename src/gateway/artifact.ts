// A Loam app published as a Claude Artifact (SPEC §30). The reframe the ticket earned: nothing about the
// RENDERER is dual. `RenderFn = (node) => string` names no host — it runs today in a `worker_threads`
// Worker on the operator's server; it runs unchanged in a browser realm, called with a node assembled
// from a query result. So the duality is a property of the HOST, and the binding gains NO target
// vocabulary and no per-target bundle role: one renderer, one content address, two hosts, which is
// §23.1's whole point held (the signature attests exactly what mounts).
//
// Two pieces live here, and only the first is new vocabulary:
//
//   `loam.artifact` — an operator DECLARATION, `loam.public`'s twin in shape and in doctrine: repeatable
//   `route` primitives at `loam:artifact`, read as the union of surviving lawful declarations, a fresh
//   declaration only ADDS, removal is negation. It is separate from the binding on purpose — putting
//   permission-to-publish IN the binding would make granting or revoking it change the bundle's content
//   address, minting a new renderer version for a decision that is not about the code.
//
//   `packArtifact` — a door that EMITS a self-contained page from surviving law, re-derived from
//   `readRenderers` on every call exactly as `serveRoute` is. That is why it lives on the gateway rather
//   than in a CLI build step: a build step reading a file would keep emitting a page whose binding,
//   schema version, or declaration had been struck.
//
// WHAT WITHDRAWAL REACHES, AND WHAT IT DOES NOT. Striking the declaration darkens the emission; striking
// the binding 404s the host route. The page a stranger ALREADY HOLDS is a third thing, and Loam does not
// hold it. The honest statement of this target's property is an ASYMMETRY: for the artifact host the DATA
// never outlives its source (zero view data is emitted, so there is nothing to outlive) and the CODE
// always does — the reverse of the host target, where the code is re-derived per request and the data is
// never persisted at all. That residual is ACCEPTED and pinned by a rail rather than implied; the follow-on
// that would close it is a `loam_manifest(route)` read over constitutional publication state, checked
// before mounting, which is a new disclosure decision and not this door's.

import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import type { Claims, Reactor } from "@bombadil/rhizomatic";
import { artifactPage } from "./artifact-page.js";
import { HOST_GLOBALS, scanHostReferences } from "./artifact-scan.js";
import type { Gateway, RequestContext } from "./gateway.js";
import { RENDER_TIMEOUT_MS } from "./render-worker.js";
import { lawfulNegated, lawfulSnapshot, lensOf } from "./registration.js";
import type { Registered } from "../surface/surface.js";
import type { RendererBinding } from "./renderers.js";

export const ARTIFACT_ENTITY = "loam:artifact";
export const CTX_ARTIFACT = "loam.artifact";

// The tool manifest is ENUMERATED against the door that exists, never invented — `MCP_TOOLS` is exactly
// three — and it is assembled per binding below rather than held as a constant, so there is no second
// list to drift. `loam_register` is constitutional: a page declaring it would ask the viewer for
// store-shaping authority in order to draw a view, so a pack that would emit it refuses.
const FORBIDDEN_TOOL = "loam_register";

// The connector display-name ceiling. Not a security bound — a DECIDABLE one, so an unusable name is
// refused here rather than emitted into a page that can never reach a store.
export const MAX_CONNECTOR_NAME = 128;

// The coordinates the page holds. Everything here is pack-time text from the store that packed the page;
// nothing is view data (criterion 3 asserts that at the bytes).
export interface ArtifactCoordinates {
  readonly server: string;
  readonly route: string;
  readonly lens: string;
  readonly entity: string;
  readonly consumes: readonly string[];
  readonly manifest: readonly string[];
  // The `writable` set the operator was ACKNOWLEDGED for — a receipt of a human decision, not a
  // boundary (the viewer could always send the document themselves). What it buys: widening the
  // schema's `writable` in a v2 registration does not widen an already-emitted page.
  readonly writable: readonly string[];
  // Text a viewer READS, never a target the page requests — the one place a store address appears.
  readonly storeAddress: string;
  readonly refetchInterval: number;
  readonly renderTimeoutMs: number;
}

// The polling floor the runtime clamps a watch to (~30 s). Named rather than guessed, so the emitted
// number is not a lie about how often the page will actually read.
const DEFAULT_REFETCH_MS = 30_000;

// One declaration: the routes an operator has opened to artifact emission — each a repeatable `route`
// primitive, so the publishable set is auditable pointer by pointer.
export function artifactClaims(
  routes: readonly string[],
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    author,
    pointers: [
      {
        role: "declares",
        target: { kind: "entity", entity: { id: ARTIFACT_ENTITY, context: CTX_ARTIFACT } },
      },
      ...routes.map((r) => ({ role: "route", target: { kind: "primitive" as const, value: r } })),
    ],
  };
}

// Is this delta an artifact declaration, and if so, is it WELL-FORMED law? The door refuses a malformed
// one at append, so nothing can sit at `loam:artifact` looking like a publication grant and granting
// nothing. Mirrors `publicDefect` deliberately — same shape, same doctrine, no near-synonym.
export function artifactDefect(claims: Claims): string | undefined {
  const declares = claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === ARTIFACT_ENTITY &&
      p.target.entity.context === CTX_ARTIFACT,
  );
  if (!declares) return undefined;
  const routes = claims.pointers.filter((p) => p.role === "route");
  if (routes.length === 0) return "an artifact declaration names at least one route";
  for (const p of routes) {
    if (
      p.target.kind !== "primitive" ||
      typeof p.target.value !== "string" ||
      p.target.value === ""
    ) {
      return "an artifact declaration's route entries are non-empty route names";
    }
  }
  return undefined;
}

// The routes currently publishable as artifacts: the union of `route` pointers across ALL surviving
// lawful declarations. Governed stores only — with no operator there is no lawful voice to publish with.
export function readArtifactRoutes(reactor: Reactor, operator?: string): ReadonlySet<string> {
  const open = new Set<string>();
  if (operator === undefined) return open;
  const negated = lawfulNegated(reactor, operator);
  for (const delta of lawfulSnapshot(reactor, operator)) {
    const declares = delta.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === ARTIFACT_ENTITY &&
        p.target.entity.context === CTX_ARTIFACT,
    );
    if (!declares || negated(delta.id)) continue;
    for (const p of delta.claims.pointers) {
      if (
        p.role === "route" &&
        p.target.kind === "primitive" &&
        typeof p.target.value === "string" &&
        p.target.value !== ""
      ) {
        open.add(p.target.value);
      }
    }
  }
  return open;
}

// Declare routes artifact-publishable (the body of `Gateway.declareArtifact`). Operator only, exactly
// like any `loam.public` write — a governed store binds only operator law.
export async function declareArtifactImpl(
  gw: Gateway,
  routes: readonly string[],
  context?: RequestContext,
): Promise<void> {
  const seed = context?.actor ?? gw.options.seed;
  if (seed === undefined) {
    throw new Error("this gateway holds no signing seed and cannot declare an artifact route");
  }
  if (gw.operatorAuthor !== undefined && authorForSeed(seed) !== gw.operatorAuthor) {
    throw new Error("append rejected: only the operator may declare an artifact route");
  }
  if (routes.length === 0 || routes.some((r) => typeof r !== "string" || r === "")) {
    throw new Error("artifact: declare at least one non-empty route");
  }
  await gw.append([
    signClaims(artifactClaims(routes, authorForSeed(seed), gw.nextTimestamp()), seed),
  ]);
}

// --- the capability statement (Recommendation 17) -------------------------------------------------

// What a viewer sees before accepting, DERIVED by one function from the SCHEMA and the binding. No
// author-supplied prose reaches it: the bundle SOURCE is not an input, so a renderer whose markup claims
// "reads nothing" changes nothing — and it renders OUTSIDE and AFTER the mount point, so the host gets
// the last sentence.
//
// It names three axes a fields-only derivation would drop, and each one is a way the label could lie:
// the projection is `_view` (the WHOLE resolved view, wider than `schema.props`, because `resolveView`
// fills unnamed props through `schema.default` and decoration and resolvers add more); every query field
// carries `asOf` and every view type `_asOf` / `_forgotten`, so an installed schema is a licence to read
// those fields' HISTORY; and writes include the registration's claim TEMPLATES, not only `writable`.
//
// The label and the SERVER read the same value — the registration the gateway actually serves — so if the
// schema narrows, the statement narrows, and the store refuses the removed field either way. There is no
// second source of truth to keep in sync, which is the structural reason this stays honest. What it must
// NOT do is imply a wall the page holds: the page holds none.
export function capabilityStatement(
  registered: Registered,
  binding: RendererBinding,
  manifest: readonly string[],
  // The set THIS PAGE was published to write — `binding.writable` where the operator acknowledged a
  // narrowing, else the schema's. Passed in rather than re-derived so the statement and the page's own
  // pin cannot disagree: a viewer told they may write a field the page then refuses has been read a
  // label that is false about the artifact in front of them, whatever it is true about the schema.
  pinned?: readonly string[],
): string[] {
  const props = [...registered.schema.props.keys()].sort();
  const schemaWritable = [...(registered.writable ?? [])].sort();
  const writable = [...(pinned ?? registered.writable ?? [])].sort();
  const narrowed = schemaWritable.filter((f) => !writable.includes(f));
  const templates = Object.keys(registered.mutations ?? {}).sort();
  const consumes = [...binding.consumes].sort();
  const lens = lensOf(registered);
  const list = (xs: readonly string[]): string => (xs.length === 0 ? "none" : xs.join(", "));
  return [
    `This app reads the lens “${lens}”, whose readable fields are: ${list(props)}.`,
    `It paints ${consumes.length === 0 ? "no field" : list(consumes)} on first sight — its appetite, ` +
      `not its bound: every read returns the WHOLE resolved view, which is wider than the fields named ` +
      `above (unnamed properties resolve through the schema's default, and resolvers add more).`,
    `The schema also opens those fields' HISTORY: a read may name a moment (asOf), and a view reports ` +
      `_asOf and _forgotten — so this is a licence to read the past, not only the present. Erased ` +
      `content stays erased.`,
    writable.length === 0 && templates.length === 0
      ? `It may write nothing: the schema names no writable field and no claim template.`
      : (writable.length === 0
          ? `It may write no field directly`
          : `It may write ${list(writable)}`) +
        (templates.length === 0
          ? `.`
          : `, and may file these claim templates: ${list(templates)}.`),
    ...(narrowed.length === 0
      ? []
      : [
          `This page was published for a NARROWER write set than the schema opens: the schema also ` +
            `allows ${list(narrowed)}, which this page will not send. That narrowing is a receipt of ` +
            `the operator's decision, not a wall — the same document sent with your own token is ` +
            `accepted by the store either way.`,
        ]),
    `Reading happens against the store your connector points at — not the store that published this ` +
      `page — and writing happens as YOUR own author standing, with your own credentials. This page ` +
      `holds no key, no pen, and no boundary of its own.`,
    `The tools it may call: ${list(manifest)}.`,
  ];
}

// --- the pack door -------------------------------------------------------------------------------

export interface PackArtifactOptions {
  // The connector DISPLAY NAME — the single most load-bearing string in this design. It is the entire
  // binding between the page and a store, it is baked into the emitted bytes, and nothing else
  // validates it, so an unusable one refuses here.
  readonly server: string;
  // The store address the onboarding copy shows as TEXT a viewer reads, never a target the page
  // requests. It is the one place a store address appears in the page.
  readonly storeAddress?: string;
  // The operator looked at a pen, or a narrowed `writable`, and said yes. Absent → those refuse.
  readonly acknowledgePen?: boolean;
  readonly acknowledgeWritable?: boolean;
  readonly refetchInterval?: number;
}

// WHAT THIS DOOR ANSWERS: whether a route may be published, what a page emitted from it is permitted to
// do — and now the page itself, emitted from exactly those coordinates. The verdict stayed separable from
// the emission through the whole build, which is why every decision above could be read without markup.
export interface PackedArtifact {
  readonly page: string;
  readonly coordinates: ArtifactCoordinates;
  readonly capability: readonly string[];
  readonly manifest: readonly string[];
}

// The uniform refusal. `packArtifact` throws a plain-English reason and every door renders it — the same
// "one shape for every door" discipline `parseRendererInput` already enforces, so a refusal reads
// identically from HTTP, the CLI, and a direct call.
function refuse(why: string): never {
  throw new Error(why);
}

export function packArtifactImpl(
  gw: Gateway,
  route: string,
  entity: string,
  opts: PackArtifactOptions,
): PackedArtifact {
  // (6) An unusable connector display name. Decidable here; a cross-publisher name COLLISION is not —
  // the packer cannot see what else a viewer installed — so that hazard is documentation plus the
  // `selection_required` degraded state, never a refusal.
  const server = opts.server;
  if (typeof server !== "string" || server.trim() === "") {
    refuse("artifact: --connector wants the display name of the connector this page reads through");
  }
  if (server.length > MAX_CONNECTOR_NAME) {
    refuse(
      `artifact: a connector display name may not exceed ${MAX_CONNECTOR_NAME} characters (got ${server.length})`,
    );
  }
  // (3) An undeclared route. Live on the next request after the declaration is struck: the set is
  // re-derived from surviving law here, never cached.
  if (!gw.artifactRoutes().has(route)) {
    refuse(
      `artifact: route "${route}" is not declared publishable — declare it (loam.artifact) before packing it`,
    );
  }
  const binding = gw.renderers().find((r) => r.route === route);
  if (binding === undefined) {
    refuse(`artifact: no renderer is bound at route "${route}"`);
  }
  // (1) A version-pinned binding. A pin must resolve THAT frozen reading (§21/§23.6 — a pin never
  // silently slides), and pinned reads exist on the REST door and NOT in GraphQL, which is what
  // `loam_query` is. So the page could not address the reading it was pinned to, and packing it as
  // latest would break the pin's whole promise. The follow-on is small and named: teach the MCP door a
  // pinned read. There is no partial emission — nothing is written before every refusal has run.
  if (binding.versionId !== undefined) {
    refuse(
      `artifact: route "${route}" pins a frozen reading, and MCP has no pinned read — ` +
        `an artifact could only address the latest, which would break the pin. ` +
        `The gap: a version argument on loam_query (or a REST-shaped loam_read tool).`,
    );
  }
  const registered = gw.registered.find((r) => lensOf(r) === binding.schemaName);
  if (registered === undefined) {
    refuse(
      `artifact: route "${route}" reads the lens "${binding.schemaName}", which this store no longer serves`,
    );
  }
  // (2) A consumed field the schema DECLARES `bytes`. §23.7's envelope is ref-by-default and the ref is
  // fetched from an external host, which CSP blocks. The decidability is NARROWER than it sounds:
  // `type` is declared on a RESOLVER, so `bytes` is provable only for resolver-backed fields — a plain
  // policy-shaped field carries no declared type at all, and `gql.ts` types the envelope at the VALUE
  // level too. So: pack-time refusal for the subset we can prove, and a legible degrade in the shell
  // for the rest (a ref-only envelope renders a placeholder; an inline base64url renders as a data URI).
  for (const field of binding.consumes) {
    if (registered.resolvers?.[field]?.type === "bytes") {
      refuse(
        `artifact: route "${route}" consumes "${field}", which the schema declares \`bytes\` — ` +
          `a bytes ref is fetched from the byte-door, and an artifact's CSP blocks every external host`,
      );
    }
  }
  // (4) A pen, or a bundle whose SOURCE names one, without acknowledgement. §23.3's pen is server-side
  // custody by construction — the seed lives in `GatewayOptions.pens`, and an artifact has no server —
  // so the SEED was never at risk. What IS at risk is a §23.3-COMPLIANT renderer, which must SHOW which
  // pen it writes under: its markup says `editor` while the write lands as the viewer. The page cannot
  // be required to omit the name (the bundle rides verbatim, and criterion 1 depends on that), so the
  // obligation is the LAST WORD instead — the host's writer-identity statement, outside and after the
  // mount point — plus this one pack-time look at the discrepancy.
  if (binding.pen !== undefined && opts.acknowledgePen !== true) {
    refuse(
      `artifact: route "${route}" writes as the pen "${binding.pen}", and an artifact has no pen — ` +
        `every write lands as the VIEWER's own author. Acknowledge to pack it anyway.`,
    );
  }
  if (opts.acknowledgePen !== true) {
    for (const pen of penNamesInStore(gw)) {
      if (binding.bundle.includes(pen)) {
        refuse(
          `artifact: this renderer's source names the pen "${pen}", so it may tell a viewer it writes ` +
            `as that identity — on this host it writes as the viewer. Acknowledge to pack it anyway.`,
        );
      }
    }
  }
  // (5, second half) A narrower binding `writable`. `writeRoute` enforces the binding's OWN allow-list
  // at the door, atop the schema's; `loam_mutate` does not go through `writeRoute`, so on this host only
  // the schema's `writable` binds. Not a widening of anyone's authority — the viewer could always send
  // the document themselves — but it IS a difference between two hosts serving one route, and it is
  // decidable here, so the operator looks at the delta once rather than discovering it from a delta they
  // did not expect.
  const schemaWritable = [...(registered.writable ?? [])];
  const bindingWritable = binding.writable === undefined ? undefined : [...binding.writable];
  const narrowed =
    bindingWritable !== undefined &&
    bindingWritable.length < schemaWritable.length &&
    bindingWritable.every((f) => schemaWritable.includes(f));
  if (narrowed && opts.acknowledgeWritable !== true) {
    refuse(
      `artifact: this renderer narrows writes to [${bindingWritable.join(", ")}] while the schema ` +
        `allows [${schemaWritable.join(", ")}]. On the host route the binding's own list is enforced ` +
        `at the door; on this host nothing but the schema binds, so the page carries the narrower set ` +
        `as a RECEIPT of your decision rather than as a wall — a viewer's own token is accepted by the ` +
        `store either way. Acknowledge to pack it anyway.`,
    );
  }
  // (5) A bundle that REFERENCES a host-specific global. The cheap half of confinement, and what makes
  // "one address, one behavior" provable rather than hoped for. Said honestly: even a reference scan is
  // defeatable by string construction, so the realm boundary is the enforcing half — both, not either.
  const reaches = scanHostReferences(binding.bundle);
  if (reaches.length > 0) {
    const named = reaches.map((r) => `${r.name} (${r.family})`).join(", ");
    refuse(
      `artifact: this renderer reaches for host-specific globals — ${named}. A renderer is a pure ` +
        `function of its node: it runs in a realm where these are absent, and a channel that outlives ` +
        `that realm (${HOST_GLOBALS["worker"]!.slice(0, 3).join(", ")}) would hold a copy §11 cannot reach. ` +
        `A host affordance reaches an app by MEDIATION — a gesture the shell honors — never ambiently.`,
    );
  }
  // The manifest: `loam_query`, plus `loam_mutate` for a write-enabled binding, and never
  // `loam_register`. Enumerated from the door that exists.
  const manifest: string[] = ["loam_query"];
  const writes = bindingWritable !== undefined && bindingWritable.length > 0;
  if (writes || schemaWritable.length > 0) manifest.push("loam_mutate");
  if (manifest.includes(FORBIDDEN_TOOL)) {
    refuse(
      `artifact: ${FORBIDDEN_TOOL} is constitutional — a page declaring it would ask a viewer for ` +
        `store-shaping authority in order to draw a view`,
    );
  }
  // The write surface the page is PINNED to: the binding's own list where it has one, else the schema's.
  // A receipt of the operator's decision, not an allow-list.
  const acknowledgedWritable = bindingWritable ?? schemaWritable;
  const capability = capabilityStatement(registered, binding, manifest, acknowledgedWritable);
  const coordinates: ArtifactCoordinates = {
    server,
    route,
    lens: binding.schemaName,
    entity,
    consumes: [...binding.consumes],
    manifest,
    writable: acknowledgedWritable,
    storeAddress: opts.storeAddress ?? "your Loam store's /:mount/mcp door",
    refetchInterval: Math.max(opts.refetchInterval ?? DEFAULT_REFETCH_MS, DEFAULT_REFETCH_MS),
    renderTimeoutMs: gw.options.renderTimeoutMs ?? RENDER_TIMEOUT_MS,
  };
  return {
    page: artifactPage({ coordinates, binding, capability }),
    coordinates,
    capability,
    manifest,
  };
}

// Every pen name this gateway holds a seed for. The pack-time source check is a substring against THESE
// — a decidable question about a name the operator provisioned, not a judgment about the bundle.
function penNamesInStore(gw: Gateway): readonly string[] {
  return Object.keys(gw.options.pens ?? {});
}
