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
import { withStamp } from "../../src/gateway/stamp.js";
import { receiptLedger, sealCommitment } from "../../src/gateway/erase.js";
import {
  CTX_ERASE,
  eraseClaims,
  ERASE_ENTITY,
  ERASURE_NON_CLAIMS,
  ESM_RESIDENCY_DISCLOSURE,
  standingErasures,
  erasureTarget,
  UNSWEPT_AUTH_SURFACES,
} from "../../src/gateway/erase-law.js";
import { frozenMembershipTerm } from "../../src/gateway/slate.js";
import { isSlateRecord, readSlates } from "../../src/gateway/slate-law.js";
import { exportOffer } from "../../src/federation/offer.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { admitLocal, openHostPeer } from "../../src/gateway/peer-admission.js";
import type { ScryptParams } from "../../src/server/credentials.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { termClaims } from "../../src/gateway/container-law.js";
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

vi.setConfig({ testTimeout: 60_000 });

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

const short = (id: string): string => `${id.slice(0, 12)}…`;

const ABSENT = "\u2014";

async function noteHome(name: string): Promise<string> {
  const home = join(root, name);
  expect(await run(["init", "--home", home, "--seed", OP_SEED], io()), printed()).toBe(0);
  expect(await run(["register", "--stock", "note", "--home", home], io()), printed()).toBe(0);
  clear();
  return home;
}

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

function corrupt(home: string, id: string, claims: unknown): void {
  const db = new Database(storePath(home));
  db.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run(JSON.stringify(claims), id);
  db.close();
}

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : [],
  );

const holdsIn = (dir: string, needle: string): boolean =>
  existsSync(dir) && filesUnder(dir).some((f) => readFileSync(f).includes(needle));

const homeHolds = (home: string, needle: string): boolean => holdsIn(home, needle);
const vaultHolds = (home: string, needle: string): boolean => holdsIn(join(home, VAULT), needle);
const poolsHold = (home: string, needle: string): boolean =>
  holdsIn(join(home, "channels"), needle);
const primaryHolds = (home: string, needle: string): boolean =>
  [storePath(home), `${storePath(home)}-wal`]
    .filter((f) => existsSync(f))
    .some((f) => readFileSync(f).includes(needle));

async function deltaCount(home: string): Promise<number> {
  const backend = new SqliteBackend(storePath(home));
  try {
    return (await backend.deltasSince(new Set())).length;
  } finally {
    await backend.close();
  }
}

const CHEAP_SCRYPT: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
const password = (value: string) => ({
  readSecret: () => Promise.resolve(value),
  scrypt: CHEAP_SCRYPT,
});

const SUBJECT_SEED = "5c".repeat(32);
const SUBJECT = authorForSeed(SUBJECT_SEED);

async function note(gw: Gateway, entity: string, field: string, marker: string): Promise<Delta> {
  await gw.mutateEntity("Note", entity, { [field]: marker });
  return carrying(gw, marker);
}

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

const grantWrite = (gw: Gateway, subject: string): Promise<unknown> =>
  gw.append([
    signClaims(
      withStamp(gw.stamp(OP), (t) => grantClaims(STORE_ENTITY, subject, "write", OP, t)),
      OP_SEED,
    ),
  ]);

function carrying(gw: Gateway, marker: string): Delta {
  const hits = [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === marker),
  );
  expect(hits, `expected exactly one delta carrying ${marker}`).toHaveLength(1);
  return hits[0]!;
}

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

