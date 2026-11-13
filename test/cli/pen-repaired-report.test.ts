import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { penSeedPath, readSeed, storePath, writePenSeed } from "../../src/cli/config.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { SqliteBackend } from "../../src/store/sqlite.js";

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-pen-report-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("loam pen create — the repaired arm's report", () => {
  it("a repair that negated a previous key SAYS it negated the key", async () => {
    await run(["init", "--home", home], io());
    await run(["pen", "create", "guest-pen", "--home", home], io());
    const oldAuthor = authorForSeed(readFileSync(penSeedPath(home, "guest-pen"), "utf8").trim());

    const replacement = "7a".repeat(32);
    writePenSeed(home, "guest-pen", replacement);
    out.length = 0;

    const code = await run(["pen", "create", "guest-pen", "--home", home], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("repaired pen guest-pen");
    expect(printed).toContain(`the previous key ${oldAuthor}: its`);
    expect(printed).toMatch(/grants? (is|are) negated and no longer bind/);
    expect(printed).not.toContain(replacement);
  });

  it("a grant-only repair does NOT claim a negation it never made", async () => {
    await run(["init", "--home", home], io());
    writePenSeed(home, "hand-pen", "5c".repeat(32));
    out.length = 0;

    const code = await run(["pen", "create", "hand-pen", "--home", home], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("repaired pen hand-pen");
    expect(printed).toContain("write grant for its author");
    expect(printed).not.toContain("previous key");
    expect(printed).not.toContain("negated");
  });
});

describe("loam register --help — the shelf's federation warning", () => {
  it("distinguishes the latest-wins props from the append-all lists", async () => {
    const code = await run(["register", "--help"], io());
    expect(code).toBe(0);
    const printed = [...out, ...err].join("\n");
    expect(printed).toContain("Single-value props are latest-wins");
    expect(printed).toContain("tags, attending, follows");
    expect(printed).not.toMatch(/Props are latest-wins/);
  });
});

async function ground(): Promise<Gateway> {
  return Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
}

describe("loam pen create — the promises beyond the report text", () => {
  it("the seed never enters the ground, on any arm — mint, hand-replace, repair", async () => {
    await run(["init", "--home", home], io());
    await run(["pen", "create", "guest-pen", "--home", home], io());
    const minted = readFileSync(penSeedPath(home, "guest-pen"), "utf8").trim();
    const replacement = "7a".repeat(32);
    writePenSeed(home, "guest-pen", replacement);
    await run(["pen", "create", "guest-pen", "--home", home], io());
    const gw = await ground();
    try {
      for (const seed of [minted, replacement]) {
        const leaked = gw.reactor.arrivalLog().some((d) => JSON.stringify(d.claims).includes(seed));
        expect(leaked, "a pen seed appeared in a delta's claims").toBe(false);
      }
    } finally {
      await gw.close();
    }
  });

  it("a negated key loses EVERY verb it held, not only write", async () => {
    await run(["init", "--home", home], io());
    await run(["pen", "create", "guest-pen", "--home", home], io());
    const oldSeed = readFileSync(penSeedPath(home, "guest-pen"), "utf8").trim();
    const oldAuthor = authorForSeed(oldSeed);
    const seed = readSeed(home);
    const gw0 = await ground();
    try {
      await gw0.append([
        signClaims(
          grantClaims(STORE_ENTITY, oldAuthor, "admin", authorForSeed(seed), Date.now()),
          seed,
        ),
      ]);
    } finally {
      await gw0.close();
    }

    writePenSeed(home, "guest-pen", "7a".repeat(32));
    out.length = 0;
    const code = await run(["pen", "create", "guest-pen", "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("2 grants are negated and no longer bind");

    const gw = await ground();
    try {
      const surviving = [...gw.reactor.snapshot()].filter((d) => {
        if (gw.reactor.negationsOf(d.id).length > 0) return false;
        return d.claims.pointers.some(
          (pt) =>
            pt.role === "subject" &&
            pt.target.kind === "primitive" &&
            pt.target.value === oldAuthor,
        );
      });
      expect(surviving.map((d) => d.id)).toEqual([]);
    } finally {
      await gw.close();
    }
  });
});
