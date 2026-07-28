// T133 — §37 phase 12/15: discovery and the 401. Two RFC well-known documents and a
// `WWW-Authenticate` challenge on the MCP door's refusal. This phase mints nothing — no client, no
// code, no token — so there is no door here for a rail to probe past discovery itself.
//
// WHAT THIS FILE DOES NOT ASSERT: `fsync`-shaped or filesystem-level claims (there is no file in
// this phase) and the raw `Host` header — the WHATWG `fetch` used throughout forbids setting it
// (Node silently keeps the real one), so the "foreign Host" half of criterion (e) is covered by the
// `req.headers` grep in the working spec instead; this file covers its `X-Forwarded-*` half, which
// `fetch` does allow.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

vi.setConfig({ testTimeout: 15000 }); // real listening servers

import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { publicClaims } from "../../src/gateway/public.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import {
  CONNECTOR_SCOPE,
  authorizationServerDocument,
  canonicalPublicUrl,
  challengeFor,
  issuerFor,
  makeOAuthDoors,
  protectedResourceDocument,
  publicUrlDefect,
} from "../../src/server/oauth.js";

const OP_SEED = "7c".repeat(32);
const OP = authorForSeed(OP_SEED);
const PUBLIC_URL = "https://loam.example:8443"; // deliberately NOT the local test server's address

const boot = async (opts: { public?: boolean } = {}): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  await gw.append([observed(FERN, "height", 1, 1000, OP_SEED)]);
  if (opts.public === true) {
    await gw.append([signClaims(publicClaims(["Plant"], OP, 10_000), OP_SEED)]);
  }
  return gw;
};

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

const ask = async (
  base: string,
  path: string,
  init: { token?: string; method?: string; forwardedHost?: string } = {},
): Promise<Answer> => {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers["authorization"] = `Bearer ${init.token}`;
  if (init.forwardedHost !== undefined) {
    headers["x-forwarded-host"] = init.forwardedHost;
    headers["x-forwarded-proto"] = "https";
  }
  const res = await fetch(`${base}${path}`, { method: init.method ?? "GET", headers });
  return { status: res.status, headers: res.headers, text: await res.text() };
};

describe("T133 — the discovery documents are pure functions of one configured string", () => {
  it("(a) issuerFor is the one place the issuer is computed", () => {
    for (const raw of ["http://x:1", "http://x:1/"]) {
      const issuer = issuerFor(raw);
      expect(authorizationServerDocument(raw)["issuer"]).toBe(issuer);
      const resource = protectedResourceDocument(raw) as {
        authorization_servers: readonly string[];
      };
      expect(resource.authorization_servers[0]).toBe(issuer);
      expect(challengeFor(raw)).toContain(`"${issuer}/.well-known/oauth-protected-resource"`);
    }
    // Both spellings agree with each other, which is what "one function" buys.
    expect(issuerFor("http://x:1")).toBe(issuerFor("http://x:1/"));
  });

  it("(b) the protected-resource document: RFC 9728 shape, off ONE issuer", () => {
    const doc = protectedResourceDocument(PUBLIC_URL) as Record<string, unknown>;
    expect(doc["resource"]).toBe(issuerFor(PUBLIC_URL));
    expect(doc["authorization_servers"]).toEqual([issuerFor(PUBLIC_URL)]);
    expect(doc["bearer_methods_supported"]).toEqual(["header"]);
    expect(doc["scopes_supported"]).toEqual([CONNECTOR_SCOPE]);
  });

  it("(c) the authorization-server document: RFC 8414 shape, pinned endpoint paths", () => {
    const doc = authorizationServerDocument(PUBLIC_URL) as Record<string, unknown>;
    const issuer = issuerFor(PUBLIC_URL);
    expect(doc["issuer"]).toBe(issuer);
    expect(doc["authorization_endpoint"]).toBe(`${issuer}/oauth/authorize`);
    expect(doc["token_endpoint"]).toBe(`${issuer}/oauth/token`);
    expect(doc["registration_endpoint"]).toBe(`${issuer}/oauth/register`);
    expect(doc["response_types_supported"]).toEqual(["code"]);
    expect(doc["grant_types_supported"]).toEqual(["authorization_code"]);
    expect(doc["scopes_supported"]).toEqual([CONNECTOR_SCOPE]);
  });

  it("(d) PKCE S256 only, and a public client with no secret — EXACT lists, not a superset check", () => {
    const doc = authorizationServerDocument(PUBLIC_URL) as Record<string, unknown>;
    // toEqual, not toContain: a widened list that still permitted "plain" alongside "S256" would
    // pass a .toContain("S256") assertion while reopening exactly the hole PKCE closes.
    expect(doc["code_challenge_methods_supported"]).toEqual(["S256"]);
    expect(doc["token_endpoint_auth_methods_supported"]).toEqual(["none"]);
  });

  it("(l) challengeFor is a pure function: same input, same output, hand-derived independently", () => {
    const first = challengeFor(PUBLIC_URL);
    const second = challengeFor(PUBLIC_URL);
    expect(first).toBe(second);
    // Hand-derived expectation, not a comparison of the function to itself (H10): the literal
    // shape a rail must catch a regression against is written out here, independently.
    expect(first).toBe(
      `Bearer resource_metadata="${issuerFor(PUBLIC_URL)}/.well-known/oauth-protected-resource"`,
    );
  });
});

