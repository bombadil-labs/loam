// The tutorial's instruments (SPEC §19): the panes as tools, not exhibits. This module owns
// the Ground renderer (a real delta reader: kind badges, one-line summaries, expand to wire
// JSON), the View browser (query-fed, seeded with the Schemas meta-view), and the delta
// classifier both stand on. Everything store-derived renders as TEXT, never markup — the
// hostile-claim lesson is exactly why. The GraphQL editor lives in app.mjs (it needs the
// page's CodeMirror wiring); the classifier lives here because it is pure and CI can pin it.

import { parse } from "graphql";
import { isOnlyTutorial, isTutorialDelta } from "./player.mjs";

// Only READS may re-run themselves. A pinned mutation would be executed on every render —
// and a mutation that touches a subscribed view triggers a render, which is a self-
// sustaining write loop wearing a bookmark's clothes. Refused at pin time and at render
// time both; an unparseable document is refused too (never auto-run what you cannot read).
export function isReadOnlyDocument(source) {
  try {
    return parse(source).definitions.every(
      (d) => d.kind !== "OperationDefinition" || d.operation === "query",
    );
  } catch {
    return false;
  }
}

// ---- the classifier ----------------------------------------------------------------------------

// What kind of record is this? Kinds are recognized by the constitutional contexts and
// pointer shapes Loam itself uses — the same grammar the gateway's readers trust.
export function classifyDelta(delta, selfAuthor) {
  const pointers = delta.claims.pointers;
  const hasEntityCtx = (ctx) =>
    pointers.some((p) => p.target.kind === "entity" && p.target.entity.context === ctx);
  const hasDeltaRef = pointers.some((p) => p.target.kind === "delta");

  const foreign = selfAuthor !== undefined && delta.claims.author !== selfAuthor;

  let kind = "fact";
  let note;
  if (hasEntityCtx("loam.operator")) {
    kind = "constitution";
    // A FOREIGN constitutional record is data, not law — lesson 9's thesis must hold on
    // the very row that shows it.
    note = foreign
      ? "another store's founding record — it arrived as data and binds nothing here"
      : "the store's founding record: it names the operator — the one key whose word is law here";
  } else if (hasEntityCtx("loam.erasure")) {
    kind = "tombstone";
    note = foreign
      ? "another operator's erasure order — inert here; only your operator's word removes"
      : "an erasure order: who asked, when, which id — never what it said";
  } else if (hasEntityCtx("loam.registration")) {
    kind = "registration";
    note = foreign
      ? "a foreign lens — it arrived as data and reshapes nothing here"
      : "a lens taking effect: this record is why a schema answers";
  } else if (pointers.some((p) => p.role === "rhizomatic.hyperschema.defines")) {
    kind = "schema";
    note = foreign
      ? "a foreign schema definition — held as data, binding nothing"
      : "a schema definition: the gather program itself, filed as data";
  } else if (hasEntityCtx("loam.public")) {
    kind = "public";
    note = foreign
      ? "another store's open-door declaration — it opens nothing here"
      : "an open-door declaration: the named lenses answer strangers";
  } else if (hasEntityCtx("loam.trust")) {
    kind = "trust";
    note = foreign
      ? "another store's trust posture — your door keeps its own"
      : "a trust posture: who the federation door admits";
  } else if (hasEntityCtx("loam.grants")) {
    // The SAME grammar the gateway's reader keys on (accounts.ts CTX_GRANTS) — a pointer
    // that merely mentions loam:store under some other context is a fact, not standing.
    kind = "grant";
    note = foreign
      ? "standing granted in another store — it gates nothing here"
      : "standing changing hands: who may write here";
  } else if (pointers.some((p) => p.role === "rhizomatic.derived.by")) {
    kind = "derived";
    note = "a derived record: a blessed function ground this out of the store, signed by a runner";
  } else if (hasDeltaRef) {
    kind = "negation";
    note = "a taking-back: it strikes another record by id, and stays on the record itself";
  } else if (isTutorialDelta(delta)) {
    // The tutorial's OWN bookkeeping — progress, quiz answers, glossary entries. It is data like
    // everything else and it is signed like everything else, which is the reveal; but badging it
    // "fact" would bury the student's own records under the record of their reading, in the very
    // pane a lesson tells them to watch. Named, so the Ground pane can hold it back by default.
    //
    // LAST, deliberately. This kind is the only one that can HIDE a row, and `isTutorialDelta`
    // fires on ANY ONE pointer — so testing it first would let a record that is also a grant, a
    // tombstone or a registration disappear behind one tutorial-shaped pointer. Every
    // constitutional kind is decided before this one can claim the row.
    kind = "tutorial";
    note = foreign
      ? "another store's tutorial record — it arrived as data and moves nothing here"
      : "the tutorial's own record: your progress and your glossary live in your store, signed by you";
  }

  return { kind, foreign, note };
}

