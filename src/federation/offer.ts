// The frozen offer (SPEC §15, continuity): an export is a federation offer with the clock
// stopped. exportOffer returns EXACTLY the bytes `GET /federate` serves — `{ deltas:
// WireDelta[] }`, ids and signatures intact — so a store that walks out of a browser as a
// file carries the same provenance as one pulled off the wire. parseOffer is the reading
// half: reconstruction recomputes every id, so a forgery cannot survive the crossing
// whatever the file claims.
//
// One DELIBERATE divergence from the wire path: pullFrom drops a delta that fails
// reconstruction and lands the rest (a live peer's stream may be partially good, and the next
// pull heals), while parseOffer refuses the WHOLE file on the first bad delta. A frozen offer
// is a document — if any byte of it has rotted, the honest report is "this export is corrupt,
// make a new one", not a quiet partial import the user believes was whole.

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
