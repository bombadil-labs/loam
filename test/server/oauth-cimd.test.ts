// T242 — CIMD, the OAuth client-id-metadata-document (draft-ietf-oauth-client-id-metadata-document-02).
// The client_id IS an https URL; the authorization server fetches the client metadata document from
// that URL and validates the requested redirect_uri against the document's own `redirect_uris` — the
// operator's --oauth-allow-redirect list is deliberately not consulted, because the consent click is
// the operator's approval and the document is the client's vouching. That is the widened door these
// rails pin: a client never registered here can authorize, if its https metadata document vouches
// for its redirect.
//
// Every rail is two-sided: each fence refusal runs beside the legitimate fixture still passing, and
// the file/delta level (oauth.json rows, ground authorship) is asserted beside the door level (HTTP
// answers). The fetch is a server-side request to an attacker-influenced URL, so each SSRF fence
// earns its own case; `cimdAllowPrivateOrigins` is the deliberate test seam (documented at the fence
// in src/server/cimd.ts) that lets THIS file's loopback fixture through — production code paths
// never set it.
//
// What this file deliberately does NOT assert: PKCE/single-use/expiry enforcement at the token door
// (phase 15's rails, unchanged by CIMD) and the register door's own validation (phase 13's file).
// CIMD revocation IS asserted here, at the object level, in section (g) — oauth-revoke.test.ts
// stays the registered flow's rail.

