import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Claims } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { penSeedPath, readSeed, storePath, userSeedPath } from "../../src/cli/config.js";
import { CTX_GRANTS, grantClaims, grantsHeldBy } from "../../src/gateway/accounts.js";
import { type Verb } from "../../src/gateway/grants-law.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import {
  EMPTY_OAUTH,
  grantFor,
  readOAuthFile,
  revocationsFor,
  writeOAuthFile,
  type OAuthFile,
} from "../../src/server/oauth-file.js";
import type { ScryptParams } from "../../src/server/credentials.js";
import { stamped } from "../../src/gateway/stamp.js";

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

const CHEAP_SCRYPT: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
const password = (value: string) => ({
  readSecret: () => Promise.resolve(value),
  scrypt: CHEAP_SCRYPT,
});

const CONNECTOR_SEED = "70".repeat(32);
const CONNECTOR = authorForSeed(CONNECTOR_SEED);
const STRANGER_SEED = "5c".repeat(32);
const STRANGER = authorForSeed(STRANGER_SEED);
const IMPOSTOR_SEED = "3a".repeat(32);
const IMPOSTOR = authorForSeed(IMPOSTOR_SEED);

const shown = (author: string): string => `${author.slice(0, 20)}…`;

const rowFor = (listing: string, needle: string): string =>
  listing
    .split("\n")
    .filter((l) => l.includes(needle))
    .join("\n");

const authorOfUser = (name: string): string =>
  authorForSeed(readFileSync(userSeedPath(home, name), "utf8").trim());
const authorOfPen = (name: string): string => authorForSeed(penSeedOf(name));
const penSeedOf = (name: string): string => readFileSync(penSeedPath(home, name), "utf8").trim();

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

const seedTwoConnectors = (): void => {
  const client = (clientId: string, clientName: string, generation: number) => ({
    clientId,
    clientName,
    redirectUris: ["https://x/cb"],
    registeredAt: 1,
    generation,
  });
  const file: OAuthFile = {
    ...EMPTY_OAUTH,
    clients: [client("cli-groove", "Groove", 2), client("cli-mute", "Mute", 1)],
    grants: [
      {
        clientId: "cli-groove",
        actorSeed: CONNECTOR_SEED,
        actor: CONNECTOR,
        grantedAt: 1,
        standing: true,
      },
    ],
    tokens: [{ digest: "aa".repeat(32), clientId: "cli-groove", issuedAt: 1, generation: 2 }],
  };
  writeOAuthFile(home, file);
};

async function deltaCount(): Promise<number> {
  const backend = new SqliteBackend(storePath(home));
  try {
    return (await backend.deltasSince(new Set())).length;
  } finally {
    await backend.close();
  }
}

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

const heldVerbs = (author: string): Promise<string[]> =>
  ground((gw, operator) =>
    grantsHeldBy(gw.reactor, gw.validityNow(), author, operator)
      .map((g) => g.verb as string)
      .sort(),
  );

async function appendSignedBy(seed: string, claims: readonly Claims[]): Promise<void> {
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
  try {
    await gw.append(claims.map((c) => signClaims(c, seed)));
  } finally {
    await gw.close();
  }
}

const plantOperatorGrant = (
  subject: string,
  verb: "write" | "admin",
  at = Date.now(),
): Promise<void> => {
  const seed = readSeed(home);
  return appendSignedBy(seed, [grantClaims(STORE_ENTITY, subject, verb, authorForSeed(seed), at)]);
};

const plantGrantSignedBy = (
  seed: string,
  subject: string,
  verb: Verb,
  at = Date.now(),
  prefix?: string,
): Promise<void> =>
  appendSignedBy(seed, [grantClaims(STORE_ENTITY, subject, verb, authorForSeed(seed), at, prefix)]);

const plantStrike = (seed: string, targetId: string, at: number): Promise<void> =>
  appendSignedBy(seed, [makeNegationClaims(authorForSeed(seed), at, targetId)]);