describe("T133 — (b2) --public-url is an http(s) origin, case-insensitively, with no path", () => {
  it.each([
    ["http://x:1/store", /origin/i],
    ["http://x:1?q=1", /origin/i],
    ["https://x:443", /origin/i],
    ["ws://x:1", /http/i],
    ["not a url", /absolute/i],
  ])("refuses %s", (raw, expected) => {
    expect(publicUrlDefect(raw)).toMatch(expected);
  });

  it.each([["http://x:1"], ["http://x:1/"], ["http://MyHost:1"]])("accepts %s", (raw) => {
    expect(publicUrlDefect(raw)).toBeUndefined();
  });

  it("lowercases the canonical form — a document never advertises a differently-cased issuer", () => {
    expect(canonicalPublicUrl("http://MyHost:1")).toBe("http://myhost:1");
    expect(canonicalPublicUrl("http://x:1/")).toBe(canonicalPublicUrl("http://x:1"));
  });

  it("serve() boots with a good --public-url and refuses a bad one", async () => {
    const gw = await boot();
    await expect(
      serve({
        mounts: { garden: gw },
        tokens: { t: { operator: true } },
        port: 0,
        publicUrl: "http://x:1/store",
      }),
    ).rejects.toThrow(/origin/i);
    const handle = await serve({
      mounts: { garden: gw },
      tokens: { t: { operator: true } },
      port: 0,
      publicUrl: "http://x:1",
    });
    await handle.close();
    await gw.close();
  });
});

