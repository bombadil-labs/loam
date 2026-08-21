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
// introduced goes unlisted. It is DERIVED now — `.adlc/evidence/t206-census.mjs` extracts every
// printable statement in the erasure surface of `cli.ts` and matches it against every POSITIVE
// `toMatch` / `toContain` needle here. Re-derive after any change; read the misses one by one.
//
// THE TOOL HAS BEEN WRONG TWICE ITSELF, both times counting as coverage something that was not: it
// matched the rail file verbatim, so this paragraph's own prose scored the lines it described as
// railed; and `.toMatch(` also matched `.not.toMatch(`, so an assertion that a sentence is ABSENT
// supplied the needle proving it covered. Both are the shape the census exists to find — something
// that looks like proof, isn't, and is quiet about it. Expect a third.
//
// It still errs both ways: a REGEX needle is not a substring, so a railed sentence can read as
// unrailed; and it censuses SENTENCES, not BRANCHES, so a sentence asserted once counts as covered
// where the loop producing it for a second store is not — which is how `setAsideWarning`'s pool arm
// survived until a reviewer found it by hand.
//
// What the read-through leaves, and the fixture each would need:
//
//   - `UNKNOWN reach` on a slate block. Needs a container whose overlap with the condemned set
//     cannot be computed — an unattached wall. One `standSlate` plus one declaration.
//   - `duplicates` on a slate block, and with it the only three-argument `capped` call in the
//     source. Needs an operator-authored record linking to a member, and nine to reach the cap.
//   - `KEPT OUTSIDE this sweep` and the kept-container caveat beside the revival line, in both of
//     its forms. Needs a declared separate container covered by a surviving detach record.
//   - The revival list's own cap ("and N more"), and the fault path's "This is DONE and re-running
//     the erase does not undo it". Needs an erasure reviving more than eight claims, and one that
//     purges and then fails.
//   - `setAsideWarning`'s stranded-strike clause and its unreadable-pen branch. The §25 rails
//     corrupt a row into claims the driver cannot parse, so `negates` is undefined and the stranded
//     count stays zero; a row that PARSES and claims a strike would reach it. (Its POOL arm is
//     railed, and was not when this list last claimed to be complete.)
//   - The post-erase `servingWarning` and its erasure-specific sentence. Needs a detached `serve`.
//   - Five branches needing a failure this repo has twice recorded as non-portable: the
//     unreadable-directory refusal, the byte probe's own catch, `loginDoorReadings`' assembly
//     failure, the archive-lagging line, and a store that cannot be asked whether it holds an id.
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

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { exportOffer } from "../../src/federation/offer.js";
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
  receiptLedger,
  sealCommitment,
  survivingTombstones,
  tombstoneTarget,
} from "../../src/gateway/erase.js";
import { frozenMembershipTerm, isSlateRecord, readSlates } from "../../src/gateway/slate.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { termClaims } from "../../src/gateway/container.js";
import {
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
 * (the store is single-writer).
 */
const VAULT = "vault";

async function ground<T>(
  home: string,
  read: (gw: Gateway) => Promise<T> | T,
  opts: { vault?: string } = {},
): Promise<T> {
  // `vault` opens the same two tiers `loam serve --archive` opens, so a fixture can put bytes on
  // BOTH and a rail can ask each of them separately. The receipt reader judges the cold tier, so
  // its rails have to be able to reach one.
  const primary = new SqliteBackend(storePath(home));
  const gw = await Gateway.boot(
    opts.vault === undefined
      ? primary
      : new MirrorBackend(primary, new ArchiveBackend(join(home, opts.vault))),
    assembleGenesis({ operatorSeed: OP_SEED }),
  );
  try {
    return await read(gw);
  } finally {
    await gw.close();
  }
}

// Damage a stored row behind the seam — swap in another delta's well-formed claims, so the row no
// longer recomputes to its own id. `deltasSince` then sets it ASIDE rather than returning it, which
// is the §25 state every reader here is blind to unless it says so. Same recipe as
// `test/cli/repair.test.ts`; the bytes stay on the disk, which is the half that matters here.
function corrupt(home: string, id: string, claims: unknown): void {
  const db = new Database(storePath(home));
  db.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run(JSON.stringify(claims), id);
  db.close();
}

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

  it("asks the tiers before calling a receipt swept, on both readers", async () => {
    const home = await noteHome("promise");
    // A TOMBSTONE IS A PROMISE, NOT A REPORT. §11 lands the receipt, purges, and only then reports a
    // tier that refused — so a receipt stands over bytes that are still on this disk whenever a
    // sweep faults mid-flight. Read from the receipt alone, both screens print a completed
    // forgetting, with a date, that nothing asked about.
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
    // THE PREMISE, asked of the tier itself: the receipt stands and the record is still held.
    expect(await ground(home, (gw) => gw.backend.holds(world.target))).toBe(true);

    expect(await run(["tombstones", "show", world.tomb, "--home", home], io()), printed()).toBe(0);
    expect(printed(), "the show screen states the sweep, not just the order").toMatch(/NOT SWEPT/);
    expect(printed()).toContain("STILL HOLDS");

    clear();
    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).toMatch(/stand over an UNFINISHED sweep/);

    // TWO-SIDED, and it is the whole rail: where the sweep really ran, both screens say SWEPT. The
    // erasure goes through the gateway call `loam erase` will wrap — this reader ships first, and a
    // rail that waited for the verb would leave the claim above unheld until then.
    // THE HOME IS NOT NAMED FOR THE WORD BEING ASSERTED. The listing prints the store PATH, so a
    // fixture directory called "swept" satisfies `toContain("swept")` on every code path — the
    // trap this file's header names, sprung by the rail that exists to catch it. The cell is read
    // off its own row instead.
    const done = await noteHome("second-home");
    const other = await ground(done, async (gw) => {
      await note(gw, "note:vera", "title", "vera-bystander-marker");
      const target = await note(gw, "note:kit", "title", "kit-erased-marker");
      await gw.erase(target.id, { reason: "kit asked" });
      return target.id;
    });
    expect(await ground(done, (gw) => gw.backend.holds(other))).toBe(false);
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
    // And the bystander is untouched by any of it, at the tier and through its Schema.
    expect(await ground(done, (gw) => gw.resolvedNode("Note", "note:vera").view["title"])).toBe(
      "vera-bystander-marker",
    );
  });
  it("asks the COLD ARCHIVE before calling a receipt swept", async () => {
    const home = await noteHome("cold-receipt");
    // THE TIER MOST LIKELY TO STILL HOLD IT. `MirrorBackend.purge` reaches both sides and reports
    // the archive's refusal AFTER the primary succeeded, so the state this fixture builds is the
    // ordinary outcome of a failed sweep: the tombstone stands, the primary is clean, and the cold
    // copy is legible. A verdict computed over the primary alone calls that row swept.
    const world = await ground(
      home,
      async (gw) => {
        const vera = await note(gw, "note:vera", "title", "vera-bystander-marker");
        const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
        return { id: kit.id, bystander: vera.id };
      },
      { vault: VAULT },
    );
    // THE REAL §11 PATH, over a gateway that never attached the vault — which is what a sweep
    // whose archive tier refused leaves behind: a standing receipt, a clean primary, a cold copy.
    await ground(home, (gw) => gw.erase(world.id, { reason: "kit asked" }));
    // THE PREMISE, at the bytes: gone from the primary, legible in the vault.
    expect(await ground(home, (gw) => gw.backend.holds(world.id))).toBe(false);
    expect(
      await ground(home, (gw) => gw.backend.holds(world.id), { vault: VAULT }),
      "the cold copy is legible",
    ).toBe(true);

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
    // THE RE-RUN THE SCREEN ADVERTISES, with the vault attached this time — the cure the
    // unfinished-sweep line names, applied. `serve` heals a cold copy back into the ground at
    // boot, so this erases the replanted delta and sweeps both tiers.
    await ground(home, (gw) => gw.erase(world.id, { reason: "kit asked, again" }), {
      vault: VAULT,
    });
    clear();
    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).not.toMatch(/UNFINISHED sweep/);
    // And the world.bystander is still in the vault, untouched by any of this.
    expect(await ground(home, (gw) => gw.backend.holds(world.bystander), { vault: VAULT })).toBe(
      true,
    );
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

  it("refuses a malformed invocation by name, on both readers", async () => {
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
      [["slate", "list", "--frobnicate", "x"], /--frobnicate/],
      [["tombstones", "list", "--frobnicate", "x"], /--frobnicate/],
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
