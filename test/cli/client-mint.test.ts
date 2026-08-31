// SPEC §57 criteria (T256): scoped non-interactive credentials in one verb. `loam client mint`
// generates a seed the home keeps (0600, never printed), mints the requested grants for its
// key, records the bearer's digest in clients.json, and prints the bearer ONCE with the
// warning that matters: WRITE STANDING IS STORE-WIDE by design — the fences are attribution
// (every delta carries the client's own author) and the readers' trust masks, never a door
// prefix. Register alone is prefix-fenced.
//
// FRESHNESS IS SPLIT, HONESTLY (T103's architecture, criterion a2): the TOKEN is read from
// clients.json per request, so it authenticates and retires with no restart; the GRANTS live
// in the served reactor from boot, so minting beside a live server prints the staleness
// warning and standing moves at restart. Both directions asserted.
//
// Erasure standing rule: every store here is this file's own mkdtemp fixture.

import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { readSeed, storePath } from "../../src/cli/config.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { SqliteBackend } from "../../src/store/sqlite.js";

const homes: string[] = [];
const handles: ServerHandle[] = [];
const gateways: Gateway[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (gateways.length > 0) await gateways.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

interface IOCap {
  out: string[];
  err: string[];
  io: { out: (s: string) => void; err: (s: string) => void };
}
const cap = (): IOCap => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
};

const bearerOf = (lines: string[]): string => {
  const line = lines.join("\n").match(/bearer: ([A-Za-z0-9_-]+)/);
  expect(line, "the mint printed no bearer line").not.toBeNull();
  return line![1]!;
};

async function mintedHome(): Promise<{ home: string; bearer: string }> {
  const home = mkdtempSync(join(tmpdir(), "loam-t256-"));
  homes.push(home);
  expect(await run(["init", "--home", home], cap().io)).toBe(0);
  const c = cap();
  const code = await run(
    ["client", "mint", "artifact", "--home", home, "--register-prefix", "medialog:"],
    c.io,
  );
  expect(code).toBe(0);
  return { home, bearer: bearerOf(c.out) };
}

async function served(home: string): Promise<{ base: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new SqliteBackend(storePath(home)), {
    seed: readSeed(home),
  });
  gateways.push(gateway);
  const handle = await serve({
    // serve refuses an empty token table; the operator token stands unused so every assertion
    // below exercises only the minted bearer.
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default" },
    clients: { home },
  });
  handles.push(handle);
  return { base: handle.url, gateway };
}

