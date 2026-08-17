// T176 — the three OAuth doors answer their BARE paths too: /register, /authorize, /token.
//
// A real MCP connector composes `{authorization_server}/register` rather than reading
// `registration_endpoint` out of the RFC 8414 document. That path was unrouted, so it fell through
// every server-level door into the mount router, where `register` read as a MOUNT NAME and drew the
// uniform 401. Registration failed and the connector died before any human saw a consent page.
//
// WHAT THIS FILE ASSERTS AT BOTH LEVELS. The three aliases reach their doors (the door's own answer,
// never a mount refusal) AND the door's effect is real — the register rail reads the STORED client
// back out of oauth.json rather than trusting a 201.
//
// THE ORACLE RAIL IS THE LOAD-BEARING ONE. The obvious fix for an unrouted path is a 404, and a 404
// here would reopen the mount-existence oracle SPEC §12/T78 closed on purpose: a prober who can tell
// `unrouted` from `mount exists, needs a token` reads the whole mount table off the difference. So a
// path that is NOT one of the three is compared BYTE-FOR-BYTE against a real mount's unauthenticated
// refusal — response against response, never against a literal, so the rail cannot drift green while
// both answers change together. That rail fails if this fix is ever widened into a 404.
//
// What this file deliberately does NOT assert, and which rail closes each gap:
//   - Registration validation, consent's redirect fence, redemption, PKCE, revocation. Those are
//     phases 13-15's own frozen rail files (T134, T135, T136, T148, T167). This file asserts only
//     that a bare path reaches the SAME door, and lets that door's rails speak for its behaviour.
//   - The opt-in negative (publicUrl set, connectors absent). The aliases are declared inside the
//     same `registration !== undefined` guard as `/oauth/register`, so phase 12's rail still owns it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { initHome } from "../../src/cli/config.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import { clientFor, readOAuthFile } from "../../src/server/oauth-file.js";
import { SAME_ORIGIN, signIn } from "../helpers/session-fixture.js";

vi.setConfig({ testTimeout: 20000 }); // real listening servers

const OPERATOR_SEED = "17".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const ALLOW_ORIGIN = "https://app.example";
const REDIRECT = `${ALLOW_ORIGIN}/cb`;
const MOUNT = "default";

// A PKCE pair a real client would send: 43..128 unreserved characters, S256.
const VERIFIER = randomBytes(32).toString("base64url");
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const homes: string[] = [];
const handles: ServerHandle[] = [];
const gateways: Gateway[] = [];

afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (gateways.length > 0) await gateways.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

interface Served {
  readonly base: string;
  readonly home: string;
}

/**
 * A live serve() with all three §37 doors open: `publicUrl` + `connectors` builds the register door,
 * and `users` beside `connectors` is what makes the consent and token doors exist at all.
 */
async function serveConnectorDoors(): Promise<Served> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  gateways.push(gateway);
  let ts = 9001;
  await gateway.append([signClaims(userClaims("myk", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, ts++), OPERATOR_SEED)]);

  const home = mkdtempSync(join(tmpdir(), "loam-bare-paths-"));
  homes.push(home);
  // The token door signs a connector's write grant with <home>/operator.seed and FAILS CLOSED if it
  // cannot read one — an unseeded home would leave `/oauth/token` unrouted and every token rail here
  // would then pass for the wrong reason.
  initHome(home, OPERATOR_SEED);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });

  const handle = await serve({
    mounts: { [MOUNT]: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    publicUrl: "https://store.example",
    connectors: { home, allowRedirectOrigins: [ALLOW_ORIGIN] },
    users: { home, mount: MOUNT },
  });
  handles.push(handle);
  return { base: handle.url, home };
}

/** POST a dynamic registration at `path` — the bare alias or the documented spelling. */
const register = async (base: string, path: string): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Example Connector", redirect_uris: [REDIRECT] }),
  });

/** A registered client_id, minted through the DOCUMENTED door so an alias rail depends on nothing new. */
async function registeredClient(base: string): Promise<string> {
  const res = await register(base, "/oauth/register");
  expect(res.status).toBe(201);
  return ((await res.json()) as Record<string, unknown>)["client_id"] as string;
}

const authorizeQuery = (clientId: string): string =>
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "opaque-state",
  }).toString();

/** POST a redemption whose code is not one this store ever minted. */
const redeem = async (base: string, path: string, clientId: string): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...SAME_ORIGIN },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: randomBytes(32).toString("base64url"),
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    }).toString(),
  });

/** A response's identity for a byte-for-byte comparison: status, every header but `date`, the body. */
interface Fingerprint {
  readonly status: number;
  readonly headers: [string, string][];
  readonly body: string;
}
async function fingerprint(res: Response): Promise<Fingerprint> {
  const headers = [...res.headers]
    .filter(([name]) => name !== "date")
    .sort(([a], [b]) => a.localeCompare(b));
  return { status: res.status, headers, body: await res.text() };
}

