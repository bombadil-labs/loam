import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import {
  oauthPath,
  readOAuthFile,
  writeOAuthFile,
  type OAuthGrant,
} from "../../src/server/oauth-file.js";

vi.setConfig({ testTimeout: 20000 });

const OP_SEED = "3d".repeat(32);
const PUBLIC_URL = "https://loam.example:8443";
const CLAUDE_ORIGIN = "https://claude.ai";
const CLAUDE_REDIRECT = `${CLAUDE_ORIGIN}/api/mcp/auth_callback`;
const OTHER_ORIGIN = "https://example.test";

const homes: string[] = [];
const handles: ServerHandle[] = [];
const gateways: Gateway[] = [];

afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (gateways.length > 0) await gateways.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const makeHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "loam-oauth-register-"));
  homes.push(home);
  return home;
};

const bootGateway = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
  gateways.push(gw);
  return gw;
};

interface ServeOpts {
  readonly allowRedirectOrigins?: readonly string[];
  readonly maxClients?: number;
  readonly publicUrl?: string | null;
  readonly faults?: string[];
}

interface Served {
  readonly base: string;
  readonly home: string;
  close(): Promise<void>;
}

const serveOAuth = async (home: string, opts: ServeOpts = {}): Promise<Served> => {
  const gw = await bootGateway();
  const publicUrl = opts.publicUrl === null ? undefined : (opts.publicUrl ?? PUBLIC_URL);
  const handle = await serve({
    mounts: { default: gw },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    ...(publicUrl === undefined ? {} : { publicUrl }),
    connectors: {
      home,
      allowRedirectOrigins: opts.allowRedirectOrigins ?? [CLAUDE_ORIGIN, OTHER_ORIGIN],
      ...(opts.maxClients === undefined ? {} : { maxClients: opts.maxClients }),
      ...(opts.faults === undefined
        ? {}
        : { onFault: (message: string) => opts.faults!.push(message) }),
    },
  });
  handles.push(handle);
  return {
    base: handle.url,
    home,
    close: async () => {
      await handle.close();
      const i = handles.indexOf(handle);
      if (i >= 0) handles.splice(i, 1);
    },
  };
};

interface RegisterResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly clientId: string;
}

const registerRaw = async (base: string, body: unknown): Promise<RegisterResult> => {
  const res = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { _raw: text };
  }
  const id = parsed["client_id"];
  return { status: res.status, body: parsed, clientId: typeof id === "string" ? id : "" };
};

const register = async (
  base: string,
  opts: { name?: string; redirectUris?: readonly string[] } = {},
): Promise<RegisterResult> =>
  registerRaw(base, {
    client_name: opts.name ?? "Claude",
    redirect_uris: opts.redirectUris ?? [CLAUDE_REDIRECT],
  });

const heldIds = (home: string): string[] => readOAuthFile(home).clients.map((c) => c.clientId);

const plantGrant = (home: string, clientId: string): void => {
  const actorSeed = randomBytes(32).toString("hex");
  const grant: OAuthGrant = {
    clientId,
    actorSeed,
    actor: authorForSeed(actorSeed),
    grantedAt: Date.now(),
    standing: true,
  };
  const file = readOAuthFile(home);
  writeOAuthFile(home, { ...file, grants: [...file.grants, grant] });
};

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("T134 — (1) registration is fenced by a configured allowlist and needs no session", () => {
  it("answers a client_id with no session, and holds a public client at rest", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
    const res = await register(served.base, { name: "Claude" });
    expect(res.status).toBe(201);
    expect(res.clientId).not.toBe("");
    expect(res.body["client_name"]).toBe("Claude");
    expect(res.body["redirect_uris"]).toEqual([CLAUDE_REDIRECT]);
    expect(res.body["token_endpoint_auth_method"]).toBe("none");
    expect(res.body["client_secret"]).toBeUndefined();

    const onDisk = readOAuthFile(home);
    expect(onDisk.clients.map((c) => c.clientId)).toEqual([res.clientId]);
    expect(oauthPath(home)).toContain("oauth.json");
  });

  it("an EMPTY allowlist refuses every registration, and says why", async () => {
    const home = makeHome();
    const served = await serveOAuth(home, { allowRedirectOrigins: [] });
    const res = await register(served.base);
    expect(res.status).toBe(400);
    expect(String(res.body["error_description"])).toMatch(/--oauth-allow-redirect/);
    expect(readOAuthFile(home).clients).toEqual([]);
  });

  it("a malformed registration body is refused, and nothing is written", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
    for (const body of [
      {},
      { client_name: "Claude" },
      { client_name: "Claude", redirect_uris: [] },
      { client_name: "Claude", redirect_uris: CLAUDE_REDIRECT },
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

  it("more redirect_uris than the door holds is refused; exactly the bound is admitted", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
    const uri = (i: number): string => `${CLAUDE_ORIGIN}/cb${i}`;
    const atBound = Array.from({ length: 8 }, (_, i) => uri(i));
    expect((await register(served.base, { redirectUris: atBound })).status).toBe(201);
    const overBound = Array.from({ length: 9 }, (_, i) => uri(i));
    const over = await register(served.base, { redirectUris: overBound });
    expect(over.status).toBe(400);
    expect(over.body["error"]).toBe("invalid_redirect_uri");
  });

  it("a single redirect_uri longer than the door holds is refused (MAX_URI edge)", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
    const pad = (n: number): string => `${CLAUDE_ORIGIN}/${"a".repeat(n)}`;
    const prefix = `${CLAUDE_ORIGIN}/`.length;
    expect((await register(served.base, { redirectUris: [pad(2048 - prefix)] })).status).toBe(201);
    const tooLong = await register(served.base, { redirectUris: [pad(2049 - prefix)] });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body["error"]).toBe("invalid_redirect_uri");
  });

  it("only POST is answered — GET/DELETE get a 405, not a registration", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
    for (const method of ["GET", "DELETE", "PUT"]) {
      const res = await fetch(`${served.base}/oauth/register`, { method });
      expect(res.status, `${method} was not a 405`).toBe(405);
    }
    expect(readOAuthFile(home).clients).toEqual([]);
  });
});

