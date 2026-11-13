import type { Delta } from "@bombadil/rhizomatic";
import type { FederationReport, Gateway } from "../gateway/gateway.js";
import { fromWire, type WireDelta } from "./wire.js";

export interface PullReport extends FederationReport {
  readonly unreconstructable: number;
}

const DEFAULT_MAX_OFFER = 64 * 1024 * 1024;

export interface PullOptions {
  readonly admit?: (d: Delta) => boolean;
  readonly maxBytes?: number;
  readonly fetch?: typeof fetch;
}

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
  const deltas: Delta[] = [];
  let unreconstructable = 0;
  for (const wire of body.deltas ?? []) {
    try {
      deltas.push(fromWire(wire));
    } catch {
      unreconstructable += 1;
    }
  }
  const report = await local.federate(
    deltas,
    opts.admit === undefined ? {} : { admit: opts.admit },
  );
  return {
    ...report,
    offered: report.offered + unreconstructable,
    unreconstructable,
  };
}