import { createServer, type Server as HttpServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import { initHome } from "../../src/cli/config.js";
import { run } from "../../src/cli/cli.js";
import { signIn, SAME_ORIGIN } from "../helpers/session-fixture.js";
import {
  EMPTY_OAUTH,
  readOAuthFile,
  writeOAuthFile,
  type OAuthFile,
} from "../../src/server/oauth-file.js";
import { authorizationServerDocument, revokeConnector } from "../../src/server/oauth.js";
import {
  CIMD_CACHE_TTL_MS,
  CIMD_MAX_BYTES,
  CIMD_MAX_URIS,
  CIMD_MAX_URL,
  CIMD_TIMEOUT_MS,
  makeCimdFetcher,
  plainText,
  privateAddress,
} from "../../src/server/cimd.js";
import { grantClaims, registerPrefixesOf } from "../../src/gateway/accounts.js";
import { STORE_ENTITY, assembleGenesis } from "../../src/gateway/genesis.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden } from "../gateway/fixtures.js";
import { FERN, GARDENER, SURVEYOR } from "../spike/garden.js";

vi.setConfig({ testTimeout: 25000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

// The DCR side (the bystander): one allowlisted origin, as every §37 rail before this one.
const ALLOW_ORIGIN = "https://app.example";
const DCR_REDIRECT = "https://app.example/cb";

// The CIMD side: the document vouches for a redirect at an origin the operator NEVER allowlisted.
// That asymmetry is the widened door itself, so the fixture pins it rather than avoiding it.
const CIMD_REDIRECT = "https://claude.example/api/callback";
const META_NAME = "Metadata Connector";
// Control bytes (BEL, CR, LF), a bidi override (U+202E), a bidi isolate (U+2066), and markup — the
// hostile shapes a fetched client_name can carry into a consent page or a terminal.
const HOSTILE_NAME = "Evil\u0007\u202Ename\u2066 Connector\r\n<b>bold</b>";
const HOSTILE_SCRUBBED = "Evilname Connector<b>bold</b>";
const HOSTILE_ESCAPED = "Evilname Connector&lt;b&gt;bold&lt;/b&gt;";

const homes: string[] = [];
const handles: ServerHandle[] = [];
const metas: HttpServer[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (metas.length > 0) {
    const server = metas.pop()!;
    await new Promise((resolve) => server.close(resolve));
  }
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

// --- the local metadata fixture ------------------------------------------------------------------
//
// An http.createServer on 127.0.0.1 serving client metadata documents. Its origin rides the
// `cimdAllowPrivateOrigins` seam into serve(); every other fence (redirect refusal, the size cap,
// the content-type check, the document's own client_id match) still applies to it, which is what
// makes it a fixture for those fences too. `counts` observes each path's fetch count, so the H8
// cache rails read the fixture rather than the cache's own bookkeeping (H10).

interface Meta {
  readonly origin: string;
  readonly url: (path: string) => string;
  readonly counts: Map<string, number>;
  /** The `/rotating.json` document's redirect_uris — mutable, so a rail can rotate one out. */
  readonly rotating: { uris: string[] };
}

async function startMeta(): Promise<Meta> {
  const counts = new Map<string, number>();
  const rotating = { uris: [CIMD_REDIRECT] };
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0]!;
    counts.set(path, (counts.get(path) ?? 0) + 1);
    const self = `http://${req.headers.host}${path}`;
    const doc = (over: Record<string, unknown> = {}): string =>
      JSON.stringify({
        client_id: self,
        client_name: META_NAME,
        redirect_uris: [CIMD_REDIRECT],
        token_endpoint_auth_method: "none",
        ...over,
      });
    const json = (body: string): void => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    };
    if (path === "/client.json") return json(doc());
    if (path === "/bystander.json") return json(doc({ client_name: "Bystander Connector" }));
    if (path === "/rotating.json") return json(doc({ redirect_uris: [...rotating.uris] }));
    if (path === "/insecure-redirect.json")
      return json(doc({ redirect_uris: [CIMD_REDIRECT, "http://attacker.example/cb"] }));
    if (path.startsWith("/pad-")) return json(doc()); // any length of path; the doc echoes self
    if (path === "/hostile.json") return json(doc({ client_name: HOSTILE_NAME }));
    if (path === "/mismatch.json")
      return json(doc({ client_id: "https://elsewhere.example/client.json" }));
    if (path === "/secret-basic.json")
      return json(doc({ token_endpoint_auth_method: "client_secret_basic" }));
    if (path === "/redirect.json") {
      res.writeHead(302, { location: self });
      res.end();
      return;
    }
    if (path === "/huge.json") return json(`{"pad":"${"x".repeat(80 * 1024)}"}`);
    // The uri-bound fixtures: a filler uri of an exact length, and lists at the count cap's edges.
    const padded = (length: number): string =>
      `https://claude.example/cb?pad=${"a".repeat(length - "https://claude.example/cb?pad=".length)}`;
    const fillers = (count: number): string[] =>
      Array.from({ length: count }, (_, i) => `https://claude.example/cb/${i}`);
    if (path === "/uris-32.json")
      return json(doc({ redirect_uris: [...fillers(31), CIMD_REDIRECT] }));
    if (path === "/uris-33.json")
      return json(doc({ redirect_uris: [...fillers(32), CIMD_REDIRECT] }));
    if (path === "/uri-2048.json")
      return json(doc({ redirect_uris: [CIMD_REDIRECT, padded(2048)] }));
    if (path === "/uri-2049.json")
      return json(doc({ redirect_uris: [CIMD_REDIRECT, padded(2049)] }));
    if (path === "/html.json") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
      return;
    }
    if (path === "/hang.json") return; // never answers — the timeout fence's case
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  metas.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no fixture port");
  const origin = `http://127.0.0.1:${address.port}`;
  return { origin, url: (path: string) => `${origin}${path}`, counts, rotating };
}

// --- the serve() fixture -------------------------------------------------------------------------

async function cimdServer(
  meta: Meta,
  over: { maxClients?: number; monotonicNow?: () => number } = {},
): Promise<{ base: string; home: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, ts++), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, ts++), OPERATOR_SEED),
  ]);
  await gateway.append([signClaims(userClaims("myk", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);

  const home = mkdtempSync(join(tmpdir(), "loam-oauth-cimd-"));
  homes.push(home);
  initHome(home, OPERATOR_SEED);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
  writeOAuthFile(home, { ...EMPTY_OAUTH });

  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    publicUrl: "https://store.example",
    connectors: {
      home,
      allowRedirectOrigins: [ALLOW_ORIGIN],
      cimdAllowPrivateOrigins: [meta.origin],
      ...(over.maxClients === undefined ? {} : { maxClients: over.maxClients }),
    },
    users: {
      home,
      mount: "default",
      ...(over.monotonicNow === undefined ? {} : { monotonicNow: over.monotonicNow }),
    },
  });
  handles.push(handle);
  return { base: handle.url, home, gateway };
}

const fieldOf = (html: string, name: string): string =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "";

const b64url = (buf: Buffer): string => buf.toString("base64url");
const pkce = (): { verifier: string; challenge: string } => {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

const authorize = (
  base: string,
  sessionId: string,
  clientId: string,
  redirectUri: string,
  challenge: string,
): Promise<Response> => {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-cimd",
  }).toString();
  return fetch(`${base}/oauth/authorize?${query}`, {
    headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
    redirect: "manual",
  });
};

