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
