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
import { signClaims } from "@bombadil/rhizomatic";
import type { Container } from "../gateway/container.js";
import { containerClaims, readContainerTable } from "../gateway/container.js";
import type { Gateway } from "../gateway/gateway.js";
import { legalNameFor } from "../gateway/gql.js";

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

  const channel: Channel = {
    name,
    into: opts.into,
    prefix: opts.prefix,
    pool,
    // Union, and idempotent by construction: the pool's append de-duplicates by delta id, so a
    // second sync of an unchanged peer accepts nothing and refuses nothing. Polling is therefore
    // safe at any interval, which is what lets the transport stay behind this contract.
    sync: async (): Promise<SyncReport> => {
      const offered = await opts.source.pull();
      // `federate`, never `append`. Admission and authorship are different axes (§28.1): a peer's
      // deltas carry the PEER's signatures and hold no write standing here, so the governed write
      // door refuses them — correctly. Federation is union by signature verification, and the
      // pool is exactly the bounded place that union is allowed to happen.
      const report = await ground.federate([...offered]);
      return {
        offered: report.offered,
        accepted: report.accepted,
        duplicates: report.offered - report.accepted,
      };
    },
  };
  gw.federationChannels.set(name, channel);
  return channel;
}