const approve = (base: string, sessionId: string, html: string): Promise<Response> =>
  fetch(`${base}/oauth/authorize`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${sessionId}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({
      form_token: fieldOf(html, "form_token"),
      client_id: fieldOf(html, "client_id"),
      redirect_uri: fieldOf(html, "redirect_uri"),
      code_challenge: fieldOf(html, "code_challenge"),
      code_challenge_method: "S256",
      state: fieldOf(html, "state"),
    }).toString(),
    redirect: "manual",
  });

const redeem = (
  base: string,
  clientId: string,
  redirectUri: string,
  code: string,
  verifier: string,
): Promise<Response> =>
  fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }).toString(),
    redirect: "manual",
  });

/** The whole CIMD flow: authorize → approve → redeem. Returns the access token. */
async function roundTrip(base: string, sessionId: string, clientId: string): Promise<string> {
  const { verifier, challenge } = pkce();
  const page = await authorize(base, sessionId, clientId, CIMD_REDIRECT, challenge);
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain("Approve a connector?");
  const approved = await approve(base, sessionId, html);
  expect(approved.status).toBe(302);
  const location = new URL(approved.headers.get("location")!);
  expect(location.href.startsWith(CIMD_REDIRECT)).toBe(true);
  const code = location.searchParams.get("code")!;
  const token = await redeem(base, clientId, CIMD_REDIRECT, code, verifier);
  expect(token.status).toBe(200);
  const body = (await token.json()) as { access_token?: string };
  expect(body.access_token).toBeTruthy();
  return body.access_token!;
}

const mutate = (base: string, token: string, height: number): Promise<Response> =>
  fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `mutation { plant(entity: "${FERN}", height: ${height}) { height } }`,
    }),
  });

const authorsOfHeight = (gateway: Gateway, height: number): string[] =>
  [...gateway.reactor.snapshot()]
    .filter(
      (d: Delta) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "height",
        ) &&
        d.claims.pointers.some(
          (p) => p.role === "value" && p.target.kind === "primitive" && p.target.value === height,
        ),
    )
    .map((d) => d.claims.author);

// --- (a) the round-trip and the exact-match fence ------------------------------------------------

describe("T242 (a) — the CIMD round-trip", () => {
  it("authorize+token round-trips against a local metadata fixture; the URL is the identity at every level; the burst costs one fetch", async () => {
    const meta = await startMeta();
    const clientId = meta.url("/client.json");
    const { base, home, gateway } = await cimdServer(meta);
    const sessionId = await signIn(base, "myk", PASSWORD);

    const token = await roundTrip(base, sessionId, clientId);

    // The consent page named the client by its URL — the identity a person approves. The whole
    // line is pinned, markup included: this is the surface a person judges a connector by.
    const { challenge } = pkce();
    const again = await authorize(base, sessionId, clientId, CIMD_REDIRECT, challenge);
    expect(again.status).toBe(200);
    expect(await again.text()).toContain(
      `Its identity is its own address: <code>${clientId}</code>`,
    );

    // FILE LEVEL: the URL is the clientId on the client row, the grant, and the token record.
    const file = readOAuthFile(home);
    expect(file.clients.map((c) => c.clientId)).toEqual([clientId]);
    expect(file.clients[0]!.clientName).toBe(META_NAME);
    expect(file.grants.map((g) => g.clientId)).toEqual([clientId]);
    expect(file.grants[0]!.standing).toBe(true);
    expect(file.tokens.map((t) => t.clientId)).toEqual([clientId]);

    // OBJECT LEVEL: the minted token writes through the door…
    const written = await mutate(base, token, 731);
    expect(written.status).toBe(200);
    // …and DELTA LEVEL: the ground names the connector's own actor, never the operator.
    const authors = authorsOfHeight(gateway, 731);
    expect(authors).toEqual([file.grants[0]!.actor]);
    expect(authors).not.toContain(OPERATOR);

    // A SECOND full round-trip re-uses the one URL-keyed row and the one grant: the identity is
    // idempotent, which is the 13-dead-clients failure this ticket exists to end.
    await roundTrip(base, sessionId, clientId);
    const after = readOAuthFile(home);
    expect(after.clients.map((c) => c.clientId)).toEqual([clientId]);
    expect(after.grants).toHaveLength(1);

    // H8: the whole burst above — four authorize reads, two approvals — cost ONE document fetch.
    expect(meta.counts.get("/client.json")).toBe(1);
  });

  it("a consent GET writes nothing: served or refused, the file stays empty until the approval POST", async () => {
    // A signed-in person on a Lax top-level nav to a crafted authorize link renders a page; only
    // their explicit approval may write. An upsert on the GET would mint rows pre-consent.
    const meta = await startMeta();
    const clientId = meta.url("/client.json");
    const { base, home } = await cimdServer(meta);
    const sessionId = await signIn(base, "myk", PASSWORD);
    const { challenge } = pkce();

    const served = await authorize(base, sessionId, clientId, CIMD_REDIRECT, challenge);
    expect(served.status).toBe(200);
    const refused = await authorize(
      base,
      sessionId,
      clientId,
      "https://evil.example/cb",
      challenge,
    );
    expect(refused.status).toBe(400);
    const file = readOAuthFile(home);
    expect(file.clients).toEqual([]);
    expect(file.codes ?? []).toEqual([]);

    // …and the approval POST is exactly what writes: one row, one code.
    const approved = await approve(base, sessionId, await served.text());
    expect(approved.status).toBe(302);
    const after = readOAuthFile(home);
    expect(after.clients.map((c) => c.clientId)).toEqual([clientId]);
    expect(after.codes ?? []).toHaveLength(1);
  });

  it("a redirect_uri the document does not vouch for REFUSES with no Location — and the vouched one passes beside it", async () => {
    const meta = await startMeta();
    const clientId = meta.url("/client.json");
    const { base } = await cimdServer(meta);
    const sessionId = await signIn(base, "myk", PASSWORD);
    const { challenge } = pkce();

    const refused = await authorize(
      base,
      sessionId,
      clientId,
      "https://evil.example/cb",
      challenge,
    );
    expect(refused.status).toBe(400);
    expect(refused.headers.get("location")).toBeNull();
    expect(await refused.text()).toContain("Refused");

    const vouched = await authorize(base, sessionId, clientId, CIMD_REDIRECT, challenge);
    expect(vouched.status).toBe(200);
  });
});

