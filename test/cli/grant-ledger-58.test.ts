// §58 S1b (T262): the ledger names each KEY a connector holds — one per person who consented —
// with that key's own binding and that key's own live-token count, never the connector's total.
// The T205 ledger rail (`grant-ledger.test.ts`) is frozen and seeds one pre-§58 key per client, so a
// per-connector count and a per-key count coincide there; this file is where they differ.
//
// Erasure standing rule: every store here is this file's own mkdtemp fixture.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { EMPTY_OAUTH, writeOAuthFile } from "../../src/server/oauth-file.js";

vi.setConfig({ testTimeout: 60_000 });

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });
const printed = (): string => [...out, ...err].join("\n");
const rowFor = (listing: string, needle: string): string =>
  listing
    .split("\n")
    .filter((l) => l.includes(needle))
    .join("\n");

const ADA_SEED = "a1".repeat(32);
const BEA_SEED = "b2".repeat(32);
const ADA = authorForSeed(ADA_SEED);
const BEA = authorForSeed(BEA_SEED);

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "loam-ledger-58-"));
  out.length = 0;
  err.length = 0;
  expect(await run(["init", "--home", home], io())).toBe(0);
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("§58 — one connector, two people, two keys on the ledger", () => {
  it("each key's row names its person and container and counts its own live tokens", async () => {
    const grant = (user: string, seed: string, container: string) => ({
      clientId: "cli-claude",
      actorSeed: seed,
      actor: authorForSeed(seed),
      grantedAt: 1,
      standing: true,
      user,
      container,
      inbox: `inbox:${container}:${authorForSeed(seed)}`,
    });
    const token = (digest: string, user: string) => ({
      digest,
      clientId: "cli-claude",
      issuedAt: 1,
      generation: 1,
      user,
    });
    writeOAuthFile(home, {
      ...EMPTY_OAUTH,
      clients: [
        {
          clientId: "cli-claude",
          clientName: "Claude",
          redirectUris: ["https://x/cb"],
          registeredAt: 1,
          generation: 1,
        },
      ],
      grants: [grant("ada", ADA_SEED, "ada:journal"), grant("bea", BEA_SEED, "bea:notes")],
      tokens: [
        token("aa".repeat(32), "ada"),
        token("ab".repeat(32), "ada"),
        token("bb".repeat(32), "bea"),
      ],
    });
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    // The ledger abbreviates an author; the row is found by the same prefix it prints.
    const ada = rowFor(listing, ADA.slice(0, 20));
    const bea = rowFor(listing, BEA.slice(0, 20));
    expect(ada, listing).not.toBe("");
    expect(bea, listing).not.toBe("");
    expect(ada).toContain("ada · ada:journal");
    expect(ada).toContain("2 live tokens");
    expect(ada).not.toContain("3 live tokens");
    expect(bea).toContain("bea · bea:notes");
    expect(bea).toContain("1 live token");
    expect(bea).not.toContain("1 live tokens");
    // Neither row is the other's, and the seeds never print.
    expect(ada).not.toContain(BEA.slice(0, 20));
    expect(listing).not.toContain(ADA_SEED);
    expect(listing).not.toContain(BEA_SEED);
  });
});