// One pointer, one phrase — the summary line's vocabulary.
export function summarizePointer(p) {
  if (p.target.kind === "entity")
    return `${p.role} → ${p.target.entity.id} #${p.target.entity.context}`;
  if (p.target.kind === "delta") return `${p.role} → ∂${p.target.deltaRef.delta.slice(0, 10)}…`;
  return `${p.role} = ${JSON.stringify(p.target.value)}`;
}

// ---- the Ground pane ---------------------------------------------------------------------------

const BADGE_LABELS = {
  tutorial: "tutorial",
  constitution: "constitution",
  registration: "registration",
  schema: "schema",
  fact: "fact",
  negation: "negation",
  tombstone: "tombstone",
  public: "public",
  trust: "trust",
  grant: "grant",
  derived: "derived",
};

// Render the ground newest-first: badge, author, one-line summary; click a row for the full
// wire JSON. `seenIds` lets arrivals highlight once; `expanded` keeps open rows open across
// re-renders (the set is the caller's — UI state, not store state).
//
// THE FILTER. `state.showTutorial` is off by default and the tutorial's OWN records are held
// back — a lesson that says "watch the Ground" must not be drowned out by the record of the
// student reading it. Held back, never dropped: the count says how many, the toggle shows them,
// and the glossary's "where does this live?" control turns it on to point at one. Only the
// student's own tutorial records are hidden; a FOREIGN claim wearing the tutorial's vocabulary
// arrived as data and is shown, because hiding it would let a packet write into a blind spot.
// `state.highlight` marks one row by id — the target of that control.
export function renderGround(holder, deltas, selfAuthor, toWire, state) {
  holder.textContent = "";
  const classified = [...deltas].map((d) => ({ d, c: classifyDelta(d, selfAuthor) }));
  // WHAT MAY BE HIDDEN IS EXACTLY WHAT PROGRESS COUNTS — `isOnlyTutorial`, the same predicate
  // the reading uses, so no record can fall between the two rules and be both uncounted and
  // unseen. A delta that is the tutorial's vocabulary AND something else is still badged
  // `tutorial`, and it stays on screen.
  //
  // SIGNED and self-authored too, because `claims.author` is a plain field and an UNSIGNED row
  // is admitted to the ground (the driver quarantines a signature that fails, not one that is
  // missing). Without that test, a row nobody signed could name the student as its author and
  // land in the one place the pane does not look. A writer who has read the seed can sign as
  // them and is not stopped by this; nothing at this layer could.
  const hidden =
    state.showTutorial === true
      ? []
      : classified.filter((x) => isOnlyTutorial(x.d) && !x.c.foreign && x.d.sig !== undefined);
  const shown = classified.filter((x) => !hidden.includes(x));

  const head = document.createElement("p");
  head.className = "pane-hint";
  head.id = "ground-filter-note";
  head.textContent =
    `${shown.length} records — each immutable, signed, named by the hash of its content; newest first` +
    (hidden.length === 0
      ? ""
      : ` · ${hidden.length} more are the tutorial's own records, held back — tick the box above to see them`);
  holder.appendChild(head);

  const ordered = shown
    .map((x) => x.d)
    .sort((a, b) => b.claims.timestamp - a.claims.timestamp || (a.id < b.id ? 1 : -1));
  for (const d of ordered) {
    const { kind, foreign, note } = classifyDelta(d, selfAuthor);
    const row = document.createElement("div");
    const marked = state.highlight === d.id;
    row.className =
      `delta kind-${kind}${state.seen.has(d.id) ? "" : " fresh"}` + (marked ? " highlight" : "");
    row.dataset.kind = kind;
    row.dataset.deltaId = d.id;

    const line = document.createElement("div");
    line.className = "delta-line";
    const badge = document.createElement("span");
    badge.className = `badge badge-${kind}`;
    badge.textContent = BADGE_LABELS[kind];
    const who = document.createElement("span");
    who.className = `who ${foreign ? "foreign" : "you"}`;
    who.textContent = foreign ? `${d.claims.author.slice(0, 18)}…` : "you";
    const id = document.createElement("span");
    id.className = "id mono";
    id.textContent = `${d.id.slice(0, 10)}…`;
    id.title = d.id;
    line.append(badge, who, id);
    row.appendChild(line);

    const summary = document.createElement("pre");
    summary.className = "delta-summary";
    summary.textContent = d.claims.pointers.map(summarizePointer).join("   ·   ");
    row.appendChild(summary);

    if (note !== undefined) {
      const n = document.createElement("div");
      n.className = "delta-note";
      n.textContent = note;
      row.appendChild(n);
    }

    if (state.expanded.has(d.id)) {
      const wire = document.createElement("pre");
      wire.className = "delta-wire";
      wire.textContent = JSON.stringify(toWire(d), null, 2);
      row.appendChild(wire);
    }
    row.onclick = () => {
      if (state.expanded.has(d.id)) state.expanded.delete(d.id);
      else state.expanded.add(d.id);
      renderGround(holder, deltas, selfAuthor, toWire, state);
    };
    holder.appendChild(row);
    state.seen.add(d.id);
  }
}

