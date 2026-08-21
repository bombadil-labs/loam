// T205 — the grant ledger: every author with standing, on one screen.
//
// The morning this exists for: a seed file was on a laptop that is gone, and the operator needs one
// answer — who can write here, under which grant, since when, and which of those grants are already
// struck. Before this ticket `loam grant list` knew only connectors; a pen's write standing and a
// user's admin standing were readable only by reading raw deltas.
//
// ASSERTED AT BOTH LEVELS. DELTA: what the ground actually holds — a grant delta at `loam:store`
// under `loam.grants`, a real operator-authored negation of a real grant id, and (criterion d) a
// delta COUNT taken off the store file before and after. OBJECT: what the operator reads — the rows
// `loam grant list` prints, plus `grantsHeldBy`, the derivation the registration door reads, so a
// row cannot claim a standing the door would refuse.
//
// TWO-SIDED EVERYWHERE, because a ledger's failure mode is omission and a one-sided rail cannot see
// it: the struck row is asserted present AND a live bystander is asserted unmarked; the ungranted
// seed file is asserted listed AND a granted one is asserted not described that way.
//
// Every name used as a row selector avoids the hex alphabet, on purpose: an author is
// `ed25519:<hex>`, so a name spelled only in [0-9a-f] could match another row's key.
//
// Deliberately NOT asserted: the exact column widths (cosmetic — pinning them would freeze a layout
// rather than a promise), and the seed-file-UNREADABLE row (no portable fixture makes a file
// unreadable on every CI platform; `test/cli/pen.test.ts` names the same gap).
//
// Every store here is a fresh temp home. Nothing in this file touches a real ~/.loam.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { penSeedPath, readSeed, storePath, userSeedPath } from "../../src/cli/config.js";
import { CTX_GRANTS, grantClaims, grantsHeldBy } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { EMPTY_OAUTH, writeOAuthFile, type OAuthFile } from "../../src/server/oauth-file.js";
import type { ScryptParams } from "../../src/server/credentials.js";

vi.setConfig({ testTimeout: 60_000 });

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });
const printed = (): string => [...out, ...err].join("\n");
const clear = (): void => {
  out.length = 0;
  err.length = 0;
};

// A cheap, fixed cost so this file does not pay the interactive scrypt floor per `user create`.
const CHEAP_SCRYPT: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
const password = (value: string) => ({
  readSecret: () => Promise.resolve(value),
  scrypt: CHEAP_SCRYPT,
});

const CONNECTOR_SEED = "70".repeat(32);
const CONNECTOR = authorForSeed(CONNECTOR_SEED);
const STRANGER_SEED = "5c".repeat(32);
const STRANGER = authorForSeed(STRANGER_SEED);

// How the ledger abbreviates an author: the algorithm tag in full, then twelve characters of the
// key. Transcribed here rather than imported, so the rail pins the promise instead of agreeing with
// whatever the implementation happens to do.
const shown = (author: string): string => `${author.slice(0, 20)}…`;

// The lines of a listing that name `needle` — one row, isolated, so a two-sided assertion cannot be
// satisfied by the OTHER row's text.
const rowFor = (listing: string, needle: string): string =>
  listing
    .split("\n")
    .filter((l) => l.includes(needle))
    .join("\n");

const authorOfUser = (name: string): string =>
  authorForSeed(readFileSync(userSeedPath(home, name), "utf8").trim());
const authorOfPen = (name: string): string =>
  authorForSeed(readFileSync(penSeedPath(home, name), "utf8").trim());

// A connector that has completed a token exchange: the state `loam grant` operates on.
const seedConnector = (): void => {
  const file: OAuthFile = {
    ...EMPTY_OAUTH,
    clients: [
      {
        clientId: "cli-groove",
        clientName: "Groove",
        redirectUris: ["https://x/cb"],
        registeredAt: 1,
        generation: 1,
      },
    ],
    grants: [
      {
        clientId: "cli-groove",
        actorSeed: CONNECTOR_SEED,
        actor: CONNECTOR,
        grantedAt: 1,
        standing: true,
      },
    ],
  };
  writeOAuthFile(home, file);
};

// Read the store file directly — never through a Gateway, which boots its genesis and would count
// its own writes as the command's.
async function deltaCount(): Promise<number> {
  const backend = new SqliteBackend(storePath(home));
  try {
    return (await backend.deltasSince(new Set())).length;
  } finally {
    await backend.close();
  }
}

