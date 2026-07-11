// The frozen offer (SPEC §15, continuity): an export is a federation offer with the clock
// stopped. exportOffer returns EXACTLY the bytes `GET /federate` serves — `{ deltas:
// WireDelta[] }`, ids and signatures intact — so a store that walks out of a browser as a
// file is indistinguishable from one pulled off the wire, and migration never launders
// provenance. parseOffer is the reading half: reconstruction recomputes every id, so a
// forgery cannot survive the crossing whatever the file claims.

import type { Delta } from "@bombadil/rhizomatic";
import type { Gateway } from "../gateway/gateway.js";
import { fromWire, toWire, type WireDelta } from "./wire.js";

export function exportOffer(gateway: Gateway): string {
  return JSON.stringify({ deltas: gateway.offeredDeltas().map(toWire) });
}

export function parseOffer(text: string): Delta[] {
  let parsed: { deltas?: unknown };
  try {
    parsed = JSON.parse(text) as { deltas?: unknown };
  } catch {
    throw new Error("an offer is JSON: { deltas: [...] } — this file is not JSON at all");
  }
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.deltas)) {
    throw new Error("an offer carries `deltas`, an array of wire deltas — this file does not");
  }
  return parsed.deltas.map((w) => fromWire(w as WireDelta));
}
