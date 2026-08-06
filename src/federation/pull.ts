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
  // (e.g. only deltas from known authors). Default: the puller's OWN trust policy, resolved
  // live from its deltas at loam:trust (open when none declared) — see gateway.admitFor().
  //
  // A PREDICATE HERE OWNS THE NEGATION CLOSURE (H1). The door closes the offer over what the
  // store's own policy admits, but it will not overrule a boundary you authored: refuse a
  // retraction and the claim it struck reads LIVE here while the peer holds it withdrawn. Admit
  // negations of what you admit, or accept that reading.
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
// What fetch actually saw, reduced to one line. Node's fetch failure is a TypeError whose CAUSE
// chain carries the real verdict (getaddrinfo ENOTFOUND, connect ECONNREFUSED, a certificate
// error); the verdict is what tells a puller whether to fix the address, wait, or fix the TLS.
function fetchCause(err: unknown): string {
  const seen = new Set<unknown>();
  const texts: string[] = [];
  let cur: unknown = err;
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    const e = cur as { message?: unknown; cause?: unknown; errors?: unknown[] };
    if (typeof e.message === "string" && e.message !== "fetch failed") texts.push(e.message);
    if (Array.isArray(e.errors)) {
      for (const sub of e.errors) {
        const m = (sub as { message?: unknown } | undefined)?.message;
        if (typeof m === "string" && !texts.includes(m)) texts.push(m);
      }
    }
    cur = e.cause;
  }
  const joined = texts.join("; ");
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(joined)) return "the host does not resolve";
  if (/ECONNREFUSED/i.test(joined)) return "the connection was refused";
  if (/ECONNRESET/i.test(joined)) return "the connection was reset";
  if (/certificate|self-signed/i.test(joined)) return "the TLS certificate was not trusted";
  return joined === "" ? "the peer did not answer" : joined;
}

export async function pullFrom(
  local: Gateway,
  peerUrl: string,
  peerToken: string,
  opts: PullOptions = {},
): Promise<FederationReport> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${peerUrl}/federate`, {
      headers: { authorization: `Bearer ${peerToken}` },
    });
  } catch (err) {
    // The bare fetch error ("fetch failed", a TypeError) names neither the peer nor what fetch
    // saw — the operator typed the address, so the refusal must say it back, say what happened,
    // and say the cure (T149).
    throw new Error(
      `federation: pull from ${peerUrl} failed — ${fetchCause(err)}; ` +
        "check the address (http://host:port/mount) and that the peer is serving",
      { cause: err },
    );
  }
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
  // No explicit admit → federate resolves the local trust policy itself (fresh per call).
  return local.federate(deltas, opts.admit === undefined ? {} : { admit: opts.admit });
}