describe("T134 — (2) a redirect_uri outside the allowlist is refused AT REGISTRATION", () => {
  it("an off-allowlist origin is refused, and nothing is written", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
    const evil = await register(served.base, {
      redirectUris: ["https://attacker.example/callback"],
    });
    expect(evil.status).toBe(400);
    expect(evil.body["error"]).toBe("invalid_redirect_uri");
    expect(readOAuthFile(home).clients).toEqual([]);
    const wire = JSON.stringify(evil.body);
    expect(wire).not.toContain(OTHER_ORIGIN);
    expect(wire).not.toContain("--oauth-allow-redirect");
  });

  it("ALL the redirect uris must pass, not just the first", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
    const mixed = await register(served.base, {
      redirectUris: [CLAUDE_REDIRECT, "https://attacker.example/callback"],
    });
    expect(mixed.status).toBe(400);
    expect(readOAuthFile(home).clients).toEqual([]);
  });

  it("an allowlisted ORIGIN admits any path at that origin, and no other origin", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
    const ok = await register(served.base, { redirectUris: [`${OTHER_ORIGIN}/some/deep/path`] });
    expect(ok.status).toBe(201);
    for (const near of [
      `${CLAUDE_ORIGIN}.attacker.example/cb`,
      "https://evil-claude.ai/cb",
      "https://claude.ai.attacker.example/cb",
      "http://claude.ai/cb",
      "https://claude.ai:8443/cb",
    ]) {
      const res = await register(served.base, { redirectUris: [near] });
      expect(res.status, `${near} was admitted`).toBe(400);
    }
  });

  it("a uri that is not an absolute URL, or carries a fragment, is refused", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
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
});

describe("T134 — (3) control bytes are refused in EVERY operator-facing field", () => {
  it("a client_name carrying a control byte or escape is refused", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
    for (const hostile of [
      "Claude\n    client   connector-forged",
      "Claude\r\nEvil",
      "Claude\u001b[2K\rEvil",
      "Claude\u0000",
      "Claude\u2028Evil",
      "Claude\u009b2K",
      "Claude\tEvil",
    ]) {
      const res = await register(served.base, { name: hostile });
      expect(res.status, `${JSON.stringify(hostile)} was admitted`).toBe(400);
    }
    expect(readOAuthFile(home).clients).toEqual([]);
    expect((await register(served.base, { name: "Claude — Myk's connector ✨" })).status).toBe(201);
  });

  it("a redirect_uri carrying a control byte is refused, at the door and in the file", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
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
  });
});

describe("T134 — (4) the cap EVICTS, it does not refuse", () => {
  it("registration is bounded: a flood cannot grow oauth.json without limit", async () => {
    const home = makeHome();
    const served = await serveOAuth(home, { maxClients: 3 });
    for (let i = 0; i < 8; i += 1) expect((await register(served.base)).status).toBe(201);
    expect(readOAuthFile(home).clients.length).toBe(3);
  });

  it("at the cap the OLDEST never-approved registration is evicted, not the newest refused", async () => {
    const home = makeHome();
    const served = await serveOAuth(home, { maxClients: 2 });
    const first = await register(served.base, { name: "oldest" });
    await wait(3);
    const second = await register(served.base, { name: "middle" });
    await wait(3);
    const third = await register(served.base, { name: "newest" });
    expect([first.status, second.status, third.status]).toEqual([201, 201, 201]);
    const held = heldIds(home);
    expect(held).not.toContain(first.clientId);
    expect(held).toContain(third.clientId);
  });
});

