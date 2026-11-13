import type { Reactor } from "@bombadil/rhizomatic";

interface Clock {
  revision: number;
  size: number;
}

const clocks = new WeakMap<Reactor, Clock>();

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

export function groundRevision(reactor: Reactor): number {
  return settled(reactor).revision;
}

export function raiseGroundRevision(reactor: Reactor): void {
  settled(reactor).revision += 1;
}

export function continueGroundRevision(from: Reactor, to: Reactor): void {
  const next = Math.max(settled(from).revision, settled(to).revision) + 1;
  clocks.set(to, { revision: next, size: to.size });
}
