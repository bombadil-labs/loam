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
import { contentAddress, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import type { Container } from "../gateway/container.js";
import { containerClaims, readContainerTable } from "../gateway/container.js";
import type { FederationReport, Gateway } from "../gateway/gateway.js";
import { legalNameFor } from "../gateway/gql.js";
import { parseOffer } from "./offer.js";
import {
  CTX_MANIFEST,
  isRegistrationBinding,
  isWithheldResolver,
  manifestExportClaims,
  readManifest,
} from "../gateway/adopt-law.js";
import { CTX_REGISTRATION, lawfulNegated, lensOf } from "../gateway/registration.js";
import { freezeMembers } from "../gateway/container-identity.js";
import type { RendererBinding } from "../gateway/renderers.js";
import { readForeignRenderers, readPoolRenderers, routeServableOn } from "../gateway/renderers.js";

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
  /**
   * Where the peer IS — persisted on the channel record so a booted store can rebuild this channel
   * and resume its standing sync. Ordinary data; the credential it presents is not, and lives in the
   * home (T196).
   */
  readonly from?: string;
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
  /**
   * The peer's APPS sitting in this channel's pool. A renderer is code, and the blessing toggle does
   * not reach it (§24.6) — so these are reported, never bound. `blessed` says whether THIS code is
   * what serves today, which is why a report can name an app on every poll without ever mounting it.
   */
  readonly apps: readonly ArrivedApp[];
}

/** One app of a channel: what the peer OFFERS, and what this store RUNS. */
export interface ArrivedApp {
  readonly channel: string;
  /** The peer's own route — the handle `loam federate bless-app --route` takes. */
  readonly route: string;
  /** What this store serves it as: the receiver's prefix over the peer's route (§46.2). */
  readonly serves: string;
  /**
   * The identity of the app the PEER OFFERS today. Absent once the peer withdrew it — and the row
   * survives that, because this store may still be running what it blessed.
   */
  readonly hash?: string;
  /** The app this channel has MOUNTED at that route, if any. Mounted is not the same as serving. */
  readonly mounted?: string;
  /** The app this store actually ANSWERS WITH at `serves`. Absent means that name answers nothing. */
  readonly serving?: string;
  /**
   * Why a mounted app does not answer: something else holds the name. Names the thing that is in
   * the way, because the remedy is to move THAT, and no blessing can help.
   */
  readonly shadowed?: string;
  /** What would give the name back — a different sentence per obstruction, written where it is known. */
  readonly remedy?: string;
  /** A mounted app whose LENS is not bound here — cursed, or its registration withdrawn (§23.6). */
  readonly dark?: true;
  /**
   * The peer's app carries a PEN: it asks to WRITE, under a granted author, and blessing it takes
   * its own flag (§6's two keys). On the row because it is the decision the identity exists to
   * surface — an operator told only "different code" has not been told the difference that matters.
   */
  readonly wantsPen?: string;
  /**
   * Why the blessing door would REFUSE this row, when it would. A listing that offered `bless-app`
   * here would be printing a command that throws — the failure this whole shape exists to avoid —
   * so the reason is carried instead of the recipe.
   */
  readonly unmountable?: string;
  /**
   * Nothing is mounted here and nothing can be: a route of the RECEIVER'S OWN holds that name, and
   * the blessing door refuses it. Distinct from `shadowed`, which is about a mount that exists.
   */
  readonly blocked?: string;
  /** Is the code the peer offers the code that answers? Every absence above is why this is not one field. */
  readonly blessed: boolean;
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
  /** The peer's address, or "" for a channel opened before addresses were recorded. */
  readonly from: string;
  /**
   * Arrivals this channel accepted and could not stamp — the custody debt, carried on the record
   * until a later sync names them. Empty is the healthy reading, and every record written before
   * this field existed reads back empty.
   *
   * It is on the RECORD rather than in memory because the sync that could not stamp is exactly the
   * sync that throws: a standing sync swallows that throw, and the next poll holds the same deltas,
   * so it accepts none and would have nothing to stamp. Without the debt written down, the gap
   * could never be found again except by scanning the pool against its own stamps.
   */
  readonly unattested: readonly string[];
  /**
   * The roles this record did not carry in the shape a channel record is written in — empty for a
   * legible record, and the only honest reading of the fields it names.
   *
   * ADDITIVE, and that is load-bearing: the fields beside it keep their coerced values, so a
   * `Number("soon")` still reads back NaN and no row is ever dropped. Nothing that already read a
   * ChannelStatus loses a field; a surface that wants to tell the truth reads this instead of
   * re-deriving a guess from the coercions, and the two cases it can see that a coercion cannot are
   * the ones that mattered — an ABSENT field coerces to a perfectly finite 0, and a toggle that is
   * any value but the boolean `false` coerces to "on".
   *
   * Derived at the READER and never written down. A marker carried on the record could be cleared
   * by whoever wrote the record it is meant to indict.
   */
  readonly unreadable: readonly string[];
}

const isText = (v: unknown): boolean => typeof v === "string";
const isFlag = (v: unknown): boolean => typeof v === "boolean";
/** Finite and not below zero: "−3 consecutive failures" is not a health reading either. */
const isCount = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * The six roles every channel record carries, each with the test its value must pass.
 *
 * `channelRecordClaims` writes all six on every record it has ever written, so an absent one is not
 * an older record — it is a record this store cannot read. `from` and `unattested` are deliberately
 * NOT here: both are omitted when empty, so absence is legible for them and only a wrong shape is
 * not.
 *
 * The test rides in the row rather than a name that is looked up: a name needs a fallback, and a
 * fallback silently accepts whatever it does not recognise.
 */
const RECORD_SHAPES: readonly (readonly [string, (v: unknown) => boolean])[] = [
  ["into", isText],
  ["prefix", isText],
  ["receiving", isFlag],
  ["blessing", isFlag],
  ["lastSyncedAt", isCount],
  ["consecutiveFailures", isCount],
];

export const CTX_CHANNEL = "loam.channel";

/**
 * A channel's own state, as deltas. Myk's rule: channel state is expressible as deltas like
 * everything else, so a person can query how a channel is doing rather than ask the process.
 *
 * Latest-wins by timestamp AMONG THE OPERATOR'S OWN RECORDS — each sync appends a fresh record and
 * the newest reading is the live one. `consecutiveFailures` is the field that makes H9 visible
 * here: "0 accepted" is the same visible answer for a quiet peer and an unreachable one, and only
 * the second licenses believing you are current when you are not.
 *
 * `status.unreadable` is not written, and must not be: it is the reader's verdict ON a record, and
 * a record that carried its own verdict could carry a false one.
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
      // The peer's ADDRESS, so a booted store can rebuild this channel. Ordinary data; the
      // credential it presents lives in the home and never here (T196). Omitted when empty so a
      // record written before addresses existed reads back unchanged.
      ...(status.from === ""
        ? []
        : [{ role: "from" as const, target: { kind: "primitive" as const, value: status.from } }]),
      // THE CUSTODY DEBT, one pointer per owed arrival, and omitted entirely when there is none —
      // the same idiom as `from`, so a healthy record reads exactly as it did before this field
      // existed. The ids ride as primitives rather than delta-refs on purpose: the arrivals live in
      // the POOL's ground, and this record lives in the receiver's, where a citation of them would
      // point at nothing. The list is bounded by what arrived since the last successful stamp.
      ...status.unattested.map((id) => ({
        role: "unattested" as const,
        target: { kind: "primitive" as const, value: id },
      })),
    ],
  };
}

export const CTX_ARRIVAL = "loam.arrival";

/**
 * How many delta-refs one attestation carries. A sync that accepts more is stamped `ceil(N/256)`
 * times rather than once with an unbounded pointer list — a delta whose size is a peer's choice is
 * an H8 shape, and nothing downstream may assume a stamp is the whole sync.
 */
export const ARRIVAL_FAN = 256;

/**
 * One arrival attestation: WHEN a named set of deltas stepped through a named door.
 *
 * Three provenance layers already stand — the signature names the author, the pool names the last
 * hop, the prefix names the receiver's petname for the peer. None of them records custody in time.
 * The channel record's `lastSyncedAt` says when the door last opened, never what came through it.
 *
 * This closes that as ordinary data, which buys two things nothing else had to be built for: it
 * rides an as-of read of the pool ("what had arrived by Tuesday"), and it purges WITH the pool when
 * the channel is dropped — correct, because the trail was about the severed peer.
 *
 * RECEIVER-SIGNED. Custody is a claim about this store's own act, so a peer can neither make one
 * nor forge one. It is also what keeps a stamp out of law: `bindArrived` enumerates a peer's
 * exports from PEER-authored bindings, so the receiver's own authorship excludes these by the same
 * filter that stops a blessing being re-blessed.
 */
export function arrivalClaims(
  arrival: { channel: string; from: string; arrived: readonly string[] },
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    author,
    pointers: [
      {
        role: "arrival",
        target: {
          kind: "entity",
          entity: { id: `channel:${arrival.channel}`, context: CTX_ARRIVAL },
        },
      },
      // Omitted when empty, exactly as the channel record omits it: a channel opened before
      // addresses were recorded has no address, and "" is not one.
      ...(arrival.from === ""
        ? []
        : [{ role: "from" as const, target: { kind: "primitive" as const, value: arrival.from } }]),
      ...arrival.arrived.map((id) => ({
        role: "arrived" as const,
        target: { kind: "delta" as const, deltaRef: { delta: id } },
      })),
    ],
  };
}

