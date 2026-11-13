import type { Reactor } from "@bombadil/rhizomatic";
import type { UserGround } from "./user-root.js";

export interface GroundDeclarations {
  users?: () => UserGround;
  readHidden?: (now: number) => ReadonlySet<string>;
  principalScope?: string;
  erasureGovernors?: readonly string[];
}

const seated = new WeakMap<Reactor, GroundDeclarations>();

export function declarationsOf(reactor: Reactor): GroundDeclarations {
  let record = seated.get(reactor);
  if (record === undefined) {
    record = {};
    seated.set(reactor, record);
  }
  return record;
}

export function seatDeclarations(reactor: Reactor, record: GroundDeclarations): void {
  seated.set(reactor, record);
}
