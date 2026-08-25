// CIMD — the OAuth client-id-metadata-document (SPEC §37, T242). The client_id IS an https URL;
// this module fetches the client metadata document from that URL, judges it, and hands the consent
// door a validated `{ client_id, client_name, redirect_uris }` — so a client never registered here
// can authorize, if its own document vouches for its redirect. Implemented against
// draft-ietf-oauth-client-id-metadata-document-02 (2026-07-06): the field names, the
// document's client_id-must-match-the-URL binding, the no-redirect rule, the never-cache-a-failure
// rule and the symmetric-secret prohibition are all that draft's.
//
// THE FETCH IS A SERVER-SIDE REQUEST TO AN ATTACKER-INFLUENCED URL. Every fence below is
// load-bearing, and they run in two layers because a URL and a connection lie differently:
//
//   - URL fences, before anything dials: https only, no userinfo, no fragment, a real path, no
//     IP-literal host, no localhost/.local/.internal name.
//   - The CONNECTED-ADDRESS fence, at the dial itself: a `lookup` hook vets the address the socket
//     will actually use against loopback/RFC1918/link-local/unique-local ranges, and the connection
//     then uses exactly the vetted answer — one resolution, so a DNS name cannot re-point between
//     the check and the connect (the rebinding move the name fences alone cannot see).
//   - Answer fences: no redirect, 200 only, application/json only, 64KB cap, 5s deadline.
//
// The one deliberate opening is `allowPrivateOrigins` — the TEST SEAM. An origin named there, by
// exact `scheme://host:port` match, is exempt from the https fence and both address fences, so a
// rail's own 127.0.0.1 fixture is reachable; every OTHER fence (redirects, the cap, the deadline,
// the content-type, the document checks) still applies to it. It is a constructor option threaded
// from `ServeOptions.connectors`, set only by tests that build a server programmatically — the CLI
// never sets it, there is no flag for it, and no environment variable reaches it.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { lookup as dnsLookup } from "node:dns";
import { MAX_CLIENT_NAME, uriTextDefect } from "./oauth-file.js";

/** The response-size cap. The draft recommends reading no more than 5KB; this cap is the outer wall. */
export const CIMD_MAX_BYTES = 64 * 1024;

/** How long a fetch may take, dial to last byte. */
export const CIMD_TIMEOUT_MS = 5_000;

/** How long a GOOD document is held, so an authorize burst costs one fetch (H8). Failures: never. */
export const CIMD_CACHE_TTL_MS = 5 * 60 * 1000;

/** The most redirect_uris a document may carry — far above any real client, far below a 64KB list. */
export const CIMD_MAX_URIS = 32;

/**
 * The longest client_id URL this store accepts. Deliberately under the token door's own field cap
 * (`MAX_TOKEN_BODY_FIELD`, 4096): a longer id could be approved at consent and then never be
 * PRESENTED at redemption — the token door blanks an over-long body field, and the refusal would
 * misname the defect as a missing one. Fenced here, early, with an honest reason instead.
 */
export const CIMD_MAX_URL = 2048;

const MAX_URI = 2048;

/**
 * Does this client_id route to CIMD at all? A URL-shaped id takes the CIMD path — including an
 * `http:` one, so it earns the honest "https only" refusal there rather than a misleading
 * "no such connector". Registered ids are `connector-<hex>` and can never match.
 */
export const isCimdClientId = (clientId: string): boolean => /^https?:\/\//i.test(clientId);

/**
 * Untrusted display text, made plain. Strips what a terminal or a bidi-aware renderer would OBEY —
 * C0/C1 controls and DEL, the Unicode line/paragraph separators, and the bidi embedding, override,
 * isolate and mark characters — and trims. It never escapes markup: HTML escaping is the rendering
 * surface's job (`escapeHtml`), and doing it here would double-escape there.
 */
export const plainText = (text: string): string =>
  [...text]
    .filter((ch) => {
      const code = ch.codePointAt(0)!;
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false; // C0, DEL, C1
      if (code === 0x2028 || code === 0x2029) return false; // line/paragraph separators
      if (code === 0x061c || code === 0x200e || code === 0x200f) return false; // ALM, LRM, RLM
      if (code >= 0x202a && code <= 0x202e) return false; // LRE, RLE, PDF, LRO, RLO
      if (code >= 0x2066 && code <= 0x2069) return false; // LRI, RLI, FSI, PDI
      return true;
    })
    .join("")
    .trim();

