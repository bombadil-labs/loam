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

import {
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { PASSWORD, bootStore, createUser, dropHome, makeHome, signIn } from "./user-fixture.js";
import {
  LOCK_STALE_MS,
  OAuthFileBusy,
  OAuthFileUnreadable,
  oauthLockPath,
  oauthPath,
  readOAuthFile,
  withOAuthFile,
  writeOAuthFile,
} from "../../src/server/oauth-file.js";
import { run } from "../../src/cli/cli.js";
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

const SEED = "11".repeat(32);
const SEED_AUTHOR = authorForSeed(SEED);

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

describe("(s) the cross-process lock", () => {
  // The interleaving no in-process rail can reach: `loam grant revoke` runs in ANOTHER process, and the
  // server writes this file too. Whichever wrote second used to spread a snapshot taken before the
  // other's change and silently discard it — and the direction that discards the REVOKE leaves the
  // operator told a connector was closed while its token still opens the door.
  //
  // WHAT THESE RAILS DO AND DO NOT REACH, said plainly. They drive the lock PRIMITIVE, which is the
  // fix: a held lock blocks, a stale lock is broken, and no read-modify-write inside it can be
  // interleaved. They do NOT spawn a second OS process and race it, so a genuine two-process
  // interleaving is proven by reading `withOAuthFile` rather than by a rail. The rail that would close
  // that gap forks a child and contends for real; it is not here.

  it("a held lock blocks a second writer rather than letting it overwrite", () => {
    // The discriminating assertion for the lock's existence. Without it, `withOAuthFile` reads and
    // writes straight through and this passes instantly with the other writer's change gone.
    writeOAuthFile(home, readOAuthFile(home));
    const before = readOAuthFile(home);
    writeFileSync(oauthLockPath(home), `${process.pid}\n`);
    try {
      expect(() =>
        withOAuthFile(home, (file) => ({
          next: { ...file, clients: [] },
          result: undefined,
        })),
      ).toThrow(OAuthFileBusy);
      // And it wrote NOTHING while it waited — a lock that threw after writing would be worse than none.
      expect(readOAuthFile(home)).toEqual(before);
    } finally {
      rmSync(oauthLockPath(home), { force: true });
    }
    // With the lock gone the same call succeeds, so the refusal above was the lock and not the payload.
    expect(() => withOAuthFile(home, (file) => ({ next: file, result: undefined }))).not.toThrow();
  });

  it("a STALE lock is broken, so a crashed writer cannot wedge the store forever", () => {
    writeFileSync(oauthLockPath(home), "1\n");
    const past = Date.now() - LOCK_STALE_MS - 5_000;
    utimesSync(oauthLockPath(home), new Date(past), new Date(past));
    const seen = withOAuthFile(home, (file) => ({ result: file.clients.length }));
    expect(seen).toBe(0);
    // And the lock is released rather than left behind by the writer that broke it.
    expect(existsSync(oauthLockPath(home))).toBe(false);
  });

  it("the lock is released even when the work throws", () => {
    expect(() =>
      withOAuthFile(home, () => {
        throw new Error("the work failed");
      }),
    ).toThrow("the work failed");
    expect(existsSync(oauthLockPath(home))).toBe(false);
    // The next writer is not blocked by the failed one.
    expect(() => withOAuthFile(home, (file) => ({ next: file, result: 0 }))).not.toThrow();
  });

  it("(v) a revoke and a mint do not lose each other's write", async () => {
    // The end-to-end statement, through the doors rather than the primitive: two connectors, one
    // revoked while the other is granted. Both changes must survive.
    const one = await register(served.base);
    const two = await register(served.base);
    const first = await codeFor(one.clientId);
    await redeem(served.base, {
      grant_type: "authorization_code",
      code: first.code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: one.clientId,
      code_verifier: first.verifier,
    });
    const second = await codeFor(two.clientId);

    // The revoke and the second mint, issued together.
    const io = { out: () => {}, err: () => {} };
    const [, minted] = await Promise.all([
      run(["grant", "revoke", one.clientId, "--home", home], io),
      redeem(served.base, {
        grant_type: "authorization_code",
        code: second.code,
        redirect_uri: CLAUDE_REDIRECT,
        client_id: two.clientId,
        code_verifier: second.verifier,
      }),
    ]);
    expect(minted.res.status).toBe(200);

    const file = readOAuthFile(home);
    // The revoke survived: no token for the revoked client, and its generation moved.
    expect(file.tokens.filter((t) => t.clientId === one.clientId)).toEqual([]);
    expect(file.clients.find((c) => c.clientId === one.clientId)!.generation).toBe(2);
    // The mint survived: the other client holds its token and its grant stands.
    expect(file.tokens.filter((t) => t.clientId === two.clientId).length).toBe(1);
    expect(file.grants.find((g) => g.clientId === two.clientId)!.standing).toBe(true);
    // And each token behaves accordingly at the door.
    expect(
      (
        await mcp(
          served.base,
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          bearer(minted.body["access_token"] as string),
        )
      ).status,
    ).toBe(200);
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

  it("the write REPLACES the file rather than truncating it, and leaves no temp", async () => {
    // The discriminating assertion, and the reason a "does it still parse" loop is not one: awaiting
    // each write means no reader ever runs mid-write, so a plain `writeFileSync` + `chmod` would keep
    // that loop green. `rename` puts a NEW inode at the path; truncate-in-place keeps the old one. So
    // the inode moving is what proves the temp-then-rename, from outside, with no timing at all.
    await register(served.base);
    const first = statSync(oauthPath(home));
    await register(served.base);
    const second = statSync(oauthPath(home));
    if (process.platform !== "win32") {
      expect(second.ino).not.toBe(first.ino);
    }
    // Every state a reader could observe parses, and the temp is not left behind.
    for (let i = 0; i < 4; i += 1) {
      await register(served.base);
      expect(() => readOAuthFile(home)).not.toThrow();
    }
    const leftovers = readdirSync(home).filter(
      (f) => f.startsWith("oauth.json.") && f.endsWith(".tmp"),
    );
    expect(leftovers).toEqual([]);
    // WHAT THIS DOES NOT ASSERT: the fsync. Nothing observable from a test distinguishes a synced
    // write from an unsynced one without a power cut, so durability across a crash rests on reading
    // `writeOAuthFile`. The rail that would close it is a filesystem fault injector, which this suite
    // does not have.
  });

  it("writeOAuthFile applies 0600 to a path that already exists at 0644", () => {
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
      bytes:
        '{"version":1,"clients":[{"clientName":"x","redirectUris":[]}],"grants":[],"tokens":[]}',
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
        `"actor":"not-the-author-of-that-seed","grantedAt":1,"standing":true}],"tokens":[]}`,
    },
    {
      label: "a grant that does not say whether it stands",
      bytes:
        `{"version":1,"clients":[],"grants":[{"clientId":"a","actorSeed":"${SEED}",` +
        `"actor":"${SEED_AUTHOR}","grantedAt":1}],"tokens":[]}`,
    },
    {
      label: "a client with no generation",
      bytes:
        '{"version":1,"clients":[{"clientId":"a","clientName":"x","redirectUris":[],' +
        '"registeredAt":1}],"grants":[],"tokens":[]}',
    },
    {
      label: "a client whose generation is zero",
      bytes:
        '{"version":1,"clients":[{"clientId":"a","clientName":"x","redirectUris":[],' +
        '"registeredAt":1,"generation":0}],"grants":[],"tokens":[]}',
    },
    {
      // A file edited by hand must not be able to smuggle a forged row into `loam grant list`.
      label: "a client whose name carries a newline",
      bytes:
        '{"version":1,"clients":[{"clientId":"a","clientName":"x\\n    client   forged",' +
        '"redirectUris":[],"registeredAt":1,"generation":1}],"grants":[],"tokens":[]}',
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
