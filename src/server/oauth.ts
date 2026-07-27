// Loam as its own (tiny) OAuth 2.1 provider (SPEC §37) — the five doors a claude.ai custom connector
// needs: two well-known documents, dynamic registration, authorize, token.
//
// WHAT A GRANT PRODUCES, and it is the whole design: a NEW actor seed for that connector. Not the
// operator's identity, not a copy of it, not a scoped version of it. The connector holds its own
// signing key with granted-author standing, so every delta it writes says who wrote it, and revoking
// it takes nothing else down. There is no code path from an OAuth grant to `{ operator: true }` —
// `mintToken` below returns an `{ actor }` and has no other return.
//
// THREE FENCES, and none of them is the mint path's identity check:
//
//   1. Registration cannot require a session. Claude.ai registers before any human is present, so the
//      endpoint is open by protocol and the fence is a CONFIGURED allowlist of redirect origins
//      (`--oauth-allow-redirect`). Without it a stranger registers a client named "Claude" pointing at
//      a host they run, sends the operator a plausible authorize link, and holds a writing identity.
//      That attack never needs to become the operator.
//   2. Authorize re-checks the allowlist AND requires an EXACT match against a uri this client
//      registered. The allowlist bounds what may be registered; it is not the per-client fence.
//   3. The consent POST carries §36's two independent same-origin signals plus the session's form
//      token, because the button that grants a writing identity is a form on the operator's browser.
//
// EVERY DISCOVERY URL COMES FROM THE CONFIGURED PUBLIC URL. `Host` and `X-Forwarded-*` are the
// caller's to write, and a caller who can set them could otherwise make this store advertise an
// authorization server they run — the browser would go there to sign in.
//
// THE CHALLENGE HEADER IS A CONSTANT OF THE SERVER. RFC 9728 asks a protected resource to name its
// authorization server in `WWW-Authenticate`, and the obvious place is the door that refused. That
// door's refusal is byte-uniform on purpose (§12/T78): a tokenless caller must not be able to tell a
// mount that exists from one that never did. A header attached per mount would reopen that oracle
// through the response's other half, so this one is blind to the mount, the verb and the token.
//
// WHAT THE DOORS DO NOT GOVERN: an ATTACHED CONTAINER's mount. `serve` refuses a second static mount
// and refuses `addMount` while the login doors are open, but a container mounts itself (mounts.ts) and
// no guard here can refuse that call. An OAuth token therefore reaches a container's read doors. It
// cannot exceed the operator there — a container shares the host's operator by §24.1, and the same
// operator token already reaches it — and the connector's write standing is a grant in the HOST's
// ground, which the container's own grant table does not hold. Named rather than implied: the residue
// is READ reach across an attachment the operator made, and closing it wants a mount-scoped token,
// which is its own ticket.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { authorForSeed } from "@bombadil/rhizomatic";
import {
  EMPTY_OAUTH,
  clientFor,
  clientNameDefect,
  grantFor,
  grantForToken,
  oauthPath,
  readOAuthFile,
  writeOAuthFile,
  type OAuthClient,
  type OAuthFile,
  type OAuthGrant,
} from "./oauth-file.js";
import { CSP, escapeHtml, page, sameSecret, type ConsentAuth } from "./session.js";

/** The one scope §37 ships. A scope LIST replaces it when a second one exists; the page is written for it. */
export const CONNECTOR_SCOPE = "loam.connector";

export interface OAuthOptions {
  /** Where oauth.json lives — the same home credentials.json and the operator seed live in. */
  readonly home: string;
  /**
   * The origins a registered `redirect_uri` may sit at, as `scheme://host[:port]`. EMPTY means §37 is
   * configured but fenced shut: every registration refuses and says which flag opens it. There is no
   * "allow anything" spelling, deliberately.
   */
  readonly allowRedirectOrigins: readonly string[];
  readonly codeTtlMs?: number; // an authorization code's life (default 5 minutes)
  readonly maxClients?: number; // registrations this home will hold (default 64)
  readonly maxCodes?: number; // codes in flight (default 64)
  readonly maxTokensPerClient?: number; // live tokens one connector may hold (default 16)
  /** A monotonic millisecond source. Injectable so a rail can drive it; never Date.now(). */
  readonly monotonicNow?: () => number;
  /** Where a local fault goes. The CALLER never sees the detail — it names the home's path. */
  readonly onFault?: (message: string) => void;
}

