// The tutorial page (§48) — the theater over `player.mjs` (the engine) and `lessons.mjs` (the
// arc). Zero framework on purpose: the STORE is the state and this file is a subscriber. Every
// green mark, every banked step, every quiz result and every checkpoint row is recomputed from
// the student's own claims on each render, so nothing here can drift from what they actually did.
//
// THREE RULES THIS FILE KEEPS, each of them load-bearing:
//
//   ONE PENDING STEP. A lesson renders the steps already banked, then exactly one live button.
//   The next step does not run until the student asks for it, which is the whole reason the
//   rewrite exists — the old page played a lesson as one motion and its middle was never seen.
//
//   NO NATIVE DIALOGS. Reverting and starting over are destructive, so they ask first — but they
//   ask IN THE PAGE. `window.confirm` blocks the page's own script until a human answers, which
//   no CDP-driven rail can do, so a native dialog is a destructive path that can never be tested.
//
//   REVERT RELOADS. Re-seeding the store's rows under a live page would leave this module's
//   captured gateway, the View pane's subscription, and every open pane rendering a future that
//   no longer exists. `location.reload()` makes "the panes re-render from the restored ground"
//   true by construction rather than by care.

import * as loam from "@bombadil/loam/browser";
import { EditorView, basicSetup } from "codemirror";
import { graphql as graphqlLang, updateSchema } from "cm6-graphql";
import { buildClientSchema, getIntrospectionQuery, printSchema } from "graphql";
import { buildArc, buildExport, bootTutorialStore } from "./lessons.mjs";
import {
  SEED_KEY,
  STORE_PREFIX,
  answerQuiz,
  bankCheckpoint,
  checkpointLessons,
  clearCheckpoints,
  completeStep,
  enterLesson,
  readGlossary,
  readProgress,
  restoreCheckpoint,
  resumeState,
  skipQuiz,
  sweepCheckpoints,
} from "./player.mjs";
import { isReadOnlyDocument, renderGround, renderViews } from "./instruments.mjs";

const $ = (sel) => document.querySelector(sel);

