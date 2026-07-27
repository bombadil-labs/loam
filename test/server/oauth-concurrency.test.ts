// §37 (T114), criteria (s) (t) (u): oauth.json under pressure.
//
// The file is the only durable half of §37, and it holds the connector's SIGNING SEED. So three
// things have to be true of it: a race cannot mint two identities for one connector, a write cannot
// leave a half-file or a world-readable one behind, and a file this door cannot parse must refuse the
// flow rather than guess.
//
// (u) is H7 at the file layer. "Cannot determine what this file says" is never "it says nothing" —
// treating an unparseable oauth.json as an empty one would silently re-mint a seed for a connector
// that already has one, and the old grant would stay in the ground with nobody holding its key.

import { chmodSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD, bootStore, createUser, dropHome, makeHome, signIn } from "./user-fixture.js";
import {
  OAuthFileUnreadable,
  oauthPath,
  readOAuthFile,
  writeOAuthFile,
} from "../../src/server/oauth-file.js";
import {
  CLAUDE_REDIRECT,
  approve,
  bearer,
  codeFrom,
  formTokenIn,
  getAuthorize,
  mcp,
  pkce,
  redeem,
  register,
  serveOAuth,
  wellFormedAuthorize,
  type ServedOAuth,
} from "./oauth-fixture.js";

vi.setConfig({ testTimeout: 30000 });

let home: string;
let served: ServedOAuth;
let session: { cookie: string; formToken: string };

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
  served = await serveOAuth(home);
  session = await signIn(served.base);
});
afterEach(async () => {
  await served?.close();
  dropHome(home);
});

/** One authorize → approve, yielding a redeemable code for `clientId`. */
async function codeFor(
  clientId: string,
  redirectUri = CLAUDE_REDIRECT,
): Promise<{ code: string; verifier: string }> {
  const secret = pkce();
  const params = {
    ...wellFormedAuthorize(clientId, secret.challenge),
    redirect_uri: redirectUri,
  };
  const page = await getAuthorize(served.base, params, session.cookie);
  expect(page.res.status).toBe(200);
  const approved = await approve(served.base, params, {
    cookie: session.cookie,
    formToken: formTokenIn(page.body),
  });
  expect(approved.status).toBe(302);
  return { code: codeFrom(approved)!, verifier: secret.verifier };
}

