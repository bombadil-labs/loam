// Phase PINNED — A DECLARATION IS PUBLICATION, NOT A PROBE (SPEC §23.8). §17 narrowed the anonymous door
// to a lens's LATEST version, because an anonymous @hash probe was a registration-existence oracle. But a
// renderer PINS a version, and village-as-a-URL wants a stranger reading that pinned route. The
// reconciliation: when the OPERATOR names `Name@vN` in a public declaration, they chose to reveal exactly
// that version — publication, not a probe. This act evolves a lens to v2, pins a renderer to v1, and shows
// the anonymous door serving that pinned v1 route ONLY after the operator declares the pin — every other
// version staying dark to the stranger.

import { parseSchema, parseTerm, signClaims, makeNegationClaims } from "@bombadil/rhizomatic";
import { check, openStore, opToken, summary } from "./harness.mjs";

const GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};
const PICK = { pick: { order: { byTimestamp: "desc" } } };
const NOTICE = { name: "Notice", alg: 1, body: parseTerm(GATHER) };
const V1 = parseSchema({ props: { headline: PICK }, default: PICK });
const V2 = parseSchema({ props: { headline: PICK, subhead: PICK }, default: PICK });
const CARD = 'export default (n) => `<article class="notice"><h1>${n.view.headline}</h1></article>`;';

let almanac;
try {
  almanac = await openStore("almanac");
  const operator = almanac.operator;
  const subject = "notice:townhall";
  const app = (route, token) =>
    fetch(`${almanac.base}/app/${route}/${encodeURIComponent(subject)}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });

  // Clear the stage: strike every surviving pinned/latest notice renderer (the home persists).
  for (const stale of almanac.gateway.renderers().filter((r) => r.route.startsWith("notice"))) {
    await almanac.gateway.append([
      signClaims(makeNegationClaims(operator, Date.now(), stale.deltaId, "phase pinned clears its stage"), almanac.seed),
    ]);
  }

  // Register Notice v1, lay a fact, then EVOLVE to v2 — so "v1" and "the latest" are genuinely different.
  await almanac.gateway.publishRegistration(NOTICE, V1, [subject], undefined, undefined, undefined, ["headline"]);
  await almanac.gateway.append([
    signClaims(
      {
        timestamp: Date.now(),
        author: operator,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: subject, context: "headline" } } },
          { role: "value", target: { kind: "primitive", value: "The bridge reopens Saturday" } },
        ],
      },
      almanac.seed,
    ),
  ]);
  await almanac.gateway.publishRegistration(NOTICE, V2, [subject], undefined, undefined, undefined, ["headline", "subhead"]);

  // Pin a renderer to v1 (the frozen first reading), and declare THAT pin public.
  await almanac.gateway.publishRenderer({ route: "notice-v1", schema: "Notice", version: 1, consumes: ["headline"], bundle: CARD });

  // PINNED.1 — before declaration, the stranger's door is dark to the pinned route (a pin is not latest).
  const before = await app("notice-v1");
  await almanac.gateway.declarePublic(["Notice@v1"]);
  const after = await app("notice-v1");
  const html = await after.text();
  check(
    "pinned.1",
    "a declaration is publication: the anon door serves the v1-pinned route only after the operator declares Notice@v1 (§23.8)",
    before.status === 404 && after.status === 200 && html.includes("The bridge reopens Saturday"),
    `anon ${before.status} → ${after.status}`,
  );

  // PINNED.2 — the operator (full) door serves the pinned route regardless; and a stranger loading the
  // route confirms it is the FROZEN v1 reading (headline only — v2's subhead is not in this pin's schema).
  const full = await app("notice-v1", opToken("almanac"));
  check(
    "pinned.2",
    "the full door serves the pin regardless of declaration; the reading is v1's frozen schema, not the latest",
    full.status === 200 && (await full.text()).includes("The bridge reopens Saturday"),
    `full ${full.status}`,
  );

  // PINNED.3 — history stays un-probable: withdraw the declared version and the anon pinned route goes
  // dark by construction (§23.6), 404 exactly like a never-declared pin — no withdrawn-vs-never oracle.
  const v1 = almanac.gateway.registrationVersions().filter((v) => v.hyperschema.name === "Notice")[0];
  await almanac.gateway.append([
    signClaims(makeNegationClaims(operator, Date.now(), v1.deltaId, "phase pinned withdraws v1"), almanac.seed),
  ]);
  const gone = await app("notice-v1");
  check(
    "pinned.3",
    "withdraw the declared version and the anon pinned route 404s (an app never outlives its source, §23.6) — uniform, no oracle",
    gone.status === 404,
    `after withdraw: ${gone.status}`,
  );
} finally {
  await almanac?.close().catch(() => {});
}
summary("phase pinned — a declaration is publication (§23.8)");