/**
 * A refusal that KNOWS what it left unstamped. The caller writes these ids onto the channel record
 * before rethrowing, which is what turns a custody gap into a debt a later sync can pay.
 */
class UnattestedArrivals extends Error {
  readonly unattested: readonly string[];
  constructor(message: string, unattested: readonly string[]) {
    super(message);
    this.unattested = unattested;
  }
}

/**
 * Stamp this sync's custody into the channel's own pool — one attestation per `ARRIVAL_FAN` refs.
 *
 * NOTHING ACCEPTED AND NOTHING OWED, NOTHING WRITTEN. Liveness is already the channel record's job,
 * and a standing sync polls forever: a stamp per poll would grow the pool without recording a
 * single arrival.
 *
 * ONE TIMESTAMP for the whole sync, so a batch split by the cap still reads as one arrival rather
 * than as several. It comes from the POOL's clock because the stamps live in the pool, and an as-of
 * read there is what reads them back.
 *
 * `owed` is what an earlier sync accepted and could not stamp, read from the channel record. It
 * joins this sync's arrivals in one batch, so a refusal HEALS on a later poll instead of stranding
 * those arrivals: the deltas are already held, so no later sync would ever accept them again, and
 * nothing else would ever bring them back into view.
 */
async function attestArrival(
  gw: Gateway,
  ground: Gateway,
  name: string,
  from: string,
  report: FederationReport,
  owed: readonly string[],
): Promise<void> {
  // CHECKED FIRST, so a quiet poll never refuses: nothing arrived and nothing is owed, so there is
  // no custody to claim and no sentence about one that would be true. The guard below is deferred
  // by this, never skipped — a door that will not name its arrivals is caught on the first poll
  // that accepts one.
  if (report.accepted === 0 && owed.length === 0) return;
  // REFUSE RATHER THAN STAMP A CUSTODY THIS CANNOT POINT AT. The door names what it ingested only
  // when asked (`ids: true`); asked and answered with a shorter list, an attestation would silently
  // under-claim, and a custody trail with an undeclared gap is worse than none.
  const arrived = report.acceptedIds;
  if (arrived === undefined || arrived.length !== report.accepted) {
    // A plain refusal, because there is nothing to write down: the debt is real and UNNAMEABLE —
    // the door would not say which deltas it took. The channel records the failure and the counter;
    // this sync's arrivals are recoverable only by scanning the pool against its stamps.
    throw new Error(
      `sync could not record the arrival on "${name}": the pool's door reported ${report.accepted} ` +
        `accepted delta(s) and named ${arrived?.length ?? 0} of them, so an attestation would ` +
        `claim a custody it cannot point at. The peer's deltas landed; nothing was attested, and ` +
        `the channel cannot record which arrivals are owed one.`,
    );
  }
  // The debt first, then this sync's arrivals, deduped — the cap chunks the UNION, so a healing
  // sync obeys the same fan as any other. A carried ref is stamped LATE and says so only by the
  // stamp's own timestamp: the moment is the sync that recorded it, not the sync it arrived on.
  const union = [...new Set([...owed, ...arrived])];
  const at = ground.nextTimestamp();
  const batch: { refs: string[]; stamp: Delta }[] = [];
  for (let i = 0; i < union.length; i += ARRIVAL_FAN) {
    const refs = union.slice(i, i + ARRIVAL_FAN);
    batch.push({
      refs,
      stamp: signClaims(
        arrivalClaims({ channel: name, from, arrived: refs }, gw.operatorAuthor!, at),
        gw.options.seed!,
      ),
    });
  }
  // `federate`, like the manifest rows the channel writes beside them: the pool is a separate
  // ground, and this is the door the receiver's own writes into it already take. `ids: true` for
  // the same reason the arrivals call asks: a PARTIAL landing must name which stamps stand, or the
  // debt below would carry refs already recorded — or, far worse, drop refs nothing recorded.
  //
  // A stamp IS a citation of its arrivals, so a slate closing `cite` is the mechanism that could
  // refuse one. No offer reaches it today — a slate's members are frozen from the ground the pool
  // already holds, and a delta the pool already holds is `held` rather than newly accepted, so this
  // sync's refs and that slate's members are disjoint sets. The check is what keeps that an
  // observation about today rather than a load-bearing assumption.
  let landed: FederationReport;
  try {
    landed = await ground.federate(
      batch.map((b) => b.stamp),
      { ids: true },
    );
  } catch (err) {
    // The door failed the whole batch, so every ref is owed. Over-carrying costs a second stamp for
    // a ref that may already stand; under-carrying costs the gap this exists to close.
    throw new UnattestedArrivals(err instanceof Error ? err.message : String(err), union);
  }
  if (landed.accepted !== batch.length) {
    const stood = new Set(landed.acceptedIds ?? []);
    const covered = new Set(batch.filter((b) => stood.has(b.stamp.id)).flatMap((b) => b.refs));
    const unattested = union.filter((id) => !covered.has(id));
    throw new UnattestedArrivals(
      `sync could not fully record the arrival on "${name}": the pool took ${landed.accepted} of ` +
        `${batch.length} attestation(s). The ${unattested.length} arrival(s) not yet named are ` +
        `recorded on the channel and will be re-attested on the next sync.`,
      unattested,
    );
  }
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
  // EVERYTHING WHEN UNGOVERNED, THE OPERATOR'S DELTAS WHEN GOVERNED — `lawfulSnapshot`'s rule,
  // applied here rather than borrowed, because this reader also needs the marker and the ordering.
  //
  // An early `return []` for the ungoverned case would be worse than useless: `channelGroundFor`
  // reads "no channel with that prefix" as licence to resolve the lens over the RECEIVER's own
  // ground, so a store that merely cannot name its operator would serve its own private claims
  // under a peer's name. A reader that cannot tell must not answer "there is nothing".
  const operator = gw.operatorAuthor;
  // The substrate's negation algebra over the LAWFUL slice, the shape every constitutional reader
  // here uses: a strike retires its target only while it survives itself, and only the operator's
  // strike counts. A stranger's negation of a channel record used to sever the channel on every
  // live reading — the same defect as the forged record below, arriving from the other side.
  const negated = lawfulNegated(gw.reactor, operator);
  const latest = new Map<string, { at: number; status: ChannelStatus }>();
  for (const d of gw.reactor.snapshot()) {
    // THE AUTHOR IS PART OF THE SHAPE. Every record is written by `stamp`, signed as the operator,
    // so a channel-shaped delta from anyone else is a stranger's claim ABOUT this store's channels
    // rather than one of them — and latest-wins would let one appended a millisecond later flip a
    // real channel's toggles, invent a channel that was never opened, or hide one that was.
    if (operator !== undefined && d.claims.author !== operator) continue;
    const marker = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_CHANNEL,
    );
    if (marker === undefined || marker.target.kind !== "entity") continue;
    if (!includeSevered && negated(d.id)) continue;
    const of = (role: string): string | number | boolean | undefined => {
      const p = d.claims.pointers.find((q) => q.role === role);
      return p?.target.kind === "primitive" ? p.target.value : undefined;
    };
    const channel = marker.target.entity.id.slice("channel:".length);
    const held = latest.get(channel);
    if (held !== undefined && held.at >= d.claims.timestamp) continue;
    // WHAT THIS RECORD DOES NOT SAY IN ITS OWN SHAPE. The coercions below are unchanged — a reader
    // that threw on a bad record would take every channel surface down with it — but coercion
    // alone defaults toward HEALTH, and that is the report this names instead of making: an absent
    // `lastSyncedAt` reads 0, which is exactly what a channel that has never synced carries, and
    // `receiving !== false` is true of every value that is not the boolean `false`.
    const unreadable: string[] = [];
    for (const [role, holds] of RECORD_SHAPES) {
      if (!holds(of(role))) unreadable.push(role);
    }
    // Absent by design when empty, so only a wrong shape is illegible here — never an absence.
    const address = d.claims.pointers.find((p) => p.role === "from");
    if (
      address !== undefined &&
      (address.target.kind !== "primitive" || typeof address.target.value !== "string")
    ) {
      unreadable.push("from");
    }
    // Repeated role, read by hand: `of` answers with ONE primitive, and the custody debt is a list.
    const unattested: string[] = [];
    let debtUnreadable = false;
    for (const p of d.claims.pointers) {
      if (p.role !== "unattested") continue;
      // Dropping one silently would UNDERSTATE the debt, which is the same toward-health direction
      // every other default here took.
      if (p.target.kind !== "primitive") debtUnreadable = true;
      else unattested.push(String(p.target.value));
    }
    if (debtUnreadable) unreadable.push("unattested");
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
        from: String(of("from") ?? ""),
        unattested,
        unreadable,
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
    // THE PEER'S exports are the PEER-AUTHORED bindings. The receiver's own blessings land in this
    // same pool (§47 slice 3), and enumerating per lens would otherwise read them back as fresh
    // exports — blessing "alice:Plant" into "alice:alice:Plant", one layer per poll, forever. The
    // entity-keyed enumeration hid this by accident; the author filter states it.
    if (d.claims.author === gw.operatorAuthor) continue;
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
    // ONE ROW PER LENS, read from the binding's own `schema:<name>` bytes — never per entity. The
    // entity-derived alias was T197's collapse: a peer's sibling lenses (§21.7, two readings over
    // one definition) federated as one, the second not parked, not refused, simply invisible — H6
    // one layer down, the name a reader asks by derived from the PROGRAM's address instead of the
    // READING. Two rows may share a targetEntity; that is what a manifest is for. The alias is a
    // LOOKUP KEY here, never a served name — what gets served is `prefix:alias`, decided below.
    const living = d.claims.pointers.find((p) => p.role === "schema");
    const lens =
      living?.target.kind === "entity" && living.target.entity.id.startsWith("schema:")
        ? living.target.entity.id.slice("schema:".length)
        : entity.slice("hyperschema:".length);
    rows.set(lens, entity);
  }
  if (rows.size === 0) return { bound, parked, witnessed };

  // The manifest rows land in the POOL, so a channel's recognition of a peer is recorded exactly
  // where that peer's bytes live — and is purged with them when the channel is dropped.
  // The OPERATOR's rows only. A peer who pre-plants a row under a lens-shaped alias would otherwise
  // suppress the receiver's own mint and choose what `<prefix>:<lens>` resolves to.
  const pending = [...rows].filter(
    ([alias]) =>
      !members.some((d) => d.claims.author === operator && manifestAliasOf(d.claims) === alias),
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
      // INTO THE POOL (§47 slice 3): the blessing is published on the pool's own gateway, so the
      // binding lives with the peer's data — dropping the channel takes both, and the receiver's
      // root ground never holds a channel's law. The pool gateway carries the operator's seed
      // (openSeparate hands it down), so this is the same operator's act in a narrower ground. The
      // receiver's surface serves the lens by AGGREGATION at replay, folded below.
      // `expect: "schema"` states what this pass is FOR. It looks its rows up by alias, and an alias
      // is a lookup key a peer's own law can collide with — so without the assertion, a manifest row
      // naming a RENDERER under a lens's name would let the name-binding toggle publish code that
      // runs. Auto-bless never auto-executes (§24.6), and this is where that is enforced rather
      // than assumed.
      const outcome = await ground.adoptLaw(version, alias, {
        as: name,
        expect: "schema",
        manifest: "operator",
        // AUTO-BLESS BINDS THE NAME AND WITHHOLDS THE CODE. A registration may carry §22 resolver
        // ESM, and publishing one LOADS that ESM on the gateway it is published to — no pool, no
        // worker, no frame. This pass runs unattended on a poll, so passing resolvers through would
        // make "the blessing toggle is on" mean "a stranger's code runs here", which is the one
        // sentence §24.6 exists to refuse. The fields refuse by name until a person says otherwise.
        resolvers: "withhold",
      });
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
  // Fold the receiver's surface: the blessing landed in the pool, and the aggregation in
  // replayRegistrations is what makes it serve.
  if (bound.length > 0) gw.replayRegistrations();
  return { bound, parked, witnessed };
}

