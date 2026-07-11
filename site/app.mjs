// The tutorial page (SPEC §16). Zero framework on purpose: the STORE is the state and this
// file is a subscriber — every pane and every green mark is recomputed from the ground or a
// live query, never from a variable that could drift. The lessons themselves live in
// lessons.mjs (shared verbatim with the headless CI arc); this file is only their theater.

import * as loam from "@bombadil/loam/browser";
import {
  ALICE,
  FILM,
  buildArc,
  buildExport,
  bootTutorialStore,
  recordHomecoming,
} from "./lessons.mjs";

const $ = (sel) => document.querySelector(sel);

// ---- boot ------------------------------------------------------------------------------------

const storage = window.localStorage;
const { gateway, seed, author } = await bootTutorialStore(loam, storage);

let clock = Date.now();
const ctx = {
  gateway,
  storage,
  seed,
  author,
  packets: {
    circle: (await (await fetch("./packets/circle.json")).json()).deltas,
    adversary: (await (await fetch("./packets/adversary.json")).json()).deltas,
  },
  ts: () => (clock = Math.max(Date.now(), clock + 1)),
};

const arc = buildArc(loam);
let current = 1;
const greens = new Map(); // lesson id -> boolean, recomputed from the ground

// The console door for the curious — the copy invites it, so it is really there.
window.loam = loam;
window.store = gateway;
window.tutorialCtx = ctx;

$("#author-chip").textContent = author;

// ---- rendering -------------------------------------------------------------------------------

async function refreshGreens() {
  for (const lesson of arc) greens.set(lesson.id, await lesson.check(ctx));
  // land on the first unfinished lesson at boot; never yank the reader around afterwards
  return arc.find((l) => !greens.get(l.id))?.id ?? arc[arc.length - 1].id;
}

function renderNav() {
  const nav = $("#lesson-nav");
  nav.innerHTML = "";
  for (const lesson of arc) {
    const b = document.createElement("button");
    b.className = lesson.id === current ? "current" : "";
    const mark = greens.get(lesson.id) ? "✓" : "○";
    b.innerHTML = `<span class="mark ${greens.get(lesson.id) ? "" : "todo"}">${mark}</span> ${lesson.id}. ${lesson.title}`;
    b.onclick = () => {
      current = lesson.id;
      renderNav();
      renderLesson();
    };
    nav.appendChild(b);
  }
}

function renderLesson() {
  const lesson = arc.find((l) => l.id === current);
  const el = $("#lesson");
  el.innerHTML = "";
  const no = document.createElement("div");
  no.className = "lesson-no";
  no.textContent = `lesson ${lesson.id} of ${arc.length}`;
  const h = document.createElement("h2");
  h.textContent = lesson.title;
  const p = document.createElement("p");
  p.textContent = lesson.copy;
  el.append(no, h, p);
  el.appendChild(actionsFor(lesson));
}

// Each lesson's stage directions: a Do-it button wired to the SAME perform the CI arc runs,
// plus the controls its copy promises (the inspector, the export, the homecoming).
function actionsFor(lesson) {
  const box = document.createElement("div");
  box.className = "act";
  const done = greens.get(lesson.id);

  const addDoIt = (label) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = async () => {
      b.disabled = true;
      try {
        await lesson.perform(ctx);
        await rerender();
      } catch (err) {
        // No rerender on refusal — it would rebuild this pane and wipe the message.
        b.disabled = false;
        note(box, `the store refused: ${err.message}`, false);
      }
    };
    box.appendChild(b);
    return b;
  };

  if (done) {
    const n = document.createElement("div");
    n.className = "done-note";
    n.textContent = "✓ your store says this is done — re-verified from the ground just now";
    box.appendChild(n);
  }

  switch (lesson.id) {
    case 1:
      if (!done) box.append("The boot already did this — the check reads it off the ground.");
      break;
    case 2: {
      if (!done) addDoIt("Say it: you watched Arrival");
      box.appendChild(inspector());
      break;
    }
    case 3:
      if (!done) addDoIt("Register Film and Book");
      break;
    case 4:
      if (!done) addDoIt("Log the watch — one claim, with Alice");
      break;
    case 5:
      if (!done) addDoIt("Rate it 9, take it back, read the book, try the impossible set");
      break;
    case 6:
      if (!done) addDoIt("Evolve Film: add tags, tag it first-contact");
      break;
    case 7:
      if (!done) addDoIt("Let the stranger's claim in, then change the reader");
      break;
    case 8:
      if (!done) addDoIt("File the note, honor the request, erase it");
      break;
    case 9:
      if (!done) addDoIt("Pull the circle; register your own Person lens");
      break;
    case 10:
      if (!done) addDoIt("Declare Film public — one signed record");
      break;
    case 11:
      box.appendChild(finale());
      break;
  }
  return box;
}

