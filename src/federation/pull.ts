// Pull from a peer: fetch its published offer, verify and merge it locally. This IS the
// "subscribe to instance X's published lens" declaration — a single anti-entropy step,
// repeatable on whatever cadence a deployment wants (a timer, a webhook, a manual sync). Union
// is monotone, so re-pulling is safe and idempotent; content addressing makes double-delivery
// harmless.

import type { Delta } from "@bombadil/rhizomatic";
import type { FederationReport, Gateway } from "../gateway/gateway.js";
import { fromWire, type WireDelta } from "./wire.js";

const DEFAULT_MAX_OFFER = 64 * 1024 * 1024; // a peer's offer, capped so it cannot OOM the puller

export interface PullOptions {
  // What this puller admits from the peer beyond signature verification — a trust boundary
  // (e.g. only deltas from known authors). Default: admit everything that verifies.
  readonly admit?: (d: Delta) => boolean;
  readonly maxBytes?: number; // cap on the offer body (default 64 MiB)
  readonly fetch?: typeof fetch; // injectable for tests
}

// Read a response body with a hard byte cap — a peer we pull from is not trusted to be small.
async function boundedText(res: Response, limit: number): Promise<string> {
  const reader = res.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("federation: the peer's offer exceeds the size cap");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// Pull `peerUrl`/federate (a mount base like http://host:port/default) into `local`, presenting
// `peerToken` as the bearer. Returns the merge report.
export async function pullFrom(
  local: Gateway,
  peerUrl: string,
  peerToken: string,
  opts: PullOptions = {},
): Promise<FederationReport> {
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(`${peerUrl}/federate`, {
    headers: { authorization: `Bearer ${peerToken}` },
  });
  if (!res.ok) {
    throw new Error(`federation: peer refused the offer (${res.status})`);
  }
  const text = await boundedText(res, opts.maxBytes ?? DEFAULT_MAX_OFFER);
  let body: { deltas?: WireDelta[] };
  try {
    body = JSON.parse(text) as { deltas?: WireDelta[] };
  } catch {
    throw new Error("federation: the peer's offer was not the expected JSON");
  }
  const deltas: Delta[] = [];
  for (const wire of body.deltas ?? []) {
    try {
      deltas.push(fromWire(wire));
    } catch {
      // A delta that will not reconstruct is dropped here; `federate` counts what it admits.
    }
  }
  return local.federate(deltas, opts.admit === undefined ? {} : { admit: opts.admit });
}
