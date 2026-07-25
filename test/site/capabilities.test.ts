// The capabilities book's anti-rot rail (T95). The page renders `demos/capabilities/chapters.mjs`
// and this suite asserts against the same module — the book and this test share one text, the same
// identity `arc.test.ts` relies on for the tutorial.
//
// The load-bearing assertion is COVERAGE, not citation. Checking that a cited path exists only
// catches a claim that already rotted; what keeps the book current is the other direction — every
// file in `spec/` must be claimed by exactly one chapter, so a landing that adds `spec/32-*.md`
// turns this suite RED. And because a bare `covers` string would green that with nothing a reader
// can see, a covered section must also be CITED by one of its chapter's own claims, which renders
// as a visible row. The cheapest way to satisfy a landing is therefore to write a promise about it.
//
// Read the anti-vacuity assertions as part of the mechanism rather than as padding. Almost every
// check here is `expect(filtered).toEqual([])` over an array derived from the book, and every one of
// those passes when the book is EMPTY: no claims, no terms, no figures, no proofs. So each family
// carries a floor, and the unproven-promise count carries a CAP — because the citation checks are
// all guarded on `claim.proof` being truthy, and without a cap the whole receipts idea could be
// deleted by setting every proof to null under a green bar.
//
// What this suite deliberately does NOT assert: that a chapter's prose is TRUE. No test can read
// English, and a claim whose cited test proves something merely ADJACENT passes here. That gap is
// closed by an independent reader at P5, not by this file. What it does assert is that every promise
// is backed by a test that can go red, that an unproven promise admits it in prose the page shows,
// that every door and every real-name term resolves in the shipped surface, and that a gap the book
// says is open still has a live ticket. A sentence can be wrong; it cannot silently lose its
// backing.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAPTERS, TERMS, termIndex } from "../../demos/capabilities/chapters.mjs";
import { FIGURES } from "../../demos/capabilities/figure-set.mjs";
import * as surface from "../../src/index.js";

const root = process.cwd();
const specFiles = readdirSync(join(root, "spec"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => `spec/${f}`)
  .sort();

const allClaims = CHAPTERS.flatMap((ch) =>
  ch.body
    .filter((b): b is Extract<typeof b, { kind: "claims" }> => b.kind === "claims")
    .flatMap((b) => b.claims.map((c) => ({ chapter: ch, claim: c }))),
);

/**
 * Every string a reader will see, so the term rail cannot be dodged by moving prose around. A
 * claim's `gap` counts: it is prose, it renders under the promise it excuses, and leaving it out
 * here once meant nine paragraphs of the book were linted by nothing.
 */
const allText = CHAPTERS.flatMap((ch) => [
  ch.title,
  ch.thesis,
  ...ch.body.flatMap((b) => {
    if (b.kind === "prose" || b.kind === "heading") return [b.text];
    if (b.kind === "figure") return b.caption ? [b.caption] : [];
    if (b.kind === "claims") return b.claims.flatMap((c) => [c.says, ...(c.gap ? [c.gap] : [])]);
    return b.items;
  }),
]);

/**
 * The names `src/index.ts` exports, VALUES AND TYPES. `Object.keys` on the namespace sees runtime
 * values only, and a type-only export is exactly how the word this rail guards would arrive: the
 * hazard is `export type { Lens }` landing while the book still calls "lens" our own word. So the
 * type half is read out of the barrel's source, and the comparison downstream is case-insensitive,
 * because `Lens` colliding with `lens` is the collision.
 */
const exportedNames = (): { values: Set<string>; all: Set<string> } => {
  const values = new Set(Object.keys(surface));
  const src = readFileSync(join(root, "src", "index.ts"), "utf8");
  const types = new Set<string>();
  for (const m of src.matchAll(/export\s+type\s*\{([^}]*)\}/g)) {
    for (const piece of (m[1] ?? "").split(",")) {
      const name = piece
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) types.add(name);
    }
  }
  for (const m of src.matchAll(/^\s*(?:export\s+)?type\s+(\w+)/gm)) if (m[1]) types.add(m[1]);
  return { values, all: new Set([...values, ...types]) };
};