describe("T133 — the well-known documents are served, off configured publicUrl alone", () => {
  let garden: Gateway; // has a public declaration — exercises http.ts's public-surface path
  let meadow: Gateway; // exists, no public declaration
  let handle: ServerHandle;
  let base: string;

  beforeEach(async () => {
    garden = await boot({ public: true });
    meadow = await boot();
    handle = await serve({
      mounts: { garden, meadow },
      tokens: { "op-token": { operator: true } },
      port: 0,
      host: "127.0.0.1",
      publicUrl: PUBLIC_URL,
    });
    base = handle.url;
  });
  afterEach(async () => {
    await handle.close();
    await garden.close();
    await meadow.close();
  });

  it("(b) GET /.well-known/oauth-protected-resource — 200, JSON, CORS, the exact document", async () => {
    const answer = await ask(base, "/.well-known/oauth-protected-resource");
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toContain("application/json");
    expect(answer.headers.get("access-control-allow-origin")).toBe("*");
    expect(JSON.parse(answer.text)).toEqual(protectedResourceDocument(PUBLIC_URL));
  });

  it("(c) GET /.well-known/oauth-authorization-server — 200, JSON, CORS, the exact document", async () => {
    const answer = await ask(base, "/.well-known/oauth-authorization-server");
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(answer.text)).toEqual(authorizationServerDocument(PUBLIC_URL));
  });

  it("(e) a foreign X-Forwarded-Host/Proto changes nothing — the document ignores req.headers", async () => {
    const baseline = await ask(base, "/.well-known/oauth-protected-resource");
    const hostile = await ask(base, "/.well-known/oauth-protected-resource", {
      forwardedHost: "evil.example",
    });
    expect(hostile.text).toBe(baseline.text);
    const baselineAs = await ask(base, "/.well-known/oauth-authorization-server");
    const hostileAs = await ask(base, "/.well-known/oauth-authorization-server", {
      forwardedHost: "evil.example",
    });
    expect(hostileAs.text).toBe(baselineAs.text);
  });

  it("(f) neither well-known path answers anything but GET/HEAD", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-authorization-server",
    ]) {
      const posted = await ask(base, path, { method: "POST" });
      expect(posted.status).toBe(405);
      expect(posted.headers.get("allow")).toBe("GET, HEAD");
      const deleted = await ask(base, path, { method: "DELETE" });
      expect(deleted.status).toBe(405);

      const got = await ask(base, path, { method: "GET" });
      const headed = await ask(base, path, { method: "HEAD" });
      expect(headed.status).toBe(got.status);
      expect(headed.headers.get("content-type")).toBe(got.headers.get("content-type"));
      expect(headed.text).toBe(""); // HEAD carries no body
    }
  });

  it("(n) registration/authorize/token are not routed by this phase — ordinary 401, not an OAuth error", async () => {
    const noAuth = await ask(base, "/nowhere-at-all"); // the baseline uniform refusal
    for (const [path, method] of [
      ["/oauth/register", "POST"],
      ["/oauth/authorize", "GET"],
      ["/oauth/authorize", "POST"],
      ["/oauth/token", "POST"],
    ] as const) {
      const answer = await ask(base, path, { method });
      expect(answer.status).toBe(noAuth.status);
      expect(answer.text).toBe(noAuth.text);
    }
  });

  it("(h) the MCP door's 401 carries www-authenticate — identical across a public, a private, and an absent mount", async () => {
    const onPublicMount = await ask(base, "/garden/mcp", { method: "POST" });
    const onPrivateMount = await ask(base, "/meadow/mcp", { method: "POST" });
    const onAbsentMount = await ask(base, "/nowhere/mcp", { method: "POST" });
    for (const answer of [onPublicMount, onPrivateMount, onAbsentMount]) {
      expect(answer.status).toBe(401);
    }
    const challenge = onPublicMount.headers.get("www-authenticate");
    expect(challenge).toBe(challengeFor(PUBLIC_URL)); // positive control: present AND correct
    expect(onPrivateMount.headers.get("www-authenticate")).toBe(challenge);
    expect(onAbsentMount.headers.get("www-authenticate")).toBe(challenge);
    expect(onPublicMount.text).toBe(onPrivateMount.text);
    expect(onPrivateMount.text).toBe(onAbsentMount.text);
  });

  it("(h2) the same responses expose the header for a browser fetch() to read", async () => {
    const answer = await ask(base, "/garden/mcp", { method: "POST" });
    expect(answer.headers.get("access-control-expose-headers")).toContain("www-authenticate");
  });

  it("(i) a presented-but-wrong bearer token gets the same challenge as no token at all", async () => {
    const noToken = await ask(base, "/garden/mcp", { method: "POST" });
    const wrongToken = await ask(base, "/garden/mcp", { method: "POST", token: "junk-token" });
    expect(wrongToken.status).toBe(401);
    expect(wrongToken.headers.get("www-authenticate")).toBe(
      noToken.headers.get("www-authenticate"),
    );
    expect(wrongToken.text).toBe(noToken.text);
  });

  it("(j) a tokenless graphql refusal carries NO www-authenticate — the header is the MCP door's alone", async () => {
    const onPublicMount = await ask(base, "/garden/graphql", { method: "POST" });
    const onAbsentMount = await ask(base, "/nowhere/graphql", { method: "POST" });
    expect(onPublicMount.status).toBe(401);
    expect(onPublicMount.headers.get("www-authenticate")).toBeNull();
    expect(onAbsentMount.headers.get("www-authenticate")).toBeNull();
  });
});

describe("T133 — (g)/(k) discovery is opt-in: no --public-url, no door, no header", () => {
  let garden: Gateway;
  let handle: ServerHandle;
  let base: string;

  beforeEach(async () => {
    garden = await boot({ public: true });
    handle = await serve({
      mounts: { garden },
      tokens: { "op-token": { operator: true } },
      port: 0,
      host: "127.0.0.1",
      // no publicUrl
    });
    base = handle.url;
  });
  afterEach(async () => {
    await handle.close();
    await garden.close();
  });

  it("(g) the well-known paths resolve exactly as any other unmounted path", async () => {
    const baseline = await ask(base, "/nowhere-at-all");
    const resource = await ask(base, "/.well-known/oauth-protected-resource");
    const server = await ask(base, "/.well-known/oauth-authorization-server");
    expect(resource.status).toBe(baseline.status);
    expect(resource.text).toBe(baseline.text);
    expect(server.text).toBe(baseline.text);
  });

  it("(k) the MCP door's 401 is unchanged: same body, no www-authenticate header", async () => {
    const answer = await ask(base, "/garden/mcp", { method: "POST" });
    expect(answer.status).toBe(401);
    expect(answer.headers.get("www-authenticate")).toBeNull();
    expect(JSON.parse(answer.text)).toEqual({
      errors: ["a bearer token is required, and this one opens nothing"],
    });
  });
});

describe("T133 — must not mint anything", () => {
  it("(n) makeOAuthDoors owns only the two well-known paths", () => {
    const doors = makeOAuthDoors({ publicUrl: PUBLIC_URL });
    expect(doors.owns("/.well-known/oauth-protected-resource")).toBe(true);
    expect(doors.owns("/.well-known/oauth-authorization-server")).toBe(true);
    for (const path of ["/oauth/register", "/oauth/authorize", "/oauth/token", "/garden/mcp"]) {
      expect(doors.owns(path)).toBe(false);
    }
  });
});
