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
// Deliberately NOT asserted, and why. Column WIDTHS are free — `expectColumnsAligned` pins where a
// cell starts, which is the promise; the widths belong to the data. The seed-file-UNREADABLE row has
// no portable fixture (no file is unreadable on every CI platform; `test/cli/pen.test.ts` names the
// same gap). Three more are unreachable rather than unwritten, and the rail that would close each is
// named beside it:
//
//   - the UNLISTABLE HOME refusal in `cmdGrantList`. `cmdGrant` runs `homeDefect` first and demands
//     R/W/X, so a home that passes that check and then fails `readdirSync` is a race, not a state a
//     fixture can stage. Closing it needs a directory whose permission bits bind — root and win32
//     both defeat that, which is the shape `test/cli/pen.test.ts` had to solve for its own.
//   - a grant delta carrying a SUBJECT BUT NO VERB, or a non-string primitive where a subject
//     belongs. `constitutionalDefect` refuses both for everyone, the operator included, so the
//     ground cannot hold one and `gateway.append` will not plant one. The rail that would close it
//     writes such a delta past the door, which would assert behaviour for a state the door prevents.
//   - the ABBREVIATION BOUND. `shortAuthor` returns the whole string for a key of twelve characters
//     or fewer; every real author is `ed25519:` plus sixty-four, so no fixture distinguishes that
//     bound from one character either side of it.
//   - the ID TIE-BREAK inside `honoredStrikeOn`. Two strikes with the SAME timestamp are separated
//     by delta id so one store always reads one way, and the ledger prints only the timestamp — so
//     when the tie fires the screen is identical whichever id wins. When timestamps DIFFER the
//     tie-break is dead code the mutation gate can still reach, and whether a wrong one is visible
//     turns on whether id order happens to contradict timestamp order. A delta id is a content
//     address: choosing a pair that contradicts means hard-coding magic timestamps whose hashes
//     happen to sort backwards, which is fixture-fitting rather than a rail. Left open, deliberately.
//
// THE OPERATOR'S OWN KEY IS NOT A KIND. `operator.seed` is outside the `user|pen` file convention
// this file's identities come from, so a grant naming the operator's key renders `unattributed`
// rather than as the operator. It is a strange thing to mint — the operator needs no grant and the
// summary line says so — but it is mintable, and the row would be honest about the KEY while wrong
// about who holds it. Closing it means widening the kind enum, which is a decision this ticket did
// not take.
//
// THE NINETEEN REDS ARE NOT EQUAL, and the difference is worth knowing before trusting one:
//
//   - FIVE were written before the code and failed first. The ticket's own criteria (a)-(d).
//   - SEVEN were each proven red against a targeted revert of the exact behaviour they pin — the
//     strike-standing rails against a raw `negationsOf` read, the non-delegability rail against a
//     single collapsed reason, the two connector rails against a revoke that dropped its record and
//     against one keyed by client rather than by key. A rail proven this way discriminates the
//     behaviour, not merely the feature's existence.
//   - SIX fail only against the connector-only listing that preceded the ledger. They close mutation
//     survivors, and "the whole feature is absent" is a weaker proof than either kind above.
//   - ONE — the unreadable-records refusal — passes without this ticket entirely, and says so at
//     its own site.
//
// Every store here is a fresh temp home. Nothing in this file touches a real ~/.loam.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Claims } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { penSeedPath, readSeed, storePath, userSeedPath } from "../../src/cli/config.js";
import { CTX_GRANTS, grantClaims, grantsHeldBy, type Verb } from "../../src/gateway/accounts.js";
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
const IMPOSTOR_SEED = "3a".repeat(32);
const IMPOSTOR = authorForSeed(IMPOSTOR_SEED);

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
const authorOfPen = (name: string): string => authorForSeed(penSeedOf(name));
const penSeedOf = (name: string): string => readFileSync(penSeedPath(home, name), "utf8").trim();

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

// Two connectors that differ in every column the connector half of a row carries: one has an acting
// identity and a live token, the other has neither. Each fact is asserted on BOTH rows, so a
// listing that read the wrong client's records would swap them and be caught.
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

// Append deltas signed by whatever key the caller names — the primitive the standing rails need,
// because an INERT strike is defined by WHO signed it, not by its shape.
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

