// T206 — the erasure surface a person can reach: `loam slate list`, `loam erase`, and the
// tombstone reader.
//
// The morning this exists for: a data-protection officer must answer three questions about a store
// they do not have a script for. What is staged for erasure and when is it due? What has already
// been forgotten, for whom, and why? And can I destroy this one record now, and prove it left?
// Before this ticket every one of those needed an embedding script.
//
// ASSERTED AT BOTH LEVELS. DELTA: what the ground actually holds — the operator-signed
// `loam.erasure.slate` record and its pinned pair, the surviving tombstone read through
// `survivingTombstones`. OBJECT: what the operator READS — the exact screen each verb prints. When
// the two disagree the disagreement is the bug, and one level alone cannot see it.
//
// TWO-SIDED EVERYWHERE, as every erasure rail in this repo is. A reader's failure mode is OMISSION,
// so no assertion here stands alone: the empty listing is asserted silent AND the same store is
// asserted loud once a slate stands; the struck receipt is asserted gone AND a named live receipt is
// asserted still present; the receipt is asserted to carry the reason AND to carry none of the
// content it forgot.
//
// THE CONTENT PROBE IS NOT VACUOUS. Every "the receipt does not hold the bytes" assertion is paired
// with a positive one proving the marker really was in the erased delta first. A rail that searched
// for a string nothing ever held would pass against any implementation, including none.
//
// THE REDS ARE NOT EQUAL, and the difference is worth knowing before trusting one. What follows
// records how each rail was PROVEN — it is not a claim about the file as it stands now. Rails have
// been added since each proof, so a revert today may redden more tests than the one that named it.
// Three kinds, weakest first:
//
//   FEATURE-ABSENCE. A rail written before its code, failing against a CLI with no such command. It
//   proves the feature is load-bearing and nothing whatever about its behaviour. The reader rails
//   started here.
//
//   TARGETED REVERT — the exact behaviour removed, the rail red. One batch was applied all at once
//   and produced exactly one failing test per revert, which is how that batch showed it measured
//   what it named rather than one red masking eleven.
//
//   AGAINST A RETIRED IMPLEMENTATION, the sharpest, because the replaced code was real and shipped.
//   The depth-3 chain and the two-strikes case each fail against the one-hop pointer walk they
//   retired, in OPPOSITE directions: one misses a revival, the other invents one. The vault rails
//   fail against the one-level canonical-name probe, and the symlink and nested-vault rails against
//   the whole-subtree skip it used to take.
//
// Every home here is a fresh `mkdtempSync` directory, erased only inside itself. Nothing in this
// file touches a real `~/.loam`, `demos/village/homes/`, or any path outside its own temp tree.
//
// Row and needle selectors avoid the hex alphabet on purpose: an author is `ed25519:<hex>`, so a
// name spelled only in [0-9a-f] could match another row's key. And a HOME NAME is not a word any of
// these screens prints: the listing carries the store PATH, so a `toMatch` over the whole blob can
// be satisfied by the temp directory instead of by the sentence it meant to pin. One draft here was.
//
// DELIBERATELY NOT ASSERTED, and why. The help text's own prose — a §-number in a summary, a spec
// reference in a note — is free; a rail pinning it would freeze documentation rather than behaviour.
// The top-level help's COLUMN WIDTH is free for the reason the grant ledger already gives: the rail
// pins where a cell starts, and the width belongs to the data. `shortId`'s abbreviation BOUND is
// unreachable — every input is a 64-character content address, so no fixture separates a cutoff of
// 13 from one of 14, exactly as `shortAuthor`'s bound is unreachable next door. One mutation of the
// receipt sort survives by construction: the tie-break's `-1` is any negative, so `-2` sorts
// identically and no test can tell the two apart.
//
// WHAT HAS NO RAIL. Four hand-edited versions of this list were wrong the same way: a fix adds a
// printed line, the list is updated for the lines a reviewer named, and the line the fix itself
// introduced goes unlisted. It is DERIVED now — `node scripts/erasure-screen-census.mjs` reads
// every sentence the erasure surface of `cli.ts` can print and matches it against every POSITIVE
// `toMatch` / `toContain` needle here. Re-derive after any change; read the misses one by one.
//
// THE TOOL HAS BEEN WRONG FOUR TIMES ITSELF, every time counting as coverage something that was
// not: it matched the rail file verbatim, so this paragraph's own prose scored the lines it
// described as railed; `.toMatch(` also matched `.not.toMatch(`, so an assertion that a sentence is
// ABSENT supplied the needle proving it covered; it scored whole STATEMENTS, so four matched words
// anywhere in the erase screen's single twenty-sentence `io.out` scored all twenty; and the first
// defect came back wearing a comment, because the needle scan read this header — where the sentence
// describing that defect quotes an assertion call — and served the prose around it back as a
// needle. Each is the shape the census exists to find: something that looks like proof, isn't, and
// is quiet about it. Expect a fifth.
//
// It still errs both ways. It censuses SENTENCES, not BRANCHES, so a sentence asserted once counts
// as covered where the loop producing it for a second store is not — which is how
// `setAsideWarning`'s pool arm survived until a reviewer found it by hand. And a three-word window
// over regex needles credits a match that a reader would call a coincidence.
//
// ITS HEADLINE NUMBER IS THE HONEST ONE, and it is not flattering: most of the individual sentences
// these screens print are named by no assertion here. The rails pin each screen's load-bearing
// claim, its limits, and its refusals; they do not pin its closing advice ("Read those doors
// directly", "strike it again — a fresh negation is free"), so that half could be deleted with this
// file green. Named as a standing residue rather than enumerated: an enumeration of that many
// sentences is the hand-maintained list this tool exists to replace.
//
// What the read-through leaves, and the fixture each would need:
//
//   - `UNKNOWN reach` on a slate block. Needs a container whose overlap with the condemned set
//     cannot be computed — an unattached wall. One `standSlate` plus one declaration.
//   - `duplicates` on a slate block, and with it the only three-argument `capped` call in the
//     source. Needs an operator-authored record linking to a member, and nine to reach the cap.
//   - `KEPT OUTSIDE this sweep` and the kept-container caveat beside the revival line, in both of
//     its forms — and, on the refusal path, the sentence saying a kept container was not asked
//     before a receipt is called settled. All three need a declared separate container covered by a
//     surviving detach record, which no fixture here builds.
//   - The `owed` sweep verdict — "NOT SETTLED: a store in reach has no receipt for it yet". It
//     needs a ground in reach that the receipt never arrived in, and no fixture built from these
//     three verbs can produce one: an erasure fans out to every pool ATTACHED at the time, and a
//     channel opened afterwards seeds its pool from a ground that ALREADY holds the receipt
//     (measured — the pool carries the tombstone the moment `federate open` returns). It is
//     reachable from the library, where an embedder can erase over a gateway that never attached a
//     standing channel's pool. Railing it needs that embedder fixture, not a CLI one.
//   - An unreadable FAN under a NAMED vault at exactly the search bound. The fans of a named vault
//     are probed now, so the guard sees it; proving that needs the same unreadable directory the
//     line below calls non-portable.
//   - The revival list's own cap ("and N more"), and the fault path's "This is DONE and re-running
//     the erase does not undo it". Needs an erasure reviving more than eight claims, and one that
//     purges and then fails.
//   - `setAsideWarning`'s stranded-strike clause and its unreadable-pen branch. The §25 rails
//     corrupt a row into claims the driver cannot parse, so `negates` is undefined and the stranded
//     count stays zero; a row that PARSES and claims a strike would reach it. (Its POOL arm is
//     railed, and was not when this list last claimed to be complete.)
//   - The post-erase `servingWarning` and its erasure-specific sentence. Needs a detached `serve`.
//   - Five branches needing a failure this repo has twice recorded as non-portable: the
//     unreadable-directory refusal (which now covers a NAMED vault too, on the same terms), the
//     byte probe's own catch, `loginDoorReadings`' assembly failure, the archive-lagging line, and
//     a store that cannot be asked whether it holds an id.
//   - The ABSOLUTE spelling of the vault named in the unnamed-vault refusal. `--archive` re-resolves
//     a relative value inside the home, so a home-prefixed path pasted back becomes `<home>/<home>/…`
//     and fires the same refusal forever. Every fixture here passes an absolute `--home` (mkdtemp),
//     where the two spellings coincide — the discriminating fixture needs a RELATIVE home, and
//     `process.chdir` is process-global under this runner, so it would reach into sibling files.
//   - TWO SAME-NAMED READINGS crossing a boundary line TOGETHER. `reopened` and `remasked` now key
//     their rows on (entity, lens name) rather than on the label, so two doors sharing a name count
//     twice. One erasure moves one reading, and no fixture can move two at once through this verb —
//     the count is pinned at one, and the two-door case is reasoned, not railed.
//   - THE FAULT PATH's revival line. `reportRevived(…, "already")` runs when an erase purges the
//     local tiers and then fails; every way to produce that is an I/O failure, and this CLI opens
//     its own backends with no seam to inject a refusing one. Its siblings on that path — the
//     unmeasured-reading caveat, the empty-pen arm, the completeness-guard cure — ARE railed,
//     because the guard reaches them without any I/O fault.
//
// The pool half of the revival reading is likewise not separable, for a reason that is a property of
// the verb rather than of the rail: an erase target must be in the PRIMARY ground for the order to
// run at all, so no fixture can put the removed strike in a pool alone. The channel rail proves the
// path end to end and says so at its own site.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  claimsToJson,
  makeNegationClaims,
  signClaims,
  type Delta,
} from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { storePath } from "../../src/cli/config.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  CTX_ERASE,
  eraseClaims,
  ERASE_ENTITY,
  ERASURE_NON_CLAIMS,
  ESM_RESIDENCY_DISCLOSURE,
  receiptLedger,
  sealCommitment,
  survivingTombstones,
  tombstoneTarget,
  UNSWEPT_AUTH_SURFACES,
} from "../../src/gateway/erase.js";
import { frozenMembershipTerm, isSlateRecord, readSlates } from "../../src/gateway/slate.js";
import { exportOffer } from "../../src/federation/offer.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import type { ScryptParams } from "../../src/server/credentials.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { termClaims } from "../../src/gateway/container.js";
import { entityGatherJson } from "../../src/gateway/gather.js";
import {
  BEFORE_DEADLINE,
  DEADLINE,
  declareContainer,
  LAPSED_DEADLINE,
  OP,
  OP_SEED,
  REQUESTED_AT,
  standSlate,
} from "../gateway/slating.js";

vi.setConfig({ testTimeout: 60_000 }); // real sqlite homes ride here

let root: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });
const printed = (): string => [...out, ...err].join("\n");
const clear = (): void => {
  out.length = 0;
  err.length = 0;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "loam-erasure-cli-"));
  clear();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// How the receipt listing abbreviates a content address: twelve characters and an ellipsis.
// Transcribed here rather than imported, so the rail pins the promise instead of agreeing with
// whatever the implementation happens to do.
const short = (id: string): string => `${id.slice(0, 12)}…`;

// The cell an absent fact prints — transcribed, not imported, like every other promise here.
const ABSENT = "\u2014";

/** A governed home under the slate fixture's own operator, with the stock `note` shape registered. */
async function noteHome(name: string): Promise<string> {
  const home = join(root, name);
  expect(await run(["init", "--home", home, "--seed", OP_SEED], io()), printed()).toBe(0);
  expect(await run(["register", "--stock", "note", "--home", home], io()), printed()).toBe(0);
  clear();
  return home;
}

/**
 * A short-lived Gateway over the same store the CLI reads — never held open across a `run()` call
 * (the store is single-writer). `vault` opens the same two tiers `loam serve --archive` opens, so a
 * fixture can put the bytes on BOTH before a rail asks whether they left both.
 */
async function ground<T>(
  home: string,
  read: (gw: Gateway) => Promise<T> | T,
  opts: { vault?: string } = {},
): Promise<T> {
  const primary = new SqliteBackend(storePath(home));
  const backend: StoreBackend =
    opts.vault === undefined
      ? primary
      : new MirrorBackend(primary, new ArchiveBackend(join(home, opts.vault)));
  const gw = await Gateway.boot(backend, assembleGenesis({ operatorSeed: OP_SEED }));
  try {
    return await read(gw);
  } finally {
    await gw.close();
  }
}

const VAULT = "vault";

// Damage a stored row behind the seam — swap in another delta's well-formed claims, so the row no
// longer recomputes to its own id. `deltasSince` then sets it ASIDE rather than returning it, which
// is the §25 state every reader here is blind to unless it says so. Same recipe as
// `test/cli/repair.test.ts`; the bytes stay on the disk, which is the half that matters here.
function corrupt(home: string, id: string, claims: unknown): void {
  const db = new Database(storePath(home));
  db.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run(JSON.stringify(claims), id);
  db.close();
}

// REGULAR FILES ONLY, and directories recursed by their own names. A `Dirent` for a symlink answers
// `isDirectory()` false, so an `else` branch hands its path to `readFileSync` and dies EISDIR on a
// link to a directory — which is the same trap the vault detector has to dodge, met here first. A
// link's target is scanned at its real path when it lives inside the tree being walked; one parked
// outside is not this probe's to follow.
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : [],
  );

/**
 * Does any file under `dir` still contain these bytes? EVERY file, not the `.sqlite` alone: sqlite
 * runs in WAL mode, so a recent write lives in the `-wal` sidecar until a checkpoint, and a probe
 * that read only the main file would call merely un-checkpointed bytes "gone" — the exact false
 * negative an erasure rail must never make.
 */
const holdsIn = (dir: string, needle: string): boolean =>
  existsSync(dir) && filesUnder(dir).some((f) => readFileSync(f).includes(needle));

/** The whole home: the primary, its sidecars, the vault, and every channel pool file. */
const homeHolds = (home: string, needle: string): boolean => holdsIn(home, needle);
const vaultHolds = (home: string, needle: string): boolean => holdsIn(join(home, VAULT), needle);
const poolsHold = (home: string, needle: string): boolean =>
  holdsIn(join(home, "channels"), needle);
const primaryHolds = (home: string, needle: string): boolean =>
  [storePath(home), `${storePath(home)}-wal`]
    .filter((f) => existsSync(f))
    .some((f) => readFileSync(f).includes(needle));

/** The store file's own delta count, read WITHOUT a Gateway — which would count its own genesis. */
async function deltaCount(home: string): Promise<number> {
  const backend = new SqliteBackend(storePath(home));
  try {
    return (await backend.deltasSince(new Set())).length;
  } finally {
    await backend.close();
  }
}

// A fixed, cheap scrypt so a `user create` here does not pay the interactive floor. The user exists
// only to make the store register `LoamUser` — a reading whose mask is not the stock shelf's.
const CHEAP_SCRYPT: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
const password = (value: string) => ({
  readSecret: () => Promise.resolve(value),
  scrypt: CHEAP_SCRYPT,
});

// A DATA SUBJECT, not the operator: someone whose record the controller later forgets. Erasure's
// whole shape is that these are two different people, and a fixture where they are one key cannot
// tell a receipt naming the subject from one naming the controller twice.
const SUBJECT_SEED = "5c".repeat(32);
const SUBJECT = authorForSeed(SUBJECT_SEED);

/** Write one note property AS THE OPERATOR and answer with the delta that carried it. */
async function note(gw: Gateway, entity: string, field: string, marker: string): Promise<Delta> {
  await gw.mutateEntity("Note", entity, { [field]: marker });
  return carrying(gw, marker);
}

/** The same, signed by somebody else — who needs write standing first (`grantWrite`). */
async function noteAs(
  gw: Gateway,
  entity: string,
  field: string,
  marker: string,
  seed: string,
): Promise<Delta> {
  await gw.mutateEntity("Note", entity, { [field]: marker }, seed);
  return carrying(gw, marker);
}

/** An operator-signed write grant, so a subject's own claim passes the append door. */
const grantWrite = (gw: Gateway, subject: string): Promise<unknown> =>
  gw.append([
    signClaims(grantClaims(STORE_ENTITY, subject, "write", OP, gw.nextTimestamp()), OP_SEED),
  ]);

/** The one delta in the ground carrying `marker` as a primitive — REFUSES on any other count. */
function carrying(gw: Gateway, marker: string): Delta {
  const hits = [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === marker),
  );
  expect(hits, `expected exactly one delta carrying ${marker}`).toHaveLength(1);
  return hits[0]!;
}

/**
 * A registration whose mask trusts the SUBJECT'S strikes and nobody else's — a reading no hardcoded
 * mask in the source has, and the only way to reach the registration half of `maskReadings`. The
 * stock shelf masks with `drop`, which is byte-identical to the floor, so a fixture built on it
 * cannot tell the registration loop from the hardcoded one.
 */
