// The shared world §37's rails grow from: a §36 home with a user, a store with one writable schema,
// and a live server with BOTH the login doors and the OAuth doors open.
//
// Every home here comes from mkdtempSync (via `makeHome`) and is removed by the test that made it.
// Nothing here reads or writes a real ~/.loam.
//
// The helpers are LOW-LEVEL for the same reason §36's are: a third of §37's criteria are about a
// request that is missing one field, carrying one foreign header, or replaying one spent code. A
// single `connect()` that always sent a well-formed flow would hide exactly those states.
//
// `test/server/user-fixture.ts` is imported rather than extended — it is a landed rail, and §37 owes
// it no edits.

import { createHash, randomBytes } from "node:crypto";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { readSeed, storePath } from "../../src/cli/config.js";
import { type OAuthOptions } from "../../src/server/oauth.js";
import { type UserDoorOptions } from "../../src/server/session.js";
import { SESSION_COOKIE, TEST_SCRYPT } from "./user-fixture.js";

/** The origin every rail registers a redirect at — claude.ai's own, spelled as it spells it. */
export const CLAUDE_ORIGIN = "https://claude.ai";
export const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";

/** A second allowlisted origin, so a rail can tell "in the allowlist" from "this one origin". */
export const OTHER_ORIGIN = "https://example.test";

export interface ServedOAuth {
  readonly handle: ServerHandle;
  readonly gateway: Gateway;
  readonly base: string;
  close(): Promise<void>;
}

export interface ServeOAuthOptions {
  readonly oauth?: Partial<OAuthOptions>;
  readonly users?: Partial<UserDoorOptions>;
  readonly tokens?: Record<string, { actor?: string; operator?: true }>;
  readonly prepare?: (gateway: Gateway) => void | Promise<void>;
}

/**
 * Serve the home's store with the login doors AND the OAuth doors open.
 *
 * `publicUrl` is deliberately left to the caller: the bound URL is the default, and criterion (d) is
 * about a CONFIGURED one, so the rail that tests it must be able to name a different address than the
 * one it dials.
 */
export async function serveOAuth(home: string, opts: ServeOAuthOptions = {}): Promise<ServedOAuth> {
  const gateway = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
  await opts.prepare?.(gateway);
  const handle = await serve({
    mounts: { default: gateway },
    tokens: opts.tokens ?? { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default", scrypt: TEST_SCRYPT, ...opts.users },
    oauth: {
      home,
      allowRedirectOrigins: [CLAUDE_ORIGIN, OTHER_ORIGIN],
      ...opts.oauth,
    },
  });
  let closed = false;
  return {
    handle,
    gateway,
    base: handle.url,
    async close() {
      if (closed) return;
      closed = true;
      await handle.close();
      await gateway.close();
    },
  };
}

// --- PKCE ------------------------------------------------------------------------------------------

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
}

/** A real S256 pair. Computed, never fixtured: a hard-coded challenge would not detect a wrong hash. */
export function pkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// --- the doors -------------------------------------------------------------------------------------

export interface RegisteredClient {
  readonly clientId: string;
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** POST /oauth/register with an arbitrary body — a rail may send a malformed one on purpose. */
export async function registerRaw(base: string, body: unknown): Promise<RegisteredClient> {
  const res = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as Record<string, unknown>;
  return {
    clientId: typeof parsed["client_id"] === "string" ? parsed["client_id"] : "",
    status: res.status,
    body: parsed,
  };
}

/** The registration claude.ai sends: one redirect uri and a display name. */
export function register(
  base: string,
  opts: { name?: string; redirectUris?: readonly string[] } = {},
): Promise<RegisteredClient> {
  return registerRaw(base, {
    client_name: opts.name ?? "Claude",
    redirect_uris: opts.redirectUris ?? [CLAUDE_REDIRECT],
  });
}

/**
 * Every field is `string | undefined` rather than optional, so a rail may DROP one explicitly. Half of
 * §37's authorize criteria are about a query with a field missing, and `exactOptionalPropertyTypes`
 * would otherwise refuse to spell that.
 */
export type AuthorizeParams = {
  readonly client_id?: string | undefined;
  readonly redirect_uri?: string | undefined;
  readonly response_type?: string | undefined;
  readonly code_challenge?: string | undefined;
  readonly code_challenge_method?: string | undefined;
  readonly state?: string | undefined;
  readonly scope?: string | undefined;
  readonly resource?: string | undefined;
};

/** The fields a params object actually carries — a dropped one is absent, never an empty string. */
export const paramEntries = (params: Record<string, string | undefined>): [string, string][] =>
  Object.entries(params).filter((pair): pair is [string, string] => pair[1] !== undefined);

/**
 * The authorize query as claude.ai builds it. Every field is overridable and any of them may be
 * dropped with an explicit `null`, because a missing field is a state four criteria reach.
 */
export function authorizeQuery(params: AuthorizeParams): string {
  const out = new URLSearchParams();
  for (const [key, value] of paramEntries(params)) out.set(key, value);
  return out.toString();
}

export const wellFormedAuthorize = (clientId: string, challenge: string): AuthorizeParams => ({
  response_type: "code",
  client_id: clientId,
  redirect_uri: CLAUDE_REDIRECT,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "opaque-state-value",
  scope: "loam.connector",
});

/** GET /oauth/authorize, with or without a session cookie. */
export async function getAuthorize(
  base: string,
  params: AuthorizeParams,
  cookie?: string,
): Promise<{ res: Response; body: string }> {
  const res = await fetch(`${base}/oauth/authorize?${authorizeQuery(params)}`, {
    redirect: "manual",
    headers: cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${cookie}` },
  });
  return { res, body: await res.text() };
}

const FORM_TOKEN = /name="form_token" value="([^"]+)"/;
const HIDDEN = (name: string): RegExp => new RegExp(`name="${name}" value="([^"]*)"`);

/** The consent page's own hidden field, whatever it holds — how a rail reads what the page will POST. */
export const hiddenField = (page: string, name: string): string | undefined =>
  HIDDEN(name).exec(page)?.[1];

export const formTokenIn = (page: string): string => FORM_TOKEN.exec(page)?.[1] ?? "";

export interface ApproveOptions {
  readonly cookie?: string;
  /** Explicitly `undefined` sends no form token at all. */
  readonly formToken?: string | undefined;
  /** Omit for the browser-shaped default (`same-origin`); null sends none. */
  readonly secFetchSite?: string | null;
  readonly origin?: string;
  readonly fields?: Record<string, string>;
}

/** POST /oauth/authorize — the approval the consent page's button sends. */
export function approve(
  base: string,
  params: AuthorizeParams,
  opts: ApproveOptions = {},
): Promise<Response> {
  const body = new URLSearchParams();
  for (const [key, value] of paramEntries(params)) body.set(key, value);
  body.set("approve", "yes");
  if (opts.formToken !== undefined) body.set("form_token", opts.formToken);
  for (const [key, value] of Object.entries(opts.fields ?? {})) body.set(key, value);
  return fetch(`${base}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(opts.cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${opts.cookie}` }),
      ...(opts.secFetchSite === null
        ? {}
        : { "sec-fetch-site": opts.secFetchSite ?? "same-origin" }),
      ...(opts.origin === undefined ? {} : { origin: opts.origin }),
    },
    body: body.toString(),
  });
}