describe("T134 — (5) an approved client is never evicted; an unpinned one still is", () => {
  it("a client with a GRANT RECORD survives a registration flood", async () => {
    const home = makeHome();
    const served = await serveOAuth(home, { maxClients: 2 });
    const keeper = await register(served.base, { name: "Claude" });
    plantGrant(home, keeper.clientId);
    expect(readOAuthFile(home).grants.map((g) => g.clientId)).toEqual([keeper.clientId]);
    await register(served.base, { name: "filler" });

    for (let i = 0; i < 6; i += 1) await register(served.base);
    expect(heldIds(home)).toContain(keeper.clientId);
    expect(readOAuthFile(home).grants.map((g) => g.clientId)).toEqual([keeper.clientId]);
  });

  it("a client with NO grant is still evictable — the pin is not a blanket", async () => {
    const home = makeHome();
    const served = await serveOAuth(home, { maxClients: 2 });
    const stranger = await register(served.base, { name: "no grant" });
    await register(served.base);
    for (let i = 0; i < 3; i += 1) await register(served.base);
    expect(heldIds(home)).not.toContain(stranger.clientId);
  });

  it("when every slot is pinned by a grant, a full house refuses rather than evicting", async () => {
    const home = makeHome();
    const served = await serveOAuth(home, { maxClients: 1 });
    const keeper = await register(served.base, { name: "Claude" });
    plantGrant(home, keeper.clientId);
    const outcomes: number[] = [];
    for (let i = 0; i < 4; i += 1) outcomes.push((await register(served.base)).status);
    expect(outcomes).toEqual([400, 400, 400, 400]);
    const after = readOAuthFile(home);
    expect(after.clients.map((c) => c.clientId)).toEqual([keeper.clientId]);
    expect(after.grants.map((g) => g.clientId)).toEqual([keeper.clientId]);
  });
});

describe("T134 — (6) a registration survives a restart", () => {
  it("a new server over the same home keeps it, and does not clobber it", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
    const first = await register(served.base, { name: "Claude" });
    expect(first.status).toBe(201);
    await served.close();

    const restarted = await serveOAuth(home);
    const second = await register(restarted.base, { name: "second" });
    expect(second.status).toBe(201);
    const ids = heldIds(home);
    expect(ids).toContain(first.clientId);
    expect(ids).toContain(second.clientId);
    expect(new Set(ids).size).toBe(2);
  });

  it("oauth.json is mode 0600 the moment registration creates it", async () => {
    const home = makeHome();
    const served = await serveOAuth(home);
    await register(served.base);
    const mode = statSync(oauthPath(home)).mode & 0o777;
    if (process.platform !== "win32") expect(mode).toBe(0o600);
    expect(readOAuthFile(home).version).toBe(1);
  });
});

describe("T134 — (7) a file fault answers a fixed string to the caller, the detail to onFault", () => {
  it("an unparseable oauth.json refuses 503 without leaking the home path", async () => {
    const home = makeHome();
    const faults: string[] = [];
    const served = await serveOAuth(home, { faults });
    writeFileSync(oauthPath(home), "{ this is not json");
    const res = await register(served.base);
    expect(res.status).toBe(503);
    expect(res.body["error"]).toBe("temporarily_unavailable");
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain(home);
    expect(wire).not.toContain("oauth.json");
    expect(wire).not.toContain("--oauth-allow-redirect");
    expect(faults.some((m) => m.includes(oauthPath(home)))).toBe(true);
  });
});

describe("T134 — (8) the allowlist is boot-validated, and registration needs a public url", () => {
  it("serve refuses a malformed allowlist origin at boot", async () => {
    const home = makeHome();
    for (const origin of [
      "https://claude.ai:443",
      "https://claude.ai/cb",
      "http://claude.ai",
      "not a url at all",
    ]) {
      await expect(
        serveOAuth(home, { allowRedirectOrigins: [origin] }),
        `${origin} booted`,
      ).rejects.toThrow();
    }
  });

  it("serve refuses connectors without a public url", async () => {
    const home = makeHome();
    await expect(serveOAuth(home, { publicUrl: null })).rejects.toThrow(/public/i);
  });
});
