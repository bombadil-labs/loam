import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { readSeed, storePath, writePenSeed } from "../../src/cli/config.js";
import { CTX_GRANTS, grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { SqliteBackend } from "../../src/store/sqlite.js";

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-pen-window-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const HOUR = 3_600_000;
const PEN_SEED = "7a".repeat(32);
const penAuthor = authorForSeed(PEN_SEED);

async function withGateway<T>(fn: (gw: Gateway, operator: string) => T | Promise<T>): Promise<T> {
  const seed = readSeed(home);
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: seed }),
  );
  try {
    return await fn(gw, authorForSeed(seed));
  } finally {
    await gw.close();
  }
}

async function provision(window: { validFrom: number; validUntil?: number }): Promise<void> {
  await run(["init", "--home", home], io());
  writePenSeed(home, "timed-pen", PEN_SEED);
  await withGateway(async (gw, operator) => {
    const claims = {
      ...grantClaims(STORE_ENTITY, penAuthor, "write", operator, Date.now()),
      ...window,
    };
    await gw.append([signClaims(claims, readSeed(home))]);
  });
}

const standing = () =>
  withGateway((gw, operator) => ({
    grants: [...gw.reactor.snapshot()].filter(
      (d) =>
        d.claims.author === operator &&
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === CTX_GRANTS,
        ) &&
        d.claims.pointers.some(
          (p) =>
            p.role === "subject" && p.target.kind === "primitive" && p.target.value === penAuthor,
        ),
    ).length,
    held: holdsGrant(gw.reactor, gw.validityNow(), STORE_ENTITY, penAuthor, "write", operator),
  }));

async function createAgain(): Promise<{ code: unknown; said: string }> {
  out.length = 0;
  err.length = 0;
  const code = await run(["pen", "create", "timed-pen", "--home", home], io());
  return { code, said: err.join("\n") };
}

describe("pen create reports a write grant as held only when the door holds it", () => {
  it("an EXPIRED grant is not reported as held", async () => {
    const now = Date.now();
    await provision({ validFrom: now - 2 * HOUR, validUntil: now - HOUR });
    expect(await standing()).toEqual({ grants: 1, held: false });

    const { code, said } = await createAgain();
    expect(code).toBe(2);
    expect(said).toContain("already provisioned");
    expect(said).not.toContain("holds a write grant");
    expect(said).toContain("the door does not honour that grant now");
    expect(await standing()).toEqual({ grants: 1, held: false });
  });

  it("a NOT-YET-VALID grant is not reported as held", async () => {
    const now = Date.now();
    await provision({ validFrom: now + HOUR });
    expect(await standing()).toEqual({ grants: 1, held: false });

    const { code, said } = await createAgain();
    expect(code).toBe(2);
    expect(said).not.toContain("holds a write grant");
    expect(said).toContain("the door does not honour that grant now");
    expect(await standing()).toEqual({ grants: 1, held: false });
  });

  it("control: a LIVE grant is still reported as held", async () => {
    const now = Date.now();
    await provision({ validFrom: now - HOUR, validUntil: now + HOUR });
    expect(await standing()).toEqual({ grants: 1, held: true });

    const { code, said } = await createAgain();
    expect(code).toBe(2);
    expect(said).toContain("its author holds a write grant");
    expect(said).not.toContain("does not honour");
    expect(await standing()).toEqual({ grants: 1, held: true });
  });
});
