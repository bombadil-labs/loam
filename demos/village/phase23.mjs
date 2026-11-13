import { parseSchema, parseTerm, signClaims, makeNegationClaims } from "@bombadil/rhizomatic";
import { publicClaims } from "../../dist/index.js";
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
const CARD = { name: "Card23", alg: 1, body: parseTerm(GATHER) };
const SCHEMA = parseSchema({ props: { title: PICK, body: PICK }, default: PICK });

const CARD_V1 =
  'export default (n) => `<article class="card"><h1>${n.view.title}</h1><p>${n.view.body}</p></article>`;';
const CARD_V2 =
  'export default (n) => `<article class="card v2"><h1>${n.view.title} ✦</h1><blockquote>${n.view.body}</blockquote></article>`;';

let almanac;
try {
  almanac = await openStore("almanac");
  const operator = almanac.operator;
  const app = (route, entity, token) =>
    fetch(`${almanac.base}/app/${route}/${encodeURIComponent(entity)}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });

  for (const stale of almanac.gateway.renderers().filter((r) => r.route === "card23")) {
    await almanac.gateway.append([
      signClaims(makeNegationClaims(operator, Date.now(), stale.deltaId, "phase 23 clears its stage"), almanac.seed),
    ]);
  }
  for (const stale of almanac.gateway
    .registrationVersions()
    .filter((v) => v.hyperschema.name === "Card23")) {
    await almanac.gateway.append([
      signClaims(makeNegationClaims(operator, Date.now(), stale.deltaId, "phase 23 clears its stage"), almanac.seed),
    ]);
  }

  await almanac.gateway.publishRegistration(CARD, SCHEMA, ["card:almanac"], undefined, undefined, undefined, [
    "title",
    "body",
  ]);
  const fact = (ctx, value) =>
    signClaims(
      {
        ...((t) => ({ timestamp: t, validFrom: t }))(Date.now()),
        author: operator,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: "card:almanac", context: ctx } } },
          { role: "value", target: { kind: "primitive", value } },
        ],
      },
      almanac.seed,
    );
  await almanac.gateway.append([fact("title", "The Almanac"), fact("body", "a place, not a script")]);
  await almanac.gateway.publishRenderer({
    route: "card23",
    schema: "Card23",
    consumes: ["title", "body"],
    bundle: CARD_V1,
  });

  const res = await app("card23", "card:almanac", opToken("almanac"));
  const html = await res.text();
  check(
    "23.1",
    "push a renderer, GET the route — the store serves HTML rendered from its own live view (the database is the deployment)",
    res.status === 200 &&
      (res.headers.get("content-type") ?? "").includes("text/html") &&
      html.includes("<h1>The Almanac</h1>") &&
      html.includes("a place, not a script"),
    `${res.status} — ${html.slice(0, 46)}…`,
  );

  const anonBefore = await app("card23", "card:almanac");
  await almanac.gateway.append([signClaims(publicClaims(["Card23"], operator, Date.now()), almanac.seed)]);
  const anonAfter = await app("card23", "card:almanac");
  const anonHtml = await anonAfter.text();
  check(
    "23.2",
    "read discipline at the screen: the anonymous door serves the face only after the operator opens the lens (§17/§12)",
    anonBefore.status !== 200 && anonAfter.status === 200 && anonHtml.includes("<h1>The Almanac</h1>"),
    `anon ${anonBefore.status} → ${anonAfter.status}`,
  );

  await almanac.gateway.publishRenderer({
    route: "card23",
    schema: "Card23",
    consumes: ["title", "body"],
    bundle: CARD_V2,
  });
  const evolved = await (await app("card23", "card:almanac", opToken("almanac"))).text();
  check(
    "23.3",
    "push again, the face evolves live — one ground, new pixels (✦ and a blockquote now)",
    evolved.includes("The Almanac ✦") && evolved.includes("<blockquote>"),
    evolved.slice(0, 52) + "…",
  );

  let guard = 0;
  while (almanac.gateway.renderers().some((r) => r.route === "card23") && guard++ < 8) {
    const b = almanac.gateway.renderers().find((r) => r.route === "card23");
    await almanac.gateway.append([
      signClaims(makeNegationClaims(operator, Date.now(), b.deltaId, "phase 23 retires the card"), almanac.seed),
    ]);
  }
  const gone = await app("card23", "card:almanac", opToken("almanac"));
  check(
    "23.4",
    "an app never outlives its source — strike its bindings and the route is gone (§23.6)",
    gone.status === 404,
    `after retire: ${gone.status}`,
  );
} finally {
  await almanac?.close().catch(() => {});
}
summary("phase 23 — push deltas, get software");