// A boot that throws must SAY so. A page stuck on "booting…" is indistinguishable from a slow
// one — for a reader and for a rail alike — so the failure is recorded where both can find it.
window.addEventListener("error", (e) => {
  window.__tutorialError = String(e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  window.__tutorialError = String(e.reason?.message ?? e.reason);
});

// ---- boot ------------------------------------------------------------------------------------

const storage = window.localStorage;
const { gateway, seed, author } = await bootTutorialStore(loam, storage);

let clock = Date.now();
const ctx = {
  gateway,
  storage,
  seed,
  author,
  ts: () => (clock = Math.max(Date.now(), clock + 1)),
};

const arc = buildArc(loam);
const lessonOf = (id) => arc.find((l) => l.id === id) ?? arc[0];

// Pins live OUTSIDE the store's delta namespace: the backend owns every `loam:tutorial:<id>` key
// and reads what it finds there as a delta. Dots, not colons — this cannot collide.
//
// DECLARED BEFORE ITS READER, and that is not style: `loadPins` runs while the `ui` literal
// below is being built, so a key declared after it would still be in its dead zone — and the
// catch here, which exists for a corrupt VALUE, would swallow that as an empty Map and lose
// every pin the student saved, silently.
const PINS_KEY = "loam.tutorial.ui.pins";
// A revert reloads the page, so anything it needs to TELL the student has to outlive the
// reload. Dots, not colons, for the same reason as the pins: this is not a delta.
const REVERT_NOTE_KEY = "loam.tutorial.ui.revert-note";
function loadPins() {
  try {
    const raw = JSON.parse(storage.getItem(PINS_KEY) ?? "[]");
    if (!Array.isArray(raw)) return new Map();
    return new Map(
      raw.filter((e) => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string"),
    );
  } catch {
    return new Map(); // disposable UI memory: a corrupt value must never kill the boot
  }
}

// The page's own memory — panes, drawers, and questions in flight. Never progress: that lives
// in the store, and every render reads it back from there.
const ui = {
  lesson: arc[0].id,
  refusal: null, // something was asked and could not be done — the student must read it
  notice: null, // something happened that they should know about, which is not a failure
  askRevert: null,
  askStartOver: false,
  quizDismissed: new Set(),
  highlightStep: null,
  sweep: null,
  drawerOpen: false,
  sdl: "",
  lastStep: null,
  savedQueries: loadPins(),
  persist() {
    storage.setItem(PINS_KEY, JSON.stringify([...this.savedQueries]));
  },
};
const groundState = {
  seen: new Set(),
  expanded: new Set(),
  showTutorial: false,
  highlight: null,
};

// One action at a time, in a chain the page can be ASKED about. Every button goes through this,
// so a rail (and a curious console) can await exactly the work a click started, and a thrown
// error becomes a refusal the student can read instead of a silence.
let inFlight = Promise.resolve();
const act = (fn) => {
  inFlight = inFlight
    .catch(() => {})
    .then(fn)
    .catch(async (err) => {
      ui.refusal = String((err && err.message) || err);
      await rerender();
    });
  return inFlight;
};

/** A step's PAGE observable, asked of the real DOM — never of the step's own prose. */
const seePage = (want) => {
  if (want === undefined || want === null) return true;
  const el = document.querySelector(want.selector);
  if (el === null) return false;
  return want.contains === undefined ? true : el.textContent.includes(want.contains);
};

// The console door for the curious — the copy invites it, so it is really there. The rails use
// the same door: there is no test-only surface on this page.
window.loam = loam;
window.store = gateway;
window.tutorial = {
  arc,
  ctx,
  seePage,
  idle: () => inFlight,
  bankedSteps: () => [...readProgress(ctx).steps],
  // Re-read everything from the store. The panes are readings, so anything that lands by
  // another door — this console, a federation pull — becomes visible by asking again.
  refresh: () => act(() => rerender()),
  introspectionQuery: () => getIntrospectionQuery(),
  lensNames: () => gateway.registrationVersions().map((v) => v.hyperschema.name),
  ready: false,
};

$("#author-chip").textContent = author;

// ---- the lesson pane ---------------------------------------------------------------------------

const pendingStepOf = (lesson, progress) =>
  lesson.steps.find((s) => !progress.steps.has(s.id)) ?? null;

const lessonIsGreen = (lesson, progress) => lesson.steps.every((s) => progress.steps.has(s.id));

function line(parent, className, text) {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function renderLesson(progress) {
  const lesson = lessonOf(ui.lesson);
  const el = $("#lesson-pane");
  el.textContent = "";
  el.dataset.lesson = String(lesson.id);
  el.dataset.role = lesson.role;

  line(el, "lesson-no", `lesson ${lesson.id} of ${arc.length}`);
  const h = document.createElement("h2");
  h.textContent = lesson.title;
  el.appendChild(h);
  line(el, "lesson-copy", lesson.copy);

  const pending = pendingStepOf(lesson, progress);
  let waiting = 0;
  for (const step of lesson.steps) {
    const banked = progress.steps.has(step.id);
    if (!banked && step !== pending) {
      waiting += 1;
      continue; // one pending step at a time: what comes after is not shown as a control
    }
    const row = document.createElement("div");
    row.className = `step${ui.highlightStep === step.id ? " highlight" : ""}`;
    row.dataset.step = step.id;
    row.dataset.state = banked ? "banked" : "pending";

    const head = document.createElement("div");
    head.className = "step-head";
    const mark = document.createElement("span");
    mark.className = "step-mark";
    mark.textContent = banked ? "✓" : "○";
    const label = document.createElement("strong");
    label.textContent = step.label;
    head.append(mark, label);
    row.appendChild(head);

    // The three sentences, always in this order: what we have, what we want, how we get there.
    for (const [attr, prefix, text] of [
      ["data-have", "what we have", step.have],
      ["data-want", "what we want", step.want],
      ["data-how", "how we get there", step.how],
    ]) {
      const framed = document.createElement("p");
      framed.className = "step-frame";
      framed.setAttribute(attr, "");
      const key = document.createElement("span");
      key.className = "frame-key";
      key.textContent = `${prefix}: `;
      framed.append(key, document.createTextNode(text));
      row.appendChild(framed);
    }

    if (!banked) {
      const button = document.createElement("button");
      button.setAttribute("data-step-run", "");
      button.textContent = step.label;
      button.onclick = () => act(() => runPendingStep());
      row.appendChild(button);
    }
    el.appendChild(row);
  }
  if (waiting > 0) {
    line(el, "steps-waiting", `${waiting} more step${waiting === 1 ? "" : "s"} after this one`);
  }

  const refusal = document.createElement("div");
  refusal.id = "step-refusal";
  refusal.className = ui.refusal === null ? "refusal" : "refusal bad";
  refusal.textContent = ui.refusal ?? "";
  el.appendChild(refusal);

  const notice = document.createElement("div");
  notice.id = "step-notice";
  notice.className = ui.notice === null ? "notice" : "notice ok";
  notice.textContent = ui.notice ?? "";
  el.appendChild(notice);

  if (lessonIsGreen(lesson, progress)) {
    line(
      el,
      "done-note",
      "✓ your store says this lesson is done — re-read from the ground just now",
    );
    const next = arc.find((l) => l.id > lesson.id);
    if (next !== undefined) {
      const button = document.createElement("button");
      button.setAttribute("data-next-lesson", "");
      button.textContent = `next: ${next.title}`;
      button.onclick = () => act(() => goToLesson(next.id));
      el.appendChild(button);
    }
  }
}

async function goToLesson(id) {
  ui.lesson = id;
  ui.refusal = null;
  ui.notice = null;
  ui.sweep = null;
  ui.highlightStep = null;
  await enterLesson(loam, ctx, lessonOf(id));
  await rerender();
}

/** Run the one live step: do the work, then bank it only if both observables hold. */
async function runPendingStep() {
  const lesson = lessonOf(ui.lesson);
  const step = pendingStepOf(lesson, readProgress(ctx));
  if (step === null) return;
  ui.refusal = null;
  ui.notice = null;
  const before = new Set(gateway.offeredDeltas().map((d) => d.id));

  const outcome = await completeStep(loam, ctx, lesson, step, {
    seePage,
    // Between the work and the page predicate the panes must catch up — the predicate asks what
    // the student can SEE, and an unrendered change is not yet seen. The sweep runs here too:
    // an erasure's reach into the checkpoints is part of what the step's page observable names.
    afterRun: async () => {
      await runSweep();
      await refreshDrawer(before, step.id);
      await rerender();
    },
  });
  if (!outcome.ok) {
    ui.refusal = outcome.message;
    await rerender();
    return;
  }
  // The boundary: a green lesson freezes its store for the revert rail. A refusal here is the
  // student's to read — the lesson still stands; only the undo into this moment is missing.
  if (await lesson.check(ctx)) {
    const taken = await bankCheckpoint(loam, ctx, lesson.id, {
      label: `lesson ${lesson.id}, step ${step.id}`,
    });
    if (!taken.ok) ui.refusal = taken.message;
  }
  await rerender();
}

// ---- the progress rail --------------------------------------------------------------------------

/** A quiz claim names its question by key (`<quiz>#<n>`); look the sentence back up in the arc. */
function askOf(key) {
  const cut = key.lastIndexOf("#");
  if (cut === -1) return undefined;
  const quizId = key.slice(0, cut);
  const index = Number(key.slice(cut + 1));
  const lesson = arc.find((l) => l.quiz !== undefined && l.quiz.id === quizId);
  return lesson?.quiz.questions[index]?.ask;
}

function renderRail(progress) {
  const rail = $("#progress-rail");
  rail.textContent = "";
  const head = document.createElement("h3");
  head.textContent = "your progress";
  rail.appendChild(head);
  line(
    rail,
    "pane-hint",
    "every mark here is a record in your own store — nothing about you is kept anywhere else",
  );

  const checkpoints = new Set(checkpointLessons(storage));
  const resume = resumeState(arc, progress);
  for (const lesson of arc) {
    const row = document.createElement("div");
    row.className = "rail-row";
    row.dataset.railLesson = String(lesson.id);
    const done = lessonIsGreen(lesson, progress);
    const reachable = lesson.id <= resume.lessonId;

    const jump = document.createElement("button");
    jump.className = "rail-jump";
    jump.textContent = `${done ? "✓" : reachable ? "○" : "·"} ${lesson.id}. ${lesson.title}`;
    jump.disabled = !reachable;
    jump.onclick = () => act(() => goToLesson(lesson.id));
    row.appendChild(jump);

    if (checkpoints.has(lesson.id)) {
      const ckpt = document.createElement("span");
      ckpt.className = "rail-ckpt";
      ckpt.dataset.ckpt = String(lesson.id);
      ckpt.textContent = "checkpoint";
      const revert = document.createElement("button");
      revert.className = "secondary";
      revert.dataset.revert = String(lesson.id);
      revert.textContent = "revert to here";
      revert.onclick = () =>
        act(async () => {
          ui.askRevert = lesson.id;
          ui.askStartOver = false;
          await rerender();
        });
      row.append(ckpt, revert);
    }

    if (ui.askRevert === lesson.id) row.appendChild(confirmBox("revert", lesson.id));
    rail.appendChild(row);
  }

  const answered = [...progress.quiz.entries()];
  if (answered.length > 0) {
    const quizHead = document.createElement("h3");
    quizHead.textContent = "what you answered";
    rail.appendChild(quizHead);
    for (const [question, result] of answered) {
      const row = document.createElement("div");
      row.className = "rail-quiz";
      row.dataset.quizResult = question;
      row.dataset.correct = String(result.correct);
      // The claim names the question by key; a person deserves the question itself.
      row.textContent = `${askOf(question) ?? question} — ${result.correct ? "right" : "not this time"}`;
      rail.appendChild(row);
    }
  }
}

/**
 * The in-page confirmation. It is a control, not a dialog: the page keeps running, the student
 * can read what is about to happen, and a rail can answer it — none of which is true of
 * `window.confirm`, which is why the page never calls one.
 */
function confirmBox(what, lesson) {
  const box = document.createElement("div");
  box.className = "confirm";
  if (what === "revert") {
    box.dataset.confirmRevert = String(lesson);
    box.textContent = `Go back to the store exactly as it stood after lesson ${lesson}? Everything you have done since is discarded.`;
  } else {
    box.id = "confirm-start-over";
    box.textContent =
      "Erase this store — every record, your key, and every checkpoint — and begin again at lesson 1? This cannot be undone.";
  }
  const yes = document.createElement("button");
  yes.setAttribute("data-confirm-yes", "");
  yes.textContent = what === "revert" ? "yes, take me back" : "yes, erase it all";
  yes.onclick = () => act(() => (what === "revert" ? doRevert(lesson) : doStartOver()));
  const no = document.createElement("button");
  no.className = "secondary";
  no.setAttribute("data-confirm-no", "");
  no.textContent = "cancel";
  no.onclick = () =>
    act(async () => {
      ui.askRevert = null;
      ui.askStartOver = false;
      await rerender();
    });
  box.append(yes, no);
  return box;
}

async function doRevert(lesson) {
  // The erased ids ride along as PROOF rather than an assumption that some earlier sweep
  // cleaned this blob: a revert is the one motion that writes old bytes back, and it must not
  // be the way a forgotten record comes home.
  const erasedIds = [...loam.readTombstones(gateway.reactor, author)];
  const restored = restoreCheckpoint(storage, lesson, { erasedIds });
  ui.askRevert = null;
  if (!restored.ok) {
    // A refused revert still leaves the store holding rows this attempt put back, so the page
    // must not go on rendering the ground it remembers. Reload with the message in hand: what
    // is on screen and what is in the store have to be the same thing.
    storage.setItem(REVERT_NOTE_KEY, restored.message);
    window.location.reload();
    return;
  }
  const said = [];
  // Say it out loud rather than quietly restoring less, or more, than the student asked for.
  if (restored.refused.length > 0) {
    said.push(
      `${restored.refused.length} record(s) this checkpoint held were erased since, and were not brought back.`,
    );
  }
  if (restored.keptOrders.length > 0) {
    said.push(
      `${restored.keptOrders.length} erasure receipt(s) stayed: an undo may take back your work, never a forgetting.`,
    );
  }
  if (said.length > 0) storage.setItem(REVERT_NOTE_KEY, said.join(" "));
  window.location.reload(); // the panes re-render from the restored ground, by construction
}

async function doStartOver() {
  ui.askStartOver = false;
  for (const key of Object.keys(storage)) {
    if (key.startsWith(STORE_PREFIX) || key === SEED_KEY) storage.removeItem(key);
  }
  clearCheckpoints(storage); // an undo into a store that no longer exists is a lie
  storage.removeItem(PINS_KEY);
  window.location.reload();
}

// ---- the quiz ------------------------------------------------------------------------------------

function quizOnOffer(lesson, progress) {
  const quiz = lesson.quiz;
  if (quiz === undefined || quiz === null) return null;
  if (!lessonIsGreen(lesson, progress)) return null;
  if (progress.skipped.has(quiz.id) || ui.quizDismissed.has(quiz.id)) return null;
  return quiz;
}

function renderQuiz(progress) {
  const holder = $("#quiz-holder");
  holder.textContent = "";
  const lesson = lessonOf(ui.lesson);
  const quiz = quizOnOffer(lesson, progress);
  if (quiz === null) return;

  const card = document.createElement("section");
  card.id = "quiz-card";
  card.dataset.quiz = quiz.id;
  const head = document.createElement("h3");
  head.textContent = "a few questions, if you want them";
  card.appendChild(head);
  line(card, "pane-hint", "nothing here is graded, and skipping costs you nothing");

  quiz.questions.forEach((question, index) => {
    const key = `${quiz.id}#${index}`;
    const block = document.createElement("div");
    block.className = "question";
    block.dataset.question = key;
    line(block, "ask", question.ask);
    const answered = progress.quiz.get(key);
    question.choices.forEach((choice, choiceIndex) => {
      const button = document.createElement("button");
      button.dataset.choice = String(choiceIndex);
      button.className = "secondary";
      button.textContent = choice;
      button.disabled = answered !== undefined;
      button.onclick = () =>
        act(async () => {
          await answerQuiz(loam, ctx, quiz, index, choiceIndex);
          await rerender();
        });
      block.appendChild(button);
    });
    if (answered !== undefined) {
      const verdict = document.createElement("div");
      verdict.className = answered.correct ? "verdict ok" : "verdict bad";
      verdict.textContent = answered.correct
        ? "that is it exactly."
        : "not this time — and that is what the arc is for.";
      block.appendChild(verdict);
      const teaches = lesson.steps.find((s) => s.id === question.teaches);
      if (!answered.correct && teaches !== undefined) {
        const link = document.createElement("button");
        link.className = "link";
        link.dataset.teaches = teaches.id;
        link.textContent = `the step that teaches it: ${teaches.label}`;
        link.onclick = () =>
          act(async () => {
            ui.lesson = lesson.id;
            ui.highlightStep = teaches.id;
            await rerender();
          });
        block.appendChild(link);
      }
    }
    card.appendChild(block);
  });

  const skip = document.createElement("button");
  skip.id = "quiz-skip";
  skip.textContent = quiz.questions.every((_, i) => progress.quiz.has(`${quiz.id}#${i}`))
    ? "done"
    : "skip this quiz";
  skip.onclick = () =>
    act(async () => {
      await skipQuiz(loam, ctx, quiz);
      ui.quizDismissed.add(quiz.id);
      await rerender();
    });
  card.appendChild(skip);
  holder.appendChild(card);
}

// ---- the glossary ---------------------------------------------------------------------------------

function renderGlossary() {
  const holder = $("#glossary-entries");
  holder.textContent = "";
  const entries = readGlossary(ctx);
  if (entries.length === 0) {
    line(holder, "pane-hint", "nothing yet — each lesson introduces its words as it needs them");
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "glossary-entry";
    row.dataset.term = entry.term;
    row.dataset.deltaId = entry.deltaId;
    const term = document.createElement("strong");
    term.textContent = entry.term;
    const meaning = document.createElement("span");
    meaning.textContent = ` — ${entry.meaning}`;
    const where = document.createElement("button");
    where.className = "link";
    where.dataset.where = entry.term;
    where.textContent = "where does this live?";
    // The reveal, made operable: this entry is a claim in the student's own ground, and the
    // control walks them to the exact row rather than asserting it.
    where.onclick = () =>
      act(async () => {
        groundState.showTutorial = true;
        groundState.highlight = entry.deltaId;
        showPane("ground");
        await rerender();
      });
    row.append(term, meaning, where);
    holder.appendChild(row);
  }
}

// ---- the sweep notice ------------------------------------------------------------------------------

async function runSweep() {
  const dead = [...loam.readTombstones(gateway.reactor, author)];
  if (dead.length === 0) return;
  const report = sweepCheckpoints(storage, dead);
  if (report.destroyed.length > 0) ui.sweep = { ...report, erased: dead };
}

function renderSweep() {
  const holder = $("#sweep-holder");
  holder.textContent = "";
  if (ui.sweep === null) return;
  const notice = document.createElement("section");
  notice.id = "sweep-notice";
  notice.dataset.erased = ui.sweep.erased.join(" ");
  const head = document.createElement("h3");
  head.textContent = "the forgetting reached your checkpoints";
  notice.appendChild(head);
  line(
    notice,
    "pane-hint",
    "a checkpoint is a copy, and a copy holds the bytes — so the right to be forgotten costs you your undo into the time the thing was known",
  );
  for (const gone of ui.sweep.destroyed) {
    const row = document.createElement("div");
    row.className = "swept";
    row.dataset.swept = String(gone.lesson);
    row.textContent = `destroyed — the checkpoint after lesson ${gone.lesson}: ${gone.reason}`;
    notice.appendChild(row);
  }
  for (const kept of ui.sweep.kept) {
    const row = document.createElement("div");
    row.className = "kept";
    row.dataset.kept = String(kept.lesson);
    row.textContent = `kept — the checkpoint after lesson ${kept.lesson} never held those bytes`;
    notice.appendChild(row);
  }
  holder.appendChild(notice);
}

// ---- the introspection drawer -------------------------------------------------------------------

// The drawer answers "is that really what happened?" with the store's own two answers: the
// shape it can be asked about right now, and the records the last step actually moved. Both
// come from the live gateway on every render — there is no fixture behind this pane.
async function refreshDrawer(before, stepId) {
  const now = gateway.offeredDeltas();
  const nowIds = new Set(now.map((d) => d.id));
  ui.lastStep = {
    stepId,
    added: now.filter((d) => !before.has(d.id)).map((d) => d.id),
    removed: [...before].filter((id) => !nowIds.has(id)),
  };
  await refreshSdl();
}

async function refreshSdl() {
  const schema = await introspect(false);
  ui.sdl =
    schema === null
      ? "no lens is registered yet — a store answers no questions until you describe one"
      : printSchema(schema);
}

function renderDrawer() {
  $("#drawer-body").hidden = !ui.drawerOpen;
  $("#drawer-sdl").textContent = ui.sdl;
  const holder = $("#drawer-deltas");
  holder.textContent = "";
  if (ui.lastStep === null) {
    line(holder, "pane-hint", "run a step and this fills with the records it moved");
    return;
  }
  line(holder, "pane-hint", `what step ${ui.lastStep.stepId} did to the ground:`);
  for (const id of ui.lastStep.added) {
    const row = document.createElement("div");
    row.className = "drawer-delta";
    row.dataset.deltaId = id;
    row.textContent = `+ ${id}`;
    holder.appendChild(row);
  }
  for (const id of ui.lastStep.removed) {
    const row = document.createElement("div");
    row.className = "drawer-delta gone";
    // NOT `data-delta-id`: these bytes are no longer in the ground, and a marker that says
    // "here is a record" must never point at one the store no longer holds.
    row.dataset.goneId = id;
    row.textContent = `− ${id} (gone from the ground)`;
    holder.appendChild(row);
  }
}

// ---- the panes ------------------------------------------------------------------------------------

async function renderView() {
  await renderViews($("#view-cards"), ctx, ui);
}

function renderGroundPane() {
  $("#ground-show-tutorial").checked = groundState.showTutorial;
  renderGround($("#ground-rows"), gateway.offeredDeltas(), author, loam.toWire, groundState);
}

function showPane(name) {
  for (const tab of document.querySelectorAll(".tabs button")) {
    tab.classList.toggle("active", tab.dataset.pane === name);
  }
  for (const pane of document.querySelectorAll(".pane")) {
    pane.classList.toggle("active", pane.id === `pane-${name}`);
  }
}

// ---- the editor: hints from the LIVE schema, re-derived as the store evolves ---------------

async function introspect(asStranger) {
  try {
    const q = getIntrospectionQuery();
    const res = asStranger ? await gateway.queryPublic(q) : await gateway.query(q);
    if (res.data == null) return null;
    return buildClientSchema(res.data);
  } catch {
    return null; // no surface yet — the pane says which lesson grows one
  }
}

/**
 * A read of whatever this store can currently answer — derived from ITS OWN registrations, so
 * the page never has to know what the arc is about. The editor opens on it, and the View pane's
 * subscription follows the same lens; an arc that renames every entity changes neither.
 */
function firstReadable() {
  for (const version of gateway.registrationVersions()) {
    const root = version.roots[0];
    if (root === undefined) continue;
    const name = version.hyperschema.name;
    const field = name.charAt(0).toLowerCase() + name.slice(1);
    return { field, root, props: [...version.schema.props.keys()] };
  }
  return null;
}

const NO_LENS_YET = "# nothing is registered yet — describe a lens and this pane comes alive\n";
const readAloud = (r) =>
  `{ ${r.field}(entity: ${JSON.stringify(r.root)}) { ${r.props.join(" ")} } }`;

const opening = firstReadable();
const editor = new EditorView({
  doc: opening === null ? NO_LENS_YET : readAloud(opening),
  extensions: [basicSetup, graphqlLang()],
  parent: $("#gql-editor"),
});

/**
 * When the store grows its first lens, the console stops apologizing and offers a real question.
 * Only ever while the editor still holds the placeholder EXACTLY — a student's own draft is
 * theirs, and a pane that rewrote what someone was typing would be worse than an empty one.
 */
function offerFirstQuestion() {
  if (editor.state.doc.toString() !== NO_LENS_YET) return;
  const readable = firstReadable();
  if (readable === null) return;
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: readAloud(readable) },
  });
}

