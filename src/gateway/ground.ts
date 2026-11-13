import type { Reactor } from "@bombadil/rhizomatic";

export type Ground = Pick<
  Reactor,
  "get" | "byTarget" | "negationsOf" | "negationWitnesses" | "negationPredicate"
>;