// An operator-signed grant planted straight into the ground, for a key this home holds no file for.
const plantOperatorGrant = (
  subject: string,
  verb: "write" | "admin",
  at = Date.now(),
): Promise<void> => {
  const seed = readSeed(home);
  return appendSignedBy(seed, [grantClaims(STORE_ENTITY, subject, verb, authorForSeed(seed), at)]);
};

// A grant signed by somebody OTHER than the operator. `authorize` admits it — its author holds write
// standing — and the constitution still refuses to let it bind unless its author holds admin. That
// gap is the whole subject of the "does not bind" rails.
const plantGrantSignedBy = (
  seed: string,
  subject: string,
  verb: Verb,
  at = Date.now(),
  prefix?: string,
): Promise<void> =>
  appendSignedBy(seed, [grantClaims(STORE_ENTITY, subject, verb, authorForSeed(seed), at, prefix)]);

// A bare negation of `targetId`, signed by `seed`. Whether it BINDS is the constitution's decision:
// only the operator and an effective store admin may retire law, so a write-grantee's strike lands
// in the ground and retires nothing.
const plantStrike = (seed: string, targetId: string, at: number): Promise<void> =>
  appendSignedBy(seed, [makeNegationClaims(authorForSeed(seed), at, targetId)]);

// Who struck `targetId`, and when — read straight off the ground, so a rail can say what the store
// HOLDS before asking what the ledger SAYS about it.
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

// Every author the DOOR honours, derived from the ground WITHOUT the ledger's own parse of a grant
// delta. The drift canary below compares the two: `groundGrants` reads pointers by hand, and the day
// that hand-rolled read diverges from `grantsHeldBy`, a binding author silently leaves the screen.
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
    return [...subjects].filter((s) => grantsHeldBy(gw.reactor, s, operator).length > 0).sort();
  });

// A delta the operator signs AT the store entity that is not a grant: it is filed under a different
// context and carries subject and verb roles anyway. Nothing in the store's law forbids it, and it
// grants nothing.
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
          timestamp: Date.now(),
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
    // Two-sided: the attributed pen is NOT swept into the same bucket. The row is asserted PRESENT
    // first — `rowFor` returns "" when the join drops it, and "" contains nothing at all, so the
    // negative below would pass most loudly in exactly the case it is meant to catch.
    const quill = rowFor(listing, "quill");
    expect(quill, listing).not.toBe("");
    expect(quill).not.toContain("unattributed");
    // Both rows counted, both binding — and the count reads for a two-row store.
    expect(listing).toContain("the grant ledger — 2 rows, 2 live");
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

    // The marker is the word AND a time. `toContain("struck")` alone would be satisfied by a row
    // reading "nothing struck it" — the negative sentence carrying the positive word — so the rail
    // demands the timestamp that only a real strike can produce.
    const ivyRow = rowFor(listing, "ivy");
    expect(ivyRow, listing).not.toBe("");
    expect(ivyRow).toMatch(/struck \d{4}-\d{2}-\d{2}T/);
    expect(ivyRow).toContain("admin"); // the verb it held stays legible
    expect(ivyRow).toContain(shown(ivy));

    const kitRow = rowFor(listing, "kit");
    expect(kitRow, listing).not.toBe("");
    expect(kitRow).not.toMatch(/struck/);
    expect(kitRow).toContain("admin");
    expect(kitRow).toContain(shown(kit));
    // A grant nothing has struck reads exactly `live` — not "live" with a caveat about a strike,
    // which is a different fact and belongs to a different row.
    expect(kitRow.trimEnd().endsWith(" live"), kitRow).toBe(true);
  });
});