// A call token keeps racing introspections honest: only the LATEST request may install its
// schema, so a fast toggle mid-render cannot leave the stranger's schema under the operator's
// caption.
let introspectionTurn = 0;
async function refreshEditorSchema() {
  offerFirstQuestion();
  const turn = ++introspectionTurn;
  const asStranger = $("#gql-stranger").checked;
  const schema = await introspect(asStranger);
  if (turn !== introspectionTurn) return;
  $("#gql-schema-state").textContent =
    schema === null
      ? asStranger
        ? "the stranger sees no surface — nothing here is public"
        : "the store has no surface yet — describing a lens grows one, and hints appear here"
      : asStranger
        ? "hinting against the ANONYMOUS schema — a smaller world, by declaration"
        : "hinting against the live schema — it re-derives every time a registration lands";
  updateSchema(editor, schema ?? undefined);
}

$("#gql-run").onclick = () =>
  act(async () => {
    const src = editor.state.doc.toString();
    const asStranger = $("#gql-stranger").checked;
    let text;
    try {
      const res = asStranger ? await gateway.queryPublic(src) : await gateway.query(src);
      text = JSON.stringify(res, null, 2);
    } catch (err) {
      text = String(err.message ?? err);
    }
    // A run may have been a WRITE — the console speaks to the same door — so every pane has to
    // show it rather than wait for the next click. The sweep runs for the same reason: this
    // door reaches the whole gateway, and a checkpoint holding erased bytes must not wait for
    // the next lesson step to be found.
    await runSweep();
    await rerender();
    $("#gql-out").textContent = text; // after the rerender, so the answer survives it
  });

