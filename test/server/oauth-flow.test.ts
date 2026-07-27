// §37 (T114), criteria (l) (m) (n) (o) (p) (q) (r) (w): the whole grant, and what the token IS.
//
// (q) and (r) are the two that carry §37's design. A grant mints a NEW actor seed for the connector
// and enters THAT into the token table — never the operator's identity. So every delta the connector
// writes says "the connector wrote this", and no input to any of these endpoints can produce a token
// that holds the operator's authority over this server.
//
// Both levels throughout: what a door answers, AND what the store actually holds. (q) is the clearest
// case — a token that authenticates and then signs as the wrong identity is a bug no status code
// shows, so the author is read off the delta in the sqlite file and again through a reading.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { readSeed } from "../../src/cli/config.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import {
  PASSWORD,
  bootStore,
  createUser,
  dropHome,
  makeHome,
  signIn,
  storeDeltas,
} from "./user-fixture.js";
import { readOAuthFile } from "../../src/server/oauth-file.js";
import {
  CLAUDE_ORIGIN,
  CLAUDE_REDIRECT,
  approve,
  bearer,
  codeFrom,
  formTokenIn,
  getAuthorize,
  gql,
  mcp,
  pkce,
  redeem,
  register,
  serveOAuth,
  wellFormedAuthorize,
  type ServedOAuth,
} from "./oauth-fixture.js";

vi.setConfig({ testTimeout: 30000 });

const MOSS = "plant:moss";

let home: string;
let served: ServedOAuth;
let session: { cookie: string; formToken: string };

async function boot(oauth: Record<string, unknown> = {}): Promise<void> {
  served = await serveOAuth(home, {
    oauth,
    prepare: (gateway) => {
      gateway.register(PLANT, PLANT_POLICY, [MOSS], undefined, PLANT_WRITABLE);
    },
  });
  session = await signIn(served.base);
}

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
  await boot();
});
afterEach(async () => {
  vi.useRealTimers();
  await served?.close();
  dropHome(home);
});

/** Walk register → authorize → approve, and hold the code plus everything needed to redeem it. */
async function upToCode(
  opts: { redirectUris?: readonly string[]; redirectUri?: string } = {},
): Promise<{ clientId: string; code: string; verifier: string; redirectUri: string }> {
  const registered = await register(served.base, {
    ...(opts.redirectUris === undefined ? {} : { redirectUris: opts.redirectUris }),
  });
  expect(registered.status).toBe(201);
  const secret = pkce();
  const redirectUri = opts.redirectUri ?? opts.redirectUris?.[0] ?? CLAUDE_REDIRECT;
  const params = {
    ...wellFormedAuthorize(registered.clientId, secret.challenge),
    redirect_uri: redirectUri,
  };
  const page = await getAuthorize(served.base, params, session.cookie);
  expect(page.res.status).toBe(200);
  const approved = await approve(served.base, params, {
    cookie: session.cookie,
    formToken: formTokenIn(page.body),
  });
  expect(approved.status).toBe(302);
  const code = codeFrom(approved);
  expect(code).toBeDefined();
  return { clientId: registered.clientId, code: code!, verifier: secret.verifier, redirectUri };
}

