// What a ground carries that is not in its deltas: where it reads its users, what a door read of
// it withholds, the one scope it honors delegations for, and the keys it pins as erasure
// governors. Law readers receive a reactor and nothing else, so the record is found through the
// reactor. The Gateway owns one record for its whole life and seats it on each reactor it sets, in
// one step, so no declaration can be left behind when the reactor is replaced.

import type { Reactor } from "@bombadil/rhizomatic";
import type { UserGround } from "./user-root.js";

export interface GroundDeclarations {
  users?: () => UserGround;
  readHidden?: (now: number) => ReadonlySet<string>;
  principalScope?: string;
  erasureGovernors?: readonly string[];
}

const seated = new WeakMap<Reactor, GroundDeclarations>();

/** The record for `reactor`'s ground. A reactor nobody declared for starts with an empty one. */
export function declarationsOf(reactor: Reactor): GroundDeclarations {
  let record = seated.get(reactor);
  if (record === undefined) {
    record = {};
    seated.set(reactor, record);
  }
  return record;
}

/** `reactor` now serves the ground that owns `record`: every declaration follows, by reference. */
export function seatDeclarations(reactor: Reactor, record: GroundDeclarations): void {
  seated.set(reactor, record);
}