const DEFAULTS = {
  codeTtlMs: 5 * 60_000,
  maxClients: 64,
  maxCodes: 64,
  maxTokensPerClient: 16,
};

const MAX_BODY = 16 * 1024; // a registration is a few hundred bytes; nothing here needs more
const MAX_URIS = 8;
const MAX_URI = 2048;

export interface OAuthDeps {
  readonly options: OAuthOptions;
  /** The public URL, already settled by `serve` — the SAME one the login doors read. */
  readonly publicUrl: string;
  /** §36's session, as a window rather than a copy. */
  readonly consent: ConsentAuth;
  /**
   * Give `actor` write standing in the ground: ONE operator-signed grant at the store entity. Throws
   * if the ground cannot be reached, and the caller must let that refuse the redemption — a token
   * handed out beside a grant that never landed is a door that opens onto nothing.
   */
  grantActor(actor: string): Promise<void>;
}

/**
 * What a presented bearer token names, or undefined. `{ actor }` — there is no other shape, and no
 * branch anywhere in this module produces a second one.
 *
 * THE FIELD HOLDS A SEED, NOT AN AUTHOR, and the two are one line apart in `OAuthGrant`. The name is
 * `actor` because that is what `TokenIdentity.actor` is called in http.ts, where a seed is what signs;
 * `identityFor` below is the ONE place a grant becomes one of these, so the crossing happens once and a
 * rail can see it.
 */
export interface ActorIdentity {
  readonly actor: string;
}

/**
 * A grant, as the token table's identity. THE ONLY producer of an `ActorIdentity` in this module.
 *
 * One line, and it earns its own function: `grant.actorSeed` (the secret that signs) and `grant.actor`
 * (the public author every delta carries) are both bare strings, so a swap between them type-checks
 * and would authenticate the connector as an author whose key nothing holds. Written once, it is one
 * line a rail covers rather than a line duplicated at each call site.
 */
export const identityFor = (grant: OAuthGrant): ActorIdentity => ({ actor: grant.actorSeed });

export interface OAuthDoors {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void>;
  /**
   * The identity a bearer token's digest names. Reads oauth.json ON THE ASK, never from a cache: a
   * `loam grant revoke` in another process must close the door on the very next request of this live
   * one, and a cached table would keep it open until a restart.
   *
   * It runs for any token the static and session tables declined — which is what an anonymous caller
   * presents — so it reads through `grantForToken`, which finds the digest first and derives one public
   * key at most. `readOAuthFile` would derive one per stored grant, per wrong guess.
   */
  identify(digestHex: string): ActorIdentity | undefined;
  /** The `WWW-Authenticate` value every refusal carries — blind to mount, verb and token. */
  readonly challenge: string;
}

// --- the discovery documents ------------------------------------------------------------------------

/**
 * The issuer, and the ONE place it is computed. Both well-known documents and the token endpoint's
 * `resource` check read this, so a connector configured from the document cannot be refused by the
 * door — a second normalisation is exactly how those two come to disagree.
 */
export function issuerFor(publicUrl: string): string {
  return publicUrl.replace(/\/+$/, "");
}

