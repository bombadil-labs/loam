import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { lookup as dnsLookup } from "node:dns";
import { MAX_CLIENT_NAME, uriTextDefect } from "./oauth-file.js";

export const CIMD_MAX_BYTES = 64 * 1024;

export const CIMD_TIMEOUT_MS = 5_000;

export const CIMD_CACHE_TTL_MS = 5 * 60 * 1000;

export const CIMD_MAX_URIS = 32;

export const CIMD_MAX_URL = 2048;

const MAX_URI = 2048;

export const isCimdClientId = (clientId: string): boolean => /^https?:\/\//i.test(clientId);

export const plainText = (text: string): string =>
  [...text]
    .filter((ch) => {
      const code = ch.codePointAt(0)!;
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
      if (code === 0x2028 || code === 0x2029) return false;
      if (code === 0x061c || code === 0x200e || code === 0x200f) return false;
      if (code >= 0x202a && code <= 0x202e) return false;
      if (code >= 0x2066 && code <= 0x2069) return false;
      return true;
    })
    .join("")
    .trim();

export function privateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return privateV4(address);
  if (kind === 6) return privateV6(address.toLowerCase());
  return true;
}

const privateV4 = (address: string): boolean => {
  const [a, b] = address.split(".").map(Number) as [number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
};

const privateV6 = (address: string): boolean => {
  if (address === "::" || address === "::1") return true;
  if (address.startsWith("::ffff:")) {
    const tail = address.slice("::ffff:".length);
    if (isIP(tail) === 4) return privateV4(tail);
  }
  const first = address.split(":", 1)[0]!;
  if (first === "") return true;
  const bits = Number.parseInt(first, 16);
  if (Number.isNaN(bits)) return true;
  if ((bits & 0xfe00) === 0xfc00) return true;
  if ((bits & 0xffc0) === 0xfe80) return true;
  if (bits >= 0xff00) return true;
  return false;
};

export interface CimdDocument {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
}

export type CimdOutcome =
  | { readonly kind: "ok"; readonly document: CimdDocument }
  | { readonly kind: "refused"; readonly reason: string };

const refused = (reason: string): CimdOutcome => ({ kind: "refused", reason });

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
  if (url.search !== "" || clientId.includes("?")) {
    return "a client document URL carries no query";
  }
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
  readonly allowPrivateOrigins?: readonly string[];
  readonly now?: () => number;
  readonly timeoutMs?: number;

  readonly lookup?: LookupFunction;
}

export interface CimdFetcher {
  fetch(clientId: string): Promise<CimdOutcome>;
}

const CACHE_CEILING = 512;

export function makeCimdFetcher(options: CimdFetcherOptions = {}): CimdFetcher {
  const allowPrivate = new Set(options.allowPrivateOrigins ?? []);
  const now = options.now ?? ((): number => performance.now());
  const timeoutMs = options.timeoutMs ?? CIMD_TIMEOUT_MS;
  const lookup = options.lookup ?? dnsLookup;

  const cache = new Map<
    string,
    { readonly promise: Promise<CimdOutcome>; readonly expiresAt: number }
  >();

  const prune = (at: number): void => {
    if (cache.size <= CACHE_CEILING) return;
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= at) cache.delete(key);
    }
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

const dial = (
  clientId: string,
  allowPrivate: ReadonlySet<string>,
  lookup: LookupFunction,
  timeoutMs: number,
): Promise<CimdOutcome> =>
  new Promise((resolve) => {
    const url = new URL(clientId);
    const insecure = allowPrivate.has(url.origin);
    let settled = false;
    function done(outcome: CimdOutcome): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    }

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
          res.resume();
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
  if (doc["client_id"] !== clientId) {
    return refused("the document's own client_id does not match the URL it was fetched from");
  }
  const uris = doc["redirect_uris"];
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > CIMD_MAX_URIS) {
    return refused(`a client document carries 1..${CIMD_MAX_URIS} redirect_uris`);
  }
  const redirectUris = Array.from(uris, (uri) => {
    if (typeof uri !== "string" || uri === "" || uri.length > MAX_URI) return undefined;
    if (uriTextDefect(uri) !== undefined) return undefined;
    return uri;
  });
  if (redirectUris.some((uri) => uri === undefined)) {
    return refused("every redirect_uri in a client document is a plain string");
  }
  const method = doc["token_endpoint_auth_method"];
  if (method !== undefined && method !== "none") {
    return refused('this store authenticates clients with token_endpoint_auth_method "none" alone');
  }
  const rawName = doc["client_name"];
  if (rawName !== undefined && typeof rawName !== "string") {
    return refused("a client_name, when present, is a string");
  }
  const scrubbed = plainText(rawName ?? "").slice(0, MAX_CLIENT_NAME);
  const clientName = scrubbed === "" ? url.host : scrubbed;
  return { kind: "ok", document: { clientId, clientName, redirectUris: redirectUris as string[] } };
}