function ledgerRegistration(name: string, trusts: string = SUBJECT, lens = "Ledger"): string {
  const file = join(root, `${name}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      hyperschema: {
        name: lens,
        alg: 1,
        body: entityGatherJson({
          mask: { trust: { match: { field: "author", cmp: "eq", const: trusts } } },
        }),
      },
      schema: {
        name: lens,
        alg: 1,
        props: { title: { pick: { order: { byTimestamp: "desc" } } } },
        default: { pick: { order: { byTimestamp: "desc" } } },
      },
      roots: [],
      writable: ["title"],
    }),
  );
  return file;
}

/**
 * A registration whose body masks NEGATIONS TWO WAYS — the portable way to reach an unconsulted
 * reading. `programMaskJson` walks the term's own operand chain and refuses a body carrying two
 * different mask policies, because a listing has one candidate set and cannot suppress by two rules
 * at once. The reading exists, a person can reach it, and no I/O fault is involved.
 */
function twoWayRegistration(name: string): string {
  const file = join(root, `${name}.json`);
  // NESTED, not wrapped: `mask` takes a delta set, so a second mask goes UNDER the first, on the
  // operand chain the refusal walks. Wrapping the whole gather is a type error the door catches
  // first, which would rail the wrong refusal.
  const body = entityGatherJson({
    mask: { trust: { match: { field: "author", cmp: "eq", const: SUBJECT } } },
  }) as { in: { in: { in: unknown } } };
  body.in.in.in = { op: "mask", policy: "drop", in: "input" };
  writeFileSync(
    file,
    JSON.stringify({
      hyperschema: { name: "Twoway", alg: 1, body },
      schema: {
        name: "Twoway",
        alg: 1,
        props: { title: { pick: { order: { byTimestamp: "desc" } } } },
        default: { pick: { order: { byTimestamp: "desc" } } },
      },
      roots: [],
      writable: ["title"],
    }),
  );
  return file;
}

/** One slate's block of the listing: its container line and every indented line under it. */
function blockFor(listing: string, container: string): string {
  const lines = listing.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === container);
  expect(start, `no block for ${container} in:\n${listing}`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => !l.startsWith("  "));
  return [lines[start]!, ...(end < 0 ? rest : rest.slice(0, end))].join("\n");
}

describe("T206 (a) — `loam slate list` prints §29.1's record", () => {
  it("names who asked, when, the deadline, and the frozen condemned set", async () => {
    const home = await noteHome("staged");
    const stood = await ground(home, async (gw) => {
      const members = [
        await note(gw, "note:kit", "title", "kit-condemned-marker"),
        await note(gw, "note:kit", "body", "kit-body-marker"),
        await note(gw, "note:vera", "title", "vera-bystander-marker"),
      ];
      return standSlate(gw, {
        container: "container:slate:kit",
        members,
        closes: ["egress", "cite"],
        requestedBy: "subject:kit",
        reason: "kit asked to be forgotten",
      });
    });

    // DELTA LEVEL: the ground holds exactly one operator-signed slate record, and the pair it pins
    // is the pair the screen must show. Read before the screen, so the screen is compared against
    // the store rather than against itself.
    const held = await ground(home, (gw) => {
      const records = [...gw.reactor.snapshot()].filter(
        (d) => isSlateRecord(d.claims) && d.claims.author === OP,
      );
      expect(records).toHaveLength(1);
      const slates = readSlates(gw.reactor, OP, Date.now());
      expect(slates).toHaveLength(1);
      return { record: records[0]!.id, slate: slates[0]! };
    });
    expect(held.slate.version).toBe(stood.version);
    expect(held.slate.members.size).toBe(3);

    clear();
    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    const block = blockFor(printed(), "container:slate:kit");
    expect(block).toContain("subject:kit"); // who asked
    expect(block).toContain(new Date(REQUESTED_AT).toISOString()); // when they asked
    expect(block).toContain(new Date(DEADLINE).toISOString()); // the deadline
    expect(block).toContain(stood.version); // the frozen set's address, in full
    // "3 deltas", not "3": a bare digit is satisfied by the ISO date on the line above, and by a
    // 64-character content address on the line below it.
    expect(block).toContain("3 deltas");
    expect(block).toContain(held.record); // the record itself, to act on
    expect(block).toContain(stood.membershipAt); // the published Term, distinct from the version
    expect(block).toContain("kit asked to be forgotten");
    // BOTH HALVES of the closures line. Only the second is checked elsewhere, so a collapse to
    // "none — none" would leave every other assertion in this file green.
    expect(block).toMatch(/closes\s+cite, egress — enforcing cite, egress/);
    // The alarms are ABSENT on a healthy slate. Each of these fires from its own guard, and a guard
    // stuck open is as wrong on a legal screen as one stuck shut.
    expect(block).not.toMatch(/UNRESOLVED/);
    expect(block).not.toMatch(/DISAGREEMENT/);
    expect(block).not.toMatch(/UNKNOWN/);
    expect(block).not.toMatch(/LAPSED/);
    // A plain identifier must never read as a §11 seal, and the record NAMES which it is.
    expect(block).toMatch(/plain/);
    expect(block).not.toMatch(/sealed/);
  });

  it("calls a sealed subject a commitment, and never a name", async () => {
    // §29.1 requires the FORM on the record because a reader of a permanent compliance record must
    // never be left guessing whether an identifier is a preimage. Asserted on the side that can
    // actually mislead: a hash printed as though it were a person.
    const home = await noteHome("sealed");
    const seal = sealCommitment("salt:kit", OP);
    await ground(home, async (gw) => {
      const member = await note(gw, "note:kit", "title", "kit-condemned-marker");
      return standSlate(gw, {
        container: "container:slate:kit",
        members: [member],
        closes: ["egress"],
        requestedBy: seal,
        requestedByForm: "sealed",
      });
    });

    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    const block = blockFor(printed(), "container:slate:kit");
    expect(block).toContain(seal);
    expect(block).toMatch(/sealed/);
    expect(block).not.toMatch(/a plain identifier/);
  });

  it("says plainly that nothing is staged, and the same store speaks once a slate stands", async () => {
    const home = await noteHome("quiet");

    // SIDE ONE: nothing staged. The screen says so, and prints no row's worth of a slate.
    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    const empty = printed();
    expect(empty).toMatch(/no slates?/i);
    expect(empty).not.toMatch(/deadline/i);
    expect(empty).not.toMatch(/requested by/i);
    expect(await ground(home, (gw) => readSlates(gw.reactor, OP, Date.now()).length)).toBe(0);

    // SIDE TWO: the SAME store, one slate later.
    await ground(home, async (gw) => {
      const member = await note(gw, "note:wisp", "title", "wisp-condemned-marker");
      return standSlate(gw, {
        container: "container:slate:wisp",
        members: [member],
        closes: ["egress"],
        requestedBy: "subject:wisp",
      });
    });
    clear();
    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    const loud = printed();
    expect(loud).not.toMatch(/no slates?/i);
    expect(loud).toContain("container:slate:wisp");
    expect(loud).toMatch(/deadline/i);

    // And --store names WHICH store is answering. Pointed at a file this home has never written,
    // the same verb in the same home reports nothing staged — so the flag routes the read rather
    // than decorating it.
    clear();
    expect(
      await run(["slate", "list", "--home", home, "--store", "elsewhere.sqlite"], io()),
      printed(),
    ).toBe(0);
    expect(printed()).toMatch(/no slates?/i);
    expect(printed()).not.toContain("container:slate:wisp");
  });

  it("names the containers a cut would reach, and the claims it would bring back", async () => {
    const home = await noteHome("reach");
    // A slate over a NEGATION. Two lines on the block exist only for this shape: `affected` names a
    // container whose scope overlaps the condemned set, and `resurfacing` names what the cut would
    // revive. Both are unreachable through `loam erase`, so this is the only rail here that reaches
    // them — though NOT the only rail in the tree: `test/gateway/slate-cut.test.ts` and
    // `slate-receipt.test.ts` pin the same two SlateReport fields with `toEqual`, which is what
    // catches an over-broad list. What this rail owns is the SCREEN: that the block prints them.
    const world = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const strike = signClaims(makeNegationClaims(OP, gw.nextTimestamp(), claim.id), OP_SEED);
      await gw.append([strike]);
      // A wall whose membership covers the strike, so the overlap is real rather than declared.
      const term = frozenMembershipTerm([strike.id]);
      const published = signClaims(termClaims(term, OP, 71_000), OP_SEED);
      await gw.append([published]);
      await gw.append([
        declareContainer(
          {
            container: "container:wall:ivy",
            trust: "curated",
            posture: "shared",
            membershipAt: published.id,
            version: gw.freeze(term).id,
          },
          71_001,
        ),
      ]);
      // A SECOND WALL THAT DOES NOT OVERLAP. Its membership covers the bystander instead, so the
      // affected list has something true to exclude.
      const other = await note(gw, "note:quill", "title", "quill-bystander-marker");
      const otherTerm = frozenMembershipTerm([other.id]);
      const otherPublished = signClaims(termClaims(otherTerm, OP, 71_002), OP_SEED);
      await gw.append([otherPublished]);
      await gw.append([
        declareContainer(
          {
            container: "container:wall:quill",
            trust: "curated",
            posture: "shared",
            membershipAt: otherPublished.id,
            version: gw.freeze(otherTerm).id,
          },
          71_003,
        ),
      ]);
      const stood = await standSlate(gw, {
        container: "container:slate:kit",
        members: [gw.reactor.get(strike.id)!],
        closes: ["egress"],
      });
      return { claim: claim.id, stood };
    });

    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    const block = blockFor(printed(), "container:slate:kit");
    expect(block).toMatch(/affected/);
    expect(block).toContain("container:wall:ivy");
    expect(block).toMatch(/come back to life at the cut/);
    expect(block).toContain(world.claim); // the claim the cut would bring back, named before it acts
    // AND NOT THE WALL THAT DOES NOT OVERLAP. One container in the answer and one deliberately
    // outside it: a screen that listed every declared container would satisfy every assertion
    // above, and an over-broad affected set is a compliance claim about people it never touched.
    expect(block, printed()).not.toContain("container:wall:quill");
  });

  it("calls an unreadable condemned set UNKNOWN, and never zero", async () => {
    const home = await noteHome("unreadable");
    // A slate whose membership Term this store never received. The set WAS identified and frozen at
    // an address the block prints; this store simply cannot resolve it. Printing "0 deltas" would
    // tell a compliance officer nothing was ever slated — the collapse `readFrozenTerm` refuses one
    // layer down, performed by the screen.
    const stood = await ground(home, async (gw) => {
      const member = await note(gw, "note:kit", "title", "kit-condemned-marker");
      return standSlate(gw, {
        container: "container:slate:kit",
        members: [member],
        closes: ["egress", "cite"],
      });
    });
    // The door REFUSES a record whose membership address resolves to nothing, so this state cannot
    // be appended into existence — `slate.ts` says as much, and names the one way in that remains:
    // a store that never received the Term. Staged the way that store looks, by removing the Term
    // row from under a record that already landed.
    const db = new Database(storePath(home));
    db.prepare("DELETE FROM deltas WHERE id = ?").run(stood.membershipAt);
    db.close();

    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    // The SUMMARY counts what closes no door, which is this slate's whole condition. The counter and
    // its separator are otherwise deletable: three fixtures reach this state and none reads the line.
    expect(printed().split("\n")[0]).toMatch(/1 slate over .* — 1 closing no door/);
    const block = blockFor(printed(), "container:slate:kit");
    expect(block).toMatch(/condemned\s+UNKNOWN/);
    expect(block).not.toMatch(/condemned\s+0 delta/);
    expect(block).toContain(stood.version); // the address it was frozen at, still printed
    expect(block).toMatch(/UNRESOLVED/);
    // And what it ENFORCES is empty, said out loud — a slate reporting `closes` as though it were
    // in force would be a claim of protection never delivered.
    expect(block).toMatch(/enforcing none/);
  });

  it("reports a container re-declared elsewhere without obeying it", async () => {
    const home = await noteHome("moved");
    // §29.2: the RECORD's pins are immutable and still govern, so the condemned set has not moved.
    // The disagreement is reported so an operator cannot mistake a re-declaration for a
    // re-identification.
    const stood = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-condemned-marker");
      const vera = await note(gw, "note:vera", "title", "vera-bystander-marker");
      const s = await standSlate(gw, {
        container: "container:slate:kit",
        members: [kit],
        closes: ["egress"],
      });
      // The door requires the record and the container to AGREE, so a disagreeing record cannot be
      // appended. It arises the other way: the container is RE-DECLARED after the record landed —
      // a declaration is latest-wins on this pair, and §29.2 is the rule that the record's pins,
      // being immutable, keep governing anyway.
      const otherTerm = frozenMembershipTerm([vera.id]);
      const published = signClaims(termClaims(otherTerm, OP, 70_000), OP_SEED);
      await gw.append([published]);
      await gw.append([
        declareContainer(
          {
            container: s.container,
            trust: "curated",
            posture: "shared",
            membershipAt: published.id,
            version: gw.freeze(otherTerm).id,
          },
          70_001,
        ),
      ]);
      return s;
    });

    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    const block = blockFor(printed(), "container:slate:kit");
    expect(block).toMatch(/DISAGREEMENT/);
    expect(block).toContain(stood.record);
  });

  it("counts what a long list leaves out, rather than dropping it silently", async () => {
    const home = await noteHome("many");
    // Nine walls the operator signs `accepts-incomplete` over. The block names eight and COUNTS the
    // ninth: a compliance screen that truncated in silence would be the omission these readers exist
    // to prevent, one layer down.
    const walls = ["ivy", "kit", "vera", "nib", "quill", "cyd", "wisp", "moss", "reed"].map(
      (n) => `container:wall:${n}`,
    );
    await ground(home, async (gw) => {
      const member = await note(gw, "note:kit", "title", "kit-condemned-marker");
      return standSlate(gw, {
        container: "container:slate:kit",
        members: [member],
        closes: ["egress"],
        acceptsIncomplete: walls,
      });
    });

    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    const block = blockFor(printed(), "container:slate:kit");
    expect(block).toContain(walls[0]!); // the first eight are named...
    expect(block).toContain(walls[7]!);
    expect(block).not.toContain(walls[8]!); // ...the ninth is not...
    expect(block).toContain("and 1 more"); // ...and it is counted, never dropped
    expect(block).toMatch(/cutting around .* at the operator's signature/);
  });

  it("keeps two slates' facts on their own blocks, and calls a lapsed deadline lapsed", async () => {
    const home = await noteHome("two");
    const stood = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-condemned-marker");
      const nib = await note(gw, "note:nib", "title", "nib-condemned-marker");
      const standing = await standSlate(gw, {
        container: "container:slate:kit",
        members: [kit],
        closes: ["egress"],
        requestedBy: "subject:kit",
        deadline: DEADLINE,
      });
      const lapsed = await standSlate(gw, {
        container: "container:slate:nib",
        members: [nib],
        closes: ["egress"],
        requestedBy: "subject:nib",
        deadline: LAPSED_DEADLINE,
        requestedAt: LAPSED_DEADLINE - 86_400_000,
        ts: 60_000,
      });
      return { standing, lapsed };
    });

    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    // The SUMMARY line counts what the blocks below it show. Two slates, one of them past its
    // deadline — a counter stuck at zero would leave an operator scrolling for the one that matters.
    expect(printed().split("\n")[0]).toMatch(/2 slates over .* — 1 past deadline/);
    const kitBlock = blockFor(printed(), "container:slate:kit");
    const nibBlock = blockFor(printed(), "container:slate:nib");

    // Each block carries ITS OWN facts and none of the other's — a listing that read one record for
    // every row would swap them and be caught here.
    expect(kitBlock).toContain("subject:kit");
    expect(kitBlock).not.toContain("subject:nib");
    expect(kitBlock).toContain(stood.standing.version);
    expect(kitBlock).not.toContain(stood.lapsed.version);
    expect(nibBlock).toContain("subject:nib");
    expect(nibBlock).not.toContain("subject:kit");
    expect(nibBlock).toContain(stood.lapsed.version);

    // §29.4: the lapse TIGHTENS rather than expiring, so the lapsed slate says so and the standing
    // one does not. The two-sided half of the same fact — and the SENTENCE is pinned, not merely
    // the word: a lapsed slate that still enforces has `read` closed, which is a different fact
    // from a lapsed slate that closes nothing, and both arms match a bare /lapsed/i.
    expect(nibBlock).toMatch(/LAPSED, so `read` is closed too/);
    expect(kitBlock).not.toMatch(/lapsed/i);
  });

  it("points a lapsed slate with an unreadable set at the UNRESOLVED row", async () => {
    const home = await noteHome("lapsed-unreadable");
    // The other arm of the same ternary, and it needs BOTH conditions at once: past its deadline AND
    // unable to read its condemned set. The sibling rail covers lapsed-and-empty, and a collapse to
    // either sentence leaves the other's readers looking for a line that is not on their screen.
    const stood = await ground(home, async (gw) => {
      const member = await note(gw, "note:kit", "title", "kit-condemned-marker");
      return standSlate(gw, {
        container: "container:slate:kit",
        members: [member],
        closes: ["egress"],
        deadline: LAPSED_DEADLINE,
        requestedAt: LAPSED_DEADLINE - 86_400_000,
      });
    });
    const db = new Database(storePath(home));
    db.prepare("DELETE FROM deltas WHERE id = ?").run(stood.membershipAt);
    db.close();

    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    const block = blockFor(printed(), "container:slate:kit");
    expect(block).toMatch(/LAPSED/);
    expect(block).toMatch(/see UNRESOLVED below/);
    expect(block).toMatch(/^\s+UNRESOLVED/m); // and the row it points at is really there
    expect(block).not.toMatch(/condemned set is EMPTY/);
  });

  it("blames the right cause when a lapsed slate closes no door", async () => {
    const home = await noteHome("empty-set");
    // `enforcedBy` returns empty for TWO different reasons — a set that cannot be read, and a set
    // with nothing in it — and only the first prints an UNRESOLVED row. A single shared sentence
    // would send half its readers looking for a line that is not on the screen.
    await ground(home, async (gw) => {
      await note(gw, "note:kit", "title", "kit-bystander-marker");
      return standSlate(gw, {
        container: "container:slate:empty",
        members: [],
        closes: ["egress"],
        deadline: LAPSED_DEADLINE,
        requestedAt: LAPSED_DEADLINE - 86_400_000,
      });
    });

    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    const block = blockFor(printed(), "container:slate:empty");
    expect(block).toMatch(/condemned\s+0 delta/); // readable, and genuinely empty — not UNKNOWN
    expect(block).toMatch(/condemned set is EMPTY/);
    expect(block).not.toMatch(/see UNRESOLVED below/); // there is no UNRESOLVED row to see
    expect(block).not.toMatch(/^\s+UNRESOLVED/m);
  });
});

describe("T206 (d) — `loam tombstones` reads the receipt, never the record", () => {
  it("shows who ordered it, whose record it was, when, and why — and none of the content", async () => {
    const home = await noteHome("receipt");
    const forgotten = await ground(home, async (gw) => {
      // THE ERASED RECORD IS SOMEBODY ELSE'S. A subject writes; the operator, as the controller,
      // executes. If the target were written by the operator too, `spoken by` and `ordered by`
      // would be one string and every assertion below could be satisfied by either line — the
      // receipt could print the same author twice and the rail would not notice.
      await grantWrite(gw, SUBJECT);
      const target = await noteAs(gw, "note:kit", "title", "kit-erased-marker", SUBJECT_SEED);
      expect(target.claims.author).toBe(SUBJECT);
      // The probe's own premise, asserted rather than assumed: the marker really is in the delta
      // about to be erased, so "the receipt does not contain it" is a claim about the receipt.
      expect(JSON.stringify(target.claims)).toContain("kit-erased-marker");
      const receipt = await gw.erase(target.id, { reason: "kit asked, under article 17" });
      return { target: target.id, ...receipt };
    });
    expect(forgotten.spokenBy).toBe(SUBJECT);

    // DELTA LEVEL: one surviving operator tombstone, and it erases the id we think it does.
    const tombs = await ground(home, (gw) => survivingTombstones(gw.reactor, OP));
    expect(tombs).toHaveLength(1);
    expect(tombstoneTarget(tombs[0]!.claims)).toBe(forgotten.target);
    expect(tombs[0]!.id).toBe(forgotten.tombstone);

    // OBJECT LEVEL, the listing: the receipt is on the screen, abbreviated for scanning.
    clear();
    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    expect(listing).toContain(short(forgotten.target));
    expect(listing).toContain(short(forgotten.tombstone));
    expect(listing).toContain("kit asked, under article 17");
    expect(listing).not.toContain("kit-erased-marker");
    expect(listing).toMatch(/remembers THAT it forgot these ids, never what they said/);
    expect(listing).toMatch(/1 receipt in/);
    // The PRESENT forms of the two columns whose absent forms are railed elsewhere. Hard-coding
    // either cell to the absent marker would otherwise pass every assertion in this file.
    const listedRow = listing.split("\n").find((l) => l.includes(short(forgotten.tombstone)));
    expect(listedRow, listing).toContain(SUBJECT.slice(0, 20));
    expect(listedRow).toContain("kit asked, under article 17");

    // OBJECT LEVEL, the receipt in full — by the tombstone's own id.
    clear();
    expect(
      await run(["tombstones", "show", forgotten.tombstone, "--home", home], io()),
      printed(),
    ).toBe(0);
    const shown = printed();
    expect(shown).toContain(forgotten.tombstone); // the receipt's own id, in full
    expect(shown).toContain(forgotten.target); // the id it forgot, in full
    expect(shown).toContain(new Date(tombs[0]!.claims.timestamp).toISOString()); // when
    // TWO DIFFERENT PEOPLE, on two lines, each asserted to carry ONE of them. A receipt that
    // printed the controller where the subject belongs would name the wrong person in a legal
    // record — and against a fixture where the two are the same key, nothing here could see it.
    const lineOf = (label: string): string =>
      shown.split("\n").find((l) => l.trimStart().startsWith(label)) ?? "";
    expect(lineOf("spoken by"), shown).toContain(SUBJECT);
    expect(lineOf("spoken by")).not.toContain(OP);
    expect(lineOf("ordered by"), shown).toContain(OP);
    expect(lineOf("ordered by")).not.toContain(SUBJECT);
    expect(lineOf("ordered by")).toMatch(/admits no other signer/);
    expect(shown).toContain("kit asked, under article 17"); // why
    // AND NOT WHAT. The receipt remembers THAT it forgot; a receipt carrying the erased bytes
    // would undo the erasure it is the proof of.
    expect(shown).not.toContain("kit-erased-marker");
    expect(shown).toMatch(/remembers THAT this id was forgotten, and none of what it said/);
    // The reason is the OPERATOR'S sentence and nothing else. A reader that swept up every string
    // pointer would put the erased delta's author on this line and call it a reason — a compliance
    // record inventing its own justification, which is worse than one carrying none.
    const reasonLine = lineOf("reason");
    expect(reasonLine, shown).toContain("kit asked, under article 17");
    expect(reasonLine).not.toContain("ed25519:");
    expect(await ground(home, (gw) => receiptLedger(gw.reactor, OP).receipts[0]!.reasons)).toEqual([
      "kit asked, under article 17",
    ]);

    // The same receipt, found by the id the operator actually has: the one that was erased.
    clear();
    expect(
      await run(["tombstones", "show", forgotten.target, "--home", home], io()),
      printed(),
    ).toBe(0);
    expect(printed()).toContain(forgotten.tombstone);
    expect(printed()).not.toContain("kit-erased-marker");
  });

  it("a struck receipt leaves the listing and is COUNTED, while a named live one stays", async () => {
    // The home name is deliberately not a word this screen prints. A `toMatch` over the whole blob
    // reads the STORE PATH too, and the first draft of this rail was satisfied by a temp directory
    // called "forgiven" rather than by the sentence it meant to pin.
    const home = await noteHome("home-b");
    const both = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
      const vera = await note(gw, "note:vera", "title", "vera-erased-marker");
      const kept = await gw.erase(kit.id, { reason: "kit asked" });
      const forgiven = await gw.erase(vera.id, { reason: "vera asked" });
      // Forgiveness (§11): striking the tombstone withdraws the erasure order, so the id may
      // return. The receipt stops binding and leaves the surviving set.
      await gw.append([
        signClaims(makeNegationClaims(OP, gw.nextTimestamp(), forgiven.tombstone), OP_SEED),
      ]);
      return { kept, forgiven };
    });

    // DELTA LEVEL: the ground holds two tombstones and exactly one of them still binds.
    const surviving = await ground(home, (gw) =>
      survivingTombstones(gw.reactor, OP).map((d) => d.id),
    );
    expect(surviving).toEqual([both.kept.tombstone]);

    clear();
    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    expect(listing).toContain(short(both.kept.tombstone)); // the live receipt is there...
    expect(listing).not.toContain(short(both.forgiven.tombstone)); // ...the forgiven one is not...
    // ...and the omission is DECLARED, with the COUNT. An omission and a revocation look identical
    // on a screen that only drops the row, and this listing is read on the morning that difference
    // decides a case.
    expect(listing).toMatch(/\b1 more receipt\b[^\n]*not bind/);
  });

  it("names the cut a receipt belonged to, and stays silent about one for a lone erasure", async () => {
    const home = await noteHome("joined");
    // A CUT stamps §29.6's join on every tombstone it mints, and drops the slate's container LAST —
    // so a join pointing at a container that is gone is the ordinary post-cut state, not a defect.
    const both = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
      const vera = await note(gw, "note:vera", "title", "vera-erased-marker");
      return {
        cut: await gw.erase(kit.id, { reason: "kit asked", slate: "container:slate:kit" }),
        lone: await gw.erase(vera.id, { reason: "vera asked" }),
      };
    });

    expect(await run(["tombstones", "show", both.cut.tombstone, "--home", home], io())).toBe(0);
    expect(printed()).toContain("container:slate:kit");
    expect(printed()).toMatch(/one member of that cut/);
    clear();
    expect(await run(["tombstones", "show", both.lone.tombstone, "--home", home], io())).toBe(0);
    expect(printed()).not.toContain("container:slate:");
  });

  it("orders two receipts sharing one moment by their addresses, so one store reads one way", async () => {
    const home = await noteHome("ordered");
    // Two tombstones at the SAME wall-clock moment. `gw.erase` cannot make this pair — nextTimestamp
    // strictly increases — so the claims are signed by hand and appended through the ordinary door,
    // which is the state a store restored from two sources holds. Nothing is purged here: this rail
    // is about the ORDER the listing prints, and only about that.
    //
    // THE FIXTURE IS BUILT TO DISAGREE WITH THE ANSWER. The pair is appended in DESCENDING address
    // order, so insertion order is the reverse of the order the listing must print. Without that,
    // a comparator that returned 0 for every pair would leave the stable sort in insertion order
    // and pass — the rail would be checking that a list it sorted itself matches a list the code
    // never sorted. Nothing here is fitted to a hash: the ids are content addresses, computed
    // first, then appended in whichever order the addresses turn out to give.
    const at = 8_000_000;
    const pair = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
      const vera = await note(gw, "note:vera", "title", "vera-erased-marker");
      const tombs = [kit, vera].map((d, i) =>
        signClaims(eraseClaims(d.id, d.claims.author, OP, at, `subject ${i} asked`), OP_SEED),
      );
      const ascending = [...tombs].sort((a, b) => (a.id < b.id ? -1 : 1));
      await gw.append([...ascending].reverse());
      return ascending.map((t) => t.id);
    });

    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    const first = listing.indexOf(short(pair[0]!));
    const second = listing.indexOf(short(pair[1]!));
    expect(first, printed()).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(second);
  });

  it("keeps every reason a receipt carries, and says plainly when it carries none", async () => {
    const home = await noteHome("reasons");
    // THREE STATES, and only one of them is what `gw.erase` mints. A tombstone with no reason is
    // ordinary (an older store, or an erase called without one); a tombstone with several is what a
    // reader that took the FIRST would silently narrow — and narrowing a compliance record is the
    // failure this reader exists to refuse. The door validates the erased id, the author and the
    // §29.6 join, and says nothing about how many reasons ride along, so both are reachable.
    const at = 9_000_000;
    const both = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
      const vera = await note(gw, "note:vera", "title", "vera-erased-marker");
      const two = eraseClaims(kit.id, kit.claims.author, OP, at, "kit asked in March");
      const many = signClaims(
        {
          ...two,
          pointers: [
            ...two.pointers,
            { role: "reason", target: { kind: "primitive", value: "and again in April" } },
          ],
        },
        OP_SEED,
      );
      const none = signClaims(eraseClaims(vera.id, vera.claims.author, OP, at + 1), OP_SEED);
      await gw.append([many, none]);
      return { many: many.id, none: none.id };
    });

    // DELTA LEVEL: the ground really does hold one receipt with two reasons and one with none.
    const held = await ground(home, (gw) => receiptLedger(gw.reactor, OP).receipts);
    expect(held.find((r) => r.tombstone === both.many)!.reasons).toEqual([
      "kit asked in March",
      "and again in April",
    ]);
    expect(held.find((r) => r.tombstone === both.none)!.reasons).toEqual([]);

    // OBJECT LEVEL: both reasons reach the screen, and the receipt with none SAYS so rather than
    // printing an empty space a reader would take for an oversight.
    expect(await run(["tombstones", "show", both.many, "--home", home], io()), printed()).toBe(0);
    expect(printed()).toContain("kit asked in March");
    expect(printed()).toContain("and again in April");
    clear();
    expect(await run(["tombstones", "show", both.none, "--home", home], io()), printed()).toBe(0);
    expect(printed()).toMatch(/none recorded/i);
  });

  it("refuses an id no surviving receipt names, and says what would show one", async () => {
    const home = await noteHome("absent");
    const stranger = "b".repeat(64);
    // 1, not 2: the id is well formed and the invocation is right. What is absent is a receipt in
    // this store, which is a STATE — and the whole file separates those two codes deliberately, so
    // a script can retry one and fix the other.
    expect(await run(["tombstones", "show", stranger, "--home", home], io())).toBe(1);
    expect(printed()).toContain(stranger);
    expect(printed()).toContain("tombstones list");
    // Nothing here does not bind, so the refusal says nothing about forgiveness. The other side of
    // that sentence is the next rail.
    expect(printed()).not.toMatch(/do not bind|does not bind/);
  });

  it("does not tell a forgiven id it was never forgotten", async () => {
    const home = await noteHome("pardoned");
    // Forgiveness withdraws the erasure order, so the receipt leaves the surviving set — and an id
    // this store really did forget, and then forgave, reads exactly like one it never held. The
    // listing already discloses the count that does not bind; the lookup must too, or the two
    // screens contradict each other about the same store.
    const forgiven = await ground(home, async (gw) => {
      const target = await note(gw, "note:kit", "title", "kit-erased-marker");
      const receipt = await gw.erase(target.id, { reason: "kit asked" });
      await gw.append([
        signClaims(makeNegationClaims(OP, gw.nextTimestamp(), receipt.tombstone), OP_SEED),
      ]);
      return { erased: target.id, tombstone: receipt.tombstone };
    });

    expect(await run(["tombstones", "show", forgiven.erased, "--home", home], io())).toBe(1);
    const said = printed();
    expect(said).toMatch(/1 receipt here does not bind/);
    expect(said).toMatch(/forgiv/i);
    // AND IT DOES NOT ASSERT THE ABSENCE the ground contradicts: the screen may say no receipt
    // STANDS, and must not say the store never forgot the id. "currently" is the word that keeps
    // the sentence true, so its loss is what this pins — the previous needle forbade a phrase no
    // implementation ever wrote, and passed against every one of them.
    expect(said).toMatch(/not as an id this store is currently forgetting/);
  });

  it("prints the receipts oldest first, by the moment each was recorded", async () => {
    const home = await noteHome("chronology");
    // Two receipts a moment apart. The only other ordering rail shares one `at` and exercises the
    // TIE-BREAK alone, so reversing the primary key stays green there while the help text promises
    // oldest first.
    const both = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
      const vera = await note(gw, "note:vera", "title", "vera-erased-marker");
      const first = await gw.erase(kit.id, { reason: "kit asked in March" });
      const second = await gw.erase(vera.id, { reason: "vera asked in April" });
      return { first, second };
    });
    const at = await ground(home, (gw) => receiptLedger(gw.reactor, OP).receipts.map((r) => r.at));
    expect(at[0]!, "the fixture must span two moments").toBeLessThan(at[1]!);

    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    expect(listing.indexOf(short(both.first.tombstone))).toBeLessThan(
      listing.indexOf(short(both.second.tombstone)),
    );
  });

  it("states the absence when a receipt does not record whose record it forgot", async () => {
    const home = await noteHome("anonymous");
    // The DOOR requires `spoken-by`; replay does not. A receipt replanted from a cold copy, or
    // written by an older version, can stand without one — so the reader meets a receipt the door
    // would refuse. Planted through the driver rather than the door, which is exactly how such a
    // receipt arrives.
    const tomb = await ground(home, async (gw) => {
      const target = await note(gw, "note:kit", "title", "kit-erased-marker");
      return { target: target.id, author: target.claims.author };
    });
    const bare = signClaims(
      {
        timestamp: 9_500_000,
        author: OP,
        pointers: [
          {
            role: "declares",
            target: { kind: "entity", entity: { id: ERASE_ENTITY, context: CTX_ERASE } },
          },
          { role: "erases", target: { kind: "delta", deltaRef: { delta: tomb.target } } },
          { role: "reason", target: { kind: "primitive", value: "an older store wrote this" } },
        ],
      },
      OP_SEED,
    );
    const backend = new SqliteBackend(storePath(home));
    await backend.append([bare]);
    await backend.close();

    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    // SCOPED TO THE ROW. The header line carries an em dash of its own, so a bare search for the
    // absent-cell marker passes over any listing at all — including one printing a blank cell.
    const row = printed()
      .split("\n")
      .find((l) => l.includes(short(bare.id)));
    expect(row, printed()).toContain(ABSENT);
    clear();
    expect(await run(["tombstones", "show", bare.id, "--home", home], io()), printed()).toBe(0);
    expect(printed()).toMatch(/does not record whose record it forgot/);
    expect(printed()).toContain("an older store wrote this"); // and the rest of it still reads
  });

  it("declares the §25 rows it never saw, on both readers", async () => {
    const home = await noteHome("pen");
    const world = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
      const vera = await note(gw, "note:vera", "title", "vera-bystander-marker");
      const receipt = await gw.erase(kit.id, { reason: "kit asked" });
      return { vera: vera.id, veraClaims: claimsToJson(vera.claims), receipt };
    });
    // A row set aside is OUTSIDE the reactor these verbs read. Left silent, a set-aside strike would
    // leave a withdrawal reading LIVE and a set-aside tombstone would leave a forgotten id reading
    // as never forgotten — and neither screen could tell you it had not looked.
    corrupt(home, world.vera, JSON.stringify({ not: "claims at all" }));

    for (const verb of [
      ["tombstones", "list"],
      ["slate", "list"],
    ]) {
      clear();
      expect(await run([...verb, "--home", home], io()), printed()).toBe(0);
      expect(printed(), verb.join(" ")).toMatch(/quarantine/i);
      expect(printed()).toContain("repair list");
      // ON STDOUT, WITH THE LISTING IT QUALIFIES. `loam slate list > proof.txt` files an absence,
      // and a limit that says the reader never saw the set-aside rows belongs in the same file as
      // the absence. Split across two streams, the filed document reads as the whole answer.
      expect(out.join("\n"), verb.join(" ")).toMatch(/quarantine/i);
    }

    // TWO-SIDED, on BOTH readers: a store with an empty pen says none of this. A hedge printed
    // unconditionally is a hedge nobody reads, and the disclosure is wired per verb.
    const clean = await noteHome("clean-pen");
    for (const verb of [
      ["tombstones", "list"],
      ["slate", "list"],
    ]) {
      clear();
      expect(await run([...verb, "--home", clean], io()), printed()).toBe(0);
      expect(printed(), verb.join(" ")).not.toMatch(/quarantine/i);
    }
  });

  it("asks the tiers before calling a receipt swept, on both readers", async () => {
    const home = await noteHome("promise");
    // A TOMBSTONE IS A PROMISE, NOT A REPORT. §11 lands the receipt, purges, and only then reports a
    // tier that refused — so a receipt stands over bytes that are still on this disk whenever a
    // sweep faults mid-flight. Read from the receipt alone, both screens print a completed
    // forgetting, with a date, that nothing asked about. The erase screens in this same file refuse
    // exactly that claim, and two screens disagreeing about one store is the shape a compliance
    // reader cannot resolve.
    const world = await ground(home, async (gw) => {
      const target = await note(gw, "note:kit", "title", "kit-erased-marker");
      await note(gw, "note:vera", "title", "vera-bystander-marker");
      const tomb = signClaims(
        eraseClaims(target.id, target.claims.author, OP, gw.nextTimestamp(), "kit asked"),
        OP_SEED,
      );
      await gw.append([tomb]);
      return { target: target.id, tomb: tomb.id };
    });
    // THE PREMISE, at the bytes: the receipt stands and the record is still here.
    expect(homeHolds(home, "kit-erased-marker")).toBe(true);

    expect(await run(["tombstones", "show", world.tomb, "--home", home], io()), printed()).toBe(0);
    expect(printed(), "the show screen states the sweep, not just the order").toMatch(/NOT SWEPT/);
    expect(printed()).toContain("STILL HOLDS");

    clear();
    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).toMatch(/stand over an UNFINISHED sweep/);

    // TWO-SIDED, and it is the whole rail: a store whose sweep really did run says SWEPT on both
    // screens. Without this half, a reader that had simply stopped making any claim would pass.
    //
    // THE HOME IS NOT NAMED FOR THE WORD BEING ASSERTED. The listing prints the store PATH, so a
    // fixture directory called "swept" satisfies `toContain("swept")` on every code path — the
    // trap this file's header names, sprung by the rail that exists to catch it. The cell is read
    // off its own row instead.
    const done = await noteHome("second-home");
    const other = await ground(done, async (gw) => {
      await note(gw, "note:vera", "title", "vera-bystander-marker");
      return (await note(gw, "note:kit", "title", "kit-erased-marker")).id;
    });
    expect(
      await run(["erase", other, "--reason", "kit asked", "--home", done], io()),
      printed(),
    ).toBe(0);
    clear();
    expect(await run(["tombstones", "list", "--home", done], io()), printed()).toBe(0);
    const row = printed()
      .split("\n")
      .find((l) => l.includes(short(other)));
    expect(row, printed()).toContain("swept");
    expect(printed()).not.toMatch(/UNFINISHED sweep/);

    // AND THE SHOW SCREEN, on the settled side too — "on both readers" was true of the held arm
    // only, and the settled cell's own sentence was asserted nowhere in the tree.
    clear();
    expect(await run(["tombstones", "show", other, "--home", done], io()), printed()).toBe(0);
    expect(printed()).toContain("swept — no tier this run opened still holds it");
    expect(printed()).not.toMatch(/NOT SWEPT|UNPROVEN|NOT SETTLED/);

    // And the bystander is untouched by any of it.
    expect(homeHolds(done, "vera-bystander-marker")).toBe(true);
  });

  it("asks the COLD ARCHIVE before calling a receipt swept", async () => {
    const home = await noteHome("cold-receipt");
    // THE TIER MOST LIKELY TO STILL HOLD IT. `MirrorBackend.purge` reaches both sides and reports
    // the archive's refusal AFTER the primary succeeded, so the state this fixture builds is the
    // ordinary outcome of a failed sweep: the tombstone stands, the primary is clean, and the cold
    // copy is legible. A verdict computed over the primary alone calls that row swept.
    const target = await ground(
      home,
      async (gw) => {
        await note(gw, "note:vera", "title", "vera-bystander-marker");
        return (await note(gw, "note:kit", "title", "kit-erased-marker")).id;
      },
      { vault: VAULT },
    );
    // THE REAL §11 PATH, over a gateway that never attached the vault — which is what a sweep
    // whose archive tier refused leaves behind: a standing receipt, a clean primary, a cold copy.
    await ground(home, (gw) => gw.erase(target, { reason: "kit asked" }));
    // THE PREMISE, at the bytes: gone from the primary, legible in the vault.
    expect(primaryHolds(home, "kit-erased-marker")).toBe(false);
    expect(vaultHolds(home, "kit-erased-marker")).toBe(true);

    // config.json is what a read verb has to go on: `--archive` never writes its name there, and
    // this reader takes no such flag.
    const config = join(home, "config.json");
    writeFileSync(
      config,
      JSON.stringify({ ...JSON.parse(readFileSync(config, "utf8")), archive: VAULT }),
    );

    clear();
    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed(), "the cold copy is not swept").toMatch(/stand over an UNFINISHED sweep/);
    expect(printed()).toContain(join(home, VAULT));

    // TWO-SIDED: the same store with the vault emptied of that record reads swept. Without this
    // half a reader that called everything unswept would pass.
    for (const file of filesUnder(join(home, VAULT))) {
      if (readFileSync(file).includes("kit-erased-marker")) rmSync(file);
    }
    clear();
    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).not.toMatch(/UNFINISHED sweep/);
    // And the bystander is still in the vault, untouched by any of this.
    expect(vaultHolds(home, "vera-bystander-marker")).toBe(true);
  });

  it("scopes an empty answer to the key it actually asked about", async () => {
    // "This store has forgotten nothing" is only ever checked for ONE signer — erasure is the
    // operator's alone, and the reader asks about this home's key. Over a store governed by another
    // key the unqualified sentence would be an absence the command never verified.
    const home = await noteHome("scoped");
    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).toContain(OP.slice(0, 20));
    clear();
    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).toContain(OP.slice(0, 20));
  });

  it("refuses a malformed invocation by name, on every one of the three verbs", async () => {
    const home = await noteHome("usage");
    // `test/cli/help.test.ts` pins the flag allowlist for the commands it lists, and these three are
    // not among them — so without this nothing covers the hand-written argument refusals. Exit 2
    // throughout: a malformed invocation, which the whole file keeps distinct from a state (1).
    for (const [args, needle] of [
      [["slate"], /wants a subcommand/],
      [["slate", "cut"], /there is no `slate cut`/],
      [["slate", "list", "extra"], /takes no arguments/],
      [["tombstones"], /wants a subcommand/],
      [["tombstones", "purge"], /there is no `tombstones purge`/],
      [["tombstones", "show"], /wants an id/],
      [["tombstones", "show", "a", "b"], /exactly one id/],
      [["erase"], /wants the id of one delta/],
      [["erase", "a", "b", "--reason", "x"], /exactly one delta id/],
      [["slate", "list", "--frobnicate", "x"], /--frobnicate/],
      [["tombstones", "list", "--frobnicate", "x"], /--frobnicate/],
      [["erase", "a", "--reason", "x", "--frobnicate", "y"], /--frobnicate/],
    ] as const) {
      clear();
      expect(await run([...args, "--home", home], io()), args.join(" ")).toBe(2);
      expect(printed(), args.join(" ")).toMatch(needle);
    }
  });

  it("refuses a home with no operator identity — erasure has exactly one signer", async () => {
    const bare = join(root, "bare");
    mkdirSync(bare);
    for (const verb of [
      ["tombstones", "list"],
      ["slate", "list"],
    ]) {
      clear();
      // 1, not 2: the invocation was well formed. What is missing is the authority, and the two
      // exit codes are how a script tells a typo from a home it cannot act in.
      expect(await run([...verb, "--home", bare], io()), printed()).toBe(1);
      expect(printed()).toMatch(/operator/i);
      // ONE refusal, one sentence. A second line here means the refusal was said and then something
      // internal leaked out after it — a thrown TypeError reads to an operator as a broken tool
      // rather than as a home that needs `loam init`.
      expect(err, printed()).toHaveLength(1);
    }
  });

  it("says plainly that nothing has been forgotten, and the same store speaks after one erasure", async () => {
    const home = await noteHome("nothing");

    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    const empty = printed();
    expect(empty).toMatch(/forgotten nothing|no .*receipt/i);
    expect(empty).not.toMatch(/reason/i);

    const receipt = await ground(home, async (gw) => {
      const target = await note(gw, "note:quill", "title", "quill-erased-marker");
      return gw.erase(target.id, { reason: "quill asked" });
    });
    clear();
    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).toContain(short(receipt.tombstone));
    expect(printed()).toContain("quill asked");

    // And --store names WHICH store is answering here too. Pointed at a file this home has never
    // written, the same verb reports nothing forgotten — the flag routes the read.
    clear();
    expect(
      await run(["tombstones", "list", "--home", home, "--store", "elsewhere.sqlite"], io()),
      printed(),
    ).toBe(0);
    expect(printed()).not.toContain(short(receipt.tombstone));
    expect(printed()).toMatch(/forgotten nothing|no .*receipt/i);
  });
});

describe("T206 (b) — `loam erase` removes the bytes at every local tier", () => {
  it("sweeps the primary AND the archive, prints the receipt, and leaves a named bystander whole", async () => {
    const home = await noteHome("swept");
    const target = await ground(
      home,
      async (gw) => {
        // The erased record is the SUBJECT'S, not the controller's — the same separation the
        // receipt reader needs, asked here of the screen `loam erase` prints. Collapsed into one
        // key, the `spoken by` line below could print either identity and pass.
        await grantWrite(gw, SUBJECT);
        const kit = await noteAs(gw, "note:kit", "title", "kit-erased-marker", SUBJECT_SEED);
        await note(gw, "note:vera", "title", "vera-bystander-marker");
        return kit.id;
      },
      { vault: VAULT },
    );
    // THE PREMISE, ASSERTED. Both tiers hold both markers before the order is given. Without this
    // the "gone" assertions below would pass just as well over a vault that never had the bytes.
    expect(primaryHolds(home, "kit-erased-marker")).toBe(true);
    expect(vaultHolds(home, "kit-erased-marker")).toBe(true);
    expect(primaryHolds(home, "vera-bystander-marker")).toBe(true);
    expect(vaultHolds(home, "vera-bystander-marker")).toBe(true);

    clear();
    expect(
      await run(
        [
          "erase",
          target,
          "--reason",
          "kit asked, under article 17",
          "--home",
          home,
          "--archive",
          VAULT,
        ],
        io(),
      ),
      printed(),
    ).toBe(0);
    const said = printed();

    // DELTA LEVEL: one receipt in the ground, naming this id — and the id the SCREEN printed is
    // that receipt, so the operator can look up what they were just told.
    const receipts = await ground(home, (gw) => receiptLedger(gw.reactor, OP).receipts);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.erased).toBe(target);
    expect(said).toContain(receipts[0]!.tombstone);
    expect(said).toContain("kit asked, under article 17");
    // The swept line NAMES the tiers it asked, and the archive branch is one of them — without this
    // the vault can drop out of the sentence while the sweep still reaches it, so an operator
    // reading the screen cannot tell which tiers were verified.
    const sweptLine = said.split("\n").find((l) => l.includes("asked tier by tier"));
    expect(sweptLine, said).toContain(join(home, VAULT));
    // The screen names WHOSE record it was, and that is the subject rather than the operator who
    // ordered it — the one line on this screen that identifies a person in a legal record.
    const spokenLine = said.split("\n").find((l) => l.trimStart().startsWith("spoken by"));
    expect(spokenLine, said).toContain(SUBJECT);
    expect(spokenLine).not.toContain(OP);

    // BYTES, TWO-SIDED: the target is gone from every file under this home — primary, sidecars,
    // vault — and the named bystander is untouched on both tiers.
    expect(homeHolds(home, "kit-erased-marker"), "the erased bytes are still at rest").toBe(false);
    expect(primaryHolds(home, "vera-bystander-marker")).toBe(true);
    expect(vaultHolds(home, "vera-bystander-marker")).toBe(true);

    // OBJECT LEVEL, the same two sides: the bystander still resolves through its Schema, and the
    // erased record resolves to nothing. Byte-absence and view-absence are different questions, and
    // T40 is what happens when only one of them is asked.
    const views = await ground(home, (gw) => ({
      kit: gw.resolvedNode("Note", "note:kit").view["title"],
      vera: gw.resolvedNode("Note", "note:vera").view["title"],
    }));
    expect(views.vera).toBe("vera-bystander-marker");
    expect(views.kit).toBeUndefined();

    // THE WHOLE DISCLOSURE BLOCK, pinned by TRANSCRIPTION rather than by the arrays under test.
    // Looping the implementation's own constant is a mirror: delete an entry and its assertion goes
    // with it, empty the array and the loop passes zero times. These headwords are written out here
    // so the rail states the promise — every disclosure this screen owes — instead of agreeing with
    // whatever the code currently says. Each covers a different way "erased" reads as more than it
    // is: a home file that stays, a tier no probe can ask, and the limits that hold for any erasure.
    expect(said).toMatch(/what an erasure does NOT reach, and never claims to/);
    for (const headword of [
      "credentials.json IS NOT SWEPT",
      "login-locks.json IS NOT SWEPT",
      "user.<name>.seed IS NOT SWEPT",
      "ESM RESIDENCY IS NOT SWEPT",
      "PEERS ARE NOT REACHED",
      "ALREADY-SERVED READS ARE NOT RECALLED",
      "A COPY RE-SPOKEN UNDER ANOTHER ID STILL STANDS",
      "POINTERS ARE NOT CONTENT",
    ]) {
      expect(said, `the run must disclose: ${headword}`).toContain(headword);
    }
    // The counts too, so an entry cannot be dropped from a constant while its headword survives in
    // another. Four erasure-wide limits, three home surfaces, one unprovable tier.
    expect(ERASURE_NON_CLAIMS).toHaveLength(4);
    expect(UNSWEPT_AUTH_SURFACES).toHaveLength(3);
    expect(ESM_RESIDENCY_DISCLOSURE).toHaveLength(1);

    // AND THE §29.7 RECEIPT SAYS THE SAME THING. The anti-drift claim is that one constant feeds
    // both surfaces, and nothing enforces that until something reads both: a compliance officer
    // holding a receipt and one watching a run must not be told different limits.
    const fromReceipt = await ground(home, async (gw) => {
      const member = await note(gw, "note:nib", "title", "nib-cut-marker");
      const slate = await standSlate(gw, {
        container: "container:slate:nib",
        members: [member],
        closes: ["egress"],
      });
      const cut = await gw.cut(slate.container, { now: BEFORE_DEADLINE });
      return (await gw.receipt(cut.graveyard, { now: BEFORE_DEADLINE })).nonClaim;
    });
    for (const surface of ERASURE_NON_CLAIMS) {
      expect(fromReceipt, "the receipt and the screen must read one constant").toContain(surface);
    }

    // THE COLD-TIER BOUNDARY on the branch where a vault WAS named. Both limits stay true when one
    // is: a vault at an absolute path outside the home is invisible to the probe that cleared this
    // run, as is one deeper than the search bound. It used to print on neither branch.
    expect(said).toMatch(/is invisible to the probe that cleared this run/);
    expect(said).toMatch(/ABSOLUTE path outside/);

    // TWO-SIDED on the alarms: a clean erasure raises none of them.
    expect(said).not.toMatch(/still HELD/);
    // THE PHRASE THE CODE ACTUALLY WRITES. The announcement reads "BROUGHT n CLAIM(S) BACK"
    // and lists rows as "— live again"; the word "revival" appears in no sentence on this
    // path, so a /reviv/i needle forbade nothing and passed against every implementation,
    // including one that printed the banner on every erase.
    expect(said).not.toMatch(/BROUGHT \d+ CLAIM\(S\) BACK|live again/);
    // Including the three BOUNDARY lines, which print before the revival list and outside its early
    // return — so a guard stuck open would put them on every screen, which is the failure this file
    // names for the revival line itself.
    expect(said).not.toMatch(/REOPENED/);
    expect(said).not.toMatch(/NOW MASK DIFFERENTLY/);
    // AND NOT THE AS-OF SENTENCE, which is about a strike this run did not destroy.
    expect(said).not.toMatch(/AS-OF door was not read/);
    // Nor the channel-lens boundary: this home holds no channels, and a hedge printed
    // unconditionally is a hedge nobody reads.
    expect(said).not.toMatch(/channel read door/);
    expect(said).not.toMatch(/could not be consulted/);
  });

  it("enumerates the surviving deltas left pointing at the hole", async () => {
    const home = await noteHome("cited");
    // §11's citations manifest: the holes a removal leaves, counted and named. A strike CITES what
    // it withdrew, so erasing the claim leaves the strike dangling at an id that is gone.
    const world = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-erased-marker");
      const strike = signClaims(makeNegationClaims(OP, gw.nextTimestamp(), claim.id), OP_SEED);
      await gw.append([strike]);
      return { claim: claim.id, strike: strike.id };
    });

    expect(
      await run(["erase", world.claim, "--reason", "kit asked", "--home", home], io()),
      printed(),
    ).toBe(0);
    expect(printed()).toMatch(/1 surviving delta\(s\) still point at the hole/);
    expect(printed()).toContain(world.strike);
  });

  it("names a revival when the strike lived in a channel's pool as well", async () => {
    // §11 fans the purge into every attached pool, so a strike inside one is removed by the same
    // order and revives the same way. The reading walks the pools for exactly that reason.
    //
    // NOT SEPARABLE, and said plainly: the erase target must be in the PRIMARY ground for the order
    // to run at all, so a strike that exists ONLY in a pool cannot be the subject of this verb.
    // This rail proves the path end to end; it does not isolate the pool's own contribution.
    const peer = await noteHome("revival-peer");
    const offer = join(root, "revival-offer.json");
    const world = await ground(peer, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const strike = signClaims(makeNegationClaims(OP, gw.nextTimestamp(), claim.id), OP_SEED);
      await gw.append([strike]);
      writeFileSync(offer, exportOffer(gw));
      return { claim: claim.id, strike: strike.id };
    });

    const home = await noteHome("revival-channel");
    expect(await run(["pull", offer, "--home", home], io()), printed()).toBe(0);
    clear();
    expect(
      await run(
        [
          "federate",
          "open",
          "--from",
          offer,
          "--into",
          "friends",
          "--prefix",
          "nib",
          "--home",
          home,
        ],
        io(),
      ),
      printed(),
    ).toBe(0);
    expect(poolsHold(home, "kit-retracted-marker")).toBe(true);
    expect(
      await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"]),
    ).toBeUndefined();

    clear();
    expect(
      await run(
        ["erase", world.strike, "--reason", "the strike was filed in error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    expect(printed()).toMatch(/BROUGHT 1 CLAIM\(S\) BACK/);
    expect(printed()).toContain(world.claim);
    // ONE CLAIM, TWO DOORS, and the rows say which. It came back in this store's own ground AND in
    // the pool, so a reading keyed by id alone attributes it to whichever ground the loop visited
    // last — and prints "in an attached pool" over a claim live at the store's own door. This
    // fixture is exactly that pair, so the label has to be asserted here or nowhere.
    const rows = printed()
      .split("\n")
      .filter((l) => l.includes(world.claim) && l.includes("live again"));
    expect(rows, printed()).toHaveLength(2);
    expect(rows.filter((l) => l.includes("in an attached pool"))).toHaveLength(1);
    expect(rows.filter((l) => !l.includes("in an attached pool"))).toHaveLength(1);
    // And the swept line COUNTS the pool it reached. The branch is otherwise deletable: no other
    // fixture has an attached pool at erase time.
    const sweptLine = printed()
      .split("\n")
      .find((l) => l.includes("asked tier by tier"));
    expect(sweptLine, printed()).toMatch(/1 attached channel pool\b/);
    expect(await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"])).toBe(
      "kit-retracted-marker",
    );
  });

  it("sweeps EVERY named archive, and a home with two of them can be erased at all", async () => {
    const home = await noteHome("two-vaults");
    // A HOME CAN HOLD MORE THAN ONE COLD TIER. With a last-wins flag, naming either left the other
    // unnamed and the guard refused every invocation — the deadlock round seven's fix removed. The
    // flag repeats now, and the sweep must reach both: one mirror per vault, folded.
    const target = await ground(
      home,
      async (gw) => {
        const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
        await note(gw, "note:vera", "title", "vera-bystander-marker");
        return kit.id;
      },
      { vault: VAULT },
    );
    // A SECOND vault holding the same bytes — a backup copy of the first, which is how a home comes
    // to have two.
    cpSync(join(home, VAULT), join(home, "vault.bak"), { recursive: true });
    expect(holdsIn(join(home, "vault.bak"), "kit-erased-marker")).toBe(true);

    // Naming ONE is still refused, because the other is still a tier this command was not told
    // about — the guard's whole point, and the state that used to have no way out.
    expect(
      await run(
        ["erase", target, "--reason", "kit asked", "--home", home, "--archive", VAULT],
        io(),
      ),
    ).toBe(1);
    expect(printed()).toContain(join(home, "vault.bak"));

    // Naming BOTH proceeds, and the sweep reaches both.
    clear();
    expect(
      await run(
        [
          "erase",
          target,
          "--reason",
          "kit asked",
          "--home",
          home,
          "--archive",
          VAULT,
          "--archive",
          "vault.bak",
        ],
        io(),
      ),
      printed(),
    ).toBe(0);
    const sweptLine = printed()
      .split("\n")
      .find((l) => l.includes("asked tier by tier"));
    expect(sweptLine, printed()).toContain(join(home, VAULT));
    expect(sweptLine).toContain(join(home, "vault.bak"));
    // TWO-SIDED at the bytes, on BOTH vaults.
    expect(homeHolds(home, "kit-erased-marker")).toBe(false);
    expect(holdsIn(join(home, VAULT), "vera-bystander-marker")).toBe(true);
    expect(holdsIn(join(home, "vault.bak"), "vera-bystander-marker")).toBe(true);

    // AND THE OTHER SPELLING OF THE FLAG. `--name value` and `--name=value` are separate branches
    // of the parser, and only the first kept a repeat — so `--archive=a --archive=b` opened one
    // vault while the refusal above insisted both be named. A second store, because the first has
    // nothing left to erase.
    const twin = await noteHome("two-vaults-equals");
    const second = await ground(
      twin,
      async (gw) => {
        await note(gw, "note:vera", "title", "vera-bystander-marker");
        return (await note(gw, "note:kit", "title", "kit-erased-marker")).id;
      },
      { vault: VAULT },
    );
    await ground(twin, async (gw) => note(gw, "note:nib", "title", "nib-second-vault-marker"), {
      vault: "vault.bak",
    });
    clear();
    expect(
      await run(
        [
          "erase",
          second,
          "--reason",
          "kit asked",
          `--home=${twin}`,
          `--archive=${VAULT}`,
          "--archive=vault.bak",
        ],
        io(),
      ),
      printed(),
    ).toBe(0);
    const equalsLine = printed()
      .split("\n")
      .find((l) => l.includes("asked tier by tier"));
    expect(equalsLine, printed()).toContain(join(twin, VAULT));
    expect(equalsLine).toContain(join(twin, "vault.bak"));
    expect(homeHolds(twin, "kit-erased-marker")).toBe(false);
    expect(holdsIn(join(twin, VAULT), "vera-bystander-marker")).toBe(true);
  });

  it("files the whole report on stdout, limits included", async () => {
    const home = await noteHome("one-document");
    // `loam erase … > receipt.txt` is the obvious way to file the proof this verb exists to produce.
    // The completion claim used to go to stdout and every qualification to stderr, so the filed
    // document said the record was gone and carried none of its limits — the overclaim in its
    // purest form, and invisible to a rail that reads the two streams merged.
    const target = await ground(
      home,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    clear();
    expect(
      await run(["erase", target, "--reason", "kit asked", "--home", home], io()),
      printed(),
    ).toBe(0);

    const document = out.join("\n"); // stdout ALONE — what a redirect would capture
    // THE CLAIM, pinned to the id it is about and to the receipt that proves it. A bare
    // `toContain("erased")` is satisfied by one of the LIMIT sentences below ("…cite an erased
    // id…"), so the entire receipt block could move to stderr and this rail would read green — the
    // exact split it exists to forbid.
    expect(document).toContain(`loam: erased ${target}`);
    expect(document, "the receipt id belongs in the filed document").toMatch(
      /\n {2}receipt +[0-9a-f]{16}/,
    );
    expect(document).toContain("the bytes are gone, asked tier by tier");
    for (const limit of [
      "credentials.json IS NOT SWEPT",
      "ESM RESIDENCY IS NOT SWEPT",
      "PEERS ARE NOT REACHED",
      "A COPY RE-SPOKEN UNDER ANOTHER ID STILL STANDS",
      "NO cold archive was consulted",
    ]) {
      expect(document, `a filed receipt must carry: ${limit}`).toContain(limit);
    }
  });

  it("marks a vault this run CREATED, and leaves a real one unmarked", async () => {
    const home = await noteHome("invented-vault");
    // `--archive` takes a PATH and `ArchiveBackend` makes its root, so a typo does not fail. It
    // opens an empty tier, that tier answers "no bytes here", and the sweep lists it beside a real
    // one as though both had been asked and both had been clean. The screen has to say which of
    // the two this run invented, or the invented one reads as evidence.
    const target = await ground(
      home,
      async (gw) => {
        await note(gw, "note:vera", "title", "vera-bystander-marker");
        return (await note(gw, "note:kit", "title", "kit-erased-marker")).id;
      },
      { vault: VAULT },
    );
    expect(existsSync(join(home, "ghost")), "the fixture's premise").toBe(false);
    clear();
    expect(
      await run(
        [
          "erase",
          target,
          "--reason",
          "kit asked",
          "--home",
          home,
          "--archive",
          VAULT,
          "--archive",
          "ghost",
        ],
        io(),
      ),
      printed(),
    ).toBe(0);
    const said = printed();
    const sweptLine = said.split("\n").find((l) => l.includes("asked tier by tier"));
    // ONE MARKED AND THE OTHER NOT. A marker on every vault would be as useless as none: the fact
    // an operator acts on is which line of the sweep is worth reading.
    expect(sweptLine, said).toContain(`${join(home, "ghost")} (CREATED BY THIS RUN)`);
    expect(sweptLine).not.toContain(`${join(home, VAULT)} (CREATED BY THIS RUN)`);
    expect(said).toContain("did not exist before this run and was created empty by it");
    expect(said).toContain("its line above proves nothing");
    // AND THE NAMED-VAULT ARM of the closing disclosure, which no other rail reaches: every fixture
    // that erases with no --archive at all takes its other branch, so the sentence an operator with
    // a cold tier actually reads was the unread one.
    expect(said).toContain("the archive(s) named above were swept");
    expect(said).toContain("is invisible to the probe that cleared this run");
    // TWO-SIDED AT THE BYTES, and on the REAL tier — the one whose answer meant something.
    expect(homeHolds(home, "kit-erased-marker")).toBe(false);
    expect(vaultHolds(home, "vera-bystander-marker")).toBe(true);
  });

  it("refuses a vault the home hides one directory down, or files oddly", async () => {
    // The detector must be at least as wide as the SWEEPER, or every miss is a silent permission to
    // proceed. Three shapes `ArchiveBackend` produces and a one-level, canonical-name probe misses.
    for (const [name, fan, file] of [
      // `--archive backup/vault` resolves inside the home, one level deeper than a flat probe looks.
      ["nested", ["backup", "vault", "ab"], `ab${"5".repeat(62)}.json`],
      // A crash-left straggler is bytes at rest, and `purge` hunts it.
      ["straggler", ["vault", "cd"], `cd${"9".repeat(62)}.json.4321.tmp`],
      // A MISFILED copy — the address's own fan is not the directory it sits in.
      ["misfiled", ["vault", "ef"], `ab${"7".repeat(62)}.json`],
    ] as const) {
      const home = await noteHome(`hidden-${name}`);
      const target = await ground(
        home,
        async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
      );
      mkdirSync(join(home, ...fan), { recursive: true });
      writeFileSync(join(home, ...fan, file), "{}");

      clear();
      expect(
        await run(["erase", target, "--reason", "kit asked", "--home", home], io()),
        `${name}: the sweep proceeded over a vault it never opened`,
      ).toBe(1);
      expect(printed()).toMatch(/nothing was erased/i);
      expect(printed()).toContain(join(home, fan[0]));
      // TWO-SIDED: nothing was erased by the refusal.
      expect(homeHolds(home, "kit-erased-marker")).toBe(true);
    }
  });

  it("refuses a vault reached through a symlinked fan, and one parked inside the named vault", async () => {
    // Two more shapes the sweeper reaches and a naive probe does not. A `Dirent` for a symlink
    // answers `isDirectory()` false, and `archive.ts` documents the same trap for a `DT_UNKNOWN`
    // mount — hence `!isFile()`. And the NAMED vault must be walked through rather than skipped
    // whole: `ArchiveBackend` reads each fan one level and never recurses, so a second vault parked
    // inside the first is outside the sweep as well as outside a probe that stops at the name.
    const home = await noteHome("symlinked");
    const target = await ground(
      home,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    // The real fan lives outside the vault; the vault reaches it by link.
    mkdirSync(join(home, "elsewhere", "ab"), { recursive: true });
    writeFileSync(join(home, "elsewhere", "ab", `ab${"5".repeat(62)}.json`), "{}");
    mkdirSync(join(home, "linked"), { recursive: true });
    symlinkSync(join(home, "elsewhere", "ab"), join(home, "linked", "ab"), "dir");

    expect(await run(["erase", target, "--reason", "kit asked", "--home", home], io())).toBe(1);
    expect(printed()).toMatch(/nothing was erased/i);
    // THE LINKED PATH, named. Without this the sibling directory holding the real fan satisfies the
    // refusal on its own, and deleting symlink support entirely would leave the rail green.
    expect(printed()).toContain(join(home, "linked"));
    expect(homeHolds(home, "kit-erased-marker")).toBe(true);

    // A vault INSIDE the named one. Naming the outer vault must not blind the probe to the inner.
    const nested = await noteHome("nested-in-named");
    const other = await ground(
      nested,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
      { vault: VAULT },
    );
    mkdirSync(join(nested, VAULT, "older-copy", "cd"), { recursive: true });
    writeFileSync(join(nested, VAULT, "older-copy", "cd", `cd${"3".repeat(62)}.json`), "{}");
    clear();
    expect(
      await run(
        ["erase", other, "--reason", "kit asked", "--home", nested, "--archive", VAULT],
        io(),
      ),
      printed(),
    ).toBe(1);
    expect(printed()).toContain(join(nested, VAULT, "older-copy"));
    expect(homeHolds(nested, "kit-erased-marker")).toBe(true);
  });

  it("names the receipt when a second order arrives for an id already forgotten", async () => {
    const home = await noteHome("twice");
    const target = await ground(
      home,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    expect(
      await run(["erase", target, "--reason", "kit asked", "--home", home], io()),
      printed(),
    ).toBe(0);

    // The bytes are gone, so §11's own refusal says the id "is not held here" — true of the bytes
    // and misleading about the history. The receipt is named beside it, which is the answer the
    // operator came for. Still 1: nothing was done by this call.
    clear();
    expect(await run(["erase", target, "--reason", "kit asked again", "--home", home], io())).toBe(
      1,
    );
    const receipt = await ground(home, (gw) => receiptLedger(gw.reactor, OP).receipts[0]!);
    expect(printed()).toContain(receipt.tombstone);
    expect(printed()).toContain(new Date(receipt.at).toISOString());
    // WHICH ARM. The id and the moment appear in both branches, so asserting them pins that a line
    // was printed and not WHICH ONE — and the two say opposite things about whether the record is
    // forgotten. This erasure settled, so the sweep is finished and the screen must say so.
    expect(printed()).toMatch(/ORDERED at .+ and this run asked every tier it opened/);
    // AND NOT A FORGETTING DATE. The timestamp on a receipt is when the ORDER was signed; the
    // reader refuses that conflation two screens later, and one store must not read two ways.
    expect(printed()).not.toMatch(/forgot it at/);
    expect(printed()).not.toMatch(/is NOT finished/);
    // And no SECOND receipt was minted — a refused order writes nothing.
    expect(await ground(home, (gw) => receiptLedger(gw.reactor, OP).receipts)).toHaveLength(1);
  });

  it("prints the receipt's own reason on a REUSE, and says the new one was not recorded", async () => {
    const home = await noteHome("reused-receipt");
    // THE STATE A FAILED FIRST ORDER LEAVES: the tombstone landed and the sweep did not run. §11
    // lands the receipt before it purges, so this is what an interrupted erase looks like on disk,
    // and the retry the help text calls safe walks straight into it. Staged by appending the
    // receipt through the ordinary door rather than by breaking a tier, which no fixture can do
    // portably — the door validates it exactly as it would the real one.
    const world = await ground(home, async (gw) => {
      const target = await note(gw, "note:kit", "title", "kit-erased-marker");
      await note(gw, "note:vera", "title", "vera-bystander-marker");
      const tomb = signClaims(
        eraseClaims(
          target.id,
          target.claims.author,
          OP,
          gw.nextTimestamp(),
          "the first sentence, art. 17",
        ),
        OP_SEED,
      );
      await gw.append([tomb]);
      return { target: target.id, tomb: tomb.id };
    });
    expect(homeHolds(home, "kit-erased-marker")).toBe(true); // the receipt stands over live bytes

    // The retry, with a DIFFERENT sentence. It completes the sweep and reuses the standing receipt,
    // because a tombstone is immutable and a second one would be a second content address.
    expect(
      await run(["erase", world.target, "--reason", "a corrected sentence", "--home", home], io()),
      printed(),
    ).toBe(0);
    const said = printed();

    // The receipt is named as REUSED, its own sentence is printed, and this run's sentence is not
    // attributed to it — the screen recommends `tombstones show` on the very next line, and the two
    // must not disagree.
    // The RECEIPT LINE's own marker, not merely the word somewhere on the screen — the caveat
    // sentence below carries "REUSED" too, so a bare needle passes with the marker deleted.
    const receiptLine = said.split("\n").find((l) => l.trimStart().startsWith("receipt"));
    expect(receiptLine, said).toMatch(/\(REUSED, not minted by this run\)/);
    // And the caveat itself: a retry answers for its own run, because whatever an earlier run freed
    // was already free when this one started and no later run can see it.
    expect(said).toMatch(/answers for THIS run only/);
    const reasonLine = said.split("\n").find((l) => l.trimStart().startsWith("reason"));
    expect(reasonLine, said).toContain("the first sentence, art. 17");
    expect(reasonLine).not.toContain("a corrected sentence");
    expect(said).toMatch(/YOUR --reason IS NOT ON THE RECEIPT/);

    // DELTA LEVEL: one receipt, still carrying the first sentence, and no second was minted.
    const receipts = await ground(home, (gw) => receiptLedger(gw.reactor, OP).receipts);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.tombstone).toBe(world.tomb);
    expect(receipts[0]!.reasons).toEqual(["the first sentence, art. 17"]);
    // And the retry did the work it exists to do, two-sided as every sweep here is.
    expect(homeHolds(home, "kit-erased-marker")).toBe(false);
    expect(homeHolds(home, "vera-bystander-marker")).toBe(true);
  });

  it("says a promised sweep is UNFINISHED rather than calling the record forgotten", async () => {
    const home = await noteHome("unfinished");
    // A receipt standing over bytes that are still here, and an order that cannot proceed. The two
    // arms of this branch say opposite things to a compliance officer, and the wrong one is an H7
    // overclaim: "this store forgot it at …" over a record the store still holds.
    const world = await ground(home, async (gw) => {
      const target = await note(gw, "note:kit", "title", "kit-erased-marker");
      const tomb = signClaims(
        eraseClaims(target.id, target.claims.author, OP, gw.nextTimestamp(), "kit asked"),
        OP_SEED,
      );
      await gw.append([tomb]);
      // A declared SEPARATE container that nothing attaches. §27.7's completeness guard refuses the
      // sweep up front rather than report a completeness it never verified.
      await gw.append([
        declareContainer(
          { container: "container:wall:unreachable", trust: "curated", posture: "separate" },
          72_000,
        ),
      ]);
      return { target: target.id, tomb: tomb.id };
    });

    expect(await run(["erase", world.target, "--reason", "kit asked", "--home", home], io())).toBe(
      1,
    );
    const said = printed();
    expect(said).toContain(world.tomb);
    expect(said).toMatch(/is NOT finished/);
    expect(said).not.toMatch(/forgot it at/);
    // The removal did not land in this store's own ground, so the revival reading below it was taken
    // over ground the purge never changed. An empty answer there is UNMEASURED, and says so — the
    // caveat is gated on the reactor still holding the id, not on any I/O failure.
    expect(said).toMatch(/Treat an empty answer as UNMEASURED/);
    // The probe's own arm: this store's pen IS empty, so the refusal says which of the three causes
    // it can rule out rather than listing all three as equally likely.
    expect(said).toMatch(/pen is EMPTY/);
    // The guard's own advice names `openContainer` and `detach()`, which no CLI verb reaches. The
    // refusal is right; without this line its only stated cure is one an operator cannot perform,
    // and the whole if-block deletes with the suite green.
    expect(said).toMatch(/EMBEDDING API and no CLI verb reaches them/);
    expect(said).toMatch(/loam federate list/);
    // Two-sided at the bytes: a refused order removes nothing.
    expect(homeHolds(home, "kit-erased-marker")).toBe(true);
  });

  it("will not call a sweep settled over a tier it could not ask", async () => {
    const home = await noteHome("unprovable");
    // THE THIRD STATE. `erasureOutstanding` walks the host, its tombstones and the ATTACHED pools —
    // and §27.7's guard refuses precisely because a declared container is NOT attached. Over that
    // state its silence means "not asked", so reading it as "clean" prints the settled sentence,
    // with a date, about the one tier this run could not look in.
    const target = await ground(
      home,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    // A REAL erasure first, so the receipt stands and the host is genuinely clean.
    expect(
      await run(["erase", target, "--reason", "kit asked", "--home", home], io()),
      printed(),
    ).toBe(0);
    expect(homeHolds(home, "kit-erased-marker")).toBe(false);

    // A second order for the same id, on a store that has since declared a container nothing
    // attaches. The guard refuses, and the receipt from the first run is found.
    await ground(home, (gw) =>
      gw.append([
        declareContainer(
          { container: "container:wall:unreachable", trust: "curated", posture: "separate" },
          72_000,
        ),
      ]),
    );
    clear();
    expect(await run(["erase", target, "--reason", "kit asked again", "--home", home], io())).toBe(
      1,
    );
    const said = printed();
    expect(said).toMatch(/CANNOT SHOW that the sweep/);
    expect(said, "the tier it could not ask is named").toContain("container:wall:unreachable");
    expect(said).not.toMatch(/forgot it at/);

    // TWO-SIDED: the same second order, on a store with nothing unreachable, DOES settle. Without
    // this the rail would pass over a screen that had simply stopped making the settled claim.
    const clean = await noteHome("provable");
    const other = await ground(
      clean,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    expect(
      await run(["erase", other, "--reason", "kit asked", "--home", clean], io()),
      printed(),
    ).toBe(0);
    clear();
    expect(await run(["erase", other, "--reason", "kit asked again", "--home", clean], io())).toBe(
      1,
    );
    expect(printed()).toMatch(/ORDERED at .+ and this run asked every tier it opened/);
    // AND NOT A FORGETTING DATE. The timestamp on a receipt is when the ORDER was signed; the
    // reader refuses that conflation two screens later, and one store must not read two ways.
    expect(printed()).not.toMatch(/forgot it at/);
    expect(printed()).not.toMatch(/CANNOT SHOW/);
  });

  it("reaches a federation channel's own pool file, and spares the peer's other record", async () => {
    // A peer's frozen offer, landed TWICE into one home: `pull` puts it in the primary ground, and
    // `federate open` puts the same deltas in the channel's own sqlite file. That second file is a
    // tier, and a sweep that attached the pool over empty memory would purge nothing there while
    // reporting the erasure complete.
    const peer = await noteHome("peer");
    const offer = join(root, "offer.json");
    const nib = await ground(peer, async (gw) => {
      const target = await note(gw, "note:nib", "title", "nib-channel-marker");
      await note(gw, "note:cyd", "title", "cyd-channel-marker");
      writeFileSync(offer, exportOffer(gw));
      return target.id;
    });

    const home = await noteHome("channelled");
    expect(await run(["pull", offer, "--home", home], io()), printed()).toBe(0);
    clear();
    expect(
      await run(
        [
          "federate",
          "open",
          "--from",
          offer,
          "--into",
          "friends",
          "--prefix",
          "nib",
          "--home",
          home,
        ],
        io(),
      ),
      printed(),
    ).toBe(0);
    // The premise again: the pool's own file really holds both markers.
    expect(poolsHold(home, "nib-channel-marker")).toBe(true);
    expect(poolsHold(home, "cyd-channel-marker")).toBe(true);
    expect(primaryHolds(home, "nib-channel-marker")).toBe(true);

    clear();
    expect(
      await run(["erase", nib, "--reason", "nib asked", "--home", home], io()),
      printed(),
    ).toBe(0);

    expect(homeHolds(home, "nib-channel-marker"), "a channel pool kept the erased bytes").toBe(
      false,
    );
    expect(poolsHold(home, "cyd-channel-marker")).toBe(true);
    expect(primaryHolds(home, "cyd-channel-marker")).toBe(true);
    // A CHANNEL LENS IS A READER THIS CHECK DOES NOT MODEL. It serves the POOL's deltas filtered by
    // THIS store's surviving strikes, and the revival reading diffs each ground on its own — so
    // the boundary is stated wherever a channel exists.
    expect(printed()).toMatch(/channel read door\(s\) were not modelled/);
  });

  it("names every claim an erased STRIKE brings back to life, and the claim really returns", async () => {
    // The home name is deliberately not a word this screen prints — see the header. A first draft
    // called it "revives", and both halves of this pair then read the temp path instead of the
    // sentence: the positive matched it, and the negative could never pass.
    const home = await noteHome("struck-then-erased");
    // Alice says something; the operator strikes it. Erasing the STRIKE is §11 pointed at a
    // negation, and a purged strike retires nothing — so the claim it withdrew is live again at
    // every reader. H1's headline outcome, reachable in one command.
    const world = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const strike = signClaims(makeNegationClaims(OP, gw.nextTimestamp(), claim.id), OP_SEED);
      await gw.append([strike]);
      return { claim: claim.id, strike: strike.id };
    });
    // The premise: while the strike stands, the claim does NOT resolve.
    expect(
      await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"]),
    ).toBeUndefined();

    expect(
      await run(
        ["erase", world.strike, "--reason", "the strike was filed in error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    // THE SCREEN SAYS IT, with the count, and names the id that came back.
    expect(printed()).toMatch(/BROUGHT 1 CLAIM\(S\) BACK/);
    expect(printed()).toContain(world.claim);
    // AND IT REALLY CAME BACK — object level, through the Schema. Without this the rail would pin
    // a warning that might be describing nothing.
    expect(await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"])).toBe(
      "kit-retracted-marker",
    );
  });

  it("names a claim revived THREE strikes down the chain, which one hop cannot see", async () => {
    const home = await noteHome("deep-chain");
    // C is withdrawn by S1; S1 is withdrawn by S2; S2 is withdrawn by S3. So S1 binds again and C
    // is suppressed. Erasing S3 lets S2 bind, which unbinds S1, which frees C — the root claim
    // returns, three hops from the delta that was removed. A walk of S3's own pointers names S2 and
    // stops, so the ONE id a person actually cares about is the one it cannot reach.
    const chain = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const strikes: string[] = [];
      let target = claim.id;
      for (let i = 0; i < 3; i += 1) {
        const s = signClaims(makeNegationClaims(OP, gw.nextTimestamp(), target), OP_SEED);
        await gw.append([s]);
        strikes.push(s.id);
        target = s.id;
      }
      return { claim: claim.id, s1: strikes[0]!, s2: strikes[1]!, s3: strikes[2]! };
    });
    // The premise: with the whole chain standing, the claim does NOT resolve.
    expect(
      await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"]),
    ).toBeUndefined();

    expect(
      await run(
        ["erase", chain.s3, "--reason", "the third strike was filed in error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    const said = printed();
    expect(said).toMatch(/BROUGHT 2 CLAIM\(S\) BACK/);
    expect(said).toContain(chain.claim); // the root claim, three hops away
    expect(said).toContain(chain.s2); // and the strike that now binds again
    expect(said).not.toContain(chain.s1); // which went the OTHER way, and is not a revival
    // OBJECT LEVEL: it really did come back.
    expect(await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"])).toBe(
      "kit-retracted-marker",
    );
  });

  it("says the byte verdict could not see the §25 rows, and stays quiet when there are none", async () => {
    const home = await noteHome("pen-blind");
    const world = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
      const vera = await note(gw, "note:vera", "title", "vera-bystander-marker");
      return { kit: kit.id, veraClaims: claimsToJson(vera.claims) };
    });
    // A BYSTANDER row set aside, and an intact target. The sweep succeeds and its verdict is honest
    // about the id it asked for — while a byte probe asks by ID and a set-aside row carries another
    // delta's claims under its own, so an erased record can be legible inside one and every tier
    // still answers "gone". T40's shape, reached through the new verb.
    corrupt(home, world.veraClaims === undefined ? "" : world.kit, world.veraClaims);
    const target = await ground(home, async (gw) => {
      const fresh = await note(gw, "note:quill", "title", "quill-erased-marker");
      return fresh.id;
    });

    expect(
      await run(["erase", target, "--reason", "quill asked", "--home", home], io()),
      printed(),
    ).toBe(0);
    expect(printed()).toMatch(/quarantine/i);
    expect(printed()).toMatch(/COULD NOT SEE THEM/);

    // TWO-SIDED: a store with an empty pen says none of it. A caveat printed unconditionally is a
    // caveat nobody reads.
    const clean = await noteHome("clean-pen-erase");
    const other = await ground(
      clean,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    clear();
    expect(
      await run(["erase", other, "--reason", "kit asked", "--home", clean], io()),
      printed(),
    ).toBe(0);
    expect(printed()).not.toMatch(/COULD NOT SEE THEM/);
  });

  it("names §36's LOGIN DOOR, a reading no registration table holds", async () => {
    const home = await noteHome("login-door");
    // WHAT THIS PINS is the caller-supplied `extra` path, NOT the registration loop. `LoamUser` is
    // assembled by `resolveUserView` and run directly, so no enumeration of registered Schemas can
    // reach it — the CLI has to hand it in. Its mask is `{author eq operator}`: only the operator's
    // strikes bind there, while the stock shelf's `drop` binds everyone's. The sibling rail below
    // covers the registration loop, which this one cannot.
    //
    // `user create` is NOT what registers the reading — nothing does. It is here because a home with
    // no users is a home nobody would read this door on, and the fixture should look like the store
    // the warning is about.
    expect(
      await run(["user", "create", "ivy", "--home", home], io(), password("pw")),
      printed(),
    ).toBe(0);
    clear();

    // TWO strikes on one operator-authored claim: the operator's own, and a subject's.
    const world = await ground(home, async (gw) => {
      await grantWrite(gw, SUBJECT);
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const byOperator = signClaims(makeNegationClaims(OP, gw.nextTimestamp(), claim.id), OP_SEED);
      const bySubject = signClaims(
        makeNegationClaims(SUBJECT, gw.nextTimestamp(), claim.id),
        SUBJECT_SEED,
      );
      await gw.append([byOperator, bySubject]);
      return { claim: claim.id, byOperator: byOperator.id };
    });

    expect(
      await run(
        [
          "erase",
          world.byOperator,
          "--reason",
          "the operator's strike was filed in error",
          "--home",
          home,
        ],
        io(),
      ),
      printed(),
    ).toBe(0);
    const said = printed();
    // At `drop` the subject's strike still binds, so nothing came back there — a reading that
    // consulted only the floor would print nothing at all. At LoamUser's mask the operator's was the
    // only strike that counted, and removing it frees the claim at a live login door.
    expect(said).toMatch(/BROUGHT 1 CLAIM\(S\) BACK/);
    expect(said).toContain(world.claim);
    const row = said.split("\n").find((l) => l.includes(world.claim));
    expect(row, said).toContain("LoamUser");
    expect(row).not.toContain("no trust mask");
  });

  it("names a reading REGISTERED in this store, which no hardcoded mask could know", async () => {
    const home = await noteHome("registered-mask");
    // THE REGISTRATION LOOP, which nothing else here reaches: every other fixture registers only the
    // stock shelf, whose `drop` mask is byte-identical to the hardcoded floor, so the loop can never
    // contribute a distinct reading. This one registers a Schema whose mask trusts the SUBJECT'S
    // strikes and not the operator's — a mask neither the floor nor the login door has.
    expect(
      await run(["register", ledgerRegistration("ledger"), "--home", home], io()),
      printed(),
    ).toBe(0);
    clear();

    // One claim, struck by the SUBJECT alone. At `drop` and at the login door that strike binds, so
    // the claim is suppressed there; at Ledger's mask it binds too — the subject is exactly who
    // Ledger trusts. Erasing it frees the claim at every reading, and Ledger must be NAMED among
    // them, because that name can only come from the registration table.
    const world = await ground(home, async (gw) => {
      await grantWrite(gw, SUBJECT);
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const strike = signClaims(
        makeNegationClaims(SUBJECT, gw.nextTimestamp(), claim.id),
        SUBJECT_SEED,
      );
      await gw.append([strike]);
      return { claim: claim.id, strike: strike.id };
    });

    expect(
      await run(
        ["erase", world.strike, "--reason", "the subject withdrew it in error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    const row = printed()
      .split("\n")
      .find((l) => l.includes(world.claim));
    expect(row, printed()).toContain("Ledger");
  });

  it("sees a reopened reading that shares the FLOOR's mask, which key novelty cannot", async () => {
    const home = await noteHome("reopened-stock");
    // THE DEFAULT MASK IS `drop`. `entityGatherBody` supplies it when a body names none, so an
    // ordinary registration reads under the same key as the floor — and a check that asked "is this
    // mask key new?" could never see such a reading arrive. The sibling rail below registers a
    // Ledger with a distinct mask and therefore cannot reach this case at all: its fixture makes the
    // two derivations look alike, which is why the question is asked by reading NAME.
    const stock = join(root, "stock-reading.json");
    writeFileSync(
      stock,
      JSON.stringify({
        hyperschema: { name: "Plain", alg: 1, body: entityGatherJson() },
        schema: {
          name: "Plain",
          alg: 1,
          props: { title: { pick: { order: { byTimestamp: "desc" } } } },
          default: { pick: { order: { byTimestamp: "desc" } } },
        },
        roots: [],
        writable: ["title"],
      }),
    );
    expect(await run(["register", stock, "--home", home], io()), printed()).toBe(0);
    clear();

    const ids = await ground(home, async (gw) => {
      const registration = [...gw.reactor.snapshot()].find((d) =>
        JSON.stringify(d.claims).includes("Plain"),
      )!;
      const strike = signClaims(
        makeNegationClaims(OP, gw.nextTimestamp(), registration.id),
        OP_SEED,
      );
      await gw.append([strike]);
      return { strike: strike.id };
    });

    expect(
      await run(
        ["erase", ids.strike, "--reason", "the withdrawal was an error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    // SCOPED TO THE LINE, and the count pinned. "Plain" appears in the registration this fixture
    // wrote, so asserting it over the whole screen is satisfied by any screen that happens to echo
    // the name — and a count read off the boundary line is the number that can be wrong.
    const reopenedLine = printed()
      .split("\n")
      .find((l) => l.includes("REOPENED"));
    expect(reopenedLine, printed()).toMatch(/REOPENED 1 READING\(S\)/);
    expect(reopenedLine).toContain("Plain");
  });

  it("declares the §25 rows an ATTACHED POOL is holding, not the host's alone", async () => {
    // `setAsideWarning` walks every store the readers brought into scope, and its own comment says a
    // sentence reading only the host's pen "would report an all-clear over a container it just
    // brought into the reading". Every other §25 fixture corrupts the PRIMARY, so the pool arm of
    // that loop is unrailed — delete it and they all stay green.
    const peer = await noteHome("pool-pen-peer");
    const offer = join(root, "pool-pen-offer.json");
    await ground(peer, async (gw) => {
      await note(gw, "note:nib", "title", "nib-pool-marker");
      await note(gw, "note:cyd", "title", "cyd-pool-marker");
      writeFileSync(offer, exportOffer(gw));
    });

    const home = await noteHome("pool-pen");
    expect(
      await run(
        [
          "federate",
          "open",
          "--from",
          offer,
          "--into",
          "friends",
          "--prefix",
          "nib",
          "--home",
          home,
        ],
        io(),
      ),
      printed(),
    ).toBe(0);
    // THE HOST'S PEN IS EMPTY, ASKED RATHER THAN ASSERTED IN A COMMENT. Without this the rail
    // cannot tell the pool arm of the loop from the host arm it already had: a disclosure printed
    // for the wrong reason reads identically to one printed for the right one.
    clear();
    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed(), "the host pen is empty before the pool row is damaged").not.toMatch(
      /quarantine/i,
    );

    const pool = readdirSync(join(home, "channels")).find((f) => f.endsWith(".sqlite"))!;
    const db = new Database(join(home, "channels", pool));
    const row = db.prepare("SELECT id FROM deltas LIMIT 1").get() as { id: string };
    db.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run(
      JSON.stringify({ not: "claims at all" }),
      row.id,
    );
    db.close();

    clear();
    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).toMatch(/quarantine/i);
    expect(printed()).toContain("repair list");
  });

  it("names a reading whose MASK MOVED, and keeps a revival off its name", async () => {
    const home = await noteHome("remasked");
    // A DOOR THAT WAS NEVER WITHDRAWN. Ledger is defined twice — latest-wins per (entity, lens
    // name) — and mask-b's definition is then struck, so mask-a governs. Erasing that STRIKE hands
    // Ledger back to mask-b. The reading survives the whole way; only its rule for whose strikes
    // bind moves. That rule change un-suppresses claims wholesale, and the "before" it would be
    // diffed against describes a rule no longer in force, so comparing the two manufactures
    // revivals no reader ever experienced.
    //
    // ALMANAC IS WHY THIS RAIL CAN SEE THE BUG. A moved reading whose new mask key belongs to
    // nobody else is dropped one layer up — a key with no BEFORE has nothing to compare — so the
    // attribution filter never runs and a fixture built that way asserts over an empty list.
    // Almanac holds mask-b and does not move, so the key has a before, the struck definition
    // really does come back under it, and the only question left is whose name the row carries.
    for (const [file, trusts, lens] of [
      ["mask-a", SUBJECT, "Ledger"],
      ["mask-b", OP, "Ledger"],
      ["almanac", OP, "Almanac"],
    ] as const) {
      expect(
        await run(["register", ledgerRegistration(file, trusts, lens), "--home", home], io()),
        printed(),
      ).toBe(0);
      clear();
    }

    const ids = await ground(home, async (gw) => {
      // THE DEFINITION, not the registration. The mask lives in the hyperschema BODY, and
      // `readRegistrations` resolves the latest surviving definition for the entity — so striking
      // the second REGISTRATION would leave the second BODY in force and move nothing.
      const definitions = [...gw.reactor.snapshot()]
        .filter((d) =>
          d.claims.pointers.some(
            (pointer) =>
              pointer.role === "rhizomatic.hyperschema.defines" &&
              pointer.target.kind === "entity" &&
              pointer.target.entity.id === "hyperschema:Ledger",
          ),
        )
        .sort((a, b) => a.claims.timestamp - b.claims.timestamp);
      expect(definitions, "two registrations, two definition deltas").toHaveLength(2);
      // AND THE STRIKE OVER IT IS WHAT GETS ERASED. Erasing the definition itself would move Ledger
      // onto mask-a, a key no surviving reading holds — skipped before any attribution happens.
      const strike = signClaims(
        makeNegationClaims(OP, gw.nextTimestamp(), definitions[1]!.id),
        OP_SEED,
      );
      await gw.append([strike]);
      return { strike: strike.id, definition: definitions[1]!.id };
    });

    expect(
      await run(
        ["erase", ids.strike, "--reason", "the withdrawal was an error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    const said = printed();
    expect(said).toMatch(/READING\(S\) NOW MASK DIFFERENTLY/);
    expect(said).toContain("Ledger");
    expect(said).toMatch(/its rule for whose strikes bind moved/);
    // THE REVIVAL IS REAL, AND IT IS ALMANAC'S. mask-b saw the struck definition as suppressed and
    // now sees it live, so a row exists however the boundary behaves — which is what makes the
    // negative half below an assertion rather than an empty loop.
    const rows = said.split("\n").filter((l) => l.includes("live again"));
    expect(rows.length, said).toBeGreaterThan(0);
    expect(rows.join("\n"), said).toContain(`${ids.definition} — live again`);
    expect(rows.join("\n"), said).toContain("Almanac");
    // AND NOT LEDGER'S. The whole point of naming a reading as remasked is that this run did not
    // compare it; a row attributing that revival to Ledger is the false alarm the boundary refuses.
    for (const row of rows) expect(row, said).not.toContain("Ledger");
  });
  it("counts a reading it could NOT consult, and says the check is that much narrower", async () => {
    const home = await noteHome("unconsulted");
    // A READING WITH NO SINGLE ANSWER. A hyperschema body that masks two ways has no one
    // suppression rule, so `maskReadings` cannot compute a live set for it and the revival check
    // simply does not speak for that door. Silence there reads as "nothing came back at that
    // reading" — an all-clear about a reader never asked.
    expect(
      await run(["register", twoWayRegistration("twoway"), "--home", home], io()),
      printed(),
    ).toBe(0);
    clear();

    const world = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-withdrawn-marker");
      const strike = signClaims(makeNegationClaims(OP, gw.nextTimestamp(), claim.id), OP_SEED);
      await gw.append([strike]);
      return { strike: strike.id };
    });

    expect(
      await run(
        ["erase", world.strike, "--reason", "the withdrawal was an error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    const said = printed();
    expect(said).toMatch(/1 reading\(s\) could not be consulted at all/);
    expect(said).toContain("Twoway");
    expect(said).toMatch(/masks two ways has no single reading/);

    // AND THE BEFORE-ARM ON ITS OWN. Erasing the two-way body removes the reading entirely, so it
    // is in the BEFORE reading's unreadable list and in no list of the after one. Without this the
    // union `[...was.unreadable, ...then.unreadable]` could be narrowed to either half and the
    // fixture above would not notice, since it holds the reading on both sides.
    const gone = await noteHome("unconsulted-then-gone");
    expect(
      await run(["register", twoWayRegistration("twoway-gone"), "--home", gone], io()),
      printed(),
    ).toBe(0);
    const body = await ground(gone, (gw) => {
      const defs = [...gw.reactor.snapshot()].filter((d) =>
        d.claims.pointers.some(
          (pointer) =>
            pointer.role === "rhizomatic.hyperschema.defines" &&
            pointer.target.kind === "entity" &&
            pointer.target.entity.id === "hyperschema:Twoway",
        ),
      );
      expect(defs, "one registration, one definition delta").toHaveLength(1);
      return defs[0]!.id;
    });
    clear();
    expect(
      await run(["erase", body, "--reason", "the two-way body was an error", "--home", gone], io()),
      printed(),
    ).toBe(0);
    expect(printed(), "the reading was unconsulted BEFORE, and is gone after").toMatch(
      /could not be consulted at all/,
    );
    expect(printed()).toContain("Twoway");

    // AND THE AFTER-ARM ON ITS OWN. Two definitions for one entity, the earlier masking two ways
    // and the later readable: latest-wins, so the reading resolves BEFORE the erasure and becomes
    // unreadable only after it, when removing the later body promotes the earlier one. With only
    // the fixtures above, `then.unreadable` could be dropped from the union and nothing noticed.
    const promoted = await noteHome("unconsulted-after");
    for (const file of [twoWayRegistration("earlier-body"), null]) {
      if (file === null) continue;
      expect(await run(["register", file, "--home", promoted], io()), printed()).toBe(0);
      clear();
    }
    expect(
      await run(
        ["register", ledgerRegistration("later-body", SUBJECT, "Twoway"), "--home", promoted],
        io(),
      ),
      printed(),
    ).toBe(0);
    const later = await ground(promoted, (gw) => {
      const defs = [...gw.reactor.snapshot()]
        .filter((d) =>
          d.claims.pointers.some(
            (pointer) =>
              pointer.role === "rhizomatic.hyperschema.defines" &&
              pointer.target.kind === "entity" &&
              pointer.target.entity.id === "hyperschema:Twoway",
          ),
        )
        .sort((a, b) => a.claims.timestamp - b.claims.timestamp);
      expect(defs, "two bodies for one entity").toHaveLength(2);
      return defs[1]!.id;
    });
    clear();
    expect(
      await run(
        ["erase", later, "--reason", "the later body was an error", "--home", promoted],
        io(),
      ),
      printed(),
    ).toBe(0);
    expect(printed(), "the reading resolved BEFORE and cannot be read after").toMatch(
      /could not be consulted at all/,
    );
    expect(printed()).toContain("Twoway");

    // TWO-SIDED: the same erasure on a store whose readings all resolve says none of this. A
    // boundary printed unconditionally is a boundary nobody reads.
    const plain = await noteHome("all-consulted");
    const other = await ground(plain, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-withdrawn-marker");
      const strike = signClaims(makeNegationClaims(OP, gw.nextTimestamp(), claim.id), OP_SEED);
      await gw.append([strike]);
      return strike.id;
    });
    clear();
    expect(
      await run(["erase", other, "--reason", "the withdrawal was an error", "--home", plain], io()),
      printed(),
    ).toBe(0);
    expect(printed()).not.toMatch(/could not be consulted/);
  });

  it("names a reading this erasure CLOSED, and says the check is that much narrower", async () => {
    const home = await noteHome("closed-door");
    // THE OTHER DIRECTION OF THE BOUNDARY BLOCK. `readRegistrations` drops a registration whose
    // definition no longer loads, so erasing a hyperschema BODY removes a whole door. Nothing
    // resurfaces where there is no door — but the diff walks the AFTER set, so such a reading
    // appeared in no list at all, and every "nothing came back" sentence silently spoke for one
    // reader fewer.
    expect(
      await run(["register", ledgerRegistration("closing"), "--home", home], io()),
      printed(),
    ).toBe(0);
    clear();

    const definition = await ground(home, (gw) => {
      const defs = [...gw.reactor.snapshot()].filter((d) =>
        d.claims.pointers.some(
          (pointer) =>
            pointer.role === "rhizomatic.hyperschema.defines" &&
            pointer.target.kind === "entity" &&
            pointer.target.entity.id === "hyperschema:Ledger",
        ),
      );
      expect(defs, "one registration, one definition delta").toHaveLength(1);
      return defs[0]!.id;
    });

    expect(
      await run(
        ["erase", definition, "--reason", "the reading was registered in error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    const said = printed();
    expect(said).toMatch(/CLOSED 1 READING\(S\)/);
    expect(said).toContain("Ledger");
    expect(said).toMatch(/speaks for that many readers fewer/);

    // TWO-SIDED: an ordinary erasure closes no door and says so by silence.
    const kept = await noteHome("open-door");
    const ordinary = await ground(
      kept,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    clear();
    expect(
      await run(["erase", ordinary, "--reason", "kit asked", "--home", kept], io()),
      printed(),
    ).toBe(0);
    expect(printed()).not.toMatch(/CLOSED \d+ READING\(S\)/);
  });

  it("sees a revival at §36's door over a claim §29 read closure hides", async () => {
    const home = await noteHome("login-raw");
    // A READING IS A MASK AND A GROUND. Every registered Schema and the public door read
    // `readGround`, so a standing slate's condemned member is invisible to them — but
    // `resolveUserView` runs §36's hyperschema over the reactor's own snapshot, where read closure
    // never reaches. Modelled as read-closed, the claim below is filtered out of BOTH readings, no
    // row is emitted, and the strike hiding it can be destroyed with this screen silent while the
    // login door serves it again.
    const world = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-condemned-marker");
      const strike = signClaims(makeNegationClaims(OP, gw.nextTimestamp(), claim.id), OP_SEED);
      await gw.append([strike]);
      const stood = await standSlate(gw, {
        container: "container:slate:kit",
        members: [claim],
        closes: ["read"],
        requestedBy: "subject:kit",
        reason: "kit asked to be forgotten",
      });
      return { claim: claim.id, strike: strike.id, record: stood.record };
    });

    // THE PREMISE, at the object level: a read door serves nothing for this entity — the member is
    // read-closed AND struck. So any row below can only come from a reading of the raw ground.
    expect(
      await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"]),
    ).toBeUndefined();

    clear();
    expect(
      await run(
        ["erase", world.strike, "--reason", "the withdrawal was an error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    const said = printed();
    expect(said).toMatch(/BROUGHT \d+ CLAIM\(S\) BACK/);
    expect(said, "the row names the claim by id").toContain(world.claim);
    expect(said, "and the door it came back at").toContain("LoamUser (§36's login door)");
    // AND NOT THE DOORS THAT STILL CANNOT SERVE IT. Read closure still hides it from every reading
    // that runs over the narrowed ground, so naming those would be the false half of this alarm.
    const row = said.split("\n").find((l) => l.includes("live again"));
    expect(row, said).not.toContain("Note");
  });

  it("names what a SLATE'S RECORD was withholding, when that record is erased", async () => {
    const home = await noteHome("slate-record");
    // §29 READ CLOSURE IS A SECOND SUPPRESSION, and it is not a mask. A standing slate that closes
    // `read` withholds its whole condemned set from every read door while those deltas sit
    // untouched in the reactor — so a revival check that diffs the RAW ground models the mask alone
    // and is blind to it. `eraseImpl` refuses a standing slate's pinned membership Term for exactly
    // this reason; it does not refuse the slate's RECORD, and removing the record retires the slate.
    // One command then reopens the whole condemned set at every door.
    const world = await ground(home, async (gw) => {
      const condemned = await note(gw, "note:kit", "title", "kit-condemned-marker");
      await note(gw, "note:vera", "title", "vera-bystander-marker");
      const stood = await standSlate(gw, {
        container: "container:slate:kit",
        members: [condemned],
        closes: ["read"],
        requestedBy: "subject:kit",
        reason: "kit asked to be forgotten",
      });
      return { condemned: condemned.id, record: stood.record };
    });

    // THE PLAINTEXT IS THERE BEFORE. Every "the bytes are gone" assertion in this file is paired
    // with one proving the marker was in the store first; this one was not, and `standSlate`'s
    // `reason` could stop being written in the clear without a rail noticing.
    expect(homeHolds(home, "kit asked to be forgotten")).toBe(true);

    // OBJECT LEVEL, BEFORE: the read door does not serve the condemned claim. Without this the rail
    // could pass over a fixture where the slate closed nothing and there was nothing to reopen.
    expect(
      await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"]),
      "a read-closed member is not served",
    ).not.toBe("kit-condemned-marker");

    clear();
    expect(
      await run(
        ["erase", world.record, "--reason", "the slate was stood in error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);

    // THE SCREEN NAMES IT. The claim was present before and unservable; it is servable now.
    const said = printed();
    expect(said).toMatch(/BROUGHT \d+ CLAIM\(S\) BACK/);
    expect(said, "the reopened member is named by id").toContain(world.condemned);

    // AND THE OBJECT LEVEL AGREES, which is the half a delta-level diff cannot see.
    expect(await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"])).toBe(
      "kit-condemned-marker",
    );

    // TWO-SIDED AT THE BYTES. The slate record itself is gone, and the bystander — never condemned,
    // never slated — is untouched and still resolves. An erasure rail that only proves the removal
    // cannot see over-purging, which is the direction with no recovery.
    // BY ITS CONTENT, never by its id: the receipt RETAINS the erased id, which is what makes
    // keeping a receipt honest. The slate record carried the requester's stated reason in
    // plaintext, and that is the byte a purge has to remove.
    expect(homeHolds(home, "kit asked to be forgotten")).toBe(false);
    expect(homeHolds(home, "vera-bystander-marker")).toBe(true);
    expect(await ground(home, (gw) => gw.resolvedNode("Note", "note:vera").view["title"])).toBe(
      "vera-bystander-marker",
    );

    // AND A STORE WHOSE SLATE CLOSES NOTHING SAYS NOTHING. `closes: ["egress"]` withholds from a
    // peer, never from a read door, so erasing that record reopens no door here.
    const quiet = await noteHome("slate-record-egress");
    const other = await ground(quiet, async (gw) => {
      const member = await note(gw, "note:kit", "title", "kit-egress-marker");
      const stood = await standSlate(gw, {
        container: "container:slate:egress",
        members: [member],
        closes: ["egress"],
        requestedBy: "subject:kit",
        reason: "kit asked to be forgotten",
      });
      return stood.record;
    });
    clear();
    expect(
      await run(
        ["erase", other, "--reason", "the slate was stood in error", "--home", quiet],
        io(),
      ),
      printed(),
    ).toBe(0);
    expect(printed()).not.toMatch(/BROUGHT \d+ CLAIM\(S\) BACK/);
  });

  it("names the RIGHT door when two entities bind one lens name", async () => {
    const home = await noteHome("shared-name");
    // TWO ENTITIES, ONE LENS NAME — the §21.7 coexistence shape, and the exact reason a reading's
    // identity is (entity, lens name) rather than the name alone. Both sit on the stock shelf's
    // default `drop` mask, so they share one mask key and one list of readings: if that list dedupes
    // its labels separately from its identities, the two fall out of step and every row after the
    // collision addresses one door while naming another. Every other fixture in this file registers
    // one name per entity, so none of them can tell the two apart.
    for (const [file, entity] of [
      ["film-a", "hyperschema:FilmA"],
      ["film-b", "hyperschema:FilmB"],
    ] as const) {
      const path = join(root, `${file}.json`);
      writeFileSync(
        path,
        JSON.stringify({
          hyperschema: { name: "Film", alg: 1, body: entityGatherJson() },
          schema: {
            name: "Film",
            alg: 1,
            props: { title: { pick: { order: { byTimestamp: "desc" } } } },
            default: { pick: { order: { byTimestamp: "desc" } } },
          },
          roots: [],
          writable: ["title"],
          entity,
        }),
      );
      clear();
      expect(await run(["register", path, "--home", home], io()), printed()).toBe(0);
    }

    // Withdraw the SECOND one, then erase the withdrawal so that door — and only that door —
    // reopens.
    const ids = await ground(home, async (gw) => {
      const second = [...gw.reactor.snapshot()]
        .filter((d) =>
          d.claims.pointers.some(
            (p) =>
              p.role === "rhizomatic.hyperschema.defines" &&
              p.target.kind === "entity" &&
              p.target.entity.id === "hyperschema:FilmB",
          ),
        )
        .sort((a, b) => a.claims.timestamp - b.claims.timestamp);
      expect(second, "FilmB's own definition").toHaveLength(1);
      const strike = signClaims(makeNegationClaims(OP, gw.nextTimestamp(), second[0]!.id), OP_SEED);
      await gw.append([strike]);
      return { strike: strike.id };
    });

    clear();
    expect(
      await run(
        ["erase", ids.strike, "--reason", "the withdrawal was an error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    const said = printed();
    expect(said).toMatch(/REOPENED \d+ READING\(S\)/);
    // The door that reopened is a Film door. It must NOT be named Note, and it must not print an
    // internal identity — a NUL-joined key on a compliance screen is the tell that the label and
    // the thing it labels came apart.
    const line = said.split("\n").find((l) => l.includes("REOPENED"))!;
    expect(line, said).toContain("Film");
    expect(line).not.toContain("Note");
    expect(line).not.toContain("\u0000");
    expect(line).not.toContain("hyperschema:");
  });

  it("names a reading this erasure REOPENED, and says its claims were not compared", async () => {
    const home = await noteHome("reopened");
    // Erasing what WITHDREW a reading brings the reading itself back — and everything that door now
    // serves has no BEFORE to be diffed against. The old code skipped such a mask silently, so the
    // screen read as "nothing came back there" about a door it had never looked through.
    expect(
      await run(["register", ledgerRegistration("reopened-ledger"), "--home", home], io()),
      printed(),
    ).toBe(0);
    clear();

    // Withdraw the registration, then erase the withdrawal.
    const ids = await ground(home, async (gw) => {
      const registration = [...gw.reactor.snapshot()].find((d) =>
        JSON.stringify(d.claims).includes("Ledger"),
      )!;
      const strike = signClaims(
        makeNegationClaims(OP, gw.nextTimestamp(), registration.id),
        OP_SEED,
      );
      await gw.append([strike]);
      return { strike: strike.id };
    });

    expect(
      await run(
        ["erase", ids.strike, "--reason", "the withdrawal was an error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    // The reading is NAMED as reopened, and the screen says plainly that its claims were not
    // compared — a stated boundary rather than a silence that reads as an all-clear.
    expect(printed()).toMatch(/REOPENED \d+ READING\(S\)/);
    expect(printed()).toContain("Ledger");
    expect(printed()).toMatch(/had no BEFORE|did not look/);
  });

  it("sees a revival a GRANTEE's strike caused, which the trust mask alone cannot", async () => {
    const home = await noteHome("grantee-strike");
    // EVERY OTHER STRIKE IN THIS FILE IS THE OPERATOR'S, and that is the fixture blind spot this
    // rail exists to remove: the operator's own strike binds identically under both masks, so a
    // corpus made only of them cannot tell the two derivations apart. A stock store registers no
    // trust mask at all — `drop`, where every negation binds whoever signed it — so a data
    // subject's own retraction suppresses at the anonymous door while a trust-masked reading calls
    // the claim live all along, and erasing that strike would free it with nothing printed.
    const world = await ground(home, async (gw) => {
      const grant = signClaims(
        grantClaims(STORE_ENTITY, SUBJECT, "write", OP, gw.nextTimestamp()),
        OP_SEED,
      );
      await gw.append([grant]);
      const claim = await noteAs(gw, "note:kit", "title", "kit-retracted-marker", SUBJECT_SEED);
      const strike = signClaims(
        makeNegationClaims(SUBJECT, gw.nextTimestamp(), claim.id),
        SUBJECT_SEED,
      );
      await gw.append([strike]);
      expect(strike.claims.author).toBe(SUBJECT);
      // THE GRANT IS THEN REVOKED. That is what drives the two masks apart: `drop` does not care who
      // signed a negation, so the retraction still binds at the anonymous door — while the trust
      // mask drops the subject from the striker set, and a governed reader sees the claim as never
      // having been withdrawn at all.
      await gw.append([signClaims(makeNegationClaims(OP, gw.nextTimestamp(), grant.id), OP_SEED)]);
      return { claim: claim.id, strike: strike.id };
    });
    // The premise, at the object level: the subject's own strike really does suppress the claim at
    // this store's reader. Without this the rail could pass over a fixture where nothing was hidden.
    expect(
      await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"]),
    ).toBeUndefined();

    expect(
      await run(
        ["erase", world.strike, "--reason", "the subject withdrew the retraction", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    const said = printed();
    expect(said).toMatch(/BROUGHT 1 CLAIM\(S\) BACK/);
    expect(said).toContain(world.claim);
    // And it NAMES the reader that can see it — the stock mask, not a governed one. That attribution
    // is the whole difference between a fact and a guess about which door just opened.
    expect(said).toMatch(/drop|anonymous door/);
    expect(await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"])).toBe(
      "kit-retracted-marker",
    );
  });

  it("claims no revival when a second strike still withdraws the claim", async () => {
    const home = await noteHome("two-strikes");
    // TWO independent strikes withdraw one claim. Removing either leaves the other binding, so
    // nothing comes back. A one-hop walk would announce the claim as revived and send an operator
    // to destroy a record that was never exposed — the false alarm costs what a missed one does.
    const world = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const first = signClaims(makeNegationClaims(OP, gw.nextTimestamp(), claim.id), OP_SEED);
      const second = signClaims(makeNegationClaims(OP, gw.nextTimestamp(), claim.id), OP_SEED);
      await gw.append([first, second]);
      return { claim: claim.id, first: first.id };
    });

    expect(
      await run(
        ["erase", world.first, "--reason", "one strike was a duplicate", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    // THE PHRASE THE CODE ACTUALLY WRITES. The announcement reads "BROUGHT n CLAIM(S) BACK"
    // and lists rows as "— live again"; the word "revival" appears in no sentence on this
    // path, so a /reviv/i needle forbade nothing and passed against every implementation,
    // including one that printed the banner on every erase.
    expect(printed()).not.toMatch(/BROUGHT \d+ CLAIM\(S\) BACK|live again/);
    expect(printed()).not.toContain(world.claim);
    // AND THE AS-OF DOOR IS NAMED HERE, in the only state its sentence is written for: a strike
    // WAS destroyed and the present ground shows nothing coming back. §26 reconstructs the ground
    // at a timestamp, where the surviving second strike may postdate the read — so silence about
    // the present is not silence about that door. Printed after the early return, this line was
    // suppressed in exactly this state, and no rail could see it.
    expect(printed()).toMatch(/AS-OF door was not read/);
    // And the claim is still withdrawn, which is what makes the silence correct.
    expect(
      await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"]),
    ).toBeUndefined();
  });

  it("says nothing about revivals when an ordinary claim is erased", async () => {
    // The other side. A warning that fired on every erasure would be noise, and noise is how a
    // line earns the right to be ignored.
    const home = await noteHome("plain-erased");
    const target = await ground(
      home,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    expect(
      await run(["erase", target, "--reason", "kit asked", "--home", home], io()),
      printed(),
    ).toBe(0);
    // THE PHRASE THE CODE ACTUALLY WRITES. The announcement reads "BROUGHT n CLAIM(S) BACK"
    // and lists rows as "— live again"; the word "revival" appears in no sentence on this
    // path, so a /reviv/i needle forbade nothing and passed against every implementation,
    // including one that printed the banner on every erase.
    expect(printed()).not.toMatch(/BROUGHT \d+ CLAIM\(S\) BACK|live again/);
    // NO vault was named or configured, so the run says so — and says how far the probe that
    // cleared it actually looked. The sibling assertion on the swept rail carries the same boundary
    // for a run that DID name one.
    expect(printed()).toMatch(/NO cold archive was consulted/);
    expect(printed()).toMatch(/only looked inside/);
  });

  it("refuses when the home owns a cold archive this command was not told about", async () => {
    const home = await noteHome("silent-vault");
    // The `loam serve --archive vault` shape: a live cold tier that config.json never names,
    // because nothing writes it there.
    const target = await ground(
      home,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
      { vault: VAULT },
    );
    expect(vaultHolds(home, "kit-erased-marker")).toBe(true);

    expect(await run(["erase", target, "--reason", "kit asked", "--home", home], io())).toBe(1);
    expect(printed()).toContain(join(home, VAULT));
    expect(printed()).toMatch(/nothing was erased/i);
    // AND NOTHING WAS ERASED — the refusal is before any work, so both tiers still hold the bytes
    // and no receipt was minted. A refusal that had already purged the primary would be worse than
    // the silent sweep it exists to prevent.
    expect(primaryHolds(home, "kit-erased-marker")).toBe(true);
    expect(vaultHolds(home, "kit-erased-marker")).toBe(true);
    expect(await ground(home, (gw) => receiptLedger(gw.reactor, OP).receipts)).toHaveLength(0);

    // Named, it proceeds — so the refusal is about the SILENCE, not about the vault existing.
    clear();
    expect(
      await run(
        ["erase", target, "--reason", "kit asked", "--home", home, "--archive", VAULT],
        io(),
      ),
      printed(),
    ).toBe(0);
    expect(homeHolds(home, "kit-erased-marker")).toBe(false);
  });

  it("does not report an id as absent while its bytes sit in the §25 pen", async () => {
    const home = await noteHome("set-aside");
    const world = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
      const vera = await note(gw, "note:vera", "title", "vera-bystander-marker");
      return { kit: kit.id, veraClaims: claimsToJson(vera.claims) };
    });
    // The row no longer recomputes to its own id, so `deltasSince` sets it aside and the reactor
    // never sees it — while the claims JSON is still legible in the file, under that id.
    corrupt(home, world.kit, world.veraClaims);
    expect(primaryHolds(home, "vera-bystander-marker")).toBe(true);

    expect(await run(["erase", world.kit, "--reason", "kit asked", "--home", home], io())).toBe(1);
    // §11's own refusal speaks for the GROUND. The bytes are a different question, and this asks it
    // rather than letting "not held here" stand over a row that is very much held.
    // The sentence LISTS the causes and diagnoses none: this probe reaches every tier the command
    // opened, so a set-aside row, a cold copy, and a refused purge all look identical from here.
    expect(printed()).toMatch(/still HELD/);
    expect(printed()).toContain("repair list");
    expect(printed()).toContain("archive");
  });
});

describe("T206 (c) — `loam erase` without a reason erases nothing", () => {
  it("refuses, names the flag it wants, and leaves the record exactly where it was", async () => {
    const home = await noteHome("refused");
    const target = await ground(
      home,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    const before = await deltaCount(home);

    for (const args of [
      ["erase", target, "--home", home], // no --reason at all
      ["erase", target, "--reason", "   ", "--home", home], // a reason that says nothing
    ]) {
      clear();
      expect(await run(args, io()), printed()).toBe(2);
      expect(printed()).toContain("--reason");
      expect(printed()).toMatch(/nothing was erased/i);
    }

    // NOTHING WAS ERASED, asserted at both levels and from both sides. The bytes are where they
    // were, the ground holds the same number of deltas, no receipt was minted, and the record still
    // resolves through its Schema.
    expect(homeHolds(home, "kit-erased-marker")).toBe(true);
    expect(await deltaCount(home)).toBe(before);
    expect(await ground(home, (gw) => receiptLedger(gw.reactor, OP).receipts)).toHaveLength(0);
    expect(await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"])).toBe(
      "kit-erased-marker",
    );

    // And the same store, given the same order WITH a reason, does erase it — so the refusal is
    // about the missing sentence and not about a verb that never worked.
    clear();
    expect(
      await run(["erase", target, "--reason", "kit asked", "--home", home], io()),
      printed(),
    ).toBe(0);
    expect(homeHolds(home, "kit-erased-marker")).toBe(false);
  });

  it("marks --reason as required in its own help", async () => {
    // A flag whose absence refuses the command has to READ as mandatory. The same promise
    // `test/cli/help-columns.test.ts` pins for `--connector`, asked here for the one flag that
    // stands between an order and a destroyed record.
    expect(await run(["erase", "--help"], io())).toBe(0);
    expect(printed()).toMatch(/--reason <text>[^\n]*\(required\)/);
  });

  it("wants exactly one delta id", async () => {
    const home = await noteHome("counted");
    expect(await run(["erase", "--home", home], io())).toBe(2);
    expect(printed()).toMatch(/delta/i);
    clear();
    expect(
      await run(["erase", "a".repeat(64), "b".repeat(64), "--reason", "x", "--home", home], io()),
    ).toBe(2);
    expect(printed()).toMatch(/exactly one/i);
  });
});
