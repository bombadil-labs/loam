// The served store the §58 door rails share: two login users (ada, bea) with no container or
// seed yet, one registered connector, the token exchange OPEN, and the Plant lens registered so
// the typed doors have something to write. The shape `consent-exchange.test.ts` stands up — that
// file is frozen; this module is the common ground for the rails that came after it.
//
// Erasure standing rule: every store here is the caller's own mkdtemp/memory fixture; `closeAll`
// tears down what `connectionServer` made and nothing else.

import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { authorForSeed, signClaims, type Claims, type Delta } from "@bombadil/rhizomatic";
import { initHome } from "../../src/cli/config.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import {
  EMPTY_OAUTH,
  readOAuthFile,
  writeOAuthFile,
  type OAuthGrant,
} from "../../src/server/oauth-file.js";
import { AUTHORIZE_PATH } from "../../src/server/oauth.js";
import { SAME_ORIGIN, signIn } from "./session-fixture.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

export const OPERATOR_SEED = "0e".repeat(32);
export const OPERATOR = authorForSeed(OPERATOR_SEED);
export const PASSWORD = "correct horse";
export const CLIENT_ID = "connector-fixed-0001";
export const CLIENT_NAME = "Example Connector";
export const REDIRECT = "https://app.example/cb";
const ALLOW_ORIGIN = "https://app.example";
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };

const b64url = (buf: Buffer): string => buf.toString("base64url");
export const pkce = (): { verifier: string; challenge: string } => {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

const homes: string[] = [];
const handles: ServerHandle[] = [];
/** For a rail's afterEach: close every server and remove every home this module made. */
export async function closeAll(): Promise<void> {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
}

export interface ConnectionServer {
  readonly base: string;
  readonly usersHome: string;
  readonly connectorsHome: string;
  readonly gateway: Gateway;
  readonly faults: string[];
}

export async function connectionServer(
  opts: { primary?: MemoryBackend; tokens?: Record<string, { actor: string }> } = {},
): Promise<ConnectionServer> {
  const gateway = await Gateway.open(opts.primary ?? new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  for (const name of ["ada", "bea"]) {
    await op(userClaims(name, OPERATOR, ts++));
    await op(roleClaims(name, "actor", OPERATOR, ts++));
  }
  // PUBLISHED, not merely registered in memory: the REST door serves declared versions only.
  await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, undefined, undefined, [
    ...PLANT_WRITABLE,
  ]);
  const usersHome = mkdtempSync(join(tmpdir(), "loam-s1b2-users-"));
  const connectorsHome = mkdtempSync(join(tmpdir(), "loam-s1b2-connectors-"));
  homes.push(usersHome, connectorsHome);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(usersHome, { version: 1, users: { ada: hash, bea: hash } });
  initHome(connectorsHome, OPERATOR_SEED);
  writeOAuthFile(connectorsHome, {
    ...EMPTY_OAUTH,
    clients: [
      {
        clientId: CLIENT_ID,
        clientName: CLIENT_NAME,
        redirectUris: [REDIRECT],
        registeredAt: 1,
        generation: 1,
      },
    ],
  });
  const faults: string[] = [];
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true }, ...(opts.tokens ?? {}) },
    port: 0,
    host: "127.0.0.1",
    publicUrl: "https://store.example",
    connectors: {
      home: connectorsHome,
      allowRedirectOrigins: [ALLOW_ORIGIN],
      onFault: (m) => faults.push(m),
    },
    users: { home: usersHome, mount: "default", onFault: (m) => faults.push(m) },
  });
  handles.push(handle);
  return { base: handle.url, usersHome, connectorsHome, gateway, faults };
}

const fieldOf = (html: string, name: string): string =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "";

/** Sign in as `user`, approve the connector with `bind`, and return the code. */
export async function consent(
  base: string,
  user: string,
  challenge: string,
  bind: Record<string, string>,
): Promise<{ code: string; status: number }> {
  const session = await signIn(base, user, PASSWORD);
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state: "st-1",
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const page = await fetch(`${base}${AUTHORIZE_PATH}?${query}`, {
    headers: { cookie: `${SESSION_COOKIE}=${session}` },
    redirect: "manual",
  });
  const html = await page.text();
  const res = await fetch(`${base}${AUTHORIZE_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${session}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({
      form_token: fieldOf(html, "form_token"),
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state: "st-1",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...bind,
    }).toString(),
    redirect: "manual",
  });
  const location = res.headers.get("location");
  const code = location === null ? "" : (new URL(location).searchParams.get("code") ?? "");
  return { code, status: res.status };
}

export async function redeem(base: string, code: string, verifier: string): Promise<Response> {
  return fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    }).toString(),
  });
}

/** The whole path for one person into one leaf: consent, redeem, and the bearer token. */
export async function connect(base: string, user: string, leaf: string): Promise<string> {
  const p = pkce();
  const { code, status } = await consent(base, user, p.challenge, { bind_new: leaf });
  expect(status).toBe(302);
  const res = await redeem(base, code, p.verifier);
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** The pair's grant record, as the exchange left it. */
export const grantOf = (connectorsHome: string, user: string): OAuthGrant => {
  const grant = readOAuthFile(connectorsHome).grants.find((g) => g.user === user);
  if (grant === undefined) throw new Error(`no grant for ${user}`);
  return grant;
};

/** The live inbox pool behind a grant — throws when it is not attached, which is its own finding. */
export const poolOf = (gateway: Gateway, inbox: string): Gateway => {
  const pool = gateway.connectionInboxes.get(inbox)?.gateway;
  if (pool === undefined) throw new Error(`the inbox ${inbox} is not attached`);
  return pool;
};

export const graphql = (
  base: string,
  token: string | undefined,
  query: string,
): Promise<Response> =>
  fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ query }),
  });

export const mutateHeight = (base: string, token: string, height: number): Promise<Response> =>
  graphql(base, token, `mutation { plant(entity: "${FERN}", height: ${height}) { height } }`);

/** What a reader through the door resolves for the fern's height: a number, null, or an error. */
export async function heightVia(base: string, token: string | undefined): Promise<unknown> {
  const res = await graphql(base, token, `{ plant(entity: "${FERN}") { height } }`);
  const body = (await res.json()) as { data?: { plant?: { height?: unknown } }; errors?: string[] };
  if (body.errors !== undefined) return { errors: body.errors };
  return body.data?.plant?.height ?? null;
}

/** Every height claim of `height` a reactor holds — the delta level. */
export const heightDeltas = (gw: Gateway, height: number): Delta[] =>
  [...gw.reactor.snapshot()].filter(
    (d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === "height",
      ) &&
      d.claims.pointers.some(
        (p) => p.role === "value" && p.target.kind === "primitive" && p.target.value === height,
      ),
  );

/** A signed Plant height claim by `seed`, the shape the typed door mints. */
export const heightClaim = (seed: string, height: number, timestamp: number): Delta =>
  signClaims(
    {
      timestamp,
      author: authorForSeed(seed),
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "height" } } },
        { role: "value", target: { kind: "primitive", value: height } },
      ],
    },
    seed,
  );

export const whoami = (base: string, token: string): Promise<Response> =>
  fetch(`${base}/default/whoami`, { headers: { authorization: `Bearer ${token}` } });