/**
 * WHAT AN APP IS, for the purpose of "is this the same app?" — everything the binding serves with
 * EXCEPT the lens name.
 *
 * The bundle alone is not enough, and getting that wrong is the H7 shape this report exists to
 * avoid: a peer who re-points a route to the SAME bundle carrying a PEN and a `writable` list has
 * changed what the app may do, and a hash over the bundle would call that no change at all. §6's two
 * keys are a decision an operator makes about a specific binding, so the thing they compare has to
 * move when the pen does. `adopt-law`'s own `rendererLawAddress` says the same thing in the same
 * words — "a pen swap is a different renderer".
 *
 * THE LENS NAME IS EXCLUDED, and it is the one field that must be. The receiver RENAMES the lens on
 * the way in (§46.2: `Plant` becomes `alice:Plant`), so the arrived binding and the blessed one
 * never agree about it, and a hash that included it could never match — every app would read as
 * changed, forever. The residual is real and named rather than hidden: a peer who changes ONLY the
 * lens their app reads moves nothing here. What RUNS is unaffected — the blessed binding goes on
 * reading the lens the blessing resolved — so the flag stays true about the code; it is silent about
 * a re-point that would only take effect at the next blessing.
 */
const appIdentity = (r: RendererBinding): string =>
  contentAddress(
    new TextEncoder().encode(
      // LENGTH-PREFIXED, not separated. A separator is only unambiguous over values that cannot
      // contain it, and a peer SIGNS these fields: a renderer binding's route, bundle and pen name
      // are checked for shape at this store's publish door, and a federated binding never passes
      // through it. Given any separator, a hostile peer can move bytes across a field boundary and
      // mint two different bindings with one identity — which would defeat `expect` (swap the
      // bundle after the listing, the pin still matches) and make `blessed` true about code that is
      // not what runs. A count cannot be forged into a different reading of the same bytes.
      [
        "loam.channel.app",
        r.route,
        JSON.stringify([...r.consumes]),
        r.bundle,
        JSON.stringify([...(r.writable ?? [])]),
        r.pen ?? "",
        // The §17 VERSION a binding pins decides which frozen reading it renders against, and
        // whether the route goes dark at all (§23.6). A re-point between pins with one bundle is a
        // different app by every question an operator would ask about it.
        r.versionId ?? "",
      ]
        // The count is of the BYTES this encoder emits, not of UTF-16 units — a prefix that counts
        // one thing while the hash covers another is a question nobody should have to answer.
        .map((field) => `${new TextEncoder().encode(field).length}:${field}`)
        .join(""),
    ),
  );

/**
 * The peer's renderer bindings in a channel's pool, latest per route.
 *
 * Survival is scoped per author by `readForeignRenderers` — a peer's own retraction retires their
 * own app, and nobody else's strike does, the same algebra `adopt-law` keeps over a module's
 * members. WHAT IT DOES NOT SCOPE is the WINNER: a route is one name, the pool binds one thing at
 * it, and the latest binding across every non-operator author takes it by `(timestamp, deltaId)`.
 * So a pool carrying more than one author's renderer bindings — a peer relaying a third party's
 * deltas — is a contest, and a later timestamp wins it. That is the same latest-wins every name in
 * the store resolves by, and it is worth stating because the operator's decision surface shows one
 * row per route without naming who authored it.
 *
 * The operator's own slice is excluded, because a blessing lands in this same pool (§47.4) and
 * reading it back would report the receiver's act as a fresh arrival, forever.
 */
function arrivedBindings(gw: Gateway, ground: Gateway): RendererBinding[] {
  const operator = gw.operatorAuthor;
  // No operator is no answer, not an empty one: without one, "not the operator's" is every delta in
  // the pool, and the listing would report a peer's law and the receiver's own alike.
  if (operator === undefined) return [];
  return readForeignRenderers(ground.reactor, operator);
}

/**
 * The apps of ONE channel: what the peer OFFERS and what this store RUNS, as two separate facts.
 *
 * Collapsing them into one boolean made the report lie in both directions, which is H7 pointed at
 * the surface an operator reads before deciding. A peer who ships new code at a blessed route makes
 * `hash` move while the old binding goes on serving — reporting that as "inert, nothing runs" is
 * false and its remedy would throw. A peer who WITHDRAWS an app drops out of the arrivals entirely
 * while this store keeps running the bundle it blessed — reporting nothing at all is worse. So the
 * rows are the UNION of both sides, and each names which half it has.
 *
 * `serving` is asked of the door's own predicate rather than of the binding's existence: a binding
 * whose lens was later withdrawn is still in the table and answers 404 (§23.6). What it still does
 * not ask is whether the BUNDLE loads, which is `prepareRoute`'s business and cannot be known from
 * the ground — the residual is named here rather than papered over.
 */
