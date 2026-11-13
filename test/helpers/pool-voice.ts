import type { Delta } from "@bombadil/rhizomatic";
import type { Gateway } from "../../src/gateway/gateway.js";

export function inPoolVoice(pool: Gateway, d: Delta): Delta {
  return pool.signer!.sign({ ...d.claims, author: pool.operatorAuthor! });
}
