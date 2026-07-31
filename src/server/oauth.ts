// Discovery and the 401 (SPEC §37 phase 12/15) — the two RFC well-known documents an OAuth
// connector reads before any human is involved, and the `WWW-Authenticate` challenge that points a
// refused MCP caller at them. This phase MINTS NOTHING: no client, no code, no token. Those doors
// (registration, consent, the token exchange) arrive in phases 13-15, into this same file.
//
// EVERY URL COMES FROM ONE CONFIGURED STRING, `publicUrl` — never `req.headers`. Neither document
// function nor `challengeFor` reads a request at all, so a foreign `Host` or `X-Forwarded-Host` has
// nothing to act on: this is not merely tested to agree, it is structurally unable to disagree.
//
// THE CHALLENGE HEADER IS A CONSTANT OF THE SERVER, blind to the mount, the verb otherwise, and the
// token presented. `http.ts` attaches it only where the request's parsed verb is "mcp", at the two
// call sites inside its existing uniform 401 (T78/§12) — a header that differed by mount would
// reopen exactly the oracle that discipline exists to prevent.

import { type IncomingMessage, type ServerResponse } from "node:http";

/** The one scope §37 ships. A scope LIST replaces it when a second one exists. */
export const CONNECTOR_SCOPE = "loam.connector";

/**
 * The issuer, and the ONE place it is computed. `protectedResourceDocument`,
 * `authorizationServerDocument` and `challengeFor` all call this rather than re-deriving it, so a
 * store configured with or without a trailing slash advertises the identical issuer everywhere.
 */
export function issuerFor(publicUrl: string): string {
  return publicUrl.replace(/\/+$/, "");
}

/** RFC 9728: what a protected resource (this store's MCP door) tells a client about itself. */
export function protectedResourceDocument(publicUrl: string): Record<string, unknown> {
  const issuer = issuerFor(publicUrl);
  return {
    resource: issuer,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [CONNECTOR_SCOPE],
  };
}

/** RFC 8414: what this store's (not-yet-built) authorization server advertises about itself. */
export function authorizationServerDocument(publicUrl: string): Record<string, unknown> {
  const issuer = issuerFor(publicUrl);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    // S256 and only S256: `plain` in this list would let a caller skip PKCE while the document
    // still said the word.
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [CONNECTOR_SCOPE],
  };
}

/** The `WWW-Authenticate` value `http.ts` attaches to the MCP door's 401 — a constant of the server. */
export function challengeFor(publicUrl: string): string {
  return `Bearer resource_metadata="${issuerFor(publicUrl)}/.well-known/oauth-protected-resource"`;
}

// --- the public-url admission gate --------------------------------------------------------------

/**
 * May `raw` be `--public-url`? An http(s) origin, case-insensitively, with no path, query or
 * fragment beyond a single trailing slash (which `issuerFor` already strips before this runs).
 *
 * Refuses a default-port spelling ON PURPOSE (`https://x:443`, `http://x:80`): the WHATWG parser's
 * own `.origin` drops a default port, so comparing against the caller's string is exactly what
 * catches one — an operator who typed the port gets a boot refusal naming the canonical spelling,
 * the same "typo becomes a boot error, not a silent hole" trade this whole check exists for.
 */
export function publicUrlDefect(raw: string): string | undefined {
  const normalized = issuerFor(raw);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return `"${raw}" is not an absolute URL, so it names no origin`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `"${raw}" is not http or https — an OAuth issuer names an HTTP(S) origin`;
  }
  if (url.origin.toLowerCase() !== normalized.toLowerCase()) {
    return (
      `"${raw}" is not a bare origin — an origin is scheme://host[:port] and nothing else ` +
      `(this one reads as "${url.origin}")`
    );
  }
  return undefined;
}

/**
 * The canonical form `--public-url` resolves to, once `publicUrlDefect` has cleared it: lowercased
 * by the WHATWG parser, so a document never advertises a differently-cased issuer than the one that
 * passed the boot check.
 */
export function canonicalPublicUrl(raw: string): string {
  return new URL(issuerFor(raw)).origin;
}

export interface OAuthOptions {
  /** The outside address this store is reached at. Every discovery URL comes from here alone. */
  readonly publicUrl: string;
}

export interface OAuthDoors {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): void;
  /** The `WWW-Authenticate` value every MCP-door refusal carries — blind to mount, verb, token. */
  readonly challenge: string;
}

const WELL_KNOWN_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
]);

export function makeOAuthDoors(options: OAuthOptions): OAuthDoors {
  const publicUrl = options.publicUrl;

  const documentFor = (pathname: string): Record<string, unknown> =>
    pathname === "/.well-known/oauth-protected-resource"
      ? protectedResourceDocument(publicUrl)
      : authorizationServerDocument(publicUrl);

  return {
    owns: (pathname) => WELL_KNOWN_PATHS.has(pathname),
    challenge: challengeFor(publicUrl),
    handle(pathname, req, res) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, {
          allow: "GET, HEAD",
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        });
        res.end(JSON.stringify({ error: "this document answers GET" }));
        return;
      }
      const headers = {
        "content-type": "application/json",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      };
      if (req.method === "HEAD") {
        res.writeHead(200, headers);
        res.end();
        return;
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify(documentFor(pathname)));
    },
  };
}
