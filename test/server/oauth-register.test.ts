// §37 (T114), criteria (f) (g): dynamic client registration, and the fence around it.
//
// Registration CANNOT require a session, and that is not a convenience. Claude.ai registers itself
// before any human is present — there is no browser, no cookie, and nobody to type a password. So the
// endpoint is open by protocol, and the fence is a CONFIGURED allowlist of redirect origins.
//
// What the allowlist stops, stated once: without it a stranger registers a client named "Claude"
// pointing at a host they run, sends the operator a plausible authorize link, and walks away holding a
// writing identity in this store. That attack never needs to become the operator, which is why "the
// mint path cannot produce operator" is necessary and nowhere near sufficient.
//
// Both levels: the answer the door gives, AND what oauth.json holds afterwards.

import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD, bootStore, createUser, dropHome, makeHome, signIn } from "./user-fixture.js";
import { oauthPath, readOAuthFile } from "../../src/server/oauth-file.js";
import {
  CLAUDE_ORIGIN,
  CLAUDE_REDIRECT,
  OTHER_ORIGIN,
  approve,
  codeFrom,
  formTokenIn,
  getAuthorize,
  pkce,
  redeem,
  register,
  registerRaw,
  serveOAuth,
  wellFormedAuthorize,
  type ServedOAuth,
} from "./oauth-fixture.js";

vi.setConfig({ testTimeout: 20000 });

let home: string;
let served: ServedOAuth;

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
  served = await serveOAuth(home);
});
afterEach(async () => {
  await served?.close();
  dropHome(home);
});

