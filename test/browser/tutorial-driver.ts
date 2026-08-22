// The tutorial's browser harness (§48): build the real site, serve it, and drive the real page
// over CDP. A NEW file beside the frozen `cdp.ts` — the human-doors pattern; it imports that
// driver and edits nothing in it.
//
// TWO STRUCTURAL DECISIONS LIVE HERE.
//
// 1. THE BUILD GETS ITS OWN DIRECTORY. `scripts/build-site.mjs` rmSyncs its output before
//    writing it, and `test/site/build.test.ts` runs that build against the repo's `site-dist/`.
//    Two suites sharing one mutable path is a race that deletes a page out from under a live
//    server. `--out <dir>` sends this suite's build into its own temp directory instead, so the
//    two runs cannot see each other at all. A lock would serialize the race; a separate path
//    removes it.
// 2. THE PAGE IS ADDRESSED THROUGH MARKERS, NEVER THROUGH LESSON COPY. Every helper below
//    reads `data-*` attributes the player renders: `data-lesson`, `data-role`, `data-step`,
//    `data-state`, `data-ckpt`, `data-term`, `data-kind`. That contract is what lets this file
//    freeze at its landing while a whole new arc lands beneath it (T227). A helper that matched
//    a lesson title would freeze the CONTENT, which is exactly what must stay free to change.

import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { Browser, type Tab } from "./cdp.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};

/**
 * Build the shipped site into a throwaway directory. Returns that directory.
 *
 * `GOMAXPROCS=1` holds esbuild to one thread. This build runs inside a suite that is itself one
 * of ~270 running in parallel, and several of the gateway's rails time a Worker's SPAWN against
 * a hard ceiling — a bundler briefly taking every core is exactly the contention that makes a
 * thread miss it. One thread costs this build a second or two and takes the spike away.
 */
export function buildSiteInto(): string {
  const dir = mkdtempSync(join(tmpdir(), "loam-tutorial-site-"));
  execFileSync(process.execPath, [join("scripts", "build-site.mjs"), "--out", dir], {
    cwd: process.cwd(),
    stdio: "pipe",
    env: { ...process.env, GOMAXPROCS: "1" },
  });
  return dir;
}

export interface SiteHandle {
  readonly base: string;
  close(): Promise<void>;
}