const strikesOn = (targetId: string): Promise<{ author: string; timestamp: number }[]> =>
  ground((gw) =>
    gw.reactor.negationsOf(targetId).map((id) => {
      const d = gw.reactor.get(id);
      return { author: d?.claims.author ?? "(gone)", timestamp: d?.claims.timestamp ?? -1 };
    }),
  );

const soleGrantId = async (subject: string): Promise<string> => {
  const { surviving, struck } = await grantIds(subject);
  const all = [...surviving, ...struck];
  expect(all, `expected exactly one grant naming ${subject}`).toHaveLength(1);
  return all[0]!;
};

const bindingSubjects = (): Promise<string[]> =>
  ground((gw, operator) => {
    const subjects = new Set<string>();
    for (const delta of gw.reactor.snapshot()) {
      for (const p of delta.claims.pointers) {
        if (p.role === "subject" && p.target.kind === "primitive") {
          if (typeof p.target.value === "string") subjects.add(p.target.value);
        }
      }
    }
    return [...subjects]
      .filter((s) => grantsHeldBy(gw.reactor, gw.validityNow(), s, operator).length > 0)
      .sort();
  });

async function plantNonGrantAtStore(subject: string): Promise<void> {
  const seed = readSeed(home);
  const operator = authorForSeed(seed);
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: seed }),
  );
  try {
    await gw.append([
      signClaims(
        {
          ...stamped(Date.now()),
          author: operator,
          pointers: [
            {
              role: "note",
              target: { kind: "entity", entity: { id: STORE_ENTITY, context: "loam.notes" } },
            },
            { role: "subject", target: { kind: "primitive", value: subject } },
            { role: "verb", target: { kind: "primitive", value: "admin" } },
          ],
        },
        seed,
      ),
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
    expect(ivy).not.toContain(authorOfUser("ivy"));

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

    expect(ivy).not.toContain(shown(authorOfPen("quill")));
    expect(quill).not.toContain(shown(CONNECTOR));

    expect(await heldVerbs(authorOfUser("ivy"))).toEqual(["admin"]);
    expect(await heldVerbs(authorOfPen("quill"))).toEqual(["write"]);
    expect(await heldVerbs(CONNECTOR)).toEqual(["register"]);
  });

  it("a grant naming a key no seed file and no connector record claims is listed unattributed", async () => {
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
    const quill = rowFor(listing, "quill");
    expect(quill, listing).not.toBe("");
    expect(quill).not.toContain("unattributed");
    expect(listing).toContain("the grant ledger — 2 rows, 2 live");
  });
});

describe("T205 (b) — a negated grant is shown negated, never omitted", () => {
  it("marks the negated row and leaves a live bystander unmarked", async () => {
    for (const name of ["ivy", "kit"]) {
      expect(
        await run(["user", "create", name, "--operator", "--home", home], io(), password("pw")),
        printed(),
      ).toBe(0);
    }
    const ivy = authorOfUser("ivy");
    const kit = authorOfUser("kit");
    expect((await grantIds("user:ivy")).surviving).toHaveLength(1);
    expect((await grantIds("user:kit")).surviving).toHaveLength(1);

    expect(
      await run(["user", "remove-role", "ivy", "--role=operator", "--home", home], io()),
      printed(),
    ).toBe(0);
    clear();

    expect((await grantIds("user:ivy")).struck).toHaveLength(1);
    expect((await grantIds("user:ivy")).surviving).toHaveLength(0);
    expect((await grantIds("user:kit")).struck).toHaveLength(0);
    expect((await grantIds("user:kit")).surviving).toHaveLength(1);
    expect(await heldVerbs(ivy)).toEqual([]);
    expect(await heldVerbs(kit)).toEqual(["admin"]);

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();

    const ivyRow = rowFor(listing, "ivy");
    expect(ivyRow, listing).not.toBe("");
    expect(ivyRow).toMatch(/negated \d{4}-\d{2}-\d{2}T/);
    expect(ivyRow).toContain("admin");
    expect(ivyRow).toContain(shown(ivy));

    const kitRow = rowFor(listing, "kit");
    expect(kitRow, listing).not.toBe("");
    expect(kitRow).not.toMatch(/negated/);
    expect(kitRow).toContain("admin");
    expect(kitRow).toContain(shown(kit));
    expect(kitRow.trimEnd().endsWith(" live"), kitRow).toBe(true);
  });
});

