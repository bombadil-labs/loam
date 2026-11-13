import { appendImpl, appendLocalErasure } from "./ingest.js";
import type { Peer } from "./peer.js";
import { rebaseHostPeer, reportPurged } from "./peer-admission.js";
import { settleOwedPurges } from "./purge-settle.js";
import {
  withChannelCommit,
  parseLocalEvent,
  LOCAL_EVENT,
  orphanedDeclaration,
  receiptsNaming,
} from "../federation/local-channel-events.js";
import {
  LOCAL_CONTROL,
  inLocalContext,
  localEraseTarget,
  orderForPool,
  sameVerifiedDelta,
} from "./erase-law.js";

import { sha256 } from "@noble/hashes/sha2.js";
import { storeHoldsAny } from "./custody.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { DeltaSet, Reactor } from "@bombadil/rhizomatic";
import type { Claims, Delta } from "@bombadil/rhizomatic";
import { evalTerm, parseTerm } from "@bombadil/rhizomatic";
import { readLawfulRegistrations } from "./registration.js";
import { negatedAt } from "./negation.js";
import { programMaskJson } from "./program-mask.js";
import { unreachableStoreReport } from "./container.js";
import { currentContainerDeclarationId } from "./container-law.js";
import { danglingCitations, type CitationTier } from "./tiers.js";
import {
  readSlates,
  negatedHealth,
  readClosedIds,
  slateHealth,
  type NegatedHealth,
  type SlateHealth,
} from "./slate-law.js";
import type { Gateway } from "./gateway.js";
import { withStamp } from "./stamp.js";
import { governedProgram } from "./governed-trust.js";
import { userGroundOf } from "./user-root.js";
import {
  readErasures,
  erasureParts,
  standingErasures,
  isErasure,
  ERASE_ENTITY,
  refusedIds,
  eraseClaims,
  UNSWEPT_AUTH_SURFACES,
  ESM_RESIDENCY_DISCLOSURE,
  withHeldDownTargets,
  erasureTarget,
  eraseDefect,
} from "./erase-law.js";

export function erasureSlate(claims: Claims): string | undefined {
  return erasureParts(claims).slate;
}

export function erasedInDeltas(
  deltas: readonly Delta[],
  operator: string | undefined,
): Set<string> {
  const hidden = new Set<string>();
  if (operator === undefined) return hidden;
  const byId = new Map(deltas.map((d) => [d.id, d]));
  const localControls = deltas.filter((d) => {
    if (!isErasure(d.claims) || !inLocalContext(d, LOCAL_CONTROL)) return false;
    const target = erasureTarget(d.claims);
    return target !== undefined && byId.has(target);
  });
  if (localControls.length > 0) {
    const probe = new Reactor();
    for (const d of deltas) probe.ingest(d);
    for (const d of localControls) {
      const target = localEraseTarget(d, probe, operator);
      if (target !== undefined && byId.has(target)) hidden.add(target);
    }
  }
  for (const d of deltas) {
    if (!isErasure(d.claims) || inLocalContext(d, LOCAL_CONTROL)) continue;
    if (d.claims.author !== operator) continue;
    const { targetId, spokenBy, count } = erasureParts(d.claims);
    if (targetId === undefined || count.erases !== 1 || count.spokenBy !== 1) continue;
    const target = byId.get(targetId);
    if (target === undefined || isErasure(target.claims)) continue;
    if (target.claims.author !== spokenBy) continue;
    hidden.add(targetId);
  }
  return withHeldDownTargets(hidden, (id) => byId.get(id));
}

export function erasedInScope(
  reactor: Reactor,
  operator: string | undefined,
  scope: readonly Delta[],
  pools: readonly string[] = [],
): Set<string> {
  const byId = new Map(scope.map((d) => [d.id, d]));
  const hidden = erasedInDeltas(scope, operator);
  for (const key of pools) {
    if (key !== operator) for (const id of erasedInDeltas(scope, key)) hidden.add(id);
  }
  for (const id of refusedIds(reactor, operator)) if (byId.has(id)) hidden.add(id);
  return withHeldDownTargets(hidden, (id) => byId.get(id));
}

