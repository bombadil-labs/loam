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

import { createHash, randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { CACHE_NO_STORE, endJson, JSON_CONTENT_TYPE } from "./respond.js";
import { parseUrlEncoded, readBodyLenient } from "./body.js";
import { authorForSeed } from "@bombadil/rhizomatic";
import {
  OAuthFileBusy,
  OAuthFileUnlockable,
  clientFor,
  clientNameDefect,
  codeFor,
  grantFor,
  oauthPath,
  readOAuthFile,
  tokenFor,
  uriTextDefect,
  withOAuthFile,
  type OAuthClient,
  type OAuthCode,
  type OAuthFile,
  type OAuthGrant,
  type OAuthToken,
} from "./oauth-file.js";
import { CSP, escapeHtml, page, sameSecret, type SessionGate } from "./session.js";
import { AUTHORIZE_PATH, authorizeContinuation } from "./continuation.js";
import { cimdRedirectDefect, isCimdClientId, makeCimdFetcher, type CimdDocument } from "./cimd.js";
import type { Gateway } from "../gateway/gateway.js";
import { declareOwned, ensureUserKey, LEAF_RE } from "./provision.js";
import { bindableOf, isBindableName, subtreeOf } from "./subtree.js";

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

/**
 * RFC 9728: what a protected resource tells a client about itself.
 *
 * `resourcePath` names WHICH resource. Empty — the store-wide document at the bare well-known path —
 * identifies the store itself. A mount's MCP door passes `/<mount>/mcp`, and gets a document whose
 * `resource` is the exact URL a client dialled, which is what a client validating the identifier
 * against its own connection compares (T177). The authorization server is the store either way:
 * one store, one issuer, many protected resources.
 */
export function protectedResourceDocument(
  publicUrl: string,
  resourcePath = "",
): Record<string, unknown> {
  const issuer = issuerFor(publicUrl);
  return {
    resource: `${issuer}${resourcePath}`,
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
    // CIMD (T242, draft-ietf-oauth-client-id-metadata-document-02): a client_id may be an https
    // URL naming the client's own metadata document — no registration needed.
    client_id_metadata_document_supported: true,
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

/**
 * What the registration door needs (SPEC §37 phase 13). OPT-IN: absent, `makeOAuthDoors` owns only
 * the two well-known documents and `/oauth/register` resolves exactly as it did after phase 12 (an
 * unrouted OAuth path). The door mints NOTHING — no code, no token, no seed; it records a public
 * client and answers 201.
 */
export interface ConnectorRegistration {
  /** Where `oauth.json` lives — the home the operator seed lives in. */
  readonly home: string;
  /**
   * The origins a registered `redirect_uri` may sit at, as `scheme://host[:port]`. EMPTY means §37
   * is configured but fenced shut: every registration refuses and names the flag that opens it.
   * There is no "allow anything" spelling, deliberately.
   */
  readonly allowRedirectOrigins: readonly string[];
  /** Registrations this home will hold before the cap EVICTS the oldest evictable one (default 64). */
  readonly maxClients?: number;
  /** Where a local fault goes. The CALLER never sees it — it names the home's path. */
  readonly onFault?: (message: string) => void;
  /**
   * ClientIds with a token redemption IN FLIGHT right now — the third eviction-pin source (SPEC §37
   * phase 15, criterion 3). Shared with the token door: redemption deletes the code before it writes
   * the grant, so between those points the client holds neither, and only this in-memory count keeps
   * a flood in that window from evicting an approved connector. Absent, the pin reads the two durable
   * sources (grants and live codes) alone.
   */
  readonly redeeming?: ReadonlyMap<string, number>;
  /**
   * The CIMD test seam (T242): exact origins the document fetcher may reach past its https and
   * private-address fences, so a rail's own 127.0.0.1 fixture is fetchable. Threaded to the consent
   * door's fetcher; the CLI never sets it. The fences it opens — and the ones it does not — are
   * documented where they live, in `cimd.ts`.
   */
  readonly cimdAllowPrivateOrigins?: readonly string[];
}

export interface OAuthOptions {
  /** The outside address this store is reached at. Every discovery URL comes from here alone. */
  readonly publicUrl: string;
  /** Connector registration (SPEC §37 phase 13), opt-in. Absent, only the well-known docs answer. */
  readonly registration?: ConnectorRegistration;
}

// --- the redirect fence -------------------------------------------------------------------------

const MAX_BODY = 16 * 1024; // a registration is a few hundred bytes; nothing here needs more
const MAX_URIS = 8;
const MAX_URI = 2048;
const DEFAULT_MAX_CLIENTS = 64;

/**
 * Is this a spelling of an origin that could ever be a redirect target? An absolute URL whose own
 * `.origin` reads back byte-for-byte (so a default-port spelling — `https://x:443` — refuses, since
 * the WHATWG parser drops the port and the stored allowlist entry would then never match a uri),
 * https unless the host is loopback.
 *
 * Applied to the CONFIGURED allowlist at boot (an operator's typo becomes a startup error, not a
 * store where every registration silently refuses) AND to each submitted uri's origin.
 */
export function redirectOriginDefect(origin: string): string | undefined {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return `"${origin}" is not an absolute URL, so it names no origin`;
  }
  if (url.origin !== origin) {
    return (
      `"${origin}" is not a bare origin — an origin is scheme://host[:port] and nothing else ` +
      `(this one reads as "${url.origin}")`
    );
  }
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (url.protocol !== "https:" && !loopback.has(url.hostname)) {
    return `"${origin}" is not https, and only a loopback host may be reached over http`;
  }
  return undefined;
}

/**
 * May this `redirect_uri` be REGISTERED? An absolute URL, at an allowlisted origin, with no
 * fragment, carrying no control byte, and percent-TRANSPARENT.
 *
 * `uriTextDefect` runs BEFORE `new URL()`, which strips tab, LF and CR while parsing — so a uri
 * carrying them would pass every check below and keep its raw bytes in the stored string, where a
 * future `loam grant list` prints them and forges a row. Percent-transparency matters for the same
 * exact-match reason a later phase's authorize compares the caller's uri byte-for-byte against the
 * registered one.
 */
function redirectUriDefect(uri: string, allowed: readonly string[]): string | undefined {
  if (allowed.length === 0) {
    return (
      `this store registers no connectors: its operator has named no permitted redirect origin. ` +
      `Serve with --oauth-allow-redirect <origin> to open §37.`
    );
  }
  if (uri.length === 0 || uri.length > MAX_URI) return `a redirect_uri is 1..${MAX_URI} characters`;
  const text = uriTextDefect(uri);
  if (text !== undefined) return `"${uri}" is not a redirect target: ${text}`;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return `"${uri}" is not an absolute URL`;
  }
  if (url.hash !== "" || uri.includes("#")) {
    return `"${uri}" carries a fragment, and a redirect target may not`;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    return `"${uri}" carries a percent-escape that does not decode`;
  }
  if (decoded !== uri) {
    return (
      `"${uri}" carries a percent-escape, and this door compares a redirect target as one exact ` +
      `string — it would be reached as "${decoded}", a spelling it was never registered under`
    );
  }
  if (!allowed.includes(url.origin)) {
    // Say only that this origin is not permitted — NOT the whole allowlist, and NOT the flag name.
    // This door is unauthenticated and answers with a wildcard CORS origin, so echoing the
    // operator's trust list or their config flag hands an anonymous caller store recon for free.
    // The EMPTY-allowlist case above names the flag deliberately (a store where nothing works, an
    // operator-facing hint); an off-origin refusal is an ordinary caller error and stays generic.
    return `"${uri}" is not at an origin this store permits`;
  }
  // The scheme rule again, per uri — membership in the allowlist is not a licence, so the https
  // rule survives any future path that reaches here with a list boot never vetted.
  const originDefect = redirectOriginDefect(url.origin);
  if (originDefect !== undefined) return `"${uri}" is not a permitted target: ${originDefect}`;
  return undefined;
}

export interface OAuthDoors {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): void;
  /** The `WWW-Authenticate` value every MCP-door refusal carries — blind to mount, verb, token. */
  readonly challenge: string;
}

const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

const WELL_KNOWN_PATHS = new Set([
  RESOURCE_METADATA_PATH,
  "/.well-known/oauth-authorization-server",
]);

