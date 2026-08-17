// T177 — the protected-resource document lives where RFC 9728 puts it, and names what a client
// dialled. Measured against a live client on 2026-08-17: the connector probed
// `/.well-known/oauth-protected-resource/<mount>/mcp`, that path was unrouted, and it fell into the
// mount router's uniform 401 — a PUBLIC discovery document answering "authenticate first", where
// authenticating requires the document. Registration went 401 → 201 the moment a shim served it.
//
// THE MODEL THIS FILE PINS. A store has ONE authorization server and MANY mounts. Each mount's MCP
// door is a distinct protected resource, so each gets its OWN document at its own path-inserted
// URI, naming its own endpoint as `resource` and the store as its single `authorization_servers`
// entry. The store-wide document at the bare well-known path is unchanged (T133 froze it).
//
// AND THE DOCUMENT IS BLIND TO THE MOUNT TABLE. It is computed from the request path and the
// configured `publicUrl` alone — never from `mounts.resolve` — so a name that resolves to nothing
// answers exactly what a live mount answers. A 404 or a 401 here would enumerate the store's mounts
// for any anonymous caller, which is the oracle §12/T78 closed on purpose.
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT. The `WWW-Authenticate` challenge still names the
// STORE-WIDE document, not the refused mount's. T133 froze that constant in three places
// (`oauth-discovery.test.ts` (a)/(h)/(l) and `cli/serve-public-url.test.ts`), and pointing it at a
// mount's document changes a promise T133 states in words — so it is a separate, authorized change,
// not this repair. Criterion (3) below therefore rails what holds today: the challenge names a
// document, the test FOLLOWS the header rather than hardcoding it, and that document answers 200 to
// an unauthenticated caller. The rail that closes the gap is "the header the MCP door emits for
// `/<mount>/mcp` names `/.well-known/oauth-protected-resource/<mount>/mcp`", and it belongs to the
// ticket that lands the authorized rename.

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { serve, type ServerHandle } from "../../src/server/http.js";

vi.setConfig({ testTimeout: 20_000 }); // real listening servers

const OP_SEED = "5e".repeat(32);
// Hand-written, never derived from the code under test (H10): every expectation below is built
// from these two literals by string concatenation a reader can check against RFC 9728 §3.1.
const PUBLIC_URL = "https://loam.example:8443";
const WELL_KNOWN = "/.well-known/oauth-protected-resource";
const CLAUDE_ORIGIN = "https://claude.ai";
const CLAUDE_REDIRECT = `${CLAUDE_ORIGIN}/api/mcp/auth_callback`;

const homes: string[] = [];
const handles: ServerHandle[] = [];
const gateways: Gateway[] = [];

afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (gateways.length > 0) await gateways.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const bootGateway = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
  gateways.push(gw);
  return gw;
};

/** A live server on two mounts, with the connector registration door open. */
const served = async (): Promise<string> => {
  const home = mkdtempSync(join(tmpdir(), "loam-t177-"));
  homes.push(home);
  const handle = await serve({
    mounts: { garden: await bootGateway(), meadow: await bootGateway() },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    publicUrl: PUBLIC_URL,
    connectors: { home, allowRedirectOrigins: [CLAUDE_ORIGIN] },
  });
  handles.push(handle);
  return handle.url;
};

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

const get = async (url: string, method = "GET"): Promise<Answer> => {
  const res = await fetch(url, { method });
  return { status: res.status, headers: res.headers, text: await res.text() };
};

const doc = (answer: Answer): Record<string, unknown> =>
  JSON.parse(answer.text) as Record<string, unknown>;

/** The path a client would dial for `url`, against this test server rather than the public origin. */
const pathOf = (url: string): string => new URL(url).pathname.replace(/\/$/, "");

