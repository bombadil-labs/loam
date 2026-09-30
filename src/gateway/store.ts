// One store: the tree of containers a root gateway opens, and the services every container in it
// shares (refactor/audit/step6-container-split.md). Owned by no container and no gateway; each
// container reaches it as a port. It holds the links between containers, each container's table of
// children, and the per-channel commit order, so no container walks another container's members.
//
// Container code reads a child only as a `Peer` (peer.ts). The `Gateway`-typed table is for the
// opener and the facades (a door or a command that serves one container of the store).

import type { Container } from "./container.js";
import type { Gateway } from "./gateway.js";
import type { Peer, PeerEntry } from "./peer.js";

/** One container's children, as the opener keeps them. */
export interface ContainerTable {
  // Every separate-store child attached below: the canonical registry of erasure reach. Every
  // attach inserts here and every drop or detach removes here. It stays a mutable Set because rails
  // reach in to build fixtures; the named index below is bookkeeping over it, checked against it.
  readonly pools: Set<Gateway>;
  // Declared container entity to the child over its own store. An entry is meaningful only while
  // its child is also in `pools`; readers ask both, so the two never diverge on erasure reach.
  readonly named: Map<string, Gateway>;
  // Per-connection inbox handles (SPEC §39), by inbox name. A binding is durable: a second bind of
  // the same container and connection key resumes the same handle. Cleared only by a drop.
  readonly inboxes: Map<string, Container>;
  // Federation channel pools (§46), by pool name. A booted store has pools and no channels, so this
  // is apart from the live channels: a resumed store can sever a pool it cannot rebuild a channel for.
  readonly channels: Map<string, Container>;
  // How many anonymous pools this container has opened. Each gets a stable synthetic handle
  // (`anonymous#1`); grow-only, so two pools never share one handle in a spending report.
  anonymousOpened: number;
}

export class Store {
  // Child to parent, for every container attached below another. A detached container has none.
  private readonly parents = new Map<Peer, Gateway>();
  private readonly tables = new Map<Peer, ContainerTable>();
  // Per root, per channel: the tail of that channel's commit queue.
  private readonly commitTails = new Map<Gateway, Map<string, Promise<void>>>();

  /** `parent`'s table of children, created empty on first use. For the opener and the facades. */
  tableOf(parent: Gateway): ContainerTable {
    return this.table(parent);
  }

  // Every read of a table creates it, so a view taken before the first child attaches is live.
  private table(parent: Peer): ContainerTable {
    let table = this.tables.get(parent);
    if (table === undefined) {
      table = {
        pools: new Set(),
        named: new Map(),
        inboxes: new Map(),
        channels: new Map(),
        anonymousOpened: 0,
      };
      this.tables.set(parent, table);
    }
    return table;
  }

  /** Record `child` as attached below `parent`. */
  attach(child: Gateway, parent: Gateway): void {
    this.parents.set(child, parent);
  }

  /** Forget `child`'s link: a detached container is nobody's replica. */
  detach(child: Peer): void {
    this.parents.delete(child);
  }

  /** The container `child` is attached below, if any. */
  parentOf(child: Peer): Gateway | undefined {
    return this.parents.get(child);
  }

  /** Is `child` a live attachment of `parent`: linked to it, and still in its pool set. */
  holds(parent: Peer, child: Peer): boolean {
    return this.parents.get(child) === parent && this.pooled(parent, child);
  }

  /** Is `child` in `parent`'s pool set (the registry of erasure reach), link or no link. */
  hasPool(parent: Peer, child: Peer): boolean {
    return this.pooled(parent, child);
  }

  /** The children attached below `parent`, as peers: the live set, read-only. */
  pools(parent: Peer): ReadonlySet<Peer> {
    return this.table(parent).pools;
  }

  /** The declared containers attached below `parent`, by entity, as peers. */
  namedPools(parent: Peer): ReadonlyMap<string, Peer> {
    return this.table(parent).named;
  }

  /** `parent`'s federation channel pools, by pool name, each with its child as a peer. */
  channels(parent: Peer): ReadonlyMap<string, PeerEntry> {
    return this.table(parent).channels;
  }

