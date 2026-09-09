// Protected local history. Raw restore is a trusted host capability; wire signatures alone
// never establish that an event was issued by this home's channel service.
import {
  computeId,
  verifyDelta,
  type Claims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import type { Gateway } from "../gateway/gateway.js";
import { lawfulNegated } from "../gateway/registration.js";
import { containerDeclarationName, currentContainerDeclarationId } from "../gateway/container.js";
import { channelStatusImpl } from "./channel.js";
import { eraseDefect, isTombstone, readTombstones, tombstoneTarget } from "../gateway/erase.js";
import { toWire } from "./wire.js";

export const LOCAL_EVENT = "loam.local.channel.event";
export const LOCAL_CONTROL = "loam.local.channel.control";
const address = (v: unknown): v is string => typeof v === "string" && /^1e20[0-9a-f]{64}$/.test(v);
const text = (v: unknown, empty = false): v is string =>
  typeof v === "string" && (empty || v.length > 0) && !v.includes("\0");
export const inLocalContext = (d: Delta, context: string): boolean =>
  d.claims.pointers.some((p) => p.target.kind === "entity" && p.target.entity.context === context);
export const reservedLocal = (d: Delta): boolean =>
  inLocalContext(d, LOCAL_EVENT) || inLocalContext(d, LOCAL_CONTROL);
export function sameVerifiedDelta(a: Delta | undefined, b: Delta): boolean {
  return (
    a !== undefined &&
    computeId(a.claims) === a.id &&
    verifyDelta(a) === "verified" &&
    JSON.stringify(toWire(a)) === JSON.stringify(toWire(b))
  );
}
// Fold one delta into a protected set: a local event or control record protects itself, a control
// marker remembers its target even after the bytes have gone, and every strike is indexed by what
// it strikes so the closure below can follow it.
function absorb(d: Delta, roots: Set<string>, dependents: Map<string, Set<string>>): void {
  let local = false,
    control = false;
  for (const pointer of d.claims.pointers) {
    if (pointer.target.kind === "entity") {
      if (pointer.target.entity.context === LOCAL_EVENT) local = true;
      if (pointer.target.entity.context === LOCAL_CONTROL) {
        local = true;
        control = true;
      }
    } else if (
      pointer.target.kind === "delta" &&
      (pointer.role === "negates" || pointer.role === "erases")
    ) {
      const target = pointer.target.deltaRef.delta;
      const next = dependents.get(target) ?? new Set<string>();
      next.add(d.id);
      dependents.set(target, next);
    }
  }
  if (local) roots.add(d.id);
  if (control) {
    const target = tombstoneTarget(d.claims);
    if (target !== undefined) roots.add(target);
  }
}
interface ProtectedMemo {
  swept: number; // arrival-log high-water mark
  roots: Set<string>; // local events, controls, and the targets controls remember
  dependents: Map<string, Set<string>>; // struck id → the ids that strike it
}
const protectedMemo = new WeakMap<Reactor, ProtectedMemo>();
// The door runs this on EVERY append and federate, so it must not walk the store each time (H8).
// The memo sweeps the reactor's arrival log once per delta; a call then costs the batch plus the
// closure over protected ids, never the whole ground.
export function protectedIngressIds(reactor: Reactor, batch: readonly Delta[]): Set<string> {
  let memo = protectedMemo.get(reactor);
  if (memo === undefined) {
    memo = { swept: 0, roots: new Set(), dependents: new Map() };
    protectedMemo.set(reactor, memo);
  }
  const log = reactor.arrivalLog();
  for (; memo.swept < log.length; memo.swept += 1)
    absorb(log[memo.swept]!, memo.roots, memo.dependents);
  // The batch is overlaid, never written into the memo: it has not arrived yet, and may be refused.
  const protectedIds = new Set(memo.roots);
  const batchDependents = new Map<string, Set<string>>();
  for (const d of batch) absorb(d, protectedIds, batchDependents);
  const queue = [...protectedIds];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const struck = queue[cursor]!;
    for (const source of [memo.dependents.get(struck), batchDependents.get(struck)])
      for (const dependent of source ?? []) {
        if (!protectedIds.has(dependent)) {
          protectedIds.add(dependent);
          queue.push(dependent);
        }
      }
  }
  return protectedIds;
}
export interface LocalChannelOpening {
  readonly id: string;
  readonly channel: string;
  readonly into: string;
  readonly prefix: string;
  readonly from: string;
  readonly openedBy?: string;
  readonly openedFrom?: string;
  readonly statusAtOpen: string;
  readonly poolDeclaration: string;
}
export type LocalChannelEvidence =
  | { readonly state: "legacy" }
  | { readonly state: "closed"; readonly opening: LocalChannelOpening }
  | { readonly state: "unavailable"; readonly reason: string }
  | {
      readonly state: "open";
      readonly opening: LocalChannelOpening;
      readonly received: readonly Delta[];
    };
