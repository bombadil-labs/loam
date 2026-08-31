// SPEC §57 criteria (T256): scoped non-interactive credentials in one verb. `loam client mint`
// generates a seed the home keeps (0600, never printed), mints the requested grants for its
// key, records the bearer's digest in clients.json, and prints the bearer ONCE with the
// warning that matters: WRITE STANDING IS STORE-WIDE by design — the fences are attribution
// (every delta carries the client's own author) and the readers' trust masks, never a door
// prefix. Register alone is prefix-fenced.
//
// FRESHNESS IS SPLIT, HONESTLY (T103's architecture, criterion a2): the TOKEN is read from
// clients.json per request, so it authenticates and retires with no restart; the GRANTS live
// in the served reactor from boot, so minting beside a live server prints the pointed
// staleness warning (the fixture records a live serving pid so the probe actually fires) and
// standing moves at restart. Both directions asserted.
//
// REVOKE IS ASSERTED TWO-SIDED at both levels (the erasure rail rule): the named client's
// grants are struck and its standing resolves gone, AND the sibling's grants carry no strike
// and its standing survives — an over-purging revoke fails here, not only an under-purging one.
//
// Erasure standing rule: every store here is this file's own mkdtemp fixture.

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { readSeed, storePath } from "../../src/cli/config.js";
import { grantsHeldBy } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  clientSeedPath,
  readClientSeed,
  readClientsFile,
  writeClientsFile,
} from "../../src/server/clients-file.js";
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
  const text = (r.body as { result: { content: Array<{ text: string }> } }).result.content[0]!.text;
  return JSON.parse(text) as Record<string, unknown>;
};

const REGISTRATION = (name: string, lensName?: string): Record<string, unknown> => ({
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
    // The LENS name diverges from the program name through here (lensNameFor reads schema.name).
    ...(lensName === undefined ? {} : { name: lensName }),
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

    // The fence covers BOTH halves of the name pair (the H6 family): a schema name inside the
    // prefix must not smuggle a LENS name outside it.
    const smuggled = await mcp(base, bearer, "tools/call", {
      name: "loam_register",
      arguments: REGISTRATION("medialog:sly", "neighbor:sly"),
    });
    expect(JSON.stringify(smuggled.body)).toContain("constitutional");

    // The write path: a mutation through the generated surface lands as the client's OWN
    // author — bound to its exact key, so a door signing with any shared or ephemeral key
    // fails here, not merely a door signing as the operator.
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
    expect(clientAuthors[0]).toBe(authorForSeed(readClientSeed(home, "artifact")));
  });
});

describe("T256 (a2) — freshness is split, honestly", () => {
  it("a mint beside a live server: the token authenticates NOW, the standing waits for restart, and the warning says so", async () => {
    const { home } = await mintedHome();
    const { base } = await served(home);
    // The staleness probe reads serving.json, which only `loam serve` writes; the programmatic
    // serve() above leaves none. The fixture records this very process as the live server —
    // a live pid over the same resolved store — so the POINTED warning must fire on err.
    writeFileSync(
      join(home, "serving.json"),
      `${JSON.stringify({ pid: process.pid, url: base, store: storePath(home), startedAt: Date.now() })}\n`,
    );

    const c = cap();
    const code = await run(
      ["client", "mint", "second", "--home", home, "--register-prefix", "other:"],
      c.io,
    );
    expect(code).toBe(0);
    // The unconditional split note rides stdout; the live-server probe's warning rides err and
    // only exists because the serving record above matched — delete servingWarning and this fails.
    expect(c.out.join("\n"), "the split epilogue is missing").toMatch(/restart/i);
    expect(c.err.join("\n"), "no staleness warning beside a live server").toMatch(
      /serving this store right now/,
    );

    const fresh = bearerOf(c.out);
    const who = await whoami(base, fresh);
    // The token half: authenticated immediately, no restart.
    expect(who.kind).toBe("actor");
    // The grants half: the served reactor booted before the mint, so no standing shows yet.
    expect(who.write).toBe(false);
    expect(who.registerPrefixes).toEqual([]);
  });
});

