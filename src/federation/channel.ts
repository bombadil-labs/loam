// §46 — federation is container-to-container. A channel receives a peer's deltas into a NESTED POOL
// inside the receiving container, and law that arrives binds there under names the RECEIVER assigns.
//
// The pool is a `separate` container (its own ground) declared `inboxOf` the receiving container, so
// `containerScope` gathers it alongside the parent's own members. That shape is load-bearing three
// times over: the peer's bytes never enter the receiver's primary ground, `drop()` stays a physical
// purge rather than a filtered delete by author, and one parent supports MANY channels because the
// gather loops over every pool marking it (§39.3).
//
// Naming does not travel. Law identity excludes the living name (`schemaLawAddress`), so a peer's
// local name for its own law is a fact about the peer's store only — the receiver assigns the prefix
// and therefore owns every name it serves. That is what closes the squatting hazard accounts.ts
// documents, and it is why the prefix is checked for GraphQL-field injectivity at ASSIGNMENT time,
// while a person is present to choose another.

import type { Delta } from "@bombadil/rhizomatic";
import type { Claims } from "@bombadil/rhizomatic";
import { signClaims } from "@bombadil/rhizomatic";
import type { Container } from "../gateway/container.js";
import { containerClaims, readContainerTable } from "../gateway/container.js";
import type { Gateway } from "../gateway/gateway.js";
import { legalNameFor } from "../gateway/gql.js";
import { CTX_MANIFEST, isRegistrationBinding, manifestExportClaims } from "../gateway/adopt-law.js";
import { CTX_REGISTRATION } from "../gateway/registration.js";
import { freezeMembers } from "../gateway/container-identity.js";

/** Where a channel's deltas come from. A live peer, a frozen offer, or a fixture. */
export interface ChannelSource {
  pull(): Promise<readonly Delta[]>;
}

export interface OpenChannelOptions {
  /** The container the receiver names. One container may host many channels. */
  readonly into: string;
  /** The namespace the RECEIVER assigns this peer. Never the publisher's choice. */
  readonly prefix: string;
  readonly source: ChannelSource;
  /** Whether law arriving on this channel binds. Reversible; see §46's two toggles. */
  readonly bless?: boolean;
}

export interface SyncReport {
  readonly offered: number;
  readonly accepted: number;
  readonly duplicates: number;
  /** The living names this sync BOUND, each already carrying the receiver's prefix. */
  readonly bound: string[];
  /** Rows that need a person: a name already answered here by different-content law. */
  readonly parked: string[];
}

export interface ChannelStatus {
  readonly name: string;
  readonly into: string;
  readonly prefix: string;
  readonly receiving: boolean;
  readonly blessing: boolean;
  /** 0 means NEVER synced — deliberately distinct from "synced a while ago". */
  readonly lastSyncedAt: number;
  readonly consecutiveFailures: number;
}

export const CTX_CHANNEL = "loam.channel";

/**
 * A channel's own state, as deltas. Myk's rule: channel state is expressible as deltas like
 * everything else, so a person can query how a channel is doing rather than ask the process.
 *
 * Latest-wins by timestamp — each sync appends a fresh record and the newest reading is the live
 * one. `consecutiveFailures` is the field that makes H9 visible here: "0 accepted" is the same
 * visible answer for a quiet peer and an unreachable one, and only the second licenses believing
 * you are current when you are not.
 */
export function channelRecordClaims(
  status: ChannelStatus,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    author,
    pointers: [
      {
        role: "channel",
        target: { kind: "entity", entity: { id: `channel:${status.name}`, context: CTX_CHANNEL } },
      },
      { role: "into", target: { kind: "primitive", value: status.into } },
      { role: "prefix", target: { kind: "primitive", value: status.prefix } },
      { role: "receiving", target: { kind: "primitive", value: status.receiving } },
      { role: "blessing", target: { kind: "primitive", value: status.blessing } },
      { role: "lastSyncedAt", target: { kind: "primitive", value: status.lastSyncedAt } },
      {
        role: "consecutiveFailures",
        target: { kind: "primitive", value: status.consecutiveFailures },
      },
    ],
  };
}