function twoWayRegistration(name: string): string {
  const file = join(root, `${name}.json`);
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

    const held = await ground(home, (gw) => {
      const records = [...gw.reactor.snapshot()].filter(
        (d) => isSlateRecord(d.claims) && d.claims.author === OP,
      );
      expect(records).toHaveLength(1);
      const slates = readSlates(gw.reactor, gw.validityNow(), OP, Date.now());
      expect(slates).toHaveLength(1);
      return { record: records[0]!.id, slate: slates[0]! };
    });
    expect(held.slate.version).toBe(stood.version);
    expect(held.slate.members.size).toBe(3);

    clear();
    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    const block = blockFor(printed(), "container:slate:kit");
    expect(block).toContain("subject:kit");
    expect(block).toContain(new Date(REQUESTED_AT).toISOString());
    expect(block).toContain(new Date(DEADLINE).toISOString());
    expect(block).toContain(stood.version);
    expect(block).toContain("3 deltas");
    expect(block).toContain(held.record);
    expect(block).toContain(stood.membershipAt);
    expect(block).toContain("kit asked to be forgotten");
    expect(block).toMatch(/closes\s+cite, egress — enforcing cite, egress/);
    expect(block).not.toMatch(/UNRESOLVED/);
    expect(block).not.toMatch(/DISAGREEMENT/);
    expect(block).not.toMatch(/UNKNOWN/);
    expect(block).not.toMatch(/LAPSED/);
    expect(block).toMatch(/plain/);
    expect(block).not.toMatch(/sealed/);
  });

  it("calls a sealed subject a commitment, and never a name", async () => {
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

    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    const empty = printed();
    expect(empty).toMatch(/no slates?/i);
    expect(empty).not.toMatch(/deadline/i);
    expect(empty).not.toMatch(/requested by/i);
    expect(
      await ground(home, (gw) => readSlates(gw.reactor, gw.validityNow(), OP, Date.now()).length),
    ).toBe(0);

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
    const world = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const strike = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, claim.id)),
        OP_SEED,
      );
      await gw.append([strike]);
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
    expect(block).toContain(world.claim);
    expect(block, printed()).not.toContain("container:wall:quill");
  });

  it("calls an unreadable condemned set UNKNOWN, and never zero", async () => {
    const home = await noteHome("unreadable");
    const stood = await ground(home, async (gw) => {
      const member = await note(gw, "note:kit", "title", "kit-condemned-marker");
      return standSlate(gw, {
        container: "container:slate:kit",
        members: [member],
        closes: ["egress", "cite"],
      });
    });
    const db = new Database(storePath(home));
    db.prepare("DELETE FROM deltas WHERE id = ?").run(stood.membershipAt);
    db.close();

    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed().split("\n")[0]).toMatch(/1 slate over .* — 1 closing no door/);
    const block = blockFor(printed(), "container:slate:kit");
    expect(block).toMatch(/condemned\s+UNKNOWN/);
    expect(block).not.toMatch(/condemned\s+0 delta/);
    expect(block).toContain(stood.version);
    expect(block).toMatch(/UNRESOLVED/);
    expect(block).toMatch(/enforcing none/);
  });

  it("reports a container re-declared elsewhere without obeying it", async () => {
    const home = await noteHome("moved");
    const stood = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-condemned-marker");
      const vera = await note(gw, "note:vera", "title", "vera-bystander-marker");
      const s = await standSlate(gw, {
        container: "container:slate:kit",
        members: [kit],
        closes: ["egress"],
      });
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
    expect(block).toContain(walls[0]!);
    expect(block).toContain(walls[7]!);
    expect(block).not.toContain(walls[8]!);
    expect(block).toContain("and 1 more");
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
    expect(printed().split("\n")[0]).toMatch(/2 slates over .* — 1 past deadline/);
    const kitBlock = blockFor(printed(), "container:slate:kit");
    const nibBlock = blockFor(printed(), "container:slate:nib");

    expect(kitBlock).toContain("subject:kit");
    expect(kitBlock).not.toContain("subject:nib");
    expect(kitBlock).toContain(stood.standing.version);
    expect(kitBlock).not.toContain(stood.lapsed.version);
    expect(nibBlock).toContain("subject:nib");
    expect(nibBlock).not.toContain("subject:kit");
    expect(nibBlock).toContain(stood.lapsed.version);

    expect(nibBlock).toMatch(/LAPSED, so `read` is closed too/);
    expect(kitBlock).not.toMatch(/lapsed/i);
  });

  it("points a lapsed slate with an unreadable set at the UNRESOLVED row", async () => {
    const home = await noteHome("lapsed-unreadable");
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
    expect(block).toMatch(/^\s+UNRESOLVED/m);
    expect(block).not.toMatch(/condemned set is EMPTY/);
  });

  it("blames the right cause when a lapsed slate closes no door", async () => {
    const home = await noteHome("empty-set");
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
    expect(block).toMatch(/condemned\s+0 delta/);
    expect(block).toMatch(/condemned set is EMPTY/);
    expect(block).not.toMatch(/see UNRESOLVED below/);
    expect(block).not.toMatch(/^\s+UNRESOLVED/m);
  });
});