/** Serve a directory on loopback, port 0 — the deployed page's own file layout, no server API. */
export async function serveSite(dir: string): Promise<SiteHandle> {
  const root = resolve(dir);
  const server: Server = createServer((req, res) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      res.writeHead(400).end("malformed path");
      return;
    }
    const rel = normalize(decoded).replace(/^([/\\])+/, "");
    const file = join(root, rel === "" ? "index.html" : rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not here");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

export interface ArcStep {
  readonly id: string;
  readonly label: string;
  readonly have: string;
  readonly want: string;
  readonly how: string;
}
export interface ArcLesson {
  readonly id: number;
  readonly role: string;
  readonly steps: ArcStep[];
  readonly quiz: { id: string; questions: number } | null;
}
export interface Position {
  readonly lesson: number;
  readonly pending: string | null;
  readonly banked: string[];
  readonly quiz: string[];
}

const json = <T>(v: unknown): T => v as T;

/** One tutorial page, addressed through the player's marker contract. */
export class TutorialPage {
  private constructor(
    readonly tab: Tab,
    private readonly url: string,
  ) {}

  static async open(browser: Browser, base: string): Promise<TutorialPage> {
    const tab = await browser.tab();
    const page = new TutorialPage(tab, `${base}/tutorial.html`);
    await tab.navigate(page.url);
    await page.ready();
    return page;
  }

  /** The page's boot is async (genesis, first render); every navigation waits for it. */
  async ready(): Promise<void> {
    const deadline = Date.now() + 20_000; // a hang guard: the page's boot is genesis + one render
    for (;;) {
      const up = await this.tab.eval(
        `Boolean(window.tutorial && window.tutorial.ready) ? "yes" : (window.__tutorialError ?? "no")`,
      );
      if (up === "yes") return;
      if (up !== "no") throw new Error(`the tutorial page failed to boot: ${String(up)}`);
      if (Date.now() > deadline) throw new Error("the tutorial page never finished booting");
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async reload(): Promise<void> {
    await this.tab.navigate(this.url);
    await this.ready();
  }

  /** Case isolation: wipe this origin and boot a fresh store. Not the page's own start-over. */
  async reset(): Promise<void> {
    await this.tab.eval(`localStorage.clear()`);
    await this.reload();
  }

  /** Wait for the action the last click started. The page keeps one in-flight chain. */
  async idle(): Promise<void> {
    await this.tab.eval(`window.tutorial.idle()`);
  }

  async click(selector: string): Promise<void> {
    const hit = await this.tab.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return false; el.click(); return true; })()`,
    );
    if (hit !== true) throw new Error(`nothing to click at ${selector}`);
    await this.idle();
  }

  /** Click something that reloads the page (revert, start over), and wait out the reload. */
  async clickAndReload(selector: string): Promise<void> {
    const done = this.tab.loaded(`the reload after ${selector}`);
    const hit = await this.tab.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return false; el.click(); return true; })()`,
    );
    if (hit !== true) throw new Error(`nothing to click at ${selector}`);
    await done;
    await this.ready();
  }

  text(selector: string): Promise<string> {
    return this.tab
      .eval(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)});
                  return el === null ? "" : el.textContent; })()`,
      )
      .then((v) => String(v));
  }

  /** Type into a field the way a person does — the value, then the input event the page hears. */
  async fill(selector: string, value: string): Promise<void> {
    const hit = await this.tab.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return false;
                el.value = ${JSON.stringify(value)};
                el.dispatchEvent(new Event("input", { bubbles: true }));
                return true; })()`,
    );
    if (hit !== true) throw new Error(`no field at ${selector}`);
  }

  exists(selector: string): Promise<boolean> {
    return this.tab
      .eval(`document.querySelector(${JSON.stringify(selector)}) !== null`)
      .then((v) => v === true);
  }

  attrs(selector: string, attr: string): Promise<string[]> {
    return this.tab
      .eval(
        `[...document.querySelectorAll(${JSON.stringify(selector)})]
           .map((el) => el.getAttribute(${JSON.stringify(attr)}) ?? "")`,
      )
      .then((v) => json<string[]>(v));
  }

  /** The arc the page actually loaded — shape only, never its prose. */
  arc(): Promise<ArcLesson[]> {
    return this.tab
      .eval(
        `window.tutorial.arc.map((l) => ({
           id: l.id, role: l.role,
           steps: l.steps.map((s) => ({
             id: s.id, label: s.label, have: s.have, want: s.want, how: s.how,
           })),
           quiz: l.quiz ? { id: l.quiz.id, questions: l.quiz.questions.length } : null,
         }))`,
      )
      .then((v) => json<ArcLesson[]>(v));
  }

  /** The order the three framing sentences are laid out in, as a person reads them. */
  frameOrder(step: string): Promise<string[]> {
    return this.tab
      .eval(
        `[...document.querySelectorAll('[data-step="${step}"] [data-have], [data-step="${step}"] [data-want], [data-step="${step}"] [data-how]')]
           .map((el) => el.hasAttribute("data-have") ? "have"
                      : el.hasAttribute("data-want") ? "want" : "how")`,
      )
      .then((v) => json<string[]>(v));
  }

  /** The lenses this store holds a registration for, asked of the live gateway. */
  lensNames(): Promise<string[]> {
    return this.tab.eval(`window.tutorial.lensNames()`).then((v) => json<string[]>(v));
  }

  /** Every pending step the page is showing — the count matters, not only the first one. */
  pendingSteps(): Promise<string[]> {
    return this.attrs('[data-step][data-state="pending"]', "data-step");
  }

  /** Where the student stands, read from the rendered page — never from page memory. */
  async position(): Promise<Position> {
    const lesson = Number(
      await this.tab.eval(`document.querySelector("#lesson-pane").dataset.lesson`),
    );
    const pending = (await this.attrs('[data-step][data-state="pending"]', "data-step"))[0] ?? null;
    const banked = await this.attrs('[data-step][data-state="banked"]', "data-step");
    const quiz = (await this.tab.eval(
      `[...document.querySelectorAll("[data-quiz-result]")]
           .map((el) => el.dataset.quizResult + "=" + el.dataset.correct).sort()`,
    )) as string[];
    return { lesson, pending, banked, quiz };
  }

  /** Run the one live step button and let its work settle. */
  async runPending(): Promise<void> {
    await this.click("button[data-step-run]");
  }

  /** The page's own evaluation of a step's two observe predicates, over the live ctx. */
  observes(lesson: number, step: string): Promise<{ page: boolean; store: boolean }> {
    return this.tab
      .eval(
        `(async () => {
           const l = window.tutorial.arc.find((x) => x.id === ${lesson});
           const s = l.steps.find((x) => x.id === ${JSON.stringify(step)});
           return { page: window.tutorial.seePage(s.observe.page),
                    store: await s.observe.store(window.tutorial.ctx) };
         })()`,
      )
      .then((v) => json<{ page: boolean; store: boolean }>(v));
  }

  /** Does the pending step EARN its observable — is its store predicate false right now? */
  private pendingEarns(): Promise<{ lesson: number; step: string } | null> {
    return this.tab
      .eval(
        `(async () => {
           const pane = document.querySelector("#lesson-pane");
           const row = document.querySelector('[data-step][data-state="pending"]');
           if (!pane || !row) return null;
           const l = window.tutorial.arc.find((x) => x.id === Number(pane.dataset.lesson));
           const s = l.steps.find((x) => x.id === row.dataset.step);
           if (await s.observe.store(window.tutorial.ctx)) return null;
           return { lesson: l.id, step: s.id };
         })()`,
      )
      .then((v) => json<{ lesson: number; step: string } | null>(v));
  }

  /**
   * Walk forward until the pending step EARNS its observable — its store predicate is false
   * before it runs — and stop there. That is the only kind of step a red-probe may target: a
   * look-step ("notice the record boot already made") is legitimately true before its run, so
   * neutralizing one would prove nothing at all. Look-steps met on the way are simply played.
   * Chosen by position in whatever arc is loaded, so a new arc needs no edit here.
   */
  async advanceToEarningStep(): Promise<{ lesson: number; step: string } | null> {
    const arc = await this.arc();
    const budget = arc.reduce((n, l) => n + l.steps.length, 0) + arc.length;
    for (let i = 0; i < budget; i++) {
      const earning = await this.pendingEarns();
      if (earning !== null) return earning;
      if (await this.exists("button[data-step-run]")) {
        await this.runPending();
        continue;
      }
      if (await this.exists("#quiz-skip")) await this.click("#quiz-skip");
      if (!(await this.exists("[data-next-lesson]"))) return null;
      await this.click("[data-next-lesson]");
    }
    return null;
  }

  /** What the Ground pane calls these records — with the tutorial's own revealed, so it can. */
  async kindsOf(ids: readonly string[]): Promise<string[]> {
    if (!(await this.tab.eval(`document.querySelector("#ground-show-tutorial").checked`))) {
      await this.click("#ground-show-tutorial");
    }
    return this.tab
      .eval(
        `${JSON.stringify(ids)}.map((id) => {
           const row = document.querySelector('.delta[data-delta-id="' + id + '"]');
           return row === null ? "(not shown)" : row.dataset.kind;
         })`,
      )
      .then((v) => json<string[]>(v));
  }

  /**
   * Answer the first unanswered question in the open quiz card, right or wrong ON PURPOSE. The
   * choice index is computed from the arc the page loaded, so no marker in the page has to name
   * which answer is which — and a new arc's quizzes work here unchanged.
   */
  async answerFirstQuestion(kind: "right" | "wrong"): Promise<string> {
    const pick = (await this.tab.eval(
      `(() => {
         // the first question still OPEN: an answered one has its choices disabled
         const block = [...document.querySelectorAll("#quiz-card [data-question]")].find(
           (b) => [...b.querySelectorAll("button[data-choice]")].some((x) => !x.disabled));
         if (!block) return null;
         const key = block.dataset.question;
         const quizId = key.slice(0, key.lastIndexOf("#"));
         const index = Number(key.slice(key.lastIndexOf("#") + 1));
         const lesson = window.tutorial.arc.find((l) => l.quiz && l.quiz.id === quizId);
         const q = lesson.quiz.questions[index];
         const choice = ${kind === "right" ? "q.answer" : "q.choices.findIndex((_, i) => i !== q.answer)"};
         return { key, choice };
       })()`,
    )) as { key: string; choice: number } | null;
    if (pick === null) throw new Error("no question is on offer");
    await this.click(
      `#quiz-card [data-question="${pick.key}"] button[data-choice="${pick.choice}"]`,
    );
    return pick.key;
  }

  /**
   * Fixture mutation, the other half: blind a step's PAGE observable. The step's real work
   * still runs, so only an honest page predicate can refuse — the half a store-only probe
   * cannot reach. Two modes, because a page predicate can be dishonest in two ways:
   *   "selector" — look for an element this page does not have;
   *   "text"     — look at an element it DOES have, for words it will never say.
   * Returns the string the refusal must name.
   */
  async blindPageObserve(lesson: number, step: string, mode: "selector" | "text"): Promise<string> {
    const selector = mode === "selector" ? "#nothing-on-this-page-matches-this" : "#lesson-pane";
    const contains = mode === "selector" ? "never" : "a-sentence-this-page-will-never-say";
    const done = await this.tab.eval(
      `(() => {
         const l = window.tutorial.arc.find((x) => x.id === ${lesson});
         const s = l && l.steps.find((x) => x.id === ${JSON.stringify(step)});
         if (!s || !s.observe.page) return false;
         s.observe.page = { selector: ${JSON.stringify(selector)}, contains: ${JSON.stringify(contains)} };
         return true;
       })()`,
    );
    if (done !== true) throw new Error(`step ${step} has no page observable to blind`);
    return mode === "selector" ? selector : contains;
  }

  /** Fixture mutation: replace a step's real work with a no-op, in the loaded arc. */
  async neutralize(lesson: number, step: string): Promise<void> {
    const done = await this.tab.eval(
      `(() => {
         const l = window.tutorial.arc.find((x) => x.id === ${lesson});
         const s = l && l.steps.find((x) => x.id === ${JSON.stringify(step)});
         if (!s) return false;
         s.run = async () => {};
         return true;
       })()`,
    );
    if (done !== true) throw new Error(`no step ${step} in lesson ${lesson} to neutralize`);
  }

  /**
   * Land a STRANGER's claim in the tutorial's own vocabulary, through the page's real
   * federation door, and re-render. Returns its delta id. The store does not burn mail: it
   * lands — the question every caller asks is what the page then does with it.
   */
  async plantForeignTutorialClaim(): Promise<string> {
    const id = await this.tab.eval(
      `(async () => {
         const seed = "5a".repeat(32);
         const loam = window.loam;
         const claim = loam.signClaims(
           { timestamp: Date.now(), author: loam.authorForSeed(seed),
             pointers: [
               { role: "step", target: { kind: "entity",
                 entity: { id: "tutorial:step:99.9", context: "tutorial.step" } } },
               { role: "name", target: { kind: "primitive", value: "99.9" } },
               { role: "lesson", target: { kind: "primitive", value: 99 } },
             ] },
           seed);
         await window.tutorial.ctx.gateway.federate([claim]);
         return claim.id;
       })()`,
    );
    await this.tab.eval(`window.tutorial.refresh()`); // the panes are readings; ask again
    return String(id);
  }

  /**
   * Land a claim signed by the STUDENT'S OWN key that wears the tutorial's vocabulary AND a
   * constitutional context. It is not the tutorial's bookkeeping, so the pane must not hide it.
   * Returns its delta id.
   */
  async plantHybridTutorialClaim(): Promise<string> {
    const id = await this.tab.eval(
      `(async () => {
         const loam = window.loam, ctx = window.tutorial.ctx;
         const claim = loam.signClaims(
           { timestamp: Date.now(), author: ctx.author,
             pointers: [
               { role: "step", target: { kind: "entity",
                 entity: { id: "tutorial:step:88.8", context: "tutorial.step" } } },
               { role: "name", target: { kind: "primitive", value: "88.8" } },
               { role: "declares", target: { kind: "entity",
                 entity: { id: "loam:something", context: "loam.something-else" } } },
             ] },
           ctx.seed);
         await ctx.gateway.federate([claim]);
         return claim.id;
       })()`,
    );
    await this.tab.eval(`window.tutorial.refresh()`);
    return String(id);
  }

  /** Drop every checkpoint blob, the way a partial site-data clear or a full quota would. */
  async dropCheckpoints(): Promise<number> {
    const gone = await this.tab.eval(
      `(() => {
         const doomed = Object.keys(localStorage).filter((k) =>
           k.startsWith("loam:tutorial-ckpt:"));
         for (const k of doomed) localStorage.removeItem(k);
         return doomed.length;
       })()`,
    );
    return Number(gone);
  }

  /** The quizzes the student's own store records as SKIPPED. */
  skippedQuizzes(): Promise<string[]> {
    return this.tab.eval(`window.tutorial.skipped()`).then((v) => json<string[]>(v));
  }

  /** Every localStorage key this origin holds, straight from the browser. */
  keys(): Promise<string[]> {
    return this.tab.eval(`Object.keys(localStorage).sort()`).then((v) => json<string[]>(v));
  }

  /** The store's delta ids, read from the rows themselves — the byte level. */
  async storeIds(): Promise<string[]> {
    const keys = await this.keys();
    return keys
      .filter((k) => /^loam:tutorial:[0-9a-f]+$/.test(k))
      .map((k) => k.slice("loam:tutorial:".length))
      .sort();
  }

  /** Every record the ground holds right now, as id → the wire text of its claims. */
  groundText(): Promise<Record<string, string>> {
    return this.tab
      .eval(
        `(() => {
           const out = {};
           for (const d of window.tutorial.ctx.gateway.offeredDeltas()) {
             out[d.id] = JSON.stringify(window.loam.toWire(d).claims);
           }
           return out;
         })()`,
      )
      .then((v) => json<Record<string, string>>(v));
  }

  /**
   * Does a checkpoint blob carry these bytes ANYWHERE in it — in a row's own text, not merely
   * under a key that names it? The row values are JSON strings inside the blob's JSON, so the
   * search runs over the parsed values rather than the escaped envelope.
   */
  checkpointHolds(lesson: number, words: string): Promise<boolean> {
    return this.tab
      .eval(
        `(() => {
           const raw = localStorage.getItem("loam:tutorial-ckpt:" + ${lesson});
           if (raw === null) return false;
           const rows = Object.values(JSON.parse(raw).rows).join("\\n");
           return rows.includes(${JSON.stringify(words)});
         })()`,
      )
      .then((v) => v === true);
  }

  /**
   * The ids of the erasure receipts the store holds, read from the ROWS — in the canonical wire
   * profile they are stored in, where an entity target is a bare `{id, context}`.
   */
  erasureOrderIds(): Promise<string[]> {
    return this.tab
      .eval(
        `Object.keys(localStorage)
           .filter((k) => /^loam:tutorial:[0-9a-f]+$/.test(k))
           .filter((k) => {
             try {
               const row = JSON.parse(localStorage.getItem(k));
               return (row.claims.pointers ?? []).some(
                 (p) => p.target && p.target.context === "loam.erasure");
             } catch { return false; }
           })
           .map((k) => k.slice("loam:tutorial:".length))
           .sort()`,
      )
      .then((v) => json<string[]>(v));
  }

  async checkpointLessons(): Promise<number[]> {
    const keys = await this.keys();
    return keys
      .filter((k) => k.startsWith("loam:tutorial-ckpt:"))
      .map((k) => Number(k.slice("loam:tutorial-ckpt:".length)))
      .sort((a, b) => a - b);
  }

  /** The delta ids a checkpoint blob holds — read out of localStorage, not out of the player. */
  checkpointIds(lesson: number): Promise<string[]> {
    return this.tab
      .eval(
        `(() => {
           const raw = localStorage.getItem("loam:tutorial-ckpt:" + ${lesson});
           if (raw === null) return null;
           return Object.keys(JSON.parse(raw).rows)
             .map((k) => k.slice("loam:tutorial:".length)).sort();
         })()`,
      )
      .then((v) => json<string[] | null>(v))
      .then((v) => {
        if (v === null) throw new Error(`no checkpoint blob for lesson ${lesson}`);
        return v;
      });
  }

  /** Every key that is not a store row and not the seed, deleted — the resume falsifier. */
  async deleteNonStoreKeys(): Promise<number> {
    const gone = await this.tab.eval(
      `(() => {
         const doomed = Object.keys(localStorage).filter(
           (k) => k !== "loam:tutorial:seed" && !/^loam:tutorial:[0-9a-f]+$/.test(k));
         for (const k of doomed) localStorage.removeItem(k);
         return doomed.length;
       })()`,
    );
    return Number(gone);
  }

  close(): void {
    this.tab.close();
  }
}

export function dropSite(dir: string | undefined): void {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}