describe("(l) the full flow mints a working token", () => {
  it("register → authorize → code → token, and the token opens the MCP door", async () => {
    const walked = await upToCode();
    const redeemed = await redeem(served.base, {
      grant_type: "authorization_code",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
      code_verifier: walked.verifier,
    });
    expect(redeemed.res.status).toBe(200);
    expect(redeemed.body["token_type"]).toBe("Bearer");
    const token = redeemed.body["access_token"] as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    // No refresh token in v1, and the document must not promise one it does not mint.
    expect(redeemed.body["refresh_token"]).toBeUndefined();
    // The token endpoint must not be cacheable — a proxy holding a bearer token is a leak.
    expect(redeemed.res.headers.get("cache-control")).toContain("no-store");

    // The door claude.ai actually knocks on.
    const listed = await mcp(
      served.base,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      bearer(token),
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { result?: { tools?: { name: string }[] } };
    expect(body.result?.tools?.map((t) => t.name)).toContain("loam_query");

    // And it reads. A tools/list that answered without a token would make the line above vacuous.
    const read = await mcp(
      served.base,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "loam_query", arguments: { query: `{ plant(entity: "${MOSS}") { height } }` } },
      },
      bearer(token),
    );
    expect(read.status).toBe(200);
    const tokenless = await mcp(served.base, { jsonrpc: "2.0", id: 3, method: "tools/list" });
    expect(tokenless.status).toBe(401);
  });

  it("a second grant for the SAME client reuses the same actor — one connector, one author", async () => {
    const first = await upToCode();
    await redeem(served.base, {
      grant_type: "authorization_code",
      code: first.code,
      redirect_uri: first.redirectUri,
      client_id: first.clientId,
      code_verifier: first.verifier,
    });
    const seedAfterFirst = readOAuthFile(home).grants;
    expect(seedAfterFirst.length).toBe(1);

    // The same client comes back for another token (the connector was re-authorized).
    const secret = pkce();
    const params = {
      ...wellFormedAuthorize(first.clientId, secret.challenge),
      redirect_uri: first.redirectUri,
    };
    const page = await getAuthorize(served.base, params, session.cookie);
    const approved = await approve(served.base, params, {
      cookie: session.cookie,
      formToken: formTokenIn(page.body),
    });
    const second = await redeem(served.base, {
      grant_type: "authorization_code",
      code: codeFrom(approved)!,
      redirect_uri: first.redirectUri,
      client_id: first.clientId,
      code_verifier: secret.verifier,
    });
    expect(second.res.status).toBe(200);
    const after = readOAuthFile(home);
    expect(after.grants.length).toBe(1);
    expect(after.grants[0]!.actorSeed).toBe(seedAfterFirst[0]!.actorSeed);
    expect(after.tokens.length).toBe(2);
  });

  it("a DIFFERENT client gets its own actor — two connectors are two authors", async () => {
    const a = await upToCode();
    await redeem(served.base, {
      grant_type: "authorization_code",
      code: a.code,
      redirect_uri: a.redirectUri,
      client_id: a.clientId,
      code_verifier: a.verifier,
    });
    const b = await upToCode();
    await redeem(served.base, {
      grant_type: "authorization_code",
      code: b.code,
      redirect_uri: b.redirectUri,
      client_id: b.clientId,
      code_verifier: b.verifier,
    });
    const grants = readOAuthFile(home).grants;
    expect(grants.length).toBe(2);
    expect(grants[0]!.actor).not.toBe(grants[1]!.actor);
    expect(grants[0]!.actorSeed).not.toBe(grants[1]!.actorSeed);
  });
});

