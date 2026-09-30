// One store: the tree of containers a root gateway opens, and the services every container in it
// shares (refactor/audit/step6-container-split.md). Owned by no container and no gateway; each
// container reaches it as a port. It holds the links between containers and the per-channel commit
// order, so no container walks another container's members to find its root.

import type { Gateway } from "./gateway.js";

export class Store {
  // Child to parent, for every container attached below another. A detached container has none.
  private readonly parents = new Map<Gateway, Gateway>();
  // Per root, per channel: the tail of that channel's commit queue.
  private readonly commitTails = new Map<Gateway, Map<string, Promise<void>>>();

  /** Record `child` as attached below `parent`. */
  attach(child: Gateway, parent: Gateway): void {
    this.parents.set(child, parent);
  }

  /** Forget `child`'s link: a detached container is nobody's replica. */
  detach(child: Gateway): void {
    this.parents.delete(child);
  }

  /** The container `child` is attached below, if any. */
  parentOf(child: Gateway): Gateway | undefined {
    return this.parents.get(child);
  }

  /** Is `child` a live attachment of `parent`: linked to it, and still in its pool set. */
  holds(parent: Gateway, child: Gateway): boolean {
    return this.parents.get(child) === parent && parent.quarantinePools.has(child);
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
      if (seen.has(child) || !parent.quarantinePools.has(child)) return undefined;
      seen.add(child);
      child = parent;
      parent = this.parents.get(child);
    }
    return child;
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
}
