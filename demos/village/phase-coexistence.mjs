// Phase COEXISTENCE — ONE GATHER, MANY READINGS (SPEC §21.7, ticket T2). The symmetry the spec
// promised from the start: HyperSchema : HyperView :: Schema : View, and one hyperschema carries
// many living lenses. The almanac's dossier gather gains a second reading — FirstImpressions, the
// archival lens that keeps the FIRST thing anyone said about a villager (oldest-wins, the town's
// founding memory) — served beside the broad Dossier, evolving on its own clock, and deliberately
// NOT declared public: the anonymous door learns nothing of what the operator kept private.

import { parseSchema, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { check, openStore, summary } from "./harness.mjs";

const GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};
const DESK = { name: "Townbook", alg: 1, body: parseTerm(GATHER) };
const LATEST = { pick: { order: { byTimestamp: "desc" } } };
const OLDEST = { pick: { order: { byTimestamp: "asc" } } };

let almanac;
try {
  almanac = await openStore("almanac");
  const gw = almanac.gateway;
  const subject = "townbook:wren";
  const say = (value, ts) =>
    signClaims(
      {
        timestamp: ts,
        author: almanac.operator,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: subject, context: "note" } } },
          { role: "value", target: { kind: "primitive", value } },
        ],
      },
      almanac.seed,
    );
  const read = async (field) =>
    (await gw.query(`{ ${field}(entity: "${subject}") { note } }`)).data?.[field]?.note;

  // Two claims across the years; the broad lens reads the latest word, the archive the first.
  await gw.publishRegistration(
    DESK,
    parseSchema({ name: "Townbook", alg: 1, props: { note: LATEST }, default: LATEST }),
    [subject],
    undefined,
    undefined,
    undefined,
    ["note"],
  );
  await gw.append([say("newly arrived, all promise", 1000), say("keeper of the commons", 2000)]);

  // COEXIST.1 — the second lens joins; the first is NOT evicted (the pre-§21.7 registry evicted).
  await gw.publishRegistration(
    DESK,
    parseSchema({ name: "FirstImpressions", alg: 1, props: { note: OLDEST }, default: OLDEST }),
    [subject],
  );
  check(
    "coexist.1",
    "one gather, two living lenses: the broad reading and the archival one serve simultaneously (§21.7)",
    (await read("townbook")) === "keeper of the commons" &&
      (await read("firstImpressions")) === "newly arrived, all promise",
    `latest: ${JSON.stringify(await read("townbook"))} · first: ${JSON.stringify(await read("firstImpressions"))}`,
  );

  // COEXIST.2 — each lens evolves on its own clock: the archive narrows to silence (drops `note`),
  // and the broad reading never flinches.
  await gw.publishRegistration(
    DESK,
    parseSchema({ name: "FirstImpressions", alg: 1, props: {}, default: OLDEST }),
    [subject],
  );
  const broadStill = await read("townbook");
  const archiveGone = await gw.query(`{ firstImpressions(entity: "${subject}") { note } }`);
  check(
    "coexist.2",
    "sibling evolution is solitary: the archive dropped its field; the broad lens never flinched",
    broadStill === "keeper of the commons" &&
      /Cannot query field "note"/.test((archiveGone.errors ?? []).join(" ")),
    `broad: ${JSON.stringify(broadStill)}`,
  );

  // COEXIST.3 — loam.public admits lens by lens: Townbook is declared, FirstImpressions is not.
  await gw.declarePublic(["Townbook"]);
  const pub = await gw.queryPublic(`{ townbook(entity: "${subject}") { note } }`);
  const leak = await gw.queryPublic(`{ firstImpressions(entity: "${subject}") { note } }`);
  check(
    "coexist.3",
    "the anonymous door opens lens by lens: the town's book is public; its first impressions are the town's own",
    pub.errors === undefined &&
      pub.data?.townbook?.note === "keeper of the commons" &&
      (leak.errors ?? []).some((e) => /firstImpressions/.test(e)),
    `public reads: ${JSON.stringify(pub.data?.townbook?.note)}`,
  );
} finally {
  await almanac?.close().catch(() => {});
}
summary("phase coexistence — one gather, many readings (§21.7)");