// --- (b) the SSRF fences -------------------------------------------------------------------------
//
// Each fence refuses its case AND the legitimate fixture passes beside it in the same test, so a
// fence that refuses everything cannot pass. Fences that never dial (scheme, IP literal, private
// name, userinfo, bare origin) are exercised through the door; the connected-address fence — which
// needs a NAME resolving to a private ADDRESS — is exercised at the fetcher with an injected lookup,
// because real DNS has no stable name for that and a test must not depend on one.

describe("T242 (b) — the SSRF fences", () => {
  // `hostile` may be a fixed URL or a path on the test's own fixture — the latter for fences that
  // must actually reach a live answer (a redirect, an oversized body) through the seam.
  const refusesButFixturePasses = async (
    hostile: string | ((meta: Meta) => string),
    reason: string,
  ): Promise<void> => {
    const meta = await startMeta();
    const hostileClientId = typeof hostile === "function" ? hostile(meta) : hostile;
    const { base } = await cimdServer(meta);
    const sessionId = await signIn(base, "myk", PASSWORD);
    const { challenge } = pkce();

    const refused = await authorize(base, sessionId, hostileClientId, CIMD_REDIRECT, challenge);
    expect(refused.status).toBe(400);
    expect(refused.headers.get("location")).toBeNull();
    expect(await refused.text()).toContain(reason);

    const fine = await authorize(
      base,
      sessionId,
      meta.url("/client.json"),
      CIMD_REDIRECT,
      challenge,
    );
    expect(fine.status).toBe(200);
  };

  it("an http: URL outside the seam refuses — https only", async () => {
    await refusesButFixturePasses("http://metadata.example/client.json", "https");
  });

  it("an IP-literal host refuses, v4 and v6", async () => {
    await refusesButFixturePasses("https://192.0.2.7/client.json", "IP literal");
    await refusesButFixturePasses("https://[2001:db8::7]/client.json", "IP literal");
  });

  it("localhost and .local/.internal names refuse without the seam", async () => {
    await refusesButFixturePasses("https://localhost/client.json", "private name");
    await refusesButFixturePasses("https://printer.local/client.json", "private name");
    await refusesButFixturePasses("https://api.internal/client.json", "private name");
  });

  it("userinfo in the URL refuses", async () => {
    await refusesButFixturePasses("https://bob@metadata.example/client.json", "userinfo");
  });

  it("a fragment in the URL refuses", async () => {
    await refusesButFixturePasses("https://metadata.example/client.json#frag", "fragment");
  });

  it("a query string in the URL refuses — one client, one spelling", async () => {
    // An echoing metadata server satisfies the client_id binding for every ?v= spelling, and each
    // approved spelling would mint its OWN row, grant and tokens — `grant revoke <url>` would then
    // strike one spelling while sibling grants stand. Refusing the query removes the spelling axis.
    await refusesButFixturePasses("https://metadata.example/client.json?v=1", "query");
  });

  it("an over-length URL refuses at the door with the length reason", async () => {
    await refusesButFixturePasses(`https://metadata.example/${"a".repeat(2030)}.json`, "2048");
  });

  it("the URL length holds at its exact edge: 2048 dials, 2049 refuses undialed", async () => {
    const meta = await startMeta();
    const fetcher = makeCimdFetcher({ allowPrivateOrigins: [meta.origin] });
    // A path padded so the WHOLE URL is exactly the requested length; the fixture answers any
    // /pad- path with a document echoing its own address.
    const padded = (length: number): string => {
      const stem = `${meta.origin}/pad-`;
      return `${stem}${"a".repeat(length - stem.length - 5)}.json`;
    };
    const edge = padded(2048);
    expect(edge).toHaveLength(2048);
    expect((await fetcher.fetch(edge)).kind).toBe("ok");
    const over = await fetcher.fetch(padded(2049));
    expect(over.kind).toBe("refused");
    if (over.kind === "refused") expect(over.reason).toContain("2048");
  });

  it("a document may vouch an http:// target and still not get it: the hygiene fence refuses, the https sibling passes", async () => {
    // The document decides WHICH uris vouch; this store still holds each vouched uri to its own
    // hygiene. Without this fence a hostile document could 302 a real browser to a plaintext
    // target with the authorization code in the query.
    const meta = await startMeta();
    const clientId = meta.url("/insecure-redirect.json");
    const { base } = await cimdServer(meta);
    const sessionId = await signIn(base, "myk", PASSWORD);
    const { challenge } = pkce();

    const refused = await authorize(
      base,
      sessionId,
      clientId,
      "http://attacker.example/cb",
      challenge,
    );
    expect(refused.status).toBe(400);
    expect(refused.headers.get("location")).toBeNull();
    expect(await refused.text()).toContain("not https");

    const fine = await authorize(base, sessionId, clientId, CIMD_REDIRECT, challenge);
    expect(fine.status).toBe(200);
  });

  it("a bare origin with no path refuses — a document has an address, a site does not", async () => {
    await refusesButFixturePasses("https://metadata.example/", "path");
  });

  it("a redirect answer refuses outright", async () => {
    await refusesButFixturePasses((meta) => meta.url("/redirect.json"), "redirect");
  });

  it("a body over the 64KB cap refuses", async () => {
    await refusesButFixturePasses((meta) => meta.url("/huge.json"), "larger");
  });

  it("a content-type other than application/json refuses — and the failure is never cached", async () => {
    const meta = await startMeta();
    const wrong = meta.url("/html.json");
    const { base } = await cimdServer(meta);
    const sessionId = await signIn(base, "myk", PASSWORD);
    const { challenge } = pkce();

    const first = await authorize(base, sessionId, wrong, CIMD_REDIRECT, challenge);
    expect(first.status).toBe(400);
    expect(await first.text()).toContain("application/json");
    const second = await authorize(base, sessionId, wrong, CIMD_REDIRECT, challenge);
    expect(second.status).toBe(400);
    // Two refusals, two fetches: a failure is never cached (a poisoned answer must not linger).
    expect(meta.counts.get("/html.json")).toBe(2);

    const fine = await authorize(
      base,
      sessionId,
      meta.url("/client.json"),
      CIMD_REDIRECT,
      challenge,
    );
    expect(fine.status).toBe(200);
  });

  it("a document whose own client_id names a different URL refuses — the draft's binding check", async () => {
    await refusesButFixturePasses((meta) => meta.url("/mismatch.json"), "client_id");
  });

  it("a document declaring a symmetric client secret refuses — this store authenticates none", async () => {
    await refusesButFixturePasses((meta) => meta.url("/secret-basic.json"), "none");
  });

  // An injected resolver answering 127.0.0.1 in whichever shape the socket asked for (Node's
  // connect asks `all: true` under Happy Eyeballs; dns.lookup answers both shapes).
  const loopbackLookup = (
    _hostname: string,
    options: { all?: boolean | undefined },
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void,
  ): void =>
    options.all === true
      ? callback(null, [{ address: "127.0.0.1", family: 4 }])
      : callback(null, "127.0.0.1", 4);

  it("the connected-address fence judges the address actually dialed: a public name resolving private refuses before any byte moves", async () => {
    const meta = await startMeta();
    const before = meta.counts.get("/client.json") ?? 0;
    const fetcher = makeCimdFetcher({ lookup: loopbackLookup });
    const outcome = await fetcher.fetch("https://rebind.example/client.json");
    expect(outcome.kind).toBe("refused");
    // The REASON is the rail here: it names the address fence, so the refusal came from judging
    // the lookup's answer — not from a failed dial. (The counts check below is only a sanity
    // floor; the hostile URL's port 443 could never reach the fixture's ephemeral port anyway.)
    if (outcome.kind === "refused") expect(outcome.reason).toContain("private address");
    expect(meta.counts.get("/client.json") ?? 0).toBe(before);
  });

  it("…and the lookup genuinely drives the dial: through the seam, the same private answer reaches the fixture", async () => {
    const meta = await startMeta();
    const port = Number(new URL(meta.origin).port);
    const origin = `http://rebind.example:${port}`;
    const fetcher = makeCimdFetcher({ allowPrivateOrigins: [origin], lookup: loopbackLookup });
    const outcome = await fetcher.fetch(`${origin}/client.json`);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      // The fixture built the document's client_id from the Host header it received — proof the
      // socket carried the NAME to the address the lookup returned, not a second resolution.
      expect(outcome.document.clientId).toBe(`${origin}/client.json`);
    }
  });

  it("a document that never answers refuses on the timeout, after really dialing", async () => {
    const meta = await startMeta();
    const fetcher = makeCimdFetcher({ allowPrivateOrigins: [meta.origin], timeoutMs: 300 });
    const outcome = await fetcher.fetch(meta.url("/hang.json"));
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.reason).toContain("answer");
    expect(meta.counts.get("/hang.json")).toBe(1); // it dialed — the timer refused, not a fence
  });

  it("privateAddress judges the ranges by hand-written expectation", () => {
    // Hand-written table (H10): the expected side is a literal, never derived from the subject.
    const privates = [
      "127.0.0.1",
      "127.9.8.7",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.7",
    ];
    const publics = [
      "93.184.216.34",
      "8.8.8.8",
      "172.32.0.1",
      "2606:4700::6810:84e5",
      "2001:db8::7",
    ];
    for (const address of privates) expect(privateAddress(address), address).toBe(true);
    for (const address of publics) expect(privateAddress(address), address).toBe(false);
  });

  it("the cache holds a good document for the TTL and refetches after it", async () => {
    const meta = await startMeta();
    let at = 0;
    const fetcher = makeCimdFetcher({ allowPrivateOrigins: [meta.origin], now: () => at });
    const url = meta.url("/client.json");
    expect((await fetcher.fetch(url)).kind).toBe("ok");
    at += CIMD_CACHE_TTL_MS - 1;
    expect((await fetcher.fetch(url)).kind).toBe("ok");
    expect(meta.counts.get("/client.json")).toBe(1); // within the TTL: one fetch serves both
    at += 2;
    expect((await fetcher.fetch(url)).kind).toBe("ok");
    expect(meta.counts.get("/client.json")).toBe(2); // past it: refetched
  });

  it("a document edit binds when its cache entry expires — the removed redirect outlives the edit by at most the TTL", async () => {
    // The honest bound on freshness, pinned: a client that rotates a redirect out of its document
    // keeps the removed target admitted for up to CIMD_CACHE_TTL_MS (plus a minted code's 60s),
    // and not one request longer.
    const meta = await startMeta();
    const clientId = meta.url("/rotating.json");
    let clock = 0;
    const { base } = await cimdServer(meta, { monotonicNow: () => clock });
    const sessionId = await signIn(base, "myk", PASSWORD);
    const { challenge } = pkce();

    expect((await authorize(base, sessionId, clientId, CIMD_REDIRECT, challenge)).status).toBe(200);
    const replacement = "https://claude.example/replacement";
    meta.rotating.uris = [replacement];
    // Within the TTL the cached vouching still admits the removed target — the bound is real.
    expect((await authorize(base, sessionId, clientId, CIMD_REDIRECT, challenge)).status).toBe(200);
    clock += CIMD_CACHE_TTL_MS + 1;
    expect((await authorize(base, sessionId, clientId, CIMD_REDIRECT, challenge)).status).toBe(400);
    expect((await authorize(base, sessionId, clientId, replacement, challenge)).status).toBe(200);
  });

  it("the caps are the promised constants", () => {
    // Pinned as literals so a quiet widening is a red bar, not a diff nobody reads.
    expect(CIMD_MAX_BYTES).toBe(64 * 1024);
    expect(CIMD_TIMEOUT_MS).toBe(5000);
    expect(CIMD_CACHE_TTL_MS).toBe(5 * 60 * 1000);
    expect(CIMD_MAX_URIS).toBe(32);
    expect(CIMD_MAX_URL).toBe(2048);
  });

  it("the uri bounds hold at their exact edges: 32 uris and 2048 characters pass, one more of either refuses", async () => {
    const meta = await startMeta();
    const fetcher = makeCimdFetcher({ allowPrivateOrigins: [meta.origin] });
    expect((await fetcher.fetch(meta.url("/uris-32.json"))).kind).toBe("ok");
    expect((await fetcher.fetch(meta.url("/uris-33.json"))).kind).toBe("refused");
    expect((await fetcher.fetch(meta.url("/uri-2048.json"))).kind).toBe("ok");
    expect((await fetcher.fetch(meta.url("/uri-2049.json"))).kind).toBe("refused");
  });
});