export function protectedResourceDocument(publicUrl: string): Record<string, unknown> {
  const issuer = issuerFor(publicUrl);
  return {
    resource: issuer,
    authorization_servers: [issuer],
    scopes_supported: [CONNECTOR_SCOPE],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerDocument(publicUrl: string): Record<string, unknown> {
  const issuer = issuerFor(publicUrl);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    // S256 and only S256. `plain` in this list would let a caller skip PKCE while the document still
    // said the word.
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [CONNECTOR_SCOPE],
  };
}

export const challengeFor = (publicUrl: string): string =>
  `Bearer resource_metadata="${issuerFor(publicUrl)}/.well-known/oauth-protected-resource"`;

// --- the redirect fence ------------------------------------------------------------------------------

/**
 * Is this a spelling of an origin that could ever be a redirect target? Applied to the CONFIGURED
 * allowlist at boot, so an operator's typo is a startup error rather than a silent hole, and applied
 * again to a submitted uri.
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
      `"${origin}" is not an origin — an origin is scheme://host[:port] and nothing else ` +
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
 * May this `redirect_uri` be REGISTERED? An absolute URL, at an allowlisted origin, with no fragment,
 * and percent-TRANSPARENT.
 *
 * The last one is not fussiness. The authorize step compares the caller's `redirect_uri` — which
 * arrives already percent-decoded from the query — against the registered string, byte for byte. A
 * registered uri whose own decoding differs from itself could therefore never be matched, or could be
 * matched by a second spelling. The mount table refuses a name for the same reason.
 */
export function redirectUriDefect(uri: string, allowed: readonly string[]): string | undefined {
  if (allowed.length === 0) {
    return (
      `this store registers no connectors: its operator has named no permitted redirect origin. ` +
      `Serve with --oauth-allow-redirect <origin> to open §37.`
    );
  }
  if (uri.length === 0 || uri.length > MAX_URI) return `a redirect_uri is 1..${MAX_URI} characters`;
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
    return (
      `"${uri}" is not at an origin this store permits. Its operator named ` +
      `[${allowed.join(", ")}] with --oauth-allow-redirect.`
    );
  }
  // THE SCHEME RULE IS CHECKED HERE TOO, not only against the configured list at boot. Membership in
  // the allowlist is not a licence: an entry that was admitted at boot is re-tested per uri, so the
  // https rule survives any future path that reaches this function with a list boot never vetted.
  // One rule, asserted at both ends — the boot check turns a typo into a startup error, and this turns
  // a bypass of that check into a refused registration.
  const originDefect = redirectOriginDefect(url.origin);
  if (originDefect !== undefined) return `"${uri}" is not a permitted target: ${originDefect}`;
  return undefined;
}

// --- the doors ---------------------------------------------------------------------------------------

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const opaque = (): string => randomBytes(32).toString("base64url");

/** A code in flight. Never written to disk: a restart kills every one, which is correct and cheap. */
interface AuthCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string; // the S256 code_challenge, base64url
  readonly expiresAt: number; // monotonic
  /**
   * The client's `generation` at the moment consent was given. `loam grant revoke` bumps it in
   * another process, and this map lives in this one — so without this a code minted a moment before a
   * revocation would mint a working token a moment after it, and the CLI's report would be false.
   */
  readonly generation: number;
}

/**
 * What a caller asked authorize for, once every field has been checked. There is no `scope` here on
 * purpose: §37 grants exactly one, so the caller's scope text governs nothing and carrying it would
 * put unvalidated caller text on the consent page and into the code for no gain. When a scope LIST
 * exists this gains a field, and the page's plain-words line becomes that list.
 */
interface AuthorizeRequest {
  readonly client: OAuthClient;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly state: string;
}

const readBody = (req: IncomingMessage): Promise<string | undefined> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        over = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? undefined : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
  });

const formFields = (body: string | undefined): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [k, v] of new URLSearchParams(body ?? "")) out.set(k, v);
  return out;
};

