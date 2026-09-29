// Every pool is its own peer under its own key, so an act the pool itself makes (a write, a grant,
// a strike) is signed by the pool's signer. `inPoolVoice` re-signs a fixture delta in the pool's
// voice, every other claim kept.

import type { Delta } from "@bombadil/rhizomatic";
import type { Gateway } from "../../src/gateway/gateway.js";

export function inPoolVoice(pool: Gateway, d: Delta): Delta {
  return pool.signer!.sign({ ...d.claims, author: pool.operatorAuthor! });
}