// A strike is a fact about STANDING, not about shape. These rails exist because reading `negationsOf`
// raw cannot tell the two apart, and every wrong answer it produces is a wrong answer about the one
// number the key-leak morning turns on: when did this key stop being able to write.
describe("T205 (b2) — only a strike with standing is reported as one", () => {
  it("an inert strike leaves a live grant live, and never says struck", async () => {
    // `quill` holds WRITE. `standsFor` admits the operator and effective store admins, so quill's
    // negation lands in the ground and retires nothing.
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    expect(await run(["pen", "create", "nib", "--home", home], io()), printed()).toBe(0);
    const nib = authorOfPen("nib");
    const grant = await soleGrantId(nib);
    await plantStrike(penSeedOf("quill"), grant, 1_700_000_000_000);
    clear();

    // DELTA: the strike really is in the ground, signed by the pen, naming nib's grant.
    expect(await strikesOn(grant)).toEqual([
      { author: authorOfPen("quill"), timestamp: 1_700_000_000_000 },
    ]);
    expect((await grantIds(nib)).surviving, "the grant still stands").toHaveLength(1);
    // OBJECT, at the door: nib still holds write, so nothing was retired.
    expect(await heldVerbs(nib)).toEqual(["write"]);

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    const row = rowFor(listing, "nib");
    expect(row, listing).not.toBe("");
    expect(row).not.toMatch(/struck/);
    expect(row).toContain("live");
    // The strike is not hidden either — it is reported as what it is.
    expect(row).toContain("binds nothing");
  });

  it("reports the LAWFUL strike's time, not an earlier inert one", async () => {
    // The whole hazard in one fixture: an inert strike at t1, the operator's lawful strike at t2.
    // A ledger taking the minimum over every negation reports t1 and UNDER-REPORTS the window in
    // which the key could still write — by exactly the distance between them.
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    expect(await run(["pen", "create", "nib", "--home", home], io()), printed()).toBe(0);
    const nib = authorOfPen("nib");
    const grant = await soleGrantId(nib);
    const t1 = 1_700_000_000_000;
    const t2 = 1_700_000_600_000; // ten minutes later
    await plantStrike(penSeedOf("quill"), grant, t1);
    await plantStrike(readSeed(home), grant, t2);
    clear();

    expect(await heldVerbs(nib), "the operator's strike binds").toEqual([]);
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const row = rowFor(printed(), "nib");
    expect(row, printed()).not.toBe("");
    expect(row).toContain(`struck ${new Date(t2).toISOString()}`);
    expect(row, "the inert strike's time must not be the caption").not.toContain(
      new Date(t1).toISOString(),
    );
    // Two-sided: the pen that struck nothing is untouched.
    expect(rowFor(printed(), "quill")).not.toMatch(/struck/);
  });

  it("reports the FIRST binding strike when two of them bind", async () => {
    // Standing ended at the first lawful strike. A second one changes nothing about when, so a
    // ledger reporting the LATEST would over-report how long the key could write — the same number
    // as the inert case above, wrong in the opposite direction. Both strikes here bind, so nothing
    // but the earliest-wins rule separates them.
    expect(await run(["pen", "create", "nib", "--home", home], io()), printed()).toBe(0);
    const nib = authorOfPen("nib");
    const grant = await soleGrantId(nib);
    const first = 1_700_000_000_000;
    const second = 1_700_000_900_000; // a quarter of an hour later
    await plantStrike(readSeed(home), grant, first);
    await plantStrike(readSeed(home), grant, second);
    clear();

    // DELTA: two strikes, both the operator's, both in the ground.
    const both = await strikesOn(grant);
    expect(both).toHaveLength(2);
    expect(both.every((s) => s.author === authorForSeed(readSeed(home)))).toBe(true);
    expect(await heldVerbs(nib)).toEqual([]);

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const row = rowFor(printed(), "nib");
    expect(row, printed()).not.toBe("");
    expect(row).toContain(`struck ${new Date(first).toISOString()}`);
    expect(row, "the later strike did not move when standing ended").not.toContain(
      new Date(second).toISOString(),
    );
  });

  it("a grant that fails on its chain is not reported as revoked", async () => {
    // `quill` holds write and NOT admin, so a grant it signs never binds. It also strikes that grant
    // inertly. Reporting "struck" here would name a revocation nobody with standing performed — and
    // it would silently become a lie in the other direction the day quill is granted admin, because
    // the grant would then bind while the ledger still called it revoked.
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    const quillSeed = penSeedOf("quill");
    await plantGrantSignedBy(quillSeed, STRANGER, "write", 1_700_000_000_000);
    await plantStrike(quillSeed, await soleGrantId(STRANGER), 1_700_000_300_000);
    clear();

    expect(await heldVerbs(STRANGER), "it never bound").toEqual([]);
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const row = rowFor(printed(), shown(STRANGER));
    expect(row, printed()).not.toBe("");
    expect(row).not.toMatch(/struck/);
    expect(row).toContain("does not bind");
    expect(row).toContain("no chain of admin standing reaches the operator");
  });

  it("names non-delegability, not a broken chain, when an admin mints register", async () => {
    // The chain here is perfect: `vera` holds admin from the operator. `register` is refused anyway,
    // because the store signs registrations with the OPERATOR'S key. An operator told "no chain
    // reaches the operator" would go and repair a chain that was never broken.
    expect(
      await run(["user", "create", "vera", "--operator", "--home", home], io(), password("pw")),
      printed(),
    ).toBe(0);
    const veraSeed = readFileSync(userSeedPath(home, "vera"), "utf8").trim();
    await plantGrantSignedBy(veraSeed, STRANGER, "register", 1_700_000_000_000, "thread:");
    // Two-sided on the SAME granter: the write grant vera mints DOES bind, so the refusal above is
    // about the verb and not about vera.
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

    // The count separates the two: three rows on the screen, ONE of them binding. A ledger that
    // counted a provisioned-but-ungranted key as live would report standing nobody granted.
    expect(listing).toContain("the grant ledger — 3 rows, 1 live");
    // This store mixes granted and ungranted rows, so its columns have the widest spread of cell
    // lengths in the file — the place where a padding fault shows first.
    expectColumnsAligned(listing);
  });
});

