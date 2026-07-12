// Phase 20 — Clearing is retraction (SPEC §14). Two residents keep a shared board on the commons.
// Each may withdraw only their OWN words; a clear falls to whatever survives, or to absence — and
// absence renders per the lens, never a null on a reference. Both doors speak it: GraphQL
// `clearBoard`, and the REST door's honest verb, DELETE. Retract-your-own is the whole reach: no
// one's clear ever touches another's claim (to keep others out of a view you narrow the Policy).

import { check, constitute, gql, openStore, opToken, registerHttp, summary, tok } from "./harness.mjs";

const PICK = { pick: { order: { byTimestamp: "desc" } } };
const ALL = { all: { order: { byTimestamp: "asc" } } };
const GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};
const BOARD = "board:commons";

const restDelete = (base, token, fields) =>
  fetch(`${base}/rest/v1/Board/${encodeURIComponent(BOARD)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(fields),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => undefined) }));

const notesOf = (res) => res.body?.data?.board?.notes ?? null;

let commons;
try {
  commons = await openStore("commons");
  // Standing (authors, not owners): the operator seats wren and miles as writers on the commons.
  await constitute(commons, ["wren", "miles"], Date.now());
  // A tiny shared board: `notes` unions every voice (all), `headline` is latest-wins (pick).
  await registerHttp(commons.base, opToken("commons"), {
    hyperschema: { name: "Board", alg: 1, body: GATHER },
    schema: { props: { notes: ALL, headline: PICK }, default: PICK },
    roots: [BOARD],
  });

  // Both residents write to the shared list; the union holds both, in ground order.
  await gql(commons.base, tok("wren", "commons"), `mutation { board(entity: "${BOARD}", notes: "tend the well") { notes } }`);
  await gql(commons.base, tok("miles", "commons"), `mutation { board(entity: "${BOARD}", notes: "mind the bees") { notes } }`);
  const both = await gql(commons.base, opToken("commons"), `{ board(entity: "${BOARD}") { notes } }`);

  // 20.1 — wren withdraws their OWN note; miles's still stands. Retract-your-own is scoped.
  const afterWren = await gql(
    commons.base,
    tok("wren", "commons"),
    `mutation { clearBoard(entity: "${BOARD}", fields: ["notes"]) { notes } }`,
  );
  check(
    "20.1",
    "a clear withdraws only your own words — the co-author's note survives untouched",
    JSON.stringify(notesOf(both)) === JSON.stringify(["tend the well", "mind the bees"]) &&
      JSON.stringify(afterWren.body?.data?.clearBoard?.notes) === JSON.stringify(["mind the bees"]),
    `[${(notesOf(both) ?? []).length}] → wren clears → [${(afterWren.body?.data?.clearBoard?.notes ?? []).join(", ")}]`,
  );

  // 20.2 — miles clears through the REST door (DELETE): the board empties to ABSENCE, then a fresh
  // word repopulates it — "withdraw my claim", never "no one may speak here".
  const del = await restDelete(commons.base, tok("miles", "commons"), ["notes"]);
  const emptied = await gql(commons.base, opToken("commons"), `{ board(entity: "${BOARD}") { notes } }`);
  await gql(commons.base, tok("wren", "commons"), `mutation { board(entity: "${BOARD}", notes: "fresh start") { notes } }`);
  const repopulated = await gql(commons.base, opToken("commons"), `{ board(entity: "${BOARD}") { notes } }`);
  check(
    "20.2",
    "DELETE clears your own through the REST door → absence; a fresh assertion repopulates",
    del.status === 200 &&
      notesOf(emptied) === null &&
      JSON.stringify(notesOf(repopulated)) === JSON.stringify(["fresh start"]),
    `DELETE ${del.status}; emptied → ${JSON.stringify(notesOf(emptied))}; then → ${JSON.stringify(notesOf(repopulated))}`,
  );

  // 20.3 — a pick field cleared goes to absence, which reads as null (the null-ness is the lens's,
  // not a value written into the ground).
  await gql(commons.base, tok("wren", "commons"), `mutation { board(entity: "${BOARD}", headline: "harvest saturday") { headline } }`);
  const set = await gql(commons.base, opToken("commons"), `{ board(entity: "${BOARD}") { headline } }`);
  const cleared = await gql(
    commons.base,
    tok("wren", "commons"),
    `mutation { clearBoard(entity: "${BOARD}", fields: ["headline"]) { headline } }`,
  );
  check(
    "20.3",
    "a pick field cleared resolves to absence — null at the surface, no null on a reference",
    set.body?.data?.board?.headline === "harvest saturday" &&
      cleared.body?.data?.clearBoard?.headline === null,
    `set "${set.body?.data?.board?.headline}" → cleared → ${JSON.stringify(cleared.body?.data?.clearBoard?.headline)}`,
  );
} finally {
  if (commons) await commons.close().catch(() => {});
}
summary("phase 20");