/**
 * RFC 9728 §3.1 PATH INSERTION. A protected resource whose identifier carries a path publishes its
 * metadata at `/.well-known/oauth-protected-resource` + that path — so this store's MCP door at
 * `<origin>/<mount>/mcp` is documented at `/.well-known/oauth-protected-resource/<mount>/mcp`. A
 * client constructs that URI from the URL it dialled, with no discovery hop, so it must answer.
 *
 * Returns the resource path (`/<mount>/mcp`) this URI documents, or undefined if the URI is not one.
 *
 * IT NEVER CONSULTS THE MOUNT TABLE, and that is the load-bearing property. A document served only
 * for mounts that exist would answer differently for a live name than for an absent one, and an
 * anonymous caller could then enumerate the store — the mount-existence oracle §12/T78 closed. The
 * answer is a pure function of the request path and `publicUrl`, exactly as the two root documents
 * are. Rails compare a ghost's response against a live mount's, response to response.
 *
 * ONE CANONICAL SPELLING. The segment must already be its own `encodeURIComponent` form, so
 * `resource` echoes the byte sequence the caller sent rather than a re-encoding that might differ
 * from the URL they are validating against. A non-canonical spelling is simply not this URI: it
 * falls through to the uniform refusal, like any other unrouted path.
 */
const mcpResourcePathOf = (pathname: string): string | undefined => {
  if (!pathname.startsWith(`${RESOURCE_METADATA_PATH}/`)) return undefined;
  const segments = pathname.slice(RESOURCE_METADATA_PATH.length + 1).split("/");
  if (segments.length !== 2 || segments[1] !== "mcp") return undefined;
  const mount = segments[0] ?? "";
  if (mount === "") return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(mount);
  } catch {
    return undefined; // a malformed escape names no resource
  }
  if (encodeURIComponent(decoded) !== mount) return undefined;
  return `/${mount}/mcp`;
};

const REGISTER_PATH = "/oauth/register";

/**
 * The BARE spellings of the three connector doors, beside the documented `/oauth/*` ones (T176).
 *
 * A real MCP client does not read `registration_endpoint` out of the RFC 8414 document: it joins
 * `/register` onto the authorization server's origin and POSTs there. That path was unrouted, so it
 * fell past every server-level door into the mount router, where `register` read as a mount name and
 * drew the uniform 401 — and the connector died on its first request.
 *
 * ONE SEGMENT SHADOWS NO MOUNT. Mount doors live at `/:mount/:verb`, two segments, so a bare name
 * never resolved to anything — the same argument `/login` and `/admin` already stand on.
 *
 * AND THE FALLTHROUGH IS UNTOUCHED. These paths become ROUTED; nothing else changes. A name that is
 * not one of them still falls into the uniform 401, because a 404 there would reopen the
 * mount-existence oracle §12/T78 closed on purpose (`test/server/oauth-bare-paths.test.ts` compares
 * an unrouted path against a real mount's refusal, byte for byte).
 *
 * The bare form is DERIVED from the documented one rather than spelled a second time, so the two can
 * never drift apart — and so a door added later cannot be routed at one spelling and not the other.
 *
 * The derivation is a fixed-width slice, so it is only meaningful under `/oauth/`. The prefix is
 * therefore an INVARIANT, checked once at module load rather than trusted to every future call site:
 * a door at `/oauth2/x` or a reuse on `/session/token` would otherwise derive a garbage alias in
 * silence, and `/session/token` in particular would claim the bare `/token` for the wrong door.
 * Matching stays EXACT — never a prefix or suffix test, so `/anymount/register` and `/register/extra`
 * belong to no door.
 */
const OAUTH_PREFIX = "/oauth";

const doorAt = (documented: string): ((pathname: string) => boolean) => {
  if (!documented.startsWith(`${OAUTH_PREFIX}/`)) {
    throw new Error(
      `a connector door is named "${OAUTH_PREFIX}/<door>", and "${documented}" is not — ` +
        `its bare alias cannot be derived by dropping "${OAUTH_PREFIX}"`,
    );
  }
  const bare = documented.slice(OAUTH_PREFIX.length);
  return (pathname) => pathname === documented || pathname === bare;
};

const atRegisterPath = doorAt(REGISTER_PATH);

/** oauth's cap is a door decision (16 KiB — a registration is a few hundred bytes). */
const readBody = (req: IncomingMessage): Promise<string | undefined> =>
  readBodyLenient(req, MAX_BODY);

