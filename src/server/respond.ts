// The response writers' agreed core (T153 item 1). The JSON content-type is the one header every
// writer must AGREE on — T143 proved the copies could drift (the same fix had to land in three
// places) — and the core writes it, winning over any call site. EVERYTHING ELSE is a per-door
// policy, passed at the call site and spelled there: the referrer/CSP policy must stay per file
// anyway (the frozen T143 scan pins its declarations per file), and cache-control is deliberately
// per door — the http door's JSON answers were cacheable-by-default before this module existed, and
// a consolidation must not change what a door sends. A door that needs no-store passes it; the
// session, oauth and token doors do.

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