/**
 * Is this a resolved address no client document may live at? Loopback, RFC1918, link-local, CGNAT,
 * multicast and the unspecified address for v4; loopback, unspecified, unique-local (fc00::/7),
 * link-local (fe80::/10), multicast and the v4-mapped/compatible forms for v6. An address this
 * function cannot parse is judged PRIVATE — never dial what cannot be judged (H9's direction:
 * "could not determine" must not read as "safe").
 */
export function privateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return privateV4(address);
  if (kind === 6) return privateV6(address.toLowerCase());
  return true;
}

const privateV4 = (address: string): boolean => {
  const [a, b] = address.split(".").map(Number) as [number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
};

const privateV6 = (address: string): boolean => {
  if (address === "::" || address === "::1") return true;
  if (address.startsWith("::ffff:")) {
    const tail = address.slice("::ffff:".length);
    if (isIP(tail) === 4) return privateV4(tail);
  }
  const first = address.split(":", 1)[0]!;
  if (first === "") return true; // "::…" — v4-compatible space and other zero-led shapes; fail closed
  const bits = Number.parseInt(first, 16);
  if (Number.isNaN(bits)) return true;
  if ((bits & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((bits & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if (bits >= 0xff00) return true; // multicast
  return false;
};

/** The client metadata this store reads out of a fetched document. */
export interface CimdDocument {
  /** The client_id URL — the client's identity everywhere a clientId flows. */
  readonly clientId: string;
  /** The document's client_name, `plainText`-scrubbed and bounded; the URL's host when absent. */
  readonly clientName: string;
  /** The document's redirect_uris, held as exact strings — authorize matches byte-for-byte. */
  readonly redirectUris: readonly string[];
}

export type CimdOutcome =
  | { readonly kind: "ok"; readonly document: CimdDocument }
  | { readonly kind: "refused"; readonly reason: string };

// Every reason is a FIXED string: these reach a refusal page, and neither the caller's URL nor any
// fetched byte may ride back into a response through them.
const refused = (reason: string): CimdOutcome => ({ kind: "refused", reason });

/**
 * The URL fences — everything judgeable before a dial. `allowPrivate` holds the seam's exact
 * origins; a match is exempt from the https fence and the host-name fences (its address fence is
 * skipped at the dial for the same reason), and from nothing else.
 */
export function cimdUrlDefect(
  clientId: string,
  allowPrivate: ReadonlySet<string>,
): string | undefined {
  if (clientId.length > CIMD_MAX_URL) {
    return `a client_id URL is at most ${CIMD_MAX_URL} characters`;
  }
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return "its client_id is not an absolute URL";
  }
  const insecure = allowPrivate.has(url.origin);
  if (url.protocol !== "https:" && !(insecure && url.protocol === "http:")) {
    return "a client document lives at an https URL";
  }
  if (url.username !== "" || url.password !== "") {
    return "a client document URL carries no userinfo";
  }
  if (url.hash !== "" || clientId.includes("#")) {
    return "a client document URL carries no fragment";
  }
  // No query either — stricter than the draft's SHOULD NOT, on purpose. The document's client_id
  // binding is satisfied by an echoing server for EVERY ?v= spelling of one logical client, and
  // each approved spelling would mint its own row, grant, generation and tokens — so a later
  // `grant revoke <url>` would strike one spelling while sibling grants stand. One client, one
  // spelling.
  if (url.search !== "" || clientId.includes("?")) {
    return "a client document URL carries no query";
  }
  // The draft: the URL MUST contain a path component. Its companion rule — no single- or
  // double-dot segments — is enforced by the WHATWG parser itself, which normalizes `.` and `..`
  // (percent-encoded forms included) out of `pathname` before any check here could read them, so
  // no explicit fence for it can ever decide.
  if (url.pathname === "/" || url.pathname === "") {
    return "a client document URL names a path, not a bare origin";
  }
  if (insecure) return undefined;
  const bare = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare) !== 0) {
    return "a client document host is a name, never an IP literal";
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "local" ||
    host.endsWith(".local") ||
    host === "internal" ||
    host.endsWith(".internal")
  ) {
    return "a client document does not live at a private name";
  }
  return undefined;
}

/**
 * May this document-vouched uri be a redirect target? The DOCUMENT decides WHICH uris vouch; this
 * store still holds each to its own hygiene — it parses, carries no fragment and no control byte
 * (it is stored in the code table and printed by `loam grant list`), and is https unless loopback,
 * the same scheme rule the registered flow keeps.
 */
export function cimdRedirectDefect(uri: string): string | undefined {
  if (uri.length === 0 || uri.length > MAX_URI)
    return `a redirect target is 1..${MAX_URI} characters`;
  const text = uriTextDefect(uri);
  if (text !== undefined) return text;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "the vouched redirect target is not an absolute URL";
  }
  if (url.hash !== "" || uri.includes("#")) {
    return "the vouched redirect target carries a fragment, and a redirect target may not";
  }
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (url.protocol !== "https:" && !loopback.has(url.hostname)) {
    return "the vouched redirect target is not https, and only a loopback host may be reached over http";
  }
  return undefined;
}

export interface CimdFetcherOptions {
  /** The test seam — exact origins exempt from the https and address fences. See the module header. */
  readonly allowPrivateOrigins?: readonly string[];
  /** A monotonic millisecond source for the cache's TTL. Defaults to `performance.now()`. */
  readonly now?: () => number;
  /** The fetch deadline, injectable so a rail need not wait five real seconds. */
  readonly timeoutMs?: number;
  /**
   * The resolver behind the connected-address fence, injectable so a rail can hand a public NAME a
   * private ANSWER without real DNS. Defaults to `dns.lookup`. Injection here is what proves the
   * fence judges the address the socket dials: the connection uses exactly what this returns.
   */
  readonly lookup?: LookupFunction;
}

export interface CimdFetcher {
  /** Fetch (or serve from the cache) and judge the metadata document `clientId` names. */
  fetch(clientId: string): Promise<CimdOutcome>;
}

/** How many cache entries may accumulate before a write prunes (H8 — the map must not grow forever). */
const CACHE_CEILING = 512;

export function makeCimdFetcher(options: CimdFetcherOptions = {}): CimdFetcher {
  const allowPrivate = new Set(options.allowPrivateOrigins ?? []);
  const now = options.now ?? ((): number => performance.now());
  const timeoutMs = options.timeoutMs ?? CIMD_TIMEOUT_MS;
  const lookup = options.lookup ?? dnsLookup;

  // The cache holds the in-flight PROMISE, keyed by the exact client_id string, so a burst of
  // authorize reads shares ONE fetch rather than one each (H8). A refusal deletes its own entry the
  // moment it lands — a failure is never cached (the draft's rule, and the poisoned-answer rule).
  const cache = new Map<
    string,
    { readonly promise: Promise<CimdOutcome>; readonly expiresAt: number }
  >();

  const prune = (at: number): void => {
    if (cache.size <= CACHE_CEILING) return;
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= at) cache.delete(key);
    }
    // Still over after dropping the expired: shed oldest-expiring first. Each surviving entry cost
    // its author a real fetch, so this is bounded housekeeping, not an oracle.
    while (cache.size > CACHE_CEILING) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest === undefined) break;
      cache.delete(oldest[0]);
    }
  };

  const fetchDocument = (clientId: string): Promise<CimdOutcome> => {
    const defect = cimdUrlDefect(clientId, allowPrivate);
    if (defect !== undefined) return Promise.resolve(refused(defect));
    const at = now();
    const hit = cache.get(clientId);
    if (hit !== undefined && hit.expiresAt > at) return hit.promise;
    const promise = dial(clientId, allowPrivate, lookup, timeoutMs).then(
      (outcome) => {
        if (outcome.kind !== "ok") cache.delete(clientId);
        return outcome;
      },
      () => {
        // A fault nobody anticipated is a refusal, never a throw into the door's generic guard —
        // and never a cache entry.
        cache.delete(clientId);
        return refused("the document could not be fetched");
      },
    );
    cache.set(clientId, { promise, expiresAt: at + CIMD_CACHE_TTL_MS });
    prune(at);
    return promise;
  };

  return { fetch: fetchDocument };
}