describe("T206 (d) — `loam erasures` reads the receipt, never the record", () => {
  it("shows who ordered it, whose record it was, when, and why — and none of the content", async () => {
    const home = await noteHome("receipt");
    const forgotten = await ground(home, async (gw) => {
      await grantWrite(gw, SUBJECT);
      const target = await noteAs(gw, "note:kit", "title", "kit-erased-marker", SUBJECT_SEED);
      expect(target.claims.author).toBe(SUBJECT);
      expect(JSON.stringify(target.claims)).toContain("kit-erased-marker");
      const receipt = await gw.erase(target.id, { reason: "kit asked, under article 17" });
      return { target: target.id, ...receipt };
    });
    expect(forgotten.spokenBy).toBe(SUBJECT);

    const tombs = await ground(home, (gw) => standingErasures(gw.reactor, gw.validityNow(), OP));
    expect(tombs).toHaveLength(1);
    expect(erasureTarget(tombs[0]!.claims)).toBe(forgotten.target);
    expect(tombs[0]!.id).toBe(forgotten.erasure);

    clear();
    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    expect(listing).toContain(short(forgotten.target));
    expect(listing).toContain(short(forgotten.erasure));
    expect(listing).toContain("kit asked, under article 17");
    expect(listing).not.toContain("kit-erased-marker");
    expect(listing).toMatch(/remembers THAT it forgot these ids, never what they said/);
    expect(listing).toMatch(/1 receipt in/);
    const listedRow = listing.split("\n").find((l) => l.includes(short(forgotten.erasure)));
    expect(listedRow, listing).toContain(SUBJECT.slice(0, 20));
    expect(listedRow).toContain("kit asked, under article 17");

    clear();
    expect(await run(["tombstones", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).toBe(listing);

    clear();
    expect(
      await run(["erasures", "show", forgotten.erasure, "--home", home], io()),
      printed(),
    ).toBe(0);
    const shown = printed();
    expect(shown).toContain(forgotten.erasure);
    expect(shown).toContain(forgotten.target);
    expect(shown).toContain(new Date(tombs[0]!.claims.timestamp).toISOString());
    const lineOf = (label: string): string =>
      shown.split("\n").find((l) => l.trimStart().startsWith(label)) ?? "";
    expect(lineOf("spoken by"), shown).toContain(SUBJECT);
    expect(lineOf("spoken by")).not.toContain(OP);
    expect(lineOf("ordered by"), shown).toContain(OP);
    expect(lineOf("ordered by")).not.toContain(SUBJECT);
    expect(lineOf("ordered by")).toMatch(/admits no other signer/);
    expect(shown).toContain("kit asked, under article 17");
    expect(shown).not.toContain("kit-erased-marker");
    expect(shown).toMatch(/remembers THAT this id was forgotten, and none of what it said/);
    const reasonLine = lineOf("reason");
    expect(reasonLine, shown).toContain("kit asked, under article 17");
    expect(reasonLine).not.toContain("ed25519:");
    expect(
      await ground(
        home,
        (gw) => receiptLedger(gw.reactor, gw.validityNow(), OP).receipts[0]!.reasons,
      ),
    ).toEqual(["kit asked, under article 17"]);

    clear();
    expect(await run(["erasures", "show", forgotten.target, "--home", home], io()), printed()).toBe(
      0,
    );
    expect(printed()).toContain(forgotten.erasure);
    expect(printed()).not.toContain("kit-erased-marker");
  });

  it("a negated receipt leaves the listing and is COUNTED, while a named live one stays", async () => {
    const home = await noteHome("home-b");
    const both = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
      const vera = await note(gw, "note:vera", "title", "vera-erased-marker");
      const kept = await gw.erase(kit.id, { reason: "kit asked" });
      const negated = await gw.erase(vera.id, { reason: "vera asked" });
      await gw.append([
        signClaims(
          withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, negated.erasure)),
          OP_SEED,
        ),
      ]);
      return { kept, negated };
    });

    const surviving = await ground(home, (gw) =>
      standingErasures(gw.reactor, gw.validityNow(), OP).map((d) => d.id),
    );
    expect(surviving).toEqual([both.kept.erasure]);

    clear();
    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    expect(listing).toContain(short(both.kept.erasure));
    expect(listing).not.toContain(short(both.negated.erasure));
    expect(listing).toMatch(/\b1 more receipt\b[^\n]*not bind/);
  });

  it("names the cut a receipt belonged to, and stays silent about one for a lone erasure", async () => {
    const home = await noteHome("joined");
    const both = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
      const vera = await note(gw, "note:vera", "title", "vera-erased-marker");
      return {
        cut: await gw.erase(kit.id, { reason: "kit asked", slate: "container:slate:kit" }),
        lone: await gw.erase(vera.id, { reason: "vera asked" }),
      };
    });

    expect(await run(["erasures", "show", both.cut.erasure, "--home", home], io())).toBe(0);
    expect(printed()).toContain("container:slate:kit");
    expect(printed()).toMatch(/one member of that cut/);
    clear();
    expect(await run(["erasures", "show", both.lone.erasure, "--home", home], io())).toBe(0);
    expect(printed()).not.toContain("container:slate:");
  });

  it("orders two receipts sharing one moment by their addresses, so one store reads one way", async () => {
    const home = await noteHome("ordered");
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

    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    const first = listing.indexOf(short(pair[0]!));
    const second = listing.indexOf(short(pair[1]!));
    expect(first, printed()).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(second);
  });

  it("keeps every reason a receipt carries, and says plainly when it carries none", async () => {
    const home = await noteHome("reasons");
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

    const held = await ground(
      home,
      (gw) => receiptLedger(gw.reactor, gw.validityNow(), OP).receipts,
    );
    expect(held.find((r) => r.erasure === both.many)!.reasons).toEqual([
      "kit asked in March",
      "and again in April",
    ]);
    expect(held.find((r) => r.erasure === both.none)!.reasons).toEqual([]);

    expect(await run(["erasures", "show", both.many, "--home", home], io()), printed()).toBe(0);
    expect(printed()).toContain("kit asked in March");
    expect(printed()).toContain("and again in April");
    clear();
    expect(await run(["erasures", "show", both.none, "--home", home], io()), printed()).toBe(0);
    expect(printed()).toMatch(/none recorded/i);
  });

  it("refuses an id no surviving receipt names, and says what would show one", async () => {
    const home = await noteHome("absent");
    const stranger = "b".repeat(64);
    expect(await run(["erasures", "show", stranger, "--home", home], io())).toBe(1);
    expect(printed()).toContain(stranger);
    expect(printed()).toContain("erasures list");
    expect(printed()).not.toMatch(/do not bind|does not bind/);
  });

  it("does not tell a negated id it was never forgotten", async () => {
    const home = await noteHome("pardoned");
    const negated = await ground(home, async (gw) => {
      const target = await note(gw, "note:kit", "title", "kit-erased-marker");
      const receipt = await gw.erase(target.id, { reason: "kit asked" });
      await gw.append([
        signClaims(
          withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, receipt.erasure)),
          OP_SEED,
        ),
      ]);
      return { erased: target.id, erasure: receipt.erasure };
    });

    expect(await run(["erasures", "show", negated.erased, "--home", home], io())).toBe(1);
    const said = printed();
    expect(said).toMatch(/1 receipt here does not bind/);
    expect(said).toMatch(/negated/i);
    expect(said).toMatch(/not as an id this store is currently forgetting/);
  });

  it("prints the receipts oldest first, by the moment each was recorded", async () => {
    const home = await noteHome("chronology");
    const both = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
      const vera = await note(gw, "note:vera", "title", "vera-erased-marker");
      const first = await gw.erase(kit.id, { reason: "kit asked in March" });
      const second = await gw.erase(vera.id, { reason: "vera asked in April" });
      return { first, second };
    });
    const at = await ground(home, (gw) =>
      receiptLedger(gw.reactor, gw.validityNow(), OP).receipts.map((r) => r.at),
    );
    expect(at[0]!, "the fixture must span two moments").toBeLessThan(at[1]!);

    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    const listing = printed();
    expect(listing.indexOf(short(both.first.erasure))).toBeLessThan(
      listing.indexOf(short(both.second.erasure)),
    );
  });

  it("states the absence when a receipt does not record whose record it forgot", async () => {
    const home = await noteHome("anonymous");
    const tomb = await ground(home, async (gw) => {
      const target = await note(gw, "note:kit", "title", "kit-erased-marker");
      return { target: target.id, author: target.claims.author };
    });
    const bare = signClaims(
      {
        timestamp: 9_500_000,
        validFrom: 9_500_000,
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
    const { peer } = await openHostPeer(backend.journalStore(), OP);
    await admitLocal(peer, [bare], 9_500_000, () => false);
    await backend.close();

    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    const row = printed()
      .split("\n")
      .find((l) => l.includes(short(bare.id)));
    expect(row, printed()).toContain(ABSENT);
    clear();
    expect(await run(["erasures", "show", bare.id, "--home", home], io()), printed()).toBe(0);
    expect(printed()).toMatch(/does not record whose record it forgot/);
    expect(printed()).toContain("an older store wrote this");
  });

  it("declares the §25 rows it never saw, on both readers", async () => {
    const home = await noteHome("pen");
    const world = await ground(home, async (gw) => {
      const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
      const vera = await note(gw, "note:vera", "title", "vera-bystander-marker");
      const receipt = await gw.erase(kit.id, { reason: "kit asked" });
      return { vera: vera.id, veraClaims: claimsToJson(vera.claims), receipt };
    });
    corrupt(home, world.vera, JSON.stringify({ not: "claims at all" }));

    for (const verb of [
      ["erasures", "list"],
      ["slate", "list"],
    ]) {
      clear();
      expect(await run([...verb, "--home", home], io()), printed()).toBe(0);
      expect(printed(), verb.join(" ")).toMatch(/quarantine/i);
      expect(printed()).toContain("repair list");
      expect(out.join("\n"), verb.join(" ")).toMatch(/quarantine/i);
    }

    const clean = await noteHome("clean-pen");
    for (const verb of [
      ["erasures", "list"],
      ["slate", "list"],
    ]) {
      clear();
      expect(await run([...verb, "--home", clean], io()), printed()).toBe(0);
      expect(printed(), verb.join(" ")).not.toMatch(/quarantine/i);
    }
  });

  it("asks the tiers before calling a receipt swept, on both readers", async () => {
    const home = await noteHome("promise");
    const world = await ground(home, async (gw) => {
      const target = await note(gw, "note:kit", "title", "kit-erased-marker");
      await note(gw, "note:vera", "title", "vera-bystander-marker");
      const tomb = signClaims(
        withStamp(gw.stamp(OP), (t) =>
          eraseClaims(target.id, target.claims.author, OP, t, "kit asked"),
        ),
        OP_SEED,
      );
      vi.spyOn(gw.backend, "purge").mockRejectedValueOnce(new Error("the disk refused the purge"));
      await gw.append([tomb]);
      return { target: target.id, tomb: tomb.id };
    });
    expect(homeHolds(home, "kit-erased-marker")).toBe(true);

    expect(await run(["erasures", "show", world.tomb, "--home", home], io()), printed()).toBe(0);
    expect(printed(), "the show screen states the sweep, not just the order").toMatch(/NOT SWEPT/);
    expect(printed()).toContain("STILL HOLDS");

    clear();
    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).toMatch(/stand over an UNFINISHED sweep/);

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
    expect(await run(["erasures", "list", "--home", done], io()), printed()).toBe(0);
    const row = printed()
      .split("\n")
      .find((l) => l.includes(short(other)));
    expect(row, printed()).toContain("swept");
    expect(printed()).not.toMatch(/UNFINISHED sweep/);

    clear();
    expect(await run(["erasures", "show", other, "--home", done], io()), printed()).toBe(0);
    expect(printed()).toContain("swept — no tier this run opened still holds it");
    expect(printed()).not.toMatch(/NOT SWEPT|UNPROVEN|NOT SETTLED/);

    expect(homeHolds(done, "vera-bystander-marker")).toBe(true);
  });

  it("asks the COLD ARCHIVE before calling a receipt swept", async () => {
    const home = await noteHome("cold-receipt");
    const target = await ground(
      home,
      async (gw) => {
        await note(gw, "note:vera", "title", "vera-bystander-marker");
        return (await note(gw, "note:kit", "title", "kit-erased-marker")).id;
      },
      { vault: VAULT },
    );
    await ground(home, (gw) => gw.erase(target, { reason: "kit asked" }));
    expect(primaryHolds(home, "kit-erased-marker")).toBe(false);
    expect(vaultHolds(home, "kit-erased-marker")).toBe(true);

    const config = join(home, "config.json");
    writeFileSync(
      config,
      JSON.stringify({ ...JSON.parse(readFileSync(config, "utf8")), archive: VAULT }),
    );

    clear();
    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed(), "the cold copy is not swept").toMatch(/stand over an UNFINISHED sweep/);
    expect(printed()).toContain(join(home, VAULT));

    for (const file of filesUnder(join(home, VAULT))) {
      if (readFileSync(file).includes("kit-erased-marker")) rmSync(file);
    }
    clear();
    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).not.toMatch(/UNFINISHED sweep/);
    expect(vaultHolds(home, "vera-bystander-marker")).toBe(true);
  });

  it("scopes an empty answer to the key it actually asked about", async () => {
    const home = await noteHome("scoped");
    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).toContain(OP.slice(0, 20));
    clear();
    expect(await run(["slate", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).toContain(OP.slice(0, 20));
  });

  it("refuses a malformed invocation by name, on every one of the three verbs", async () => {
    const home = await noteHome("usage");
    for (const [args, needle] of [
      [["slate"], /wants a subcommand/],
      [["slate", "cut"], /there is no `slate cut`/],
      [["slate", "list", "extra"], /takes no arguments/],
      [["erasures"], /wants a subcommand/],
      [["erasures", "purge"], /there is no `erasures purge`/],
      [["erasures", "show"], /wants an id/],
      [["erasures", "show", "a", "b"], /exactly one id/],
      [["erase"], /wants the id of one delta/],
      [["erase", "a", "b", "--reason", "x"], /exactly one delta id/],
      [["slate", "list", "--frobnicate", "x"], /--frobnicate/],
      [["erasures", "list", "--frobnicate", "x"], /--frobnicate/],
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
      ["erasures", "list"],
      ["slate", "list"],
    ]) {
      clear();
      expect(await run([...verb, "--home", bare], io()), printed()).toBe(1);
      expect(printed()).toMatch(/operator/i);
      expect(err, printed()).toHaveLength(1);
    }
  });

  it("says plainly that nothing has been forgotten, and the same store speaks after one erasure", async () => {
    const home = await noteHome("nothing");

    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    const empty = printed();
    expect(empty).toMatch(/forgotten nothing|no .*receipt/i);
    expect(empty).not.toMatch(/reason/i);

    const receipt = await ground(home, async (gw) => {
      const target = await note(gw, "note:quill", "title", "quill-erased-marker");
      return gw.erase(target.id, { reason: "quill asked" });
    });
    clear();
    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).toContain(short(receipt.erasure));
    expect(printed()).toContain("quill asked");

    clear();
    expect(
      await run(["erasures", "list", "--home", home, "--store", "elsewhere.sqlite"], io()),
      printed(),
    ).toBe(0);
    expect(printed()).not.toContain(short(receipt.erasure));
    expect(printed()).toMatch(/forgotten nothing|no .*receipt/i);
  });
});