describe("T205 (b2) — only a negation with standing is reported as one", () => {
  it("an inert negation leaves a live grant live, and never says negated", async () => {
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    expect(await run(["pen", "create", "nib", "--home", home], io()), printed()).toBe(0);
    const nib = authorOfPen("nib");
    const grant = await soleGrantId(nib);
    await plantStrike(penSeedOf("quill"), grant, 1_700_000_000_000);
    clear();

    expect(await strikesOn(grant)).toEqual([
      { author: authorOfPen("quill"), timestamp: 1_700_000_000_000 },
    ]);
    expect((await grantIds(nib)).surviving, "the grant still stands").toHaveLength(1);
    expect(await heldVerbs(nib)).toEqual(["write"]);

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    const row = rowFor(listing, "nib");
    expect(row, listing).not.toBe("");
    expect(row).not.toMatch(/negated/);
    expect(row).toContain("live");
    expect(row).toContain("binds nothing");
  });

  it("reports the LAWFUL negation's time, not an earlier inert one", async () => {
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    expect(await run(["pen", "create", "nib", "--home", home], io()), printed()).toBe(0);
    const nib = authorOfPen("nib");
    const grant = await soleGrantId(nib);
    const t1 = 1_700_000_000_000;
    const t2 = 1_700_000_600_000;
    await plantStrike(penSeedOf("quill"), grant, t1);
    await plantStrike(readSeed(home), grant, t2);
    clear();

    expect(await heldVerbs(nib), "the operator's negation binds").toEqual([]);
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const row = rowFor(printed(), "nib");
    expect(row, printed()).not.toBe("");
    expect(row).toContain(`negated ${new Date(t2).toISOString()}`);
    expect(row, "the inert negation's time must not be the caption").not.toContain(
      new Date(t1).toISOString(),
    );
    expect(rowFor(printed(), "quill")).not.toMatch(/negated/);
  });

  it("reports the FIRST binding negation when two of them bind", async () => {
    expect(await run(["pen", "create", "nib", "--home", home], io()), printed()).toBe(0);
    const nib = authorOfPen("nib");
    const grant = await soleGrantId(nib);
    const first = 1_700_000_000_000;
    const second = 1_700_000_900_000;
    await plantStrike(readSeed(home), grant, first);
    await plantStrike(readSeed(home), grant, second);
    clear();

    const both = await strikesOn(grant);
    expect(both).toHaveLength(2);
    expect(both.every((s) => s.author === authorForSeed(readSeed(home)))).toBe(true);
    expect(await heldVerbs(nib)).toEqual([]);

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const row = rowFor(printed(), "nib");
    expect(row, printed()).not.toBe("");
    expect(row).toContain(`negated ${new Date(first).toISOString()}`);
    expect(row, "the later negation did not move when standing ended").not.toContain(
      new Date(second).toISOString(),
    );
  });

  it("a grant that fails on its chain is not reported as revoked", async () => {
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    const quillSeed = penSeedOf("quill");
    await plantGrantSignedBy(quillSeed, STRANGER, "write", 1_700_000_000_000);
    await plantStrike(quillSeed, await soleGrantId(STRANGER), 1_700_000_300_000);
    clear();

    expect(await heldVerbs(STRANGER), "it never bound").toEqual([]);
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const row = rowFor(printed(), shown(STRANGER));
    expect(row, printed()).not.toBe("");
    expect(row).not.toMatch(/negated/);
    expect(row).toContain("does not bind");
    expect(row).toContain("no chain of admin standing reaches the operator");
  });

  it("names non-delegability, not a broken chain, when an admin mints register", async () => {
    expect(
      await run(["user", "create", "vera", "--operator", "--home", home], io(), password("pw")),
      printed(),
    ).toBe(0);
    const veraSeed = readFileSync(userSeedPath(home, "vera"), "utf8").trim();
    await plantGrantSignedBy(veraSeed, STRANGER, "register", 1_700_000_000_000, "thread:");
    await plantGrantSignedBy(veraSeed, IMPOSTOR, "write", 1_700_000_100_000);
    clear();

    expect(await heldVerbs(STRANGER)).toEqual([]);
    expect(await heldVerbs(IMPOSTOR), "an admin may delegate write").toEqual(["write"]);

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    const refused = rowFor(listing, shown(STRANGER));
    expect(refused, listing).not.toBe("");
    expect(refused).toContain("register standing is the operator's alone to mint");
    expect(refused).not.toContain("no chain");
    expect(rowFor(listing, shown(IMPOSTOR))).toContain("live");
  });
});

