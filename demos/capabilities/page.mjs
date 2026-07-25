// The book's renderer. It holds no content: every sentence, claim, term, and figure name comes
// from `chapters.mjs`, which `test/site/capabilities.test.ts` imports too. The page and that test
// share one book — that identity is the anti-rot guarantee, the same one `test/site/arc.test.ts`
// makes for the tutorial.

import { CHAPTERS, TERMS, termIndex } from "./chapters.mjs";
import { FIGURES } from "./figure-set.mjs";
import { draw } from "./figures.mjs";

const terms = termIndex();

/** Where a word lives, in one line a reader can act on. This is the honesty knob Myk asked for:
 *  a term is either a name the code really uses, or ours for the purpose of explaining. */
function provenance(where) {
  if (where.kind === "export") return `real name — exported as \`${where.name}\``;
  if (where.kind === "internal") return `real name in the code — ${where.at}`;
  if (where.kind === "spec") return `defined in ${where.section}`;
  return "our word for it — no type in the code carries this name";
}

const card = document.getElementById("term-card");

function showCard(button, entry) {
  const r = button.getBoundingClientRect();
  card.innerHTML = "";
  const word = document.createElement("span");
  word.className = "word";
  word.textContent = entry.word;
  const gloss = document.createElement("span");
  gloss.textContent = entry.gloss;
  const where = document.createElement("span");
  where.className = "where";
  where.textContent = provenance(entry.where);
  card.append(word, gloss, where);
  card.classList.add("on");
  card.setAttribute("aria-hidden", "false");
  // Measure after content lands, then keep the card on screen at either edge.
  const box = card.getBoundingClientRect();
  const left = Math.min(Math.max(12, r.left), window.innerWidth - box.width - 12);
  const above = r.top > box.height + 16;
  card.style.left = `${left}px`;
  card.style.top = `${above ? r.top - box.height - 10 : r.bottom + 10}px`;
}

function hideCard() {
  card.classList.remove("on");
  card.setAttribute("aria-hidden", "true");
}

/**
 * The book's inline vocabulary: `` `code` ``, `**strong**`, `*emphasis*`, and `[[term]]`.
 *
 * Every span is BUILT as an element with `textContent`, never assembled into `innerHTML` — the
 * content module is prose written by hand, and a renderer that parses its own source into markup is
 * one typo away from executing it. The rail asserts the same four markers are balanced, so an
 * unclosed one is a red test rather than a literal asterisk on the page.
 */
