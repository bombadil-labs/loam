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
import { makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
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
  /**
   * Law that was already served under ANOTHER name, so this channel's name was NOT created.
   * Distinct from `bound` on purpose — see the note in `bindArrived`.
   */
  readonly witnessed: string[];
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

/**
 * Every channel this store has EVER declared, severed ones included, latest-wins per channel.
 *
 * A severed channel is still a fact: its prefix named a peer, and law blessed under that prefix may
 * still be registered. A reader that sees only LIVE channels cannot tell a name that was never a
 * channel from one whose channel is gone — and that difference decides whether a lens resolves over
 * a pool or over the receiver's own ground (T199).
 */
export function channelsEverImpl(gw: Gateway, name?: string): ChannelStatus[] {
  return readChannels(gw, name, true);
}

/** The live reading of every channel record, or one by name. Latest-wins per channel. */
export function channelStatusImpl(gw: Gateway, name?: string): ChannelStatus[] {
  return readChannels(gw, name, false);
}

function readChannels(
  gw: Gateway,
  name: string | undefined,
  includeSevered: boolean,
): ChannelStatus[] {
  const latest = new Map<string, { at: number; status: ChannelStatus }>();
  for (const d of gw.reactor.snapshot()) {
    const marker = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_CHANNEL,
    );
    if (marker === undefined || marker.target.kind !== "entity") continue;
    if (!includeSevered && struck(gw, d.id)) continue;
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
): Promise<{ bound: string[]; parked: string[]; witnessed: string[] }> {
  const seed = gw.options.seed!;
  const operator = gw.operatorAuthor!;
  const bound: string[] = [];
  const parked: string[] = [];
  const witnessed: string[] = [];

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
  if (rows.size === 0) return { bound, parked, witnessed };

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
  const cursed = new Set(cursesOf(gw, channelNameOf(gw, prefix)).map((c) => c.living));
  for (const [alias] of rows) {
    const name = `${prefix}:${alias}`;
    // A cursed name is skipped on every poll. Without this the standing sync would re-bless what the
    // operator retired, one interval later and silently (§46 criterion 11).
    if (cursed.has(name)) continue;
    try {
      const outcome = await gw.adoptLaw(version, alias, { as: name });
      // "witnessed" IS NOT "bound", and reporting it as bound was a false report of the plainest
      // kind: `bound` said the name serves, and the store threw on it.
      //
      // adoptLaw refuses to publish law it already serves under another name, deliberately —
      // `schemaLawAddress` excludes the LIVING NAME, so identical law has one address whatever it
      // is called, and a module blessed twice must not bind twice. Federation meets that rule from
      // the other side: two peers who both ran `loam register --stock note` have byte-identical
      // law, so the SECOND channel's name is never created. That is the default case, not an edge.
      //
      // Until a second name can serve the same law (T198), the honest thing is to say so. The
      // caller learns the name does not answer and which one does, instead of learning it is bound.
      if (outcome.kind === "witnessed") witnessed.push(name);
      else bound.push(name);
    } catch (err) {
      // A refusal here is information, not a fault: the common one is that `name` is already
      // answered by different-content law, which is the parked case a person resolves.
      parked.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { bound, parked, witnessed };
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

/**
 * Is this delta STRUCK — that is, does any negation of it SURVIVE?
 *
 * `negationsOf(id).length > 0` asks whether a strike EXISTS, which is not the same question: a
 * struck strike stops binding under the substrate's algebra, and its target revives. Reading
 * presence where survival is meant is H1's "one link is not enough" clause, and it is what makes
 * lifting a curse expressible at all — the lift negates the curse's negation, and every reader of
 * that binding must then see it as live again.
 */
function struck(gw: Gateway, id: string): boolean {
  return gw.reactor.negationsOf(id).some((n) => gw.reactor.negationsOf(n).length === 0);
}

/** The channel a prefix belongs to, for reading its curses during a bind. */
function channelNameOf(gw: Gateway, prefix: string): string {
  return channelStatusImpl(gw).find((c) => c.prefix === prefix)?.name ?? "";
}

/**
 * Every prefix this STORE already assigns, read live from the container table.
 *
 * Store-wide, not per-container, and the distinction is a real defect this fixes: a living name is
 * `<prefix>:<alias>` and carries no container, so two channels in different containers that share a
 * prefix aim at the same names. Worse, both prefix-to-channel lookups (the scoped read path, and the
 * curse filter) resolve by prefix ALONE — so one peer's claims could answer a lens blessed from the
 * other, and a curse recorded on one channel was invisible to the other's poll.
 */
function standingPrefixes(gw: Gateway): { channel: string; prefix: string }[] {
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  const out: { channel: string; prefix: string }[] = [];
  for (const name of table.containers.keys()) {
    if (!name.startsWith("channel:")) continue;
    const cut = name.indexOf(":", "channel:".length);
    if (cut > 0) out.push({ channel: name, prefix: name.slice(cut + 1) });
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
  for (const standing of standingPrefixes(gw)) {
    // Skip only THIS channel — re-opening the same (into, prefix) resumes. Any OTHER channel whose
    // prefix flattens the same is a refusal, including one that is byte-identical in a different
    // container: the earlier guard compared prefixes and so skipped exactly that case.
    if (standing.channel === name) continue;
    if (legalNameFor(standing.prefix) === flattened) {
      throw new Error(
        `openChannel refused: the prefix "${opts.prefix}" collides with the prefix ` +
          `"${standing.prefix}" already assigned by "${standing.channel}". A living name is ` +
          `"<prefix>:<alias>" and carries no container, so two channels sharing a prefix aim at the ` +
          `same names — and the door flattens every non-alphanumeric to "_", so near-misses collide ` +
          `too. Choose another prefix.`,
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

  const pool = await gw.openContainer({
    name,
    // Durability is the store's choice, not the channel's: without a backend a separate container
    // is in-memory, and a channel that forgets its peer on restart is not federation.
    ...(gw.options.channelBackend === undefined
      ? {}
      : { backend: gw.options.channelBackend(name) }),
  });
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
        return { offered: 0, accepted: 0, duplicates: 0, bound: [], parked: [], witnessed: [] };
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
      const { bound, parked, witnessed } = blessing
        ? await bindArrived(gw, ground, opts.prefix)
        : { bound: [] as string[], parked: [] as string[], witnessed: [] as string[] };
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
        witnessed,
      };
    },
  };
  gw.federationChannels.set(name, channel);
  gw.channelPools.set(name, pool);
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
  // A NAME THIS STORE NEVER HAD gets a sentence, not the container layer's internals. Without this
  // it surfaced as `openContainer: no surviving declaration names "..."` — true, and it tells a
  // person nothing about what they typed wrong.
  if (channelStatusImpl(gw, name).length === 0) {
    const severed = channelsEverImpl(gw, name)[0];
    throw new Error(
      severed === undefined
        ? `dropChannel refused: this store has no channel named "${name}" — ` +
            `\`loam federate list\` names the ones it has.`
        : `dropChannel refused: "${name}" was already severed, so there is nothing left to remove.`,
    );
  }

  const channel = gw.federationChannels.get(name);

  // REFUSES RATHER THAN REPORTING A PURGE IT CANNOT PROVE (P5, erasure lens, 2026-08-19).
  //
  // The fallback below used to be `openContainer({ name })` with NO backend. A separate container
  // defaults to a fresh in-memory store, so drop() purged that empty copy, byte-verified it,
  // reported a clean sever — and left the pool's sqlite file untouched forever, with the container
  // declaration struck so nothing could re-attach it and no erasure fan-out could reach it. A purge
  // report that is false, in the one direction that has no recovery (H7, §11).
  //
  // So: sever only through a handle that provably holds the real bytes. If this store cannot
  // produce one, it says so and removes nothing. An honest refusal is always available; a false
  // completion is not recoverable.
  const attached = gw.channelPools.get(name);
  if (channel === undefined && attached === undefined && gw.options.channelBackend === undefined) {
    throw new Error(
      `dropChannel refused: this store has no live handle on "${name}" and no channelBackend to ` +
        `re-open it with, so a purge here would run against an empty in-memory copy and report a ` +
        `completeness it never verified. Open the channel in this process first, or configure ` +
        `channelBackend. Nothing was removed.`,
    );
  }
  const pool =
    channel?.pool ??
    attached ??
    (await gw.openContainer({
      name,
      ...(gw.options.channelBackend === undefined
        ? {}
        : { backend: gw.options.channelBackend(name) }),
    }));
  if (pool.drop === undefined) {
    throw new Error(
      `dropChannel refused: ${name} has no drop — only a SEPARATE container purges its own bytes, ` +
        `and a channel pool that is not separate cannot be severed provably (§46)`,
    );
  }
  await pool.drop();
  gw.federationChannels.delete(name);
  gw.channelPools.delete(name);

  // THE RECORD GOES WITH THE BYTES. Without this, `federate list` kept printing the channel as
  // receiving after it was severed, `setChannel` still succeeded on it, and every later boot
  // re-attempted an attach that cannot work because the declaration is struck. One command said
  // severed and the next said standing — and of the two, the one that keeps being read is the lie.
  if (gw.options.seed !== undefined) {
    for (const d of [...gw.reactor.snapshot()]) {
      const marker = d.claims.pointers.find(
        (pt) => pt.target.kind === "entity" && pt.target.entity.context === CTX_CHANNEL,
      );
      if (marker === undefined || marker.target.kind !== "entity") continue;
      if (marker.target.entity.id !== `channel:${name}`) continue;
      if (gw.reactor.negationsOf(d.id).length > 0) continue;
      await gw.append([
        signClaims(
          makeNegationClaims(gw.operatorAuthor!, gw.nextTimestamp(), d.id),
          gw.options.seed,
        ),
      ]);
    }
  }
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

export interface StandingSync {
  stop(): Promise<void>;
}

/**
 * The standing instruction: keep accepting on every open channel, until stopped.
 *
 * Polling is the transport TODAY, and deliberately the only thing here that knows so. Everything
 * above this function speaks in channels, so a push transport replaces this and changes nothing
 * else — which was the strongest argument for the container-to-container shape in the first place.
 *
 * Safe at any interval because a sync is idempotent by construction: federation is union, and a
 * second sync of an unchanged peer accepts nothing. A frozen channel is skipped by its own toggle,
 * read from the ground each time.
 *
 * A failing channel must never take the loop down with it. One unreachable peer raises its own
 * `consecutiveFailures` and the others keep going — the counter is where that failure becomes
 * visible, which is why swallowing the error here is honest rather than H9: the record is written
 * before the throw.
 */
export function keepSyncingImpl(gw: Gateway, opts: { everyMs?: number } = {}): StandingSync {
  const everyMs = Math.max(20, opts.everyMs ?? 60_000);
  let stopped = false;
  let running: Promise<void> = Promise.resolve();

  const tick = async (): Promise<void> => {
    for (const channel of [...gw.federationChannels.values()]) {
      if (stopped) return;
      try {
        await channel.sync();
      } catch {
        // Recorded on the channel's own record by `sync` before it threw. One dead peer does not
        // stop the others.
      }
    }
  };

  const timer = setInterval(() => {
    if (stopped) return;
    running = running.then(tick);
  }, everyMs);
  // Never hold the process open for a poll: a store that cannot exit because it is watching a peer
  // is a worse bug than a missed sync.
  timer.unref?.();

  return {
    stop: async (): Promise<void> => {
      stopped = true;
      clearInterval(timer);
      await running; // an in-flight tick finishes before the caller believes it has stopped
    },
  };
}

export const CTX_CURSE = "loam.channel.curse";

/**
 * Retire ONE already-bound law from a channel — Myk's "curse", the opposite of a blessing.
 *
 * A curse is not a pause. Pausing blessing stops NEW law binding and leaves everything bound; this
 * reaches one bound lens and retires it. Both are reversible and neither severs the channel.
 *
 * IT IS RECORDED, NOT INFERRED, and that is the whole design. A standing sync re-reads the pool
 * every tick, so a retirement held only in the surface would be silently undone by the next poll —
 * the operator's judgement would hold for one interval and then quietly stop, with nothing anywhere
 * saying so. That is H7: a report that becomes false without a further act. The record is what makes
 * "retired" keep being true.
 *
 * Deprecation is negation (§21): the lens leaves the surface because its registration is negated,
 * not because anything is deleted. The store only learns.
 */
export async function curseChannelLawImpl(
  gw: Gateway,
  channel: string,
  living: string,
  opts: { lift?: boolean } = {},
): Promise<void> {
  const seed = gw.options.seed;
  if (seed === undefined) {
    throw new Error("curseChannelLaw: only an operated store may retire law it blessed (§46)");
  }
  const standing = channelStatusImpl(gw, channel)[0];
  if (standing === undefined) {
    throw new Error(`curseChannelLaw refused: this store has no channel named "${channel}"`);
  }

  if (opts.lift === true) {
    // LIFT THE STRIKE, NOT ONLY THE RECORD. adoptLaw inherits its source's timestamps, and a delta
    // id hashes {author, pointers, timestamp} — so a re-published binding re-mints THE SAME ID the
    // curse struck. Measured: the id is byte-identical, and the blessing then refuses with "the
    // blessed law persisted but does not serve". The binding is born dead, and no amount of
    // re-syncing revives it. Negating the curse's own negation is the only thing that can.
    for (const binding of [...gw.reactor.snapshot()]) {
      if (!isRegistrationBinding(binding.claims)) continue;
      const p = binding.claims.pointers.find((pt) => pt.role === "schema");
      const lens =
        p?.target.kind === "entity" && p.target.entity.id.startsWith("schema:")
          ? p.target.entity.id.slice("schema:".length)
          : undefined;
      if (lens !== living) continue;
      for (const negationId of gw.reactor.negationsOf(binding.id)) {
        if (gw.reactor.negationsOf(negationId).length > 0) continue; // already lifted
        await gw.append([
          signClaims(makeNegationClaims(gw.operatorAuthor!, gw.nextTimestamp(), negationId), seed),
        ]);
      }
    }
    gw.replayRegistrations();
    // Lifting strikes the curse record itself. The next poll re-blesses through the ordinary path,
    // so nothing here needs to know how binding works.
    for (const d of cursesOf(gw, channel)) {
      if (d.living !== living) continue;
      // The substrate's own negation shape. A hand-rolled "negates" pointer is not one — it appends
      // cleanly, changes nothing, and the curse silently keeps standing.
      await gw.append([
        signClaims(makeNegationClaims(gw.operatorAuthor!, gw.nextTimestamp(), d.deltaId), seed),
      ]);
    }
    return;
  }

  // (the curse record is written below, AFTER the checks — see the refusal)

  // Retire the binding NOW as well as recording it, so the surface changes on this call rather than
  // on the next poll. The record is what KEEPS it retired; this is what makes it immediate.
  //
  // Deprecation is negation (§21): strike the REGISTRATION BINDING and the lens leaves the surface.
  // Nothing is deleted — the definition and the peer's deltas stay exactly where they are, and
  // lifting the curse re-blesses through the ordinary path.
  // KEYED ON THE LENS, NOT THE ENTITY, and it strikes EVERY live binding that serves the name.
  //
  // The first version read `gw.def(living).entity` and struck the FIRST binding whose pointer named
  // that entity. Three ways that is wrong, and none of them are visible in a corpus where one entity
  // carries one lens and one version — which is exactly the corpus its rail used (H10):
  //   - the hyperschema entity is not the lens (H6 in the bytes): under §21.7 coexistence two
  //     readings share one entity, so it could strike a SIBLING and leave the cursed lens serving;
  //   - `.find` picks one of however many survive, by snapshot order;
  //   - and finding none returned SUCCESS, one line below a docstring promising the lens leaves the
  //     surface (H7).
  //
  // Two of the three are not reachable through a channel TODAY — bindArrived derives its alias from
  // the entity, so a peer's sibling lenses collapse into one (T197), and a republish strikes its
  // predecessor so only one binding survives. They are fixed anyway: the reachability is an accident
  // of the aliasing, and the verification below is what makes the report true rather than lucky.
  // Read BEFORE the record is written: a first draft wrote the curse record first and then asked
  // whether one existed, so its own write satisfied the check and the refusal was unreachable.
  const alreadyCursed = cursesOf(gw, channel).some((c) => c.living === living);

  const livesAt = (d: Delta): string | undefined => {
    const p = d.claims.pointers.find((pt) => pt.role === "schema");
    if (p?.target.kind !== "entity") return undefined;
    const id = p.target.entity.id;
    return id.startsWith("schema:") ? id.slice("schema:".length) : id;
  };
  const bindings = [...gw.reactor.snapshot()].filter(
    (d) =>
      isRegistrationBinding(d.claims) &&
      livesAt(d) === living &&
      gw.reactor.negationsOf(d.id).length === 0,
  );
  if (bindings.length === 0 && !alreadyCursed) {
    throw new Error(
      `curseChannelLaw refused: "${living}" is not served by this store, so there is nothing to ` +
        `retire. Nothing was struck and nothing was recorded.`,
    );
  }

  // Past every refusal: record the curse (what KEEPS it retired across polls), then strike.
  await gw.append([
    signClaims(
      {
        timestamp: gw.nextTimestamp(),
        author: gw.operatorAuthor!,
        pointers: [
          {
            role: "curse",
            target: { kind: "entity", entity: { id: `channel:${channel}`, context: CTX_CURSE } },
          },
          { role: "living", target: { kind: "primitive", value: living } },
        ],
      },
      seed,
    ),
  ]);
  for (const binding of bindings) {
    await gw.append([
      signClaims(makeNegationClaims(gw.operatorAuthor!, gw.nextTimestamp(), binding.id), seed),
    ]);
  }
  gw.replayRegistrations();

  // THE VERDICT IS THE SURFACE, NOT THE COUNT. A purge's count is evidence, never the verdict (T70),
  // and the same holds for a retirement: this refuses rather than reporting a lens left the surface
  // when it is still being served.
  let stillServes = true;
  try {
    gw.def(living);
  } catch {
    stillServes = false;
  }
  if (stillServes) {
    throw new Error(
      `curseChannelLaw refused: struck ${bindings.length} binding(s) for "${living}" and the lens ` +
        `is STILL SERVED. Something else binds that name — the curse is recorded, so the standing ` +
        `sync will not re-bless it, but this store is still answering the name now.`,
    );
  }
}

/** The living names cursed on a channel, with the delta that said so. */
export function cursesOf(gw: Gateway, channel: string): { living: string; deltaId: string }[] {
  const out: { living: string; deltaId: string }[] = [];
  for (const d of gw.reactor.snapshot()) {
    const marker = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_CURSE,
    );
    if (marker === undefined || marker.target.kind !== "entity") continue;
    if (marker.target.entity.id !== `channel:${channel}`) continue;
    if (struck(gw, d.id)) continue;
    const living = d.claims.pointers.find((p) => p.role === "living");
    if (living?.target.kind === "primitive") {
      out.push({ living: String(living.target.value), deltaId: d.id });
    }
  }
  return out;
}

/**
 * A channel's source: a live peer over the federation door, or a frozen offer file.
 *
 * Both reach the same channel contract, which is what makes "someone sent me an offer" and "I
 * subscribed to a public source" ONE code path (§46 criteria 1 and 2) — a second path would drift,
 * and the drift would land on whichever direction had fewer tests.
 *
 * It lives here rather than in the CLI because the MCP door needs it too, and a server importing the
 * CLI is the wrong direction. A copy in each caller is how the friend rail broke earlier tonight:
 * the duplicate diverged from the shipped original and the test kept passing against its own copy.
 */
export function sourceFor(
  from: string,
  token: string | undefined,
  readOffer: (path: string) => string,
  parseOffer: (raw: string) => Delta[],
): ChannelSource {
  const isUrl = /^https?:\/\//i.test(from);
  if (!isUrl) {
    return { pull: () => Promise.resolve(parseOffer(readOffer(from))) };
  }
  return {
    pull: async () => {
      const res = await fetch(`${from}/federate`, {
        headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(
          `the peer answered ${res.status} at ${from}/federate` +
            (res.status === 403
              ? " — federation wants the peer's operator token today; a container-scoped offer " +
                "token is T188's loam_federate_offer, which waits on where a credential lives (T196)"
              : ""),
        );
      }
      return parseOffer(await res.text());
    },
  };
}