describe("T205 (c) — a provisioned seed file with no grant is listed as holding nothing", () => {
  it("names the ungranted user and pen, and does not describe a granted pen that way", async () => {
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
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

    const quill = rowFor(listing, "quill");
    expect(quill, listing).not.toBe("");
    expect(quill).toContain("write");
    expect(quill).not.toContain("no grant in the ground");
    expect(await heldVerbs(authorOfPen("quill"))).toEqual(["write"]);

    expect(listing).toContain("the grant ledger — 3 rows, 1 live");
    expectColumnsAligned(listing);
  });
});

const ROW_RE = /^ {2}(user|pen|connector|unattributed) +(\S+(?: \(.+?\))?) /;
const kindsIn = (listing: string): string[] =>
  listing
    .split("\n")
    .map((l) => ROW_RE.exec(l)?.[1])
    .filter((k): k is string => k !== undefined);

const namesIn = (listing: string): string[] =>
  listing
    .split("\n")
    .map((l) => ROW_RE.exec(l)?.[2])
    .filter((n): n is string => n !== undefined);

const rowLines = (listing: string): string[] => listing.split("\n").filter((l) => ROW_RE.test(l));

const expectColumnsAligned = (listing: string): void => {
  const header = listing.split("\n").find((l) => l.startsWith("  kind "));
  expect(header, listing).toBeDefined();
  const rows = rowLines(listing);
  expect(rows.length, listing).toBeGreaterThan(1);
  for (const column of ["name", "author", "verb", "granted", "standing"]) {
    const at = header!.indexOf(column);
    expect(at, `the header does not name ${column}: ${header!}`).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row[at - 1], `${column} is misaligned in: ${row}`).toBe(" ");
      expect(row[at], `${column} is misaligned in: ${row}`).not.toBe(" ");
    }
  }
};