function appsOf(
  gw: Gateway,
  ground: Gateway,
  channel: string,
  prefix: string,
  siblings: readonly string[],
): ArrivedApp[] {
  // WHAT THIS CHANNEL HAS MOUNTED at each route: the operator-authored bindings that live only in
  // the POOL. The custody test is the same one delegation makes — a pool is one-way seeded with the
  // receiver's whole ground, so every renderer this store owns has an operator-signed twin in here,
  // and counting a twin would tell an operator their peer's route runs code it does not.
  const mounted = new Map(readPoolRenderers(ground, gw).map((r) => [r.route, r]));
  // READ ONCE, not once per route. Both of these walk a whole ground, and the ROUTE COUNT is
  // peer-controlled — a route costs a peer one delta, and this runs on every sync poll, every
  // listing and every connector read (H8).
  const hostRoutes = new Set(gw.renderers().map((r) => r.route));
  const poolWinner = new Map(ground.renderers().map((r) => [r.route, r]));
  const offeredBindings = new Map(arrivedBindings(gw, ground).map((r) => [r.route, r]));
  const offered = new Map([...offeredBindings].map(([route, r]) => [route, appIdentity(r)]));
  const rows: ArrivedApp[] = [];
  for (const route of new Set([...offered.keys(), ...mounted.keys()])) {
    const hash = offered.get(route);
    const own = mounted.get(route);
    // MOUNTED IS NOT SERVING, and the difference is the whole reason this report exists. Three ways
    // a standing blessing answers nothing, each with a different remedy and none of them "bless it":
    const serves = `${prefix}:${route}`;
    // (a) the receiver's own law answers the name this app would serve under. Their own name is
    // theirs (§46.2) and the delegation is the fallback, so the channel's app never gets the call.
    const hostHolds = hostRoutes.has(serves);
    // (a2) ANOTHER CHANNEL owns that name. A prefix may contain a colon (§46.2 admits `al:ice`, and
    // only flattening collisions are refused), so `alice` and `alice:sub` can both stand — and then
    // `alice:sub:note` is claimed by both. The DOOR gives it to the longer prefix; a report that
    // did not ask the same question would call this app served while the other one answered.
    // The LONGEST such prefix, because that is the one the door hands the name to — naming any
    // other channel would be true about the obstruction and wrong about who has it.
    const claimedBy = siblings
      .filter(
        (p) =>
          p.length > prefix.length && serves.startsWith(`${p}:`) && serves.length > p.length + 1,
      )
      .sort((a, b) => b.length - a.length)[0];
    // (b) a twin of the receiver's own route holds the bare name INSIDE the pool. Every attach
    // re-pulses the seeding edge, so this arrives long after a blessing — and it is just as true
    // before one: this is the ONE the blessing door refuses, by that name.
    const poolHolds =
      poolWinner.get(route) !== undefined && poolWinner.get(route)!.deltaId !== own?.deltaId;
    const shadow = hostHolds
      ? `your own route "${serves}"`
      : claimedBy !== undefined
        ? `the channel prefixed "${claimedBy}:", whose namespace that name falls inside`
        : poolHolds
          ? `your own route "${route}", seeded into this pool`
          : undefined;
    // ONE REMEDY PER OBSTRUCTION. "Your own law wins its own names" is true of two of these and
    // flatly wrong about the third: when a sibling CHANNEL holds the name, nothing of the
    // operator's own is in the way and stopping their own law clears nothing.
    const remedy =
      shadow === undefined
        ? undefined
        : claimedBy !== undefined
          ? `drop that channel, or re-open this one under a prefix its namespace does not contain`
          : "your own law wins its own names; this one answers when yours stops";
    // (c) the route answers nothing — a cursed or withdrawn lens (§23.6), or a reading this store
    // cannot assemble at all. ASKED OF THE DOOR, not of the registry: `routeServableOn` reports
    // whether a lens is REGISTERED, and a registered lens whose scope cannot be built throws at the
    // resolve — so a report that stopped at presence said SERVES about a route answering 400. The
    // probe is the same call `serveRouteImpl` makes before it renders, run against an entity no
    // store holds: what it exercises is whether the reading can be assembled, which is the half a
    // registration cannot promise.
    const dark =
      own !== undefined &&
      shadow === undefined &&
      (!routeServableOn(ground, own, "full") || !resolves(ground, own.schemaName));
    // NOTHING MOUNTED, AND NOTHING MOUNTABLE — and only cause (b) is that. The blessing door looks
    // for a twin at the BARE route, so a host route named `<prefix>:<route>` is invisible to it and
    // a blessing there SUCCEEDS; what it will never do is answer, because the receiver's own law
    // wins its own name. Calling that "cannot mount" would be as false as calling it inert, in the
    // other direction — so it stays `shadowed`, and the report says the blessing would not help.
    const blocked =
      own === undefined && poolHolds && !hostHolds && claimedBy === undefined
        ? `your own route "${route}", seeded into this pool`
        : undefined;
    const serving =
      own === undefined || shadow !== undefined || dark ? undefined : appIdentity(own);
    // WHAT THE BLESSING DOOR WOULD REFUSE, asked here so the listing never offers it. Two causes
    // today, both of them refusals this store makes about the SHAPE of a peer's binding rather than
    // about anything the operator can change: a §17 pin names a delta of the PEER's own store,
    // which this one does not hold; and a route the publish door will not accept is one no blessing
    // can file. Reporting either as merely "inert" prints a remedy that always throws.
    const offeredHere = offeredBindings.get(route);
    const unmountable =
      offeredHere === undefined
        ? undefined
        : offeredHere.versionId !== undefined
          ? "it pins a version of the peer's OWN store, and this store does not hold that delta"
          : route === "" || route.includes("/") || route.includes("\u0000")
            ? `this store's publish door will not accept the route "${route}"`
            : undefined;
    rows.push({
      channel,
      route,
      serves,
      ...(unmountable === undefined ? {} : { unmountable }),
      ...(offeredBindings.get(route)?.pen === undefined
        ? {}
        : { wantsPen: offeredBindings.get(route)!.pen! }),
      ...(hash === undefined ? {} : { hash }),
      ...(own === undefined ? {} : { mounted: appIdentity(own) }),
      ...(serving === undefined ? {} : { serving }),
      ...(shadow === undefined || blocked !== undefined
        ? {}
        : { shadowed: shadow, ...(remedy === undefined ? {} : { remedy }) }),
      ...(blocked === undefined ? {} : { blocked }),
      ...(dark ? { dark: true as const } : {}),
      blessed: hash !== undefined && hash === serving,
    });
  }
  return rows.sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
}

/** Every arrived app across this store's live channels, or one channel's (SPEC §24.6). */
export function channelAppsImpl(gw: Gateway, channel?: string): ArrivedApp[] {
  const out: ArrivedApp[] = [];
  // EVERY channel's prefix, even when the caller asked about one: a name's owner is decided across
  // the whole set, so a per-channel answer computed without the others is a guess.
  const prefixes = channelStatusImpl(gw).map((c) => c.prefix);
  for (const status of channelStatusImpl(gw, channel)) {
    const ground = gw.channelPools.get(status.name)?.gateway;
    // A channel whose pool this process has not attached is reported as carrying no apps rather
    // than guessed at — the pool is where the answer lives, and there is no second copy of it.
    if (ground === undefined) continue;
    out.push(...appsOf(gw, ground, status.name, status.prefix, prefixes));
  }
  return out;
}

/**
 * MOUNT ONE ARRIVED APP — the explicit act, and the whole point of §24.6's "quarantine-first".
 *
 * Everything else on a channel is reversible bookkeeping: `receiving` decides whether bytes arrive,
 * `blessing` decides whether a NAME binds. This decides whether a stranger's CODE RUNS, which is a
 * strictly wider grant than either, so it is neither toggle's business and it is never automatic.
 * One route, named by a person, every time.
 *
 * What it does NOT widen, and the one thing it does not bound: the app is published on the POOL's
 * gateway, so it runs on the pool's ground, wears §24.7's probation frame, writes only into the
 * pool, and goes with the pool when the channel is dropped. What none of that reaches is AMBIENT
 * AUTHORITY — §24.5's open flag, stated here because this is the door that first lets bytes a
 * stranger signed execute on this host. Two halves, and the second is easy to miss: the §23.9
 * worker bounds hang, crash and memory for the RENDER, and it is not an ocap sandbox, so a bundle
 * can still reach `node:fs` or a socket. The module BODY is not even in the worker — `publishRenderer`
 * loads the bundle to check it is loadable, and `prepareRoute` loads it again in whatever process
 * first serves the route, both on the calling thread with no clock. Blessing a peer's app is
 * running their program.
 * `dependencies: "refuse"` keeps the act to the one export asked for — a
 * renderer whose lens is not blessed is refused, never quietly blessed along with it — and
 * `expect: "renderer"` means a manifest alias can never turn this into a schema blessing.
 *
 * A PEER CANNOT CHOOSE WHAT THIS BLESSES. The pool is a store the PEER writes into, the manifest
 * vocabulary is not reserved, and `readManifest` is latest-per-alias across all authors — so a peer
 * can author a row that wins `app:<route>` and points somewhere else. `manifest: "operator"` makes
 * the alias mean what this store's operator said it means, and the post-freeze check below refuses
 * rather than blessing a target the operator's own rows do not name.
 *
 * WHAT THOSE GUARDS DO NOT GIVE YOU, stated because the difference matters: they bind the alias to
 * the binding THIS CALL resolved, not to the one a person read in a listing a moment earlier. The
 * two are separate invocations and a standing sync polls between them, so a peer who lands newer
 * code at the route in that window is what mounts. `expect` closes that when it matters: pass the
 * identity the listing showed and the call refuses anything else. Without it the door is
 * last-writer-wins, which is honest for an unattended script and not enough for a decision.
 */