// --- (c) DCR unchanged — the bystander -----------------------------------------------------------

describe("T242 (c) — the registered flow is untouched", () => {
  it("register → authorize → token still round-trips beside CIMD", async () => {
    const meta = await startMeta();
    const { base } = await cimdServer(meta);

    const registered = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Registered Bystander", redirect_uris: [DCR_REDIRECT] }),
    });
    expect(registered.status).toBe(201);
    const { client_id: clientId } = (await registered.json()) as { client_id: string };
    expect(clientId.startsWith("connector-")).toBe(true);

    const sessionId = await signIn(base, "myk", PASSWORD);
    const { verifier, challenge } = pkce();
    const page = await authorize(base, sessionId, clientId, DCR_REDIRECT, challenge);
    expect(page.status).toBe(200);
    const approved = await approve(base, sessionId, await page.text());
    expect(approved.status).toBe(302);
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const token = await redeem(base, clientId, DCR_REDIRECT, code, verifier);
    expect(token.status).toBe(200);

    // And the DCR fence holds: a registered client still cannot reach past its allowlisted origin.
    const { challenge: c2 } = pkce();
    const outside = await authorize(base, sessionId, clientId, CIMD_REDIRECT, c2);
    expect(outside.status).toBe(400);
  });
});

// --- (d) the AS metadata advertises the flag -----------------------------------------------------

