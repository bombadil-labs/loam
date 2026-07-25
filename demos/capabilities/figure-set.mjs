// The book's figures. Each is a function returning plain data — `{w, h, alt, nodes, edges, extra?}` —
// so `test/site/capabilities.test.ts` can check every edge names a node that exists without a
// browser anywhere near it. `figures.mjs` turns one of these into SVG.
//
// Five of these are the concept deck's own pictures (`demos/tutorial/intro.html`), carried over
// deliberately: a reader who arrived from the deck should recognise the shapes before they read a
// word. The rest are new, and follow the same grammar — an edge runs from the delta that authored
// the pointer to the thing pointed at, and it grips each end at a named port.

import { alice, bob, dead, el, entityHue, faint, ink } from "./figures.mjs";

/** Prior facts stay on the page, dimmed to memory: the ground is append-only, and it should look it. */
const DIM = 0.35;

const label = (svg, n, text, dy = -34, fill = entityHue) =>
  Object.assign(
    el(
      "text",
      { x: n.x, y: n.y + dy, "text-anchor": "middle", "font-size": 14, fill: fill() },
      svg,
    ),
    { textContent: text },
  );

const note = (svg, x, y, text) =>
  Object.assign(
    el(
      "text",
      {
        x,
        y,
        "text-anchor": "middle",
        "font-size": 11.5,
        fill: ink(),
        "letter-spacing": ".08em",
      },
      svg,
    ),
    { textContent: text },
  );

