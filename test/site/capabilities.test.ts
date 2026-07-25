// The capabilities book's anti-rot rail (T95). The page renders `demos/capabilities/chapters.mjs`
// and this suite asserts against the same module — the book and this test share one text, the same
// identity `arc.test.ts` relies on for the tutorial.
//
// The load-bearing assertion is COVERAGE, not citation. Checking that a cited path exists only
// catches a claim that already rotted; what keeps the book current is the other direction — every
// file in `spec/` must be claimed by exactly one chapter, so a landing that adds `spec/32-*.md`
// turns this suite RED until the book gains a paragraph about it. Staleness gets two ways to go
// red and none to go quiet.
//
// What this suite deliberately does NOT assert: that a chapter's prose is TRUE. No test can read
// English. It asserts that every promise names a test which fails if the promise stops holding,
// that an unproven promise admits it, and that every door and every real-name term resolves in the
// shipped surface. A sentence can still be wrong; a sentence cannot silently stop being backed.

import { existsSync, readdirSync } from "node:fs";
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

/** Every string a reader will see, so the term rail cannot be dodged by moving prose around. */
const allText = CHAPTERS.flatMap((ch) => [
  ch.title,
  ch.thesis,
  ...ch.body.flatMap((b) => {
    if (b.kind === "prose" || b.kind === "heading") return [b.text];
    if (b.kind === "figure") return b.caption ? [b.caption] : [];
    if (b.kind === "claims") return b.claims.map((c) => c.says);
    return b.items;
  }),
]);

describe("the capabilities book covers the spec", () => {
  it("claims every section in spec/, so a new landing cannot leave the book behind", () => {
    const covered = new Set(CHAPTERS.flatMap((ch) => ch.covers));
    const uncovered = specFiles.filter((f) => !covered.has(f));
    expect(
      uncovered,
      `no chapter claims these spec sections — the book is behind the spec:\n  ${uncovered.join("\n  ")}`,
    ).toEqual([]);
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
    expect(allClaims.length).toBeGreaterThan(20);
    for (const ch of CHAPTERS) {
      const n = ch.body.filter((b) => b.kind === "claims").length;
      expect(n, `chapter ${ch.n} (${ch.slug}) makes no claims`).toBeGreaterThan(0);
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
    const shipped = new Set(Object.keys(surface));
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
    const shipped = new Set(Object.keys(surface));
    const lying: string[] = [];
    for (const t of TERMS) {
      if (t.where.kind === "export" && !shipped.has(t.where.name)) {
        lying.push(`"${t.word}" claims to be exported as ${t.where.name}, and is not`);
      }
      // The sharp direction, and the reason this rail exists (H6): a word we describe as OURS must
      // not quietly become a type. "Lens" is the standing example — CLAUDE.md holds it as prose,
      // and the day something exports that name, this book's gloss is wrong and says so here.
      if (t.where.kind === "prose" && shipped.has(t.word)) {
        lying.push(`"${t.word}" is glossed as our word, but src/index.ts now exports that name`);
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

describe("the book's figures", () => {
  it("draws only figures the figure set defines", () => {
    const named = CHAPTERS.flatMap((ch) =>
      ch.body.filter((b) => b.kind === "figure").map((b) => (b as { figure: string }).figure),
    );
    const phantom = named.filter((f) => !(f in FIGURES));
    expect(phantom, `no such figure: ${phantom.join(", ")}`).toEqual([]);
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
      for (const e of fig.edges ?? []) {
        expect(fig.nodes[e.from], `${name}: edge from unknown node ${e.from}`).toBeTruthy();
        expect(fig.nodes[e.to], `${name}: edge to unknown node ${e.to}`).toBeTruthy();
      }
      expect(fig.alt, `${name}: no alt text — a figure a screen reader cannot reach`).toBeTruthy();
    }
  });
});