// A short-lived read-only Gateway over the same store the CLI just wrote — never held open across a
// `run()` call (the store is single-writer).
async function ground<T>(read: (gw: Gateway, operator: string) => T): Promise<T> {
  const seed = readSeed(home);
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: seed }),
  );
  try {
    return read(gw, authorForSeed(seed));
  } finally {
    await gw.close();
  }
}

// The DELTA-level half: every grant-shaped delta at the store entity naming `subject`, split by
// whether an operator-authored negation strikes it. "Struck" and "never planted" are opposite facts
// that a surviving-set alone cannot tell apart.
const grantIds = (subject: string): Promise<{ surviving: string[]; struck: string[] }> =>
  ground((gw, operator) => {
    const surviving: string[] = [];
    const struck: string[] = [];
    for (const delta of gw.reactor.snapshot()) {
      const filed = delta.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.id === STORE_ENTITY &&
          p.target.entity.context === CTX_GRANTS,
      );
      const names = delta.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === subject,
      );
      if (!filed || !names) continue;
      const negated = gw.reactor
        .negationsOf(delta.id)
        .some((id) => gw.reactor.get(id)?.claims.author === operator);
      (negated ? struck : surviving).push(delta.id);
    }
    return { surviving, struck };
  });

// The OBJECT-level half at the derivation the door reads: what standing this author actually holds.
const heldVerbs = (author: string): Promise<string[]> =>
  ground((gw, operator) =>
    grantsHeldBy(gw.reactor, author, operator)
      .map((g) => g.verb as string)
      .sort(),
  );