export async function blessChannelAppImpl(
  gw: Gateway,
  channel: string,
  route: string,
  opts: { pen?: boolean; supersede?: boolean; expect?: string } = {},
): Promise<void> {
  const status = channelStatusImpl(gw, channel)[0];
  const ground = gw.channelPools.get(channel)?.gateway;
  if (status === undefined || ground === undefined) {
    throw new Error(
      `bless-app refused: this store holds no open channel named "${channel}" — ` +
        "`loam federate list` names the ones it has, and a severed channel is gone for good",
    );
  }
  const arrived = arrivedBindings(gw, ground);
  const app = arrived.find((r) => r.route === route);
  if (app === undefined) {
    throw new Error(
      `bless-app refused: "${channel}" has received no app at the route "${route}" — it offers ` +
        (arrived.length === 0
          ? "none yet, so there is nothing to mount"
          : arrived.map((r) => `"${r.route}"`).join(", ")),
    );
  }
  // THE IDENTITY THE OPERATOR MEANT, when they named one. `federate list` and this call are separate
  // invocations with a standing sync between them, so "the app at route hello" can mean different
  // code by the time this runs. A prefix of the identity the listing printed is enough to say which.
  if (opts.expect !== undefined) {
    // A PIN SHORT ENOUGH TO MATCH ANYTHING IS NOT A PIN, and the empty string matches everything —
    // so a caller who believes they pinned would be told they had. Refused rather than honoured.
    // EVERY identity begins `1e20` — the multihash tag and length — so the first four characters
    // discriminate nothing at all. A "pin" of eight characters is four real ones, sixteen bits, a
    // number of bundle variants a peer grinds through in milliseconds. The floor counts the
    // constant, and the refusal explains why rather than just naming a number.
    if (opts.expect.length < 20) {
      throw new Error(
        `bless-app refused: --expect "${opts.expect}" is too short to identify an app. Every id ` +
          "starts `1e20`, so a short pin is mostly that constant — paste the whole id `loam " +
          "federate list` prints. A pin a peer can grind past reads as a pin and is not one.",
      );
    }
    if (!appIdentity(app).startsWith(opts.expect)) {
      throw new Error(
        `bless-app refused: "${route}" on "${channel}" is ${appIdentity(app).slice(0, 28)} now, ` +
          `and you asked for ${opts.expect}. The peer changed it between the listing and this ` +
          "call. Nothing was blessed; re-read `loam federate list`.",
      );
    }
  }
  // A ROUTE THE RECEIVER'S OWN LAW ALREADY ANSWERS INSIDE THE POOL. A pool is one-way seeded with
  // this store's whole ground, so a route name the receiver uses has an operator-signed twin in
  // here. The listing hides those (they are not this channel's apps), but the blessing door's own
  // name guard sees one and refuses with a delta id no listing ever showed — and its stated remedy
  // would strike the copy of the operator's own binding. Refused here instead, in words about the
  // thing that is actually in the way.
  const twin = ground.renderers().find((r) => r.route === route);
  if (twin !== undefined && gw.reactor.get(twin.deltaId) !== undefined) {
    throw new Error(
      `bless-app refused: this pool holds a copy of YOUR OWN route "${route}", seeded from this ` +
        "store's ground — so the name is already answered in there by law of yours. A peer's app " +
        "cannot take it. Rename your own route, or ask the peer to publish theirs elsewhere.",
    );
  }
  const seed = gw.options.seed;
  const operator = gw.operatorAuthor;
  if (seed === undefined || operator === undefined) {
    throw new Error("only an operated store may bless an app (a blessing is the operator's claim)");
  }
  // The manifest row a peer never sent, minted in the POOL — the same shape `bindArrived` mints for
  // a lens, and purged with the pool on a drop. It names the binding by CONTENT ADDRESS because that
  // is how §27.8 names a renderer, and re-minting it whenever the peer re-points the route is what
  // keeps a blessing pointed at the code that arrived rather than the code that used to be there.
  const alias = `app:${route}`;
  const members = [...ground.reactor.snapshot()];
  // THE DEDUPE ASKS THE QUESTION THE GUARD BELOW ASKS — which row WINS this alias — and not the
  // easier one, does a row saying this exist. They differ the moment a peer withdraws a binding and
  // an earlier one resurfaces: an old row naming it is still present and unstruck, so a presence
  // test skips the mint, the newer row goes on winning, and the guard then refuses that route
  // forever while the listing keeps recommending the command that refuses. Presence is not
  // survival, and it is not victory either. (Operator-scoped for the other half: unscoped, a peer
  // who plants a decoy row naming the right target would suppress the receiver's own mint.)
  const mine = readManifest(members.filter((d) => d.claims.author === operator));
  if (mine.find((r) => r.alias === alias)?.target !== app.deltaId) {
    await ground.federate([
      signClaims(
        manifestExportClaims(
          { alias, targetAddress: app.deltaId, kind: "renderer" },
          operator,
          ground.nextTimestamp(),
        ),
        seed,
      ),
    ]);
  }
  const frozen = [...ground.reactor.snapshot()];
  const version = freezeMembers(frozen);
  // THE BLESSING MOUNTS WHAT THE LISTING NAMED, or it refuses. Read the alias back out of the very
  // members the version froze, exactly as `adoptLaw` will read it, and confirm it still resolves to
  // the binding the operator asked about. `manifest: "operator"` should already make this true; a
  // guard that only holds when another guard holds is not a guard, and the cost is one lookup.
  const resolved = readManifest(frozen.filter((d) => d.claims.author === operator)).find(
    (r) => r.alias === alias,
  );
  if (resolved?.target !== app.deltaId) {
    throw new Error(
      `bless-app refused: this pool's manifest no longer names "${route}" as the binding the ` +
        `listing showed (delta ${app.deltaId.slice(0, 12)}…) — nothing was blessed. Re-read ` +
        "`loam federate list` and bless the app it names.",
    );
  }
  await ground.adoptLaw(version, alias, {
    expect: "renderer",
    dependencies: "refuse",
    manifest: "operator",
    ...(opts.pen === true ? { pen: true } : {}),
    ...(opts.supersede === true ? { supersede: true } : {}),
  });
}

/**
 * RUN A PEER'S RESOLVER CODE for one lens — the second explicit act, and a sibling of `bless-app`.
 *
 * A channel blesses NAMES on its own; it never runs code on its own. An arriving registration whose
 * fields are computed by the peer's ESM binds with those resolvers withheld, so the fields refuse
 * and say what is missing. This is the act that supplies it: the operator names one lens, and its
 * registration is re-published with the peer's resolvers in place.
 *
 * WHAT IT DOES NOT CARRY, and its sibling does: a pin. `bless-app --route` takes `--expect` and the
 * listing prints an app's identity to paste into it; a withheld LENS is printed by name alone, and
 * this act grants whatever the pool holds when it runs. A poll landing between the listing and the
 * act therefore grants newer law than the operator read. The act refuses the flag rather than
 * ignoring it, so nobody is told they pinned something; closing it wants an identity for a lens's
 * resolver law, which is its own change.
 *
 * It keeps `bless-app`'s discipline, for the same reasons. The act is per lens, never per channel.
 * The law comes from the pool's own manifest under the operator's own rows, so a peer cannot choose
 * what it grants. And it supersedes deliberately, because the incumbent is the withheld binding
 * this store published — taking that name back is the entire point of the call.
 *
 * WHAT IT DOES NOT BOUND is what `bless-app` does not bound: this code runs on the POOL's gateway,
 * in-process, with no clock. A resolver is not a render and never reaches §23.9's worker at all.
 */
export async function blessChannelResolversImpl(
  gw: Gateway,
  channel: string,
  lens: string,
): Promise<string> {
  const status = channelStatusImpl(gw, channel)[0];
  const ground = gw.channelPools.get(channel)?.gateway;
  if (status === undefined || ground === undefined) {
    throw new Error(
      `bless-app refused: this store holds no open channel named "${channel}" — ` +
        "`loam federate list` names the ones it has",
    );
  }
  const seed = gw.options.seed;
  const operator = gw.operatorAuthor;
  if (seed === undefined || operator === undefined) {
    throw new Error("only an operated store may bless law (a blessing is the operator's claim)");
  }
  // The operator names the lens the way this store serves it; the manifest knows it by the peer's
  // own bare name, which is what the prefix was put in front of.
  const served = lens.startsWith(`${status.prefix}:`) ? lens : `${status.prefix}:${lens}`;
  const alias = served.slice(status.prefix.length + 1);
  const withheld = withheldLenses(gw, ground, status.prefix);
  if (!withheld.includes(served)) {
    throw new Error(
      `bless-app refused: "${served}" on "${channel}" holds no withheld resolvers — ` +
        (withheld.length === 0
          ? "nothing on this channel is waiting on that act"
          : `these are: ${withheld.map((l) => `"${l}"`).join(", ")}`),
    );
  }
  const version = freezeMembers([...ground.reactor.snapshot()]);
  await ground.adoptLaw(version, alias, {
    as: served,
    expect: "schema",
    manifest: "operator",
    resolvers: "grant",
    // The incumbent is this store's own withheld binding, and replacing it IS the request.
    supersede: true,
  });
  await ground.preloadResolvers();
  gw.replayRegistrations();
  // THE NAME THIS ACTED ON, because the caller may have typed the bare one. A caller that compared
  // its own argument against a reader that answers prefixed names would be asking a question that
  // cannot match — a check that passes because it is empty, not because the state is good.
  return served;
}

/**
 * The lenses this channel serves whose resolvers are WITHHELD — the decisions waiting on a person.
 *
 * Read from the code that would run, not from a record beside it: a stub carries its own mark, so
 * the report cannot drift from what the store holds.
 */
export function withheldLenses(gw: Gateway, ground: Gateway, prefix: string): string[] {
  const out: string[] = [];
  for (const r of ground.registered) {
    const specs = r.resolvers;
    if (specs === undefined) continue;
    // `lensOf`, not the schema's own name (H6): the READING is what a person names to this act, and
    // what `blessChannelResolvers` then binds under. Two derivations that agree today would let a
    // sibling reading be gated by one name and granted under another.
    const name = lensOf(r);
    if (!name.startsWith(`${prefix}:`)) continue;
    if (Object.entries(specs).some(([field, spec]) => isWithheldResolver(spec.code, name, field))) {
      out.push(name);
    }
  }
  return out.sort();
}

/**
 * Can this store ASSEMBLE the reading behind a lens?
 *
 * A registration is a promise that a name is filed, not that a view can be built from it: a gather
 * that scopes a container reaches for that container's bytes, and a store that cannot reach them
 * refuses at the resolve rather than at the registry (H9 — a scope must never resolve as if it were
 * empty). The entity is deliberately one no store holds; nothing about it is read, and building the
 * scope is the whole question.
 *
 * Its failing side is not reachable from the surfaces the rails drive — a channel lens is scoped by
 * the channel's OWN container name, which a pool always answers for itself. It is defence in depth
 * against the next reader of this row going stale, and it is named as unrailed rather than dressed
 * up with a fixture built by hand into a state the doors cannot produce.
 */