describe("(m) authorize without a session", () => {
  it("answers the login form and mints nothing", async () => {
    const registered = await register(served.base);
    const secret = pkce();
    const params = wellFormedAuthorize(registered.clientId, secret.challenge);
    const asked = await getAuthorize(served.base, params); // no cookie at all
    expect(asked.res.status).toBe(200);
    expect(asked.body).toMatch(/Sign in/);
    expect(asked.body).toContain('action="/login"');
    // Not the consent page: no approval form, and nothing that could be POSTed to approve.
    expect(asked.body).not.toMatch(/Approve/);
    expect(asked.body).not.toContain('action="/oauth/authorize"');
    const file = readOAuthFile(home);
    expect(file.grants).toEqual([]);
    expect(file.tokens).toEqual([]);
  });

  it("a POST approval with no session is refused, cookie or no cookie", async () => {
    const registered = await register(served.base);
    const secret = pkce();
    const params = wellFormedAuthorize(registered.clientId, secret.challenge);
    for (const opts of [
      {},
      { cookie: "not-a-session-id", formToken: "x".repeat(43) },
      { formToken: "x".repeat(43) },
    ]) {
      const res = await approve(served.base, params, opts);
      expect([401, 403]).toContain(res.status);
      expect(codeFrom(res)).toBeUndefined();
    }
    expect(readOAuthFile(home).grants).toEqual([]);
  });

  it("a session whose user lost the operator role cannot approve", async () => {
    // The consent decision is the operator's. §36 re-reads the role from the ground on every ask for
    // exactly this reason, and §37 must not be the door that trusts the session's stale copy.
    const registered = await register(served.base);
    const secret = pkce();
    const params = wellFormedAuthorize(registered.clientId, secret.challenge);
    const page = await getAuthorize(served.base, params, session.cookie);
    const formToken = formTokenIn(page.body);

    // A plain actor, signed in: authenticated, and not entitled to grant anything.
    await createUser(home, "guest", PASSWORD, { operator: false });
    const guest = await signIn(served.base, "guest");
    const asGuest = await getAuthorize(served.base, params, guest.cookie);
    expect(asGuest.res.status).toBe(403);
    const refused = await approve(served.base, params, {
      cookie: guest.cookie,
      formToken: guest.formToken,
    });
    expect(refused.status).toBe(403);
    expect(codeFrom(refused)).toBeUndefined();
    expect(readOAuthFile(home).grants).toEqual([]);
    // and the operator's own approval still works, so the rail is not passing on a shut door
    const ok = await approve(served.base, params, { cookie: session.cookie, formToken });
    expect(ok.status).toBe(302);
  });
});

describe("(n) PKCE, and the single-use code", () => {
  it("a wrong verifier is refused, and the code is then DEAD to the right one", async () => {
    const walked = await upToCode();
    const wrong = await redeem(served.base, {
      grant_type: "authorization_code",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
      code_verifier: pkce().verifier, // a real verifier, for a different challenge
    });
    expect(wrong.res.status).toBe(400);
    expect(wrong.body["error"]).toBe("invalid_grant");
    expect(wrong.body["access_token"]).toBeUndefined();

    // THE CODE BURNED ON THE ATTEMPT. Without this, an attacker who holds a stolen code may brute the
    // verifier, and the legitimate client's own redemption a moment later is the tell nobody sees.
    const right = await redeem(served.base, {
      grant_type: "authorization_code",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
      code_verifier: walked.verifier,
    });
    expect(right.res.status).toBe(400);
    expect(right.body["access_token"]).toBeUndefined();
    const file = readOAuthFile(home);
    expect(file.tokens).toEqual([]);
    expect(file.grants).toEqual([]);
  });

  it("a missing verifier is refused — PKCE is not optional at the token endpoint", async () => {
    const walked = await upToCode();
    const none = await redeem(served.base, {
      grant_type: "authorization_code",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
    });
    expect(none.res.status).toBe(400);
    expect(none.body["access_token"]).toBeUndefined();
  });

  it("a successful redemption also burns the code", async () => {
    const walked = await upToCode();
    const body = {
      grant_type: "authorization_code",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
      code_verifier: walked.verifier,
    };
    const first = await redeem(served.base, body);
    expect(first.res.status).toBe(200);
    const replay = await redeem(served.base, body);
    expect(replay.res.status).toBe(400);
    expect(replay.body["access_token"]).toBeUndefined();
    expect(readOAuthFile(home).tokens.length).toBe(1);
  });

  it("an unknown grant_type is refused", async () => {
    const walked = await upToCode();
    const res = await redeem(served.base, {
      grant_type: "refresh_token",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
      code_verifier: walked.verifier,
    });
    expect(res.res.status).toBe(400);
    expect(res.body["error"]).toBe("unsupported_grant_type");
  });
});