const mcp = async (
  base: string,
  bearer: string,
  method: string,
  params: unknown,
): Promise<{ status: number; body: unknown }> => {
  const res = await fetch(`${base}/default/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
};

const whoami = async (base: string, bearer: string): Promise<Record<string, unknown>> => {
  const r = await mcp(base, bearer, "tools/call", { name: "loam_whoami", arguments: {} });
  expect(r.status).toBe(200);
  const text = (r.body as { result: { content: Array<{ text: string }> } }).result.content[0]!
    .text;
  return JSON.parse(text) as Record<string, unknown>;
};

const REGISTRATION = (name: string): Record<string, unknown> => ({
  hyperschema: {
    name,
    alg: 1,
    body: {
      op: "group",
      key: "byTargetContext",
      in: {
        op: "select",
        pred: { hasPointer: { targetEntity: { var: "root" } } },
        in: { op: "mask", policy: "drop", in: "input" },
      },
    },
  },
  schema: {
    props: { title: { pick: { order: { byTimestamp: "desc" } } } },
    default: { pick: { order: { byTimestamp: "desc" } } },
  },
  roots: [`${name}:1`],
  writable: ["title"],
});

describe("T256 (a)+(d) — the minted client acts as its own author, inside its register fence", () => {
  it("whoami answers actor with the granted prefix; register lands inside it and refuses outside", async () => {
    const { home, bearer } = await mintedHome();
    const { base, gateway } = await served(home);

    const who = await whoami(base, bearer);
    expect(who.kind).toBe("actor");
    expect(who.write).toBe(true);
    expect(who.registerPrefixes).toEqual(["medialog:"]);

    const inside = await mcp(base, bearer, "tools/call", {
      name: "loam_register",
      arguments: REGISTRATION("medialog:entry"),
    });
    expect(inside.status).toBe(200);
    const insideText = JSON.stringify(inside.body);
    expect(insideText).not.toContain("constitutional");

    const outside = await mcp(base, bearer, "tools/call", {
      name: "loam_register",
      arguments: REGISTRATION("neighbor:entry"),
    });
    expect(JSON.stringify(outside.body)).toContain("constitutional");

    // The write path: a mutation through the generated surface lands AS THE CLIENT'S AUTHOR —
    // attribution is the fence the warning names.
    const wrote = await mcp(base, bearer, "tools/call", {
      name: "loam_mutate",
      arguments: {
        mutation: `mutation { medialog_entry(entity: "medialog:entry:1", title: "Spirit of Eden") { title } }`,
      },
    });
    expect(wrote.status).toBe(200);
    const clientAuthors = [...gateway.reactor.snapshot()]
      .filter((d) => JSON.stringify(d.claims.pointers).includes("Spirit of Eden"))
      .map((d) => d.claims.author);
    expect(clientAuthors).toHaveLength(1);
    expect(clientAuthors[0]).not.toBe(authorForSeed(readSeed(home)));
  });
});

describe("T256 (a2) — freshness is split, honestly", () => {
  it("a mint beside a live server: the token authenticates NOW, the standing waits for restart, and the warning says so", async () => {
    const { home } = await mintedHome();
    const { base } = await served(home);

    const c = cap();
    const code = await run(
      ["client", "mint", "second", "--home", home, "--register-prefix", "other:"],
      c.io,
    );
    expect(code).toBe(0);
    const text = [...c.out, ...c.err].join("\n");
    expect(text, "no staleness warning beside a live server").toMatch(/restart/i);

    const fresh = bearerOf(c.out);
    const who = await whoami(base, fresh);
    // The token half: authenticated immediately, no restart.
    expect(who.kind).toBe("actor");
    // The grants half: the served reactor booted before the mint, so no standing shows yet.
    expect(who.write).toBe(false);
    expect(who.registerPrefixes).toEqual([]);
  });
});

describe("T256 (b) — revoke retires the token next-request; the sibling survives", () => {
  it("the revoked bearer stops authenticating with no restart; strikes land at the delta level", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-t256-"));
    homes.push(home);
    expect(await run(["init", "--home", home], cap().io)).toBe(0);
    const c1 = cap();
    expect(await run(["client", "mint", "one", "--home", home], c1.io)).toBe(0);
    const c2 = cap();
    expect(await run(["client", "mint", "two", "--home", home], c2.io)).toBe(0);
    const one = bearerOf(c1.out);
    const two = bearerOf(c2.out);
    const { base, gateway } = await served(home);

    expect((await whoami(base, one)).kind).toBe("actor");

    const grantsBefore = [...gateway.reactor.snapshot()].length;
    expect(await run(["client", "revoke", "one", "--home", home], cap().io)).toBe(0);

    // The token half, immediately: the digest left clients.json, so the very next request is
    // anonymous at the door (the MCP door refuses without a credential).
    const refused = await mcp(base, one, "tools/call", { name: "loam_whoami", arguments: {} });
    expect(refused.status).toBe(401);
    // The sibling's token and its file survive.
    expect((await whoami(base, two)).kind).toBe("actor");
    // The strike half, at the deltas: the revoke appended negations into the store.
    const backend = new SqliteBackend(storePath(home));
    const audit = await Gateway.open(backend, { seed: readSeed(home) });
    gateways.push(audit);
    expect([...audit.reactor.snapshot()].length).toBeGreaterThan(grantsBefore);
  });
});

describe("T256 (c) — the bearer prints once with the warning; the seed never prints", () => {
  it("output carries the bearer and the store-wide-write warning, not the seed; the seed file is 0600", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-t256-"));
    homes.push(home);
    expect(await run(["init", "--home", home], cap().io)).toBe(0);
    const c = cap();
    expect(await run(["client", "mint", "artifact", "--home", home], c.io)).toBe(0);
    const text = [...c.out, ...c.err].join("\n");

    expect(text).toMatch(/bearer: [A-Za-z0-9_-]{20,}/);
    expect(text).toMatch(/store-wide/i);
    expect(text).toMatch(/own author|attribution/i);

    const seedFile = join(home, "client.artifact.seed");
    expect(existsSync(seedFile)).toBe(true);
    const seed = readFileSync(seedFile, "utf8").trim();
    expect(text).not.toContain(seed);
    expect(statSync(seedFile).mode & 0o777).toBe(0o600);
  });
});