export function poolGovernors(gw: Gateway): string[] {
  const keys = new Set<string>();
  const seen = new Set<Peer>();
  const walk = (g: Peer): void => {
    for (const pool of g.store.pools(g)) {
      if (seen.has(pool)) continue;
      seen.add(pool);
      if (pool.operatorAuthor !== undefined) keys.add(pool.operatorAuthor);
      walk(pool);
    }
  };
  walk(gw);
  return [...keys];
}

export interface MaskReading {
  readonly policy: unknown;
  readonly ground: "closed" | "raw";

  readonly readings: { readonly identity: string; readonly label: string }[];
  readonly key: string;
  readonly live: Set<string>;
}

export interface GroundReading {
  readonly ground: Peer;
  readonly present: Set<string>;
  readonly masks: MaskReading[];

  readonly byReading: Map<string, string>;

  readonly unreadable: { readonly identity: string; readonly label: string }[];
}

export interface ReadingAt {
  readonly reading: string;
  readonly ground: Peer;
}

export interface Revival {
  readonly id: string;
  readonly ground: Peer;
  readonly readings: string[];
}

export const UNGOVERNED_READING = "a reading with no trust mask (the stock shelf's `drop`)";

export interface ExtraReading {
  readonly reading: string;
  readonly policy: unknown;

  readonly ground?: "closed" | "raw";
}

export function maskReadings(
  gw: Peer,
  extra: readonly ExtraReading[] = [],
): {
  masks: Map<string, MaskReading>;
  unreadable: { identity: string; label: string }[];
} {
  const masks = new Map<string, MaskReading>();
  const unreadable: { identity: string; label: string }[] = [];
  const remember = (
    policy: unknown,
    identity: string,
    label = identity,
    ground: "closed" | "raw" = "closed",
  ): void => {
    const key = `${ground}\u0000${JSON.stringify(policy ?? null)}`;
    const seen = masks.get(key);
    const pair = { identity, label };
    if (seen === undefined)
      masks.set(key, { readings: [pair], key, policy, ground, live: new Set() });
    else if (!seen.readings.some((r) => r.identity === identity)) seen.readings.push(pair);
  };
  remember("drop", UNGOVERNED_READING);
  for (const reg of readLawfulRegistrations(
    gw.reactor,
    gw.validityNow(),
    gw.lawAuthors("registrations"),
  )) {
    const name = reg.lensName ?? reg.hyperschema.name;
    const identity = `${reg.entity ?? `hyperschema:${reg.hyperschema.name}`}\u0000${name}`;
    try {
      remember(programMaskJson(reg.hyperschema.body), identity, name);
    } catch {
      unreadable.push({ identity, label: name });
    }
  }
  for (const one of extra) remember(one.policy, one.reading, one.reading, one.ground ?? "closed");
  return { masks, unreadable };
}

export function readGrounds(
  gw: Peer,
  extra: readonly ExtraReading[] = [],
  now: number = Date.now(),
  seen = new Set<Peer>(),
): GroundReading[] {
  if (seen.has(gw)) return [];
  seen.add(gw);
  const { masks, unreadable } = maskReadings(gw, extra);
  const snapshot = gw.reactor.snapshot();
  const present = new Set<string>();
  for (const delta of snapshot) present.add(delta.id);
  const closed = readClosedIds(gw, now);
  const doorGround =
    closed.size === 0 ? snapshot : DeltaSet.from([...snapshot].filter((d) => !closed.has(d.id)));
  const servable = new Set<string>();
  for (const delta of doorGround) servable.add(delta.id);
  for (const mask of masks.values()) {
    const over = mask.ground === "raw" ? snapshot : doorGround;
    const live = mask.ground === "raw" ? present : servable;
    if (mask.policy === null) {
      for (const id of live) mask.live.add(id);
      continue;
    }
    const maskTerm = parseTerm({ op: "mask", policy: mask.policy, in: "input" });
    const program = governedProgram(maskTerm, undefined, over, { now }, userGroundOf(gw.reactor));
    const masked = evalTerm(program.term, over, now);
    if (masked.sort !== "dset") throw new Error("a mask always evaluates to a delta set");
    for (const delta of masked.set) mask.live.add(delta.id);
  }
  const byReading = new Map<string, string>();
  for (const mask of masks.values())
    for (const reading of mask.readings) byReading.set(reading.identity, mask.key);
  const out: GroundReading[] = [
    { ground: gw, present, masks: [...masks.values()], byReading, unreadable },
  ];
  for (const pool of gw.store.pools(gw)) out.push(...readGrounds(pool, [], now, seen));
  return out;
}