describe("the capabilities book covers the spec", () => {
  it("claims every section in spec/, so a new landing cannot leave the book behind", () => {
    const covered = new Set(CHAPTERS.flatMap((ch) => ch.covers));
    const uncovered = specFiles.filter((f) => !covered.has(f));
    expect(
      uncovered,
      `no chapter claims these spec sections — the book is behind the spec:\n  ${uncovered.join("\n  ")}`,
    ).toEqual([]);
  });

  it("says something about every section it claims — a covers entry is not a write-up", () => {
    // The coverage rail above is satisfied by appending one string to one chapter's `covers`, which
    // greens a new spec section with nothing a reader can see. So bind the two together: a section a
    // chapter claims must be cited by at least one of that chapter's own claims, and a claim renders
    // as a visible row. Now the cheapest way to green a landing is to write a promise about it.
    const silent: string[] = [];
    for (const ch of CHAPTERS) {
      const cited = new Set(
        ch.body.flatMap((b) => (b.kind === "claims" ? b.claims.map((c) => c.spec) : [])),
      );
      for (const f of ch.covers) {
        if (!cited.has(f)) silent.push(`chapter ${ch.n} covers ${f} and makes no claim about it`);
      }
    }
    expect(silent, silent.join("\n  ")).toEqual([]);
  });

  it("claims nothing that is not a spec section", () => {
    const stray = CHAPTERS.flatMap((ch) => ch.covers).filter((f) => !specFiles.includes(f));
    expect(stray, `chapters cite spec files that do not exist: ${stray.join(", ")}`).toEqual([]);
  });

  it("partitions the spec: no section is claimed by two chapters", () => {
    const seen = new Map<string, number>();
    const doubled: string[] = [];
    for (const ch of CHAPTERS) {
      for (const f of ch.covers) {
        if (seen.has(f)) doubled.push(`${f} (chapters ${seen.get(f)} and ${ch.n})`);
        else seen.set(f, ch.n);
      }
    }
    expect(doubled, `claimed twice: ${doubled.join("; ")}`).toEqual([]);
  });

  it("numbers its chapters 1..N in order, with unique slugs", () => {
    expect(CHAPTERS.map((c) => c.n)).toEqual(CHAPTERS.map((_, i) => i + 1));
    expect(new Set(CHAPTERS.map((c) => c.slug)).size).toBe(CHAPTERS.length);
  });
});

