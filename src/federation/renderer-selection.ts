import type { Delta } from "@bombadil/rhizomatic";
import {
  classifyExactReceivedSchema,
  readLawAdoptions,
  sameSchemaLaw,
} from "../gateway/adopt-law.js";
import { survivalOver } from "../gateway/adopt-vocab.js";
import { boundChannelAdmits } from "../gateway/connection-authority.js";
import { inboxName, readContainerTable, withinSubtree } from "../gateway/container-law.js";
import type { ConnectionBinding, Gateway } from "../gateway/gateway.js";
import { CTX_RENDERER } from "../gateway/renderers.js";
import { channelStatusImpl } from "./channel.js";
import { localChannelEvidence } from "./local-channel-events.js";

export interface RendererSelectionRequester {
  readonly requester: string;
  readonly binding: ConnectionBinding;
}

export interface ReceivedRendererSelection {
  readonly destination: string;
  readonly channel: string;
  readonly opening: string;
  readonly route: string;
  readonly sourceDelta: string;
  readonly sourceLens: string;
  readonly destinationLens: string;
  readonly sourceRegistration: string;
  readonly destinationRegistration: string;
  readonly sourceLineage: readonly string[];
}

export type RendererSelectionCode =
  | "invalid_request"
  | "not_authorized"
  | "source_unavailable"
  | "renderer_ineligible"
  | "law_unavailable";

export class RendererSelectionRefusal extends Error {
  readonly code: RendererSelectionCode;
  constructor(code: RendererSelectionCode, message: string) {
    super(message);
    this.name = "RendererSelectionRefusal";
    this.code = code;
  }
}

const refusal = (code: RendererSelectionCode, message: string): RendererSelectionRefusal =>
  new RendererSelectionRefusal(code, message);

const AUTHOR_KEY = /^ed25519:[0-9a-f]{64}$/;
const sound = (s: unknown): s is string => typeof s === "string" && s !== "" && !s.includes("\0");

const WRITE_ROLES = new Set(["pen", "writable", "versionId"]);

interface ReadOnlyRenderer {
  readonly id: string;
  readonly schemaName: string;
  readonly consumes: readonly string[];
}

function readOnlyRenderer(d: Delta, route: string): ReadOnlyRenderer | string {
  const markers = d.claims.pointers.filter(
    (p) => p.target.kind === "entity" && p.target.entity.context === CTX_RENDERER,
  );
  const marker = markers[0];
  if (markers.length !== 1 || marker?.target.kind !== "entity")
    return `carries ${markers.length} renderer markers`;
  if (marker.role !== "renders" || marker.target.entity.id !== `renderer:${route}`)
    return `its renderer marker is ${marker.role} ${marker.target.entity.id}`;
  for (const p of d.claims.pointers) {
    if (WRITE_ROLES.has(p.role)) return `carries a ${p.role} role, so it is not read-only code`;
  }
  const scalar = (role: string): string | undefined => {
    const hits = d.claims.pointers.filter((p) => p.role === role);
    const target = hits[0]?.target;
    return hits.length === 1 && target?.kind === "primitive" && typeof target.value === "string"
      ? target.value
      : undefined;
  };
  const named = scalar("route");
  if (named !== route || route.includes("/")) return `names route ${JSON.stringify(named)}`;
  const schemaName = scalar("schema");
  if (!sound(schemaName)) return "names no schema";
  const consumesJson = scalar("consumes");
  let consumes: unknown;
  try {
    consumes = consumesJson === undefined ? undefined : JSON.parse(consumesJson);
  } catch {
    return "its consumes list is not JSON";
  }
  if (
    !Array.isArray(consumes) ||
    !consumes.every(sound) ||
    new Set(consumes).size !== consumes.length
  )
    return "its consumes list is not a list of distinct field names";
  const bundle = scalar("bundle");
  if (!sound(bundle)) return "carries no bundle";
  return { id: d.id, schemaName, consumes };
}

