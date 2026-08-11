// Pull from a peer: fetch its published offer, verify and merge it locally. This IS the
// "subscribe to instance X's published lens" declaration — a single anti-entropy step,
// repeatable on whatever cadence a deployment wants (a timer, a webhook, a manual sync). Union
// is monotone, so re-pulling is safe and idempotent; content addressing makes double-delivery
// harmless.

import type { Delta } from "@bombadil/rhizomatic";
import type { FederationReport, Gateway } from "../gateway/gateway.js";
import { fromWire, type WireDelta } from "./wire.js";

// The pull report: federate's report plus the one dimension only the wire crossing can produce.
// A delta that fails RECONSTRUCTION (its id does not recompute from its claims) never reaches
// federate, so `FederationReport` cannot carry the count — the field lives here, on the door
// where it can be nonzero, and `offered` is restored to what the peer actually SENT. Without it
// the report was false (H7): a peer offering 100 deltas of which 40 rot on the wire read
// "offered 60, rejected 0", and every later pull repeated the lie.
export interface PullReport extends FederationReport {
  readonly unreconstructable: number;
}

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
// What fetch actually saw, and the cure that matches. Node's fetch failure is a TypeError whose
// CAUSE chain carries the real verdict (getaddrinfo ENOTFOUND, connect ECONNREFUSED, a certificate
// error, a mid-body reset); the verdict is what tells a puller whether to fix the address, wait,
// or fix the trust — and the cure must not contradict the verdict (a TLS fault is not an address
// problem, and EAI_AGAIN is a transient resolver hiccup, not a wrong host).
function fetchVerdict(err: unknown): { verdict: string; cure: string } {
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
  if (/EAI_AGAIN/i.test(joined)) {
    return {
      verdict: "name resolution was temporarily unavailable (EAI_AGAIN)",
      cure: "retry in a moment — the address may be fine",
    };
  }
  if (/ENOTFOUND|getaddrinfo/i.test(joined)) {
    return {
      verdict: "the host does not resolve",
      cure: "check the address (http://host:port/mount)",
    };
  }
  if (/ECONNREFUSED/i.test(joined)) {
    return {
      verdict: "the connection was refused",
      cure: "check the address (http://host:port/mount) and that the peer is serving",
    };
  }
  if (/ECONNRESET|terminated|other side closed/i.test(joined)) {
    return {
      verdict: "the peer closed the connection",
      cure: "retry — a large offer can take the peer past a proxy timeout",
    };
  }
  if (/certificate|self-signed/i.test(joined)) {
    return {
      verdict: "the TLS certificate was not trusted",
      cure: "fix the trust on this store, or check the address",
    };
  }
  return {
    verdict: joined === "" ? "the peer did not answer" : joined,
    cure: "check the address (http://host:port/mount) and that the peer is serving",
  };
}

export async function pullFrom(
  local: Gateway,
  peerUrl: string,
  peerToken: string,
  opts: PullOptions = {},
): Promise<PullReport> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  let text: string;
  try {
    res = await doFetch(`${peerUrl}/federate`, {
      headers: { authorization: `Bearer ${peerToken}` },
    });
    if (!res.ok) {
      throw new Error(`federation: peer refused the offer (${res.status})`);
    }
    text = await boundedText(res, opts.maxBytes ?? DEFAULT_MAX_OFFER);
  } catch (err) {
    // A refusal with its own message keeps it; anything else — a connect failure OR a peer that
    // dies mid-offer — is wrapped with the peer, the verdict, and the cure. The bare error names
    // neither; the operator typed the address, so the refusal says it back (T149).
    if (err instanceof Error && err.message.startsWith("federation:")) throw err;
    const { verdict, cure } = fetchVerdict(err);
    throw new Error(`federation: pull from ${peerUrl} failed — ${verdict}; ${cure}`, {
      cause: err,
    });
  }
  let body: { deltas?: WireDelta[] };
  try {
    body = JSON.parse(text) as { deltas?: WireDelta[] };
  } catch {
    throw new Error("federation: the peer's offer was not the expected JSON");
  }
  // A delta that will not reconstruct is dropped and the REST still land (a live peer's stream
  // may be partially good — offer.ts holds the divergence note). The drop is deliberate; hiding
  // it from the report is not (H7): a reconstruction failure is a property of the peer's bytes,
  // so every later pull drops the same deltas — "the next pull heals" is false for this class,
  // and only the count tells an operator their peer's offer is rotting.
  const deltas: Delta[] = [];
  let unreconstructable = 0;
  for (const wire of body.deltas ?? []) {
    try {
      deltas.push(fromWire(wire));
    } catch {
      unreconstructable += 1;
    }
  }
  // No explicit admit → federate resolves the local trust policy itself (fresh per call).
  const report = await local.federate(
    deltas,
    opts.admit === undefined ? {} : { admit: opts.admit },
  );
  // `offered` restored to what the peer actually SENT — federate can only count what reached it.
  return {
    ...report,
    offered: report.offered + unreconstructable,
    unreconstructable,
  };
}
