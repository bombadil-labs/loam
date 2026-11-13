import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { serve, type ServerHandle } from "../../src/server/http.js";

vi.setConfig({ testTimeout: 20_000 });

const OP_SEED = "5e".repeat(32);
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

const pathOf = (url: string): string => new URL(url).pathname.replace(/\/$/, "");

describe("T177 — (1) the path-inserted URI answers the mount's own document", () => {
  it("GET /.well-known/oauth-protected-resource/garden/mcp — 200, and `resource` is that endpoint", async () => {
    const base = await served();
    const answer = await get(`${base}${WELL_KNOWN}/garden/mcp`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toContain("application/json");
    expect(answer.headers.get("access-control-allow-origin")).toBe("*");
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(doc(answer)["resource"]).toBe("https://loam.example:8443/garden/mcp");
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
    expect(garden["resource"]).not.toBe(meadow["resource"]);
    expect(garden["authorization_servers"]).toEqual(meadow["authorization_servers"]);
  });

  it("the advertised identifier IS the served door — the two literals finally meet", async () => {
    const base = await served();
    const advertised = doc(await get(`${base}${WELL_KNOWN}/garden/mcp`))["resource"] as string;
    const res = await fetch(`${base}${pathOf(advertised)}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { tools?: unknown[] } };
    expect(Array.isArray(body.result?.tools)).toBe(true);
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
    expect(ghost.status).toBe(live.status);
    expect(ghost.headers.get("content-type")).toBe(live.headers.get("content-type"));
    expect(ghost.headers.get("cache-control")).toBe(live.headers.get("cache-control"));
    expect(ghost.headers.get("access-control-allow-origin")).toBe(
      live.headers.get("access-control-allow-origin"),
    );
    expect(ghost.text.replace("/nowhere-at-all/", "/garden/")).toBe(live.text);
    expect(ghost.text).not.toBe(live.text);
  });

  it("the mount doors themselves are unchanged: an unrouted path still draws the uniform 401", async () => {
    const base = await served();
    const ghostMount = await get(`${base}/nowhere-at-all/mcp`, "POST");
    const unrouted = await get(`${base}/.well-known/oauth-protected-resource/garden`, "POST");
    const nested = await get(`${base}${WELL_KNOWN}/garden/mcp/extra`, "POST");
    const reEncoded = await get(`${base}${WELL_KNOWN}/%67arden/mcp`, "POST");
    const empty = await get(`${base}${WELL_KNOWN}//mcp`, "POST");
    expect(ghostMount.status).toBe(401);
    for (const answer of [unrouted, nested, reEncoded, empty]) {
      expect(answer.status).toBe(ghostMount.status);
      expect(answer.text).toBe(ghostMount.text);
    }
  });
});

describe("T177 — (5) end to end: challenge → document → registration, real requests only", () => {
  it("a client that reads only the 401's header reaches a 201 from the registration door", async () => {
    const base = await served();

    const refusal = await fetch(`${base}/garden/mcp`, { method: "POST" });
    expect(refusal.status).toBe(401);

    const named = /resource_metadata="([^"]+)"/.exec(
      refusal.headers.get("www-authenticate") ?? "",
    )?.[1];
    const resource = doc(await get(`${base}${pathOf(named!)}`));

    const servers = resource["authorization_servers"] as readonly string[];
    expect(servers).toHaveLength(1);
    const asDoc = doc(
      await get(`${base}${pathOf(servers[0]!)}/.well-known/oauth-authorization-server`),
    );

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