describe("T205 — the screen is grouped, and every column tells the truth", () => {
  it("groups the rows user, pen, connector, unattributed", async () => {
    expect(
      await run(["user", "create", "vera", "--operator", "--home", home], io(), password("pw")),
      printed(),
    ).toBe(0);
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    expect(await run(["pen", "create", "nib", "--home", home], io()), printed()).toBe(0);
    seedConnector();
    expect(
      await run(
        ["grant", "cli-groove", "--verb=register", "--prefix=groove:", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    await plantOperatorGrant(STRANGER, "write");
    clear();

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();

    expect(kindsIn(listing), listing).toEqual(["user", "pen", "pen", "connector", "unattributed"]);
    expect(namesIn(listing), listing).toEqual(["vera", "nib", "quill", "cli-groove (Groove)", "—"]);

    expect(listing).toContain("the grant ledger — 5 rows, 5 live");
    const header = listing.split("\n").find((l) => l.trimStart().startsWith("kind "));
    expect(header, listing).toBeDefined();
    for (const column of ["kind", "name", "author", "verb", "granted", "standing"]) {
      expect(header).toContain(column);
    }

    const honoured = await bindingSubjects();
    expect(honoured.length, "the fixture must exercise the canary").toBeGreaterThan(3);
    for (const subject of honoured)
      expect(listing, `${subject} is honoured but absent`).toContain(shown(subject));
  });

  it("reads two grants on one key oldest first", async () => {
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    const quill = authorOfPen("quill");
    await plantOperatorGrant(quill, "admin");
    clear();

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    const rows = rowLines(listing);
    expect(rows, listing).toHaveLength(2);
    for (const row of rows) {
      expect(row).toContain("pen");
      expect(row).toContain("quill");
      expect(row).toContain(shown(quill));
    }
    expect(rows[0], listing).toContain("write");
    expect(rows[1], listing).toContain("admin");
    expect(await heldVerbs(quill)).toEqual(["admin", "write"]);
  });

  it("a delta at the store entity that is not a grant is not a row", async () => {
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    await plantNonGrantAtStore(IMPOSTOR);
    clear();

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    expect(rowFor(listing, shown(IMPOSTOR)), listing).toBe("");
    expect(rowLines(listing), listing).toHaveLength(1);
    expect(rowFor(listing, "quill")).toContain("write");
    expect(await heldVerbs(IMPOSTOR)).toEqual([]);
  });

  it("an empty home says nothing holds standing, and names the operator that needs none", async () => {
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    expect(listing).toContain("nothing holds standing here");
    expect(listing).toContain(shown(authorForSeed(readSeed(home))));
    expect(kindsIn(listing), listing).toEqual([]);
  });

  it("refuses operationally when the connector records cannot be read", async () => {
    rmSync(join(home, "oauth.json"), { force: true });
    mkdirSync(join(home, "oauth.json"));
    expect(await run(["grant", "list", "--home", home], io())).toBe(1);
    expect(printed()).toContain("unreadable");
    expect(printed()).not.toContain("nothing holds standing");
  });

  it("a seed file that is not a key is named, with its own path, and claims no author", async () => {
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    writeFileSync(userSeedPath(home, "vex"), "not-a-key\n", { mode: 0o600 });
    writeFileSync(penSeedPath(home, "wisp"), "also-not-a-key\n", { mode: 0o600 });
    clear();

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();

    const vex = rowFor(listing, "vex");
    expect(vex, listing).not.toBe("");
    expect(vex).toContain(userSeedPath(home, "vex"));
    expect(vex).toContain("does not hold a 64-hex seed");
    expect(vex).not.toContain("ed25519:");

    const wisp = rowFor(listing, "wisp");
    expect(wisp, listing).not.toBe("");
    expect(wisp).toContain(penSeedPath(home, "wisp"));
    expect(wisp).toContain("does not hold a 64-hex seed");
    expect(wisp).not.toContain("ed25519:");

    const quill = rowFor(listing, "quill");
    expect(quill).toContain(shown(authorOfPen("quill")));
    expect(quill).not.toContain("64-hex");
  });

  it("keeps a revoked connector attributed, and names the revocation", async () => {
    seedTwoConnectors();
    await plantOperatorGrant(CONNECTOR, "write");
    expect((await grantIds(CONNECTOR)).surviving).toHaveLength(1);

    expect(await run(["grant", "revoke", "cli-groove", "--home", home], io()), printed()).toBe(0);
    clear();

    expect((await grantIds(CONNECTOR)).struck).toHaveLength(1);
    expect(await heldVerbs(CONNECTOR)).toEqual([]);
    const file = readOAuthFile(home);
    expect(grantFor(file, "cli-groove"), "the seed-bearing record is gone").toBeUndefined();
    const records = revocationsFor(file, "cli-groove");
    expect(records, "the connector's public identity is kept").toHaveLength(1);
    expect(records[0]?.actor).toBe(CONNECTOR);
    expect(JSON.stringify(file.revoked ?? [])).not.toContain(CONNECTOR_SEED);

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    const groove = rowFor(listing, "cli-groove");
    expect(groove, listing).not.toBe("");
    expect(groove).toContain("connector");
    expect(groove).toContain(shown(CONNECTOR));
    expect(groove).toMatch(/negated \d{4}-\d{2}-\d{2}T/);
    expect(groove).toContain("revoked ");
    expect(listing).not.toContain("unattributed");
    expect(groove).not.toContain("no acting identity yet");

    const mute = rowFor(listing, "cli-mute");
    expect(mute, listing).not.toBe("");
    expect(mute).not.toContain("revoked ");
    expect(mute).toContain("no acting identity yet");
  });

  it("keeps every key a re-keyed connector ever used", async () => {
    const SECOND_SEED = "9d".repeat(32);
    const SECOND = authorForSeed(SECOND_SEED);
    seedTwoConnectors();
    await plantOperatorGrant(CONNECTOR, "write");
    expect(await run(["grant", "revoke", "cli-groove", "--home", home], io()), printed()).toBe(0);

    const held = readOAuthFile(home);
    writeOAuthFile(home, {
      ...held,
      grants: [
        ...held.grants,
        {
          clientId: "cli-groove",
          actorSeed: SECOND_SEED,
          actor: SECOND,
          grantedAt: 2,
          standing: true,
        },
      ],
    });
    await plantOperatorGrant(SECOND, "write");
    expect(await run(["grant", "revoke", "cli-groove", "--home", home], io()), printed()).toBe(0);
    clear();

    const file = readOAuthFile(home);
    const records = revocationsFor(file, "cli-groove");
    expect(
      records.map((r) => r.actor),
      "both keys are remembered, oldest first",
    ).toEqual([CONNECTOR, SECOND]);
    expect(JSON.stringify(file.revoked)).not.toContain(SECOND_SEED);

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    for (const key of [CONNECTOR, SECOND]) {
      const row = rowFor(listing, shown(key));
      expect(row, `${key} is missing from ${listing}`).not.toBe("");
      expect(row).toContain("connector");
      expect(row).toContain("cli-groove");
      expect(row).toMatch(/negated \d{4}-\d{2}-\d{2}T/);
    }
    expect(listing).not.toContain("unattributed");
  });

  it("breaks a same-instant revocation tie by key, so one file reads one way", () => {
    const [low, high] = [authorForSeed("11".repeat(32)), authorForSeed("22".repeat(32))].sort();
    writeOAuthFile(home, {
      ...EMPTY_OAUTH,
      clients: [
        {
          clientId: "cli-tie",
          clientName: "Tie",
          redirectUris: ["https://x/cb"],
          registeredAt: 1,
          generation: 3,
        },
      ],
      revoked: [
        { clientId: "cli-tie", actor: high!, revokedAt: 5_000 },
        { clientId: "cli-tie", actor: low!, revokedAt: 5_000 },
      ],
    });
    expect(revocationsFor(readOAuthFile(home), "cli-tie").map((r) => r.actor)).toEqual([low, high]);
  });

  it("carries each connector's own generation, token count, and acting identity", async () => {
    seedTwoConnectors();
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

    const groove = rowFor(listing, "cli-groove");
    expect(groove, listing).not.toBe("");
    expect(groove).toContain("generation 2");
    expect(groove).toContain("1 live token");
    expect(groove).not.toContain("1 live tokens");
    expect(groove).toContain(shown(CONNECTOR));
    expect(groove).not.toContain("no acting identity yet");

    const mute = rowFor(listing, "cli-mute");
    expect(mute, listing).not.toBe("");
    expect(mute).toContain("generation 1");
    expect(mute).toContain("0 live tokens");
    expect(mute).toContain("no acting identity yet");
    expect(mute).not.toContain("ed25519:");
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
    const listing = printed();
    expect(listing).toContain("ivy");
    expect(listing).toContain("quill");
    expect(listing).toContain("cli-groove");

    expect(await deltaCount()).toBe(before);

    clear();
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    expect(await deltaCount()).toBe(before);
  });
});
