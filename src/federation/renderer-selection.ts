// A bound connection asks which RECEIVED renderer would read the CURRENT law in its channel, and
// gets exact ids back — or a typed refusal. This is a reading and nothing else: it runs no code,
// appends no delta, mints no grant, and its answer is not a token. The later act that admits and
// records an activation re-runs this at commit; an answer handed across that boundary proves
// nothing about the moment it is used.
//
// Three refusals are kept apart on purpose, because a caller acts differently on each. The
// connection is not entitled to ask (`not_authorized`); the channel's received history is not
// whole, so no answer about it can be trusted (`source_unavailable`, T288's completeness rule —
// any attested member missing, erased or unreadable refuses, however unrelated it looks); the
// renderer at the route is absent or not read-only code (`renderer_ineligible`); the law it would
// read is not the law the destination currently serves (`law_unavailable`).

import type { Delta } from "@bombadil/rhizomatic";
import {
  classifyExactReceivedSchema,
  readLawAdoptions,
  sameSchemaLaw,
  survivalOver,
} from "../gateway/adopt-law.js";
import { boundChannelAdmits } from "../gateway/connection-authority.js";
import { inboxName, readContainerTable, withinSubtree } from "../gateway/container.js";
import type { ConnectionBinding, Gateway } from "../gateway/gateway.js";
import { readRegistrations } from "../gateway/registration.js";
import { CTX_RENDERER } from "../gateway/renderers.js";
import { channelStatusImpl } from "./channel.js";
import { localChannelEvidence } from "./local-channel-events.js";

export interface RendererSelectionRequester {
  /** The connection's author key, never its seed. */
  readonly requester: string;
  readonly binding: ConnectionBinding;
}

export interface ReceivedRendererSelection {
  readonly destination: string;
  readonly channel: string;
  readonly opening: string;
  readonly route: string;
  /** The renderer binding's full delta id — the one identity a later activation pins. */
  readonly sourceDelta: string;
  readonly sourceLens: string;
  readonly destinationLens: string;
  readonly sourceRegistration: string;
  readonly destinationRegistration: string;
  /** Sorted, unique: the source binding and the definition rows its law loads from. */
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

// A renderer binding's own roles are read one pointer each below; a duplicate is malformed rather
// than a harmless extra, and a pointer in another role (a `negates`, a provenance note) rides
// along without changing what is bound. These three make a binding write-capable or version-
// pinned, and any of them, well-formed or half-written, puts it outside a read-only selection.
const WRITE_ROLES = new Set(["pen", "writable", "versionId"]);

interface ReadOnlyRenderer {
  readonly id: string;
  readonly schemaName: string;
  readonly consumes: readonly string[];
}

/**
 * Read one renderer binding strictly, or say why it is not one this act may select. A binding
 * that `rendererBindingOf` would quietly drop half of (a pen without a `writable`, a `versionId`)
 * is refused here whole: a selection that ran it read-only would be running code its author
 * published to write with.
 */
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

/**
 * Which received renderer at `route` would read the current law of `binding`'s channel?
 *
 * Synchronous and write-free. Each call reads the current state whole: the connection's standing,
 * the channel's complete received history, the latest surviving renderer at the route, the
 * source registration that is current for the lens the renderer names, and the destination row
 * that lens is bound to under the channel's prefix — and refuses the moment any of them is not
 * what the answer would claim.
 */
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

  // AUTHORITY. The inbox must be the one this key's binding names — a standing inbox of another
  // key in the same container is somebody else's grant. `boundChannelAdmits` then asks the rest:
  // the connection stands, the channel's opener is this inbox and its grant survives (which pins
  // `openedBy` too, since the inbox name carries the container), and the destination receives
  // now. Reach is the one question it does not ask.
  if (inboxName(exact.container, key) !== exact.inbox)
    throw refusal("not_authorized", "the inbox named is not this requester's");
  const status = channelStatusImpl(gw, input.channel)[0];
  if (
    status === undefined ||
    !boundChannelAdmits(gw, exact, status) ||
    !withinSubtree(readContainerTable(gw.reactor, gw.operatorAuthor), status.into, exact.container)
  )
    throw refusal(
      "not_authorized",
      `${input.channel} is not a channel this connection opened into its container`,
    );