describe("T206 (b) — `loam erase` removes the bytes at every local tier", () => {
  it("sweeps the primary AND the archive, prints the receipt, and leaves a named bystander whole", async () => {
    const home = await noteHome("swept");
    const target = await ground(
      home,
      async (gw) => {
        await grantWrite(gw, SUBJECT);
        const kit = await noteAs(gw, "note:kit", "title", "kit-erased-marker", SUBJECT_SEED);
        await note(gw, "note:vera", "title", "vera-bystander-marker");
        return kit.id;
      },
      { vault: VAULT },
    );
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

    const receipts = await ground(
      home,
      (gw) => receiptLedger(gw.reactor, gw.validityNow(), OP).receipts,
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.erased).toBe(target);
    expect(said).toContain(receipts[0]!.erasure);
    expect(said).toContain("kit asked, under article 17");
    const sweptLine = said.split("\n").find((l) => l.includes("asked tier by tier"));
    expect(sweptLine, said).toContain(join(home, VAULT));
    const spokenLine = said.split("\n").find((l) => l.trimStart().startsWith("spoken by"));
    expect(spokenLine, said).toContain(SUBJECT);
    expect(spokenLine).not.toContain(OP);

    expect(homeHolds(home, "kit-erased-marker"), "the erased bytes are still at rest").toBe(false);
    expect(primaryHolds(home, "vera-bystander-marker")).toBe(true);
    expect(vaultHolds(home, "vera-bystander-marker")).toBe(true);

    const views = await ground(home, (gw) => ({
      kit: gw.resolvedNode("Note", "note:kit").view["title"],
      vera: gw.resolvedNode("Note", "note:vera").view["title"],
    }));
    expect(views.vera).toBe("vera-bystander-marker");
    expect(views.kit).toBeUndefined();

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
    expect(ERASURE_NON_CLAIMS).toHaveLength(4);
    expect(UNSWEPT_AUTH_SURFACES).toHaveLength(3);
    expect(ESM_RESIDENCY_DISCLOSURE).toHaveLength(1);

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

    expect(said).toMatch(/is invisible to the probe that cleared this run/);
    expect(said).toMatch(/ABSOLUTE path outside/);

    expect(said).not.toMatch(/still HELD/);
    expect(said).not.toMatch(/BROUGHT \d+ CLAIM\(S\) BACK|live again/);
    expect(said).not.toMatch(/REOPENED/);
    expect(said).not.toMatch(/NOW MASK DIFFERENTLY/);
    expect(said).not.toMatch(/AS-OF door was not read/);
    expect(said).not.toMatch(/channel read door/);
    expect(said).not.toMatch(/could not be consulted/);
  });

  it("enumerates the surviving deltas left pointing at the hole", async () => {
    const home = await noteHome("cited");
    const world = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-erased-marker");
      const strike = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, claim.id)),
        OP_SEED,
      );
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

  it("names a revival when the negation lived in a channel's pool as well", async () => {
    const peer = await noteHome("revival-peer");
    const offer = join(root, "revival-offer.json");
    const world = await ground(peer, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const strike = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, claim.id)),
        OP_SEED,
      );
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
        ["erase", world.strike, "--reason", "the negation was filed in error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    expect(printed()).toMatch(/BROUGHT 1 CLAIM\(S\) BACK/);
    expect(printed()).toContain(world.claim);
    const rows = printed()
      .split("\n")
      .filter((l) => l.includes(world.claim) && l.includes("live again"));
    expect(rows, printed()).toHaveLength(2);
    expect(rows.filter((l) => l.includes("in an attached pool"))).toHaveLength(1);
    expect(rows.filter((l) => !l.includes("in an attached pool"))).toHaveLength(1);
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
    const target = await ground(
      home,
      async (gw) => {
        const kit = await note(gw, "note:kit", "title", "kit-erased-marker");
        await note(gw, "note:vera", "title", "vera-bystander-marker");
        return kit.id;
      },
      { vault: VAULT },
    );
    cpSync(join(home, VAULT), join(home, "vault.bak"), { recursive: true });
    expect(holdsIn(join(home, "vault.bak"), "kit-erased-marker")).toBe(true);

    expect(
      await run(
        ["erase", target, "--reason", "kit asked", "--home", home, "--archive", VAULT],
        io(),
      ),
    ).toBe(1);
    expect(printed()).toContain(join(home, "vault.bak"));

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
    expect(homeHolds(home, "kit-erased-marker")).toBe(false);
    expect(holdsIn(join(home, VAULT), "vera-bystander-marker")).toBe(true);
    expect(holdsIn(join(home, "vault.bak"), "vera-bystander-marker")).toBe(true);

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
    const target = await ground(
      home,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    clear();
    expect(
      await run(["erase", target, "--reason", "kit asked", "--home", home], io()),
      printed(),
    ).toBe(0);

    const document = out.join("\n");
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
    expect(sweptLine, said).toContain(`${join(home, "ghost")} (CREATED BY THIS RUN)`);
    expect(sweptLine).not.toContain(`${join(home, VAULT)} (CREATED BY THIS RUN)`);
    expect(said).toContain("did not exist before this run and was created empty by it");
    expect(said).toContain("its line above proves nothing");
    expect(said).toContain("the archive(s) named above were swept");
    expect(said).toContain("is invisible to the probe that cleared this run");
    expect(homeHolds(home, "kit-erased-marker")).toBe(false);
    expect(vaultHolds(home, "vera-bystander-marker")).toBe(true);
  });

  it("refuses a vault the home hides one directory down, or files oddly", async () => {
    for (const [name, fan, file] of [
      ["nested", ["backup", "vault", "ab"], `ab${"5".repeat(62)}.json`],
      ["straggler", ["vault", "cd"], `cd${"9".repeat(62)}.json.4321.tmp`],
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
      expect(homeHolds(home, "kit-erased-marker")).toBe(true);
    }
  });

  it("refuses a vault reached through a symlinked fan, and one parked inside the named vault", async () => {
    const home = await noteHome("symlinked");
    const target = await ground(
      home,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    mkdirSync(join(home, "elsewhere", "ab"), { recursive: true });
    writeFileSync(join(home, "elsewhere", "ab", `ab${"5".repeat(62)}.json`), "{}");
    mkdirSync(join(home, "linked"), { recursive: true });
    symlinkSync(join(home, "elsewhere", "ab"), join(home, "linked", "ab"), "dir");

    expect(await run(["erase", target, "--reason", "kit asked", "--home", home], io())).toBe(1);
    expect(printed()).toMatch(/nothing was erased/i);
    expect(printed()).toContain(join(home, "linked"));
    expect(homeHolds(home, "kit-erased-marker")).toBe(true);

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

    clear();
    expect(await run(["erase", target, "--reason", "kit asked again", "--home", home], io())).toBe(
      1,
    );
    const receipt = await ground(
      home,
      (gw) => receiptLedger(gw.reactor, gw.validityNow(), OP).receipts[0]!,
    );
    expect(printed()).toContain(receipt.erasure);
    expect(printed()).toContain(new Date(receipt.at).toISOString());
    expect(printed()).toMatch(/ORDERED at .+ and this run asked every tier it opened/);
    expect(printed()).not.toMatch(/forgot it at/);
    expect(printed()).not.toMatch(/is NOT finished/);
    expect(
      await ground(home, (gw) => receiptLedger(gw.reactor, gw.validityNow(), OP).receipts),
    ).toHaveLength(1);
  });

  it("prints the receipt's own reason on a REUSE, and says the new one was not recorded", async () => {
    const home = await noteHome("reused-receipt");
    const world = await ground(home, async (gw) => {
      const target = await note(gw, "note:kit", "title", "kit-erased-marker");
      await note(gw, "note:vera", "title", "vera-bystander-marker");
      const tomb = signClaims(
        withStamp(gw.stamp(OP), (t) =>
          eraseClaims(target.id, target.claims.author, OP, t, "the first sentence, art. 17"),
        ),
        OP_SEED,
      );
      vi.spyOn(gw.backend, "purge").mockRejectedValueOnce(new Error("the disk refused the purge"));
      await gw.append([tomb]);
      return { target: target.id, tomb: tomb.id };
    });
    expect(homeHolds(home, "kit-erased-marker")).toBe(true);

    expect(
      await run(["erase", world.target, "--reason", "a corrected sentence", "--home", home], io()),
      printed(),
    ).toBe(0);
    const said = printed();

    const receiptLine = said.split("\n").find((l) => l.trimStart().startsWith("receipt"));
    expect(receiptLine, said).toMatch(/\(REUSED, not minted by this run\)/);
    expect(said).toMatch(/answers for THIS run only/);
    const reasonLine = said.split("\n").find((l) => l.trimStart().startsWith("reason"));
    expect(reasonLine, said).toContain("the first sentence, art. 17");
    expect(reasonLine).not.toContain("a corrected sentence");
    expect(said).toMatch(/YOUR --reason IS NOT ON THE RECEIPT/);

    const receipts = await ground(
      home,
      (gw) => receiptLedger(gw.reactor, gw.validityNow(), OP).receipts,
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.erasure).toBe(world.tomb);
    expect(receipts[0]!.reasons).toEqual(["the first sentence, art. 17"]);
    expect(homeHolds(home, "kit-erased-marker")).toBe(false);
    expect(homeHolds(home, "vera-bystander-marker")).toBe(true);
  });

  it("says a promised sweep is UNFINISHED rather than calling the record forgotten", async () => {
    const home = await noteHome("unfinished");
    const world = await ground(home, async (gw) => {
      const target = await note(gw, "note:kit", "title", "kit-erased-marker");
      const tomb = signClaims(
        withStamp(gw.stamp(OP), (t) =>
          eraseClaims(target.id, target.claims.author, OP, t, "kit asked"),
        ),
        OP_SEED,
      );
      vi.spyOn(gw.backend, "purge").mockRejectedValueOnce(new Error("the disk refused the purge"));
      await gw.append([tomb]);
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
    expect(said).toMatch(/Treat an empty answer as UNMEASURED/);
    expect(said).toMatch(/pen is EMPTY/);
    expect(said).toMatch(/EMBEDDING API and no CLI verb reaches them/);
    expect(said).toMatch(/loam federate list/);
    expect(homeHolds(home, "kit-erased-marker")).toBe(true);
  });

  it("will not call a sweep settled over a tier it could not ask", async () => {
    const home = await noteHome("unprovable");
    const target = await ground(
      home,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    expect(
      await run(["erase", target, "--reason", "kit asked", "--home", home], io()),
      printed(),
    ).toBe(0);
    expect(homeHolds(home, "kit-erased-marker")).toBe(false);

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
    expect(printed()).not.toMatch(/forgot it at/);
    expect(printed()).not.toMatch(/CANNOT SHOW/);
  });

  it("reaches a federation channel's own pool file, and spares the peer's other record", async () => {
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
    expect(printed()).toMatch(/channel read door\(s\) were not modelled/);
  });

  it("names every claim an erased NEGATION brings back to life, and the claim really returns", async () => {
    const home = await noteHome("negated-then-erased");
    const world = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const strike = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, claim.id)),
        OP_SEED,
      );
      await gw.append([strike]);
      return { claim: claim.id, strike: strike.id };
    });
    expect(
      await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"]),
    ).toBeUndefined();

    expect(
      await run(
        ["erase", world.strike, "--reason", "the negation was filed in error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    expect(printed()).toMatch(/BROUGHT 1 CLAIM\(S\) BACK/);
    expect(printed()).toContain(world.claim);
    expect(await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"])).toBe(
      "kit-retracted-marker",
    );
  });

  it("names a claim revived THREE negations down the chain, which one hop cannot see", async () => {
    const home = await noteHome("deep-chain");
    const chain = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const strikes: string[] = [];
      let target = claim.id;
      for (let i = 0; i < 3; i += 1) {
        const s = signClaims(
          withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, target)),
          OP_SEED,
        );
        await gw.append([s]);
        strikes.push(s.id);
        target = s.id;
      }
      return { claim: claim.id, s1: strikes[0]!, s2: strikes[1]!, s3: strikes[2]! };
    });
    expect(
      await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"]),
    ).toBeUndefined();

    expect(
      await run(
        ["erase", chain.s3, "--reason", "the third negation was filed in error", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    const said = printed();
    expect(said).toMatch(/BROUGHT 2 CLAIM\(S\) BACK/);
    expect(said).toContain(chain.claim);
    expect(said).toContain(chain.s2);
    expect(said).not.toContain(chain.s1);
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
    expect(
      await run(["user", "create", "ivy", "--home", home], io(), password("pw")),
      printed(),
    ).toBe(0);
    clear();

    const world = await ground(home, async (gw) => {
      await grantWrite(gw, SUBJECT);
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const byOperator = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, claim.id)),
        OP_SEED,
      );
      const bySubject = signClaims(
        withStamp(gw.stamp(SUBJECT), (t) => makeNegationClaims(SUBJECT, t, claim.id)),
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
          "the operator's negation was filed in error",
          "--home",
          home,
        ],
        io(),
      ),
      printed(),
    ).toBe(0);
    const said = printed();
    expect(said).toMatch(/BROUGHT 1 CLAIM\(S\) BACK/);
    expect(said).toContain(world.claim);
    const row = said.split("\n").find((l) => l.includes(world.claim));
    expect(row, said).toContain("LoamUser");
    expect(row).not.toContain("no trust mask");
  });

  it("names a reading REGISTERED in this store, which no hardcoded mask could know", async () => {
    const home = await noteHome("registered-mask");
    expect(
      await run(["register", ledgerRegistration("ledger"), "--home", home], io()),
      printed(),
    ).toBe(0);
    clear();

    const world = await ground(home, async (gw) => {
      await grantWrite(gw, SUBJECT);
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const strike = signClaims(
        withStamp(gw.stamp(SUBJECT), (t) => makeNegationClaims(SUBJECT, t, claim.id)),
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
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, registration.id)),
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
    const reopenedLine = printed()
      .split("\n")
      .find((l) => l.includes("REOPENED"));
    expect(reopenedLine, printed()).toMatch(/REOPENED 1 READING\(S\)/);
    expect(reopenedLine).toContain("Plain");
  });

  it("declares the §25 rows an ATTACHED POOL is holding, not the host's alone", async () => {
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
    clear();
    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed(), "the host pen is empty before the pool row is damaged").not.toMatch(
      /quarantine/i,
    );

    const pool = readdirSync(join(home, "channels")).find((f) => f.endsWith(".sqlite"))!;
    const db = new Database(join(home, "channels", pool));
    const row = db.prepare("SELECT id FROM deltas WHERE claims LIKE '%nib-pool-marker%'").get() as {
      id: string;
    };
    db.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run(
      JSON.stringify({ not: "claims at all" }),
      row.id,
    );
    db.close();

    clear();
    expect(await run(["erasures", "list", "--home", home], io()), printed()).toBe(0);
    expect(printed()).toMatch(/quarantine/i);
    expect(printed()).toContain("repair list");
  });

  it("names a reading whose MASK MOVED, and keeps a revival off its name", async () => {
    const home = await noteHome("remasked");
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
      const strike = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, definitions[1]!.id)),
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
    expect(said).toMatch(/its rule for whose negations bind moved/);
    const rows = said.split("\n").filter((l) => l.includes("live again"));
    expect(rows.length, said).toBeGreaterThan(0);
    expect(rows.join("\n"), said).toContain(`${ids.definition} — live again`);
    expect(rows.join("\n"), said).toContain("Almanac");
    for (const row of rows) expect(row, said).not.toContain("Ledger");
  });
  it("counts a reading it could NOT consult, and says the check is that much narrower", async () => {
    const home = await noteHome("unconsulted");
    expect(
      await run(["register", twoWayRegistration("twoway"), "--home", home], io()),
      printed(),
    ).toBe(0);
    clear();

    const world = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-withdrawn-marker");
      const strike = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, claim.id)),
        OP_SEED,
      );
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

    const plain = await noteHome("all-consulted");
    const other = await ground(plain, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-withdrawn-marker");
      const strike = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, claim.id)),
        OP_SEED,
      );
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
    const world = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-condemned-marker");
      const strike = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, claim.id)),
        OP_SEED,
      );
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
    const row = said.split("\n").find((l) => l.includes("live again"));
    expect(row, said).not.toContain("Note");
  });

  it("names what a SLATE'S RECORD was withholding, when that record is erased", async () => {
    const home = await noteHome("slate-record");
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

    expect(homeHolds(home, "kit asked to be forgotten")).toBe(true);

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

    const said = printed();
    expect(said).toMatch(/BROUGHT \d+ CLAIM\(S\) BACK/);
    expect(said, "the reopened member is named by id").toContain(world.condemned);

    expect(await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"])).toBe(
      "kit-condemned-marker",
    );

    expect(homeHolds(home, "kit asked to be forgotten")).toBe(false);
    expect(homeHolds(home, "vera-bystander-marker")).toBe(true);
    expect(await ground(home, (gw) => gw.resolvedNode("Note", "note:vera").view["title"])).toBe(
      "vera-bystander-marker",
    );

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
      const strike = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, second[0]!.id)),
        OP_SEED,
      );
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
    const line = said.split("\n").find((l) => l.includes("REOPENED"))!;
    expect(line, said).toContain("Film");
    expect(line).not.toContain("Note");
    expect(line).not.toContain("\u0000");
    expect(line).not.toContain("hyperschema:");
  });

  it("names a reading this erasure REOPENED, and says its claims were not compared", async () => {
    const home = await noteHome("reopened");
    expect(
      await run(["register", ledgerRegistration("reopened-ledger"), "--home", home], io()),
      printed(),
    ).toBe(0);
    clear();

    const ids = await ground(home, async (gw) => {
      const registration = [...gw.reactor.snapshot()].find((d) =>
        JSON.stringify(d.claims).includes("Ledger"),
      )!;
      const strike = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, registration.id)),
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
    expect(printed()).toMatch(/REOPENED \d+ READING\(S\)/);
    expect(printed()).toContain("Ledger");
    expect(printed()).toMatch(/had no BEFORE|did not look/);
  });

  it("sees a revival a GRANTEE's negation caused, which the trust mask alone cannot", async () => {
    const home = await noteHome("grantee-negation");
    const world = await ground(home, async (gw) => {
      const grant = signClaims(
        withStamp(gw.stamp(OP), (t) => grantClaims(STORE_ENTITY, SUBJECT, "write", OP, t)),
        OP_SEED,
      );
      await gw.append([grant]);
      const claim = await noteAs(gw, "note:kit", "title", "kit-retracted-marker", SUBJECT_SEED);
      const strike = signClaims(
        withStamp(gw.stamp(SUBJECT), (t) => makeNegationClaims(SUBJECT, t, claim.id)),
        SUBJECT_SEED,
      );
      await gw.append([strike]);
      expect(strike.claims.author).toBe(SUBJECT);
      await gw.append([
        signClaims(
          withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, grant.id)),
          OP_SEED,
        ),
      ]);
      return { claim: claim.id, strike: strike.id };
    });
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
    expect(said).toMatch(/drop|anonymous door/);
    expect(await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"])).toBe(
      "kit-retracted-marker",
    );
  });

  it("claims no revival when a second negation still withdraws the claim", async () => {
    const home = await noteHome("two-negations");
    const world = await ground(home, async (gw) => {
      const claim = await note(gw, "note:kit", "title", "kit-retracted-marker");
      const first = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, claim.id)),
        OP_SEED,
      );
      const second = signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, claim.id)),
        OP_SEED,
      );
      await gw.append([first, second]);
      return { claim: claim.id, first: first.id };
    });

    expect(
      await run(
        ["erase", world.first, "--reason", "one negation was a duplicate", "--home", home],
        io(),
      ),
      printed(),
    ).toBe(0);
    expect(printed()).not.toMatch(/BROUGHT \d+ CLAIM\(S\) BACK|live again/);
    expect(printed()).not.toContain(world.claim);
    expect(printed()).toMatch(/AS-OF door was not read/);
    expect(
      await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"]),
    ).toBeUndefined();
  });

  it("says nothing about revivals when an ordinary claim is erased", async () => {
    const home = await noteHome("plain-erased");
    const target = await ground(
      home,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
    );
    expect(
      await run(["erase", target, "--reason", "kit asked", "--home", home], io()),
      printed(),
    ).toBe(0);
    expect(printed()).not.toMatch(/BROUGHT \d+ CLAIM\(S\) BACK|live again/);
    expect(printed()).toMatch(/NO cold archive was consulted/);
    expect(printed()).toMatch(/only looked inside/);
  });

  it("refuses when the home owns a cold archive this command was not told about", async () => {
    const home = await noteHome("silent-vault");
    const target = await ground(
      home,
      async (gw) => (await note(gw, "note:kit", "title", "kit-erased-marker")).id,
      { vault: VAULT },
    );
    expect(vaultHolds(home, "kit-erased-marker")).toBe(true);

    expect(await run(["erase", target, "--reason", "kit asked", "--home", home], io())).toBe(1);
    expect(printed()).toContain(join(home, VAULT));
    expect(printed()).toMatch(/nothing was erased/i);
    expect(primaryHolds(home, "kit-erased-marker")).toBe(true);
    expect(vaultHolds(home, "kit-erased-marker")).toBe(true);
    expect(
      await ground(home, (gw) => receiptLedger(gw.reactor, gw.validityNow(), OP).receipts),
    ).toHaveLength(0);

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
    corrupt(home, world.kit, world.veraClaims);
    expect(primaryHolds(home, "vera-bystander-marker")).toBe(true);

    expect(await run(["erase", world.kit, "--reason", "kit asked", "--home", home], io())).toBe(1);
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
      ["erase", target, "--home", home],
      ["erase", target, "--reason", "   ", "--home", home],
    ]) {
      clear();
      expect(await run(args, io()), printed()).toBe(2);
      expect(printed()).toContain("--reason");
      expect(printed()).toMatch(/nothing was erased/i);
    }

    expect(homeHolds(home, "kit-erased-marker")).toBe(true);
    expect(await deltaCount(home)).toBe(before);
    expect(
      await ground(home, (gw) => receiptLedger(gw.reactor, gw.validityNow(), OP).receipts),
    ).toHaveLength(0);
    expect(await ground(home, (gw) => gw.resolvedNode("Note", "note:kit").view["title"])).toBe(
      "kit-erased-marker",
    );

    clear();
    expect(
      await run(["erase", target, "--reason", "kit asked", "--home", home], io()),
      printed(),
    ).toBe(0);
    expect(homeHolds(home, "kit-erased-marker")).toBe(false);
  });

  it("marks --reason as required in its own help", async () => {
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