describe("T177 — (1) the path-inserted URI answers the mount's own document", () => {
  it("GET /.well-known/oauth-protected-resource/garden/mcp — 200, and `resource` is that endpoint", async () => {
    const base = await served();
    const answer = await get(`${base}${WELL_KNOWN}/garden/mcp`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toContain("application/json");
    expect(answer.headers.get("access-control-allow-origin")).toBe("*");
    expect(answer.headers.get("cache-control")).toBe("no-store");
    // Hand-derived, not read back from the response: the endpoint a client dials.
    expect(doc(answer)["resource"]).toBe("https://loam.example:8443/garden/mcp");
    // ONE authorization server, and it is the store — not the mount.
    expect(doc(answer)["authorization_servers"]).toEqual(["https://loam.example:8443"]);
    expect(doc(answer)["bearer_methods_supported"]).toEqual(["header"]);
  });

  it("the document is a pure function of publicUrl — a foreign Host cannot move it", async () => {
    const base = await served();
    const res = await fetch(`${base}${WELL_KNOWN}/garden/mcp`, {
      headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["resource"]).toBe("https://loam.example:8443/garden/mcp");
  });

  it("HEAD answers 200 and a non-GET answers 405, exactly as the bare well-known path does", async () => {
    const base = await served();
    expect((await get(`${base}${WELL_KNOWN}/garden/mcp`, "HEAD")).status).toBe(200);
    const posted = await get(`${base}${WELL_KNOWN}/garden/mcp`, "POST");
    const postedBare = await get(`${base}${WELL_KNOWN}`, "POST");
    expect(posted.status).toBe(405);
    expect(posted.status).toBe(postedBare.status);
    expect(posted.text).toBe(postedBare.text);
  });
});

describe("T177 — (2) two mounts, two documents, neither readable as the other", () => {
  it("each names its OWN endpoint", async () => {
    const base = await served();
    const garden = doc(await get(`${base}${WELL_KNOWN}/garden/mcp`));
    const meadow = doc(await get(`${base}${WELL_KNOWN}/meadow/mcp`));
    expect(garden["resource"]).toBe("https://loam.example:8443/garden/mcp");
    expect(meadow["resource"]).toBe("https://loam.example:8443/meadow/mcp");
    // The two differ. A single shared document — the bug this ticket repairs — passes every
    // per-mount assertion above if they are read one at a time; only the comparison catches it.
    expect(garden["resource"]).not.toBe(meadow["resource"]);
    // …and they differ in `resource` ALONE. The authorization server is the store's, once.
    expect(garden["authorization_servers"]).toEqual(meadow["authorization_servers"]);
  });

  it("the bare well-known path is untouched — it still names the store", async () => {
    const base = await served();
    const store = doc(await get(`${base}${WELL_KNOWN}`));
    expect(store["resource"]).toBe("https://loam.example:8443");
  });
});

describe("T177 — (3) the MCP door's challenge names a document a stranger can read", () => {
  it("follow the header, do not hardcode it: the URL it names answers 200 unauthenticated", async () => {
    const base = await served();
    const refusal = await fetch(`${base}/garden/mcp`, { method: "POST" });
    expect(refusal.status).toBe(401);
    const challenge = refusal.headers.get("www-authenticate");
    expect(challenge).toBeTruthy();
    const named = /resource_metadata="([^"]+)"/.exec(challenge ?? "")?.[1];
    expect(named).toBeTruthy();
    // The document lives on the configured public origin, which is not this test server's address;
    // a real client resolves the former, so the rail rewrites the origin and keeps the path.
    const path = pathOf(named!);
    const answer = await get(`${base}${path}`);
    expect(answer.status).toBe(200);
    expect(doc(answer)["authorization_servers"]).toEqual(["https://loam.example:8443"]);
  });
});