function inline(parent, text) {
  for (const bit of text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
    if (!bit) continue;
    if (/^`[^`]+`$/.test(bit)) {
      const c = document.createElement("code");
      c.textContent = bit.slice(1, -1);
      parent.append(c);
    } else if (/^\*\*[^*]+\*\*$/.test(bit)) {
      const s = document.createElement("strong");
      s.textContent = bit.slice(2, -2);
      parent.append(s);
    } else if (/^\*[^*]+\*$/.test(bit)) {
      const e = document.createElement("em");
      e.textContent = bit.slice(1, -1);
      parent.append(e);
    } else {
      parent.append(document.createTextNode(bit));
    }
  }
}

/** Prose carries `[[term]]` markers. Everything else is inserted as text, never as markup. */
function prose(text) {
  const p = document.createElement("p");
  for (const piece of text.split(/(\[\[[^\]]+\]\])/g)) {
    const m = /^\[\[([^\]]+)\]\]$/.exec(piece);
    if (!m) {
      inline(p, piece);
      continue;
    }
    const [word, shown] = m[1].split("|");
    const entry = terms.get(word);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "term";
    button.textContent = shown || word;
    if (!entry) {
      // A missing gloss is a rail failure, not a page failure — render the word and move on.
      p.append(document.createTextNode(shown || word));
      continue;
    }
    button.setAttribute("aria-describedby", "term-card");
    button.addEventListener("pointerenter", () => showCard(button, entry));
    button.addEventListener("focus", () => showCard(button, entry));
    button.addEventListener("pointerleave", hideCard);
    button.addEventListener("blur", hideCard);
    button.addEventListener("click", () => showCard(button, entry));
    p.append(button);
  }
  return p;
}

function claimList(claims) {
  const ul = document.createElement("ul");
  ul.className = "claims";
  for (const c of claims) {
    const li = document.createElement("li");
    if (!c.proof) li.className = "unproven";
    const says = document.createElement("span");
    says.className = "says";
    says.append(...prose(c.says).childNodes);
    const receipt = document.createElement("div");
    receipt.className = "receipt";
    const chip = (cls, text) => {
      const s = document.createElement("span");
      s.className = cls;
      s.textContent = text;
      receipt.append(s);
    };
    if (c.proof) chip("proves", `proved by ${c.proof}`);
    else chip("nothing", "no test proves this yet");
    if (c.door) chip("door", `${c.door}()`);
    chip("spec", c.spec);
    li.append(says, receipt);
    // The gap is the whole point of allowing an unproven promise: a reader who is told a sentence
    // has no test behind it deserves the reason in the same breath. Enforcing the field and then
    // rendering it to nobody would be the admission going into a drawer.
    if (c.gap) {
      const why = document.createElement("p");
      why.className = "gap";
      inline(why, c.gap);
      li.append(why);
    }
    ul.append(li);
  }
  return ul;
}

function figureBlock(block) {
  const build = FIGURES[block.figure];
  const fig = document.createElement("figure");
  const frame = document.createElement("div");
  frame.className = "frame";
  if (build) frame.append(draw(build()));
  fig.append(frame);
  if (block.caption) {
    const cap = document.createElement("figcaption");
    cap.append(...prose(block.caption).childNodes);
    fig.append(cap);
  }
  return fig;
}

function notYetBlock(items) {
  const box = document.createElement("div");
  box.className = "not-yet";
  const h = document.createElement("div");
  h.className = "heading";
  h.textContent = "not built yet";
  const ul = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    li.append(...prose(item).childNodes);
    ul.append(li);
  }
  box.append(h, ul);
  return box;
}

function renderChapter(ch) {
  const section = document.createElement("section");
  section.className = "chapter";
  section.id = ch.slug;
  const num = document.createElement("span");
  num.className = "chapter-num";
  num.textContent = `chapter ${ch.n}`;
  const h2 = document.createElement("h2");
  h2.textContent = ch.title;
  const thesis = document.createElement("p");
  thesis.className = "thesis";
  thesis.append(...prose(ch.thesis).childNodes);
  section.append(num, h2, thesis);

  const column = document.createElement("div");
  column.className = "column";
  for (const block of ch.body) {
    if (block.kind === "prose") column.append(prose(block.text));
    else if (block.kind === "heading") {
      const h3 = document.createElement("h3");
      h3.textContent = block.text;
      column.append(h3);
    } else if (block.kind === "figure") column.append(figureBlock(block));
    else if (block.kind === "claims") column.append(claimList(block.claims));
    else if (block.kind === "notYet") column.append(notYetBlock(block.items));
  }
  section.append(column);
  return section;
}

const book = document.getElementById("book");
const toc = document.getElementById("toc");

for (const ch of CHAPTERS) {
  book.append(renderChapter(ch));
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = `#${ch.slug}`;
  const n = document.createElement("span");
  n.className = "num";
  n.textContent = String(ch.n).padStart(2, "0");
  const t = document.createElement("span");
  t.textContent = ch.title;
  a.append(n, t);
  li.append(a);
  toc.append(li);
}

// The stamp counts what the book is accountable for, from the book itself — a number nobody has to
// remember to update.
const claims = CHAPTERS.flatMap((c) => c.body.filter((b) => b.kind === "claims")).flatMap(
  (b) => b.claims,
);
const proved = claims.filter((c) => c.proof).length;
document.getElementById("stamp").textContent =
  `${CHAPTERS.length} chapters · ${claims.length} promises · ${proved} of them with a test that ` +
  `fails if they stop being true · ${TERMS.length} terms defined`;

// Highlight the chapter you are reading. IntersectionObserver rather than a scroll handler, so a
// long read does not pay for the rail on every frame.
const links = new Map(CHAPTERS.map((ch) => [ch.slug, toc.querySelector(`a[href="#${ch.slug}"]`)]));
const seen = new Set();
const mark = () => {
  const first = CHAPTERS.find((ch) => seen.has(ch.slug));
  for (const [slug, a] of links) {
    if (first && slug === first.slug) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }
};
const watcher = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) seen.add(e.target.id);
      else seen.delete(e.target.id);
    }
    mark();
  },
  { rootMargin: "-10% 0px -70% 0px" },
);
for (const ch of CHAPTERS) watcher.observe(document.getElementById(ch.slug));

window.addEventListener("scroll", hideCard, { passive: true });