describe("every promise names the test that proves it", () => {
  it("has claims at all, in every chapter", () => {
    // A chapter of pure prose would pass every citation check vacuously — the shape spec-lint
    // catches with "no criteria found", and the same hole here.
    expect(allClaims.length).toBeGreaterThan(60);
    for (const ch of CHAPTERS) {
      const n = ch.body.filter((b) => b.kind === "claims").length;
      expect(n, `chapter ${ch.n} (${ch.slug}) makes no claims`).toBeGreaterThan(0);
    }
  });

  it("keeps the unproven promises countable, and every chapter carrying at least one proved", () => {
    // THE CITATION RAIL IS OPTIONAL WITHOUT THIS. Every check below is guarded on `claim.proof`
    // being truthy, so setting all 82 proofs to `null` with a one-character `gap` satisfies the lot
    // — the feature this section is named for could be deleted whole under a green bar. A CAP on the
    // unproven count is the fix, because it can only rise by editing this line, which is the point:
    // putting another promise on its honour should be a deliberate act somebody reviews.
    const unproven = allClaims.filter(({ claim }) => !claim.proof);
    expect(
      unproven.map(({ claim }) => claim.says.slice(0, 70)),
      `more promises are unproven than this rail allows — raise the cap deliberately, or prove one`,
    ).toHaveLength(3);
    for (const ch of CHAPTERS) {
      const proved = ch.body
        .flatMap((b) => (b.kind === "claims" ? b.claims : []))
        .filter((c) => c.proof);
      expect(
        proved.length,
        `chapter ${ch.n} (${ch.slug}) has no promise with a test behind it`,
      ).toBeGreaterThan(0);
    }
  });

  it("cites a test file that exists for every proved claim", () => {
    const missing = allClaims
      .filter(({ claim }) => claim.proof && !existsSync(join(root, claim.proof)))
      .map(({ claim }) => `${claim.proof} (for: ${claim.says.slice(0, 60)}…)`);
    expect(missing, `cited proofs do not exist:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("cites proofs that are real test files, not source read as proof", () => {
    // A claim proved by the implementation it describes is a tautology: the code cannot fail if
    // the code is the evidence. Only a test can go red.
    const notTests = allClaims
      .filter(({ claim }) => claim.proof && !/^test\/.*\.test\.ts$/.test(claim.proof))
      .map(({ claim }) => `${claim.proof}`);
    expect(notTests, `these are not test files: ${notTests.join(", ")}`).toEqual([]);
  });

  it("makes an unproven promise admit it, in writing", () => {
    const silent = allClaims
      .filter(({ claim }) => !claim.proof && !claim.gap?.trim())
      .map(({ claim }) => claim.says.slice(0, 70));
    expect(
      silent,
      `these promises have no proof and no stated gap:\n  ${silent.join("\n  ")}`,
    ).toEqual([]);
  });

  it("attributes every claim to a section its own chapter covers", () => {
    const stray = allClaims
      .filter(({ chapter, claim }) => !chapter.covers.includes(claim.spec))
      .map(({ chapter, claim }) => `ch${chapter.n} cites ${claim.spec}, which it does not cover`);
    expect(stray, stray.join("; ")).toEqual([]);
  });

  it("names only doors the package actually exports", () => {
    // Values, not types: a door is something a reader CALLS, so a type-only export would not be one.
    const shipped = exportedNames().values;
    const phantom = [
      ...new Set(allClaims.map(({ claim }) => claim.door).filter((d): d is string => !!d)),
    ].filter((d) => !shipped.has(d));
    expect(
      phantom,
      `the book sends a reader to doors that are not exported from src/index.ts: ${phantom.join(", ")}`,
    ).toEqual([]);
  });
});

/** Every word the prose marked up, in the order it first appears. */
const markedUp = (text: string): string[] =>
  [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => (m[1] ?? "").split("|")[0] ?? "");

describe("the book's words", () => {
  it("glosses every term it marks up", () => {
    const terms = termIndex();
    const unglossed = new Set<string>();
    for (const text of allText) {
      for (const word of markedUp(text)) if (!terms.has(word)) unglossed.add(word);
    }
    expect(
      [...unglossed],
      `marked up with no gloss in TERMS: ${[...unglossed].join(", ")}`,
    ).toEqual([]);
  });

  it("marks up every term it bothered to gloss", () => {
    // A gloss no sentence reaches is a definition nobody reads — and it rots unobserved.
    const used = new Set<string>();
    for (const text of allText) for (const word of markedUp(text)) used.add(word);
    const orphans = TERMS.map((t) => t.word).filter((w) => !used.has(w));
    expect(orphans, `glossed but never marked up: ${orphans.join(", ")}`).toEqual([]);
  });

  it("tells the truth about which words are the code's and which are ours", () => {
    const { values, all } = exportedNames();
    // Case-insensitive, because `Lens` colliding with `lens` IS the collision this guards.
    const folded = new Map([...all].map((n) => [n.toLowerCase(), n]));
    const lying: string[] = [];
    for (const t of TERMS) {
      if (t.where.kind === "export" && !values.has(t.where.name)) {
        lying.push(`"${t.word}" claims to be exported as ${t.where.name}, and is not`);
      }
      // The sharp direction, and the reason this rail exists (H6): a word we describe as OURS must
      // not quietly become a type. "Lens" is the standing example — CLAUDE.md holds it as prose,
      // and the day something exports that name, this book's gloss is wrong and says so here. The
      // hazard is specifically `export type { Lens }`, which a runtime `Object.keys` cannot see, so
      // the comparison runs against the TYPE exports too.
      const clash = folded.get(t.word.toLowerCase());
      if (t.where.kind === "prose" && clash) {
        lying.push(`"${t.word}" is glossed as our word, but src/index.ts now exports "${clash}"`);
      }
      if (t.where.kind === "spec" && !existsSync(join(root, t.where.section))) {
        lying.push(`"${t.word}" points at ${t.where.section}, which does not exist`);
      }
    }
    expect(lying, lying.join("\n  ")).toEqual([]);
  });

  it("defines each word once", () => {
    expect(new Set(TERMS.map((t) => t.word)).size).toBe(TERMS.length);
  });

  it("has a vocabulary and uses it — both rails above are mutual and go vacuous on an empty one", () => {
    // `glosses every term it marks up` and `marks up every term it glossed` are each satisfied by
    // TERMS = [] and no markup at all. A floor is what makes the pair mean something.
    expect(TERMS.length).toBeGreaterThan(20);
    const marks = allText.reduce((n, t) => n + markedUp(t).length, 0);
    expect(marks, "the book defines words it never uses in a sentence").toBeGreaterThan(60);
  });

  it("closes every inline marker it opens, so no asterisk reaches the reader", () => {
    // The renderer only recognises a BALANCED marker, so an unclosed one does not fail loudly — it
    // prints itself. This is the rail for the class: `*`, `` ` ``, and `[[`.
    const unbalanced: string[] = [];
    for (const text of allText) {
      const stars = (text.match(/\*/g) ?? []).length;
      const ticks = (text.match(/`/g) ?? []).length;
      const opens = (text.match(/\[\[/g) ?? []).length;
      const closes = (text.match(/\]\]/g) ?? []).length;
      const where = `…${text.slice(0, 60)}…`;
      if (stars % 2 !== 0) unbalanced.push(`odd number of * in ${where}`);
      if (ticks % 2 !== 0) unbalanced.push(`odd number of backticks in ${where}`);
      if (opens !== closes) unbalanced.push(`[[ and ]] disagree in ${where}`);
    }
    expect(unbalanced, unbalanced.join("\n  ")).toEqual([]);
  });
});

describe("the book's admissions", () => {
  it("names a ticket for a gap it says is open, and that ticket is still open", () => {
    // The `not built yet` blocks are the part most likely to go stale, and nothing else here can see
    // them: they describe an ABSENCE, and an absence has no test. What they can be tied to is the
    // store. Every `T<n>` the book mentions must be a live shard — so the day the work lands and the
    // ticket is archived, this goes red and somebody has to delete the paragraph that is now false.
    // Archived rather than deleted is what makes this work; a deleted ticket would look like a typo.
    const mentioned = new Set(
      allText.flatMap((t) => [...t.matchAll(/\bT(\d+)\b/g)].map((m) => `T${m[1] ?? ""}`)),
    );
    // A floor, not an exact count: naming one more gap should be free, losing them all should not.
    expect(
      mentioned.size,
      "the book names almost no ticket — did the gaps lose their ids?",
    ).toBeGreaterThan(3);

    const shard = (dir: string, id: string): boolean =>
      readdirSync(join(root, ".adlc", dir)).some((f) => f.startsWith(`${id.toLowerCase()}--`));
    const wrong: string[] = [];
    for (const id of mentioned) {
      if (shard("ticket-archive", id)) {
        wrong.push(`${id} is ARCHIVED — the gap the book describes has been closed; rewrite it`);
      } else if (!shard("tickets", id)) {
        wrong.push(`${id} is in neither the store nor the archive — the book cites nothing`);
      }
    }
    expect(wrong, wrong.join("\n  ")).toEqual([]);
  });
});

describe("the book's figures", () => {
  it("draws only figures the figure set defines", () => {
    const named = CHAPTERS.flatMap((ch) =>
      ch.body.filter((b) => b.kind === "figure").map((b) => (b as { figure: string }).figure),
    );
    // `hasOwn`, not `in`: `in` walks the prototype, so a figure named `toString` would pass
    // the check here and then be CALLED as a builder by the page.
    const phantom = named.filter((f) => !Object.hasOwn(FIGURES, f));
    expect(phantom, `no such figure: ${phantom.join(", ")}`).toEqual([]);
  });

  it("has figures at all — the pair of rails above go vacuous on an empty set", () => {
    expect(Object.keys(FIGURES).length).toBeGreaterThan(7);
    const drawn = CHAPTERS.flatMap((ch) => ch.body.filter((b) => b.kind === "figure"));
    expect(drawn.length, "the book defines figures and draws none of them").toBeGreaterThan(7);
  });

  it("defines only figures the book draws", () => {
    const named = new Set(
      CHAPTERS.flatMap((ch) =>
        ch.body.filter((b) => b.kind === "figure").map((b) => (b as { figure: string }).figure),
      ),
    );
    const unused = Object.keys(FIGURES).filter((f) => !named.has(f));
    expect(unused, `defined but never drawn: ${unused.join(", ")}`).toEqual([]);
  });

  it("builds every figure without a browser, and gets nodes and edges that agree", () => {
    // The drawing itself needs a DOM, but the figure DATA is plain objects — so the shape can be
    // checked here: every edge must name nodes that exist, or the page draws a line to nowhere.
    for (const [name, build] of Object.entries(FIGURES)) {
      const fig = build();
      expect(fig.w, `${name}: no width`).toBeGreaterThan(0);
      expect(fig.h, `${name}: no height`).toBeGreaterThan(0);
      expect(Object.keys(fig.nodes).length, `${name}: no nodes`).toBeGreaterThan(0);
      for (const [k, n] of Object.entries(fig.nodes)) {
        expect(
          ["delta", "entity", "prim", "dead", "ghost"],
          `${name}.${k}: unknown node kind ${n.kind}`,
        ).toContain(n.kind);
      }
      // A floor, not `?? []`: every figure in this book is a graph, and an emptied or misspelled
      // `edges` would otherwise satisfy the loop below by never entering it.
      expect(
        fig.edges?.length ?? 0,
        `${name}: no edges — a graph with nothing joined`,
      ).toBeGreaterThan(0);
      for (const e of fig.edges ?? []) {
        expect(fig.nodes[e.from], `${name}: edge from unknown node ${e.from}`).toBeTruthy();
        expect(fig.nodes[e.to], `${name}: edge to unknown node ${e.to}`).toBeTruthy();
      }
      expect(fig.alt, `${name}: no alt text — a figure a screen reader cannot reach`).toBeTruthy();
    }
  });
});
