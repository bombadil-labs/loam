// The response writers' agreed core (T153 item 1). The referrer/CSP POLICY is a per-door knob and
// stays spelled at each door's call site: the frozen T143 source scan (test/server/referrer-policy
// .test.ts) pins the policy DECLARATIONS per file, so the policy literals must not move here. What
// moves is everything the writers must AGREE on — the content-type strings and the no-store cache
// header — which T143 proved could drift (the same fix had to land in three places).

import type { ServerResponse } from "node:http";

export const JSON_CONTENT_TYPE = "application/json";
export const CACHE_NO_STORE = "no-store";

// The JSON writer core: the content-type is the agreement and the core WINS — a call site cannot
// override the agreed spelling. Everything else (cache policy, referrer policy, CORS, cookies) is
// the door's per-response choice, passed at the call. cache-control is deliberately NOT in the
// core: the http door's JSON answers were cacheable-by-default before this module existed, and a
// consolidation must not change what a door sends (T153's own rule).
export function endJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { ...headers, "content-type": JSON_CONTENT_TYPE });
  res.end(JSON.stringify(body));
}