// Lesson 2's promised control: one byte changes, the id shatters, the door would refuse.
function inspector() {
  const wrap = document.createElement("div");
  wrap.style.marginTop = "0.75rem";
  const b = document.createElement("button");
  b.className = "secondary";
  b.textContent = "The inspector: flip one byte of your fact";
  b.onclick = () => {
    const mine = gateway
      .offeredDeltas()
      .find((d) => d.claims.author === author && JSON.stringify(d.claims).includes("Arrival"));
    if (!mine) return note(wrap, "say the fact first — there is nothing to shatter yet", false);
    const wire = loam.toWire(mine);
    // One byte, anywhere in the claims: the id is a hash of ALL of it.
    const bentClaims = JSON.parse(JSON.stringify(wire.claims).replace("Arrival", "Arrivbl"));
    try {
      loam.fromWire({ ...wire, claims: bentClaims });
      note(wrap, "…it survived? that would be a bug worth reporting", false);
    } catch (err) {
      note(
        wrap,
        `one byte changed ("Arrival" → "Arrivbl") and the store refuses it: ${err.message}`,
        true,
      );
    }
  };
  wrap.appendChild(b);
  return wrap;
}

// Lesson 11: export the store, then the homecoming — localhost fetch or paste-the-hash.
function finale() {
  const wrap = document.createElement("div");

  const dl = document.createElement("button");
  dl.textContent = "Export my store (my-store.json)";
  dl.onclick = () => {
    const blob = new Blob([buildExport(loam, ctx)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-store.json";
    a.click();
    URL.revokeObjectURL(a.href);
    note(
      wrap,
      "the file carries your seed ON PURPOSE — disposable tutorial data; real data keeps its seed in your own custody",
      true,
    );
  };
  wrap.appendChild(dl);

  const url = document.createElement("input");
  url.type = "text";
  url.placeholder = "http://127.0.0.1:4321/default  (where loam serve answers)";
  const token = document.createElement("input");
  token.type = "text";
  token.placeholder = "the --token you served with";
  token.value = "anything";
  const go = document.createElement("button");
  go.textContent = "Compare _hex with my served store";
  go.onclick = async () => {
    try {
      const mine = await gateway.query(`{ film(entity: "${FILM}") { _hex } }`);
      const res = await fetch(`${url.value.replace(/\/$/, "")}/graphql`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token.value}`,
        },
        body: JSON.stringify({ query: `{ film(entity: "${FILM}") { _hex } }` }),
      });
      const theirs = await res.json();
      await settle(mine.data?.film?._hex, theirs.data?.film?._hex, wrap);
    } catch (err) {
      note(
        wrap,
        `could not reach it (${err.message}) — some browsers refuse localhost from a hosted page; paste the _hex by hand below (carrying the hash across by hand is, if anything, the better lesson)`,
        false,
      );
    }
  };
  const hex = document.createElement("input");
  hex.type = "text";
  hex.placeholder = "…or paste the _hex your served store printed";
  const byHand = document.createElement("button");
  byHand.className = "secondary";
  byHand.textContent = "Compare pasted _hex";
  byHand.onclick = async () => {
    try {
      const mine = await gateway.query(`{ film(entity: "${FILM}") { _hex } }`);
      await settle(mine.data?.film?._hex, hex.value.trim(), wrap);
    } catch (err) {
      note(
        wrap,
        `this page's store cannot answer yet (${err.message}) — the film view needs lesson 3`,
        false,
      );
    }
  };
  wrap.append(url, token, go, hex, byHand);
  return wrap;
}

async function settle(mineHex, theirsHex, wrap) {
  if (typeof mineHex === "string" && mineHex.length > 0 && mineHex === theirsHex) {
    await recordHomecoming(loam, ctx, mineHex);
    await rerender(); // rebuilds the lesson pane — so the note goes on the NEW act box
    note(
      document.querySelector("#lesson .act") ?? wrap,
      `hash for hash: ${mineHex.slice(0, 16)}… — the same store, there and here. Recorded in the ground, like everything else.`,
      true,
    );
  } else {
    note(
      wrap,
      `no match: this page says ${String(mineHex).slice(0, 16)}…, that says ${String(theirsHex).slice(0, 16)}…`,
      false,
    );
  }
}

function note(parent, text, ok) {
  let r = parent.querySelector(".result");
  if (!r) {
    r = document.createElement("div");
    r.className = "result";
    parent.appendChild(r);
  }
  r.textContent = text;
  r.classList.toggle("ok", ok);
  r.classList.toggle("bad", !ok);
}

// ---- the panes -------------------------------------------------------------------------------

const VIEW_QUERIES = [
  ["film:arrival", `{ film(entity: "${FILM}") { title rating tags watches timesWatched _hex } }`],
  ["book:solaris", `{ book(entity: "book:solaris") { title pagesRead finished } }`],
  [ALICE, `{ person(entity: "${ALICE}") { name follows watchedWith } }`],
];

async function renderView() {
  const holder = $("#view-cards");
  holder.innerHTML = "";
  let anything = false;
  for (const [label, q] of VIEW_QUERIES) {
    try {
      const res = await gateway.query(q);
      const data = res.data && Object.values(res.data)[0];
      if (data == null) continue;
      anything = true;
      const card = document.createElement("div");
      card.className = "card";
      // textContent, never innerHTML: view values can carry ANY string — lesson 7's whole
      // premise is a hostile foreign claim, and it must render as text, not as markup.
      const h3 = document.createElement("h3");
      h3.textContent = label;
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(data, null, 2);
      card.append(h3, pre);
      holder.appendChild(card);
    } catch {
      // no surface yet — the emptiness IS lesson 2's point
    }
  }
  if (!anything) {
    holder.innerHTML = `<p class="pane-hint">nothing resolves yet — the store may hold facts, but no lens has been ground (that is lesson 3)</p>`;
  }
}

function summarizePointer(p) {
  if (p.target.kind === "entity")
    return `${p.role}→${p.target.entity.id}#${p.target.entity.context}`;
  if (p.target.kind === "delta") return `${p.role}→delta:${p.target.deltaRef.delta.slice(0, 10)}…`;
  return `${p.role}=${JSON.stringify(p.target.value)}`;
}

function renderGround() {
  const holder = $("#ground-rows");
  holder.innerHTML = "";
  const deltas = gateway.offeredDeltas();
  const head = document.createElement("p");
  head.className = "pane-hint";
  head.textContent = `${deltas.length} records — each immutable, signed, named by its content`;
  holder.appendChild(head);
  for (const d of [...deltas].sort((a, b) => a.claims.timestamp - b.claims.timestamp)) {
    const mine = d.claims.author === author;
    const row = document.createElement("div");
    row.className = "delta";
    // textContent throughout — a foreign author string or claim value is DATA, never markup.
    const id = document.createElement("span");
    id.className = "id mono";
    id.textContent = `${d.id.slice(0, 12)}… `;
    const who = document.createElement("span");
    who.className = `who ${mine ? "you" : "foreign"}`;
    who.textContent = mine ? "you" : d.claims.author.slice(0, 20) + "…";
    const pointers = document.createElement("pre");
    pointers.textContent = d.claims.pointers.map(summarizePointer).join("  ·  ");
    row.append(id, who, pointers);
    holder.appendChild(row);
  }
}

$("#gql-run").onclick = async () => {
  const src = $("#gql-src").value;
  const asStranger = $("#gql-stranger").checked;
  const out = $("#gql-out");
  try {
    const res = asStranger ? await gateway.queryPublic(src) : await gateway.query(src);
    out.textContent = JSON.stringify(res, null, 2);
  } catch (err) {
    out.textContent = String(err.message ?? err);
  }
};

for (const tab of document.querySelectorAll(".tabs button")) {
  tab.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".pane").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`#pane-${tab.dataset.pane}`).classList.add("active");
  };
}

// The View pane is a real SUBSCRIPTION where one exists (lesson 6 relies on seeing it never
// disconnect); before any registration, or after a reseat, it simply re-attaches.
async function watchFilm() {
  for (;;) {
    try {
      const sub = await gateway.subscribe(
        `subscription { film(entity: "${FILM}") { title rating tags timesWatched } }`,
      );
      for (;;) {
        const item = await sub.next();
        if (item.done) break;
        await renderView();
      }
    } catch {
      /* no surface yet */
    }
    await new Promise((r) => setTimeout(r, 800)); // re-attach: evolution rebinds, erase reseats
  }
}

// ---- the loop --------------------------------------------------------------------------------

async function rerender() {
  await refreshGreens();
  renderNav();
  renderLesson();
  await renderView();
  renderGround();
}

current = await refreshGreens();
renderNav();
renderLesson();
await renderView();
renderGround();
void watchFilm();
