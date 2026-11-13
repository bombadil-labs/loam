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
      `the book is behind the spec. To fix: add each section below to the \`covers\` of the chapter ` +
        `that owns its area in demos/capabilities/chapters.mjs, and write one claim about it — ` +
        `{says, spec, proof} — where \`says\` is the promise in a reader's words and \`proof\` is a ` +
        `test path. Your working spec's acceptance criteria already name the tests; this is ` +
        `transcription, not invention:\n  ${uncovered.join("\n  ")}`,
    ).toEqual([]);
  });

  it("says something about every section it claims — a covers entry is not a write-up", () => {
    const silent: string[] = [];
    for (const ch of CHAPTERS) {
      const cited = new Set(
        ch.body.flatMap((b) => (b.kind === "claims" ? b.claims.map((c) => c.spec) : [])),
      );
      for (const f of ch.covers) {
        if (!cited.has(f))
          silent.push(
            `chapter ${ch.n} covers ${f} and makes no claim about it — a covers entry alone is ` +
              `not a write-up; add one {says, spec, proof} claim citing that section`,
          );
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
    expect(allClaims.length).toBeGreaterThan(60);
    for (const ch of CHAPTERS) {
      const n = ch.body.filter((b) => b.kind === "claims").length;
      expect(n, `chapter ${ch.n} (${ch.slug}) makes no claims`).toBeGreaterThan(0);
    }
  });

  it("keeps the unproven promises countable, and every chapter carrying at least one proved", () => {
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
    const used = new Set<string>();
    for (const text of allText) for (const word of markedUp(text)) used.add(word);
    const orphans = TERMS.map((t) => t.word).filter((w) => !used.has(w));
    expect(orphans, `glossed but never marked up: ${orphans.join(", ")}`).toEqual([]);
  });

  it("tells the truth about which words are the code's and which are ours", () => {
    const { values, all } = exportedNames();
    const folded = new Map([...all].map((n) => [n.toLowerCase(), n]));
    const lying: string[] = [];
    for (const t of TERMS) {
      if (t.where.kind === "export" && !values.has(t.where.name)) {
        lying.push(`"${t.word}" claims to be exported as ${t.where.name}, and is not`);
      }
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
    expect(TERMS.length).toBeGreaterThan(20);
    const marks = allText.reduce((n, t) => n + markedUp(t).length, 0);
    expect(marks, "the book defines words it never uses in a sentence").toBeGreaterThan(60);
  });

  it("closes every inline marker it opens, so no asterisk reaches the reader", () => {
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
    const mentioned = new Set(
      allText.flatMap((t) => [...t.matchAll(/\bT(\d+)\b/g)].map((m) => `T${m[1] ?? ""}`)),
    );
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
