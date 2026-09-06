import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorForSeed } from "@bombadil/rhizomatic";
import { expect, it } from "vitest";
import { run } from "../../src/cli/cli.js";
import { EMPTY_OAUTH, writeOAuthFile } from "../../src/server/oauth-file.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { registerPrefixesOf } from "../../src/gateway/accounts.js";

it("records a bound actor's grant without promising to widen its container fence", async () => {
  const home = mkdtempSync(join(tmpdir(), "loam-bound-grant-"));
  const output: string[] = [];
  const io = { out: (s: string) => output.push(s), err: (s: string) => output.push(s) };
  const actorSeed = "70".repeat(32),
    actor = authorForSeed(actorSeed);
  try {
    expect(await run(["init", "--home", home, "--no-user"], io)).toBe(0);
    writeOAuthFile(home, {
      ...EMPTY_OAUTH,
      clients: [
        {
          clientId: "client",
          clientName: "client",
          redirectUris: ["https://example.test/cb"],
          registeredAt: 1,
          generation: 1,
        },
      ],
      grants: [
        {
          clientId: "client",
          actorSeed,
          actor,
          grantedAt: 1,
          standing: true,
          user: "ada",
          container: "ada:journal",
          inbox: "ada:journal:inbox",
        },
      ],
    });
    output.length = 0;
    expect(
      await run(["grant", "client", "--verb=register", "--prefix=zed:", "--home", home], io),
    ).toBe(0);
    const text = output.join("\n");
    expect(text).toContain('"zed:"');
    expect(text).toContain('"ada:journal:"');
    expect(text).toMatch(/does not widen/i);
    expect(text).not.toContain('may register schemas whose name starts with "zed:"');
    const seed = readFileSync(join(home, "operator.seed"), "utf8").trim();
    const gw = await Gateway.boot(
      new SqliteBackend(join(home, "store.sqlite")),
      assembleGenesis({ operatorSeed: seed }),
    );
    try {
      expect(registerPrefixesOf(gw.reactor, actor, authorForSeed(seed))).toContain("zed:");
    } finally {
      await gw.close();
    }
  } finally {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