export function makeOAuthDoors(options: OAuthOptions): OAuthDoors {
  const publicUrl = options.publicUrl;
  const registration = options.registration;

  // The discovery documents' agreed headers (T153): no-store (a discovery answer changes with the
  // store) and CORS (browser callers), spelled once here instead of per writeHead.
  const DISCOVERY_HEADERS = {
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  } as const;

  const documentFor = (pathname: string): Record<string, unknown> => {
    const resourcePath = mcpResourcePathOf(pathname);
    if (resourcePath !== undefined) return protectedResourceDocument(publicUrl, resourcePath);
    return pathname === RESOURCE_METADATA_PATH
      ? protectedResourceDocument(publicUrl)
      : authorizationServerDocument(publicUrl);
  };

  const wellKnown = (pathname: string, req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      endJson(
        res,
        405,
        { error: "this document answers GET" },
        {
          allow: "GET, HEAD",
          ...DISCOVERY_HEADERS,
        },
      );
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, { ...DISCOVERY_HEADERS, "content-type": JSON_CONTENT_TYPE });
      res.end();
      return;
    }
    endJson(res, 200, documentFor(pathname), DISCOVERY_HEADERS);
  };

  // --- POST /oauth/register (RFC 7591), SPEC §37 phase 13 ---------------------------------------
  //
  // Every response is JSON with a wildcard CORS origin: the door reads NO cookie, so a wildcard
  // origin lends a caller nothing, exactly as it lends nothing on the data doors. Every refusal is
  // RFC 6749's `{ error, error_description }`, and none carries a Location.

  const home = registration?.home ?? "";
  const allowed = registration === undefined ? [] : [...registration.allowRedirectOrigins];
  const maxClients = registration?.maxClients ?? DEFAULT_MAX_CLIENTS;
  const onFault = registration?.onFault ?? ((message: string): void => void message);
  const redeeming = registration?.redeeming;

  const jsonOut = (res: ServerResponse, status: number, body: unknown): void =>
    endJson(res, status, body, {
      // The oauth door's policy: no-referrer (JSON, never a form), no-store (auth answers), and
      // CORS (the register/token doors answer browser callers).
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "access-control-allow-origin": "*",
    });
  const refuse = (res: ServerResponse, status: number, error: string, description: string): void =>
    jsonOut(res, status, { error, error_description: description });

  const postRegister = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse((await readBody(req)) ?? "");
    } catch {
      refuse(res, 400, "invalid_client_metadata", "the body must be a JSON object");
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      refuse(res, 400, "invalid_client_metadata", "the body must be a JSON object");
      return;
    }
    const body = parsed as Record<string, unknown>;
    const name = body["client_name"];
    if (typeof name !== "string") {
      refuse(res, 400, "invalid_client_metadata", "client_name is a string");
      return;
    }
    // The name reaches the operator's TERMINAL through a future `loam grant list`, and this door
    // takes no credential — so a newline forges a row. `clientNameDefect` is phase 11's shared rule.
    const nameDefect = clientNameDefect(name);
    if (nameDefect !== undefined) {
      refuse(res, 400, "invalid_client_metadata", nameDefect);
      return;
    }
    const uris = body["redirect_uris"];
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_URIS) {
      refuse(
        res,
        400,
        "invalid_redirect_uri",
        `redirect_uris is an array of 1..${MAX_URIS} absolute URLs`,
      );
      return;
    }
    // EVERY uri, not the first that passes: one honest entry carrying a hostile sibling means the
    // client holds both, and whichever authorize later accepts is the one that matters.
    const checked: string[] = [];
    for (const uri of uris) {
      if (typeof uri !== "string") {
        refuse(res, 400, "invalid_redirect_uri", "every redirect_uri is a string");
        return;
      }
      const defect = redirectUriDefect(uri, allowed);
      if (defect !== undefined) {
        refuse(res, 400, "invalid_redirect_uri", defect);
        return;
      }
      checked.push(uri);
    }

    type Registered =
      | { kind: "ok"; client: OAuthClient }
      | { kind: "full" }
      | { kind: "unreadable" }
      | { kind: "locked" };

    let outcome: Registered;
    try {
      outcome = withOAuthFile<Registered>(home, (file) => {
        // AT THE CAP, EVICT THE OLDEST EVICTABLE REGISTRATION rather than refuse. This door takes
        // no credential, so a plain cap is a lockout: a stranger fills it and the real connector is
        // refused forever, with no command that removes one. So the pressure falls on registrations
        // nobody is using, and a flood evicts its own earlier entries.
        //
        // THE PIN READS THREE SOURCES (SPEC §37 phase 15, criterion 3): a grant record (an APPROVED
        // connector's seed signs deltas the store holds), a LIVE CODE (an approved connector whose
        // token exchange has not yet run), and a redemption IN FLIGHT (the window where the code is
        // already burnt and the grant not yet written — the client holds neither durably, so only
        // this in-memory count keeps a flood from evicting it). Adding a source only makes eviction
        // MORE conservative.
        const pinned = new Set<string>([
          ...file.grants.map((g) => g.clientId),
          ...(file.codes ?? []).map((c) => c.clientId),
          ...(redeeming === undefined
            ? []
            : [...redeeming].filter(([, n]) => n > 0).map(([clientId]) => clientId)),
        ]);
        let clients = [...file.clients];
        while (clients.length >= maxClients) {
          const oldest = clients
            .filter((c) => !pinned.has(c.clientId))
            .sort((a, b) => a.registeredAt - b.registeredAt)[0];
          if (oldest === undefined) return { result: { kind: "full" as const } };
          clients = clients.filter((c) => c.clientId !== oldest.clientId);
        }
        const client: OAuthClient = {
          clientId: `connector-${randomBytes(16).toString("hex")}`,
          clientName: name,
          redirectUris: checked,
          registeredAt: Date.now(),
          generation: 1,
        };
        return {
          next: { ...file, clients: [...clients, client] },
          result: { kind: "ok" as const, client },
        };
      });
    } catch (err) {
      // The DETAIL names the home's path; it goes ONLY to the operator's channel. A lock that could
      // not be taken is not a damaged file, but both are the same fixed answer to an unauthenticated
      // caller that answers with a wildcard CORS origin.
      onFault(
        `the connector doors could not register a connector in ${oauthPath(home)}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      outcome =
        err instanceof OAuthFileBusy || err instanceof OAuthFileUnlockable
          ? { kind: "locked" }
          : { kind: "unreadable" };
    }

    if (outcome.kind === "locked") {
      refuse(
        res,
        503,
        "temporarily_unavailable",
        "this store cannot take the lock on its connector records, so it registers nothing",
      );
      return;
    }
    if (outcome.kind === "unreadable") {
      refuse(
        res,
        503,
        "temporarily_unavailable",
        "this store cannot read its connector records, so it registers nothing",
      );
      return;
    }
    if (outcome.kind === "full") {
      refuse(
        res,
        400,
        "invalid_client_metadata",
        `this store already holds ${maxClients} connectors it will not displace — each one is ` +
          `approved. \`loam grant list\` names them.`,
      );
      return;
    }
    jsonOut(res, 201, {
      client_id: outcome.client.clientId,
      client_name: outcome.client.clientName,
      redirect_uris: outcome.client.redirectUris,
      client_id_issued_at: Math.floor(outcome.client.registeredAt / 1000),
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: CONNECTOR_SCOPE,
    });
  };

  const handleRegister = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      refuse(res, 405, "invalid_request", "registration answers POST");
      return;
    }
    // ONE GUARD over the whole handler: a fault nobody anticipated must not escape to the server's
    // generic 500, whose message carries the home's absolute path.
    try {
      await postRegister(req, res);
    } catch (err) {
      onFault(
        `a connector door failed answering ${REGISTER_PATH}: ` +
          `${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      if (!res.headersSent) {
        refuse(
          res,
          503,
          "temporarily_unavailable",
          "this store could not answer, and it says no rather than why",
        );
      } else {
        res.end();
      }
    }
  };

  // BOTH halves take the alias, and `handle` is the half that matters: `wellKnown` answers the
  // authorization-server document for every path that is not the protected-resource one, so an alias
  // added to `owns` alone would serve a 200 discovery document at `/register` — a failure that looks
  // like success, and worse than the 401 it replaced.
  const registers = (pathname: string): boolean =>
    registration !== undefined && atRegisterPath(pathname);

  return {
    owns: (pathname) =>
      WELL_KNOWN_PATHS.has(pathname) ||
      mcpResourcePathOf(pathname) !== undefined ||
      registers(pathname),
    challenge: challengeFor(publicUrl),
    handle(pathname, req, res) {
      if (registers(pathname)) {
        void handleRegister(req, res);
        return;
      }
      wellKnown(pathname, req, res);
    },
  };
}

// --- GET /oauth/authorize and its approval POST (SPEC §37 phase 14) -----------------------------
//
// The consent page sits behind a phase-5 session and behind phase-6's provenance + form-token
// check — it REUSES the login doors' machinery through a `SessionGate` rather than re-deciding any
// of it. It MINTS ONLY A CODE: no seed, no token, no grant. Redemption is phase 15.
//
// THE OPEN-REDIRECT FENCE IS THE WHOLE POINT. A `redirect_uri` must EXACTLY match one the client
// registered — byte for byte, so a different path, an added query, or another port each refuse. No
// refusal ever writes a `Location`: the only response that redirects is a granted approval, and it
// redirects to the REGISTERED uri alone. A caller-supplied uri that failed the match is never a
// redirect target and never reaches the page as displayed text either.

export { AUTHORIZE_PATH } from "./continuation.js";

const atAuthorizePath = doorAt(AUTHORIZE_PATH);

/**
 * How long a minted authorization code lives. RFC 6749 §4.1.2 recommends a 10-minute maximum; a Loam
 * code is redeemed at once, so it is tighter. The deadline is recorded at MINT from a monotonic
 * clock (see `OAuthCode.expiresAt`), never re-read from the wall clock at check time.
 */
export const CODE_TTL_MS = 60_000;

const MAX_STATE = 2048; // the client's opaque round-trip value; a few hundred bytes in practice

// --- PKCE (RFC 7636), S256 only -----------------------------------------------------------------
//
// The discovery document advertises S256 and only S256, so the token exchange verifies exactly one
// way: `challenge === base64url(sha256(verifier))`. `plain` is never honoured — a `plain` challenge
// simply fails the S256 comparison at redemption. A challenge/verifier is 43..128 characters of the
// unreserved set, which carries no control byte, so a stored challenge can never forge a listing row.

const PKCE_SHAPE = /^[A-Za-z0-9._~-]{43,128}$/;

/**
 * Is `challenge` acceptable at consent? EMPTY is allowed here (the consent GET does not require PKCE,
 * so a caller that sends none still gets a page) — but the token exchange refuses a code whose
 * challenge is empty, so PKCE is mandatory for any flow that actually redeems.
 */
function pkceChallengeDefect(challenge: string): string | undefined {
  if (challenge === "") return undefined;
  if (!PKCE_SHAPE.test(challenge)) {
    return "The PKCE code_challenge must be 43–128 characters of A–Z, a–z, 0–9, dot, dash, underscore or tilde.";
  }
  return undefined;
}

/**
 * Is this authorize request one the token door could ever finish? Checked at the consent GET and
 * re-checked on the approval POST, so a doomed flow refuses HERE — on the page, with the parameter
 * named — instead of minting a code whose redemption fails late wearing `invalid_grant`.
 *
 * Each named parameter is judged when PRESENT, and an omitted method beside a present challenge
 * is judged as what RFC 7636 §4.3 says it is — `plain`. Neither parameter survives to the token
 * door. The mint copies `code_challenge` alone, `OAuthCode` has no
 * method field, and the redeemer reads only `grant_type`, `code`, `client_id`, `redirect_uri` and
 * `code_verifier`. So a declared method is INERT here — only the challenge value decides, and the
 * redeemer always verifies it as S256.
 *
 * That inertness is what this gate ends, and it ends two working shapes:
 *
 * - A client that declares `code_challenge_method=plain` while computing an S256 challenge
 *   redeems successfully today. It now refuses at the door. RFC 7636 §4.3 requires the server to
 *   honour the DECLARED method, and this store implements S256 only, so honouring `plain` means
 *   saying no — a store that silently verified S256 against a request for `plain` would be
 *   claiming a transform it never ran.
 * - A client that sends `response_type=token` and then reads `?code=` off the redirect also
 *   redeems today. The register door has always advertised `response_types: ["code"]`
 *   unconditionally, so that client was reading a grant it never asked for.
 *
 * Both are misconfigurations that happened to work. The refusal names the parameter, states the
 * supported value, and never reflects the caller's own text.
 */
export function authorizeRequestDefect(
  responseType: string,
  codeChallengeMethod: string,
  codeChallenge = "",
): string | undefined {
  if (responseType !== "" && responseType !== "code") {
    return 'This store issues authorization codes and nothing else: response_type, when sent, must be "code".';
  }
  if (codeChallengeMethod !== "" && codeChallengeMethod !== "S256") {
    return 'This store verifies PKCE one way only: code_challenge_method, when sent, must be "S256".';
  }
  // RFC 7636 §4.3: a code_challenge with no method IS a `plain` declaration — and this store
  // honours a plain declaration the only honest way an S256-only verifier can, by refusing it at
  // the door. Before T167 this shape passed, minted, and died late at the token door wearing
  // `invalid_grant`. A request with no challenge at all is untouched here: PKCE is then not in
  // play, and that (still-doomed) shape is the ticket's named remaining case.
  if (codeChallenge !== "" && codeChallengeMethod === "") {
    return 'RFC 7636 reads an omitted code_challenge_method as "plain", and this store verifies S256 only: send code_challenge_method="S256".';
  }
  return undefined;
}

/** RFC 7636 S256: does `verifier` hash to `challenge`? Constant-time on the digest comparison. */
function pkceVerifies(verifier: string, challenge: string): boolean {
  if (!PKCE_SHAPE.test(verifier) || challenge === "") return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return sameSecret(computed, challenge);
}

export interface ConsentOptions {
  /** The session machinery this page sits behind — the login doors' own, reused whole. */
  readonly gate: SessionGate;
  /** Where `oauth.json` lives (the connectors' home) — the registered clients and the code table. */
  readonly home: string;
  /**
   * A monotonic millisecond source for the code's deadline. Injectable so a rail can step it;
   * defaults to `performance.now()`. NEVER `Date.now()`: a wall-clock step backwards must not extend
   * a code's life.
   */
  readonly now?: () => number;
  /** The CIMD document fetcher's test seam (T242) — see `ConnectorRegistration` and `cimd.ts`. */
  readonly cimdAllowPrivateOrigins?: readonly string[];
  /**
   * The users' side of the binding (SPEC §58), given as ONE thing so it can never be given by
   * halves. `ground` is the users mount's live gateway, re-asked per request: the page lists the
   * containers under the person's name and provisions the home and the target on approval.
   * `home` is the USERS' home, where `user.<name>.seed` lives (§36) — distinct from the `home`
   * above, the connectors' (`oauth.json`): `loam serve` passes one directory for both, a
   * programmatic serve() may not, and a seed provisioned into the wrong one splits a person into
   * two keys. Absent, the page does not render and approves no binding — a connection is never
   * bound nowhere. (A POST that names no binding at all still mints an unbound code; see the
   * two shapes of "no binding" in `handlePost`.)
   */
  readonly users?: {
    readonly ground: () => Gateway | undefined;
    readonly home: string;
  };
  /** Where a local fault goes; it may name the home's path, so the caller never sees it. */
  readonly onFault?: (message: string) => void;
}

export interface ConsentDoor {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void>;
}

/** The one warning the consent copy MUST carry — a grant's real power (SPEC §37 phase 14, criterion 7). */
const STRIKER_WARNING =
  "A granted connector signs under its own name. As a lawful striker it can retract claims the " +
  "operator wrote — a strike it signs suppresses them for any reader.";

export function makeConsentDoor(options: ConsentOptions): ConsentDoor {
  const gate = options.gate;
  const home = options.home;
  const now = options.now ?? ((): number => performance.now());
  const digestOf = (secret: string): string => createHash("sha256").update(secret).digest("hex");
  // The CIMD document fetcher (T242), sharing this door's monotonic clock so a rail that steps the
  // session window steps the document cache with it. Its fences live in cimd.ts.
  const cimd = makeCimdFetcher({
    now,
    ...(options.cimdAllowPrivateOrigins === undefined
      ? {}
      : { allowPrivateOrigins: options.cimdAllowPrivateOrigins }),
  });

  const htmlOut = (
    res: ServerResponse,
    status: number,
    body: string,
    cookie?: string,
    csp: string = CSP,
  ): void => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "cache-control": CACHE_NO_STORE,
      // Never no-referrer on a form-hosting page — it nulls the POST's Origin (T143). `origin`,
      // not `same-origin`: this page's query carries client_id, state and code_challenge, and
      // under `origin` no Referer in any direction ever carries more than the bare origin.
      "referrer-policy": "origin",
      ...(cookie === undefined ? {} : { "set-cookie": cookie }),
    });
    res.end(body);
  };

  // Every REFUSAL is a page with no `Location` — the open-redirect fence. It reflects no caller text,
  // so a bad `client_id` or `redirect_uri` cannot ride back into the DOM.
  const refuse = (res: ServerResponse, status: number, message: string): void =>
    htmlOut(res, status, page("this request was refused", `<h1>Refused.</h1>\n<p>${message}</p>`));

  // The binding field (SPEC §58 position 1): a connection lives in ONE container under the
  // person's name, chosen here or created here, and never in the home itself. The home is not an
  // option; the empty option is the refusal, not a default.
  const bindingFields = (user: string, bindable: readonly string[]): string =>
    `<fieldset>
<legend>Bind this connection to</legend>
<p>A connection lives in one container under your name, and never above it. That container is
where this connection lives.</p>
<label for="bind">an existing container</label>
<select id="bind" name="bind">
<option value="">—</option>
${bindable.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("\n")}
</select>
<label for="bind_new">or create one under <code>${escapeHtml(user)}:</code></label>
<input id="bind_new" name="bind_new" placeholder="journal" maxlength="63">
</fieldset>`;

  const consentPage = (
    client: Pick<OAuthClient, "clientId" | "clientName">,
    registeredUri: string,
    state: string,
    codeChallenge: string,
    codeChallengeMethod: string,
    formToken: string,
    user: string,
    bindable: readonly string[],
  ): string =>
    page(
      "approve a connector",
      `<h1>Approve a connector?</h1>
<p><code>${escapeHtml(client.clientName)}</code> asks to act in this store under its own name.</p>
${
  // A CIMD client's real identity is its URL (T242) — the name above is whatever its document
  // says, so the page shows the address a person can actually judge.
  isCimdClientId(client.clientId)
    ? `<p>Its identity is its own address: <code>${escapeHtml(client.clientId)}</code>, whose document vouches for the redirect below.</p>\n`
    : ""
}<p>If you approve, this store will send it back to <code>${escapeHtml(registeredUri)}</code>.</p>
<p><strong>${escapeHtml(STRIKER_WARNING)}</strong></p>
<form method="post" action="${AUTHORIZE_PATH}">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<input type="hidden" name="client_id" value="${escapeHtml(client.clientId)}">
<input type="hidden" name="redirect_uri" value="${escapeHtml(registeredUri)}">
<input type="hidden" name="state" value="${escapeHtml(state)}">
<input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
<input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}">
${bindingFields(user, bindable)}
<button type="submit">approve</button>
</form>`,
    );

  // Where the approval binds (SPEC §58 position 1). Two levels are never bound — the store and the
  // person's home — and a name outside the person's reach draws the same answer whether it is
  // another person's or nobody's. A pool INSIDE the reach — a connection's or a channel's — is
  // refused by its own reason: it hides nothing from its owner, so the uniform answer would only
  // mislead. A leaf under the home may be created here; an existing container under the home may
  // be chosen. The refusal sentences are the page's own words.
  type Binding =
    | { readonly kind: "existing"; readonly container: string }
    | { readonly kind: "create"; readonly leaf: string; readonly container: string }
    | { readonly kind: "refuse"; readonly status: number; readonly message: string };
  const notYours: Binding = {
    kind: "refuse",
    status: 404,
    message: "Nothing under your name answers to that, so nothing was approved.",
  };
  const neverAPool: Binding = {
    kind: "refuse",
    status: 400,
    message:
      "That is a pool — a connection's or a channel's — and a pool is never bound. Choose a " +
      "container under your name, or create one.",
  };
  const bindingOf = (gw: Gateway, user: string, bind: string, bindNew: string): Binding => {
    if (bindNew !== "") {
      if (!LEAF_RE.test(bindNew)) {
        return {
          kind: "refuse",
          status: 400,
          message:
            "A container name here is letters, digits, dashes, and underscores, up to 63 of " +
            "them — one level below your name.",
        };
      }
      const container = `${user}:${bindNew}`;
      // A name that already stands is judged by REACH, not by its shape: a container declared
      // elsewhere under this spelling (a federation receiver opened without a parent, say) is
      // outside the person's subtree, and creating "into" it would bind a code to a place the
      // person does not reach. Inside the reach it is simply the existing container.
      const table = gw.containers();
      if (table.containers.has(container)) {
        if (!subtreeOf(table, user).has(container)) return notYours;
        return table.containers.get(container)?.inboxOf === undefined
          ? { kind: "existing", container }
          : neverAPool;
      }
      return { kind: "create", leaf: bindNew, container };
    }
    if (bind !== "" && !isBindableName(bind)) {
      return {
        kind: "refuse",
        status: 400,
        message: "That name carries a character no binding can, so it cannot be bound.",
      };
    }
    if (bind === "") {
      return {
        kind: "refuse",
        status: 400,
        message:
          "A connection is never bound to the store or to your home. Choose a container under " +
          "your name, or create one.",
      };
    }
    if (bind === user) {
      return {
        kind: "refuse",
        status: 400,
        message:
          "Your home container is never bound. Choose a container under your name, or create " +
          "one.",
      };
    }
    const table = gw.containers();
    if (!subtreeOf(table, user).has(bind)) return notYours;
    if (table.containers.get(bind)?.inboxOf !== undefined) return neverAPool;
    return { kind: "existing", container: bind };
  };

  // A registered uri EXACTLY equal to the presented one, byte for byte — never a normalized or
  // reparsed form. `undefined` when the client is unknown or nothing matches.
  const exactMatch = (clientId: string, uri: string): OAuthClient | undefined => {
    const client = clientFor(readOAuthFile(home), clientId);
    if (client === undefined) return undefined;
    return client.redirectUris.includes(uri) ? client : undefined;
  };

  // `exactMatch`'s CIMD counterpart (T242): the client's own metadata document is the registration.
  // Fetched through the fetcher's cache and judged per request. FRESHNESS IS BOUNDED, not
  // immediate: a document edit binds once the cached entry expires — up to CIMD_CACHE_TTL_MS
  // (5 minutes), plus a minted code's 60s life — and not one request longer. The presented uri
  // must equal one of the document's redirect_uris byte for byte, then pass this store's own
  // hygiene (cimdRedirectDefect). Every reason is a fixed string; no caller text and no fetched
  // byte rides back through it.
  const cimdMatch = async (
    clientId: string,
    uri: string,
  ): Promise<{ kind: "ok"; document: CimdDocument } | { kind: "refused"; reason: string }> => {
    const outcome = await cimd.fetch(clientId);
    if (outcome.kind === "refused") return outcome;
    if (!outcome.document.redirectUris.includes(uri)) {
      return { kind: "refused", reason: "its document does not vouch for that redirect address" };
    }
    const defect = cimdRedirectDefect(uri);
    if (defect !== undefined) return { kind: "refused", reason: defect };
    return { kind: "ok", document: outcome.document };
  };

  const readBodyFields = (req: IncomingMessage): Promise<Map<string, string>> =>
    readBody(req).then((body) => parseUrlEncoded(body ?? ""));

  const handleGet = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Behind a phase-5 session. No session → the login form, and nothing minted. READ, don't slide:
    // a bare GET here can be a SameSite=Lax cross-site top-level nav carrying the victim's cookie, and
    // rendering the consent page must not extend their session's idle window. `peek` reads without
    // touching — the same choice handlePost makes, so refused traffic never slides (session.ts).
    const url = new URL(req.url ?? "", "http://loam.invalid");
    const session = gate.peek(req);
    if (session === undefined) {
      // THE CONTINUATION, and it is why a person who signs in here is not stranded (T148). The form
      // carries this request's own authorize parameters, filtered to the allowlist, so the login
      // door can re-attach them to ITS OWN copy of this path once the password is right. It carries
      // a query, never a destination — see continuation.ts for why that distinction is the fence.
      const form = gate.loginForm(req, authorizeContinuation(url.search));
      htmlOut(res, 200, form.body, form.cookie);
      return;
    }
    const params = url.searchParams;
    const clientId = params.get("client_id") ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";
    const state = params.get("state") ?? "";
    const codeChallenge = params.get("code_challenge") ?? "";
    if (state.length > MAX_STATE) {
      refuse(res, 400, "The state value is too long.");
      return;
    }
    const requestDefect = authorizeRequestDefect(
      params.get("response_type") ?? "",
      params.get("code_challenge_method") ?? "",
      codeChallenge,
    );
    if (requestDefect !== undefined) {
      refuse(res, 400, requestDefect);
      return;
    }
    const challengeDefect = pkceChallengeDefect(codeChallenge);
    if (challengeDefect !== undefined) {
      refuse(res, 400, challengeDefect);
      return;
    }
    // The exact-match fence, on the GET as on the POST: an unknown client or a uri nothing vouches
    // for is refused with no `Location` and no caller text reflected. WHO vouches depends on the
    // client_id's shape (T242): a URL-shaped id is judged against its own fetched metadata
    // document, any other against the registration this store holds.
    let client: Pick<OAuthClient, "clientId" | "clientName">;
    if (isCimdClientId(clientId)) {
      const found = await cimdMatch(clientId, redirectUri);
      if (found.kind === "refused") {
        refuse(res, 400, `This request was not accepted: ${found.reason}.`);
        return;
      }
      client = { clientId, clientName: found.document.clientName };
    } else {
      const registered = exactMatch(clientId, redirectUri);
      if (registered === undefined) {
        refuse(res, 400, "This store holds no connector that may be reached at that address.");
        return;
      }
      client = registered;
    }
    // Display the REGISTERED uri (`redirectUri` here is byte-equal to it, having matched), never the
    // caller's own text. `state` and the PKCE `code_challenge` ride the form so the approval echoes
    // the state back to the client and binds the code to the challenge.
    //
    // The consent page's CSP widens form-action by exactly one origin: the REGISTERED uri's.
    // Chrome enforces form-action against a form POST's redirect target, so under the shared
    // `form-action 'self'` the approval's 302 to the connector is BLOCKED in a real browser
    // (T143's second finding — invisible to every hand-built fixture). `redirectUri` is caller
    // text made safe by the exactMatch fence above — byte-equal to a registered uri, so its
    // origin is the registered one — and the refusal pages keep the shared CSP.
    const consentCsp = CSP.replace(
      "form-action 'self'",
      `form-action 'self' ${new URL(redirectUri).origin}`,
    );
    // The containers the person may bind into, read from the live table (§58). No ground, no
    // binding — the page says so rather than offering a form that cannot approve.
    const gw = options.users?.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so no connection can be bound.");
      return;
    }
    htmlOut(
      res,
      200,
      consentPage(
        client,
        redirectUri,
        state,
        codeChallenge,
        params.get("code_challenge_method") ?? "",
        session.formToken,
        session.user,
        bindableOf(gw.containers(), session.user),
      ),
      undefined,
      consentCsp,
    );
  };

  const handlePost = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Phase-6 provenance FIRST, before any session read — and drain the body so a refusal leaves no
    // bytes on a keep-alive socket. A cross-site-shaped approval mints nothing.
    if (!gate.fromThisPage(req)) {
      await readBody(req);
      refuse(res, 403, "This request did not come from this store's own page.");
      return;
    }
    const fields = await readBodyFields(req);
    // A live session, WITHOUT sliding it — a refused approval must not extend a session's life.
    const session = gate.peek(req);
    if (session === undefined) {
      refuse(res, 401, "No live session is presented here.");
      return;
    }
    // The form token, compared timing-safely against the session's own (the login doors' own
    // `sameSecret`) — the second half of the phase-6 check. A missing or forged token mints nothing.
    if (!sameSecret(fields.get("form_token") ?? "", session.formToken)) {
      refuse(res, 403, "This request did not come from this store's own page.");
      return;
    }
    const clientId = fields.get("client_id") ?? "";
    const redirectUri = fields.get("redirect_uri") ?? "";
    const state = fields.get("state") ?? "";
    const codeChallenge = fields.get("code_challenge") ?? "";
    if (state.length > MAX_STATE) {
      refuse(res, 400, "The state value is too long.");
      return;
    }
    // The same gate the GET ran, on the POST's OWN fields: the form now carries the method beside
    // the challenge (a form whose own re-check refuses it would be a door that mints only for
    // hand-built POSTs), and a hand-built POST may send anything, so a value the GET would refuse
    // must not mint here either.
    const requestDefect = authorizeRequestDefect(
      fields.get("response_type") ?? "",
      fields.get("code_challenge_method") ?? "",
      codeChallenge,
    );
    if (requestDefect !== undefined) {
      refuse(res, 400, requestDefect);
      return;
    }
    const challengeDefect = pkceChallengeDefect(codeChallenge);
    if (challengeDefect !== undefined) {
      refuse(res, 400, challengeDefect);
      return;
    }
    // Re-run the vouching fence on the POST's OWN fields — the hidden field is a caller's to
    // forge, so the registration (or the CIMD document, through its cache) is re-read and
    // re-checked here, never trusted from the GET.
    //
    // Mint the code: a secret to the client, its DIGEST to the file — bound to the client, the
    // exact uri, the PKCE challenge, and the client's current generation, with a monotonic deadline
    // recorded now. No seed, no token, no grant (that is phase 15's redemption). `mint` builds the
    // whole next file inside the one locked write.
    // The binding (§58), judged BEFORE anything is minted or declared: a refused binding leaves
    // the store exactly as it was — no code, no container, no seed.
    //
    // TWO SHAPES OF "NO BINDING", told apart on purpose. The page's own form always carries the
    // two fields, so a person who left the choice blank gets the sentence that names the rule. A
    // POST that carries NEITHER field is not this page's form — a script — and it mints a code
    // that carries no container, provisioning nothing. The exchange does not read the binding
    // yet, so that code redeems as it always did; refusing it — a connection is never bound
    // nowhere — is the exchange's own slice, and the refusal lands where the binding would have
    // been used, with the same sentence.
    const user = session.user;
    const bindingOffered = fields.has("bind") || fields.has("bind_new");
    let container: string | undefined;
    if (bindingOffered) {
      const users = options.users;
      const gw = users?.ground();
      if (users === undefined || gw === undefined) {
        refuse(res, 503, "This store's ground is not reachable, so it approved nothing.");
        return;
      }
      // `bind` is a name the page emitted from the store's own table, compared as-is — a name is
      // whatever the store holds, spaces and all. Only the typed leaf is trimmed.
      const binding = bindingOf(
        gw,
        user,
        fields.get("bind") ?? "",
        (fields.get("bind_new") ?? "").trim(),
      );
      if (binding.kind === "refuse") {
        refuse(res, binding.status, binding.message);
        return;
      }
      // Provision what the binding needs — the person's key and home when absent, the new leaf
      // when asked for — in the same act as the approval, so a first-day consent needs no admin
      // page first. The seed lives in the USERS' home; the faults name paths and go to the
      // operator; the person sees the sentence.
      const fault = options.onFault ?? ((): void => undefined);
      const usersHome = users.home;
      const table = gw.containers();
      if (binding.kind === "create" || !table.containers.has(user)) {
        const key = await ensureUserKey(gw, usersHome, user, (m) => fault(`the consent page ${m}`));
        if ("refusal" in key) {
          refuse(res, key.refusal.status, key.refusal.message);
          return;
        }
        if (!table.containers.has(user)) {
          const declined = await declareOwned(gw, user, key.userSeed, undefined, (m) =>
            fault(`the consent page ${m}`),
          );
          if (declined !== undefined) {
            refuse(res, declined.status, declined.message);
            return;
          }
        }
        if (binding.kind === "create") {
          const declined = await declareOwned(gw, binding.container, key.userSeed, user, (m) =>
            fault(`the consent page ${m}`),
          );
          if (declined !== undefined) {
            refuse(res, declined.status, declined.message);
            return;
          }
        }
      }
      container = binding.container;
    }
    const secret = randomBytes(32).toString("base64url");
    const codeRecord = (generation: number): OAuthCode => ({
      digest: digestOf(secret),
      clientId,
      redirectUri,
      expiresAt: now() + CODE_TTL_MS,
      issuedAt: Date.now(),
      codeChallenge,
      generation,
      user,
      ...(container === undefined ? {} : { container }),
    });
    let mint: (file: OAuthFile) => OAuthFile;
    if (isCimdClientId(clientId)) {
      const found = await cimdMatch(clientId, redirectUri);
      if (found.kind === "refused") {
        refuse(res, 400, `This request was not accepted: ${found.reason}.`);
        return;
      }
      const document = found.document;
      mint = (file) => {
        // ONE URL-keyed row per CIMD client, upserted at the approval POST alone — a consent GET,
        // served or refused, writes nothing (railed in oauth-cimd.test.ts), and /oauth/register is
        // never involved. The row exists so the generation gate, revocation and the grant ledger
        // hold for a CIMD client exactly as for a registered one; it is idempotent by key, so a
        // hundred approvals leave one row. Its name and uris are refreshed from the document each
        // time, but AUTHORIZATION always reads the fetched document (cimdMatch above), never this
        // row. The generation is read inside this locked write, not from any earlier snapshot.
        const existing = clientFor(file, clientId);
        const row: OAuthClient =
          existing === undefined
            ? {
                clientId,
                clientName: document.clientName,
                redirectUris: [...document.redirectUris],
                registeredAt: Date.now(),
                generation: 1,
              }
            : {
                ...existing,
                clientName: document.clientName,
                redirectUris: [...document.redirectUris],
              };
        return {
          ...file,
          clients:
            existing === undefined
              ? [...file.clients, row]
              : file.clients.map((c) => (c.clientId === clientId ? row : c)),
          // A FRESH row starts at generation 1 — and a CIMD id is DETERMINISTIC, so if an earlier
          // row under this same URL was evicted after a revoke, a stale token stamped with the old
          // generation could match the fresh count. Purging this id's tokens at re-creation closes
          // that resurrection; a registered client cannot reach it, its ids being random.
          tokens:
            existing === undefined
              ? file.tokens.filter((t) => t.clientId !== clientId)
              : file.tokens,
          codes: [...(file.codes ?? []), codeRecord(row.generation)],
        };
      };
    } else {
      const client = exactMatch(clientId, redirectUri);
      if (client === undefined) {
        refuse(res, 400, "This store holds no connector that may be reached at that address.");
        return;
      }
      const record = codeRecord(client.generation);
      mint = (file) => ({ ...file, codes: [...(file.codes ?? []), record] });
    }
    try {
      withOAuthFile<void>(home, (file) => ({
        next: mint(file),
        result: undefined,
      }));
    } catch (err) {
      // A lock this store could not take, or a file it could not read, mints nothing and writes no
      // `Location` — the same failing-closed the register door does.
      const temporary = err instanceof OAuthFileBusy || err instanceof OAuthFileUnlockable;
      refuse(
        res,
        503,
        temporary
          ? "This store cannot take the lock on its connector records, so it approved nothing."
          : "This store cannot read its connector records, so it approved nothing.",
      );
      return;
    }
    // The ONLY response that redirects, and only ever to the REGISTERED uri. The code and the
    // client's opaque `state` ride the query; the registered uri is preserved byte-for-byte and the
    // parameters are appended, never reparsed.
    const sep = redirectUri.includes("?") ? "&" : "?";
    const stateParam = state === "" ? "" : `&state=${encodeURIComponent(state)}`;
    const location = `${redirectUri}${sep}code=${encodeURIComponent(secret)}${stateParam}`;
    res.writeHead(302, {
      location,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end();
  };

  return {
    owns: atAuthorizePath,
    async handle(pathname, req, res) {
      try {
        if (req.method === "GET") {
          await handleGet(req, res);
          return;
        }
        if (req.method === "POST") {
          await handlePost(req, res);
          return;
        }
        htmlOut(
          res,
          405,
          page(
            "method not allowed",
            `<h1>Refused.</h1>\n<p>${AUTHORIZE_PATH} answers GET and POST.</p>`,
          ),
        );
      } catch {
        // A fault nobody anticipated must not escape to the server's generic 500, whose message can
        // carry the home's absolute path. It says no rather than why, and writes no `Location`.
        if (!res.headersSent) {
          refuse(res, 503, "This store could not answer, and it says no rather than why.");
        } else {
          res.end();
        }
      }
    },
  };
}

// --- POST /oauth/token (RFC 6749 §4.1.3) and revocation (SPEC §37 phase 15) ----------------------
//
// The token exchange redeems a single-use authorization code for a per-connector actor seed and a
// bearer token. The seed is a FRESH random key — NEVER the operator's — so there is no code path
// from any input here to `{ operator: true }` (criterion 7): the mint only ever calls `authorForSeed`
// on a key it just generated, and the resolver returns `{ actor: <seed> }` and nothing else.
//
// Custody: the seed lives in `oauth.json` (mode 0600, never in the ground, like the operator seed) so
// this server signs the connector's writes on its behalf — the same custodial trade the login doors
// make for a browser session. The token itself is handed to the client and only its DIGEST is stored.
//
// Revocation is a GENERATION bump on the client. A token and a code each remember the generation they
// were minted under; a bump makes both stop matching at once, so revocation binds on the next request
// of the same live process with no restart, and it strikes the ground write-grant so the actor loses
// standing too. It never touches the connector's past deltas — they keep naming their author.

const TOKEN_PATH = "/oauth/token";

const atTokenPath = doorAt(TOKEN_PATH);

/** The connector identity a presented bearer token resolves to. The `actor` is a SIGNING SEED. */
export interface ConnectorIdentity {
  readonly actor: string; // the grant's actorSeed — never the operator's, never `operator: true`
}

export interface TokenDoorOptions {
  /** Where `oauth.json` lives — the clients, codes, grants and tokens. */
  readonly home: string;
  /**
   * A monotonic millisecond source for the code-expiry check, the login doors' own so a code's
   * deadline and a session's window step together under a rail. Defaults to `performance.now()`.
   */
  readonly now?: () => number;
  /**
   * ClientIds redeeming right now — SHARED with the register door's eviction pin (criterion 3/4).
   * A count, not a flag: two concurrent redemptions for one client each hold it, so the first to
   * finish cannot clear a pin the second still needs.
   */
  readonly redeeming: Map<string, number>;
  /**
   * Land the operator-signed write grant for `actor` in the ground, returning the delta's id. This is
   * the seam that needs the operator's signing authority and the live gateway; the door itself holds
   * neither. Called AFTER the seed is durably written (criterion 5), so a retry reuses the seed.
   */
  readonly grantStanding: (actor: string) => Promise<string>;
  /** Where a local fault goes. The CALLER never sees it — it may name the home's path. */
  readonly onFault?: (message: string) => void;
  /**
   * The file reader, injectable so a rail can COUNT reads and prove the unknown-token path is bounded
   * (criterion 11): an unknown bearer token is one in-memory index miss, with no file read behind it.
   */
  readonly readFile?: (home: string) => OAuthFile;
}

export interface TokenDoor {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void>;
  /**
   * Resolve a presented bearer token DIGEST (sha-256 hex) to its connector identity, or undefined.
   * BOUNDED (criterion 11): an unknown digest is a single in-memory Set miss — no file read, and so
   * no per-grant key derivation. Only a digest this door has minted (or read from the file at boot)
   * pays a file read, to re-check the generation so a cross-process revoke binds at once.
   */
  resolve(digestHex: string): ConnectorIdentity | undefined;
  /** The public face of a resolved token — the client and its PUBLIC author, for whoami (T255). */
  describe(digestHex: string): { clientId: string; actor: string } | undefined;
}

const digestHex = (secret: string): string => createHash("sha256").update(secret).digest("hex");

const MAX_TOKEN_BODY_FIELD = 4096; // a code, a verifier, an id — none is large

export function makeTokenDoor(options: TokenDoorOptions): TokenDoor {
  const home = options.home;
  const now = options.now ?? ((): number => performance.now());
  const redeeming = options.redeeming;
  const onFault = options.onFault ?? ((message: string): void => void message);
  const readFile = options.readFile ?? readOAuthFile;

  // The bounded index: digests this door will bother reading the file for. Seeded from the file at
  // creation (so a restart still authenticates a live token) and grown on every mint. A stale entry
  // costs one file read that then refuses; a MISS costs nothing — which is the whole point.
  const known = new Set<string>();
  try {
    for (const token of readFile(home).tokens) known.add(token.digest);
  } catch (err) {
    // A file this door cannot read at boot means no digests are known — every token then refuses,
    // failing closed, until the file is readable again. The operator's channel hears why.
    onFault(
      `the token door could not read ${oauthPath(home)} at startup, so no connector token ` +
        `authenticates yet: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const inc = (clientId: string): void => {
    redeeming.set(clientId, (redeeming.get(clientId) ?? 0) + 1);
  };
  // The token door's JSON policy: no-store (a token answer must not be cached), no-referrer (JSON,
  // never a form), CORS (browser callers). The one spelling, per door, per the T153 agreement.
  const TOKEN_DOOR_HEADERS = {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "access-control-allow-origin": "*",
  } as const;

  const dec = (clientId: string): void => {
    const n = (redeeming.get(clientId) ?? 0) - 1;
    if (n <= 0) redeeming.delete(clientId);
    else redeeming.set(clientId, n);
  };

  const jsonOut = (res: ServerResponse, status: number, body: unknown): void =>
    endJson(res, status, body, TOKEN_DOOR_HEADERS);
  // RFC 6749 §5.2 token-error shape. NEVER the home path or a flag name (criterion 13): a lock fault
  // is a fixed 503 whose body says "lock", an ordinary caller error a 400 that names only itself.
  const refuse = (res: ServerResponse, status: number, error: string, description: string): void =>
    jsonOut(res, status, { error, error_description: description });

  const field = (fields: Map<string, string>, name: string): string => {
    const value = fields.get(name) ?? "";
    return value.length > MAX_TOKEN_BODY_FIELD ? "" : value;
  };

  const resolve = (digest: string): ConnectorIdentity | undefined => {
    // The bounded gate: an unknown digest returns here, having read no file and derived no key.
    if (!known.has(digest)) return undefined;
    let file: OAuthFile;
    try {
      file = readFile(home);
    } catch {
      return undefined; // cannot decide is never "authenticated"
    }
    const token = tokenFor(file, digest);
    if (token === undefined) {
      known.delete(digest); // the file no longer holds it; stop paying a read for a dead digest
      return undefined;
    }
    const client = clientFor(file, token.clientId);
    // The generation gate — a revoke bumped the client past this token's mint generation, so it is
    // refused on the very next request (criterion 9), and it STAYS refused across a later re-grant:
    // a fresh grant does not lower the generation, so an old token never resurrects. An absent
    // generation never equals a client's.
    if (client === undefined || token.generation !== client.generation) return undefined;
    const grant = grantFor(file, token.clientId);
    if (grant === undefined || !grant.standing) return undefined;
    return { actor: grant.actorSeed };
  };

  // The same ladder as `resolve`, answering the PUBLIC half: which client, which author. Never
  // the seed — whoami reports identity, and identity is what the store's own deltas carry.
  const describe = (digest: string): { clientId: string; actor: string } | undefined => {
    let file: OAuthFile;
    try {
      file = readOAuthFile(home);
    } catch {
      return undefined;
    }
    const token = tokenFor(file, digest);
    if (token === undefined) return undefined;
    const client = clientFor(file, token.clientId);
    if (client === undefined || token.generation !== client.generation) return undefined;
    const grant = grantFor(file, token.clientId);
    if (grant === undefined || !grant.standing) return undefined;
    return { clientId: token.clientId, actor: grant.actor };
  };

  // The redemption itself, one attempt. Every early return is a refusal that MINTS NOTHING.
  const redeem = async (fields: Map<string, string>, res: ServerResponse): Promise<void> => {
    if (field(fields, "grant_type") !== "authorization_code") {
      refuse(res, 400, "unsupported_grant_type", "this token endpoint answers authorization_code");
      return;
    }
    const codeSecret = field(fields, "code");
    const clientId = field(fields, "client_id");
    const redirectUri = field(fields, "redirect_uri");
    const verifier = field(fields, "code_verifier");
    if (codeSecret === "" || clientId === "" || redirectUri === "" || verifier === "") {
      refuse(
        res,
        400,
        "invalid_request",
        "a redemption needs code, client_id, redirect_uri and code_verifier",
      );
      return;
    }
    const codeDigest = digestHex(codeSecret);

    // BURN FIRST, and atomically: one locked read-modify-write finds the code and deletes it in the
    // same turn, returning what it was. A code is single-use on ANY attempt (criterion 1) — a wrong
    // verifier below still leaves it gone — and two concurrent redemptions cannot both burn one code,
    // because only the write that removed it sees a non-undefined code here.
    let burnt: OAuthCode | undefined;
    try {
      burnt = withOAuthFile<OAuthCode | undefined>(home, (file) => {
        const code = codeFor(file, codeDigest);
        if (code === undefined) return { result: undefined };
        return {
          next: { ...file, codes: (file.codes ?? []).filter((c) => c.digest !== codeDigest) },
          result: code,
        };
      });
    } catch (err) {
      lockFaultOrRethrow(res, err, "redeemed nothing");
      return;
    }
    if (burnt === undefined) {
      refuse(res, 400, "invalid_grant", "this code is unknown, already redeemed, or expired");
      return;
    }
    const code = burnt;

    // The pin covers the WINDOW the code just left open: from here (code burnt) until the grant is
    // written, the client holds neither, so only this count keeps a register flood from evicting it
    // (criterion 3). Released in `finally` so a throw cannot leak it (criterion 4).
    inc(code.clientId);
    try {
      // The bindings, expiry, generation and PKCE — the code is already burnt, so every refusal below
      // is terminal for it. `sameSecret` on the two id/uri strings keeps a length-independent compare.
      if (!sameSecret(clientId, code.clientId) || !sameSecret(redirectUri, code.redirectUri)) {
        refuse(res, 400, "invalid_grant", "this code was not issued to that client or address");
        return;
      }
      if (code.expiresAt <= now()) {
        refuse(res, 400, "invalid_grant", "this code has expired");
        return;
      }
      if (code.codeChallenge === undefined || code.codeChallenge === "") {
        refuse(
          res,
          400,
          "invalid_grant",
          "this code was issued without PKCE and cannot be redeemed",
        );
        return;
      }
      if (!pkceVerifies(verifier, code.codeChallenge)) {
        refuse(res, 400, "invalid_grant", "the PKCE code_verifier does not match the challenge");
        return;
      }

      // The generation gate at redemption (criterion 8): a code minted before a revoke carries the
      // old generation and mints nothing after it. Read the CURRENT client generation.
      const file = readFile(home);
      const client = clientFor(file, code.clientId);
      if (client === undefined) {
        refuse(res, 400, "invalid_grant", "the connector this code named is no longer registered");
        return;
      }
      if (code.generation !== client.generation) {
        refuse(res, 400, "invalid_grant", "this code was issued before the connector was revoked");
        return;
      }

      // The seed: reuse the client's existing grant seed, or mint a fresh one and WRITE IT FIRST
      // (standing false) so a retry after a failed ground append reuses it rather than minting a
      // second and stranding the first (criterion 5). Never the operator's — a fresh random key.
      const existing = grantFor(file, code.clientId);
      let grant: OAuthGrant;
      if (existing !== undefined) {
        grant = existing;
      } else {
        const actorSeed = randomBytes(32).toString("hex");
        grant = {
          clientId: code.clientId,
          actorSeed,
          actor: authorForSeed(actorSeed),
          grantedAt: Date.now(),
          standing: false,
        };
        withOAuthFile<void>(home, (f) => ({
          next:
            grantFor(f, code.clientId) === undefined ? { ...f, grants: [...f.grants, grant] } : f,
          result: undefined,
        }));
      }

      // Land the operator-signed write grant in the ground (unless it already stands), then record
      // its standing. The ground is the authority on whether the connector may write; `oauth.json`
      // caches that so the resolver need not re-derive it per request.
      if (!grant.standing) {
        const grantDeltaId = await options.grantStanding(grant.actor);
        withOAuthFile<void>(home, (f) => ({
          next: {
            ...f,
            grants: f.grants.map((g) =>
              g.clientId === code.clientId ? { ...g, standing: true, grantDeltaId } : g,
            ),
          },
          result: undefined,
        }));
        grant = { ...grant, standing: true, grantDeltaId };
      }

      // Mint the bearer token: a secret to the client, its DIGEST plus the mint generation to the
      // file. The plaintext never touches disk. Register the digest so the resolver will read for it.
      const tokenSecret = randomBytes(32).toString("base64url");
      const digest = digestHex(tokenSecret);
      const record: OAuthToken = {
        digest,
        clientId: code.clientId,
        issuedAt: Date.now(),
        generation: client.generation,
      };
      withOAuthFile<void>(home, (f) => ({
        next: { ...f, tokens: [...f.tokens, record] },
        result: undefined,
      }));
      known.add(digest);

      jsonOut(res, 200, {
        access_token: tokenSecret,
        token_type: "Bearer",
        scope: CONNECTOR_SCOPE,
      });
    } catch (err) {
      lockFaultOrRethrow(res, err, "granted nothing");
    } finally {
      dec(code.clientId);
    }
  };

  // A lock this store could not take, or a file it could not read, is a fixed 503 whose body says
  // "lock" or "records" and NEVER the home path (criterion 13). Anything else re-throws to the
  // handler's own guard, which answers a generic 503 the same knowledge-free way.
  function lockFaultOrRethrow(res: ServerResponse, err: unknown, what: string): void {
    if (err instanceof OAuthFileBusy || err instanceof OAuthFileUnlockable) {
      onFault(`the token door could not take the lock on ${oauthPath(home)}: ${err.message}`);
      refuse(
        res,
        503,
        "temporarily_unavailable",
        `this store cannot take the lock on its connector records, so it ${what}`,
      );
      return;
    }
    throw err;
  }

  const readBodyFields = (req: IncomingMessage): Promise<Map<string, string>> =>
    readBody(req).then((body) => parseUrlEncoded(body ?? ""));

  return {
    owns: atTokenPath,
    resolve,
    describe,
    async handle(pathname, req, res) {
      if (req.method !== "POST") {
        refuse(res, 405, "invalid_request", "the token endpoint answers POST");
        return;
      }
      try {
        await redeem(await readBodyFields(req), res);
      } catch (err) {
        onFault(
          `a connector door failed answering ${TOKEN_PATH}: ` +
            `${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
        if (!res.headersSent) {
          refuse(
            res,
            503,
            "temporarily_unavailable",
            "this store could not answer, and it says no rather than why",
          );
        } else {
          res.end();
        }
      }
    },
  };
}

// --- revocation ---------------------------------------------------------------------------------

export type RevokeOutcome =
  | { readonly kind: "revoked"; readonly clientId: string; readonly generation: number }
  | { readonly kind: "no-such-client" }
  | { readonly kind: "locked" }
  | { readonly kind: "unreadable" };

/**
 * Revoke a connector (SPEC §37 phase 15, criteria 8–10). Bumps the client's generation and drops its
 * grant record in one locked write — that alone makes every live token and in-flight code stop
 * matching, so access is gone on the next request with no restart — then strikes the ground
 * write-grant so the actor loses standing at the source too. It NEVER touches the connector's past
 * deltas: those keep naming their author and keep resolving (the surviving-bystander half).
 *
 * `strikeStanding` is the seam that needs the operator's signing authority and the live reactor; it
 * is called AFTER the file write, so a strike failure leaves access already gone rather than a client
 * whose token still authenticates. Both the CLI (its own gateway) and the server (its live one) pass it.
 */
export async function revokeConnector(
  home: string,
  clientId: string,
  strikeStanding: (grant: OAuthGrant) => Promise<void>,
  onFault: (message: string) => void = () => {},
): Promise<RevokeOutcome> {
  let struckGrant: OAuthGrant | undefined;
  let outcome: RevokeOutcome;
  try {
    outcome = withOAuthFile<RevokeOutcome>(home, (file) => {
      const client = clientFor(file, clientId);
      if (client === undefined) return { result: { kind: "no-such-client" } };
      struckGrant = grantFor(file, clientId);
      const going = struckGrant; // a const the closures below can narrow; `struckGrant` outlives this scope
      return {
        next: {
          ...file,
          clients: file.clients.map((c) =>
            c.clientId === clientId ? { ...c, generation: c.generation + 1 } : c,
          ),
          // The grant goes, and with it the SEED — revocation destroys the key. What survives is the
          // public author, in a list nothing that mints authority reads (`OAuthRevocation`). Without
          // it the store forgets who acted the moment it stops letting them act, and the ledger then
          // reports a connector of months' standing as having "no acting identity yet" while the
          // grant it held sits attributed to nobody.
          grants: file.grants.filter((g) => g.clientId !== clientId),
          // Keyed by ACTOR: a re-keyed connector keeps a record for every key it ever signed with,
          // and revoking the same key twice replaces rather than duplicates.
          ...(going === undefined
            ? {}
            : {
                revoked: [
                  ...(file.revoked ?? []).filter((r) => r.actor !== going.actor),
                  { clientId, actor: going.actor, revokedAt: Date.now() },
                ],
              }),
        },
        result: { kind: "revoked", clientId, generation: client.generation + 1 },
      };
    });
  } catch (err) {
    if (err instanceof OAuthFileBusy || err instanceof OAuthFileUnlockable) {
      return { kind: "locked" };
    }
    return { kind: "unreadable" };
  }
  // The ground strike is cleanup after the authoritative access-kill above. A failure here leaves the
  // token dead (generation bumped) and only the ground grant lingering, reachable by nothing.
  if (outcome.kind === "revoked" && struckGrant !== undefined) {
    try {
      await strikeStanding(struckGrant);
    } catch (err) {
      onFault(
        `revoked ${clientId} in ${oauthPath(home)} (its tokens are dead) but could not strike its ` +
          `ground write grant: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return outcome;
}