/** The `code` a 302 to the redirect uri carries, or undefined. */
export function codeFrom(res: Response): string | undefined {
  const location = res.headers.get("location");
  if (location === null) return undefined;
  return new URL(location).searchParams.get("code") ?? undefined;
}

/** Same reason as `AuthorizeParams`: a rail must be able to send a body with a field missing. */
export type TokenBody = {
  readonly grant_type?: string | undefined;
  readonly code?: string | undefined;
  readonly redirect_uri?: string | undefined;
  readonly client_id?: string | undefined;
  readonly code_verifier?: string | undefined;
  readonly resource?: string | undefined;
};

/** POST /oauth/token, form-encoded as RFC 6749 says. */
export async function redeem(
  base: string,
  fields: TokenBody,
): Promise<{ res: Response; body: Record<string, unknown> }> {
  const body = new URLSearchParams();
  for (const [key, value] of paramEntries(fields)) body.set(key, value);
  const res = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text };
  }
  return { res, body: parsed };
}

/**
 * Register, authorize with a live session, approve, and redeem: the whole flow, as one call, for the
 * rails whose subject is what happens AFTER it. The rails whose subject is the flow itself walk the
 * four steps by hand.
 */
export async function fullFlow(
  base: string,
  session: { cookie: string },
  opts: { name?: string; redirectUri?: string } = {},
): Promise<{ clientId: string; token: string; actor: string }> {
  const client = await register(base, {
    ...(opts.name === undefined ? {} : { name: opts.name }),
    redirectUris: [opts.redirectUri ?? CLAUDE_REDIRECT],
  });
  if (client.status !== 201) throw new Error(`the fixture could not register: ${client.status}`);
  const secret = pkce();
  const params = {
    ...wellFormedAuthorize(client.clientId, secret.challenge),
    ...(opts.redirectUri === undefined ? {} : { redirect_uri: opts.redirectUri }),
  };
  const page = await getAuthorize(base, params, session.cookie);
  if (page.res.status !== 200) {
    throw new Error(`the fixture could not reach consent: ${page.res.status}`);
  }
  const approved = await approve(base, params, {
    cookie: session.cookie,
    formToken: formTokenIn(page.body),
  });
  const code = codeFrom(approved);
  if (code === undefined) throw new Error(`the fixture got no code: ${approved.status}`);
  const redeemed = await redeem(base, {
    grant_type: "authorization_code",
    code,
    redirect_uri: params.redirect_uri,
    client_id: client.clientId,
    code_verifier: secret.verifier,
  });
  const token = redeemed.body["access_token"];
  if (typeof token !== "string") {
    throw new Error(
      `the fixture got no token: ${redeemed.res.status} ${JSON.stringify(redeemed.body)}`,
    );
  }
  return { clientId: client.clientId, token, actor: "" };
}

export const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

/** POST a GraphQL document at the default mount with whatever headers a rail wants to send. */
export const gql = (
  base: string,
  query: string,
  headers: Record<string, string> = {},
): Promise<Response> =>
  fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ query }),
  });

/** POST an MCP JSON-RPC frame at the default mount. */
export const mcp = (
  base: string,
  frame: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> =>
  fetch(`${base}/default/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(frame),
  });