function resolves(ground: Gateway, lens: string): boolean {
  try {
    ground.surface("full")?.hooks.resolve(lens, "loam:probe-no-such-entity", undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark a pool as a CHANNEL's, on its own gateway.
 *
 * A pool is an attached container and therefore a mount in its own right, so the mark has to ride
 * the pool rather than a lookup on the parent — the door that reaches it may never consult the
 * parent at all. ONE caller: `attachChannelPool`, which is the one place a channel's pool is
 * attached. A mark written at each attach site instead is a mark that gets missed at the next one.
 */
function markChannelPool(pool: Container): void {
  if (pool.gateway !== undefined) pool.gateway.channelPool = true;
}

/**
 * ATTACH A CHANNEL'S POOL — the one place that does it, and therefore the one place that marks it.
 *
 * A pool becomes a MOUNT the moment it attaches, so a pool attached without its mark is an
 * anonymously-readable copy of this store's ground for as long as the process lives. There are
 * three sites that need one — opening a channel, resuming one at boot, and the drop path's
 * re-open — and a mark written at each of them is a mark that will be missed at a fourth. This
 * function exists so there is nothing to remember.
 *
 * The mark lands just AFTER the attach publishes the mount, not before it, so there is a window in
 * which the pool is routable and unmarked — and a channel IS opened against a live router today,
 * by the connect tool. What keeps the window shut is narrower than it looks, and worth naming
 * because a future door could open it: the re-attach path awaits a real append only when a DETACH
 * record has to be struck, and nothing in this tree detaches a channel pool, so the span from
 * mount-published to marked crosses microtasks and never a turn that serves a request. Closing it
 * properly means the container primitive learning what a channel pool is — §27's business, not
 * this function's.
 */
export async function attachChannelPool(gw: Gateway, name: string): Promise<Container> {
  const pool = await gw.openContainer({
    name,
    // Durability is the store's choice, not the channel's: without a backend a separate container
    // is in-memory, and a channel that forgets its peer on restart is not federation.
    ...(gw.options.channelBackend === undefined
      ? {}
      : { backend: gw.options.channelBackend(name) }),
  });
  markChannelPool(pool);
  return pool;
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
 * Every prefix this STORE already assigns, and every pool whose prefix it cannot name.
 *
 * Store-wide, not per-container, and the distinction is a real defect this fixes: a living name is
 * `<prefix>:<alias>` and carries no container, so two channels in different containers that share a
 * prefix aim at the same names. Worse, both prefix-to-channel lookups (the scoped read path, and the
 * curse filter) resolve by prefix ALONE — so one peer's claims could answer a lens blessed from the
 * other, and a curse recorded on one channel was invisible to the other's poll.
 *
 * THE PREFIX IS NEVER GUESSED FROM THE POOL'S NAME ALONE. A pool is named `channel:<into>:<prefix>`
 * and a container name may itself carry a colon, so no split of that name by itself can separate the
 * two halves: into "ada:feed" + prefix "alice" and into "ada" + prefix "feed:alice" mint the SAME
 * name. Two of the store's own records DO know, and both are read, in this order:
 *
 *  - the channel RECORD states the receiver's choice under its `prefix` role. It is the receiver's
 *    own sentence rather than a derivation, so it stands whatever the pool is called or renamed;
 *  - failing that, the pool's DECLARATION names the container half under its own `inboxOf` role,
 *    and the remainder of the name is then the prefix exactly. It answers for a pool declared
 *    before its record landed — openChannel appends the two separately, and a fault between them
 *    would otherwise leave a pool assigning a prefix this guard could not see.
 *
 * WHAT COUNTS AS A POOL is either reading calling it one: a record that names it, or a declaration
 * that marks a parent. A container the operator merely NAMED `channel:something` is not a pool,
 * marks nothing, and assigns no prefix. And a record whose declaration is gone still assigns its
 * prefix, because the two halves of a sever can fail apart: of the two mistakes available there,
 * reserving a prefix nobody uses costs a person one rename, and freeing one that two channels answer
 * to cannot be undone.
 *
 * A POOL NEITHER READING CAN NAME IS REPORTED, NEVER SKIPPED — a declaration that marks a parent its
 * own name was not built from, with no record to say otherwise. Dropping it silently would let the
 * caller's collision check report a clean result over a set it could not enumerate, which is the H9
 * shape at the one door that exists to fail closed.
 *
 * WHICH CHANNELS EXIST stays the container table's answer: a severed channel leaves both readings by
 * the same act, and only the operator's own lawful law binds in either.
 */
function standingPrefixes(gw: Gateway): {
  standing: { channel: string; prefix: string }[];
  unresolved: string[];
} {
  const recorded = new Map(channelStatusImpl(gw).map((c) => [c.name, c.prefix]));
  const standing: { channel: string; prefix: string }[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const [name, rec] of readContainerTable(gw.reactor, gw.operatorAuthor).containers) {
    if (!name.startsWith("channel:")) continue;
    const prefix = recorded.get(name) ?? declaredPrefix(name, rec.inboxOf);
    if (prefix !== undefined) standing.push({ channel: name, prefix });
    else if (rec.inboxOf === undefined)
      continue; // not a pool: nothing calls it one
    else unresolved.push(name);
    seen.add(name);
  }
  for (const [name, prefix] of recorded) {
    if (!seen.has(name)) standing.push({ channel: name, prefix });
  }
  return { standing, unresolved };
}

/**
 * The prefix half of a pool's name, cut against the parent its own declaration marks.
 *
 * `inboxOf` is what makes this a reading rather than a guess: it states the container half, so the
 * remainder is the prefix however many colons either half carries. A declaration that does not mark
 * the parent its name was built from cuts nothing — undefined, never a best effort.
 */
function declaredPrefix(name: string, inboxOf: string | undefined): string | undefined {
  if (inboxOf === undefined) return undefined;
  const lead = `channel:${inboxOf}:`;
  return name.startsWith(lead) ? name.slice(lead.length) : undefined;
}

/**
 * The prefix a channel's own NAME carries — `channel:<into>:<prefix>`.
 *
 * A STRUCTURAL GUESS that splits at the first colon after `channel:`, so it cannot separate the two
 * halves when either carries a colon (T215) — it is only the last resort `reads.ts` reaches when a
 * record's `prefix` primitive is among the roles the reader condemned, where a legible reading is
 * gone and the name is the only identity left. The collision guard reads the record and the
 * declaration instead (`standingPrefixes`); it never calls this.
 */
export function prefixOfChannelName(name: string): string | undefined {
  if (!name.startsWith("channel:")) return undefined;
  const cut = name.indexOf(":", "channel:".length);
  return cut > 0 ? name.slice(cut + 1) : undefined;
}

/**
 * One sync, shared by a freshly opened channel and a resumed one.
 *
 * Extracted rather than copied when resume arrived (T196): two sync bodies would drift, and the
 * drift would land on whichever path had fewer tests — which after a restart is the resumed one,
 * the path a person actually runs.
 */
async function syncChannel(
  gw: Gateway,
  ground: Gateway,
  name: string,
  opts: { into: string; prefix: string; from?: string; source: ChannelSource; bless?: boolean },
): Promise<SyncReport> {
  const before = channelStatusImpl(gw, name)[0];
  // WHAT THE RECORD THIS SYNC BUILDS ON COULD NOT SAY. Every stamp below copies most of its fields
  // from `before`, so these roles ride forward as coercions unless they are named here and omitted.
  // A FAILURE stamp carries all of them, its own counter included: `(before.consecutiveFailures ??
  // 0) + 1` counts up from a number the reader condemned, and a count derived from an unknown base
  // is not a count. It is also the arithmetic that used to make a failing sync THROW inside its own
  // catch block — `NaN + 1` is not a finite primitive and the substrate refuses it — which replaced
  // the peer's real error with a write error on the way out.
  const illegible = before?.unreadable ?? [];
  // The peer's address as the RECORD holds it, resolved once: the failure stamp, the success stamp
  // and the arrival attestation must all name the same door.
  const from = before?.from ?? opts.from ?? "";
  // What an earlier sync accepted and could not stamp. It is read here and written back on every
  // exit, so no path silently forgets a debt the record was carrying.
  const owed = before?.unattested ?? [];
  // FROZEN: read the toggle from the ground on every sync, so a freeze takes effect on the next
  // poll without restarting anything — the same "state is data" discipline as `loam:trust`. A
  // frozen channel reports honestly rather than silently doing nothing: it did not fail, and it
  // did not accept anything, and both are true.
  if (before?.receiving === false) {
    // Still names the apps: a frozen channel accepted nothing, and what is already sitting inert in
    // its pool did not stop existing because the channel stopped listening.
    return {
      offered: 0,
      accepted: 0,
      duplicates: 0,
      bound: [],
      parked: [],
      witnessed: [],
      apps: appsOf(
        gw,
        ground,
        name,
        opts.prefix,
        channelStatusImpl(gw).map((c) => c.prefix),
      ),
    };
  }
  let offered: readonly Delta[];
  try {
    offered = await opts.source.pull();
  } catch (err) {
    // A peer that did not answer is NOT a peer with nothing new. Record the failure before
    // rethrowing, so the count survives even when the caller swallows the error (H9).
    await stamp(
      gw,
      {
        name,
        into: opts.into,
        prefix: opts.prefix,
        receiving: before?.receiving ?? true,
        blessing: before?.blessing ?? opts.bless !== false,
        lastSyncedAt: before?.lastSyncedAt ?? 0,
        consecutiveFailures: (before?.consecutiveFailures ?? 0) + 1,
        from,
        // A peer that went quiet does not pay the channel's custody debt: carry it forward, or an
        // unreachable peer would clear a gap it had nothing to do with.
        unattested: owed,
      },
      illegible,
    );
    throw err;
  }
  // `federate`, never `append`. Admission and authorship are different axes (§28.1): a peer's
  // deltas carry the PEER's signatures and hold no write standing here, so the governed write door
  // refuses them — correctly. Federation is union by signature verification, and the pool is
  // exactly the bounded place that union is allowed to happen.
  // `ids: true` is what lets custody POINT at the arrivals instead of counting them. The door
  // already knows which deltas it newly ingested; recovering that afterwards would mean diffing
  // reactor snapshots around the call, a pass over the whole store on every poll (H8).
  const report = await ground.federate([...offered], { ids: true });
  // Read from the GROUND on every sync, not from the open-time option. Note this blesses the pool's
  // CONTENTS rather than this sync's arrivals, so resuming binds what landed while blessing was off.
  const blessing = before?.blessing ?? opts.bless !== false;
  const { bound, parked, witnessed } = blessing
    ? await bindArrived(gw, ground, opts.prefix)
    : { bound: [] as string[], parked: [] as string[], witnessed: [] as string[] };
  // AFTER the blessing, never before: `bindArrived` freezes the pool's members to address a module
  // version, so a stamp landing first would move that address on every poll for no reason.
  try {
    await attestArrival(gw, ground, name, from, report, owed);
  } catch (err) {
    // Record before rethrowing, exactly as the pull failure above does — and for a sharper reason.
    // A standing sync swallows this throw, and the deltas are already IN the pool, so the next poll
    // accepts none of them: without this record the arrivals would be unstampable forever, and the
    // next success would write a healthy record over the gap.
    await stamp(
      gw,
      {
        name,
        into: opts.into,
        prefix: opts.prefix,
        receiving: before?.receiving ?? true,
        blessing,
        lastSyncedAt: before?.lastSyncedAt ?? 0,
        consecutiveFailures: (before?.consecutiveFailures ?? 0) + 1,
        from,
        // A refusal that could not name what it left unstamped carries the debt it already knew
        // about — the door's own silence is what the counter is left to report.
        unattested: err instanceof UnattestedArrivals ? err.unattested : owed,
      },
      illegible,
    );
    throw err;
  }
  await stamp(
    gw,
    {
      name,
      into: opts.into,
      prefix: opts.prefix,
      receiving: before?.receiving ?? true,
      blessing: before?.blessing ?? opts.bless !== false,
      lastSyncedAt: gw.nextTimestamp(),
      consecutiveFailures: 0,
      from,
      // Cleared, and only here: the stamps for every owed arrival are in the pool above.
      unattested: [],
    },
    // A SUCCESS speaks for the three it just determined. This sync reached the peer, so the clock
    // reading, the zeroed counter and the emptied debt are facts of THIS act rather than coercions
    // of the last one — they are legible again even when the record before them was not.
    illegible.filter(
      (r) => r !== "lastSyncedAt" && r !== "consecutiveFailures" && r !== "unattested",
    ),
  );
  return {
    offered: report.offered,
    accepted: report.accepted,
    duplicates: report.offered - report.accepted,
    bound,
    parked,
    witnessed,
    // Read AFTER the blessing, so an app whose lens just bound is reported against the pool as it
    // now stands rather than as it was when the pull landed.
    apps: appsOf(
      gw,
      ground,
      name,
      opts.prefix,
      channelStatusImpl(gw).map((c) => c.prefix),
    ),
  };
}

export async function openChannelImpl(gw: Gateway, opts: OpenChannelOptions): Promise<Channel> {
  if (gw.options.seed === undefined) {
    throw new Error(
      "openChannel: only an operated store can open a federation channel — the pool's declaration " +
        "is signed constitutional data (§46)",
    );
  }
  const name = channelName(opts.into, opts.prefix);

  // INJECTIVITY, checked here because here is where a person can still choose differently. The
  // GraphQL door maps every non-alphanumeric to `_` (`legalNameFor`), so `alice:` and `alice_` are
  // disjoint entity namespaces that serve at the SAME field — the many-to-one squatting hazard
  // accounts.ts documents. A peer cannot exploit it because a peer never picks a prefix; the
  // receiver does, and the receiver's own store knows every prefix it has already assigned. So the
  // collision is decidable locally, and it fails closed at assignment rather than at publish.
  const flattened = legalNameFor(opts.prefix);
  const prefixes = standingPrefixes(gw);
  if (prefixes.unresolved.length > 0) {
    // A CHECK THAT CANNOT ENUMERATE ITS OWN SET HAS NO ANSWER TO GIVE. One pool whose assigned
    // prefix neither reading can name is enough: "no collision" over the rest would be a verdict
    // this store never verified, and the whole point of checking here is that a person is present.
    //
    // COUNTED, NOT NAMED. This refusal reaches every caller of `openChannel`, and the MCP door
    // fences federation per container precisely so a caller cannot learn which channels exist
    // (§12/T78). A list of pool names here would carry receiving containers and peer prefixes
    // straight through that fence, so the operator reads them from the container listing instead.
    throw new Error(
      `openChannel refused: this store declares ${prefixes.unresolved.length} channel pool(s) ` +
        `whose assigned prefix it cannot name. A pool's prefix is read from its channel record, ` +
        `or cut from its name against the parent its declaration marks; neither answers for these, ` +
        `so a collision check over the others would report a clean result it did not verify. The ` +
        `container listing names them: re-declare each with an \`inboxOf\` that leads its name, or ` +
        `drop it. Nothing was created.`,
    );
  }
  // THIS pool's own standing entry, if it has one. Everything below turns on the difference between
  // resuming the channel that owns this name and assigning the name afresh.
  const claimed = prefixes.standing.find((s) => s.channel === name);
  for (const standing of prefixes.standing) {
    // Skip only THIS channel — re-opening the same (into, prefix) resumes. Any OTHER channel whose
    // prefix flattens the same is a refusal, including one that is byte-identical in a different
    // container: the earlier guard compared prefixes and so skipped exactly that case.
    //
    // SAME POOL NAME IS NOT SAME CHANNEL. `channel:<into>:<prefix>` cannot separate its halves, so
    // into "ada:feed" + prefix "alice" and into "ada" + prefix "feed:alice" ask for ONE pool under
    // two meanings. Resuming on the name alone would re-point the standing channel's parent and
    // re-stamp its prefix — silently, and taking its blessed law's namespace with it.
    if (standing.channel === name) {
      if (standing.prefix === opts.prefix) continue;
      throw new Error(
        `openChannel refused: the pool "${name}" already belongs to the channel this store opened ` +
          `with the prefix "${standing.prefix}", and this call asks for "${opts.prefix}". A pool ` +
          `is named "channel:<into>:<prefix>" and a container name may carry colons, so two ` +
          `different (container, prefix) pairs can name one pool — resuming here would re-point ` +
          `the standing channel instead. Choose another receiving container or another prefix. ` +
          `Nothing was changed.`,
      );
    }
    if (legalNameFor(standing.prefix) === flattened) {
      // A COLLISION THIS STORE IS ALREADY LIVING WITH GETS DIFFERENT ADVICE. The old guard split
      // the pool name, so a store opened before this check can hold two channels that really do
      // answer to one prefix. Telling its operator to "choose another prefix" would be advice for
      // a decision they are not making: they are re-opening what they already have, and the repair
      // is to sever one of the two.
      throw new Error(
        claimed === undefined
          ? `openChannel refused: the prefix "${opts.prefix}" collides with the prefix ` +
              `"${standing.prefix}" already assigned by "${standing.channel}". A living name is ` +
              `"<prefix>:<alias>" and carries no container, so two channels sharing a prefix aim at ` +
              `the same names — and the door flattens every non-alphanumeric to "_", so near-misses ` +
              `collide too. Choose another prefix.`
          : `openChannel refused: "${name}" and "${standing.channel}" BOTH stand in this store, ` +
              `and their prefixes "${claimed.prefix}" and "${standing.prefix}" answer at one ` +
              `GraphQL field. A store opened before this check could reach that state, and while it ` +
              `holds, one peer's claims can answer a lens blessed from the other. Sever one of the ` +
              `two (\`loam federate drop\`) and re-open. Nothing was changed.`,
      );
    }
  }
  // Past the ambiguity check, so a live handle is returned only for the channel that was ASKED for.
  const existing = gw.federationChannels.get(name);
  if (existing !== undefined) return existing; // idempotent: re-opening resumes the same pool

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

  // IDEMPOTENT ACROSS PROCESSES, not only within one. A booted store re-attaches its pools before
  // it rebuilds its channels, and a channel whose peer credential is missing is attached and
  // unresumed — so a second `federate open` in a fresh invocation found the pool already attached
  // and threw, contradicting the door's own "syncing again is safe". Reuse what is attached.
  const pool = gw.channelPools.get(name) ?? (await attachChannelPool(gw, name));
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
    from: opts.from ?? "",
    unattested: [],
  });

  const channel: Channel = {
    name,
    into: opts.into,
    prefix: opts.prefix,
    pool,
    // Union, and idempotent by construction: the pool's append de-duplicates by delta id, so a
    // second sync of an unchanged peer accepts nothing and refuses nothing. Polling is therefore
    // safe at any interval, which is what lets the transport stay behind this contract.
    sync: () => syncChannel(gw, ground, name, opts),
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
  // THE MARK RIDES THIS ONE TOO. A drop that REFUSES leaves the pool attached for the life of the
  // process — deliberately, so an operator can look at what could not be purged — and an unmarked
  // pool is one with an open anonymous door.
  const pool = channel?.pool ?? attached ?? (await attachChannelPool(gw, name));
  if (pool.drop === undefined) {
    throw new Error(
      `dropChannel refused: ${name} has no drop — only a SEPARATE container purges its own bytes, ` +
        `and a channel pool that is not separate cannot be severed provably (§46)`,
    );
  }
  await pool.drop();
  gw.federationChannels.delete(name);
  gw.channelPools.delete(name);
  // The pool's bindings left with its bytes; refold so the surface stops serving them NOW rather
  // than at the next boot. This is what dissolved T199's retire-on-drop question: there is nothing
  // to retire, because the binding was never anywhere but the pool.
  gw.replayRegistrations();

  // THE RECORD GOES WITH THE BYTES. Without this, `federate list` kept printing the channel as
  // receiving after it was severed, `setChannel` still succeeded on it, and every later boot
  // re-attempted an attach that cannot work because the declaration is struck. One command said
  // severed and the next said standing — and of the two, the one that keeps being read is the lie.
  if (gw.options.seed !== undefined) {
    // THE SAME SLICE THE READER READS, or a sever leaves a channel standing. `readChannels` counts
    // only the operator's records and only the operator's strikes, so asking a different question
    // here would strand exactly the records the reader still believes: a stranger's negation of a
    // real record satisfies "already struck" while the reader goes on serving it.
    const operator = gw.operatorAuthor!;
    const negated = lawfulNegated(gw.reactor, operator);
    for (const d of [...gw.reactor.snapshot()]) {
      if (d.claims.author !== operator) continue;
      const marker = d.claims.pointers.find(
        (pt) => pt.target.kind === "entity" && pt.target.entity.context === CTX_CHANNEL,
      );
      if (marker === undefined || marker.target.kind !== "entity") continue;
      if (marker.target.entity.id !== `channel:${name}`) continue;
      if (negated(d.id)) continue;
      await gw.append([
        signClaims(makeNegationClaims(operator, gw.nextTimestamp(), d.id), gw.options.seed),
      ]);
    }
  }
}

/**
 * Append one channel record. Latest-wins, so a stamp is an ordinary append rather than an edit.
 *
 * `unreadable` is the READER's verdict ON a record and never part of one, so a caller does not
 * supply it: a marker a writer could set is a marker a forger could clear.
 *
 * `illegible` NAMES THE ROLES THIS STAMP MUST NOT SPEAK FOR, and it is what stops the verdict
 * healing itself away. Every field here is either freshly determined by the act being recorded or
 * CARRIED FORWARD from the record the reader just condemned — and carrying one forward writes a
 * coercion down as a fact. One `federate set` over an illegible record would otherwise mint a
 * clean, operator-signed record asserting `lastSyncedAt: 0`, which every surface then reads as a
 * healthy peer that has never synced. So the condemned roles are OMITTED: absence is what the
 * reader already condemns, so the truth survives the write instead of being overwritten by it.
 *
 * Omitting rather than refusing is deliberate. A channel a person cannot freeze is a channel they
 * can only sever, and a sever is the one act with no way back.
 */
async function stamp(
  gw: Gateway,
  status: Omit<ChannelStatus, "unreadable">,
  illegible: readonly string[] = [],
): Promise<void> {
  const claims = channelRecordClaims(
    { ...status, unreadable: [] },
    gw.operatorAuthor!,
    gw.nextTimestamp(),
  );
  await gw.append([
    signClaims(
      illegible.length === 0
        ? claims
        : { ...claims, pointers: claims.pointers.filter((p) => !illegible.includes(p.role)) },
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
  // A TOGGLE THIS CALL SETS IS LEGIBLE AGAIN; every other condemned role is still a coercion of the
  // record being replaced, and writing one down would launder the reader's verdict into a fact.
  await stamp(
    gw,
    status,
    held.unreadable.filter(
      (r) =>
        !(r === "receiving" && next.receiving !== undefined) &&
        !(r === "blessing" && next.blessing !== undefined),
    ),
  );
  // READ THE RECORD BACK RATHER THAN ECHOING THE ONE WE BUILT. `status` is assembled from the
  // REPLACED record's coerced fields, so returning it would hand the caller — and
  // `loam_federate_set`'s reply — a verdict about a record that is no longer the live one.
  return channelStatusImpl(gw, name)[0] ?? status;
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
 * A failing channel must never take the loop down with it. One failing peer raises its own
 * `consecutiveFailures` and the others keep going — the record is where that failure becomes
 * visible, which is why swallowing the error here is honest rather than H9. Both failures a peer
 * can cause write that record before `sync` throws: an unreachable door raises the counter, and an
 * arrival that could not be stamped raises it AND writes down which arrivals are still owed a
 * stamp, so the next poll can pay the debt.
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
        // Recorded on the channel's own record by `sync` before it threw — the unreachable door and
        // the unstampable arrival both stamp a failure on the way out. A failure of the RECEIVER's
        // own ground is not recorded and cannot be, because the record is itself a write to it.
        // One dead peer does not stop the others.
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
    const liftPool = gw.channelPools.get(channel)?.gateway;
    const liftGrounds = liftPool === undefined ? [gw] : [liftPool, gw];
    for (const g of liftGrounds)
      for (const binding of [...g.reactor.snapshot()]) {
        if (!isRegistrationBinding(binding.claims)) continue;
        const p = binding.claims.pointers.find((pt) => pt.role === "schema");
        const lens =
          p?.target.kind === "entity" && p.target.entity.id.startsWith("schema:")
            ? p.target.entity.id.slice("schema:".length)
            : undefined;
        if (lens !== living) continue;
        for (const negationId of g.reactor.negationsOf(binding.id)) {
          if (g.reactor.negationsOf(negationId).length > 0) continue; // already lifted
          await g.append([
            signClaims(
              makeNegationClaims(gw.operatorAuthor!, gw.nextTimestamp(), negationId),
              seed,
            ),
          ]);
        }
      }
    replayEverywhere(gw);
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
  // THE BINDINGS LIVE IN THE POOL now (§47 slice 3), so the strike lands there — the same ground
  // the blessing landed in, which is what keeps a curse and a drop composable: both act on the
  // container that owns the law. The root ground is searched too, for a store carrying bindings
  // blessed before the move; a curse must reach law wherever an older store put it.
  const pool = gw.channelPools.get(channel)?.gateway;
  const grounds: { reactor: Gateway["reactor"]; sign: (id: string) => Promise<void> }[] = [
    ...(pool === undefined
      ? []
      : [
          {
            reactor: pool.reactor,
            sign: async (id: string): Promise<void> => {
              await pool.append([
                signClaims(makeNegationClaims(gw.operatorAuthor!, gw.nextTimestamp(), id), seed),
              ]);
            },
          },
        ]),
    {
      reactor: gw.reactor,
      sign: async (id: string): Promise<void> => {
        await gw.append([
          signClaims(makeNegationClaims(gw.operatorAuthor!, gw.nextTimestamp(), id), seed),
        ]);
      },
    },
  ];
  const bindings: { id: string; sign: (id: string) => Promise<void> }[] = [];
  for (const g of grounds) {
    // SURVIVAL, NOT PRESENCE. A lift revives a binding by negating the curse's negation; it does not
    // remove that negation, so `negationsOf(...).length > 0` stays true of a binding that is fully
    // live again. Asked that way, a SECOND curse finds nothing to strike and refuses with "not
    // served by this store" while the lens is on the surface and a mounted app is rendering it —
    // H9's shape, and the licence it hands out is "you have nothing to retire".
    const struckHere = lawfulNegated(g.reactor, gw.operatorAuthor);
    for (const d of g.reactor.snapshot()) {
      if (!isRegistrationBinding(d.claims)) continue;
      if (livesAt(d) !== living) continue;
      if (struckHere(d.id)) continue;
      bindings.push({ id: d.id, sign: g.sign });
    }
  }
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
    await binding.sign(binding.id);
  }
  replayEverywhere(gw);

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

/**
 * Re-derive the root's surface AND every attached pool's.
 *
 * A curse strikes a binding that lives in the POOL (§47.4), and a mounted app resolves through the
 * POOL's own surface — so replaying only the root retires the lens for the root's readers while a
 * stranger's code goes on rendering the retired reading. The lift is the same shape pointed the
 * other way: it revives the binding on the ground and the pool would go on serving nothing. Both
 * halves of a reversible act have to arrive in the same breath, or the reversal is not one.
 */
function replayEverywhere(gw: Gateway): void {
  for (const pool of gw.channelPools.values()) pool.gateway?.replayRegistrations();
  gw.replayRegistrations();
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

/**
 * Rebuild a Channel from its record and the credential the home holds — the other half of what
 * `openChannel` built in a process that has since exited.
 *
 * It reaches the peer through the SHIPPED source builder and the SHARED sync body, so a resumed
 * channel pulls exactly the way a freshly opened one does.
 */
export function resumeChannelImpl(gw: Gateway, standing: ChannelStatus, token: string): Channel {
  const poolOf = (): Container => {
    const held = gw.channelPools.get(standing.name);
    if (held === undefined) {
      throw new Error(
        `${standing.name} is not attached in this process, so its bytes are unreadable — the ` +
          `channel record stands and the pool did not open`,
      );
    }
    return held;
  };
  const opts = {
    into: standing.into,
    prefix: standing.prefix,
    from: standing.from,
    source: sourceFor(
      standing.from,
      token,
      () => {
        throw new Error("a resumed channel pulls from its recorded address, never a file");
      },
      parseOffer,
    ),
  };
  return {
    name: standing.name,
    into: standing.into,
    prefix: standing.prefix,
    get pool(): Container {
      return poolOf();
    },
    sync: () => syncChannel(gw, poolOf().gateway!, standing.name, opts),
  };
}