describe("T256 (b) — revoke is two-sided at both levels; the sibling survives", () => {
  it("the revoked bearer stops authenticating with no restart; its grants are struck and the sibling's are not", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-t256-"));
    homes.push(home);
    expect(await run(["init", "--home", home], cap().io)).toBe(0);
    const c1 = cap();
    expect(await run(["client", "mint", "one", "--home", home], c1.io)).toBe(0);
    const c2 = cap();
    expect(await run(["client", "mint", "two", "--home", home], c2.io)).toBe(0);
    const one = bearerOf(c1.out);
    const two = bearerOf(c2.out);
    const roster = readClientsFile(home).clients;
    const oneActor = roster.find((r) => r.name === "one")!.actor;
    const twoActor = roster.find((r) => r.name === "two")!.actor;
    const { base, gateway } = await served(home);

    expect((await whoami(base, one)).kind).toBe("actor");
    const grantIdsOf = (actor: string): string[] =>
      [...gateway.reactor.snapshot()]
        .filter((d) =>
          d.claims.pointers.some(
            (p) =>
              p.role === "subject" && p.target.kind === "primitive" && p.target.value === actor,
          ),
        )
        .map((d) => d.id);
    const oneGrants = grantIdsOf(oneActor);
    const twoGrants = grantIdsOf(twoActor);
    expect(oneGrants.length).toBeGreaterThan(0);
    expect(twoGrants.length).toBeGreaterThan(0);

    expect(await run(["client", "revoke", "one", "--home", home], cap().io)).toBe(0);

    // The token half, immediately: the digest left clients.json, so the very next request is
    // refused at the door — while the sibling's token still opens.
    const refused = await mcp(base, one, "tools/call", { name: "loam_whoami", arguments: {} });
    expect(refused.status).toBe(401);
    expect((await whoami(base, two)).kind).toBe("actor");

    // The ground half, on a fresh reactor. Delta level, two-sided: every grant of "one" is
    // struck; no grant of "two" is. Object level, the resolution the doors read: one's
    // standing gone, two's write surviving.
    const audit = await Gateway.open(new SqliteBackend(storePath(home)), {
      seed: readSeed(home),
    });
    gateways.push(audit);
    const struck = new Set<string>();
    for (const d of audit.reactor.snapshot()) {
      for (const p of d.claims.pointers) {
        if (p.role === "negates" && p.target.kind === "delta") struck.add(p.target.deltaRef.delta);
      }
    }
    for (const id of oneGrants)
      expect(struck.has(id), `grant ${id} of "one" not struck`).toBe(true);
    for (const id of twoGrants) expect(struck.has(id), `grant ${id} of "two" struck`).toBe(false);
    const operator = authorForSeed(readSeed(home));
    expect(grantsHeldBy(audit.reactor, oneActor, operator)).toEqual([]);
    expect(grantsHeldBy(audit.reactor, twoActor, operator).map((g) => g.verb)).toContain("write");
    // The sibling's key file survives; the revoked one's is gone.
    expect(existsSync(clientSeedPath(home, "two"))).toBe(true);
    expect(existsSync(clientSeedPath(home, "one"))).toBe(false);
  });

  it("a revoke against the wrong store refuses and destroys nothing", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-t256-"));
    homes.push(home);
    expect(await run(["init", "--home", home], cap().io)).toBe(0);
    const other = join(home, "other.sqlite");
    expect(
      await run(["client", "mint", "movable", "--home", home, "--store", other], cap().io),
    ).toBe(0);

    // No --store: the default store is not where movable's grants landed. Striking there would
    // find nothing, report the grants gone, and delete the record — so it must refuse instead.
    const c = cap();
    expect(await run(["client", "revoke", "movable", "--home", home], c.io)).toBe(2);
    expect(c.err.join("\n")).toContain(other);
    expect(readClientsFile(home).clients.some((r) => r.name === "movable")).toBe(true);
    expect(existsSync(clientSeedPath(home, "movable"))).toBe(true);

    // Pointed at the right store, the same revoke completes.
    expect(
      await run(["client", "revoke", "movable", "--home", home, "--store", other], cap().io),
    ).toBe(0);
    expect(readClientsFile(home).clients.some((r) => r.name === "movable")).toBe(false);
  });

  it("a mint that died between its file writes is still revocable through the seed file", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-t256-"));
    homes.push(home);
    expect(await run(["init", "--home", home], cap().io)).toBe(0);
    expect(await run(["client", "mint", "ghost", "--home", home], cap().io)).toBe(0);
    const ghostActor = authorForSeed(readClientSeed(home, "ghost"));
    // Simulate the crash window: the record never landed, the seed and the grants did. Mint
    // refuses the name ("already exists" — it sees the seed), so revoke MUST reach the key.
    writeClientsFile(home, {
      version: 1,
      clients: readClientsFile(home).clients.filter((r) => r.name !== "ghost"),
    });

    expect(await run(["client", "revoke", "ghost", "--home", home], cap().io)).toBe(0);
    const audit = await Gateway.open(new SqliteBackend(storePath(home)), {
      seed: readSeed(home),
    });
    gateways.push(audit);
    expect(grantsHeldBy(audit.reactor, ghostActor, authorForSeed(readSeed(home)))).toEqual([]);
    expect(existsSync(clientSeedPath(home, "ghost"))).toBe(false);
  });

  it("an orphan whose grants live in a --store is refused against the wrong one, seed kept", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-t256-"));
    homes.push(home);
    expect(await run(["init", "--home", home], cap().io)).toBe(0);
    const other = join(home, "other.sqlite");
    expect(await run(["client", "mint", "stray", "--home", home, "--store", other], cap().io)).toBe(
      0,
    );
    // The crash window again, this time with grants in a non-default store: the record — the
    // only thing that remembered the store — never landed.
    writeClientsFile(home, {
      version: 1,
      clients: readClientsFile(home).clients.filter((r) => r.name !== "stray"),
    });

    // Against the default store nothing names this key: the revoke must refuse and must NOT
    // delete the seed — it is the orphan's only remaining handle on its grants.
    const c = cap();
    expect(await run(["client", "revoke", "stray", "--home", home], c.io)).toBe(2);
    expect(c.err.join("\n")).toMatch(/key file is kept/);
    expect(existsSync(clientSeedPath(home, "stray"))).toBe(true);

    // Against the store that holds the grants, the same revoke completes.
    const strayActor = authorForSeed(readClientSeed(home, "stray"));
    expect(
      await run(["client", "revoke", "stray", "--home", home, "--store", other], cap().io),
    ).toBe(0);
    expect(existsSync(clientSeedPath(home, "stray"))).toBe(false);
    const audit = await Gateway.open(new SqliteBackend(other), { seed: readSeed(home) });
    gateways.push(audit);
    expect(grantsHeldBy(audit.reactor, strayActor, authorForSeed(readSeed(home)))).toEqual([]);
  });
});