export function selectRendererForActivation(
  gw: Gateway,
  requester: RendererSelectionRequester,
  input: { readonly channel: string; readonly route: string },
): ReceivedRendererSelection {
  const key = requester?.requester;
  const binding = requester?.binding;
  if (!sound(key) || !AUTHOR_KEY.test(key))
    throw refusal("invalid_request", "requester is not an author key");
  if (!sound(binding?.container) || !sound(binding?.inbox))
    throw refusal("invalid_request", "binding must name a container and an inbox");
  if (!sound(input?.channel)) throw refusal("invalid_request", "channel must be named");
  if (!sound(input?.route) || input.route.includes("/"))
    throw refusal("invalid_request", "route must be a single non-empty segment");
  const exact: ConnectionBinding = { container: binding.container, inbox: binding.inbox };

  if (inboxName(exact.container, key) !== exact.inbox)
    throw refusal("not_authorized", "the inbox named is not this requester's");
  const status = channelStatusImpl(gw, input.channel)[0];
  if (
    status === undefined ||
    !boundChannelAdmits(gw, exact, status) ||
    !withinSubtree(
      readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor),
      status.into,
      exact.container,
    )
  )
    throw refusal(
      "not_authorized",
      `${input.channel} is not a channel this connection opened into its container`,
    );

  const evidence = localChannelEvidence(gw, input.channel);
  if (evidence.state !== "open")
    throw refusal(
      "source_unavailable",
      evidence.state === "unavailable"
        ? `the attested history of ${input.channel} cannot be read whole: ${evidence.reason}`
        : `${input.channel} has no open attested incarnation (${evidence.state})`,
    );
  const opening = evidence.opening;
  const received = evidence.received;
  const survives = survivalOver(received, gw.validityNow());
  const pool = gw.store.channels(gw).get(input.channel)?.gateway;
  if (pool?.operatorAuthor === undefined)
    throw refusal("source_unavailable", `${input.channel} has no attached pool`);
  const receivedIds = new Set(received.map((d) => d.id));
  for (const d of received) {
    for (const id of pool.reactor.negationsOf(d.id)) {
      const n = pool.reactor.get(id);
      if (n === undefined || n.claims.author !== d.claims.author || receivedIds.has(id)) continue;
      throw refusal(
        "source_unavailable",
        `the pool of ${input.channel} holds ${id}, a negation of received ${d.id} by its own ` +
          `author, that no surviving receipt of the current opening names`,
      );
    }
  }

  const marker = `renderer:${input.route}`;
  const candidates = received.filter(
    (d) =>
      survives(d.id) &&
      d.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.context === CTX_RENDERER &&
          p.target.entity.id === marker,
      ),
  );
  const latest = [...candidates]
    .sort(
      (a, b) => a.claims.timestamp - b.claims.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .at(-1);
  if (latest === undefined)
    throw refusal(
      "renderer_ineligible",
      `no received renderer at route ${JSON.stringify(input.route)}`,
    );
  const renderer = readOnlyRenderer(latest, input.route);
  if (typeof renderer === "string")
    throw refusal(
      "renderer_ineligible",
      `the current renderer at ${JSON.stringify(input.route)} ${renderer}`,
    );

  const destinationLens = `${status.prefix}:${renderer.schemaName}`;
  const row = gw
    .boundSurface(exact)
    .registered.find(
      (r) =>
        String(r.lensName) === destinationLens &&
        r.channel === input.channel &&
        r.origin === "store" &&
        r.boundId !== undefined,
    );
  const destinationRegistration = row?.boundId;
  if (row === undefined || destinationRegistration === undefined)
    throw refusal(
      "law_unavailable",
      `${destinationLens} is not bound in ${exact.container} from ${input.channel}`,
    );
  for (const field of renderer.consumes) {
    if (!row.schema.props.has(field))
      throw refusal(
        "law_unavailable",
        `the renderer consumes ${JSON.stringify(field)}, which ${destinationLens} does not serve`,
      );
  }
  const matches = new Map<string, readonly string[]>();
  const faults: string[] = [];
  for (const adoption of readLawAdoptions(pool.reactor, pool.validityNow(), pool.operatorAuthor)) {
    if (adoption.adoptedDelta !== row.boundId) continue;
    try {
      const law = classifyExactReceivedSchema(
        received,
        renderer.schemaName,
        adoption.sourceDelta,
        gw.validityNow(),
      );
      if (
        adoption.alias !== renderer.schemaName ||
        adoption.target !== law.entity ||
        adoption.producedBy !== law.author ||
        !sameSchemaLaw(law, row) ||
        law.roots.length !== row.roots.length ||
        law.roots.some((r, i) => r !== row.roots[i])
      ) {
        faults.push(
          `${adoption.sourceDelta}: the adoption record does not describe the current source law`,
        );
        continue;
      }
      matches.set(law.registration, law.lineage);
    } catch (err) {
      faults.push(`${adoption.sourceDelta}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (matches.size === 0)
    throw refusal(
      "law_unavailable",
      `no adoption of ${destinationLens} names the current source law of ${renderer.schemaName}` +
        (faults.length === 0 ? "" : ` (${faults.join("; ")})`),
    );
  const [sourceRegistration, lineage] = [...matches][0]!;
  return Object.freeze({
    destination: exact.container,
    channel: input.channel,
    opening: opening.id,
    route: input.route,
    sourceDelta: renderer.id,
    sourceLens: renderer.schemaName,
    destinationLens,
    sourceRegistration,
    destinationRegistration,
    sourceLineage: Object.freeze([...new Set(lineage)].sort()),
  });
}
