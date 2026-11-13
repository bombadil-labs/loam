import type { Container } from "./container.js";
import type { Gateway } from "./gateway.js";
import type { Peer, PeerEntry } from "./peer.js";

export interface ContainerTable {
  readonly pools: Set<Gateway>;
  readonly named: Map<string, Gateway>;
  readonly inboxes: Map<string, Container>;
  readonly channels: Map<string, Container>;
  anonymousOpened: number;
}

export class Store {
  private readonly parents = new Map<Peer, Gateway>();
  private readonly tables = new Map<Peer, ContainerTable>();
  private readonly commitTails = new Map<Gateway, Map<string, Promise<void>>>();

  tableOf(parent: Gateway): ContainerTable {
    return this.table(parent);
  }

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

  attach(child: Gateway, parent: Gateway): void {
    this.parents.set(child, parent);
  }

  detach(child: Peer): void {
    this.parents.delete(child);
  }

  parentOf(child: Peer): Gateway | undefined {
    return this.parents.get(child);
  }

  holds(parent: Peer, child: Peer): boolean {
    return this.parents.get(child) === parent && this.pooled(parent, child);
  }

  hasPool(parent: Peer, child: Peer): boolean {
    return this.pooled(parent, child);
  }

  pools(parent: Peer): ReadonlySet<Peer> {
    return this.table(parent).pools;
  }

  namedPools(parent: Peer): ReadonlyMap<string, Peer> {
    return this.table(parent).named;
  }

  channels(parent: Peer): ReadonlyMap<string, PeerEntry> {
    return this.table(parent).channels;
  }

  inboxes(parent: Peer): ReadonlyMap<string, PeerEntry> {
    return this.table(parent).inboxes;
  }

  setChannel(parent: Gateway, name: string, pool: Container | PeerEntry): void {
    this.tableOf(parent).channels.set(name, pool as Container);
  }

  dropChannel(parent: Peer, name: string): void {
    this.tables.get(parent)?.channels.delete(name);
  }

  async closeChildren(parent: Peer): Promise<void> {
    const table = this.tables.get(parent);
    if (table === undefined) return;
    for (const pool of [...table.named.values()]) {
      try {
        await pool.close();
      } catch {}
    }
    table.named.clear();
    table.channels.clear();
  }

  rootOf(gw: Gateway): Gateway {
    let root = gw;
    for (let up = this.parents.get(root); up !== undefined; up = this.parents.get(root)) root = up;
    return root;
  }

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

  authorityOf(child: Peer): Peer | undefined {
    if (!this.parents.has(child)) return undefined;
    return this.verifiedRootOf(child as Gateway);
  }

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