  // THE COMPLETE RECEIVED OPERAND, or nothing. Legacy history never attested what arrived; a closed
  // channel's incarnation is over; and an opening whose status or pool no longer agrees is not the
  // opening these receipts were issued under.
  const evidence = localChannelEvidence(gw, input.channel);
  if (evidence.state !== "open")
    throw refusal(
      "source_unavailable",
      evidence.state === "unavailable"
        ? `the attested history of ${input.channel} cannot be read whole: ${evidence.reason}`
        : `${input.channel} has no open attested incarnation (${evidence.state})`,
    );
  // An "open" verdict already certifies that the opening agrees with the standing status and the
  // attached pool: the projection refuses otherwise.
  const opening = evidence.opening;
  const received = evidence.received;
  const survives = survivalOver(received);
  const pool = gw.channelPools.get(input.channel)?.gateway;
  if (pool?.operatorAuthor === undefined)
    throw refusal("source_unavailable", `${input.channel} has no attached pool`);
  // WHAT THE RECEIPTS DO NOT SAY. Survival is decided over the received operand alone, so a strike
  // the pool holds without a receipt — its receipt erased, or the strike admitted under an earlier
  // incarnation — would count for nothing, and a binding its author took back would read as the
  // latest surviving word. Such a strike is not admitted into the operand (the operand is T288's,
  // whole); it is a hole in the history, and the answer refuses rather than reads past it.
  const receivedIds = new Set(received.map((d) => d.id));
  for (const d of received) {
    for (const id of pool.reactor.negationsOf(d.id)) {
      const n = pool.reactor.get(id);
      if (n === undefined || n.claims.author !== d.claims.author || receivedIds.has(id)) continue;
      throw refusal(
        "source_unavailable",
        `the pool of ${input.channel} holds ${id}, a strike of received ${d.id} by its own ` +
          `author, that no surviving receipt of the current opening names`,
      );
    }
  }

  // THE RENDERER: the latest surviving candidate at the route, then read strictly. An older valid
  // binding never stands in for a newer malformed or write-capable one — the peer's latest word at
  // the route is what would run, and if that cannot be selected, nothing at the route can.
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

  // THE LAW. The destination row is the one the channel bound under its prefix; the source
  // registration is whichever adoption of that row classifies, exactly, as the current binding
  // of the lens the renderer names, with the same law and the same roots. A curse on the derived
  // read, with the same law and the same roots. A curse on the derived name strikes the pool's
  // binding, so a cursed lens has no row here and refuses on that.
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
  // BOTH LEVELS. The served row is what a reader resolves through today; the pool's own lawful
  // registration is what the bytes say. The bound fold is cached on row ids, so a definition
  // rewritten under an unchanged binding moves the bytes and not the row — and an answer that
  // read only the row would name law nobody's bytes still carry. When the two disagree, the
  // disagreement is the fault, and no source can match both.
  const bytes = readRegistrations(pool.reactor, pool.operatorAuthor).find(
    (r) => String(r.lensName) === destinationLens,
  );
  if (
    bytes === undefined ||
    bytes.boundId !== destinationRegistration ||
    !sameSchemaLaw(bytes, row)
  )
    throw refusal(
      "law_unavailable",
      `the bound surface and the pool's own registration disagree about ${destinationLens}`,
    );
  // At most one registration can classify as CURRENT for a lens, so the join is unique when it
  // exists; duplicate records naming it are one answer.
  const matches = new Map<string, readonly string[]>();
  const faults: string[] = [];
  for (const adoption of readLawAdoptions(pool.reactor, pool.operatorAuthor)) {
    if (adoption.adoptedDelta !== row.boundId) continue;
    try {
      const law = classifyExactReceivedSchema(received, renderer.schemaName, adoption.sourceDelta);
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
