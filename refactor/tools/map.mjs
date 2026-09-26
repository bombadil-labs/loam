// Draws refactor/map.svg, the picture at the top of refactor/MAP.md. Edit ROWS and KEEPS below, then
// run `node refactor/tools/map.mjs`. The rows run in plan-step order; a status names its color.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UPDATED = "2026-09-26";

// done | doing | next | planned | retired
const ROWS = [
  {
    step: "3",
    loam: "Clocks and ordering",
    tier: "delta, codec, syntax",
    what: "signed times, explicit now",
    status: "done",
  },
  {
    step: "4",
    loam: "34 negation readers",
    tier: "reactor",
    what: "negationPredicate, negationWitnesses",
    status: "done",
  },
  {
    step: "4",
    loam: "Rules readers",
    tier: "schema",
    what: "governedDeltas, governed loaders, lens binding",
    status: "done",
  },
  {
    step: "4",
    loam: "Registrations, latest-wins picks",
    tier: "resolve",
    what: "applyPolicy, ordering",
    status: "done",
  },
  {
    step: "5",
    loam: "Seed file, user and connection keys",
    tier: "principal",
    what: "roots, key binding, succession",
    status: "next",
  },
  {
    step: "6",
    loam: "Containers, pools, channels",
    tier: "federation",
    what: "peers, admission, arrival",
    status: "planned",
  },
  {
    step: "7",
    loam: "Offers, publish lenses, HTTP wire",
    tier: "federation: publish / subscribe",
    what: "closure rule, set digest",
    status: "planned",
  },
  { step: "8", loam: "Resolvers", tier: "resolve ABI", what: "resolver values", status: "planned" },
  {
    step: "9",
    loam: "Erasure, receipts, refused ids",
    tier: "erasure",
    what: "erase, probe, orders, receipts",
    status: "planned",
  },
  {
    step: "10",
    loam: "Derivation runner",
    tier: "derivation",
    what: "artifacts, module ABI",
    status: "planned",
  },
  {
    step: "—",
    loam: "Migration chain",
    tier: "retired",
    what: "greenfield: nothing to carry",
    status: "retired",
  },
];

const KEEPS = [
  "Endpoints: GraphQL, REST, MCP",
  "CLI and operator workflows",
  "People: users, login, OAuth",
  "Apps, renderers, admin, site",
  "Policy: whose rules, curse scope",
];

const STYLE = {
  done: { fill: "#dcfce7", stroke: "#15803d", text: "#14532d", label: "done" },
  doing: { fill: "#fef3c7", stroke: "#b45309", text: "#78350f", label: "in progress" },
  next: { fill: "#dbeafe", stroke: "#1d4ed8", text: "#1e3a8a", label: "next" },
  planned: { fill: "#f4f4f5", stroke: "#a1a1aa", text: "#3f3f46", label: "planned" },
  retired: { fill: "#ffffff", stroke: "#d4d4d8", text: "#a1a1aa", label: "retired" },
};
const APP = { fill: "#ede9fe", stroke: "#6d28d9", text: "#3b0764" };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const FONT = "font-family='ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif'";

const ROW_H = 46;
const TOP = 96;
const COL = { loam: 24, step: 318, tier: 380, keep: 812 };
const W = { loam: 270, tier: 380, keep: 250 };
const height = TOP + ROWS.length * ROW_H + 60;
const width = COL.keep + W.keep + 24;

const box = (x, y, w, h, s, dashed = false) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"${dashed ? " stroke-dasharray='5 4'" : ""}/>`;
const text = (x, y, t, color, size = 13, weight = 400, anchor = "start") =>
  `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(t)}</text>`;

const out = [];
out.push(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
);
out.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
out.push(text(24, 32, "Loam → rhizomatic vNext: the refactor map", "#18181b", 18, 700));
out.push(
  text(
    24,
    54,
    `Updated ${UPDATED}. Each row: a mechanism Loam built by hand → the plan step → the rhizomatic tier that takes it over.`,
    "#52525b",
    12,
  ),
);
out.push(text(COL.loam, 82, "LOAM TODAY (hand-built)", "#71717a", 11, 700));
out.push(text(COL.step + 18, 82, "STEP", "#71717a", 11, 700, "middle"));
out.push(text(COL.tier, 82, "RHIZOMATIC VNEXT (tier library)", "#71717a", 11, 700));
out.push(text(COL.keep, 82, "STAYS LOAM'S (app-specific)", "#71717a", 11, 700));

ROWS.forEach((r, i) => {
  const y = TOP + i * ROW_H;
  const s = STYLE[r.status];
  const retired = r.status === "retired";
  out.push(box(COL.loam, y, W.loam, ROW_H - 10, s, retired));
  out.push(text(COL.loam + 12, y + 23, r.loam, s.text, 13, 500));
  out.push(`<circle cx="${COL.step + 18}" cy="${y + 18}" r="14" fill="${s.stroke}"/>`);
  out.push(text(COL.step + 18, y + 22.5, r.step, "#ffffff", 12, 700, "middle"));
  out.push(
    `<line x1="${COL.loam + W.loam}" y1="${y + 18}" x2="${COL.step + 4}" y2="${y + 18}" stroke="${s.stroke}" stroke-width="1.5"/>`,
  );
  if (!retired) {
    out.push(
      `<line x1="${COL.step + 32}" y1="${y + 18}" x2="${COL.tier - 6}" y2="${y + 18}" stroke="${s.stroke}" stroke-width="1.5"/>`,
    );
    out.push(
      `<path d="M ${COL.tier - 6} ${y + 13} L ${COL.tier} ${y + 18} L ${COL.tier - 6} ${y + 23} Z" fill="${s.stroke}"/>`,
    );
  }
  out.push(box(COL.tier, y, W.tier, ROW_H - 10, s, retired));
  out.push(text(COL.tier + 12, y + 16, r.tier, s.text, 13, 700));
  out.push(text(COL.tier + 12, y + 31, r.what, s.text, 11.5));
});

const keepTop = TOP;
const keepH = KEEPS.length * ROW_H + 8;
out.push(
  `<rect x="${COL.keep - 8}" y="${keepTop - 8}" width="${W.keep + 16}" height="${keepH}" rx="10" fill="#faf5ff" stroke="#c4b5fd"/>`,
);
KEEPS.forEach((k, i) => {
  const y = keepTop + i * ROW_H;
  out.push(box(COL.keep, y, W.keep, ROW_H - 10, APP));
  out.push(text(COL.keep + 12, y + 23, k, APP.text, 12.5, 500));
});
const arrowY = keepTop + keepH + 22;
out.push(text(COL.keep, arrowY, "Loam calls the tiers on the left", "#6d28d9", 11.5));
out.push(text(COL.keep, arrowY + 15, "and keeps only these.", "#6d28d9", 11.5));

const ly = height - 26;
let lx = 24;
for (const k of ["done", "doing", "next", "planned", "retired"]) {
  const s = STYLE[k];
  out.push(box(lx, ly - 12, 16, 16, s, k === "retired"));
  out.push(text(lx + 22, ly + 1, s.label, "#3f3f46", 12));
  lx += 22 + s.label.length * 7 + 26;
}
out.push("</svg>");

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "map.svg");
writeFileSync(target, out.join("\n") + "\n");
console.log(`map: wrote ${target}`);