describe("T242 (d) — discovery", () => {
  it("client_id_metadata_document_supported is true, in the document function and at the door", async () => {
    expect(
      authorizationServerDocument("https://store.example")["client_id_metadata_document_supported"],
    ).toBe(true);
    const meta = await startMeta();
    const { base } = await cimdServer(meta);
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc["client_id_metadata_document_supported"]).toBe(true);
  });
});

// --- (e) a hostile client_name renders scrubbed --------------------------------------------------

describe("T242 (e) — untrusted display text", () => {
  it("control characters and bidi marks are scrubbed on the consent page and in the stored row", async () => {
    const meta = await startMeta();
    const clientId = meta.url("/hostile.json");
    const { base, home } = await cimdServer(meta);
    const sessionId = await signIn(base, "myk", PASSWORD);
    const { challenge } = pkce();

    const page = await authorize(base, sessionId, clientId, CIMD_REDIRECT, challenge);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(HOSTILE_ESCAPED);
    for (const hostile of ["\u0007", "\u202E", "\u2066", "\r\n<b>"]) {
      expect(html).not.toContain(hostile);
    }

    // The stored row (which a future `loam grant list` prints to a terminal) holds the scrubbed name.
    const approved = await approve(base, sessionId, html);
    expect(approved.status).toBe(302);
    const file = readOAuthFile(home);
    expect(file.clients.map((c) => c.clientName)).toEqual([HOSTILE_SCRUBBED]);
  });

  it("plainText strips what a terminal or a bidi reader would obey, and nothing else", () => {
    expect(plainText(HOSTILE_NAME)).toBe(HOSTILE_SCRUBBED);
    expect(plainText("Ordinary Name 42 — ünïcode")).toBe("Ordinary Name 42 — ünïcode");
    // The Unicode line/paragraph separators — a terminal breaks a row on them, exactly as on LF.
    expect(plainText("a\u2028b\u2029c")).toBe("abc");
    expect(plainText("\u202E\u0000\u009B")).toBe("");
  });
});