describe("(o) a code is bound to its client and its redirect", () => {
  it("another client's id does not redeem it", async () => {
    const mine = await upToCode();
    const theirs = await register(served.base, { redirectUris: [`${CLAUDE_ORIGIN}/other`] });
    const res = await redeem(served.base, {
      grant_type: "authorization_code",
      code: mine.code,
      redirect_uri: mine.redirectUri,
      client_id: theirs.clientId,
      code_verifier: mine.verifier,
    });
    expect(res.res.status).toBe(400);
    expect(res.body["access_token"]).toBeUndefined();
    expect(readOAuthFile(home).grants).toEqual([]);
  });

  it("a missing client_id does not redeem it either", async () => {
    const mine = await upToCode();
    const res = await redeem(served.base, {
      grant_type: "authorization_code",
      code: mine.code,
      redirect_uri: mine.redirectUri,
      code_verifier: mine.verifier,
    });
    expect(res.res.status).toBe(400);
    expect(res.body["access_token"]).toBeUndefined();
  });

  it("a different redirect_uri does not redeem it, even one the client registered", async () => {
    const walked = await upToCode({
      redirectUris: [`${CLAUDE_ORIGIN}/first`, `${CLAUDE_ORIGIN}/second`],
      redirectUri: `${CLAUDE_ORIGIN}/first`,
    });
    for (const swapped of [`${CLAUDE_ORIGIN}/second`, "https://attacker.example/cb", undefined]) {
      const res = await redeem(served.base, {
        grant_type: "authorization_code",
        code: walked.code,
        ...(swapped === undefined ? {} : { redirect_uri: swapped }),
        client_id: walked.clientId,
        code_verifier: walked.verifier,
      });
      expect(res.res.status, `${String(swapped)} redeemed`).toBe(400);
      expect(res.body["access_token"]).toBeUndefined();
    }
  });
});

describe("(p) a code expires on a monotonic clock", () => {
  it("it is refused past its window", async () => {
    let ticks = 0;
    await served.close();
    served = await serveOAuth(home, {
      oauth: { codeTtlMs: 500, monotonicNow: () => ticks },
      prepare: (gateway) => {
        gateway.register(PLANT, PLANT_POLICY, [MOSS], undefined, PLANT_WRITABLE);
      },
    });
    session = await signIn(served.base);
    const walked = await upToCode();
    ticks += 501;
    const res = await redeem(served.base, {
      grant_type: "authorization_code",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
      code_verifier: walked.verifier,
    });
    expect(res.res.status).toBe(400);
    expect(readOAuthFile(home).tokens).toEqual([]);
  });

  it("a wall clock stepped BACKWARDS does not resurrect it", async () => {
    let ticks = 0;
    await served.close();
    served = await serveOAuth(home, {
      oauth: { codeTtlMs: 500, monotonicNow: () => ticks },
      prepare: (gateway) => {
        gateway.register(PLANT, PLANT_POLICY, [MOSS], undefined, PLANT_WRITABLE);
      },
    });
    session = await signIn(served.base);
    const walked = await upToCode();
    ticks += 501;
    // Only Date is faked: the HTTP stack keeps its real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() - 60 * 60_000));
    const res = await redeem(served.base, {
      grant_type: "authorization_code",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
      code_verifier: walked.verifier,
    });
    expect(res.res.status).toBe(400);
    expect(readOAuthFile(home).tokens).toEqual([]);
  });

  it("a wall clock stepped FORWARD past the window does NOT kill it", async () => {
    // The discriminating direction. An expiry read from Date.now() passes both rails above and fails
    // this one, so this is what proves the clock is monotonic rather than merely injected.
    let ticks = 0;
    await served.close();
    served = await serveOAuth(home, {
      oauth: { codeTtlMs: 500, monotonicNow: () => ticks },
      prepare: (gateway) => {
        gateway.register(PLANT, PLANT_POLICY, [MOSS], undefined, PLANT_WRITABLE);
      },
    });
    session = await signIn(served.base);
    const walked = await upToCode();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 60 * 60_000));
    const res = await redeem(served.base, {
      grant_type: "authorization_code",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
      code_verifier: walked.verifier,
    });
    expect(res.res.status).toBe(200);
    expect(res.body["access_token"]).toMatch(/.+/);
  });
});