describe("T256 — the mint's own fences", () => {
  it("--federate scopes channel standing to the named container", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-t256-"));
    homes.push(home);
    expect(await run(["init", "--home", home], cap().io)).toBe(0);
    expect(
      await run(["client", "mint", "carrier", "--home", home, "--federate", "inbox"], cap().io),
    ).toBe(0);
    const audit = await Gateway.open(new SqliteBackend(storePath(home)), {
      seed: readSeed(home),
    });
    gateways.push(audit);
    const held = grantsHeldBy(
      audit.reactor,
      authorForSeed(readClientSeed(home, "carrier")),
      authorForSeed(readSeed(home)),
    );
    expect(held.map((g) => g.verb)).toContain("federate");
    expect(held.find((g) => g.verb === "federate")?.prefix).toBe("inbox");
  });

  it("the name fence admits what a seed filename can carry and refuses what it cannot", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-t256-"));
    homes.push(home);
    expect(await run(["init", "--home", home], cap().io)).toBe(0);
    expect(await run(["client", "mint", "2pac", "--home", home], cap().io)).toBe(0);
    const c = cap();
    expect(await run(["client", "mint", "bad/name", "--home", home], c.io)).toBe(2);
    expect(c.err.join("\n")).toMatch(/not a name a seed file can carry/);
  });

  it("an unreadable clients.json refuses the mint with a named reason, never guessing", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-t256-"));
    homes.push(home);
    expect(await run(["init", "--home", home], cap().io)).toBe(0);
    writeFileSync(join(home, "clients.json"), "null\n");
    const c = cap();
    expect(await run(["client", "mint", "artifact", "--home", home], c.io)).toBe(1);
    // The NAMED reason, not merely a refusal: "cannot determine" must say what it could not
    // determine, never surface as an accidental TypeError.
    expect(c.err.join("\n")).toMatch(/client records are unreadable/);
    expect(c.err.join("\n")).toMatch(/not a clients file this build can read/);
  });

  it("a door with no clients configured refuses an unknown bearer 401, never crashing", async () => {
    const { home } = await mintedHome();
    const gateway = await Gateway.open(new SqliteBackend(storePath(home)), {
      seed: readSeed(home),
    });
    gateways.push(gateway);
    const handle = await serve({
      mounts: { default: gateway },
      tokens: { "op-token": { operator: true } },
      port: 0,
      host: "127.0.0.1",
    });
    handles.push(handle);
    const r = await mcp(handle.url, "no-such-bearer", "tools/call", {
      name: "loam_whoami",
      arguments: {},
    });
    expect(r.status).toBe(401);
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
    // 0600 like every other secret this home holds — asserted off win32 only, where chmod is
    // advisory and stat reports 0o666 for any writable file (source-persisted.test.ts records
    // the same reasoning). The seed-never-printed assertion above is the load-bearing one and
    // holds on every platform.
    if (process.platform !== "win32") {
      expect(statSync(seedFile).mode & 0o777).toBe(0o600);
    }
  });
});

describe("T256 (e) — the story rail: `loam serve` itself honors a minted bearer", () => {
  it("a CLI-served store answers the minted client with no token configuration at all", async () => {
    const { home, bearer } = await mintedHome();
    const handle = (await run(
      ["serve", "--http", "--port", "0", "--home", home, "--token", "cli-op"],
      cap().io,
      { detach: true },
    )) as ServerHandle;
    handles.push(handle);

    const who = await whoami(handle.url, bearer);
    expect(who.kind).toBe("actor");
    expect(who.registerPrefixes).toEqual(["medialog:"]);
  });
});