$("#gql-stranger").onchange = () => act(() => refreshEditorSchema());

$("#gql-pin").onclick = () =>
  act(async () => {
    const src = editor.state.doc.toString();
    if (!isReadOnlyDocument(src)) {
      $("#gql-out").textContent =
        "only plain reads pin to Views — a pinned mutation would re-run itself on every render, which is a write loop wearing a bookmark's clothes";
      return;
    }
    const label = $("#gql-pin-label").value.trim() || `query ${ui.savedQueries.size + 1}`;
    ui.savedQueries.set(label, src);
    ui.persist();
    $("#gql-pin-label").value = "";
    await renderView();
    $("#gql-out").textContent = `pinned to Views as "${label}"`;
  });

for (const tab of document.querySelectorAll(".tabs button")) {
  tab.onclick = () => showPane(tab.dataset.pane);
}

$("#ground-show-tutorial").onchange = () =>
  act(async () => {
    groundState.showTutorial = $("#ground-show-tutorial").checked;
    await rerender();
  });

$("[data-drawer-toggle]").onclick = () =>
  act(async () => {
    ui.drawerOpen = !ui.drawerOpen;
    await refreshSdl();
    await rerender();
  });

$("#start-over").onclick = () =>
  act(async () => {
    ui.askStartOver = true;
    ui.askRevert = null;
    await rerender();
  });