describe("T177 — (4) the metadata surface cannot enumerate mounts", () => {
  it("a name that resolves to nothing answers what a live mount answers, byte for byte", async () => {
    const base = await served();
    const live = await get(`${base}${WELL_KNOWN}/garden/mcp`);
    const ghost = await get(`${base}${WELL_KNOWN}/nowhere-at-all/mcp`);
    // Response against response, never against a literal: same status, same headers a client can
    // key on, and a body that differs ONLY in the name the caller themselves supplied.
    expect(ghost.status).toBe(live.status);
    expect(ghost.headers.get("content-type")).toBe(live.headers.get("content-type"));
    expect(ghost.headers.get("cache-control")).toBe(live.headers.get("cache-control"));
    expect(ghost.text.replace("/nowhere-at-all/", "/garden/")).toBe(live.text);
    // Positive control: the substitution above is not vacuous — the two bodies really did differ.
    expect(ghost.text).not.toBe(live.text);
  });

  it("the mount doors themselves are unchanged: an unrouted path still draws the uniform 401", async () => {
    const base = await served();
    const ghostMount = await get(`${base}/nowhere-at-all/mcp`, "POST");
    const unrouted = await get(`${base}/.well-known/oauth-protected-resource/garden`, "POST");
    const nested = await get(`${base}${WELL_KNOWN}/garden/mcp/extra`, "POST");
    // One canonical spelling per resource: a re-encoded name is not this URI. `resource` must echo
    // the bytes the caller sent, because that is the string a client compares against its own URL.
    const reEncoded = await get(`${base}${WELL_KNOWN}/%67arden/mcp`, "POST");
    // An empty name is not a mount, so it names no resource. Routed, it would answer a document
    // whose `resource` reads `<origin>//mcp` — an identifier no client can ever have dialled.
    const empty = await get(`${base}${WELL_KNOWN}//mcp`, "POST");
    expect(ghostMount.status).toBe(401);
    // No shape here is a path-inserted URI, so none is routed — and the fallthrough that catches
    // them is the SAME uniform refusal, not a 404. A 404 here would reopen §12/T78's oracle.
    for (const answer of [unrouted, nested, reEncoded, empty]) {
      expect(answer.status).toBe(ghostMount.status);
      expect(answer.text).toBe(ghostMount.text);
    }
  });
});

describe("T177 — (5) end to end: challenge → document → registration, real requests only", () => {
  it("a client that reads only the 401's header reaches a 201 from the registration door", async () => {
    const base = await served();

    // 1. The client dials the MCP door with no token and is refused.
    const refusal = await fetch(`${base}/garden/mcp`, { method: "POST" });
    expect(refusal.status).toBe(401);

    // 2. It reads resource_metadata out of the challenge and fetches it. Nothing below is
    //    hardcoded — every URL comes from the previous response.
    const named = /resource_metadata="([^"]+)"/.exec(
      refusal.headers.get("www-authenticate") ?? "",
    )?.[1];
    const resource = doc(await get(`${base}${pathOf(named!)}`));

    // 3. It reads the authorization server out of that document and fetches ITS metadata.
    const servers = resource["authorization_servers"] as readonly string[];
    expect(servers).toHaveLength(1);
    const asDoc = doc(
      await get(`${base}${pathOf(servers[0]!)}/.well-known/oauth-authorization-server`),
    );

    // 4. It POSTs to the registration_endpoint that document names.
    const endpoint = asDoc["registration_endpoint"] as string;
    const created = await fetch(`${base}${pathOf(endpoint)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [CLAUDE_REDIRECT] }),
    });
    expect(created.status).toBe(201);
    expect(((await created.json()) as Record<string, unknown>)["client_id"]).toBeTruthy();
  });

  it("a client that constructs the RFC 9728 location itself, from the URL it dialled, gets there too", async () => {
    // The measured path: a spec-conformant client does not need the challenge at all. It inserts
    // the resource's path into the well-known URI. This is the request the live trace made, and the
    // one that answered 401 before this ticket.
    const base = await served();
    const resource = doc(await get(`${base}${WELL_KNOWN}/garden/mcp`));
    expect(resource["resource"]).toBe("https://loam.example:8443/garden/mcp");
    const servers = resource["authorization_servers"] as readonly string[];
    const asDoc = doc(
      await get(`${base}${pathOf(servers[0]!)}/.well-known/oauth-authorization-server`),
    );
    const created = await fetch(`${base}${pathOf(asDoc["registration_endpoint"] as string)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [CLAUDE_REDIRECT] }),
    });
    expect(created.status).toBe(201);
  });
});
