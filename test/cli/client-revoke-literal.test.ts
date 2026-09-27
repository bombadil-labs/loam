// `loam client revoke K` strikes the grants that name K LITERALLY, never a grant that names a user
// whose root happens to be K. The user's own standing belongs to the user, and a client revoke must
// not reach it. Asked at the delta (which grants are struck) and the door (which standing survives),
// and on the ledger screen (the rows the operator reads).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { signClaims, type Delta } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { readSeed, storePath } from "../../src/cli/config.js";
import { CTX_GRANTS, grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { readClientsFile } from "../../src/server/clients-file.js";
import { rootClaims, userClaims } from "../../src/server/users.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { authorForSeed } from "@bombadil/rhizomatic";

const homes: string[] = [];
afterEach(() => {
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const lines: string[] = [];
const io = { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) };

async function ground(home: string): Promise<Gateway> {
  return Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
}

const grantsFor = (gw: Gateway, subject: string): Delta[] =>
  [...gw.reactor.snapshot()].filter(
    (d) =>
      d.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.id === STORE_ENTITY &&
          p.target.entity.context === CTX_GRANTS,
      ) &&
      d.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === subject,
      ),
  );

describe("client revoke is literal: a user whose root is the client's key keeps their grant", () => {
  it("the client's own grants are struck; the user-named grant is not; the ledger shows both", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-client-literal-"));
    homes.push(home);
    expect(await run(["init", "--home", home], io)).toBe(0);
    expect(await run(["client", "mint", "kay", "--home", home], io)).toBe(0);
    const kay = readClientsFile(home).clients.find((c) => c.name === "kay")!.actor;
    const seed = readSeed(home);
    const operator = authorForSeed(seed);

    // una is a user whose root is kay's key, holding a write grant by name.
    let gw = await ground(home);
    await gw.append([
      signClaims(userClaims("una", operator, 10), seed),
      signClaims(rootClaims("una", kay, operator, 10), seed),
    ]);
    await gw.append([
      signClaims(grantClaims(STORE_ENTITY, "user:una", "write", operator, 11), seed),
    ]);
    const literal = grantsFor(gw, kay).map((d) => d.id);
    const named = grantsFor(gw, "user:una").map((d) => d.id);
    expect(literal.length).toBeGreaterThan(0);
    expect(named).toHaveLength(1);
    await gw.close();

    expect(await run(["client", "revoke", "kay", "--home", home], io)).toBe(0);

    gw = await ground(home);
    // delta: every literal grant is struck; the user-named one is not
    for (const id of literal) expect(gw.reactor.negationsOf(id).length).toBeGreaterThan(0);
    expect(gw.reactor.negationsOf(named[0]!)).toEqual([]);
    // door: kay still writes, as una's root, through una's grant
    expect(holdsGrant(gw.reactor, gw.validityNow(), STORE_ENTITY, kay, "write", operator)).toBe(
      true,
    );
    await gw.close();

    lines.length = 0;
    expect(await run(["grant", "list", "--home", home], io)).toBe(0);
    const listing = lines.join("\n");
    const unaRow = listing.split("\n").find((l) => /\buna\b/.test(l)) ?? "";
    expect(unaRow, listing).toContain("live");
    expect(listing).toMatch(/negated \d{4}-\d{2}-\d{2}T/);
  });
});
