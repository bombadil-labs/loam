// SPEC §56 criteria (T255): a caller may ask who the door thinks they are. Under mask: drop,
// an anonymous reader and an empty store are indistinguishable from outside — a masked-auth
// failure renders as a welcoming empty state, confidently wrong (H9 at the door; the
// synchronicity artifact paid it). The answer: `loam_whoami` on the MCP roster and
// `GET /:mount/whoami` as the non-MCP sibling, both resolving THIS request's identity and
// reading its standing from the GROUND, so a revocation binds on the very next call.
//
// The four kinds are the contract: operator, connector (a token the oauth exchange minted),
// actor (a configured bearer acting as a key), anonymous — each answer distinct, truthful,
// and the anonymous one saying IN WORDS that reads are masked and views fold empty.
//
// Erasure standing rule: every store here is this file's own memory/mkdtemp fixture.

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, makeNegationClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { initHome } from "../../src/cli/config.js";
import { EMPTY_OAUTH, writeOAuthFile, type OAuthClient } from "../../src/server/oauth-file.js";
import { writeCredentials } from "../../src/server/credentials.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ADA_SEED = "3a".repeat(32);
const ADA = authorForSeed(ADA_SEED);
const RAE_SEED = "3b".repeat(32);
const RAE = authorForSeed(RAE_SEED);
const CONNECTOR_SEED = "3c".repeat(32);
const CONNECTOR = authorForSeed(CONNECTOR_SEED);
const CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const BEARER = "connector-bearer-secret-for-the-rail";

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const client = (): OAuthClient => ({
  clientId: CLIENT_ID,
  clientName: "Claude",
  redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  registeredAt: 1000,
  generation: 1,
});

/**
 * A store with every kind at the door: the operator token, two actor tokens (ada granted, rae
 * her sibling), and a connector whose oauth grant and live token are written FILE-FIRST — the
 * exact rows the PKCE dance persists, without the dance (oauth-token.test.ts proves the dance;
 * this file proves the answer).
 */
