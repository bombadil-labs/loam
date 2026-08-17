// T174 — the operator's side of the register verb: minting a scoped grant, reading back what was
// handed out, and killing it.
//
// `test/server/register-verb.test.ts` proves the DOOR honours the grant. This file proves the
// operator can actually create one, SEE it, and revoke it — the three motions that make an
// authority verb operable rather than merely implemented. `loam grant list` is the one surface an
// operator has for reading their own delegations back, so a verb it cannot show is a verb nobody
// can audit.
//
// Every store here is a fresh temp home. Nothing in this file touches a real ~/.loam.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { EMPTY_OAUTH, writeOAuthFile, type OAuthFile } from "../../src/server/oauth-file.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { registerPrefixesOf } from "../../src/gateway/accounts.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { readFileSync } from "node:fs";

vi.setConfig({ testTimeout: 30_000 });

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });
const printed = (): string => [...out, ...err].join("\n");

const CONNECTOR_SEED = "70".repeat(32);
const CONNECTOR = authorForSeed(CONNECTOR_SEED);
const BYSTANDER_SEED = "e0".repeat(32);
const BYSTANDER = authorForSeed(BYSTANDER_SEED);

// Two connectors that have completed a token exchange — the state `loam grant` operates on.
const seedConnectors = (): void => {
  const file: OAuthFile = {
    ...EMPTY_OAUTH,
    clients: [
      {
        clientId: "cli-thread",
        clientName: "Thread",
        redirectUris: ["https://x/cb"],
        registeredAt: 1,
        generation: 1,
      },
      {
        clientId: "cli-note",
        clientName: "Note",
        redirectUris: ["https://x/cb"],
        registeredAt: 1,
        generation: 1,
      },
    ],
    grants: [
      {
        clientId: "cli-thread",
        actorSeed: CONNECTOR_SEED,
        actor: CONNECTOR,
        grantedAt: 1,
        standing: true,
      },
      {
        clientId: "cli-note",
        actorSeed: BYSTANDER_SEED,
        actor: BYSTANDER,
        grantedAt: 1,
        standing: true,
      },
    ],
  };
  writeOAuthFile(home, file);
};

// What the GROUND says, read independently of anything the CLI prints.
const prefixesInGround = async (author: string): Promise<string[]> => {
  const seed = readFileSync(join(home, "operator.seed"), "utf8").trim();
  const gateway = await Gateway.boot(
    new SqliteBackend(join(home, "store.sqlite")),
    assembleGenesis({ operatorSeed: seed }),
  );
  try {
    return registerPrefixesOf(gateway.reactor, author, authorForSeed(seed));
  } finally {
    await gateway.close();
  }
};

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "loam-grant-register-"));
  out.length = 0;
  err.length = 0;
  expect(await run(["init", "--home", home], io())).toBe(0);
  out.length = 0;
  err.length = 0;
  seedConnectors();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("T174 — loam grant <connector> --verb=register --prefix=<p>", () => {
  it("mints a register grant in the ground, scoped to the prefix", async () => {
    const code = await run(
      ["grant", "cli-thread", "--verb=register", "--prefix=thread:", "--home", home],
      io(),
    );
    expect(code, printed()).toBe(0);
    expect(printed()).toContain("thread:");
    expect(await prefixesInGround(CONNECTOR)).toEqual(["thread:"]);
    // Two-sided: the other connector got nothing.
    expect(await prefixesInGround(BYSTANDER)).toEqual([]);
  });

  it("refuses a register grant with no prefix — root registration is not delegable", async () => {
    const code = await run(["grant", "cli-thread", "--verb=register", "--home", home], io());
    expect(code).toBe(2);
    expect(printed()).toContain("--prefix");
    expect(await prefixesInGround(CONNECTOR)).toEqual([]);
  });

  it("refuses an EMPTY prefix, which would be root wearing a fence's clothes", async () => {
    const code = await run(
      ["grant", "cli-thread", "--verb=register", "--prefix=", "--home", home],
      io(),
    );
    expect(code).toBe(2);
    expect(await prefixesInGround(CONNECTOR)).toEqual([]);
  });

  it("refuses a connector this store does not hold", async () => {
    const code = await run(
      ["grant", "cli-nobody", "--verb=register", "--prefix=thread:", "--home", home],
      io(),
    );
    expect(code).toBe(2);
    expect(printed()).toContain("cli-nobody");
  });

  it("refuses a verb it does not mint", async () => {
    const code = await run(
      ["grant", "cli-thread", "--verb=admin", "--prefix=thread:", "--home", home],
      io(),
    );
    expect(code).toBe(2);
    expect(await prefixesInGround(CONNECTOR)).toEqual([]);
  });
});

describe("T174 — loam grant list shows the verb and the prefix", () => {
  it("an operator can read back exactly what they handed out", async () => {
    expect(
      await run(
        ["grant", "cli-thread", "--verb=register", "--prefix=thread:", "--home", home],
        io(),
      ),
    ).toBe(0);
    out.length = 0;
    err.length = 0;

    expect(await run(["grant", "list", "--home", home], io())).toBe(0);
    const listing = printed();
    expect(listing).toContain("cli-thread");
    expect(listing).toContain("register");
    expect(listing).toContain("thread:");
    // The bystander is listed too, and is NOT shown holding the prefix it was never given.
    const noteLine = listing
      .split("\n")
      .filter((l) => l.includes("cli-note"))
      .join("\n");
    expect(noteLine).not.toContain("thread:");
  });

  it("before any grant, the listing says so rather than inventing standing", async () => {
    expect(await run(["grant", "list", "--home", home], io())).toBe(0);
    expect(printed()).not.toContain("register");
  });
});

describe("T174 — loam grant revoke kills register standing", () => {
  it("the ground stops naming the prefix, and a bystander's prefix survives", async () => {
    for (const [client, prefix] of [
      ["cli-thread", "thread:"],
      ["cli-note", "note:"],
    ] as const) {
      expect(
        await run(["grant", client, "--verb=register", `--prefix=${prefix}`, "--home", home], io()),
      ).toBe(0);
    }
    expect(await prefixesInGround(CONNECTOR)).toEqual(["thread:"]);
    expect(await prefixesInGround(BYSTANDER)).toEqual(["note:"]);

    out.length = 0;
    err.length = 0;
    expect(await run(["grant", "revoke", "cli-thread", "--home", home], io()), printed()).toBe(0);

    expect(await prefixesInGround(CONNECTOR)).toEqual([]);
    expect(await prefixesInGround(BYSTANDER)).toEqual(["note:"]);
  });
});

describe("T174 — the grant form is one connector at a time", () => {
  it("a second positional is a usage error, not a silently ignored one", async () => {
    const code = await run(
      ["grant", "cli-thread", "cli-note", "--verb=register", "--prefix=thread:", "--home", home],
      io(),
    );
    expect(code).toBe(2);
    expect(await prefixesInGround(CONNECTOR)).toEqual([]);
    expect(await prefixesInGround(BYSTANDER)).toEqual([]);
  });
});