describe("(s) two concurrent first-grants", () => {
  it("end with exactly ONE minted seed, and both tokens resolve to it", async () => {
    // The interleaving this closes: read oauth.json, see no seed for this client, mint one, await the
    // grant append, write the file. Two redemptions in that window each mint — and the second write
    // wins, leaving one seed holding a token and one orphan grant in the ground forever.
    const client = await register(served.base);
    expect(client.status).toBe(201);
    const first = await codeFor(client.clientId);
    const second = await codeFor(client.clientId);

    const body = (c: { code: string; verifier: string }) => ({
      grant_type: "authorization_code",
      code: c.code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: client.clientId,
      code_verifier: c.verifier,
    });
    // Issued together, deliberately not awaited in turn.
    const [a, b] = await Promise.all([
      redeem(served.base, body(first)),
      redeem(served.base, body(second)),
    ]);
    expect(a.res.status).toBe(200);
    expect(b.res.status).toBe(200);

    const file = readOAuthFile(home);
    expect(file.grants.length).toBe(1);
    expect(file.tokens.length).toBe(2);
    expect(new Set(file.tokens.map((t) => t.clientId))).toEqual(new Set([client.clientId]));

    // BOTH tokens work, and both write as the SAME author — the object-level half. A file holding one
    // seed while one of the two tokens resolves to nothing would pass the counts above.
    for (const token of [a.body["access_token"], b.body["access_token"]] as string[]) {
      const res = await mcp(
        served.base,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        bearer(token),
      );
      expect(res.status).toBe(200);
    }
  });

  it("four at once still end with one seed", async () => {
    const client = await register(served.base);
    const codes = await Promise.all([
      codeFor(client.clientId),
      codeFor(client.clientId),
      codeFor(client.clientId),
      codeFor(client.clientId),
    ]);
    const results = await Promise.all(
      codes.map((c) =>
        redeem(served.base, {
          grant_type: "authorization_code",
          code: c.code,
          redirect_uri: CLAUDE_REDIRECT,
          client_id: client.clientId,
          code_verifier: c.verifier,
        }),
      ),
    );
    expect(results.map((r) => r.res.status)).toEqual([200, 200, 200, 200]);
    const file = readOAuthFile(home);
    expect(file.grants.length).toBe(1);
    expect(file.tokens.length).toBe(4);
  });

  it("two concurrent grants for DIFFERENT clients mint two seeds, and lose neither", async () => {
    // The other direction. A mutex that serialised on one global key and then re-read a stale snapshot
    // would drop one of these writes entirely.
    const one = await register(served.base);
    const two = await register(served.base);
    const [ca, cb] = [await codeFor(one.clientId), await codeFor(two.clientId)];
    const [a, b] = await Promise.all([
      redeem(served.base, {
        grant_type: "authorization_code",
        code: ca.code,
        redirect_uri: CLAUDE_REDIRECT,
        client_id: one.clientId,
        code_verifier: ca.verifier,
      }),
      redeem(served.base, {
        grant_type: "authorization_code",
        code: cb.code,
        redirect_uri: CLAUDE_REDIRECT,
        client_id: two.clientId,
        code_verifier: cb.verifier,
      }),
    ]);
    expect(a.res.status).toBe(200);
    expect(b.res.status).toBe(200);
    const file = readOAuthFile(home);
    expect(file.grants.length).toBe(2);
    expect(new Set(file.grants.map((g) => g.clientId))).toEqual(
      new Set([one.clientId, two.clientId]),
    );
    expect(file.tokens.length).toBe(2);
  });

  it("concurrent registrations all land — no write is lost", async () => {
    const results = await Promise.all([
      register(served.base),
      register(served.base),
      register(served.base),
      register(served.base),
      register(served.base),
    ]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const ids = new Set(results.map((r) => r.clientId));
    expect(ids.size).toBe(5);
    expect(new Set(readOAuthFile(home).clients.map((c) => c.clientId))).toEqual(ids);
  });
});

describe("(t) the write is atomic and 0600", () => {
  it("a SECOND write over a 0644 file still ends at 0600", async () => {
    // The failure this catches: an open that truncates in place inherits whatever mode the file
    // already had. A first write on a fresh path is created 0600 and looks correct forever.
    const first = await register(served.base);
    expect(first.status).toBe(201);
    chmodSync(oauthPath(home), 0o644);
    if (process.platform !== "win32") {
      expect(statSync(oauthPath(home)).mode & 0o777).toBe(0o644);
    }
    const second = await register(served.base);
    expect(second.status).toBe(201);
    if (process.platform !== "win32") {
      expect(statSync(oauthPath(home)).mode & 0o777).toBe(0o600);
    }
    // and the second write did not lose the first client
    expect(readOAuthFile(home).clients.length).toBe(2);
  });

  it("the file is never observed half-written, and the temp is not left behind", async () => {
    // Temp-then-rename means a reader either sees the old whole file or the new whole file. Asserted
    // the way a reader can: every intermediate state parses.
    for (let i = 0; i < 6; i += 1) {
      await register(served.base);
      expect(() => readOAuthFile(home)).not.toThrow();
    }
    const leftovers = readdirSync(home).filter((f) => f.startsWith("oauth.json.") && f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("writeOAuthFile applies 0600 to a path that already exists at 0644", async () => {
    // The unit-level statement of the same law, so the property is pinned where it lives rather than
    // only through the door that happens to call it today.
    const file = readOAuthFile(home);
    writeOAuthFile(home, file);
    chmodSync(oauthPath(home), 0o644);
    writeOAuthFile(home, file);
    if (process.platform !== "win32") {
      expect(statSync(oauthPath(home)).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(oauthPath(home), "utf8").endsWith("\n")).toBe(true);
  });
});

describe("(u) a file this door cannot read", () => {
  const corruptions: { label: string; bytes: string }[] = [
    { label: "truncated mid-object", bytes: '{"version":1,"clients":[{"clientId":"a' },
    { label: "empty", bytes: "" },
    { label: "not JSON at all", bytes: "this is not json" },
    { label: "a JSON array", bytes: "[]" },
    { label: "JSON null", bytes: "null" },
    { label: "the wrong version", bytes: '{"version":2,"clients":[],"grants":[],"tokens":[]}' },
    { label: "clients not an array", bytes: '{"version":1,"clients":{},"grants":[],"tokens":[]}' },
    {
      label: "a client with no id",
      bytes: '{"version":1,"clients":[{"clientName":"x","redirectUris":[]}],"grants":[],"tokens":[]}',
    },
    {
      label: "a grant whose seed is not hex",
      bytes:
        '{"version":1,"clients":[],"grants":[{"clientId":"a","actorSeed":"zz","actor":"b","grantedAt":1}],"tokens":[]}',
    },
    {
      label: "a grant whose actor disagrees with its seed",
      bytes:
        `{"version":1,"clients":[],"grants":[{"clientId":"a","actorSeed":"${"11".repeat(32)}",` +
        `"actor":"not-the-author-of-that-seed","grantedAt":1}],"tokens":[]}`,
    },
  ];

  it("refuses to parse, with a named error rather than an empty file", () => {
    for (const { label, bytes } of corruptions) {
      writeFileSync(oauthPath(home), bytes);
      let thrown: unknown;
      try {
        readOAuthFile(home);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, `${label} parsed`).toBeInstanceOf(OAuthFileUnreadable);
      expect(String((thrown as Error).message), `${label} said nothing`).toContain("oauth.json");
    }
  });

  it("refuses the flow rather than crashing the server, and says nothing to the caller", async () => {
    writeFileSync(oauthPath(home), '{"version":1,"clients":[{"clientId":"a');
    // Every OAuth door that needs the file refuses, and none of them 500s with the home's path in it.
    const registered = await register(served.base);
    expect([500, 503]).toContain(registered.status);
    expect(JSON.stringify(registered.body)).not.toContain(home);

    const authorize = await getAuthorize(
      served.base,
      wellFormedAuthorize("some-client", "x".repeat(43)),
      session.cookie,
    );
    expect([400, 500, 503]).toContain(authorize.res.status);
    expect(authorize.body).not.toContain(home);

    const redeemed = await redeem(served.base, {
      grant_type: "authorization_code",
      code: "nope",
      client_id: "some-client",
      redirect_uri: CLAUDE_REDIRECT,
      code_verifier: "v".repeat(43),
    });
    expect([400, 500, 503]).toContain(redeemed.res.status);
    expect(JSON.stringify(redeemed.body)).not.toContain(home);

    // THE SERVER IS ALIVE. The doors that have nothing to do with oauth.json still answer.
    expect((await fetch(`${served.base}/`)).status).toBe(200);
    expect((await fetch(`${served.base}/login`)).status).toBe(200);
    // and a presented bearer token is refused rather than admitted — the file cannot say who holds one
    const probe = await mcp(
      served.base,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      bearer("some-token-that-is-not-in-the-static-table"),
    );
    expect(probe.status).toBe(401);
  });

  it("does not crash the BOOT path either", async () => {
    // A store that will not serve because its oauth.json is damaged is a much worse outage than one
    // that serves every other door and refuses §37. The doors open; §37 refuses.
    await served.close();
    writeFileSync(oauthPath(home), "{{{ not json");
    served = await serveOAuth(home);
    expect((await fetch(`${served.base}/`)).status).toBe(200);
    const res = await register(served.base);
    expect([500, 503]).toContain(res.status);
  });

  it("an ABSENT file is an empty one — a home with no connectors is not damaged", () => {
    rmSync(oauthPath(home), { force: true });
    const file = readOAuthFile(home);
    expect(file).toEqual({ version: 1, clients: [], grants: [], tokens: [] });
  });
});