  /**
   * The opener's handle for `parent`'s channel pool `name`, for a Channel record handed to a caller.
   * Container code reads the child through `channels`; the census counts every use of this.
   */
  channelRecord(parent: Peer, name: string): Container | undefined {
    return this.tables.get(parent)?.channels.get(name);
  }

  /** `parent`'s connection inboxes, by inbox name, each with its child as a peer. */
  inboxes(parent: Peer): ReadonlyMap<string, PeerEntry> {
    return this.table(parent).inboxes;
  }

  /**
   * Record `pool` as `parent`'s federation channel pool `name`. It takes the handle this table
   * handed out as well as a fresh one: every entry is a Container the opener made.
   */
  setChannel(parent: Gateway, name: string, pool: Container | PeerEntry): void {
    this.tableOf(parent).channels.set(name, pool as Container);
  }

  /** Forget `parent`'s channel pool `name`. */
  dropChannel(parent: Peer, name: string): void {
    this.tables.get(parent)?.channels.delete(name);
  }

  /** Close every declared child of `parent`, and forget its declared and channel entries. */
  async closeChildren(parent: Peer): Promise<void> {
    const table = this.tables.get(parent);
    if (table === undefined) return;
    for (const pool of [...table.named.values()]) {
      try {
        await pool.close();
      } catch {
        // already closed: a dropped pool, or a second close
      }
    }
    table.named.clear();
    table.channels.clear();
  }

  /** The top of `gw`'s chain of links, taken as the links say. */
  rootOf(gw: Gateway): Gateway {
    let root = gw;
    for (let up = this.parents.get(root); up !== undefined; up = this.parents.get(root)) root = up;
    return root;
  }

  /**
   * The top of `gw`'s chain, verified link by link: each parent still holds its child. Undefined
   * when a link is broken or the chain loops, which every caller reads as a refusal (H9).
   */
  verifiedRootOf(gw: Gateway): Gateway | undefined {
    const seen = new Set<Gateway>();
    let child = gw;
    for (let parent = this.parents.get(child); parent !== undefined;) {
      if (seen.has(child) || !this.pooled(parent, child)) return undefined;
      seen.add(child);
      child = parent;
      parent = this.parents.get(child);
    }
    return child;
  }

  /**
   * The containers above `child`, nearest first, while each still holds the one below it. The walk
   * stops at a broken link (that parent is not included) or where the chain loops.
   */
  chainAbove(child: Peer): Peer[] {
    const out: Peer[] = [];
    const seen = new Set<Peer>();
    let cursor = child;
    while (!seen.has(cursor)) {
      const parent = this.parents.get(cursor);
      if (parent === undefined) break;
      seen.add(cursor);
      if (!this.pooled(parent, cursor)) break;
      out.push(parent);
      cursor = parent;
    }
    return out;
  }

  /**
   * The container that answers for `child` live: the verified root of its chain. Undefined when
   * `child` is attached to nothing, or when a link is broken or loops (H9).
   */
  authorityOf(child: Peer): Peer | undefined {
    if (!this.parents.has(child)) return undefined;
    return this.verifiedRootOf(child as Gateway);
  }

  /**
   * Run `body` after every earlier commit on `channel` in `gw`'s tree has settled. The order is
   * held at the verified root, so a pool and its host share one queue per channel.
   */
  commit<T>(gw: Gateway, channel: string, body: () => Promise<T>): Promise<T> {
    const root = this.verifiedRootOf(gw);
    if (root === undefined) {
      throw new Error("channel commit requires a legitimate authority attachment");
    }
    let tails = this.commitTails.get(root);
    if (tails === undefined) this.commitTails.set(root, (tails = new Map<string, Promise<void>>()));
    const prior = tails.get(channel) ?? Promise.resolve();
    const next = prior.then(body);
    const tail = next.then(
      () => {},
      () => {},
    );
    tails.set(channel, tail);
    void tail.then(() => {
      if (tails.get(channel) === tail) tails.delete(channel);
    });
    return next;
  }

  private pooled(parent: Peer, child: Peer): boolean {
    return this.tables.get(parent)?.pools.has(child as Gateway) === true;
  }
}