describe("the bare OAuth paths a real MCP client composes", () => {
  it("POST /register registers a connector, and the client it minted is IN oauth.json", async () => {
    const { base, home } = await serveConnectorDoors();

    const res = await register(base, "/register");
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    const clientId = body["client_id"] as string;
    expect(clientId).toMatch(/^connector-[0-9a-f]{32}$/);

    // The object level, not the status: the door's EFFECT, read back out of the file it wrote.
    const stored = clientFor(readOAuthFile(home), clientId);
    expect(stored).toBeDefined();
    expect(stored!.clientName).toBe("Example Connector");
    expect(stored!.redirectUris).toEqual([REDIRECT]);
  });

  it("GET /authorize reaches the consent door — the login form with no session, the consent page with one", async () => {
    const { base } = await serveConnectorDoors();
    const clientId = await registeredClient(base);
    const query = authorizeQuery(clientId);

    // No session: the consent door's own answer is the login form, 200 with a form token.
    const anonymous = await fetch(`${base}/authorize?${query}`, { redirect: "manual" });
    expect(anonymous.status).toBe(200);
    const form = await anonymous.text();
    expect(form).toContain('action="/login"');
    expect(form).toContain('name="form_token"');

    // With a real phase-5 session: the consent page itself, naming the connector and the address.
    const session = await signIn(base, "myk", PASSWORD);
    const consent = await fetch(`${base}/authorize?${query}`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    });
    expect(consent.status).toBe(200);
    const page = await consent.text();
    expect(page).toContain("Approve a connector?");
    expect(page).toContain("Example Connector");
    expect(page).toContain(REDIRECT);
    expect(page).toContain(`value="${clientId}"`);
  });

  it("POST /token reaches the token door — an unknown code draws its own 400, never a mount refusal", async () => {
    const { base } = await serveConnectorDoors();
    const clientId = await registeredClient(base);

    const res = await redeem(base, "/token", clientId);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toBe("invalid_grant");
    // The mount router's refusal shape is `{ errors: [...] }`; the token door's is RFC 6749's.
    expect(body["errors"]).toBeUndefined();
  });

  it("the documented /oauth/* spellings still answer, in the same run", async () => {
    const { base, home } = await serveConnectorDoors();

    const registered = await register(base, "/oauth/register");
    expect(registered.status).toBe(201);
    const clientId = ((await registered.json()) as Record<string, unknown>)["client_id"] as string;
    expect(clientFor(readOAuthFile(home), clientId)).toBeDefined();

    const authorize = await fetch(`${base}/oauth/authorize?${authorizeQuery(clientId)}`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${await signIn(base, "myk", PASSWORD)}` },
    });
    expect(authorize.status).toBe(200);
    expect(await authorize.text()).toContain("Approve a connector?");

    const token = await redeem(base, "/oauth/token", clientId);
    expect(token.status).toBe(400);
    expect(((await token.json()) as Record<string, unknown>)["error"]).toBe("invalid_grant");
  });

  // The oracle rail. Routing three paths must not make any OTHER path distinguishable: an unrouted
  // name and a mount that exists but needs a token still answer the identical bytes. Compared
  // response-to-response so no literal in this file can drift away from what the server sends.
  it("an unrouted path is still byte-identical to a real mount's unauthenticated refusal", async () => {
    const { base } = await serveConnectorDoors();

    // The reference: a mount that DOES exist, asked without a token. This is the answer every
    // unresolvable name must be indistinguishable from.
    const mountExists = await fingerprint(
      await fetch(`${base}/${MOUNT}/graphql`, { redirect: "manual" }),
    );
    expect(mountExists.status).toBe(401);

    // A neighbour of each alias, plus a name that is nothing at all. `/oauth` is the sharpest case:
    // it is the PREFIX of all three documented doors and must stay unrouted.
    for (const path of ["/nonsense", "/registerx", "/authorizex", "/tokenx", "/oauth"]) {
      const unrouted = await fingerprint(await fetch(`${base}${path}`, { redirect: "manual" }));
      expect(unrouted, `${path} must be indistinguishable from a real mount's refusal`).toEqual(
        mountExists,
      );
    }

    // And the same for a POST, the verb the register alias uses — so the fix cannot have made the
    // three paths answer a method-shaped oracle its neighbours do not.
    const mountPost = await fingerprint(
      await fetch(`${base}/${MOUNT}/graphql`, { method: "POST", redirect: "manual" }),
    );
    expect(mountPost.status).toBe(401);
    for (const path of ["/registerx", "/authorizex", "/tokenx", "/oauth"]) {
      const unrouted = await fingerprint(
        await fetch(`${base}${path}`, { method: "POST", redirect: "manual" }),
      );
      expect(unrouted, `POST ${path} must be indistinguishable from a mount's refusal`).toEqual(
        mountPost,
      );
    }
  });
});
