import { seedSigner } from "./signer.js";
import type { Claims } from "@bombadil/rhizomatic";
import { ARTIFACT_SPAWN_TIMEOUT_MS, artifactPage } from "./artifact-page.js";
import { HOST_GLOBALS, scanHostReferences } from "./artifact-scan.js";
import type { Gateway, RequestContext } from "./gateway.js";
import { RENDER_TIMEOUT_MS } from "./render-worker.js";
import { byLens, lensOf } from "./registration.js";
import { lawfulDeltasAt } from "./lawful.js";
import { negatedAt } from "./negation.js";
import type { Registered } from "../surface/surface.js";
import type { RendererBinding } from "./renderers.js";
import { withStamp } from "./stamp.js";
import type { Ground } from "./ground.js";

export const ARTIFACT_ENTITY = "loam:artifact";
export const CTX_ARTIFACT = "loam.artifact";

const FORBIDDEN_TOOL = "loam_register";

export const MAX_CONNECTOR_NAME = 128;

export interface ArtifactCoordinates {
  readonly server: string;
  readonly route: string;
  readonly lens: string;
  readonly entity: string;
  readonly consumes: readonly string[];
  readonly manifest: readonly string[];
  readonly writable: readonly string[];
  readonly storeAddress: string;
  readonly refetchInterval: number;
  readonly renderTimeoutMs: number;
  readonly renderSpawnTimeoutMs: number;
}

const DEFAULT_REFETCH_MS = 30_000;

export function artifactClaims(
  routes: readonly string[],
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
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

export function readArtifactRoutes(
  reactor: Ground,
  now: number,
  operator?: string,
): ReadonlySet<string> {
  const open = new Set<string>();
  if (operator === undefined) return open;
  const negated = negatedAt(reactor, now, operator);
  for (const delta of lawfulDeltasAt(
    reactor,
    now,
    { entity: ARTIFACT_ENTITY, context: CTX_ARTIFACT },
    operator,
  )) {
    if (negated(delta.id)) continue;
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

export async function declareArtifactImpl(
  gw: Gateway,
  routes: readonly string[],
  context?: RequestContext,
): Promise<void> {
  const signer = context?.actor !== undefined ? seedSigner(context.actor) : gw.signer;
  if (signer === undefined) {
    throw new Error("this gateway holds no signing seed and cannot declare an artifact route");
  }
  if (gw.operatorAuthor !== undefined && signer.author !== gw.operatorAuthor) {
    throw new Error("append rejected: only the operator may declare an artifact route");
  }
  if (routes.length === 0 || routes.some((r) => typeof r !== "string" || r === "")) {
    throw new Error("artifact: declare at least one non-empty route");
  }
  await gw.append([
    signer.sign(
      withStamp(gw.stamp(signer.author), (t) => artifactClaims(routes, signer.author, t)),
    ),
  ]);
}

export function capabilityStatement(
  registered: Registered,
  binding: RendererBinding,
  manifest: readonly string[],
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

export interface PackArtifactOptions {
  readonly server: string;
  readonly storeAddress?: string;
  readonly acknowledgePen?: boolean;
  readonly acknowledgeWritable?: boolean;
  readonly refetchInterval?: number;
}

export interface PackedArtifact {
  readonly page: string;
  readonly coordinates: ArtifactCoordinates;
  readonly capability: readonly string[];
  readonly manifest: readonly string[];
}

function refuse(why: string): never {
  throw new Error(why);
}

export function packArtifactImpl(
  gw: Gateway,
  route: string,
  entity: string,
  opts: PackArtifactOptions,
): PackedArtifact {
  if (gw.probation !== undefined) {
    refuse(
      "artifact: this store is a quarantine pool, and a packed page would carry none of the " +
        "probation its served route shows — promote what you want to keep, then pack it there",
    );
  }
  const server = opts.server;
  if (typeof server !== "string" || server.trim() === "") {
    refuse("artifact: --connector wants the display name of the connector this page reads through");
  }
  if (server.length > MAX_CONNECTOR_NAME) {
    refuse(
      `artifact: a connector display name may not exceed ${MAX_CONNECTOR_NAME} characters (got ${server.length})`,
    );
  }
  if (!gw.artifactRoutes().has(route)) {
    refuse(
      `artifact: route "${route}" is not declared publishable — declare it (loam.artifact) before packing it`,
    );
  }
  const binding = gw.renderers().find((r) => r.route === route);
  if (binding === undefined) {
    refuse(`artifact: no renderer is bound at route "${route}"`);
  }
  if (binding.versionId !== undefined) {
    refuse(
      `artifact: route "${route}" pins a frozen reading, and MCP has no pinned read — ` +
        `an artifact could only address the latest, which would break the pin. ` +
        `The gap: a version argument on loam_query (or a REST-shaped loam_read tool).`,
    );
  }
  const registered = byLens(gw.registered, binding.schemaName);
  if (registered === undefined) {
    refuse(
      `artifact: route "${route}" reads the lens "${binding.schemaName}", which this store no longer serves`,
    );
  }
  for (const field of binding.consumes) {
    if (registered.resolvers?.[field]?.type === "bytes") {
      refuse(
        `artifact: route "${route}" consumes "${field}", which the schema declares \`bytes\` — ` +
          `a bytes ref is fetched from the byte-door, and an artifact's CSP blocks every external host`,
      );
    }
  }
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
  const manifest: string[] = ["loam_query"];
  const writes = bindingWritable !== undefined && bindingWritable.length > 0;
  if (writes || schemaWritable.length > 0) manifest.push("loam_mutate");
  if (manifest.includes(FORBIDDEN_TOOL)) {
    refuse(
      `artifact: ${FORBIDDEN_TOOL} is constitutional — a page declaring it would ask a viewer for ` +
        `store-shaping authority in order to draw a view`,
    );
  }
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
    renderSpawnTimeoutMs: ARTIFACT_SPAWN_TIMEOUT_MS,
  };
  return {
    page: artifactPage({ coordinates, binding, capability }),
    coordinates,
    capability,
    manifest,
  };
}

function penNamesInStore(gw: Gateway): readonly string[] {
  return Object.keys(gw.options.pens ?? {});
}