export type LocalEvent =
  | { action: "open"; opening: LocalChannelOpening }
  | { action: "received"; channel: string; into: string; opening: string; received: string[] }
  | { action: "close"; channel: string; into: string; opening: string };
export function parseLocalEvent(d: Delta, operator: string | undefined): LocalEvent | undefined {
  if (
    operator === undefined ||
    d.claims.author !== operator ||
    computeId(d.claims) !== d.id ||
    verifyDelta(d) !== "verified" ||
    !Number.isSafeInteger(d.claims.timestamp) ||
    d.claims.timestamp < 0
  )
    return;
  const ps = d.claims.pointers;
  let i = 0;
  const first = ps[i++];
  if (
    first?.role !== "event" ||
    first.target.kind !== "entity" ||
    first.target.entity.context !== LOCAL_EVENT ||
    !first.target.entity.id.startsWith("channel:")
  )
    return;
  const channel = first.target.entity.id.slice(8);
  if (!text(channel)) return;
  const primitive = (role: string): unknown => {
    const p = ps[i++];
    return p?.role === role && p.target.kind === "primitive" ? p.target.value : undefined;
  };
  const ref = (role: string): string | undefined => {
    const p = ps[i++];
    return p?.role === role &&
      p.target.kind === "delta" &&
      p.target.deltaRef.context === undefined &&
      address(p.target.deltaRef.delta)
      ? p.target.deltaRef.delta
      : undefined;
  };
  if (primitive("version") !== 1) return;
  const action = primitive("action");
  const parent = ps[i++];
  if (
    parent?.role !== PARENT_CONTAINER ||
    parent.target.kind !== "entity" ||
    parent.target.entity.context !== LOCAL_EVENT ||
    !text(parent.target.entity.id)
  )
    return;
  const parentContainer = parent.target.entity.id;
  if (action === "open") {
    const nonce = primitive("nonce"),
      into = primitive("into"),
      prefix = primitive("prefix"),
      from = primitive("from"),
      kind = primitive("opener-kind");
    if (
      typeof nonce !== "string" ||
      !/^[0-9a-f]{64}$/.test(nonce) ||
      !text(into) ||
      into !== parentContainer ||
      !text(prefix) ||
      !text(from, true)
    )
      return;
    let attribution = {};
    if (kind === "bound") {
      const openedBy = primitive("opened-by"),
        openedFrom = primitive("opened-from");
      if (!text(openedBy) || !text(openedFrom)) return;
      attribution = { openedBy, openedFrom };
    } else if (kind !== "root") return;
    const statusAtOpen = ref("status-at-open"),
      poolDeclaration = ref("pool-declaration");
    if (statusAtOpen === undefined || poolDeclaration === undefined || i !== ps.length) return;
    return {
      action,
      opening: {
        id: d.id,
        channel,
        into,
        prefix,
        from,
        ...attribution,
        statusAtOpen,
        poolDeclaration,
      },
    };
  }
  const opening = ref("opening");
  if (opening === undefined) return;
  if (action === "close" && primitive("reason") === "drop" && i === ps.length)
    return { action, channel, into: parentContainer, opening };
  if (action !== "received") return;
  const received: string[] = [];
  while (i < ps.length) {
    const id = ref("received");
    if (id === undefined || (received.length > 0 && received[received.length - 1]! >= id)) return;
    received.push(id);
  }
  return received.length > 0
    ? { action, channel, into: parentContainer, opening, received }
    : undefined;
}
/**
 * The channels whose lineage says they were opened INTO this container and still stand, read from
 * the receiver's root ground by the parent-container pointer. This is the container-scoped read a
 * bound door will serve from; no door serves it yet. Standing means the opening's pool declaration
 * survives, the erase door's own liveness test; a dropped incarnation is not listed, and neither
 * is an erased one.
 */