// An operator-signed grant planted straight into the ground, for a key this home holds no file for.
async function plantOperatorGrant(subject: string, verb: "write" | "admin"): Promise<void> {
  const seed = readSeed(home);
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: seed }),
  );
  try {
    await gw.append([
      signClaims(grantClaims(STORE_ENTITY, subject, verb, authorForSeed(seed), Date.now()), seed),
    ]);
  } finally {
    await gw.close();
  }
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "loam-ledger-"));
  clear();
  expect(await run(["init", "--home", home], io())).toBe(0);
  clear();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("T205 (a) — one screen holds the user, the pen, and the connector", () => {
  it("lists all three with kind, derived author, and verb", async () => {
    // An operator-role user carries `admin`; a plain actor holds no grant and no seed file at all,
    // so it is correctly absent from a ledger of standing.
    expect(
      await run(["user", "create", "ivy", "--operator", "--home", home], io(), password("pw")),
      printed(),
    ).toBe(0);
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    seedConnector();
    expect(
      await run(
        ["grant", "cli-groove", "--verb=register", "--prefix=groove:", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    clear();

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();

    const ivy = rowFor(listing, "ivy");
    expect(ivy, listing).not.toBe("");
    expect(ivy).toContain("user");
    expect(ivy).toContain("admin");
    expect(ivy).toContain(shown(authorOfUser("ivy")));
    expect(ivy).not.toContain(authorOfUser("ivy")); // abbreviated, never the whole key

    const quill = rowFor(listing, "quill");
    expect(quill, listing).not.toBe("");
    expect(quill).toContain("pen");
    expect(quill).toContain("write");
    expect(quill).toContain(shown(authorOfPen("quill")));

    const groove = rowFor(listing, "cli-groove");
    expect(groove, listing).not.toBe("");
    expect(groove).toContain("connector");
    expect(groove).toContain("register");
    expect(groove).toContain("groove:");
    expect(groove).toContain(shown(CONNECTOR));

    // Three rows, three authors: no row borrows another's key.
    expect(ivy).not.toContain(shown(authorOfPen("quill")));
    expect(quill).not.toContain(shown(CONNECTOR));

    // And the screen agrees with the ground, at the derivation the door reads.
    expect(await heldVerbs(authorOfUser("ivy"))).toEqual(["admin"]);
    expect(await heldVerbs(authorOfPen("quill"))).toEqual(["write"]);
    expect(await heldVerbs(CONNECTOR)).toEqual(["register"]);
  });

  it("a grant naming a key no seed file and no connector record claims is listed unattributed", async () => {
    // The ledger's whole point: nothing with standing hides. A grant minted for an arbitrary key
    // matches no `user.<name>.seed`, no `pen.<name>.seed`, and no connector record — and it is still
    // standing, so it is still a row.
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    await plantOperatorGrant(STRANGER, "write");
    expect((await grantIds(STRANGER)).surviving).toHaveLength(1);
    clear();

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();

    const stranger = rowFor(listing, shown(STRANGER));
    expect(stranger, listing).not.toBe("");
    expect(stranger).toContain("unattributed");
    expect(stranger).toContain("write");
    // Two-sided: the attributed pen is NOT swept into the same bucket.
    expect(rowFor(listing, "quill")).not.toContain("unattributed");
  });
});

describe("T205 (b) — a struck grant is shown struck, never omitted", () => {
  it("marks the struck row and leaves a live bystander unmarked", async () => {
    for (const name of ["ivy", "kit"]) {
      expect(
        await run(["user", "create", name, "--operator", "--home", home], io(), password("pw")),
        printed(),
      ).toBe(0);
    }
    const ivy = authorOfUser("ivy");
    const kit = authorOfUser("kit");
    expect((await grantIds(ivy)).surviving).toHaveLength(1);
    expect((await grantIds(kit)).surviving).toHaveLength(1);

    expect(
      await run(["user", "remove-role", "ivy", "--role=operator", "--home", home], io()),
      printed(),
    ).toBe(0);
    clear();

    // DELTA: a real negation of a real grant id on one side, and nothing on the other.
    expect((await grantIds(ivy)).struck).toHaveLength(1);
    expect((await grantIds(ivy)).surviving).toHaveLength(0);
    expect((await grantIds(kit)).struck).toHaveLength(0);
    expect((await grantIds(kit)).surviving).toHaveLength(1);
    // OBJECT, at the door's derivation.
    expect(await heldVerbs(ivy)).toEqual([]);
    expect(await heldVerbs(kit)).toEqual(["admin"]);

    // OBJECT, on the screen — and the struck grant is SHOWN, which is the criterion. A ledger that
    // filtered it away would be exactly the hole the key-leak morning is spent finding.
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();

    const ivyRow = rowFor(listing, "ivy");
    expect(ivyRow, listing).not.toBe("");
    expect(ivyRow).toContain("struck");
    expect(ivyRow).toContain("admin"); // the verb it held stays legible
    expect(ivyRow).toContain(shown(ivy));

    const kitRow = rowFor(listing, "kit");
    expect(kitRow, listing).not.toBe("");
    expect(kitRow).not.toContain("struck");
    expect(kitRow).toContain(shown(kit));
  });
});

describe("T205 (c) — a provisioned seed file with no grant is listed as holding nothing", () => {
  it("names the ungranted user and pen, and does not describe a granted pen that way", async () => {
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    // Seed files planted by hand: custody with no authorization behind it. This is the §45.4 gap —
    // a key that exists on the disk and holds nothing in the ground.
    writeFileSync(userSeedPath(home, "cyd"), `${"a1".repeat(32)}\n`, { mode: 0o600 });
    writeFileSync(penSeedPath(home, "nib"), `${"b2".repeat(32)}\n`, { mode: 0o600 });
    clear();

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();

    for (const [name, kind] of [
      ["cyd", "user"],
      ["nib", "pen"],
    ] as const) {
      const row = rowFor(listing, name);
      expect(row, listing).not.toBe("");
      expect(row).toContain(kind);
      expect(row).toContain("no grant in the ground");
    }
    expect(await heldVerbs(authorOfUser("cyd"))).toEqual([]);
    expect(await heldVerbs(authorOfPen("nib"))).toEqual([]);

    // Two-sided: the pen that DOES hold a grant is not described as ungranted.
    const quill = rowFor(listing, "quill");
    expect(quill, listing).not.toBe("");
    expect(quill).toContain("write");
    expect(quill).not.toContain("no grant in the ground");
    expect(await heldVerbs(authorOfPen("quill"))).toEqual(["write"]);
  });
});

describe("T205 (d) — the ledger is a read", () => {
  it("appends no deltas", async () => {
    expect(
      await run(["user", "create", "ivy", "--operator", "--home", home], io(), password("pw")),
      printed(),
    ).toBe(0);
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    seedConnector();
    clear();

    const before = await deltaCount();
    expect(before).toBeGreaterThan(0);

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    // Not vacuous: the count is unchanged BECAUSE the ledger read, not because it refused. A
    // command that exited non-zero, or printed nothing, would satisfy an equal count on its own.
    const listing = printed();
    expect(listing).toContain("ivy");
    expect(listing).toContain("quill");
    expect(listing).toContain("cli-groove");

    expect(await deltaCount()).toBe(before);

    // Twice, because an append that is idempotent by content address hides behind a single run.
    clear();
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    expect(await deltaCount()).toBe(before);
  });
});