// The kind column, in the order the rows print. The header line and the operator line carry no kind
// and do not appear; anything else that did would show up here rather than pass unnoticed.
const ROW_RE = /^ {2}(user|pen|connector|unattributed) +(\S+(?: \(.+?\))?) /;
const kindsIn = (listing: string): string[] =>
  listing
    .split("\n")
    .map((l) => ROW_RE.exec(l)?.[1])
    .filter((k): k is string => k !== undefined);

// The name column, in the order the rows print — the intra-kind half of the same promise.
const namesIn = (listing: string): string[] =>
  listing
    .split("\n")
    .map((l) => ROW_RE.exec(l)?.[2])
    .filter((n): n is string => n !== undefined);

const rowLines = (listing: string): string[] => listing.split("\n").filter((l) => ROW_RE.test(l));

// Every column's cells begin exactly where the header says. This pins ALIGNMENT — the property that
// makes a table a table — without pinning the WIDTHS, which are the data's to decide and would only
// freeze a layout. Worth its own assertion because a misaligned column is read as the wrong column.
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
    // "one screen" is a promise about reading, so the grouping is a promise too: an operator
    // scanning the ledger never has to wonder whether a pen row might sit below a connector row.
    // The names here sort AGAINST the kind order on purpose — `nib` before `vera` alphabetically,
    // `cli-groove` before `nib` — so a listing that had lost its kind ranking and fallen back on
    // names would print a visibly different order rather than the same one by luck.
    expect(
      await run(["user", "create", "vera", "--operator", "--home", home], io(), password("pw")),
      printed(),
    ).toBe(0);
    // `quill` is provisioned FIRST and sorts SECOND. Creation order and name order disagree here on
    // purpose: a listing that had fallen back on arrival time would print these two the other way
    // round rather than agree with the promise by accident.
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

    // Grouped by kind first, then by name inside a kind — `nib` before `quill`, both before the
    // connector, and the key nothing can name last.
    expect(kindsIn(listing), listing).toEqual(["user", "pen", "pen", "connector", "unattributed"]);
    expect(namesIn(listing), listing).toEqual(["vera", "nib", "quill", "cli-groove (Groove)", "—"]);

    // The count line is part of the answer: five rows, and every one of them binding. An operator
    // reads this before the table and must not be told a struck or ungranted row is live.
    expect(listing).toContain("the grant ledger — 5 rows, 5 live");
    // Every column is named, so no fact arrives in an unlabelled column.
    const header = listing.split("\n").find((l) => l.trimStart().startsWith("kind "));
    expect(header, listing).toBeDefined();
    for (const column of ["kind", "name", "author", "verb", "granted", "standing"]) {
      expect(header).toContain(column);
    }

    // THE DRIFT CANARY. The ledger parses a grant delta by hand; the door answers through
    // `grantsHeldBy`. The two agree today and nothing makes them agree tomorrow, so this asserts the
    // property that matters: every author the DOOR honours is on the screen. A hand-rolled read that
    // starts skipping a pointer shape drops a live author here, loudly, instead of quietly.
    const honoured = await bindingSubjects();
    expect(honoured.length, "the fixture must exercise the canary").toBeGreaterThan(3);
    for (const subject of honoured)
      expect(listing, `${subject} is honoured but absent`).toContain(shown(subject));
  });

  it("reads two grants on one key oldest first", async () => {
    // A key that gained standing twice has a HISTORY, and on the morning it leaked the order of
    // that history is the question. Both rows name the same pen and the same key, so nothing but
    // the grant time can separate them.
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
    // `pen create` planted the write grant; the admin grant came after it.
    expect(rows[0], listing).toContain("write");
    expect(rows[1], listing).toContain("admin");
    expect(await heldVerbs(quill)).toEqual(["admin", "write"]);
  });

  it("a delta at the store entity that is not a grant is not a row", async () => {
    // The ledger reads deltas filed under `loam.grants` and nothing else. A delta that merely SITS
    // at the store entity and happens to carry subject and verb roles confers no standing, and a
    // ledger that listed it would report an authority nobody holds — the same lie as omitting one,
    // pointed the other way.
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    await plantNonGrantAtStore(IMPOSTOR);
    clear();

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    expect(rowFor(listing, shown(IMPOSTOR)), listing).toBe("");
    expect(rowLines(listing), listing).toHaveLength(1);
    // Two-sided: the real grant beside it is still a row, so this is not a ledger that lists
    // nothing.
    expect(rowFor(listing, "quill")).toContain("write");
    expect(await heldVerbs(IMPOSTOR)).toEqual([]);
  });

  it("an empty home says nothing holds standing, and names the operator that needs none", async () => {
    // The state a store is in the moment it is created. A ledger that printed a bare header here
    // would read as "the answer is missing" rather than "the answer is none".
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    expect(listing).toContain("nothing holds standing here");
    expect(listing).toContain(shown(authorForSeed(readSeed(home))));
    expect(kindsIn(listing), listing).toEqual([]);
  });

  it("refuses operationally when the connector records cannot be read", async () => {
    // H9: a read that could not happen must not answer NO. Exit 1 (this store could not tell) is a
    // different verdict from exit 0 with an empty ledger, and the second would report that nobody
    // holds standing on the strength of a file it never opened.
    //
    // ALONE IN THIS FILE, this rail also passes against the connector-only listing that preceded
    // the ledger: it guards a refusal the ledger INHERITED rather than one it introduced. It is
    // here because the ledger grew a second early-exit beside it — the empty-home answer above —
    // and the two must never be reachable from the same fault.
    rmSync(join(home, "oauth.json"), { force: true });
    mkdirSync(join(home, "oauth.json"));
    expect(await run(["grant", "list", "--home", home], io())).toBe(1);
    expect(printed()).toContain("unreadable");
    expect(printed()).not.toContain("nothing holds standing");
  });

  it("a seed file that is not a key is named, with its own path, and claims no author", async () => {
    // Custody that cannot be read is not custody by nobody (H9). The row still prints, it names the
    // file, and its author column stays empty rather than inventing a key.
    expect(await run(["pen", "create", "quill", "--home", home], io()), printed()).toBe(0);
    writeFileSync(userSeedPath(home, "vex"), "not-a-key\n", { mode: 0o600 });
    writeFileSync(penSeedPath(home, "wisp"), "also-not-a-key\n", { mode: 0o600 });
    clear();

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();

    // Each row names ITS OWN file — a user row must never quote a pen path, or the operator goes
    // looking in the wrong place for the key they were told to replace.
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

    // Two-sided: the pen whose file IS a key still shows one, and says nothing about hex.
    const quill = rowFor(listing, "quill");
    expect(quill).toContain(shown(authorOfPen("quill")));
    expect(quill).not.toContain("64-hex");
  });

  it("keeps a revoked connector attributed, and names the revocation", async () => {
    // Revocation destroys the KEY, not the history. Before this the grant record went entirely, so
    // the ledger reported a connector that had acted for months as holding "no acting identity yet"
    // while the struck grant it left behind sat under `unattributed` — two false answers about the
    // same connector, from one dropped record, on the exact morning both matter.
    seedTwoConnectors();
    await plantOperatorGrant(CONNECTOR, "write");
    expect((await grantIds(CONNECTOR)).surviving).toHaveLength(1);

    expect(await run(["grant", "revoke", "cli-groove", "--home", home], io()), printed()).toBe(0);
    clear();

    // DELTA: the ground grant really is struck, by the operator.
    expect((await grantIds(CONNECTOR)).struck).toHaveLength(1);
    expect(await heldVerbs(CONNECTOR)).toEqual([]);
    // And the SEED is gone from the home — revocation still destroys the key.
    const file = readOAuthFile(home);
    expect(grantFor(file, "cli-groove"), "the seed-bearing record is gone").toBeUndefined();
    const records = revocationsFor(file, "cli-groove");
    expect(records, "the connector's public identity is kept").toHaveLength(1);
    expect(records[0]?.actor).toBe(CONNECTOR);
    // The key itself is destroyed — the whole point of keeping only the public half.
    expect(JSON.stringify(file.revoked ?? [])).not.toContain(CONNECTOR_SEED);

    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    const groove = rowFor(listing, "cli-groove");
    expect(groove, listing).not.toBe("");
    // The struck grant is ATTRIBUTED — the connector's name, not `unattributed`.
    expect(groove).toContain("connector");
    expect(groove).toContain(shown(CONNECTOR));
    expect(groove).toMatch(/struck \d{4}-\d{2}-\d{2}T/);
    expect(groove).toContain("revoked ");
    expect(listing).not.toContain("unattributed");
    expect(groove).not.toContain("no acting identity yet");

    // Two-sided: the connector that was never granted is untouched by any of it.
    const mute = rowFor(listing, "cli-mute");
    expect(mute, listing).not.toBe("");
    expect(mute).not.toContain("revoked ");
    expect(mute).toContain("no acting identity yet");
  });

  it("keeps every key a re-keyed connector ever used", async () => {
    // A revoked connector can come back: a fresh token exchange mints a NEW key under the same
    // client id. Both keys held standing, at different times, and both left a struck grant behind.
    // Keeping one record per CLIENT would forget the older key and strand its grant under
    // `unattributed` — the same hole the revocation record exists to close, one re-key later.
    const SECOND_SEED = "9d".repeat(32);
    const SECOND = authorForSeed(SECOND_SEED);
    seedTwoConnectors();
    await plantOperatorGrant(CONNECTOR, "write");
    expect(await run(["grant", "revoke", "cli-groove", "--home", home], io()), printed()).toBe(0);

    // The exchange runs again and hands the connector a different identity.
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
    // BOTH struck grants are attributed to the connector, and neither is stranded.
    for (const key of [CONNECTOR, SECOND]) {
      const row = rowFor(listing, shown(key));
      expect(row, `${key} is missing from ${listing}`).not.toBe("");
      expect(row).toContain("connector");
      expect(row).toContain("cli-groove");
      expect(row).toMatch(/struck \d{4}-\d{2}-\d{2}T/);
    }
    expect(listing).not.toContain("unattributed");
  });

  it("breaks a same-instant revocation tie by key, so one file reads one way", () => {
    // Two keys revoked in the same millisecond is rare and not impossible, and "oldest first" still
    // has to mean something when it happens. This lives here rather than beside `oauth-file`'s own
    // tests because those are frozen; it is a unit assertion on the helper the ledger reads.
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
      // Inserted in the WRONG order on purpose: a sort that had stopped breaking the tie would hand
      // these back exactly as they went in, and no timestamp could tell the difference.
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
    expect(groove).not.toContain("1 live tokens"); // one token is not plural
    expect(groove).toContain(shown(CONNECTOR));
    expect(groove).not.toContain("no acting identity yet");

    // Two-sided on all three facts: the connector that has completed no token exchange holds none
    // of them, and its row says so instead of borrowing its neighbour's.
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
    // Not vacuous: the count is unchanged BECAUSE the ledger read, not because it refused. A
    // command that exited non-zero, or printed nothing, would satisfy an equal count on its own.
    const listing = printed();
    expect(listing).toContain("ivy");
    expect(listing).toContain("quill");
    expect(listing).toContain("cli-groove");

    expect(await deltaCount()).toBe(before);

    // Run twice. This adds no discriminating power over the first run — a content-addressed append
    // of the SAME delta would already have been counted once above — and it is kept only because a
    // second call is the cheapest way to notice a listing that appends something new each time.
    clear();
    expect(await run(["grant", "list", "--home", home], io()), printed()).toBe(0);
    expect(await deltaCount()).toBe(before);
  });
});