export function localChannelsInContainer(gw: Gateway, container: string): string[] {
  // An incarnation STANDS while its pool declaration survives, the same test the erase door uses
  // for liveness. A close event is not the sign: a refused drop leaves a close beside a standing
  // pool, and an erase that faulted after the close's tombstone leaves none beside a dropped one.
  // An erased opening is gone from the reactor; one whose purge faulted stays, but its declaration
  // is struck already, so the declaration test covers it and no marker scan is needed.
  // H8: this walks the snapshot. The parent-container pointer is an entity pointer, so a door
  // that serves this read per request must switch to `reactor.byTarget(container)` filtered to
  // the event context, the affordance `lawfulDeltasAt` uses; then one `get` and one negation
  // read per opening.
  const negated = lawfulNegated(gw.reactor, gw.operatorAuthor);
  const names = new Set<string>();
  for (const d of gw.reactor.snapshot()) {
    if (!inLocalContext(d, LOCAL_EVENT)) continue;
    const parsed = parseLocalEvent(d, gw.operatorAuthor);
    if (parsed?.action !== "open" || parsed.opening.into !== container) continue;
    const declaration = parsed.opening.poolDeclaration;
    if (gw.reactor.get(declaration) !== undefined && !negated(declaration))
      names.add(parsed.opening.channel);
  }
  return [...names].sort();
}
/**
 * Is a pool attached under this declaration an ORPHAN? It is when no surviving opening names the
 * declaration: the operator declared it by hand, beside or instead of the one an opening named.
 * Boot attaches only surviving declarations and a handle keeps the declaration it attached under,
 * so a struck declaration never sits beneath a pool here. The erase door and the drop both ask
 * this, so that an orphan reads the same across a restart as inside the process that made it.
 */
/** Did this channel name ever carry a protected opening, standing or erased? */
export function channelHadOpening(gw: Gateway, channel: string): boolean {
  const id = `channel:${channel}`;
  for (const d of gw.reactor.snapshot()) {
    if (inLocalContext(d, LOCAL_EVENT)) {
      if (
        d.claims.pointers.some(
          (p) => p.role === "event" && p.target.kind === "entity" && p.target.entity.id === id,
        )
      )
        return true;
    } else if (inLocalContext(d, LOCAL_CONTROL) && localControlChannel(d) === id) return true;
  }
  return false;
}
export function orphanedDeclaration(gw: Gateway, declaration: string): boolean {
  for (const d of gw.reactor.snapshot()) {
    if (!inLocalContext(d, LOCAL_EVENT)) continue;
    const parsed = parseLocalEvent(d, gw.operatorAuthor);
    // An event this reader cannot parse is not "no opening names it"; it fails closed, so a purge
    // never rides a parser change or a malformed restore.
    if (parsed === undefined) return false;
    if (parsed.action === "open" && parsed.opening.poolDeclaration === declaration) return false;
  }
  return true;
}
export function localEraseTarget(
  d: Delta,
  reactor: Reactor,
  operator: string | undefined,
): string | undefined {
  if (
    !isTombstone(d.claims) ||
    !sameVerifiedDelta(d, d) ||
    eraseDefect(d, reactor, operator) !== undefined
  )
    return;
  const markers = d.claims.pointers.filter(
    (p) => p.target.kind === "entity" && p.target.entity.context === LOCAL_CONTROL,
  );
  const versions = d.claims.pointers.filter((p) => p.role === "local-control-version");
  const kinds = d.claims.pointers.filter((p) => p.role === "local-control-kind");
  const channels = d.claims.pointers.filter((p) => p.role === "local-control-channel");
  const marker = markers[0],
    version = versions[0],
    kind = kinds[0],
    channel = channels[0],
    target = tombstoneTarget(d.claims);
  if (
    markers.length !== 1 ||
    marker?.role !== "local-control" ||
    marker.target.kind !== "entity" ||
    marker.target.entity.id !== target ||
    !address(target) ||
    versions.length !== 1 ||
    version?.target.kind !== "primitive" ||
    version.target.value !== 1 ||
    kinds.length !== 1 ||
    kind?.target.kind !== "primitive" ||
    kind.target.value !== "erase" ||
    channels.length !== 1 ||
    channel?.target.kind !== "primitive" ||
    !text(channel.target.value) ||
    !channel.target.value.startsWith("channel:")
  )
    return;
  return target;
}
/** The channel entity id a validated local-control marker names; call after localEraseTarget. */
export function localControlChannel(d: Delta): string | undefined {
  const p = d.claims.pointers.find((p) => p.role === "local-control-channel");
  return p?.target.kind === "primitive" && typeof p.target.value === "string"
    ? p.target.value
    : undefined;
}
export function currentPoolDeclaration(gw: Gateway, name: string): string | undefined {
  return currentContainerDeclarationId(gw.reactor, gw.operatorAuthor, name);
}
const field = (d: Delta, role: string): unknown => {
  const ps = d.claims.pointers.filter((p) => p.role === role);
  return ps.length === 1 && ps[0]!.target.kind === "primitive" ? ps[0]!.target.value : undefined;
};
export function openingAgrees(gw: Gateway, o: LocalChannelOpening): boolean {
  const status = gw.reactor.get(o.statusAtOpen),
    declaration = gw.reactor.get(o.poolDeclaration);
  const dead = readTombstones(gw.reactor, gw.operatorAuthor);
  if (
    status === undefined ||
    declaration === undefined ||
    dead.has(status.id) ||
    dead.has(declaration.id) ||
    !sameVerifiedDelta(status, status) ||
    !sameVerifiedDelta(declaration, declaration) ||
    status.claims.author !== gw.operatorAuthor ||
    declaration.claims.author !== gw.operatorAuthor
  )
    return false;
  const marker = status.claims.pointers.filter((p) => p.role === "channel");
  return (
    marker.length === 1 &&
    marker[0]!.target.kind === "entity" &&
    marker[0]!.target.entity.context === "loam.channel" &&
    marker[0]!.target.entity.id === `channel:${o.channel}` &&
    field(status, "into") === o.into &&
    field(status, "prefix") === o.prefix &&
    (field(status, "from") ?? "") === o.from &&
    field(status, "openedBy") === o.openedBy &&
    field(status, "openedFrom") === o.openedFrom &&
    field(declaration, "inboxOf") === o.into &&
    containerDeclarationName(declaration.claims) === o.channel
  );
}
type LocalChannelLifecycle =
  | Exclude<LocalChannelEvidence, { readonly state: "open" }>
  | { readonly state: "open"; readonly opening: LocalChannelOpening };
