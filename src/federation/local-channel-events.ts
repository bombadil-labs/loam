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
import { channelStatusImpl } from "./channel.js";
import { lawfulNegated } from "../gateway/registration.js";
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
export function protectedIngressIds(reactor: Reactor, batch: readonly Delta[]): Set<string> {
  const all = [...reactor.snapshot(), ...batch];
  const protectedIds = new Set(all.filter(reservedLocal).map((d) => d.id));
  // Markers remember the protected target even after its bytes have gone.
  for (const d of all)
    if (inLocalContext(d, LOCAL_CONTROL)) {
      const id = tombstoneTarget(d.claims);
      if (id !== undefined) protectedIds.add(id);
    }
  for (let changed = true; changed;) {
    changed = false;
    for (const d of all)
      if (
        !protectedIds.has(d.id) &&
        d.claims.pointers.some(
          (p) =>
            (p.role === "negates" || p.role === "erases") &&
            p.target.kind === "delta" &&
            protectedIds.has(p.target.deltaRef.delta),
        )
      ) {
        protectedIds.add(d.id);
        changed = true;
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
  | { action: "received"; channel: string; opening: string; received: string[] }
  | { action: "close"; channel: string; opening: string };
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
    return { action, channel, opening };
  if (action !== "received") return;
  const received: string[] = [];
  while (i < ps.length) {
    const id = ref("received");
    if (id === undefined || (received.length > 0 && received[received.length - 1]! >= id)) return;
    received.push(id);
  }
  return received.length > 0 ? { action, channel, opening, received } : undefined;
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
  const marker = markers[0],
    version = versions[0],
    kind = kinds[0],
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
    kind.target.value !== "erase"
  )
    return;
  return target;
}
export function currentPoolDeclaration(gw: Gateway, name: string): string | undefined {
  const negated = lawfulNegated(gw.reactor, gw.operatorAuthor);
  return [...gw.reactor.snapshot()]
    .filter(
      (d) =>
        d.claims.author === gw.operatorAuthor &&
        !negated(d.id) &&
        d.claims.pointers.some(
          (p) =>
            p.role === "container" &&
            p.target.kind === "entity" &&
            p.target.entity.context === "loam.container" &&
            p.target.entity.id === name,
        ),
    )
    .sort((a, b) => b.claims.timestamp - a.claims.timestamp || b.id.localeCompare(a.id))[0]?.id;
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
    declaration.claims.pointers.some(
      (p) =>
        p.role === "container" &&
        p.target.kind === "entity" &&
        p.target.entity.context === "loam.container" &&
        p.target.entity.id === o.channel,
    )
  );
}
export function localChannelEvidence(gw: Gateway, channel: string): LocalChannelEvidence {
  const unavailable = (reason: string): LocalChannelEvidence => ({ state: "unavailable", reason });
  const rows = [...gw.reactor.snapshot()];
  const dead = new Set<string>();
  for (const d of rows)
    if (inLocalContext(d, LOCAL_CONTROL)) {
      const target = localEraseTarget(d, gw.reactor, gw.operatorAuthor);
      if (target === undefined)
        return unavailable("unsupported or malformed local control history");
      dead.add(target);
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
    return dead.size > 0 && relevant.length > 0
      ? unavailable("erased opening")
      : { state: "legacy" };
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
  const received: Delta[] = [];
  const sourceDead = readTombstones(pool.gateway.reactor, pool.gateway.operatorAuthor);
  for (const id of [...ids].sort()) {
    const d = pool.gateway.reactor.get(id);
    if (d === undefined || sourceDead.has(id) || !sameVerifiedDelta(d, d))
      return unavailable(`missing received source ${id}`);
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
export function eventHeader(channel: string, action: string): Claims["pointers"] {
  return [
    {
      role: "event",
      target: { kind: "entity", entity: { id: `channel:${channel}`, context: LOCAL_EVENT } },
    },
    eventPrimitive("version", 1),
    eventPrimitive("action", action),
  ];
}
