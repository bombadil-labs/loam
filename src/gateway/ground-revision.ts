// The revision of a ground: a process-local number that rises whenever what the ground holds, or
// which erasure orders bind on it, has moved. It never falls, and two different held sets or pin
// sets of one ground never share a value. A cache keyed on it needs neither the reactor object nor
// its size to know that it is stale.
//
// It is held beside the reactor because law readers receive a reactor and nothing else. Nothing is
// persisted: a new process starts again at zero, with empty caches.

import type { Reactor } from "@bombadil/rhizomatic";

interface Clock {
  revision: number;
  size: number;
}

const clocks = new WeakMap<Reactor, Clock>();

// The delta set only grows, so its size moves exactly when its members do. Every read settles
// first, so no reader is ever handed an old revision over a moved set, whatever order the
// reactor's subscribers run in. One batch moves the size once, so it is counted once.
function settled(reactor: Reactor): Clock {
  let clock = clocks.get(reactor);
  if (clock === undefined) {
    clock = { revision: 0, size: reactor.size };
    clocks.set(reactor, clock);
  } else if (clock.size !== reactor.size) {
    clock.size = reactor.size;
    clock.revision += 1;
  }
  return clock;
}

/** The ground's revision now. The first read of a ground starts its count. */
export function groundRevision(reactor: Reactor): number {
  return settled(reactor).revision;
}

/** A change no ingest carries (new erasure pins): the revision rises by one. */
export function raiseGroundRevision(reactor: Reactor): void {
  settled(reactor).revision += 1;
}

/**
 * `to` replaces `from` as one ground's reactor: its revision is one above the last `from` had.
 * It sets the count outright, so it runs after everything else that prepares `to`.
 */
export function continueGroundRevision(from: Reactor, to: Reactor): void {
  clocks.set(to, { revision: settled(from).revision + 1, size: to.size });
}
