import {
  anchorAnalysis,
  fetchScope,
  readAnchored,
  resolveView,
  Reactor,
  StoreError,
  StoreFaultError,
  type Delta,
  type PeerStore,
  type Snapshot,
  type StoreRead,
  type View,
} from "@bombadil/rhizomatic";
import type { ConnectionBinding, Gateway } from "./gateway.js";
import type { ResolvedNode } from "./gql.js";
import { declarationsOf } from "./ground-declarations.js";
import { needsLowering } from "./governed-trust.js";
import {
  ERASE_ENTITY,
  LOCAL_CONTROL,
  erasedFromReading,
  inLocalContext,
  pinErasureGovernors,
} from "./erase-law.js";
import { channelLens, finishNodeImpl, resolvedNodeImpl } from "./reads.js";
import { SLATE_ENTITY } from "./slate-law.js";

export type StoreDecline =
  | "as-of"
  | "bound-connection"
  | "channel"
  | "governed-lowering"
  | "unanchored"
  | "erasure-request"
  | "local-control-erasure";

export function classifyStoreRead(
  gw: Gateway,
  name: string,
  asOf?: number,
  binding?: ConnectionBinding,
): StoreDecline | undefined {
  if (asOf !== undefined) return "as-of";
  if (binding !== undefined) return "bound-connection";
  if (channelLens(gw, name)) return "channel";
  const body = gw.def(name).hyperschema.body;
  if (needsLowering(body, gw.registry)) return "governed-lowering";
  if (!anchorAnalysis(body, gw.registry).anchored) return "unanchored";
  return undefined;
}

const pointed = (d: Delta, role: string): string[] =>
  d.claims.pointers.flatMap((p) =>
    p.role === role && p.target.kind === "delta" ? [p.target.deltaRef.delta] : [],
  );

async function erasureLaw(
  gw: Gateway,
  snapshot: Snapshot,
): Promise<StoreDecline | ReadonlySet<string>> {
  const law = (await fetchScope(snapshot, [ERASE_ENTITY, SLATE_ENTITY])).source;
  if (law.targets(SLATE_ENTITY).length > 0) return "erasure-request";
  const probe = new Reactor();
  const take = (d: Delta): void => {
    const held = probe.ingest(d);
    if (held.status === "rejected")
      throw new Error(`the store holds law delta ${d.id} that does not verify: ${held.reason}`);
  };
  if (law.targets(ERASE_ENTITY).some((id) => inLocalContext(law.get(id)!, LOCAL_CONTROL)))
    return "local-control-erasure";
  for (const id of law.ids()) take(law.get(id)!);
  const seen = new Set<string>();
  let wanted = law.ids().flatMap((id) => pointed(law.get(id)!, "erases"));
  while (wanted.length > 0) {
    const fresh = [...new Set(wanted)].filter((id) => !seen.has(id));
    for (const id of fresh) seen.add(id);
    for (const d of await snapshot.get(fresh.filter((id) => probe.get(id) === undefined))) take(d);
    wanted = fresh.flatMap((id) => {
      const d = probe.get(id);
      return d === undefined ? [] : pointed(d, "negates");
    });
  }
  const governors = declarationsOf(gw.reactor).erasureGovernors;
  if (governors !== undefined) pinErasureGovernors(probe, governors);
  return erasedFromReading(probe, gw.operatorAuthor);
}

const faultOf = (err: unknown): string =>
  err instanceof StoreError
    ? err.code
    : err instanceof StoreFaultError
      ? `store fault ${err.rule}`
      : "failed";

export async function readThroughStore(
  gw: Gateway,
  peer: PeerStore,
  name: string,
  entity: string,
  now: number,
  asOf?: number,
  binding?: ConnectionBinding,
): Promise<ResolvedNode> {
  const report = gw.options.onReadRoute;
  const native = (reason: StoreDecline): ResolvedNode => {
    report?.({ lens: name, entity, route: "native", reason });
    return resolvedNodeImpl(gw, name, entity, now, asOf, binding);
  };
  const declined = classifyStoreRead(gw, name, asOf, binding);
  if (declined !== undefined) return native(declined);
  const def = gw.def(name);
  let snapshot: Snapshot | undefined;
  let read: StoreDecline | StoreRead;
  try {
    snapshot = await peer.read();
    const closed = await erasureLaw(gw, snapshot);
    read =
      typeof closed === "string"
        ? closed
        : await readAnchored(snapshot, {
            term: def.hyperschema.body,
            root: entity,
            now: gw.validityNow(now),
            registry: gw.registry,
            ...(closed.size === 0 ? {} : { pushdown: { excludeIds: [...closed] } }),
          });
  } catch (err) {
    throw new Error(`store read of ${name} at ${entity}: ${faultOf(err)}: ${String(err)}`);
  } finally {
    snapshot?.release();
  }
  if (typeof read === "string") return native(read);
  if (read.result.sort !== "hview")
    throw new Error(`schema ${name} does not evaluate to a hyperview`);
  report?.({
    lens: name,
    entity,
    route: "store",
    store: { revision: read.revision, rounds: read.rounds },
  });
  const hview = read.result.hview;
  return finishNodeImpl(
    gw,
    name,
    entity,
    now,
    hview,
    resolveView(def.schema, hview) as Record<string, View>,
  );
}