describe("POST /oauth/register", () => {
  it("(f) answers a client_id, and the registration survives a restart", async () => {
    const first = await register(served.base, { name: "Claude" });
    expect(first.status).toBe(201);
    expect(first.clientId).not.toBe("");
    expect(first.body["client_name"]).toBe("Claude");
    expect(first.body["redirect_uris"]).toEqual([CLAUDE_REDIRECT]);
    // A public client: this door mints no secret, so there is none to leak or to rotate.
    expect(first.body["token_endpoint_auth_method"]).toBe("none");
    expect(first.body["client_secret"]).toBeUndefined();

    // At rest, in the home, before any restart — the delta level's analogue for a file.
    const onDisk = readOAuthFile(home);
    expect(onDisk.clients.map((c) => c.clientId)).toEqual([first.clientId]);
    expect(oauthPath(home)).toContain("oauth.json");

    // And a NEW server over the same home still knows the client. This is the criterion: claude.ai
    // registers once and expects to keep its id across every restart of the store.
    //
    // IT MUST BE ASKED WITH A SESSION. `getAuthorize` resolves the session BEFORE it looks at the
    // client, so a probe with no cookie gets the login form at 200 for a known id, an unknown id, and
    // an oauth.json the restart lost — three states one assertion cannot separate.
    await served.close();
    served = await serveOAuth(home);
    const session = await signIn(served.base);
    const reached = await getAuthorize(
      served.base,
      wellFormedAuthorize(first.clientId, pkce().challenge),
      session.cookie,
    );
    expect(reached.res.status).toBe(200);
    expect(reached.body).toMatch(/Approve/);
    expect(reached.body).toContain("Claude");
    expect(reached.body).toContain(first.clientId);
    // And the same server refuses an id it does not hold — so the line above is about THIS client
    // rather than about any client at all.
    const unknown = await getAuthorize(
      served.base,
      wellFormedAuthorize("connector-does-not-exist", pkce().challenge),
      session.cookie,
    );
    expect(unknown.res.status).toBe(400);
  });

  it("(f) a second registration is a DIFFERENT client, not an overwrite", async () => {
    const a = await register(served.base, { name: "Claude" });
    const b = await register(served.base, { name: "Claude" });
    expect(a.clientId).not.toBe(b.clientId);
    expect(readOAuthFile(home).clients.length).toBe(2);
  });

  it("(f) oauth.json is mode 0600 the moment registration creates it", async () => {
    await register(served.base);
    const mode = (await import("node:fs")).statSync(oauthPath(home)).mode & 0o777;
    // Windows does not honour POSIX modes; there the assertion below is vacuous and says so.
    if (process.platform !== "win32") expect(mode).toBe(0o600);
    // The file is JSON on every platform, and holding it at all is the point.
    expect(JSON.parse(readFileSync(oauthPath(home), "utf8"))).toHaveProperty("version", 1);
  });

  it("(g) a redirect_uri outside the configured allowlist is refused", async () => {
    const evil = await register(served.base, {
      name: "Claude",
      redirectUris: ["https://attacker.example/callback"],
    });
    expect(evil.status).toBe(400);
    expect(evil.body["error"]).toBe("invalid_redirect_uri");
    // Nothing was written: a refusal that still records the client would leave the attacker an id.
    expect(readOAuthFile(home).clients).toEqual([]);
  });

  it("(g) ALL the redirect uris must pass, not just the first", async () => {
    // The shape that slips through a loop that returns on the first match: one honest uri carrying a
    // hostile sibling. Whichever one the authorize step later accepts, the client holds both.
    const mixed = await register(served.base, {
      redirectUris: [CLAUDE_REDIRECT, "https://attacker.example/callback"],
    });
    expect(mixed.status).toBe(400);
    expect(readOAuthFile(home).clients).toEqual([]);
  });

  it("(g) an allowlisted ORIGIN admits any path at that origin, and no other origin", async () => {
    const ok = await register(served.base, { redirectUris: [`${OTHER_ORIGIN}/some/deep/path`] });
    expect(ok.status).toBe(201);
    // A subdomain is a different origin, and a suffix match is the classic way this fence fails open.
    for (const near of [
      `${CLAUDE_ORIGIN}.attacker.example/cb`,
      "https://evil-claude.ai/cb",
      "https://claude.ai.attacker.example/cb",
      "http://claude.ai/cb", // scheme is part of an origin
      "https://claude.ai:8443/cb", // so is the port
    ]) {
      const res = await register(served.base, { redirectUris: [near] });
      expect(res.status, `${near} was admitted`).toBe(400);
    }
  });

  it("(g) a redirect_uri carrying a control byte is refused, at the door and in the file", async () => {
    // `new URL()` STRIPS tab, LF and CR while parsing, so a hostile uri parses clean, passes the origin
    // and percent-transparency checks, and keeps its raw bytes in the stored string — where
    // `loam grant list` prints them and forges a whole connector row in the operator's only view of
    // what is registered. The rule the client_name got has to cover its sibling.
    for (const hostile of [
      `${CLAUDE_ORIGIN}/cb\n    1 live token\n  Claude\n    client   connector-forged`,
      `${CLAUDE_ORIGIN}/cb\r\nEvil`,
      `${CLAUDE_ORIGIN}/cb\tEvil`,
      `${CLAUDE_ORIGIN}/cb\u001b[2K`,
      `${CLAUDE_ORIGIN}/cb\u0000`,
      `${CLAUDE_ORIGIN}/cb\u2028`,
    ]) {
      const res = await register(served.base, { redirectUris: [hostile] });
      expect(res.status, `${JSON.stringify(hostile)} was admitted`).toBe(400);
    }
    expect(readOAuthFile(home).clients).toEqual([]);
    // And the file's own reader refuses one edited in by hand, symmetric with the name.
    writeFileSync(
      oauthPath(home),
      JSON.stringify({
        version: 1,
        clients: [
          {
            clientId: "a",
            clientName: "x",
            redirectUris: [`${CLAUDE_ORIGIN}/cb\n forged`],
            registeredAt: 1,
            generation: 1,
          },
        ],
        grants: [],
        tokens: [],
      }),
    );
    expect(() => readOAuthFile(home)).toThrow(/control character/);
  });

  it("(f) a client with a CODE IN FLIGHT is not evicted by a registration flood", async () => {
    // A grant appears only after a successful token MINT, so the whole interval from registration
    // through the consent page to redemption was evictable — and a sustained anonymous flood always
    // reaches the oldest, which is the pending legitimate client. The operator's approval would then die
    // at redemption. Consent already given must not be discarded by a stranger's traffic.
    await served.close();
    served = await serveOAuth(home, { oauth: { maxClients: 2 } });
    const session = await signIn(served.base);
    const mine = await register(served.base, { name: "Claude" });
    const secret = pkce();
    const params = wellFormedAuthorize(mine.clientId, secret.challenge);
    const page = await getAuthorize(served.base, params, session.cookie);
    const approved = await approve(served.base, params, {
      cookie: session.cookie,
      formToken: formTokenIn(page.body),
    });
    const code = codeFrom(approved)!;
    // Myk has approved. Nothing is minted yet, so there is no grant to protect it.
    expect(readOAuthFile(home).grants).toEqual([]);

    // The flood.
    for (let i = 0; i < 6; i += 1) await register(served.base);
    expect(readOAuthFile(home).clients.map((c) => c.clientId)).toContain(mine.clientId);

    // And the approval still redeems.
    const redeemed = await redeem(served.base, {
      grant_type: "authorization_code",
      code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: mine.clientId,
      code_verifier: secret.verifier,
    });
    expect(redeemed.res.status).toBe(200);
  });

  it("(g) a uri that is not an absolute URL, or carries a fragment, is refused", async () => {
    for (const bad of [
      "/api/mcp/auth_callback",
      "claude.ai/cb",
      `${CLAUDE_ORIGIN}/cb#fragment`,
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "",
    ]) {
      const res = await register(served.base, { redirectUris: [bad] });
      expect(res.status, `${bad} was admitted`).toBe(400);
    }
    expect(readOAuthFile(home).clients).toEqual([]);
  });

  it("(g) an EMPTY allowlist refuses every registration, and says why", async () => {
    // The default posture for a store whose operator never named an origin: §37 is off, loudly, rather
    // than open. A door that registered anybody while the operator had configured nothing is the hole.
    await served.close();
    served = await serveOAuth(home, { oauth: { allowRedirectOrigins: [] } });
    const res = await register(served.base);
    expect(res.status).toBe(400);
    expect(String(res.body["error_description"])).toMatch(/--oauth-allow-redirect/);
    expect(readOAuthFile(home).clients).toEqual([]);
  });

  it("(f) a malformed registration body is refused, and nothing is written", async () => {
    for (const body of [
      {},
      { client_name: "Claude" }, // no redirect_uris
      { client_name: "Claude", redirect_uris: [] },
      { client_name: "Claude", redirect_uris: CLAUDE_REDIRECT }, // a string, not an array
      { client_name: 7, redirect_uris: [CLAUDE_REDIRECT] },
      { client_name: "Claude", redirect_uris: [CLAUDE_REDIRECT, 7] },
      [],
      null,
    ]) {
      const res = await registerRaw(served.base, body);
      expect(res.status, `${JSON.stringify(body)} was admitted`).toBe(400);
      expect(typeof res.body["error"]).toBe("string");
    }
    expect(readOAuthFile(home).clients).toEqual([]);
  });

  it("(f) registration is bounded: a flood cannot grow oauth.json without limit", async () => {
    // The endpoint takes no session by design, so the only thing between it and the disk is a cap.
    await served.close();
    served = await serveOAuth(home, { oauth: { maxClients: 3 } });
    for (let i = 0; i < 8; i += 1) expect((await register(served.base)).status).toBe(201);
    expect(readOAuthFile(home).clients.length).toBe(3);
  });

  it("(f) at the cap the OLDEST NEVER-APPROVED registration is evicted, not the newest refused", async () => {
    // A plain refusal at the cap is a LOCKOUT, and this door takes no credential: a stranger files
    // maxClients junk registrations and the real connector is refused forever, with no command that
    // removes one. So the flood evicts its own earlier entries and the newcomer always gets in.
    await served.close();
    served = await serveOAuth(home, { oauth: { maxClients: 2 } });
    const first = await register(served.base, { name: "oldest" });
    const second = await register(served.base, { name: "middle" });
    const third = await register(served.base, { name: "newest" });
    expect([first.status, second.status, third.status]).toEqual([201, 201, 201]);
    const held = readOAuthFile(home).clients.map((c) => c.clientId);
    expect(held).not.toContain(first.clientId);
    expect(held).toContain(third.clientId);
    // And the evicted id is really gone — authorize must not still recognise it.
    const session = await signIn(served.base);
    const stale = await getAuthorize(
      served.base,
      wellFormedAuthorize(first.clientId, pkce().challenge),
      session.cookie,
    );
    expect(stale.res.status).toBe(400);
  });

  it("(f) an APPROVED connector is never evicted, and a full house then refuses", async () => {
    // The other side of the eviction, and the one that matters: the operator consented to this
    // connector and its seed signs deltas the store holds. A flood must not be able to displace it.
    //
    // maxClients is ONE here on purpose. With room to spare, a flood cycles through the unapproved
    // slots forever and never sees a refusal — which is the design, not a gap. The refusal arrives only
    // when every slot is approved, and that is the state this rail needs to reach.
    await served.close();
    served = await serveOAuth(home, { oauth: { maxClients: 1 } });
    const session = await signIn(served.base);
    const mine = await register(served.base, { name: "Claude" });
    const secret = pkce();
    const params = wellFormedAuthorize(mine.clientId, secret.challenge);
    const page = await getAuthorize(served.base, params, session.cookie);
    const approved = await approve(served.base, params, {
      cookie: session.cookie,
      formToken: formTokenIn(page.body),
    });
    const code = codeFrom(approved)!;
    const redeemed = await redeem(served.base, {
      grant_type: "authorization_code",
      code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: mine.clientId,
      code_verifier: secret.verifier,
    });
    expect(redeemed.res.status).toBe(200);

    // Now flood. Every round refuses, because the only slot is an approved connector's.
    const outcomes: number[] = [];
    for (let i = 0; i < 4; i += 1) outcomes.push((await register(served.base)).status);
    expect(outcomes).toEqual([400, 400, 400, 400]);
    const after = readOAuthFile(home);
    expect(after.clients.map((c) => c.clientId)).toEqual([mine.clientId]);
    expect(after.grants.map((g) => g.clientId)).toEqual([mine.clientId]);
    // And the connector still works: a refusal storm must not have touched its token.
    const listed = await fetch(`${served.base}/default/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(redeemed.body["access_token"])}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(listed.status).toBe(200);
  });

  it("(f) a client_name carrying a newline or an escape is refused", async () => {
    // The name reaches the operator's TERMINAL through `loam grant list`, and this door takes no
    // credential — so a newline forges a whole row in the operator's only view of what is registered,
    // and an ANSI escape erases the caller's own.
    for (const hostile of [
      "Claude\n    client   connector-forged",
      "Claude\r\nEvil",
      "Claude\u001b[2K\rEvil",
      "Claude\u0000",
      "Claude\u2028Evil",
      "Claude\u009b2K",
    ]) {
      const res = await register(served.base, { name: hostile });
      expect(res.status, `${JSON.stringify(hostile)} was admitted`).toBe(400);
    }
    expect(readOAuthFile(home).clients).toEqual([]);
    // A name with punctuation and non-ASCII letters is fine — the rule is control bytes, not ASCII.
    expect((await register(served.base, { name: "Claude — Myk's connector ✨" })).status).toBe(201);
  });

  it("(f) a client_name longer than the door allows is refused rather than stored", async () => {
    const res = await register(served.base, { name: "n".repeat(4096) });
    expect(res.status).toBe(400);
    expect(readOAuthFile(home).clients).toEqual([]);
  });
});