type LocalChannelHistory =
  | Exclude<LocalChannelLifecycle, { readonly state: "open" }>
  | {
      readonly state: "open";
      readonly opening: LocalChannelOpening;
      readonly ground: Gateway;
      readonly receivedIds: readonly string[];
    };

/** Cleanup requires a valid lifecycle, even when received source bytes have been erased. */
export function localChannelLifecycle(gw: Gateway, channel: string): LocalChannelLifecycle {
  const history = projectLocalChannelHistory(gw, channel);
  return history.state === "open"
    ? Object.freeze({ state: "open", opening: history.opening })
    : history;
}
function projectLocalChannelHistory(gw: Gateway, channel: string): LocalChannelHistory {
  const unavailable = (reason: string): LocalChannelHistory => ({ state: "unavailable", reason });
  const rows = [...gw.reactor.snapshot()];
  const dead = new Set<string>();
  let erasedHere = 0; // markers naming THIS channel: erased history is never legacy history
  for (const d of rows)
    if (inLocalContext(d, LOCAL_CONTROL)) {
      const target = localEraseTarget(d, gw.reactor, gw.operatorAuthor);
      if (target === undefined)
        return unavailable("unsupported or malformed local control history");
      dead.add(target);
      if (localControlChannel(d) === `channel:${channel}`) erasedHere += 1;
    }
  const named = (d: Delta): boolean =>
    d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.context === LOCAL_EVENT &&
        p.target.entity.id === `channel:${channel}`,
    );
  const namedIds = new Set(
    rows.filter((d) => inLocalContext(d, LOCAL_EVENT) && named(d)).map((d) => d.id),
  );
  const relevant = rows.filter(
    (d) =>
      inLocalContext(d, LOCAL_EVENT) &&
      (named(d) ||
        d.claims.pointers.some(
          (p) =>
            p.role === "opening" &&
            p.target.kind === "delta" &&
            namedIds.has(p.target.deltaRef.delta),
        )),
  );
  if (relevant.some((d) => !named(d)))
    return unavailable("event channel disagrees with referenced opening");
  const events: LocalEvent[] = [];
  for (const d of relevant) {
    if (dead.has(d.id)) continue;
    const parsed = parseLocalEvent(d, gw.operatorAuthor);
    if (parsed === undefined) return unavailable("invalid local event history");
    events.push(parsed);
  }
  if (events.length === 0)
    return erasedHere > 0 || (dead.size > 0 && relevant.length > 0)
      ? unavailable("erased opening")
      : { state: "legacy" };
  for (const event of events)
    if (event.action === "open" && !openingAgrees(gw, event.opening))
      return unavailable("opening association disagrees with referenced status/pool");
  const pool = gw.channelPools.get(channel),
    status = channelStatusImpl(gw, channel)[0];
  if (
    pool?.gateway === undefined ||
    status === undefined ||
    !gw.quarantinePools.has(pool.gateway) ||
    pool.gateway.attachedTo !== gw
  )
    return unavailable("opening has no exact attached pool/status");
  const declaration = currentPoolDeclaration(gw, channel);
  if (declaration === undefined || pool.declarationId !== declaration)
    return unavailable("attached pool declaration changed");
  const opens = events.filter(
    (e): e is Extract<LocalEvent, { action: "open" }> =>
      e.action === "open" && e.opening.poolDeclaration === declaration,
  );
  if (opens.length !== 1)
    return unavailable(
      opens.length > 1 ? "multiple ambiguous current openings" : "missing current opening",
    );
  const o = opens[0]!.opening;
  if (
    !openingAgrees(gw, o) ||
    status.into !== o.into ||
    status.prefix !== o.prefix ||
    status.from !== o.from ||
    status.openedBy !== o.openedBy ||
    status.openedFrom !== o.openedFrom
  )
    return unavailable("opening association disagrees with status/pool");
  for (const event of events)
    if (
      event.action !== "open" &&
      !events.some((e) => e.action === "open" && e.opening.id === event.opening)
    )
      return unavailable("missing referenced opening");
  const opening = Object.freeze({ ...o });
  if (events.some((e) => e.action === "close" && e.opening === o.id))
    return { state: "closed", opening };
  const ids = new Set(
    events.flatMap((e) => (e.action === "received" && e.opening === o.id ? e.received : [])),
  );
  return { state: "open", opening, ground: pool.gateway, receivedIds: [...ids].sort() };
}
export function localChannelEvidence(gw: Gateway, channel: string): LocalChannelEvidence {
  const history = projectLocalChannelHistory(gw, channel);
  if (history.state !== "open") return history;
  const { opening, ground, receivedIds } = history;
  const received: Delta[] = [];
  const sourceDead = readTombstones(ground.reactor, ground.operatorAuthor);
  for (const id of receivedIds) {
    const d = ground.reactor.get(id);
    if (d === undefined || sourceDead.has(id) || !sameVerifiedDelta(d, d))
      return { state: "unavailable", reason: `missing received source ${id}` };
    received.push(immutableCopy(d));
  }
  return Object.freeze({ state: "open", opening, received: Object.freeze(received) });
}
// Typed-array views cannot be frozen by JavaScript. Their owning frozen property returns a
// detached copy, while the rest of the signed claim graph is frozen recursively.
function immutableCopy(d: Delta): Delta {
  const copy = structuredClone(d);
  const freeze = (value: object): void => {
    for (const [key, child] of Object.entries(value) as [string, unknown][]) {
      if (child instanceof Uint8Array) {
        const bytes = child.slice();
        Object.defineProperty(value, key, {
          enumerable: true,
          configurable: false,
          get: () => bytes.slice(),
        });
      } else if (child !== null && typeof child === "object") freeze(child);
    }
    Object.freeze(value);
  };
  freeze(copy);
  return copy;
}
export function withChannelCommit<T>(
  gw: Gateway,
  channel: string,
  body: () => Promise<T>,
): Promise<T> {
  const seen = new Set<Gateway>();
  while (gw.attachedTo !== undefined) {
    if (seen.has(gw) || !gw.attachedTo.quarantinePools.has(gw))
      throw new Error("channel commit requires a legitimate authority attachment");
    seen.add(gw);
    gw = gw.attachedTo;
  }
  const prior = gw.channelCommitTails.get(channel) ?? Promise.resolve();
  const next = prior.then(body);
  const tail = next.then(
    () => {},
    () => {},
  );
  gw.channelCommitTails.set(channel, tail);
  void tail.then(() => {
    if (gw.channelCommitTails.get(channel) === tail) gw.channelCommitTails.delete(channel);
  });
  return next;
}
export const eventPrimitive = (
  role: string,
  value: string | number,
): Claims["pointers"][number] => ({ role, target: { kind: "primitive", value } });
export const eventRef = (role: string, delta: string): Claims["pointers"][number] => ({
  role,
  target: { kind: "delta", deltaRef: { delta } },
});
// The parent container rides every event at a PINNED position, in the event vocabulary (never
// `container`/`loam.container`, which the container table would read as law). It scopes reads:
// a bound connection's lineage read filters by it, and so may the operator's.
export const PARENT_CONTAINER = "parent-container";
export function eventHeader(channel: string, action: string, into: string): Claims["pointers"] {
  return [
    {
      role: "event",
      target: { kind: "entity", entity: { id: `channel:${channel}`, context: LOCAL_EVENT } },
    },
    eventPrimitive("version", 1),
    eventPrimitive("action", action),
    {
      role: PARENT_CONTAINER,
      target: { kind: "entity", entity: { id: into, context: LOCAL_EVENT } },
    },
  ];
}