export interface RevivalReport {
  readonly revived: Revival[];

  readonly withdrawn: ReadingAt[];

  readonly remasked: ReadingAt[];

  readonly reopened: ReadingAt[];
  readonly unconsulted: ReadingAt[];
}

export function revivedAcross(
  before: readonly GroundReading[],
  after: readonly GroundReading[],
): RevivalReport {
  const out: Revival[] = [];
  const reopened: ReadingAt[] = [];
  const remasked: ReadingAt[] = [];
  const unconsulted: ReadingAt[] = [];
  const withdrawn: ReadingAt[] = [];
  const seenAt = new Map<Peer, Set<string>>();
  const once = (into: ReadingAt[], reading: string, ground: Peer, tag: string): void => {
    const here = seenAt.get(ground) ?? new Set<string>();
    seenAt.set(ground, here);
    const key = tag.includes("\u0000") ? tag : `${tag}\u0000${reading}`;
    if (here.has(key)) return;
    here.add(key);
    into.push({ reading, ground });
  };
  const now = new Map(after.map((reading) => [reading.ground, reading]));
  for (const was of before) {
    const then = now.get(was.ground);
    if (then === undefined) continue;
    const byId = new Map<string, string[]>();
    const undiffable = new Set<string>();
    const labels = new Map<string, string>();
    for (const mask of then.masks) {
      for (const reading of mask.readings) labels.set(reading.identity, reading.label);
    }
    const label = (identity: string): string => labels.get(identity) ?? identity;
    for (const [identity, key] of then.byReading) {
      const had = was.byReading.get(identity);
      if (had === undefined) {
        once(reopened, label(identity), was.ground, `reopened\u0000${identity}`);
        undiffable.add(identity);
      } else if (had !== key) {
        once(remasked, label(identity), was.ground, `remasked\u0000${identity}`);
        undiffable.add(identity);
      }
    }
    const wasLabels = new Map<string, string>();
    for (const mask of was.masks)
      for (const reading of mask.readings) wasLabels.set(reading.identity, reading.label);
    for (const identity of was.byReading.keys()) {
      if (then.byReading.has(identity)) continue;
      once(
        withdrawn,
        wasLabels.get(identity) ?? identity,
        was.ground,
        `withdrawn\u0000${identity}`,
      );
    }
    for (const mask of then.masks) {
      const wasMask = was.masks.find((m) => m.key === mask.key);
      if (wasMask === undefined || mask.readings.every((r) => undiffable.has(r.identity))) {
        continue;
      }
      for (const id of mask.live) {
        if (!was.present.has(id) || wasMask.live.has(id)) continue;
        const readings = byId.get(id) ?? [];
        for (const reading of mask.readings) {
          if (undiffable.has(reading.identity)) continue;
          if (!readings.includes(reading.label)) readings.push(reading.label);
        }
        if (readings.length > 0) byId.set(id, readings);
      }
    }
    for (const [id, readings] of byId)
      out.push({ id, ground: was.ground, readings: readings.sort() });
    for (const reading of [...was.unreadable, ...then.unreadable]) {
      once(unconsulted, reading.label, was.ground, `unconsulted\u0000${reading.identity}`);
    }
  }
  const byName = (a: ReadingAt, b: ReadingAt): number => (a.reading < b.reading ? -1 : 1);
  return {
    revived: out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    remasked: remasked.sort(byName),
    reopened: reopened.sort(byName),
    withdrawn: withdrawn.sort(byName),
    unconsulted: unconsulted.sort(byName),
  };
}

export interface ErasureReceipt {
  readonly erasure: string;
  readonly erased: string;

  readonly spokenBy?: string;
  readonly orderedBy: string;
  readonly at: number;
  readonly reasons: readonly string[];
  readonly slate?: string;
}