// ---- the View browser --------------------------------------------------------------------------

// The pane is a browser over QUERIES: the seeded Schemas meta-view (registrations read as
// data — present from lesson 1, so schemas-are-data is visible before it is said), one live
// view per registered schema root, and whatever queries the learner pinned from the editor.
export async function renderViews(holder, ctx, ui) {
  holder.textContent = "";

  // -- Schemas: the meta-view --------------------------------------------------------------
  const meta = document.createElement("div");
  meta.className = "card";
  const metaTitle = document.createElement("h3");
  metaTitle.textContent = "Schemas — the store's lenses, read as data";
  meta.appendChild(metaTitle);
  const versions = ctx.gateway.registrationVersions();
  if (versions.length === 0) {
    const p = document.createElement("p");
    p.className = "pane-hint";
    p.textContent =
      "none yet — the store holds facts happily without any; a lens arrives in lesson 3";
    meta.appendChild(p);
  } else {
    for (const v of versions) {
      const row = document.createElement("div");
      row.className = "schema-row";
      const name = document.createElement("strong");
      name.textContent = `${v.hyperschema.name} `;
      const detail = document.createElement("span");
      detail.className = "pane-hint";
      const props = [...v.schema.props.keys()].join(", ");
      detail.textContent = `v${v.version} · props: ${props || "(default only)"} · roots: ${v.roots.join(", ")}`;
      row.append(name, detail);
      meta.appendChild(row);
    }
  }
  holder.appendChild(meta);

  // -- one live view per schema root ---------------------------------------------------------
  const latest = new Map();
  for (const v of versions) latest.set(v.hyperschema.name, v);
  for (const [name, v] of latest) {
    for (const root of v.roots) {
      const field = name.charAt(0).toLowerCase() + name.slice(1);
      await renderQueryCard(
        holder,
        ctx,
        `${name}: ${root}`,
        `{ ${field}(entity: ${JSON.stringify(root)}) { _hex ${[...v.schema.props.keys()].join(" ")} } }`,
      );
    }
  }

  // -- the learner's pinned queries ----------------------------------------------------------
  for (const [label, query] of ui.savedQueries) {
    await renderQueryCard(holder, ctx, `📌 ${label}`, query, () => {
      ui.savedQueries.delete(label);
      ui.persist();
      void renderViews(holder, ctx, ui);
    });
  }
}

async function renderQueryCard(holder, ctx, label, query, onRemove) {
  const card = document.createElement("div");
  card.className = "card";
  const h3 = document.createElement("h3");
  h3.textContent = label;
  card.appendChild(h3);
  if (onRemove !== undefined) {
    const rm = document.createElement("button");
    rm.className = "unpin";
    rm.textContent = "✕ unpin";
    rm.onclick = onRemove;
    card.appendChild(rm);
  }
  const pre = document.createElement("pre");
  if (!isReadOnlyDocument(query)) {
    pre.textContent =
      "(this pin is not a plain read — only queries re-run themselves; run writes from the editor, on purpose)";
  } else {
    try {
      const res = await ctx.gateway.query(query);
      const data = res.data && Object.values(res.data)[0];
      pre.textContent =
        data == null ? "(nothing resolves here yet)" : JSON.stringify(data, null, 2);
    } catch (err) {
      pre.textContent = `(${err.message})`;
    }
  }
  card.appendChild(pre);
  holder.appendChild(card);
}