/** The live reading of every channel record, or one by name. Latest-wins per channel. */
export function channelStatusImpl(gw: Gateway, name?: string): ChannelStatus[] {
  const latest = new Map<string, { at: number; status: ChannelStatus }>();
  for (const d of gw.reactor.snapshot()) {
    const marker = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_CHANNEL,
    );
    if (marker === undefined || marker.target.kind !== "entity") continue;
    if (gw.reactor.negationsOf(d.id).length > 0) continue;
    const of = (role: string): string | number | boolean | undefined => {
      const p = d.claims.pointers.find((q) => q.role === role);
      return p?.target.kind === "primitive" ? p.target.value : undefined;
    };
    const channel = marker.target.entity.id.slice("channel:".length);
    const held = latest.get(channel);
    if (held !== undefined && held.at >= d.claims.timestamp) continue;
    latest.set(channel, {
      at: d.claims.timestamp,
      status: {
        name: channel,
        into: String(of("into") ?? ""),
        prefix: String(of("prefix") ?? ""),
        receiving: of("receiving") !== false,
        blessing: of("blessing") !== false,
        lastSyncedAt: Number(of("lastSyncedAt") ?? 0),
        consecutiveFailures: Number(of("consecutiveFailures") ?? 0),
      },
    });
  }
  const all = [...latest.values()].map((v) => v.status);
  return name === undefined ? all : all.filter((s) => s.name === name);
}

export interface Channel {
  /** The pool's container name — `channel:<into>:<prefix>`. */
  readonly name: string;
  readonly into: string;
  readonly prefix: string;
  readonly pool: Container;
  sync(): Promise<SyncReport>;
}

// A receiving container is a PURE AGGREGATOR: everything it serves arrives through the pools nested
// beneath it, and each pool is its own ground. Its own membership is therefore empty — but DECLARED
// empty rather than omitted, because the door refuses an omitted membership for exactly the right
// reason: a shared container without a Term resolves silently empty on every scoped read, which is
// H9 through a different door. Declaring it says "empty on purpose" in the bytes, where a reader can
// see it.
//
// The open design question this encodes (§46, for Myk): should a receiving container also gather the
// RECEIVER's own deltas, so `friends` holds my notes about friends alongside my friends' notes? That
// wants a marker in the vocabulary that does not exist yet, so today it aggregates peers only.
const AGGREGATOR = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: "\u0000none" } },
  in: "input",
} as const;

/** One pool per (receiving container, prefix): the prefix is the receiver's name for the peer. */
export const channelName = (into: string, prefix: string): string => `channel:${into}:${prefix}`;

/**
 * Bless the law that arrived in a channel's pool, under names the RECEIVER owns.
 *
 * The peer sends registrations, not a manifest — nothing in production publishes manifest rows, and
 * a peer has no reason to describe its exports in our vocabulary. So the CHANNEL writes the manifest
 * the peer did not send: one row per registration found in the pool, authored by the receiver's
 * operator, in the pool's own ground. That is not a workaround for a missing upstream feature; it is
 * the design saying the same thing twice — the receiver decides what it recognises from a peer, and
 * naming is the receiver's act throughout.
 *
 * `as` is what makes the name the receiver's. `livingNameOf` is `opts.as ?? ex.lensName`, and law
 * identity deliberately EXCLUDES the living name, so binding alice's Note at `alice:Note` is the
 * same law under a name of our choosing rather than a different law.
 *
 * A name already answered by different-content law is PARKED, never taken. `adoptLaw` refuses that
 * case by design ("a blessing must not silently re-point an existing reading"), and a standing
 * channel must not resolve it either: choosing between supersede and a second name is a decision,
 * and decisions do not ride a poll that runs while nobody is watching.
 */
