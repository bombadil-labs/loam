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

  for (const stale of almanac.gateway.renderers().filter((r) => r.route.startsWith("notice"))) {
    await almanac.gateway.append([
      signClaims(makeNegationClaims(operator, Date.now(), stale.deltaId, "phase pinned clears its stage"), almanac.seed),
    ]);
  }

  await almanac.gateway.publishRegistration(NOTICE, V1, [subject], undefined, undefined, undefined, ["headline"]);
  await almanac.gateway.append([
    signClaims(
      {
        ...((t) => ({ timestamp: t, validFrom: t }))(Date.now()),
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

  await almanac.gateway.publishRenderer({ route: "notice-v1", schema: "Notice", version: 1, consumes: ["headline"], bundle: CARD });

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

  const full = await app("notice-v1", opToken("almanac"));
  check(
    "pinned.2",
    "the full door serves the pin regardless of declaration; the reading is v1's frozen schema, not the latest",
    full.status === 200 && (await full.text()).includes("The bridge reopens Saturday"),
    `full ${full.status}`,
  );

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