async function fourDoorStore(): Promise<{ base: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, ADA, "write", OPERATOR, ts++), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, ADA, "register", OPERATOR, ts++, "sync:"), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, RAE, "write", OPERATOR, ts++), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, CONNECTOR, "write", OPERATOR, ts++), OPERATOR_SEED),
  ]);
  const home = mkdtempSync(join(tmpdir(), "loam-t255-"));
  homes.push(home);
  initHome(home, OPERATOR_SEED);
  writeCredentials(home, { version: 1, users: {} });
  writeOAuthFile(home, {
    ...EMPTY_OAUTH,
    clients: [client()],
    grants: [
      {
        clientId: CLIENT_ID,
        actorSeed: CONNECTOR_SEED,
        actor: CONNECTOR,
        grantedAt: 2000,
        standing: true,
      },
    ],
    tokens: [
      {
        digest: createHash("sha256").update(BEARER).digest("hex"),
        clientId: CLIENT_ID,
        issuedAt: 2000,
        generation: 1,
      },
    ],
  });
  const handle = await serve({
    mounts: { default: gateway },
    tokens: {
      "op-token": { operator: true },
      "ada-token": { actor: ADA_SEED },
      "rae-token": { actor: RAE_SEED },
    },
    port: 0,
    host: "127.0.0.1",
    publicUrl: "https://store.example",
    connectors: { home, allowRedirectOrigins: ["https://claude.ai"] },
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return { base: handle.url, gateway };
}

interface Answer {
  kind: string;
  author: string | null;
  clientId?: string;
  operator: boolean;
  write: boolean;
  registerPrefixes: string[];
  federateContainers: string[];
  masked: boolean;
  note: string;
}

const restWhoami = async (base: string, bearer?: string): Promise<Answer> =>
  (await (
    await fetch(`${base}/default/whoami`, {
      headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
    })
  ).json()) as Answer;

const mcpWhoami = async (base: string, bearer?: string): Promise<Answer> => {
  const res = await fetch(`${base}/default/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "loam_whoami", arguments: {} },
    }),
  });
  const body = (await res.json()) as {
    result: { content: Array<{ type: string; text: string }> };
  };
  return JSON.parse(body.result.content[0]!.text) as Answer;
};

describe("T255 (a) — four kinds, four distinct truthful answers", () => {
  it("the operator is the operator: unfenced, and never masked", async () => {
    const { base } = await fourDoorStore();
    const a = await restWhoami(base, "op-token");
    expect(a.kind).toBe("operator");
    expect(a.operator).toBe(true);
    expect(a.author).toBe(OPERATOR);
    expect(a.masked).toBe(false);
  });

  it("an actor token answers with its key and exactly its granted standing", async () => {
    const { base } = await fourDoorStore();
    const a = await mcpWhoami(base, "ada-token");
    expect(a.kind).toBe("actor");
    expect(a.author).toBe(ADA);
    expect(a.operator).toBe(false);
    expect(a.write).toBe(true);
    expect(a.registerPrefixes).toEqual(["sync:"]);
    expect(a.masked).toBe(false);
  });

  it("a connector's minted token answers as CONNECTOR, naming its client", async () => {
    const { base } = await fourDoorStore();
    const a = await mcpWhoami(base, BEARER);
    expect(a.kind).toBe("connector");
    expect(a.clientId).toBe(CLIENT_ID);
    expect(a.author).toBe(CONNECTOR);
    expect(a.write).toBe(true);
    expect(a.operator).toBe(false);
  });

  it("ANONYMOUS says so, in words: masked reads, views folding empty for this caller", async () => {
    const { base } = await fourDoorStore();
    const a = await restWhoami(base);
    expect(a.kind).toBe("anonymous");
    expect(a.author).toBeNull();
    expect(a.operator).toBe(false);
    expect(a.write).toBe(false);
    expect(a.masked).toBe(true);
    // The sentence the synchronicity artifact needed: an empty view for THIS caller is not an
    // empty store.
    expect(a.note).toMatch(/masked/i);
    expect(a.note).toMatch(/empty/i);
  });
});

describe("T255 (b) — the answer reads the ground: a revocation binds on the very next call", () => {
  it("striking ada's write grant flips her answer while rae's survives, no restart", async () => {
    const { base, gateway } = await fourDoorStore();
    expect((await restWhoami(base, "ada-token")).write).toBe(true);

    // The operator strikes ada's write grant — the surviving grants no longer speak for her.
    const writeGrant = [...gateway.reactor.snapshot()].find(
      (d) =>
        d.claims.pointers.some((p) => p.role === "verb" && p.target.kind === "primitive") &&
        JSON.stringify(d.claims.pointers).includes(ADA) &&
        JSON.stringify(d.claims.pointers).includes('"write"'),
    );
    expect(writeGrant, "the fixture's write grant was not found").toBeDefined();
    await gateway.append([
      signClaims(
        makeNegationClaims(OPERATOR, gateway.nextTimestamp(), writeGrant!.id),
        OPERATOR_SEED,
      ),
    ]);

    const ada = await restWhoami(base, "ada-token");
    expect(ada.write).toBe(false);
    expect(ada.registerPrefixes).toEqual(["sync:"]); // the untouched grant still speaks
    const rae = await restWhoami(base, "rae-token");
    expect(rae.write).toBe(true);
  });
});

describe("T255 (c) — the roster teaches when to ask", () => {
  it("loam_whoami is listed, and its description names the empty-vs-masked question", async () => {
    const { base } = await fourDoorStore();
    const res = await fetch(`${base}/default/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const body = (await res.json()) as {
      result: { tools: Array<{ name: string; description: string }> };
    };
    const tool = body.result.tools.find((t) => t.name === "loam_whoami");
    expect(tool, "loam_whoami is not on the roster").toBeDefined();
    expect(tool!.description).toMatch(/masked|empty/i);
  });
});
