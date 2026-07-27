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

  it(
    "(f) a client is pinned across its REDEMPTION, not just up to it",
    { timeout: 60_000 },
    async () => {
      // THE GAP BETWEEN THE OTHER TWO PINS. `postToken` burns the code before it awaits the mint, and
      // the grant appears only once that mint writes it — so in between, the client holds no code and no
      // grant. A registration that RUNS in that window sees it unpinned and evicts it, and the mint then
      // answers 400 with the code already spent. The operator's approval is gone for good.
      //
      // THE ORDER THE QUEUE MUST BE IN, because getting it backwards proves nothing: the registration has
      // to sit AHEAD of the victim's mint. Every one of these doors shares one serialization chain, so
      // parking the victim's own mint at the head would simply block the registration behind it and the
      // window would never open.
      //
      //   [a decoy mint, parked by hand] [the registration] [the victim's mint]
      //
      // The decoy is what holds the chain open. The registration is confirmed QUEUED by observing that
      // its own request has not answered — that is a real observation, not a sleep. Only the victim's
      // redeem needs a settle, and its failure direction is a test that proves nothing rather than a
      // flake; the revert-probe in the commit message is what shows this rail bites.
      let release: (() => void) | undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      let parked = false;

      await served.close();
      served = await serveOAuth(home, {
        oauth: { maxClients: 3 },
        prepare: (gateway) => {
          // Patch the gateway this test constructed — no production seam, and the real append still runs.
          const append = gateway.append.bind(gateway);
          gateway.append = async (deltas) => {
            if (!parked) {
              parked = true;
              await held;
            }
            return append(deltas);
          };
        },
      });
      const session = await signIn(served.base);

      // The VICTIM registers first, so it is the oldest evictable entry. Then the decoy, then a filler
      // that brings the table to its cap.
      const victim = await register(served.base, { name: "Claude" });
      const decoy = await register(served.base, { name: "decoy" });
      await register(served.base, { name: "filler" });
      expect(readOAuthFile(home).clients.length).toBe(3);

      const codeFor = async (clientId: string): Promise<{ code: string; verifier: string }> => {
        const secret = pkce();
        const params = wellFormedAuthorize(clientId, secret.challenge);
        const page = await getAuthorize(served.base, params, session.cookie);
        const approved = await approve(served.base, params, {
          cookie: session.cookie,
          formToken: formTokenIn(page.body),
        });
        return { code: codeFrom(approved)!, verifier: secret.verifier };
      };
      const decoyCode = await codeFor(decoy.clientId);
      const victimCode = await codeFor(victim.clientId);

      // 1. The decoy's mint parks the chain on the held append.
      const decoyRedeem = redeem(served.base, {
        grant_type: "authorization_code",
        code: decoyCode.code,
        redirect_uri: CLAUDE_REDIRECT,
        client_id: decoy.clientId,
        code_verifier: decoyCode.verifier,
      });
      const parkedFrom = Date.now();
      while (!parked && Date.now() - parkedFrom < 20_000) {
        await new Promise((r) => setTimeout(r, 2));
      }
      expect(parked).toBe(true);

      let decoyOut: Awaited<typeof decoyRedeem> | undefined;
      let floodOut: Awaited<ReturnType<typeof register>> | undefined;
      let victimOut: Awaited<ReturnType<typeof redeem>> | undefined;
      let flood: ReturnType<typeof register> | undefined;
      let victimRedeem: ReturnType<typeof redeem> | undefined;
      try {
        // 2. A registration, CONFIRMED queued: its request cannot answer while the chain is parked.
        const marker = Symbol("pending");
        flood = register(served.base, { name: "flood" });
        const settled = await Promise.race([
          flood,
          new Promise((r) => setTimeout(() => r(marker), 250)),
        ]);
        expect(settled).toBe(marker);

        // 3. The victim redeems. The burn is synchronous on arrival; its mint enqueues behind the flood.
        victimRedeem = redeem(served.base, {
          grant_type: "authorization_code",
          code: victimCode.code,
          redirect_uri: CLAUDE_REDIRECT,
          client_id: victim.clientId,
          code_verifier: victimCode.verifier,
        });

        // CONFIRM THE BURN rather than sleeping and hoping. A second redemption of the same code is
        // refused with a message only a SPENT code produces, and that path returns before it touches the
        // queue — so the probe is inert once the burn has happened. If the burn has NOT happened, the
        // probe spends the code itself and fails at PKCE, which turns this rail RED at step 4 rather than
        // letting it pass having proved nothing. A silent false pass was the shape to avoid.
        const burnedFrom = Date.now();
        let burned = false;
        while (!burned && Date.now() - burnedFrom < 20_000) {
          const probe = await redeem(served.base, {
            grant_type: "authorization_code",
            code: victimCode.code,
            redirect_uri: CLAUDE_REDIRECT,
            client_id: victim.clientId,
            code_verifier: "not-the-verifier-this-code-was-minted-against",
          });
          const why = probe.body["error_description"];
          burned = typeof why === "string" && /not one this store is holding/.test(why);
          if (!burned) await new Promise((r) => setTimeout(r, 5));
        }
        expect(burned).toBe(true);

        // 4. Drain. The flood runs while the victim holds neither a code nor a grant.
        release!();
        [decoyOut, floodOut, victimOut] = await Promise.all([decoyRedeem, flood, victimRedeem]);
      } finally {
        // A failure above must not leave the append parked: the chain would stay wedged and `afterEach`
        // would close against an in-flight write, turning one assertion into a timeout charged to a
        // later test.
        release!();
        await Promise.allSettled([decoyRedeem, flood, victimRedeem]);
      }

      // Narrowed rather than merely asserted, so the reads below need no non-null operators.
      if (decoyOut === undefined || floodOut === undefined || victimOut === undefined) {
        throw new Error("the flow did not complete, so there is nothing to assert about it");
      }
      expect(decoyOut.res.status).toBe(200);
      expect(floodOut.status).toBe(201);
      // THE ASSERTION. Without the redeeming pin the flood evicts the victim and this is a 400.
      expect(victimOut.res.status).toBe(200);
      expect(victimOut.body["access_token"]).toMatch(/.+/);
      const file = readOAuthFile(home);
      expect(file.clients.map((c) => c.clientId)).toContain(victim.clientId);
      expect(file.grants.map((g) => g.clientId).sort()).toEqual(
        [decoy.clientId, victim.clientId].sort(),
      );
    },
  );

  it("(f) an approved-but-unredeemed client survives a registration flood", async () => {
    // The pin's EXISTENCE, and this rail is what protects it: remove the code from the pinned set and
    // this goes red, because a client with a code but no grant is otherwise the oldest evictable entry.
    //
    // WHAT IT DOES NOT REACH, measured rather than assumed: whether the pinned set is read INSIDE the
    // locked callback or snapshotted before it. Every registration here snapshots after the code was
    // minted, so both forms pass. The rail above it — the redemption window — is the one that reaches
    // a queue ordering, and it does so by holding the ground append open rather than by racing a clock.
    await served.close();
    served = await serveOAuth(home, { oauth: { maxClients: 2 } });
    const session = await signIn(served.base);

    // X registers first, so it is the OLDEST evictable entry.
    const x = await register(served.base, { name: "Claude" });
    expect(x.status).toBe(201);
    // A second registration fills the table.
    await register(served.base);
    expect(readOAuthFile(home).clients.length).toBe(2);

    // Now the operator approves X. A code exists; no grant does yet.
    const secret = pkce();
    const params = wellFormedAuthorize(x.clientId, secret.challenge);
    const page = await getAuthorize(served.base, params, session.cookie);
    const approved = await approve(served.base, params, {
      cookie: session.cookie,
      formToken: formTokenIn(page.body),
    });
    const code = codeFrom(approved)!;
    expect(readOAuthFile(home).grants).toEqual([]);

    // The flood arrives. X must survive every round of it.
    for (let i = 0; i < 6; i += 1) await register(served.base);
    expect(readOAuthFile(home).clients.map((c) => c.clientId)).toContain(x.clientId);

    // And the approval still redeems — the object-level half of the same claim.
    const redeemed = await redeem(served.base, {
      grant_type: "authorization_code",
      code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: x.clientId,
      code_verifier: secret.verifier,
    });
    expect(redeemed.res.status).toBe(200);
  });

  it("(f) a client with NO code in flight is still evictable — the pin is not a blanket", async () => {
    // The other side. A pin that protected every registered client would be the lockout this eviction
    // exists to prevent, so the rail above must not pass by pinning everything.
    await served.close();
    served = await serveOAuth(home, { oauth: { maxClients: 2 } });
    const stranger = await register(served.base, { name: "no code, no grant" });
    await register(served.base);
    for (let i = 0; i < 3; i += 1) await register(served.base);
    expect(readOAuthFile(home).clients.map((c) => c.clientId)).not.toContain(stranger.clientId);
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