// --- (f) the grant ledger takes a URL id as an opaque string -------------------------------------

describe("T242 (f) — `loam grant <url>` treats a URL id as opaque", () => {
  const CONNECTOR_SEED = "70".repeat(32);
  const CONNECTOR = authorForSeed(CONNECTOR_SEED);
  const URL_ID = "https://claude.example/.well-known/client-metadata.json";

  const out: string[] = [];
  const err: string[] = [];
  const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

  it("mint, list and revoke all take the URL; the ground carries the prefix", async () => {
    out.length = 0;
    err.length = 0;
    const home = mkdtempSync(join(tmpdir(), "loam-cimd-grant-"));
    homes.push(home);
    expect(await run(["init", "--home", home], io())).toBe(0);
    const file: OAuthFile = {
      ...EMPTY_OAUTH,
      clients: [
        {
          clientId: URL_ID,
          clientName: META_NAME,
          redirectUris: [CIMD_REDIRECT],
          registeredAt: 1,
          generation: 1,
        },
      ],
      grants: [
        {
          clientId: URL_ID,
          actorSeed: CONNECTOR_SEED,
          actor: CONNECTOR,
          grantedAt: 1,
          standing: true,
        },
      ],
    };
    writeOAuthFile(home, file);

    expect(
      await run(["grant", URL_ID, "--verb=register", "--prefix=cimd:", "--home", home], io()),
      [...out, ...err].join("\n"),
    ).toBe(0);

    // DELTA LEVEL: the ground itself holds the scoped register grant for the connector's actor.
    const seed = readFileSync(join(home, "operator.seed"), "utf8").trim();
    const gateway = await Gateway.boot(
      new SqliteBackend(join(home, "store.sqlite")),
      assembleGenesis({ operatorSeed: seed }),
    );
    try {
      expect(registerPrefixesOf(gateway.reactor, CONNECTOR, authorForSeed(seed))).toEqual([
        "cimd:",
      ]);
    } finally {
      await gateway.close();
    }

    out.length = 0;
    expect(await run(["grant", "list", "--home", home], io())).toBe(0);
    expect(out.join("\n")).toContain(URL_ID);

    expect(await run(["grant", "revoke", URL_ID, "--home", home], io())).toBe(0);
    const after = readOAuthFile(home);
    expect(after.grants).toHaveLength(0); // the revoke bound on the URL id
    expect(after.clients[0]!.generation).toBe(2);
  });
});