export function makeOAuthDoors(deps: OAuthDeps): OAuthDoors {
  const options = deps.options;
  const home = options.home;
  const allowed = [...options.allowRedirectOrigins];
  const codeTtlMs = options.codeTtlMs ?? DEFAULTS.codeTtlMs;
  const maxClients = options.maxClients ?? DEFAULTS.maxClients;
  const maxCodes = options.maxCodes ?? DEFAULTS.maxCodes;
  const maxTokensPerClient = options.maxTokensPerClient ?? DEFAULTS.maxTokensPerClient;
  const now = options.monotonicNow ?? ((): number => performance.now());
  const onFault = options.onFault ?? ((message: string): void => void message);
  const issuer = issuerFor(deps.publicUrl);

  const codes = new Map<string, AuthCode>();

  // ONE WRITER at a time, and it is what criterion (s) rests on. A redemption reads oauth.json, sees no
  // seed for this client, mints one, AWAITS the grant append, and writes the file. Two redemptions in
  // that window each mint a seed; the second write wins, and the first grant is left standing in the
  // ground with nobody holding its key. So every read-modify-write of the file runs in this chain, and
  // each one re-reads inside it rather than carrying a snapshot across the await.
  let writes: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => T | Promise<T>): Promise<T> => {
    const next = writes.then(work, work);
    // The chain must survive a rejection, or one failed write wedges every later one.
    writes = next.catch(() => undefined);
    return next;
  };

  // --- refusals ------------------------------------------------------------------------------------
  //
  // Every OAuth refusal is RFC 6749's `{ error, error_description }`, and NONE of them carries a
  // Location. Redirecting an error back to the client is permitted by the RFC and is how an OAuth
  // endpoint becomes an open redirect, because the earliest refusals are precisely the ones where the
  // redirect target has not been validated yet.

  // CORS RIDES THE COOKIELESS DOORS AND NOT THE COOKIE ONE, and the split is the whole rule.
  //
  // The preflight (http.ts) answers `OPTIONS` for every path with `allow-origin: *` before the router
  // sees it, so a door that then answered without the header would have a browser discard a response
  // its own preflight promised. The two well-known documents, registration and the token endpoint read
  // NO cookie — their authority is the code and the verifier, presented explicitly — so a wildcard
  // origin lends a caller nothing, exactly as it lends nothing on the data doors.
  //
  // `/oauth/authorize` is the exception and must stay one: it reads the session cookie, and a
  // cross-origin page must not be able to READ the consent page or the redirect it answers with.
  const jsonOut = (res: ServerResponse, status: number, body: unknown, cors = true): void => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      ...(cors ? { "access-control-allow-origin": "*" } : {}),
    });
    res.end(JSON.stringify(body));
  };

  const refuse = (
    res: ServerResponse,
    status: number,
    error: string,
    description: string,
    cors = true,
  ): void => {
    jsonOut(res, status, { error, error_description: description }, cors);
  };

  /** The authorize door's refusals: JSON, and never readable cross-origin. It reads a cookie. */
  const refuseConsent = (
    res: ServerResponse,
    status: number,
    error: string,
    description: string,
  ): void => {
    refuse(res, status, error, description, false);
  };

  const htmlOut = (res: ServerResponse, status: number, body: string, cookie?: string): void => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": CSP,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      ...(cookie === undefined ? {} : { "set-cookie": cookie }),
    });
    res.end(body);
  };

  /** A refusal a HUMAN reads, because it arrives in a browser tab rather than in a client's fetch. */
  const refusePage = (res: ServerResponse, status: number, reason: string): void => {
    htmlOut(
      res,
      status,
      page(
        "this store refused a connector",
        `<h1>This store refused the connection.</h1>
<p>${escapeHtml(reason)}</p>
<p>Nothing was granted. Close this tab.</p>`,
      ),
    );
  };

  /** The file, or a refusal from the CONSENT door — JSON, and never readable cross-origin. */
  const loadConsent = (res: ServerResponse): OAuthFile | undefined => {
    try {
      return readOAuthFile(home);
    } catch (err) {
      onFault(
        `the connector doors cannot read ${oauthPath(home)}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuseConsent(
        res,
        503,
        "temporarily_unavailable",
        "this store cannot read its connector records, so it grants nothing",
      );
      return undefined;
    }
  };

  /** The file, or a refusal. `undefined` means the door already answered. */
  const load = (res: ServerResponse, human: boolean): OAuthFile | undefined => {
    try {
      return readOAuthFile(home);
    } catch (err) {
      // The DETAIL names the home's path and the other connectors in it, so it goes to the operator's
      // own channel. The caller learns that this door will not answer, and nothing else.
      onFault(
        `the connector doors cannot read ${oauthPath(home)}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      if (human) {
        refusePage(res, 503, "This store cannot read its connector records, so it grants nothing.");
      } else {
        refuse(
          res,
          503,
          "temporarily_unavailable",
          "this store cannot read its connector records, so it registers and grants nothing",
        );
      }
      return undefined;
    }
  };

  // --- POST /oauth/register (RFC 7591) --------------------------------------------------------------

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
    // The name reaches the operator's TERMINAL through `loam grant list`, and this door takes no
    // credential — so a newline in it forges a row in the operator's only view of what is registered.
    // `clientNameDefect` is the one rule, shared with the file's own reader.
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
    // client holds both, and whichever one authorize later accepts is the one that matters.
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

    const outcome = await serialized(() => {
      let file: OAuthFile;
      try {
        file = readOAuthFile(home);
      } catch (err) {
        onFault(
          `the connector doors cannot read ${oauthPath(home)}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        return { kind: "unreadable" as const };
      }
      // AT THE CAP, EVICT THE OLDEST NEVER-APPROVED REGISTRATION rather than refuse.
      //
      // This door takes no credential, so a plain cap is a lockout: a stranger files `maxClients` junk
      // registrations and the real connector is refused forever, with no command that removes one. An
      // APPROVED connector is never evicted — the operator consented to it, and its seed signs deltas
      // the store holds — so the pressure falls only on registrations nobody has agreed to, and a
      // flood evicts its own earlier entries instead of the operator's connector.
      const approved = new Set(file.grants.map((g) => g.clientId));
      let clients = [...file.clients];
      while (clients.length >= maxClients) {
        const oldest = clients
          .filter((c) => !approved.has(c.clientId))
          .sort((a, b) => a.registeredAt - b.registeredAt)[0];
        if (oldest === undefined) return { kind: "full" as const };
        clients = clients.filter((c) => c.clientId !== oldest.clientId);
      }
      const client: OAuthClient = {
        clientId: `connector-${randomBytes(16).toString("hex")}`,
        clientName: name,
        redirectUris: checked,
        registeredAt: Date.now(),
        generation: 1,
      };
      writeOAuthFile(home, { ...file, clients: [...clients, client] });
      return { kind: "ok" as const, client };
    });

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
      // This endpoint takes no session by design, so a cap is the only thing between it and the disk.
      refuse(
        res,
        400,
        "invalid_client_metadata",
        `this store already holds ${maxClients} APPROVED connectors, which is all it will hold. ` +
          `\`loam grant list\` names them.`,
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

  // --- /oauth/authorize ----------------------------------------------------------------------------

  /**
   * Check everything about an authorize ask that does not depend on who is asking. Both the GET and the
   * POST run it: the consent page's hidden fields are caller text on the way back, so a POST that
   * trusted "the GET already checked this" would take whatever the field now says.
   */
  const checkAsk = (
    field: (name: string) => string,
    file: OAuthFile,
  ): { ok: true; ask: AuthorizeRequest } | { ok: false; reason: string } => {
    if (field("response_type") !== "code") {
      return { ok: false, reason: "this store answers only the authorization code flow" };
    }
    const client = clientFor(file, field("client_id"));
    if (client === undefined) {
      return { ok: false, reason: "no connector is registered here under that client_id" };
    }
    const redirectUri = field("redirect_uri");
    // EXACT match against one this client registered — and the allowlist again, because the allowlist
    // may have narrowed since the registration and the narrower answer is the current one.
    if (!client.redirectUris.includes(redirectUri)) {
      return {
        ok: false,
        reason: "that redirect target is not one this connector registered with this store",
      };
    }
    if (redirectUriDefect(redirectUri, allowed) !== undefined) {
      return {
        ok: false,
        reason: "that redirect target is no longer at an origin this store permits",
      };
    }
    if (field("code_challenge_method") !== "S256") {
      return { ok: false, reason: "this store requires PKCE with the S256 challenge method" };
    }
    const challenge = field("code_challenge");
    // 43 characters is base64url of 32 bytes, which S256 always is.
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      return { ok: false, reason: "the code_challenge is not an S256 challenge" };
    }
    return {
      ok: true,
      ask: { client, redirectUri, challenge, state: field("state") },
    };
  };

  const fromQuery =
    (params: URLSearchParams) =>
    (name: string): string =>
      params.get(name) ?? "";
  const fromBody =
    (body: Map<string, string>) =>
    (name: string): string =>
      body.get(name) ?? "";

  /**
   * The consent page. Every piece of caller text is escaped, and the redirect target shown is the
   * REGISTERED string — `ask.redirectUri` came out of `client.redirectUris`, which came out of the
   * file, not out of the query.
   */
  const consentPage = (ask: AuthorizeRequest, user: string, formToken: string): string => {
    const hidden = (name: string, value: string): string =>
      `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
    return page(
      "connect an application to a Loam store",
      `<h1>Connect ${escapeHtml(ask.client.clientName)}?</h1>
<p>You are signed in as <code>${escapeHtml(user)}</code>.</p>
<p>Its registered id is <code>${escapeHtml(ask.client.clientId)}</code>. A display name is whatever
the application asked to be called, and anyone can ask; the id is this store's own.</p>
<p><code>${escapeHtml(ask.client.clientName)}</code> asks to read the doors of this store and to
write claims to it. It will write under its own name, as its own author — not as you, and not as
this store's operator. Every claim it writes will say so.</p>
<p>Writing includes RETRACTING. An author this store has granted may strike a claim, and a reader
then stops seeing it — including claims you wrote yourself. It cannot change this store's law: it
cannot register a schema, add a user, order an erasure, or federate.</p>
<p>If you approve, this store sends the result to
<code>${escapeHtml(ask.redirectUri)}</code>.</p>
<p>You can withdraw this at any time with <code>loam grant revoke</code>.</p>
<form method="post" action="/oauth/authorize">
${hidden("form_token", formToken)}
${hidden("response_type", "code")}
${hidden("client_id", ask.client.clientId)}
${hidden("redirect_uri", ask.redirectUri)}
${hidden("code_challenge", ask.challenge)}
${hidden("code_challenge_method", "S256")}
${hidden("state", ask.state)}
${hidden("approve", "yes")}
<button type="submit">Approve</button>
</form>`,
    );
  };

  const getAuthorize = (req: IncomingMessage, res: ServerResponse, url: URL): void => {
    const file = load(res, true);
    if (file === undefined) return;
    // WHO IS ASKING comes first, and the reason is the login form: a caller with no session must reach
    // it whatever else is wrong with the query, or a connector's very first link is a dead end that
    // says "unknown client" to a human who has simply not signed in yet.
    const who = deps.consent.who(req);
    if (who.kind === "unreachable") {
      refusePage(res, 503, "This store's ground is not reachable, so this page cannot load.");
      return;
    }
    if (who.kind === "none") {
      // THE AUTHORIZE QUERY DOES NOT SURVIVE THE LOGIN. `/login` answers its own signed-in page, so the
      // `client_id` and the challenge are gone by then and the operator lands somewhere else. A
      // `return_to` would carry them, and would be a new caller-supplied destination on the one door
      // whose whole job is not to have one — so the page SAYS what to do instead of redirecting.
      const prompt = deps.consent.loginPrompt(
        req,
        "Sign in first. Then open the application's connect link again — this page could not keep it.",
      );
      htmlOut(res, 200, prompt.body, prompt.cookie);
      return;
    }
    if (who.kind === "not-operator") {
      refusePage(
        res,
        403,
        `Connecting an application is the operator's decision, and ${who.user} does not hold the ` +
          `operator role on this store.`,
      );
      return;
    }
    const checked = checkAsk(fromQuery(url.searchParams), file);
    if (!checked.ok) {
      refusePage(res, 400, checked.reason);
      return;
    }
    htmlOut(res, 200, consentPage(checked.ask, who.user, who.formToken));
  };

  const postAuthorize = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // The two same-origin signals BEFORE the body: a cross-site POST must not be able to make this
    // door do work, and it must not learn anything from how long the refusal took.
    if (!deps.consent.fromThisPage(req)) {
      refuseConsent(
        res,
        403,
        "access_denied",
        "this request did not come from this store's own page, so it is refused",
      );
      return;
    }
    const body = formFields(await readBody(req));
    const who = deps.consent.who(req);
    if (who.kind === "unreachable") {
      refuseConsent(res, 503, "temporarily_unavailable", "this store's ground is not reachable");
      return;
    }
    if (who.kind === "none") {
      refuseConsent(res, 401, "access_denied", "no live session is presented here");
      return;
    }
    if (!sameSecret(body.get("form_token") ?? "", who.formToken)) {
      refuseConsent(
        res,
        403,
        "access_denied",
        "this request did not come from this store's own page, so it is refused",
      );
      return;
    }
    if (who.kind === "not-operator") {
      refuseConsent(
        res,
        403,
        "access_denied",
        `connecting an application is the operator's decision, and ${who.user} does not hold the ` +
          `operator role on this store`,
      );
      return;
    }
    // SILENCE IS NOT CONSENT. The page's own form always carries this field.
    if (body.get("approve") !== "yes") {
      refuseConsent(res, 400, "access_denied", "nothing here was approved");
      return;
    }
    const file = loadConsent(res);
    if (file === undefined) return;
    const checked = checkAsk(fromBody(body), file);
    if (!checked.ok) {
      refuseConsent(res, 400, "invalid_request", checked.reason);
      return;
    }
    const ask = checked.ask;

    // Codes are bounded like everything else here. Sweep the lapsed ones first, so the cap counts what
    // is actually in flight rather than everything ever minted.
    const moment = now();
    for (const [code, held] of codes) if (held.expiresAt <= moment) codes.delete(code);
    if (codes.size >= maxCodes) {
      refuseConsent(
        res,
        503,
        "temporarily_unavailable",
        "this store is holding all the authorization codes it can — try again in a few minutes",
      );
      return;
    }
    const code = opaque();
    codes.set(code, {
      clientId: ask.client.clientId,
      redirectUri: ask.redirectUri,
      challenge: ask.challenge,
      expiresAt: moment + codeTtlMs,
      generation: ask.client.generation,
    });
    // THE ONE LOCATION THIS MODULE SENDS, and it is a string that came out of the file after passing
    // both fences. `ask.state` is caller text, and URLSearchParams is what keeps it from becoming a
    // second parameter.
    const target = new URL(ask.redirectUri);
    target.searchParams.set("code", code);
    if (ask.state !== "") target.searchParams.set("state", ask.state);
    res.writeHead(302, {
      location: target.toString(),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end();
  };

  // --- POST /oauth/token ---------------------------------------------------------------------------

  /**
   * THE MINT PATH, and its return type is the security property: an `{ actor }` and nothing else. There
   * is no branch here that produces `{ operator: true }`, and no input to any door above can add one.
   */
  const mintToken = async (
    clientId: string,
    generation: number,
  ): Promise<
    | { kind: "ok"; token: string }
    | { kind: "unreadable" }
    | { kind: "full" }
    | { kind: "gone" }
    | { kind: "revoked" }
  > =>
    serialized(async () => {
      const read = (): OAuthFile => readOAuthFile(home);
      let file: OAuthFile;
      try {
        file = read();
      } catch (err) {
        onFault(
          `the connector doors cannot read ${oauthPath(home)}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        return { kind: "unreadable" as const };
      }
      // Re-read INSIDE the chain: a snapshot taken before the await is how two concurrent
      // first-grants each mint a seed.
      const client = clientFor(file, clientId);
      if (client === undefined) return { kind: "gone" as const };
      // A REVOCATION LANDED AFTER CONSENT WAS GIVEN. The consent is stale, so the code is dead.
      if (client.generation !== generation) return { kind: "revoked" as const };
      if (file.tokens.filter((t) => t.clientId === clientId).length >= maxTokensPerClient) {
        return { kind: "full" as const };
      }

      // THE SEED IS RECORDED BEFORE THE GRANT IS APPENDED, and the order is the recovery story.
      //
      // Appending first and recording after leaves the unrecoverable gap: a write that fails between
      // the two puts a grant in the ground for a key nobody holds, and the NEXT redemption, finding no
      // seed, mints a second one. This way round the file is the single answer to "which seed is this
      // connector's", `standing: false` names the one gap that remains, and the retry below closes it
      // with the SAME seed.
      let grant = grantFor(file, clientId);
      if (grant === undefined) {
        const actorSeed = randomBytes(32).toString("hex");
        grant = {
          clientId,
          actorSeed,
          actor: authorForSeed(actorSeed),
          grantedAt: Date.now(),
          standing: false,
        };
        writeOAuthFile(home, { ...file, grants: [...file.grants, grant] });
        file = read();
      }
      if (!grant.standing) {
        // A throw here refuses the redemption and mints no token: a credential for an identity with no
        // standing authenticates and then cannot write, which is a door reporting a success it did not
        // achieve. The seed survives, flagged, and the next redemption arrives here again.
        await deps.grantActor(grant.actor);
        grant = { ...grant, standing: true };
      }
      const token = opaque();
      const standing = grant;
      writeOAuthFile(home, {
        ...file,
        grants: [...file.grants.filter((g) => g.clientId !== clientId), standing],
        tokens: [...file.tokens, { digest: sha(token), clientId, issuedAt: Date.now() }],
      });
      return { kind: "ok" as const, token };
    });

  const postToken = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = formFields(await readBody(req));
    // RFC 8707: a resource indicator, if sent, must name THIS resource. Read from `issuer`, the one
    // value the AS document advertises.
    const resource = body.get("resource") ?? "";
    if (resource !== "" && issuerFor(resource) !== issuer) {
      refuse(res, 400, "invalid_target", "that resource is not the one this store answers for");
      return;
    }
    if (body.get("grant_type") !== "authorization_code") {
      refuse(res, 400, "unsupported_grant_type", "this store answers authorization_code only");
      return;
    }
    const code = body.get("code") ?? "";
    // BURN FIRST, VALIDATE AFTER. A code that survived a failed attempt lets whoever holds it try
    // verifiers until one works, and the legitimate client's own redemption a moment later is the
    // only tell — which nobody sees.
    const held = codes.get(code);
    codes.delete(code);
    const bad = (why: string): void => {
      refuse(res, 400, "invalid_grant", why);
    };
    if (held === undefined) {
      bad("that code is not one this store is holding");
      return;
    }
    if (held.expiresAt <= now()) {
      bad("that code has expired");
      return;
    }
    // Bound to BOTH, per criterion (o): the client it was minted for and the target it was minted
    // against. Either one alone leaves the other open.
    if (body.get("client_id") !== held.clientId) {
      bad("that code was not minted for this client");
      return;
    }
    if (body.get("redirect_uri") !== held.redirectUri) {
      bad("that code was minted against a different redirect target");
      return;
    }
    const verifier = body.get("code_verifier") ?? "";
    const computed = createHash("sha256").update(verifier).digest("base64url");
    const left = Buffer.from(computed, "utf8");
    const right = Buffer.from(held.challenge, "utf8");
    if (verifier === "" || left.length !== right.length || !timingSafeEqual(left, right)) {
      bad("the code_verifier does not match the challenge this code was minted against");
      return;
    }

    const minted = await mintToken(held.clientId, held.generation);
    if (minted.kind === "unreadable") {
      refuse(
        res,
        503,
        "temporarily_unavailable",
        "this store cannot read its connector records, so it mints nothing",
      );
      return;
    }
    if (minted.kind === "gone") {
      bad("that client is no longer registered here");
      return;
    }
    if (minted.kind === "revoked") {
      bad("this connector was revoked after that code was issued, so the code is dead");
      return;
    }
    if (minted.kind === "full") {
      refuse(
        res,
        400,
        "invalid_grant",
        `this connector already holds ${maxTokensPerClient} tokens — revoke it and connect again`,
      );
      return;
    }
    jsonOut(res, 200, {
      access_token: minted.token,
      token_type: "Bearer",
      scope: CONNECTOR_SCOPE,
    });
  };

  // --- the router ------------------------------------------------------------------------------------

  const PATHS = new Set([
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
    "/oauth/register",
    "/oauth/authorize",
    "/oauth/token",
  ]);

  const route = async (
    pathname: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    if (pathname === "/.well-known/oauth-protected-resource") {
      if (req.method !== "GET") {
        refuse(res, 405, "invalid_request", "this document answers GET");
        return;
      }
      jsonOut(res, 200, protectedResourceDocument(deps.publicUrl));
      return;
    }
    if (pathname === "/.well-known/oauth-authorization-server") {
      if (req.method !== "GET") {
        refuse(res, 405, "invalid_request", "this document answers GET");
        return;
      }
      jsonOut(res, 200, authorizationServerDocument(deps.publicUrl));
      return;
    }
    if (pathname === "/oauth/register") {
      if (req.method !== "POST") {
        refuse(res, 405, "invalid_request", "registration answers POST");
        return;
      }
      return postRegister(req, res);
    }
    if (pathname === "/oauth/authorize") {
      const url = new URL(req.url ?? "/", "http://loam.invalid");
      if (req.method === "GET") {
        getAuthorize(req, res, url);
        return;
      }
      if (req.method === "POST") return postAuthorize(req, res);
      refuse(res, 405, "invalid_request", "authorize answers GET and POST");
      return;
    }
    if (req.method !== "POST") {
      refuse(res, 405, "invalid_request", "the token endpoint answers POST");
      return;
    }
    return postToken(req, res);
  };

  return {
    challenge: challengeFor(deps.publicUrl),
    owns: (pathname) => PATHS.has(pathname),
    identify(digestHex) {
      let grant;
      try {
        grant = grantForToken(home, digestHex);
      } catch (err) {
        // CANNOT DECIDE IS NOT "THIS TOKEN IS GOOD". Refusing is the only safe answer, and the operator
        // is told rather than left with a door that mysteriously stopped opening.
        onFault(
          `the connector doors cannot read ${oauthPath(home)}, so every connector token is refused: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        return undefined;
      }
      // Undefined covers both "no such token" and "a token whose grant is gone". The second should not
      // be possible — revocation removes tokens and keeps grants — and failing closed is right anyway.
      return grant === undefined ? undefined : identityFor(grant);
    },
    async handle(pathname, req, res) {
      // ONE GUARD OVER ALL FIVE DOORS, for the reason session.ts states: a fault nobody anticipated
      // must not escape to the server's generic handler, which answers 500 with the message — and
      // these messages carry the home's absolute path.
      try {
        await route(pathname, req, res);
      } catch (err) {
        onFault(
          `a connector door failed answering ${pathname}: ` +
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

export { EMPTY_OAUTH };
