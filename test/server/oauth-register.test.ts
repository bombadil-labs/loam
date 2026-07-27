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

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSWORD, bootStore, createUser, dropHome, makeHome } from "./user-fixture.js";
import { oauthPath, readOAuthFile } from "../../src/server/oauth-file.js";
import {
  CLAUDE_ORIGIN,
  CLAUDE_REDIRECT,
  OTHER_ORIGIN,
  register,
  registerRaw,
  serveOAuth,
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
    await served.close();
    served = await serveOAuth(home);
    const secondBoot = await fetch(
      `${served.base}/oauth/authorize?` +
        new URLSearchParams({
          response_type: "code",
          client_id: first.clientId,
          redirect_uri: CLAUDE_REDIRECT,
          code_challenge: "x".repeat(43),
          code_challenge_method: "S256",
        }).toString(),
      { redirect: "manual" },
    );
    // No session, so it shows the login form — but it RECOGNISED the client, which an unknown id
    // would not have. An unknown id refuses with a named error instead.
    expect(secondBoot.status).toBe(200);
    expect(await secondBoot.text()).toMatch(/Sign in/);
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

  it("(g) a uri that is not an absolute URL, or carries a fragment, is refused", async () => {
    for (const bad of [
      "/api/mcp/auth_callback",
      "claude.ai/cb",
      `${CLAUDE_ORIGIN}/cb#fragment`,
      "javascript:alert(1)", // eslint-disable-line no-script-url
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
    // Without one, a stranger fills the operator's home one 201 at a time.
    await served.close();
    served = await serveOAuth(home, { oauth: { maxClients: 3 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) codes.push((await register(served.base)).status);
    expect(codes.filter((c) => c === 201).length).toBe(3);
    expect(codes.filter((c) => c === 400 || c === 429 || c === 503).length).toBe(2);
    expect(readOAuthFile(home).clients.length).toBe(3);
  });

  it("(f) a client_name longer than the door allows is refused rather than stored", async () => {
    const res = await register(served.base, { name: "n".repeat(4096) });
    expect(res.status).toBe(400);
    expect(readOAuthFile(home).clients).toEqual([]);
  });
});