describe("(q) (r) what the token IS", () => {
  it("(q) a delta written through the token is authored by the CONNECTOR, not the operator", async () => {
    const walked = await upToCode();
    const redeemed = await redeem(served.base, {
      grant_type: "authorization_code",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
      code_verifier: walked.verifier,
    });
    const token = redeemed.body["access_token"] as string;

    const grant = readOAuthFile(home).grants[0]!;
    const connector = authorForSeed(grant.actorSeed);
    const operator = authorForSeed(readSeed(home));
    expect(grant.actor).toBe(connector);
    expect(connector).not.toBe(operator);

    // The write, through the door claude.ai uses.
    const wrote = await gql(
      served.base,
      `mutation { plant(entity: "${MOSS}", height: 42) { height } }`,
      bearer(token),
    );
    expect(wrote.status).toBe(200);
    const wroteBody = (await wrote.json()) as {
      data?: { plant?: { height?: number } };
      errors?: string[];
    };
    expect(wroteBody.errors).toBeUndefined();
    expect(wroteBody.data?.plant?.height).toBe(42);

    // THE DELTA LEVEL: the carrier of the value, in the sqlite file, signed by the connector.
    const carriers = (await storeDeltas(home)).filter((d) =>
      JSON.stringify(d.claims.pointers).includes(`"value":42`),
    );
    expect(carriers.length).toBe(1);
    expect(carriers[0]!.claims.author).toBe(connector);
    expect(carriers[0]!.claims.author).not.toBe(operator);

    // THE OBJECT LEVEL: a fresh reading resolves the value, so the write is not merely stored.
    const after = await gql(served.base, `{ plant(entity: "${MOSS}") { height } }`, bearer(token));
    expect(
      ((await after.json()) as { data: { plant: { height: number } } }).data.plant.height,
    ).toBe(42);
  });

  it("(q) the connector's write standing is a real grant, and the operator signed it", async () => {
    const walked = await upToCode();
    await redeem(served.base, {
      grant_type: "authorization_code",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
      code_verifier: walked.verifier,
    });
    const grant = readOAuthFile(home).grants[0]!;
    const operator = authorForSeed(readSeed(home));
    const deltas = await storeDeltas(home);
    const grantDeltas = deltas.filter((d) => {
      const json = JSON.stringify(d.claims.pointers);
      return json.includes(grant.actor) && json.includes('"value":"write"');
    });
    expect(grantDeltas.length).toBe(1);
    // The operator's own signature is what makes it law: a grant the connector signed for itself
    // would bind nothing, and a grant nobody signed could not be in the store at all.
    expect(grantDeltas[0]!.claims.author).toBe(operator);
  });

  it("(r) the token table entry the flow creates is { actor } — never operator", async () => {
    // Enumerated over inputs that all SAY the word: a client name, a scope, a redirect path and extra
    // body fields that each ask to be the operator. None of them is a channel.
    const hostile = [
      { name: "operator", scope: "operator" },
      { name: "loam operator", scope: "operator admin" },
      { name: "Claude", scope: "loam.connector operator" },
    ];
    for (const shape of hostile) {
      const registered = await register(served.base, {
        name: shape.name,
        redirectUris: [`${CLAUDE_ORIGIN}/cb?operator=true&role=operator`],
      });
      expect(registered.status).toBe(201);
      const secret = pkce();
      const params = {
        ...wellFormedAuthorize(registered.clientId, secret.challenge),
        redirect_uri: `${CLAUDE_ORIGIN}/cb?operator=true&role=operator`,
        scope: shape.scope,
      };
      const page = await getAuthorize(served.base, params, session.cookie);
      expect(page.res.status).toBe(200);
      const approved = await approve(served.base, params, {
        cookie: session.cookie,
        formToken: formTokenIn(page.body),
        fields: { operator: "true", role: "operator", identity: "operator" },
      });
      expect(approved.status).toBe(302);
      const redeemed = await redeem(served.base, {
        grant_type: "authorization_code",
        code: codeFrom(approved)!,
        redirect_uri: params.redirect_uri,
        client_id: registered.clientId,
        code_verifier: secret.verifier,
      });
      expect(redeemed.res.status).toBe(200);
      const token = redeemed.body["access_token"] as string;

      // The three doors that answer ONLY to the operator. Each is a different refusal shape on
      // purpose, and none of them may open.
      const health = await fetch(`${served.base}/default/health`, { headers: bearer(token) });
      expect(health.status, `${shape.name} reached health`).toBe(404);
      const federate = await fetch(`${served.base}/default/federate`, { headers: bearer(token) });
      expect(federate.status, `${shape.name} reached federate`).toBe(403);
      const registerDoor = await fetch(`${served.base}/default/register`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: "{}",
      });
      expect(registerDoor.status, `${shape.name} reached register`).toBe(403);
      // and the MCP registration tool, which is the same gate spoken in JSON-RPC
      const tool = await mcp(
        served.base,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "loam_register", arguments: {} },
        },
        bearer(token),
      );
      const toolBody = (await tool.json()) as { result?: { isError?: boolean } };
      expect(toolBody.result?.isError).toBe(true);
    }
    // Structurally, in the file: every grant names its own seed, and every token entry carries
    // exactly the three fields a token entry has. A stray `operator` property here would be the
    // escalation channel, and "the word operator appears nowhere" cannot be the test — one of the
    // client names above IS "operator".
    const file = readOAuthFile(home);
    expect(file.grants.length).toBe(hostile.length);
    const operator = authorForSeed(readSeed(home));
    const seeds = new Set<string>();
    for (const grant of file.grants) {
      expect(grant.actorSeed).toMatch(/^[0-9a-f]{64}$/);
      expect(grant.actor).toBe(authorForSeed(grant.actorSeed));
      expect(grant.actor).not.toBe(operator);
      expect(grant.actorSeed).not.toBe(readSeed(home));
      seeds.add(grant.actorSeed);
    }
    expect(seeds.size).toBe(hostile.length);
    for (const entry of file.tokens) {
      expect(Object.keys(entry).sort()).toEqual(["clientId", "digest", "issuedAt"]);
    }
  });

  it("(r) the operator's own doors still open for the operator's own token", async () => {
    // The negative rail above would pass if these doors were simply broken for everyone.
    const health = await fetch(`${served.base}/default/health`, {
      headers: bearer("op-token"),
    });
    expect(health.status).toBe(200);
    const federate = await fetch(`${served.base}/default/federate`, {
      headers: bearer("op-token"),
    });
    expect(federate.status).toBe(200);
  });
});