/** One real fetch: dial, fence the answer, judge the document. Never throws; every path resolves. */
const dial = (
  clientId: string,
  allowPrivate: ReadonlySet<string>,
  lookup: LookupFunction,
  timeoutMs: number,
): Promise<CimdOutcome> =>
  new Promise((resolve) => {
    const url = new URL(clientId); // already vetted by cimdUrlDefect
    const insecure = allowPrivate.has(url.origin);
    let settled = false;
    // A function declaration, so it may name `timer` (declared below, assigned before any of these
    // callbacks can fire — request and error events are never synchronous).
    function done(outcome: CimdOutcome): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    }

    // The connected-address fence. Node's connect may ask for one address or (under Happy
    // Eyeballs) for ALL of them and try several — so every address in the answer is judged, and a
    // single private one refuses the lot: any of them might be the one dialed.
    const guardedLookup: LookupFunction = (hostname, lookupOptions, callback) => {
      lookup(hostname, lookupOptions, (err, address, family) => {
        if (err !== null) {
          callback(err, address, family);
          return;
        }
        if (!insecure) {
          const addresses = Array.isArray(address) ? address.map((a) => a.address) : [address];
          if (addresses.some((a) => privateAddress(a))) {
            callback(new Error("cimd: resolved to a private address"), address, family);
            return;
          }
        }
        callback(null, address, family);
      });
    };

    const request = url.protocol === "http:" ? httpRequest : httpsRequest;
    const req = request(
      url,
      { method: "GET", lookup: guardedLookup, headers: { accept: "application/json" } },
      (res) => {
        const status = res.statusCode ?? 0;
        const finish = (outcome: CimdOutcome): void => {
          res.resume(); // drain whatever remains so the socket can close
          done(outcome);
          req.destroy();
        };
        if (status >= 300 && status < 400) {
          finish(refused("its URL answered a redirect, and a client document does not move"));
          return;
        }
        if (status !== 200) {
          finish(refused("its URL did not answer 200"));
          return;
        }
        const type = String(res.headers["content-type"] ?? "")
          .split(";")[0]!
          .trim()
          .toLowerCase();
        if (type !== "application/json") {
          finish(refused("a client document is served as application/json"));
          return;
        }
        const declared = Number(res.headers["content-length"] ?? "0");
        if (declared > CIMD_MAX_BYTES) {
          finish(refused(`a client document is no larger than ${CIMD_MAX_BYTES / 1024}KB`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > CIMD_MAX_BYTES) {
            finish(refused(`a client document is no larger than ${CIMD_MAX_BYTES / 1024}KB`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          done(judge(clientId, Buffer.concat(chunks).toString("utf8"), url));
        });
        res.on("error", () => done(refused("the document could not be read")));
      },
    );
    const timer = setTimeout(() => {
      done(refused("its URL did not answer inside the deadline"));
      req.destroy();
    }, timeoutMs);
    req.on("error", (err) =>
      done(
        err.message.startsWith("cimd:")
          ? refused("its name resolves to a private address")
          : refused("its URL could not be reached"),
      ),
    );
    req.end();
  });

/** The document checks — the draft's binding rules, judged over the fetched bytes. */
function judge(clientId: string, body: string, url: URL): CimdOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return refused("a client document is a JSON object");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return refused("a client document is a JSON object");
  }
  const doc = parsed as Record<string, unknown>;
  // The draft's binding check: the document must name, as its own client_id, exactly the URL it
  // was fetched from — simple string comparison, no normalization.
  if (doc["client_id"] !== clientId) {
    return refused("the document's own client_id does not match the URL it was fetched from");
  }
  const uris = doc["redirect_uris"];
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > CIMD_MAX_URIS) {
    return refused(`a client document carries 1..${CIMD_MAX_URIS} redirect_uris`);
  }
  // `Array.from`, never `.map` — a sparse array's hole must be judged, not skipped (oauth-file.ts).
  const redirectUris = Array.from(uris, (uri) => {
    if (typeof uri !== "string" || uri === "" || uri.length > MAX_URI) return undefined;
    if (uriTextDefect(uri) !== undefined) return undefined;
    return uri;
  });
  if (redirectUris.some((uri) => uri === undefined)) {
    return refused("every redirect_uri in a client document is a plain string");
  }
  // The draft prohibits any symmetric-secret method, and this store authenticates public clients
  // with "none" alone — a document asking for more is refused rather than half-honoured.
  const method = doc["token_endpoint_auth_method"];
  if (method !== undefined && method !== "none") {
    return refused('this store authenticates clients with token_endpoint_auth_method "none" alone');
  }
  const rawName = doc["client_name"];
  if (rawName !== undefined && typeof rawName !== "string") {
    return refused("a client_name, when present, is a string");
  }
  // The fetched name is UNTRUSTED DISPLAY TEXT: it reaches the consent page and, through the stored
  // row, a future `loam grant list` on a terminal. Scrubbed here, once, at the trust boundary.
  const scrubbed = plainText(rawName ?? "").slice(0, MAX_CLIENT_NAME);
  const clientName = scrubbed === "" ? url.host : scrubbed;
  return { kind: "ok", document: { clientId, clientName, redirectUris: redirectUris as string[] } };
}