async function bindArrived(
  gw: Gateway,
  ground: Gateway,
  prefix: string,
): Promise<{ bound: string[]; parked: string[] }> {
  const seed = gw.options.seed!;
  const operator = gw.operatorAuthor!;
  const bound: string[] = [];
  const parked: string[] = [];

  const members = [...ground.reactor.snapshot()];
  const rows = new Map<string, string>(); // alias -> hyperschema entity
  for (const d of members) {
    if (!isRegistrationBinding(d.claims)) continue;
    const target = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
    );
    if (target === undefined || target.target.kind !== "entity") continue;
    // A registration delta points at `registration:<hyperschema entity>`. The manifest row must
    // name the HYPERSCHEMA, which is where the law lives — pointing it at the registration names a
    // FACT, and adoptLaw refuses a fact by name ("facts bind nothing and need no blessing", §24.3).
    // That refusal is what caught this, and it is worth keeping the distinction in view: the
    // registration is the peer's act, the hyperschema is the law that act published.
    const pointed = target.target.entity.id;
    const entity = pointed.startsWith("registration:")
      ? pointed.slice("registration:".length)
      : pointed;
    if (!entity.startsWith("hyperschema:")) continue;
    // The alias is the peer's own name for the export. It is a LOOKUP KEY here, never a served
    // name — what gets served is `prefix:alias`, decided below.
    rows.set(entity.slice("hyperschema:".length), entity);
  }
  if (rows.size === 0) return { bound, parked };

  // The manifest rows land in the POOL, so a channel's recognition of a peer is recorded exactly
  // where that peer's bytes live — and is purged with them when the channel is dropped.
  const pending = [...rows].filter(
    ([alias]) => !members.some((d) => manifestAliasOf(d.claims) === alias),
  );
  if (pending.length > 0) {
    await ground.federate(
      pending.map(([alias, entity]) =>
        signClaims(
          manifestExportClaims(
            { alias, targetEntity: entity, kind: "schema" },
            operator,
            ground.nextTimestamp(),
          ),
          seed,
        ),
      ),
    );
  }

  const version = freezeMembers([...ground.reactor.snapshot()]);
  for (const [alias] of rows) {
    const name = `${prefix}:${alias}`;
    try {
      await gw.adoptLaw(version, alias, { as: name });
      bound.push(name);
    } catch (err) {
      // A refusal here is information, not a fault: the common one is that `name` is already
      // answered by different-content law, which is the parked case a person resolves.
      parked.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { bound, parked };
}

/** The alias a manifest row names, or undefined for any other delta. */
function manifestAliasOf(claims: { pointers: readonly unknown[] }): string | undefined {
  const ps = claims.pointers as readonly {
    role: string;
    target: { kind: string; value?: unknown; entity?: { id: string; context: string } };
  }[];
  const isRow = ps.some(
    (p) => p.target.kind === "entity" && p.target.entity?.context === CTX_MANIFEST,
  );
  if (!isRow) return undefined;
  const alias = ps.find((p) => p.role === "alias");
  return alias?.target.kind === "primitive" ? String(alias.target.value) : undefined;
}

/** Every prefix this receiving container already assigns, read live from the container table. */
function standingPrefixes(gw: Gateway, into: string): string[] {
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  const lead = `channel:${into}:`;
  const out: string[] = [];
  for (const name of table.containers.keys()) {
    if (name.startsWith(lead)) out.push(name.slice(lead.length));
  }
  return out;
}

export async function openChannelImpl(gw: Gateway, opts: OpenChannelOptions): Promise<Channel> {
  if (gw.options.seed === undefined) {
    throw new Error(
      "openChannel: only an operated store can open a federation channel — the pool's declaration " +
        "is signed constitutional data (§46)",
    );
  }
  const name = channelName(opts.into, opts.prefix);
  const existing = gw.federationChannels.get(name);
  if (existing !== undefined) return existing; // idempotent: re-opening resumes the same pool

  // INJECTIVITY, checked here because here is where a person can still choose differently. The
  // GraphQL door maps every non-alphanumeric to `_` (`legalNameFor`), so `alice:` and `alice_` are
  // disjoint entity namespaces that serve at the SAME field — the many-to-one squatting hazard
  // accounts.ts documents. A peer cannot exploit it because a peer never picks a prefix; the
  // receiver does, and the receiver's own store knows every prefix it has already assigned. So the
  // collision is decidable locally, and it fails closed at assignment rather than at publish.
  const flattened = legalNameFor(opts.prefix);
  for (const standing of standingPrefixes(gw, opts.into)) {
    if (standing !== opts.prefix && legalNameFor(standing) === flattened) {
      throw new Error(
        `openChannel refused: the prefix "${opts.prefix}" serves at the same GraphQL field as the ` +
          `prefix "${standing}", which this container already assigns — the door flattens every ` +
          `non-alphanumeric to "_", so the two would collide at "${flattened}". Choose another prefix.`,
      );
    }
  }

  // The receiving container must EXIST before a pool can mark it: `containerScope` skips an
  // inactive parent outright, and an inbox whose parent is not gathered is an inbox nobody reads.
  // Declaring it here is what "name a container to receive into" means — the receiver names it, and
  // naming it brings it into being if it is new. It is `curated` and `shared`: the receiver's own
  // trust domain, a view over their ground, with each peer's pool nested beneath it.
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  if (!table.containers.has(opts.into)) {
    await gw.append([
      signClaims(
        containerClaims(
          { container: opts.into, trust: "curated", posture: "shared", membership: AGGREGATOR },
          gw.operatorAuthor!,
          gw.nextTimestamp(),
        ),
        gw.options.seed,
      ),
    ]);
  }

  // The pool is UNTRUSTED and SEPARATE. Untrusted because a peer's law is inert until blessed
  // (§28); separate because its own ground is what keeps the peer's bytes out of the receiver's
  // store and keeps `drop` a physical purge.
  await gw.append([
    signClaims(
      containerClaims(
        { container: name, trust: "untrusted", posture: "separate", inboxOf: opts.into },
        gw.operatorAuthor!,
        gw.nextTimestamp(),
      ),
      gw.options.seed,
    ),
  ]);

  const pool = await gw.openContainer({ name });
  const ground = pool.gateway;
  if (ground === undefined) {
    throw new Error(
      `openChannel: ${name} resolved without its own ground — a pool must be separate`,
    );
  }

  // The opening record: `lastSyncedAt: 0` says NEVER SYNCED, which is deliberately distinct from a
  // stale timestamp. A channel that has never reached its peer must not read as merely quiet.
  await stamp(gw, {
    name,
    into: opts.into,
    prefix: opts.prefix,
    receiving: true,
    blessing: opts.bless !== false,
    lastSyncedAt: 0,
    consecutiveFailures: 0,
  });

  const channel: Channel = {
    name,
    into: opts.into,
    prefix: opts.prefix,
    pool,
    // Union, and idempotent by construction: the pool's append de-duplicates by delta id, so a
    // second sync of an unchanged peer accepts nothing and refuses nothing. Polling is therefore
    // safe at any interval, which is what lets the transport stay behind this contract.
    sync: async (): Promise<SyncReport> => {
      const before = channelStatusImpl(gw, name)[0];
      // FROZEN: read the toggle from the ground on every sync, so a freeze takes effect on the next
      // poll without restarting anything — the same "state is data" discipline as `loam:trust`.
      // A frozen channel reports honestly rather than silently doing nothing: it did not fail, and
      // it did not accept anything, and both are true.
      if (before?.receiving === false) {
        return { offered: 0, accepted: 0, duplicates: 0, bound: [], parked: [] };
      }
      let offered: readonly Delta[];
      try {
        offered = await opts.source.pull();
      } catch (err) {
        // A peer that did not answer is NOT a peer with nothing new. Record the failure before
        // rethrowing, so the count survives even when the caller swallows the error (H9).
        await stamp(gw, {
          name,
          into: opts.into,
          prefix: opts.prefix,
          receiving: before?.receiving ?? true,
          blessing: before?.blessing ?? opts.bless !== false,
          lastSyncedAt: before?.lastSyncedAt ?? 0,
          consecutiveFailures: (before?.consecutiveFailures ?? 0) + 1,
        });
        throw err;
      }
      // `federate`, never `append`. Admission and authorship are different axes (§28.1): a peer's
      // deltas carry the PEER's signatures and hold no write standing here, so the governed write
      // door refuses them — correctly. Federation is union by signature verification, and the
      // pool is exactly the bounded place that union is allowed to happen.
      const report = await ground.federate([...offered]);
      // The blessing toggle is read from the GROUND on every sync, not from the open-time option:
      // a pause must take effect on the next poll without restarting anything. Note this blesses
      // the pool's CONTENTS rather than this sync's arrivals, so resuming binds what landed while
      // blessing was off — which is the behaviour a person expects from "pause", and the reason a
      // sync that accepted nothing can still bind law.
      const blessing = before?.blessing ?? opts.bless !== false;
      const { bound, parked } = blessing
        ? await bindArrived(gw, ground, opts.prefix)
        : { bound: [] as string[], parked: [] as string[] };
      await stamp(gw, {
        name,
        into: opts.into,
        prefix: opts.prefix,
        receiving: before?.receiving ?? true,
        blessing: before?.blessing ?? opts.bless !== false,
        lastSyncedAt: gw.nextTimestamp(),
        consecutiveFailures: 0,
      });
      return {
        offered: report.offered,
        accepted: report.accepted,
        duplicates: report.offered - report.accepted,
        bound,
        parked,
      };
    },
  };
  gw.federationChannels.set(name, channel);
  return channel;
}

/**
 * Sever a channel and purge its pool — the irreversible half of §46's control surface.
 *
 * This is why a channel gets its OWN pool rather than sharing one inbox. `drop()` purges at the
 * bytes on every backend and REFUSES BY NAME if any byte survives (§27), so severing one peer is a
 * proven operation. Over a shared ground it would have been a filtered delete by author, and our
 * erasure rules would rightly demand a proof nobody could give.
 *
 * Two properties this must never lose, both pinned by rails:
 *  - a NAMED bystander channel keeps serving, at the bytes; and
 *  - a delta that arrived on two channels independently survives in the second pool. Union is
 *    union, and a purge that keyed on delta identity across the store rather than on the POOL would
 *    reach into a peer nobody asked to sever.
 *
 * Freezing is the reversible act and lives on the toggles; this one does not come back.
 */
export async function dropChannelImpl(gw: Gateway, name: string): Promise<void> {
  const channel = gw.federationChannels.get(name);
  const pool = channel?.pool ?? (await gw.openContainer({ name }));
  if (pool.drop === undefined) {
    throw new Error(
      `dropChannel refused: ${name} has no drop — only a SEPARATE container purges its own bytes, ` +
        `and a channel pool that is not separate cannot be severed provably (§46)`,
    );
  }
  await pool.drop();
  gw.federationChannels.delete(name);
}

/** Append one channel record. Latest-wins, so a stamp is an ordinary append rather than an edit. */
async function stamp(gw: Gateway, status: ChannelStatus): Promise<void> {
  await gw.append([
    signClaims(
      channelRecordClaims(status, gw.operatorAuthor!, gw.nextTimestamp()),
      gw.options.seed!,
    ),
  ]);
}

/**
 * Set a channel's toggles. Both are REVERSIBLE and orthogonal, which is Myk's design: receiving
 * governs whether bytes arrive, blessing governs whether law that arrives has force. Turning
 * blessing off withdraws a peer's authority WITHOUT severing the relationship — a state neither a
 * single switch nor `drop` can express.
 *
 * A set is an ordinary append: latest-wins, so the next sync reads the new posture from the ground.
 */
export async function setChannelImpl(
  gw: Gateway,
  name: string,
  next: { receiving?: boolean; blessing?: boolean },
): Promise<ChannelStatus> {
  const held = channelStatusImpl(gw, name)[0];
  if (held === undefined) {
    throw new Error(`setChannel refused: this store has no channel named "${name}"`);
  }
  const status: ChannelStatus = {
    ...held,
    ...(next.receiving === undefined ? {} : { receiving: next.receiving }),
    ...(next.blessing === undefined ? {} : { blessing: next.blessing }),
  };
  await stamp(gw, status);
  return status;
}