export const FIGURES = {
  /** One claim, alone. The smallest true picture of the system. */
  claim: () => ({
    w: 660,
    h: 360,
    alt: "One delta, signed by Alice, pointing at the object olive-oil and at the value 2.",
    nodes: {
      d: {
        kind: "delta",
        x: 330,
        y: 70,
        color: alice(),
        fill: "var(--alice-fill)",
        meta: ["Δ 1e20c4…", "alice · 09:00"],
        tip: "one delta — signed, immutable, and dependent on nothing",
      },
      e: { kind: "entity", x: 180, y: 280, label: ['id: "olive-oil"'] },
      p: { kind: "prim", x: 480, y: 280, label: "2" },
    },
    edges: [
      { from: "d", to: "e", fromPort: "item", toPort: "quantity" },
      { from: "d", to: "p", fromPort: "quantity" },
    ],
  }),

  /** Two people who never met, landing on one id. Nobody created the object. */
  meeting: () => ({
    w: 880,
    h: 380,
    alt: "Two deltas from different authors both pointing at olive-oil, setting different properties.",
    nodes: {
      da: {
        kind: "delta",
        x: 260,
        y: 70,
        color: alice(),
        fill: "var(--alice-fill)",
        dim: DIM,
        metaSide: -1,
        meta: ["Δ alice", "09:00"],
      },
      db: {
        kind: "delta",
        x: 620,
        y: 70,
        color: bob(),
        fill: "var(--bob-fill)",
        meta: ["Δ bob", "11:30"],
        tip: "bob never saw alice's delta, and did not need to",
      },
      e: { kind: "entity", x: 440, y: 290, r: 24, label: ['id: "olive-oil"'] },
      p1: { kind: "prim", x: 120, y: 290, dim: DIM, label: "2" },
      p2: { kind: "entity", x: 760, y: 290, label: ['id: "pantry"'] },
    },
    edges: [
      { from: "da", to: "e", fromPort: "item", toPort: "quantity", dim: DIM },
      { from: "da", to: "p1", fromPort: "quantity", dim: DIM },
      { from: "db", to: "e", fromPort: "item", toPort: "location" },
      { from: "db", to: "p2", fromPort: "location", toPort: "contents" },
    ],
  }),

  /** The same two deltas, pegged from the object instead. Nothing new was said. */
  lifted: () => ({
    w: 860,
    h: 420,
    alt: "The same two deltas seen from the object olive-oil, which now has two properties hanging beneath it.",
    nodes: {
      e: {
        kind: "entity",
        x: 430,
        y: 60,
        r: 24,
        tip: "an id somebody used — not a row anyone made",
      },
      da: {
        kind: "delta",
        x: 250,
        y: 230,
        color: alice(),
        fill: "var(--alice-fill)",
        metaSide: -1,
        meta: ["Δ alice", "09:00"],
      },
      db: {
        kind: "delta",
        x: 610,
        y: 230,
        color: bob(),
        fill: "var(--bob-fill)",
        meta: ["Δ bob", "11:30"],
      },
      p1: { kind: "prim", x: 250, y: 370, label: "2" },
      p2: { kind: "entity", x: 610, y: 370, r: 17, label: ['id: "pantry"'] },
    },
    edges: [
      { from: "da", to: "e", fromPort: "item", toPort: "quantity" },
      { from: "db", to: "e", fromPort: "item", toPort: "location" },
      { from: "da", to: "p1", fromPort: "quantity" },
      { from: "db", to: "p2", fromPort: "location", toPort: "contents" },
    ],
    extra: (svg, N) => label(svg, N.e, 'id: "olive-oil"', -38),
  }),

  /** The fold. The delta layer is gone and each property points straight at its answer. */
  folded: () => ({
    w: 760,
    h: 400,
    alt: "The resolved view: olive-oil with quantity 2 and location pantry, the deltas folded away.",
    nodes: {
      e: { kind: "entity", x: 380, y: 64, r: 24, tip: "this is what an application sees" },
      p1: { kind: "prim", x: 240, y: 320, label: "2" },
      p2: { kind: "entity", x: 520, y: 320, r: 17, label: ['id: "pantry"'] },
    },
    edges: [
      { from: "e", to: "p1", fromPort: "quantity" },
      { from: "e", to: "p2", fromPort: "location" },
    ],
    extra: (svg, N) => {
      label(svg, N.e, 'id: "olive-oil"', -38);
      const at = (a, b, text, dx) =>
        Object.assign(
          el(
            "text",
            {
              x: (N[a].x + N[b].x) / 2 + dx,
              y: (N[a].y + N[b].y) / 2,
              "text-anchor": "middle",
              "font-size": 13.5,
              fill: entityHue(),
              "letter-spacing": ".06em",
            },
            svg,
          ),
          { textContent: text },
        );
      at("e", "p1", "quantity", -46);
      at("e", "p2", "location", 46);
    },
  }),

  /** Two honest answers from one record. The disagreement is preserved, not settled. */
  twoReadings: () => ({
    w: 880,
    h: 430,
    alt: "One contested property read two ways: latest-wins answers zero, trust-alice answers two.",
    nodes: {
      e: { kind: "entity", x: 220, y: 62, r: 20 },
      da: {
        kind: "delta",
        x: 120,
        y: 195,
        color: alice(),
        fill: "var(--alice-fill)",
        r: 26,
        metaSide: -1,
        meta: ["Δ alice", "09:00"],
      },
      db: {
        kind: "delta",
        x: 330,
        y: 195,
        color: bob(),
        fill: "var(--bob-fill)",
        r: 26,
        meta: ["Δ bob", "18:00"],
      },
      p1: { kind: "prim", x: 120, y: 320, label: "2" },
      p2: { kind: "prim", x: 330, y: 320, label: "0" },
      v1: { kind: "entity", x: 640, y: 120, r: 18 },
      o1: { kind: "prim", x: 640, y: 250, label: "0" },
      v2: { kind: "entity", x: 810, y: 120, r: 18 },
      o2: { kind: "prim", x: 810, y: 250, label: "2" },
    },
    edges: [
      { from: "da", to: "e", fromPort: "item", toPort: "quantity" },
      { from: "db", to: "e", fromPort: "item", toPort: "quantity" },
      { from: "da", to: "p1", fromPort: "quantity" },
      { from: "db", to: "p2", fromPort: "quantity" },
      { from: "v1", to: "o1", fromPort: "quantity" },
      { from: "v2", to: "o2", fromPort: "quantity" },
    ],
    extra: (svg, N) => {
      label(svg, N.e, 'id: "olive-oil"', -32);
      note(svg, N.e.x, N.e.y + 52, "two voices, one property");
      Object.assign(
        el(
          "text",
          {
            x: N.v1.x,
            y: 58,
            "text-anchor": "middle",
            "font-size": 12,
            fill: bob(),
            "letter-spacing": ".12em",
          },
          svg,
        ),
        { textContent: "LATEST WINS" },
      );
      Object.assign(
        el(
          "text",
          {
            x: N.v2.x,
            y: 58,
            "text-anchor": "middle",
            "font-size": 12,
            fill: alice(),
            "letter-spacing": ".12em",
          },
          svg,
        ),
        { textContent: "TRUST ALICE" },
      );
      Object.assign(
        el(
          "text",
          {
            x: 725,
            y: 330,
            "text-anchor": "middle",
            "font-size": 12,
            fill: faint(),
            "letter-spacing": ".14em",
          },
          svg,
        ),
        { textContent: "same ground · different trees" },
      );
    },
  }),

  /** A delta about a delta. Nothing was edited and nothing was deleted. */
  struck: () => ({
    w: 740,
    h: 330,
    alt: "A later delta from Bob striking his own earlier delta, which is crossed out but still present.",
    nodes: {
      db: {
        kind: "delta",
        x: 230,
        y: 110,
        color: bob(),
        fill: "var(--bob-fill)",
        dim: 0.45,
        r: 28,
        metaSide: -1,
        meta: ["Δ bob", "18:00"],
        tip: "still here, still signed — and no longer counted",
      },
      p: { kind: "prim", x: 130, y: 280, dim: 0.45, label: "0" },
      e: { kind: "entity", x: 340, y: 280, dim: 0.45 },
      dn: {
        kind: "delta",
        x: 560,
        y: 110,
        color: bob(),
        fill: "var(--bob-fill)",
        r: 28,
        meta: ["Δ bob", "19:00"],
        tip: "a claim whose subject is another claim",
      },
    },
    edges: [
      { from: "db", to: "p", fromPort: "quantity", dim: 0.45 },
      { from: "db", to: "e", fromPort: "item", dim: 0.45 },
      { from: "dn", to: "db", fromPort: "negates", color: "#c05a3f" },
    ],
    extra: (svg, N) => {
      el(
        "line",
        {
          x1: N.db.x - 22,
          y1: N.db.y + 22,
          x2: N.db.x + 22,
          y2: N.db.y - 22,
          stroke: dead(),
          "stroke-width": 2.4,
        },
        svg,
      );
      const t = label(svg, N.e, 'id: "olive-oil"', 44);
      t.setAttribute("opacity", "0.45");
    },
  }),

  /** Standing, and what revocation does to everything downstream of it. */
  standing: () => ({
    w: 800,
    h: 400,
    alt: "The operator grants an admin, who grants a writer; striking the admin's grant also fells the writer's.",
    nodes: {
      op: { kind: "entity", x: 400, y: 60, r: 22, label: ["the operator"] },
      g1: {
        kind: "dead",
        x: 400,
        y: 210,
        r: 26,
        meta: ["Δ grant", "operator → admin"],
        tip: "struck — and everything standing on it falls with it",
      },
      admin: { kind: "entity", x: 250, y: 340, r: 17, dim: 0.5, label: ["admin"] },
      g2: {
        kind: "delta",
        x: 620,
        y: 210,
        r: 22,
        dim: 0.45,
        color: "#9c8f7a",
        meta: ["Δ grant", "admin → writer"],
      },
      writer: { kind: "entity", x: 620, y: 340, r: 17, dim: 0.5, label: ["writer"] },
    },
    edges: [
      { from: "g1", to: "op", fromPort: "granted-by", toPort: "grants" },
      { from: "g1", to: "admin", fromPort: "grantee" },
      { from: "g2", to: "admin", fromPort: "granted-by", toPort: "grants", dim: 0.45 },
      { from: "g2", to: "writer", fromPort: "grantee", dim: 0.45 },
    ],
    extra: (svg, N) => {
      el(
        "line",
        {
          x1: N.g1.x - 20,
          y1: N.g1.y + 20,
          x2: N.g1.x + 20,
          y2: N.g1.y - 20,
          stroke: dead(),
          "stroke-width": 2.4,
        },
        svg,
      );
      note(svg, 400, 390, "revocation is transitive, and it is just a delta");
    },
  }),

  /** What is left after a lawful forgetting: a signed hole, and nothing to read. */
  forgotten: () => ({
    w: 740,
    h: 300,
    alt: "A tombstone signed by the operator pointing at an empty circle where a delta's bytes used to be.",
    nodes: {
      g: { kind: "ghost", x: 230, y: 125, tip: "the bytes are not here — on any tier" },
      dt: {
        kind: "dead",
        x: 560,
        y: 125,
        r: 30,
        meta: ["Δ operator", "tombstone", "who · when · why"],
        tip: "append-only, and itself unerasable",
      },
    },
    edges: [{ from: "dt", to: "g", fromPort: "erases", color: "#c05a3f" }],
    extra: (svg, N) => {
      Object.assign(
        el(
          "text",
          { x: N.g.x, y: N.g.y + 6, "text-anchor": "middle", "font-size": 18, fill: faint() },
          svg,
        ),
        { textContent: "∅" },
      );
      Object.assign(
        el(
          "text",
          { x: N.g.x, y: N.g.y + 58, "text-anchor": "middle", "font-size": 13, fill: faint() },
          svg,
        ),
        { textContent: "bytes gone · the hole remains" },
      );
    },
  }),

  /** The one-way glass, and the single deliberate crossing. */
  oneWayGlass: () => ({
    w: 820,
    h: 340,
    alt: "A primary store feeding a quarantine pool one way, with a single promotion edge crossing back.",
    nodes: {
      primary: { kind: "entity", x: 170, y: 165, r: 30, label: ["your store"] },
      pool: { kind: "entity", x: 650, y: 165, r: 30, label: ["the pool"] },
      guest: {
        kind: "delta",
        x: 650,
        y: 55,
        r: 20,
        color: "#9c8f7a",
        meta: ["Δ the stranger's code"],
        tip: "everything it writes lands here and nowhere else",
      },
      adopted: {
        kind: "delta",
        x: 410,
        y: 285,
        r: 22,
        color: alice(),
        fill: "var(--alice-fill)",
        meta: ["Δ you, re-signing", "cites the guest"],
        tip: "your signature, your claim — and it survives the pool",
      },
    },
    edges: [
      { from: "guest", to: "pool", fromPort: "writes", toPort: "holds" },
      { from: "adopted", to: "primary", fromPort: "adopted-into", toPort: "holds" },
      { from: "adopted", to: "pool", fromPort: "cites", toPort: "computed", dash: "5 4" },
    ],
    extra: (svg, N) => {
      el(
        "line",
        {
          x1: N.primary.x + 34,
          y1: 150,
          x2: N.pool.x - 34,
          y2: 150,
          stroke: faint(),
          "stroke-width": 2,
          "stroke-dasharray": "2 5",
        },
        svg,
      );
      note(svg, 410, 138, "reads follow the ground, live →");
      note(svg, 410, 328, "and only a deliberate re-signing comes back");
    },
  }),

  /** Two grounds, one wire. No consensus and no platform in the middle. */
  twoGrounds: () => ({
    w: 860,
    h: 340,
    alt: "Two stores exchanging signed deltas, each keeping its own readings, with a strike that does not cross.",
    nodes: {
      a: { kind: "entity", x: 160, y: 160, r: 30, label: ["your store"] },
      b: { kind: "entity", x: 700, y: 160, r: 30, label: ["their store"] },
      shared: {
        kind: "delta",
        x: 430,
        y: 70,
        r: 24,
        color: bob(),
        fill: "var(--bob-fill)",
        meta: ["Δ theirs", "admitted by you"],
        tip: "the same bytes, the same address, in both stores",
      },
      strike: {
        kind: "delta",
        x: 430,
        y: 265,
        r: 22,
        color: "#9c8f7a",
        meta: ["Δ a third party", "struck it — over there"],
        tip: "your roster never admitted this author, so nothing here moved",
      },
    },
    edges: [
      { from: "shared", to: "a", fromPort: "admitted", toPort: "holds" },
      { from: "shared", to: "b", fromPort: "authored-in", toPort: "holds" },
      { from: "strike", to: "b", fromPort: "admitted", toPort: "holds" },
      { from: "strike", to: "shared", fromPort: "negates", color: "#c05a3f", dash: "5 4" },
    ],
    extra: (svg) => note(svg, 430, 320, "a strike travels only as far as a roster lets it"),
  }),
};