export function receiptLedger(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
): { receipts: ErasureReceipt[]; inert: number } {
  let shaped = 0;
  if (operator !== undefined) {
    for (const id of reactor.byTarget(ERASE_ENTITY)) {
      const delta = reactor.get(id);
      if (delta !== undefined && isErasure(delta.claims) && delta.claims.author === operator) {
        shaped += 1;
      }
    }
  }
  const surviving = standingErasures(reactor, now, operator);
  const receipts = surviving
    .map((d) => {
      const parts = erasureParts(d.claims);
      return {
        erasure: d.id,
        erased: parts.targetId!,
        ...(parts.spokenBy === undefined ? {} : { spokenBy: parts.spokenBy }),
        orderedBy: d.claims.author,
        at: d.claims.timestamp,
        reasons: parts.reasons,
        ...(parts.slate === undefined ? {} : { slate: parts.slate }),
      };
    })
    .sort((a, b) => a.at - b.at || (a.erasure < b.erasure ? -1 : 1));
  return { receipts, inert: shaped - receipts.length };
}

export function forgottenSince(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  since: number,
): number[] {
  return standingErasures(reactor, now, operator)
    .map((d) => d.claims.timestamp)
    .filter((t) => t > since)
    .sort((a, b) => a - b);
}

export function sealCommitment(salt: string, author: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${salt}\u0000${author}`)));
}

async function liveOpening(
  gw: Gateway,
  o: { channel: string; poolDeclaration: string },
): Promise<string | undefined> {
  const drop =
    `Drop the channel first (dropChannel "${o.channel}"); its pool's deltas can be read or ` +
    `extracted until then.`;
  const cached = gw.store.channels(gw).get(o.channel);
  const named =
    cached?.gateway !== undefined && gw.store.holds(gw, cached.gateway) ? cached : undefined;
  const byHand = gw.store.namedPools(gw).get(o.channel);
  if (byHand !== undefined && byHand !== named?.gateway && byHand.reactor.size !== 0)
    return (
      "a container attached by hand under its name holds bytes: detach() it, then drop the " +
      "channel (dropChannel), then erase again."
    );
  const negated = negatedAt(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  if (gw.reactor.get(o.poolDeclaration) !== undefined && !negated(o.poolDeclaration))
    return `its pool's declaration still stands. ${drop}`;
  const another =
    named !== undefined &&
    named.declarationId !== o.poolDeclaration &&
    !orphanedDeclaration(gw, named.declarationId!);
  const attached = named !== undefined && !another ? named.gateway : undefined;
  if (attached !== undefined && (attached.reactor.size !== 0 || (await attached.probe("any"))))
    return named!.declarationId === o.poolDeclaration
      ? `its pool is still attached and holds bytes. ${drop}`
      : `a pool no opening names is attached under its name and holds bytes. ${drop}`;
  if (another) {
    const owned = receiptsNaming(gw, named.declarationId!);
    const pool = named.gateway!;
    const inventory = await pool.probe("inventory");
    if (typeof inventory === "string")
      return (
        "a later incarnation under its name holds a store whose bytes cannot be listed on every " +
        `tier (${inventory}), so this opening's bytes cannot be accounted for. Drop the channel ` +
        `first (dropChannel "${o.channel}"): that severs the standing incarnation and purges its pool.`
      );
    let stray = 0;
    for (const id of inventory) {
      if (owned.has(id) || gw.reactor.get(id) !== undefined) continue;
      const author = pool.reactor.get(id)?.claims.author;
      if (author !== undefined && (author === pool.operatorAuthor || author === gw.operatorAuthor))
        continue;
      stray += 1;
    }
    if (stray > 0)
      return (
        `a later incarnation under its name holds ${stray} byte(s) that no receipt of that ` +
        `incarnation names and the root does not hold. Drop the channel first (dropChannel ` +
        `"${o.channel}"): that severs the standing incarnation and purges its pool with those ` +
        "bytes; its deltas can be read or extracted until then. If the drop finds bytes no read " +
        "names, heal the store while nothing is attached to it, then open it again and drop. A " +
        "byte the root erased and could not purge here is that erasure's: re-run it first."
      );
  }
  if (named === undefined) {
    const standing = currentContainerDeclarationId(
      gw.reactor,
      gw.validityNow(),
      gw.operatorAuthor,
      o.channel,
    );
    if (standing !== undefined && standing !== o.poolDeclaration)
      return (
        "a declaration under its name still stands while no pool is attached here: attach it " +
        "first (open the channel again with the options it stands with, or restart this store), " +
        "then erase again."
      );
  }
  if (named === undefined && gw.options.channelBackend !== undefined) {
    const backend = gw.options.channelBackend(o.channel);
    try {
      if (await storeHoldsAny(backend))
        return (
          "its pool's store still holds bytes although its declaration was negated, and no " +
          "declaration names that store for a drop to reach: " +
          (gw.channelStatus(o.channel).length > 0
            ? "re-declare the name by hand, then drop the channel, or remove the store by hand."
            : "open the channel again under this name, which attaches the store, then drop it, " +
              "or remove the store by hand.") +
          " If the drop finds bytes no read names, heal the store while nothing is attached to " +
          "it, then open it again and drop."
        );
    } finally {
      await backend.close();
    }
  }
  return undefined;
}
async function incarnationMembers(gw: Gateway, openingId: string): Promise<string[]> {
  const out = new Set<string>();
  const take = (d: Delta): void => {
    if (!inLocalContext(d, LOCAL_EVENT) || isErasure(d.claims)) return;
    const parsed = parseLocalEvent(d, gw.operatorAuthor);
    if (parsed !== undefined && parsed.action !== "open" && parsed.opening === openingId)
      out.add(d.id);
  };
  const snapshot = gw.reactor.snapshot();
  for (const d of snapshot) take(d);
  if (gw.peer !== undefined) {
    for (const d of await gw.backend.deltasSince(new Set(snapshot.ids()))) take(d);
  }
  return [...out].sort();
}
export async function eraseImpl(
  gw: Gateway,
  id: string,
  opts: { reason?: string; slate?: string; cascade?: boolean } = {},
): Promise<{
  erased: string;
  citations: string[];
  citationTiers: CitationTier[];
  kept: string[];
  erasure: string;
  minted: boolean;
  reasons: string[];
  spokenBy?: string;
}> {
  const signer = gw.signer;
  if (signer === undefined || gw.operatorAuthor === undefined) {
    throw new Error("erasure is the instance operator's alone, and this store has no operator");
  }
  const stores = unreachableStoreReport(gw);
  if (stores.faults.length > 0) {
    throw new Error(
      `erase ${id} refused before any work began: the resolved container table names a store ` +
        `this sweep cannot reach, and an unreachable store would be a silent gap in §11's ` +
        `fan-out. ${stores.faults.length} fault(s):\n  ${stores.faults.join("\n  ")}\n` +
        `Attach the container(s) (openContainer), or detach() them onto the record, then re-run.`,
    );
  }
  const already = standingErasures(gw.reactor, gw.validityNow(), gw.operatorAuthor).find(
    (d) => erasureParts(d.claims).targetId === id,
  );
  const target = gw.reactor.get(id);
  if (target === undefined && (already === undefined || !(await erasureOutstanding(gw, id)))) {
    throw new Error(`nothing to erase: ${id} is not held here`);
  }
  if (target !== undefined && isErasure(target.claims)) {
    throw new Error("the erasure log is append-only: an erasure cannot itself be erased");
  }
  const pinning = readSlates(gw.reactor, gw.validityNow(), gw.operatorAuthor, Date.now()).find(
    (s) => s.membershipAt === id,
  );
  if (pinning !== undefined) {
    throw new Error(
      `erase ${id} refused: it is the PINNED membership Term of the standing slate over ` +
        `"${pinning.container}", and the slate's closures are all seeded from the ids it names. ` +
        `Erasing it would reopen every door that slate closed while it still read as standing. ` +
        `Cut the slate (which removes its members and drops the container), or negate its record and ` +
        `its declaration first — un-slating is free (§29.8).`,
    );
  }
  const protectedTarget = target !== undefined && inLocalContext(target, LOCAL_EVENT);
  const erasedEvent =
    target !== undefined && protectedTarget
      ? parseLocalEvent(target, gw.operatorAuthor)
      : undefined;
  if (erasedEvent?.action === "open" && !isErasure(target!.claims)) {
    const o = erasedEvent.opening;
    const live = await liveOpening(gw, o);
    if (live !== undefined) {
      throw new Error(
        `erase ${id} refused: it is the opening of channel "${o.channel}", and ${live} ` +
          `Nothing was removed.`,
      );
    }
    if (opts.cascade !== false)
      await withChannelCommit(gw, o.channel, async () => {
        for (const member of await incarnationMembers(gw, id)) {
          const erased = standingErasures(gw.reactor, gw.validityNow(), gw.operatorAuthor).some(
            (d) => erasureParts(d.claims).targetId === member,
          );
          if (erased && !(await erasureOutstanding(gw, member))) continue;
          await eraseImpl(gw, member, { ...opts, cascade: false });
        }
      });
  }
  const erasedChannel = target?.claims.pointers.find(
    (p) =>
      p.role === "event" && p.target.kind === "entity" && p.target.entity.context === LOCAL_EVENT,
  )?.target;
  const localClaims = (claims: Claims): Claims =>
    protectedTarget && erasedChannel?.kind === "entity"
      ? {
          ...claims,
          pointers: [
            ...claims.pointers,
            {
              role: "local-control",
              target: { kind: "entity", entity: { id, context: LOCAL_CONTROL } },
            },
            { role: "local-control-version", target: { kind: "primitive", value: 1 } },
            { role: "local-control-kind", target: { kind: "primitive", value: "erase" } },
            {
              role: "local-control-channel",
              target: { kind: "primitive", value: erasedChannel.entity.id },
            },
          ],
        }
      : claims;
  const operator = gw.operatorAuthor;
  const erasure =
    already ??
    signer.sign(
      localClaims(
        withStamp(gw.stamp(operator), (t) =>
          eraseClaims(id, target!.claims.author, operator, t, opts.reason, opts.slate),
        ),
      ),
    );
  const { citations, citationTiers } = danglingCitations(gw, id, (dId) => dId === erasure.id);
  if (already === undefined) {
    if (inLocalContext(erasure, LOCAL_CONTROL)) await appendLocalErasure(gw, erasure);
    else await appendImpl(gw, [erasure], { settle: false });
    await gw.flush();
  }
  let localPurge: unknown;
  if (gw.peer !== undefined) {
    try {
      await rebaseHostPeer(gw.peer);
    } catch (err) {
      localPurge = err;
    }
  }
  try {
    await gw.backend.purge([id]);
  } catch (err) {
    localPurge = localPurge ?? err;
  }
  if (gw.peer !== undefined) {
    try {
      const gone = localPurge === undefined && !(await gw.backend.holds(id));
      await reportPurged(
        gw.peer,
        id,
        gone
          ? { status: "removed" }
          : {
              status: "failed",
              fault:
                localPurge instanceof Error
                  ? localPurge.message
                  : "the store still holds the bytes",
            },
      );
    } catch (err) {
      localPurge = localPurge ?? err;
    }
  }
  try {
    await gw.reseat();
  } catch (err) {
    localPurge = localPurge ?? err;
  }
  const seen = new Set<Peer>([gw]);
  const targets = [...gw.store.pools(gw)].filter((pool) => !seen.has(pool));
  for (const pool of targets) seen.add(pool);
  const fanned = await Promise.allSettled(
    targets.map((pool) => pool.eraseReplica(orderForPool(gw, erasure, pool), id, seen)),
  );
  const faults = await incompleteErasureFaults(gw, id, fanned);
  if (localPurge !== undefined) {
    faults.unshift({
      what: `this store's purge refused: ${localPurge instanceof Error ? localPurge.message : JSON.stringify(localPurge)}`,
      cause: localPurge,
    });
  }
  if (faults.length > 0) {
    throw new Error(
      `erase ${id}: the erasure is recorded, but the content is STILL ` +
        `HELD by the store — erasure is not complete. ${faults.length} fault(s):\n  ` +
        `${faults.map((f) => f.what).join("\n  ")}\n` +
        `Resolve them and re-run; the re-run is safe and will not mint a second erasure.`,
      { cause: faults[0]?.cause },
    );
  }
  const parts = erasureParts(erasure.claims);
  return {
    erased: id,
    citations,
    citationTiers,
    kept: stores.kept,
    erasure: erasure.id,
    minted: already === undefined,
    reasons: parts.reasons,
    ...(parts.spokenBy === undefined ? {} : { spokenBy: parts.spokenBy }),
  };
}

export async function erasureOutstanding(
  gw: Gateway,
  id: string,
  seen = new Set<Peer>(),
): Promise<boolean> {
  return (await erasureStanding(gw, id, seen)) !== "settled";
}

export type ErasureStanding = "held" | "unasked" | "owed" | "settled";

const STANDING_RANK: Record<ErasureStanding, number> = {
  held: 3,
  unasked: 2,
  owed: 1,
  settled: 0,
};

export interface StandingReport {
  readonly standings: ReadonlyMap<string, ErasureStanding>;
  readonly unasked: ReadonlySet<string>;
}

export async function erasureStanding(
  gw: Gateway,
  id: string,
  seen = new Set<Peer>(),
): Promise<ErasureStanding> {
  return (await erasureStandings(gw, [id], seen)).standings.get(id) ?? "settled";
}

export async function erasureStandings(
  gw: Peer,
  ids: readonly string[],
  seen = new Set<Peer>(),
): Promise<StandingReport> {
  const standings = new Map<string, ErasureStanding>(ids.map((id) => [id, "settled"]));
  const unasked = new Set<string>();
  const note = (id: string, verdict: ErasureStanding): void => {
    if (verdict === "unasked") unasked.add(id);
    if (STANDING_RANK[verdict] > STANDING_RANK[standings.get(id) ?? "settled"]) {
      standings.set(id, verdict);
    }
  };
  if (ids.length === 0 || seen.has(gw)) return { standings, unasked };
  seen.add(gw);
  const physical = await gw.probe({ retention: ids });
  for (const id of physical.held) note(id, "held");
  for (const id of physical.unasked) note(id, "unasked");
  const tombs = readErasures(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  for (const id of ids) if (!tombs.has(id)) note(id, "owed");
  for (const pool of gw.store.pools(gw)) {
    const sub = await erasureStandings(pool, ids, seen);
    for (const [id, verdict] of sub.standings) note(id, verdict);
    for (const id of sub.unasked) unasked.add(id);
  }
  return { standings, unasked };
}

async function incompleteErasureFaults(
  gw: Gateway,
  id: string,
  fanned: readonly PromiseSettledResult<void>[],
): Promise<{ what: string; cause?: unknown }[]> {
  const faults: { what: string; cause?: unknown }[] = [];
  try {
    if (await gw.backend.holds(id)) {
      faults.push({ what: `this store STILL HOLDS the content at rest` });
    }
  } catch (err) {
    faults.push({
      what: `this store could not be proven clean: ${err instanceof Error ? err.message : String(err)}`,
      cause: err,
    });
  }
  for (const r of fanned) {
    if (r.status === "rejected") {
      faults.push({
        what: `an attached quarantine pool refused: ${
          r.reason instanceof Error ? r.reason.message : String(r.reason)
        }`,
        cause: r.reason,
      });
    }
  }
  return faults;
}

export function localOrderAuthorized(
  chain: readonly Pick<Peer, "reactor" | "operatorAuthor">[],
  erasure: Delta,
  receiver: string | undefined,
  id: string,
): boolean {
  let authorized = false;
  for (const [depth, parent] of chain.entries()) {
    if (sameVerifiedDelta(parent.reactor.get(erasure.id), erasure)) authorized = true;
    if (
      depth === 0 &&
      erasure.claims.author === parent.operatorAuthor &&
      erasureParts(erasure.claims).receiver === receiver &&
      [...parent.reactor.byTarget(ERASE_ENTITY)].some((eid) => {
        const held = parent.reactor.get(eid);
        return (
          held !== undefined &&
          inLocalContext(held, LOCAL_CONTROL) &&
          localEraseTarget(held, parent.reactor, parent.operatorAuthor) === id
        );
      })
    ) {
      authorized = true;
    }
  }
  return authorized;
}

export async function eraseReplicaImpl(
  gw: Gateway,
  erasure: Delta,
  id: string,
  seen: Set<Peer>,
): Promise<void> {
  const defect = eraseDefect(erasure, gw.reactor, gw.operatorAuthor);
  if (defect !== undefined) {
    throw new Error(`a replica purge is the operator's alone: ${defect}`);
  }
  if (
    inLocalContext(erasure, LOCAL_CONTROL) ||
    (gw.reactor.get(id) !== undefined && inLocalContext(gw.reactor.get(id)!, LOCAL_EVENT))
  ) {
    if (localEraseTarget(erasure, gw.reactor, gw.operatorAuthor) !== id)
      throw new Error("replica requires exact marked local erasure");
    if (!localOrderAuthorized(gw.store.chainAbove(gw), erasure, gw.operatorAuthor, id))
      throw new Error("replica has no attached held local erasure authority");
    await appendLocalErasure(gw, erasure);
  } else await gw.federate([erasure], { admit: () => true });
  await gw.flush();
  if (!readErasures(gw.reactor, gw.validityNow(), gw.operatorAuthor).has(id)) {
    throw new Error(
      `the erasure did not complete: the operator's erasure for ${id} could not land in an attached pool`,
    );
  }
  let localPurge: unknown;
  try {
    await gw.backend.purge([id]);
  } catch (err) {
    localPurge = err;
  }
  await settleOwedPurges(gw);
  try {
    await gw.reseat();
  } catch (err) {
    localPurge = localPurge ?? err;
  }
  seen.add(gw);
  const nested = [...gw.store.pools(gw)].filter((pool) => !seen.has(pool));
  for (const pool of nested) seen.add(pool);
  const walked = await Promise.allSettled(
    nested.map((pool) => pool.eraseReplica(orderForPool(gw, erasure, pool), id, seen)),
  );
  const faults = await incompleteErasureFaults(gw, id, walked);
  if (localPurge !== undefined) {
    faults.unshift({
      what: `this pool's purge refused: ${localPurge instanceof Error ? localPurge.message : JSON.stringify(localPurge)}`,
      cause: localPurge,
    });
  }
  if (faults.length > 0) {
    throw new Error(
      `the erasure did not complete in an attached quarantine pool: a forgotten record must not ` +
        `survive inside the operator's own replica. ${faults.length} fault(s):\n  ` +
        `${faults.map((f) => f.what).join("\n  ")}\n` +
        `Resolve them and re-run the erasure; the re-run is safe and mints no second erasure.`,
      { cause: faults[0]?.cause },
    );
  }
}

export interface ErasureHealth {
  readonly settled: boolean;
  readonly promised: number;
  readonly pending: number;
  readonly outstanding: readonly string[];
  readonly unproven: boolean;
}

export interface StoreHealth {
  readonly status: "ok" | "settling" | "unproven";
  readonly erasure: ErasureHealth;
  readonly slates: SlateHealth;
  readonly negated: NegatedHealth;
  readonly lagging?: boolean;
  readonly nonSwept: readonly string[];
}

async function outstandingAmong(
  gw: Gateway,
  ids: readonly string[],
  seen: Set<Peer>,
): Promise<{ outstanding: Set<string>; unproven: boolean }> {
  const report = await erasureStandings(gw, ids, seen);
  const outstanding = new Set<string>();
  for (const [id, verdict] of report.standings) if (verdict !== "settled") outstanding.add(id);
  for (const id of report.unasked) outstanding.add(id);
  return { outstanding, unproven: report.unasked.size > 0 };
}

export async function healthImpl(gw: Gateway, now = Date.now()): Promise<StoreHealth> {
  const dead = readErasures(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  const ids = [...dead];
  let erasure: ErasureHealth;
  if (ids.length === 0) {
    erasure = { settled: true, promised: 0, pending: 0, outstanding: [], unproven: false };
  } else {
    const verdict = await outstandingAmong(gw, ids, new Set());
    erasure = {
      settled: verdict.outstanding.size === 0,
      promised: ids.length,
      pending: verdict.outstanding.size,
      outstanding: [...verdict.outstanding].sort(),
      unproven: verdict.unproven,
    };
  }
  const lagging = (gw.backend as { lagging?: unknown }).lagging;
  const status = erasure.unproven
    ? "unproven"
    : erasure.settled && lagging !== true
      ? "ok"
      : "settling";
  return {
    status,
    erasure,
    slates: slateHealth(gw, now),
    negated: negatedHealth(gw),
    ...(typeof lagging === "boolean" && { lagging }),
    nonSwept: [...UNSWEPT_AUTH_SURFACES, ...ESM_RESIDENCY_DISCLOSURE],
  };
}