describe("(w) no secret reaches the ground", () => {
  it("neither the seed, the token, nor the PKCE material appears in any delta", async () => {
    const walked = await upToCode();
    const redeemed = await redeem(served.base, {
      grant_type: "authorization_code",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
      code_verifier: walked.verifier,
    });
    const token = redeemed.body["access_token"] as string;
    // Write something, so the ground holds a delta the connector authored as well as the grant.
    await gql(
      served.base,
      `mutation { plant(entity: "${MOSS}", height: 11) { height } }`,
      bearer(token),
    );

    const grant = readOAuthFile(home).grants[0]!;
    const secrets = [grant.actorSeed, token, walked.verifier, walked.code];
    const whole = JSON.stringify(await storeDeltas(home));
    for (const secret of secrets) {
      expect(secret.length).toBeGreaterThan(20);
      expect(whole.includes(secret), `a secret reached the ground`).toBe(false);
    }
    // The connector's PUBLIC author is in the ground, and must be — that is the grant.
    expect(whole).toContain(grant.actor);
  });

  it("the token digest is what oauth.json holds, not the token", async () => {
    const walked = await upToCode();
    const redeemed = await redeem(served.base, {
      grant_type: "authorization_code",
      code: walked.code,
      redirect_uri: walked.redirectUri,
      client_id: walked.clientId,
      code_verifier: walked.verifier,
    });
    const token = redeemed.body["access_token"] as string;
    const raw = JSON.stringify(readOAuthFile(home));
    expect(raw).not.toContain(token);
    expect(readOAuthFile(home).tokens[0]!.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
