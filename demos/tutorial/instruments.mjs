// The tutorial's instruments (SPEC §19): the panes as tools, not exhibits. This module owns
// the Ground renderer (a real delta reader: kind badges, one-line summaries, expand to wire
// JSON), the View browser (query-fed, seeded with the Schemas meta-view), and the delta
// classifier both stand on. Everything store-derived renders as TEXT, never markup — the
// hostile-claim lesson is exactly why. The GraphQL editor lives in app.mjs (it needs the
// page's CodeMirror wiring); the classifier lives here because it is pure and CI can pin it.

// ---- the classifier ----------------------------------------------------------------------------

// What kind of record is this? Kinds are recognized by the constitutional contexts and
// pointer shapes Loam itself uses — the same grammar the gateway's readers trust.
export function classifyDelta(delta, selfAuthor) {
  const pointers = delta.claims.pointers;
  const hasEntityCtx = (ctx) =>
    pointers.some((p) => p.target.kind === "entity" && p.target.entity.context === ctx);
  const hasDeltaRef = pointers.some((p) => p.target.kind === "delta");

  let kind = "fact";
  let note;
  if (hasEntityCtx("loam.operator")) {
    kind = "constitution";
    note =
      "the store's founding record: it names the operator — the one key whose word is law here";
  } else if (hasEntityCtx("loam.erasure")) {
    kind = "tombstone";
    note = "an erasure order: who asked, when, which id — never what it said";
  } else if (hasEntityCtx("loam.registration")) {
    kind = "registration";
    note = "a lens taking effect: this record is why a schema answers";
  } else if (pointers.some((p) => p.role === "rhizomatic.schema.defines")) {
    kind = "schema";
    note = "a schema definition: the gather program itself, filed as data";
  } else if (hasEntityCtx("loam.public")) {
    kind = "public";
    note = "an open-door declaration: the named lenses answer strangers";
  } else if (hasEntityCtx("loam.trust")) {
    kind = "trust";
    note = "a trust posture: who the federation door admits";
  } else if (
    pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === "loam:store" &&
        p.target.entity.context !== "loam.operator",
    )
  ) {
    kind = "grant";
    note = "standing changing hands: who may write here";
  } else if (hasDeltaRef) {
    kind = "negation";
    note = "a taking-back: it strikes another record by id, and stays on the record itself";
  }

  const foreign = selfAuthor !== undefined && delta.claims.author !== selfAuthor;
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
  constitution: "constitution",
  registration: "registration",
  schema: "schema",
  fact: "fact",
  negation: "negation",
  tombstone: "tombstone",
  public: "public",
  trust: "trust",
  grant: "grant",
};

// Render the ground newest-first: badge, author, one-line summary; click a row for the full
// wire JSON. `seenIds` lets arrivals highlight once; `expanded` keeps open rows open across
// re-renders (the set is the caller's — UI state, not store state).
export function renderGround(holder, deltas, selfAuthor, toWire, state) {
  holder.textContent = "";
  const head = document.createElement("p");
  head.className = "pane-hint";
  head.textContent = `${deltas.length} records — each immutable, signed, named by the hash of its content; newest first`;
  holder.appendChild(head);

  const ordered = [...deltas].sort(
    (a, b) => b.claims.timestamp - a.claims.timestamp || (a.id < b.id ? 1 : -1),
  );
  for (const d of ordered) {
    const { kind, foreign, note } = classifyDelta(d, selfAuthor);
    const row = document.createElement("div");
    row.className = `delta kind-${kind}${state.seen.has(d.id) ? "" : " fresh"}`;

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
      name.textContent = `${v.schema.name} `;
      const detail = document.createElement("span");
      detail.className = "pane-hint";
      const props = [...v.policy.props.keys()].join(", ");
      detail.textContent = `v${v.version} · props: ${props || "(default only)"} · roots: ${v.roots.join(", ")}`;
      row.append(name, detail);
      meta.appendChild(row);
    }
  }
  holder.appendChild(meta);

  // -- one live view per schema root ---------------------------------------------------------
  const latest = new Map();
  for (const v of versions) latest.set(v.schema.name, v);
  for (const [name, v] of latest) {
    for (const root of v.roots) {
      const field = name.charAt(0).toLowerCase() + name.slice(1);
      await renderQueryCard(
        holder,
        ctx,
        `${name}: ${root}`,
        `{ ${field}(entity: ${JSON.stringify(root)}) { _hex ${[...v.policy.props.keys()].join(" ")} } }`,
      );
    }
  }

  // -- the learner's pinned queries ----------------------------------------------------------
  for (const [label, query] of Object.entries(ui.savedQueries)) {
    await renderQueryCard(holder, ctx, `📌 ${label}`, query, () => {
      delete ui.savedQueries[label];
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
    rm.textContent = "unpin";
    rm.onclick = onRemove;
    card.appendChild(rm);
  }
  const pre = document.createElement("pre");
  try {
    const res = await ctx.gateway.query(query);
    const data = res.data && Object.values(res.data)[0];
    pre.textContent = data == null ? "(nothing resolves here yet)" : JSON.stringify(data, null, 2);
  } catch (err) {
    pre.textContent = `(${err.message})`;
  }
  card.appendChild(pre);
  holder.appendChild(card);
}