$("#export").onclick = () =>
  act(async () => {
    const blob = new Blob([buildExport(loam, ctx)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-store.json";
    a.click();
    URL.revokeObjectURL(a.href);
    // The file carries the SEED — say so, every time. It is what makes the export the same
    // store on the other machine, and it is also the student's key: this page's data is
    // disposable, and real data keeps its seed in its owner's own custody. The file also
    // carries the tutorial's own records — the progress and the answers — because they are
    // ordinary claims in this store, which is the lesson and is also worth stating.
    ui.notice =
      "the file carries your key ON PURPOSE — it is what makes this the SAME store when you " +
      "pull it, and it is why tutorial data is disposable data. Your progress and your answers " +
      "ride along too: they were always ordinary records in here.";
    await rerender();
  });

// The View pane is a real SUBSCRIPTION where one exists; before any registration, or after a
// reseat, it simply re-attaches.
async function watchStore() {
  for (;;) {
    try {
      // Whatever this store can answer, asked of the store itself — an evolution or a whole new
      // arc changes the question, and the pane follows without a line changing here.
      const readable = firstReadable();
      if (readable !== null && readable.props.length > 0) {
        const sub = await gateway.subscribe(
          `subscription { ${readable.field}(entity: ${JSON.stringify(readable.root)}) { ${readable.props.join(" ")} } }`,
        );
        for (;;) {
          const item = await sub.next();
          if (item.done) break;
          await renderView();
        }
      }
    } catch {
      /* no surface yet */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
}

// ---- the loop --------------------------------------------------------------------------------

async function rerender() {
  const progress = readProgress(ctx);
  renderLesson(progress);
  renderRail(progress);
  renderQuiz(progress);
  renderSweep();
  renderGlossary();
  renderDrawer();
  const holder = $("#start-over-holder");
  holder.textContent = "";
  if (ui.askStartOver) holder.appendChild(confirmBox("start-over"));
  await renderView();
  renderGroundPane();
  await refreshEditorSchema();
}

ui.lesson = resumeState(arc, readProgress(ctx)).lessonId;
// A message a revert left for the student, read once and taken off the shelf.
const note = storage.getItem(REVERT_NOTE_KEY);
if (note !== null) {
  ui.refusal = note;
  storage.removeItem(REVERT_NOTE_KEY);
}
await enterLesson(loam, ctx, lessonOf(ui.lesson));
await runSweep(); // a checkpoint that outlived an erasure must not survive a reload either
await refreshSdl();
await rerender();
window.tutorial.ready = true;
void watchStore();