// --- (g) revocation, eviction, and the resurrection fence ----------------------------------------
//
// A CIMD id is DETERMINISTIC: revoke a client, let the register door's cap evict its (now
// unpinned) row, and a re-approval creates a FRESH row at generation 1 — the exact shape a stale
// generation-1 token could match again. The purge at fresh-row creation is the fence. This rail
// drives the whole lifecycle through the doors and asserts at the object level, with an unrevoked
// CIMD bystander alive throughout.

describe("T242 (g) — a revoked CIMD token stays dead through eviction and re-approval", () => {
  it("revoke kills the token at the door; eviction + re-approval cannot resurrect it; the new token and the bystander live", async () => {
    const meta = await startMeta();
    const clientA = meta.url("/client.json");
    const clientB = meta.url("/bystander.json");
    const { base, home } = await cimdServer(meta, { maxClients: 2 });
    const sessionId = await signIn(base, "myk", PASSWORD);

    const tokenA = await roundTrip(base, sessionId, clientA);
    const tokenB = await roundTrip(base, sessionId, clientB);
    expect((await mutate(base, tokenA, 811)).status).toBe(200);
    expect((await mutate(base, tokenB, 812)).status).toBe(200);

    // Revoke A by its URL. OBJECT LEVEL: the live token stops authenticating on the next request.
    const revoked = await revokeConnector(home, clientA, async () => {});
    expect(revoked.kind).toBe("revoked");
    expect((await mutate(base, tokenA, 813)).status).toBe(401);
    expect((await mutate(base, tokenB, 814)).status).toBe(200); // the bystander is untouched

    // An anonymous registration at the cap evicts the revoked row — no grant, no code, no pin —
    // taking its generation counter with it.
    const registered = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Filler", redirect_uris: [DCR_REDIRECT] }),
    });
    expect(registered.status).toBe(201);
    expect(readOAuthFile(home).clients.map((c) => c.clientId)).not.toContain(clientA);

    // Re-approve A: a FRESH row at generation 1, and a fresh token that works.
    const tokenA2 = await roundTrip(base, sessionId, clientA);
    const fresh = readOAuthFile(home).clients.find((c) => c.clientId === clientA);
    expect(fresh?.generation).toBe(1);

    // The old token was PURGED at fresh-row creation, so it cannot match the fresh generation.
    expect((await mutate(base, tokenA, 815)).status).toBe(401);
    expect((await mutate(base, tokenA2, 816)).status).toBe(200);
    expect((await mutate(base, tokenB, 817)).status).toBe(200);
  });
});
