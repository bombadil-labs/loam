import {
  check,
  constitute,
  dropStore,
  gql,
  openStore,
  opToken,
  registerHttp,
  summary,
  tok,
} from "./harness.mjs";

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
  dropStore("commons");
  commons = await openStore("commons");
  await constitute(commons, ["wren", "miles"], Date.now());
  await registerHttp(commons.base, opToken("commons"), {
    hyperschema: { name: "Board", alg: 1, body: GATHER },
    schema: { props: { notes: ALL, headline: PICK }, default: PICK },
    roots: [BOARD],
    writable: ["notes", "headline"],
  });

  await gql(commons.base, tok("wren", "commons"), `mutation { board(entity: "${BOARD}", notes: "tend the well") { notes } }`);
  await gql(commons.base, tok("miles", "commons"), `mutation { board(entity: "${BOARD}", notes: "mind the bees") { notes } }`);
  const both = await gql(commons.base, opToken("commons"), `{ board(entity: "${BOARD}") { notes } }`);

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

  const GARDEN = "board:garden";
  await gql(commons.base, tok("miles", "commons"), `mutation { board(entity: "${GARDEN}", notes: "water tuesdays") { notes } }`);
  await gql(commons.base, tok("miles", "commons"), `mutation { board(entity: "${GARDEN}", notes: "prune in march") { notes } }`);
  await gql(commons.base, tok("wren", "commons"), `mutation { board(entity: "${GARDEN}", notes: "wren was here") { notes } }`);
  const removed = await gql(
    commons.base,
    tok("miles", "commons"),
    `mutation { removeBoard(entity: "${GARDEN}", field: "notes", values: ["prune in march"]) { notes } }`,
  );
  const foreign = await gql(
    commons.base,
    tok("miles", "commons"),
    `mutation { removeBoard(entity: "${GARDEN}", field: "notes", values: ["wren was here"]) { notes } }`,
  );
  const finalNotes = foreign.body?.data?.removeBoard?.notes ?? [];
  check(
    "20.4",
    "remove withdraws the ONE value you named — the rest, yours and others', stands",
    JSON.stringify(removed.body?.data?.removeBoard?.notes) ===
      JSON.stringify(["water tuesdays", "wren was here"]) &&
      finalNotes.includes("wren was here") &&
      !finalNotes.includes("prune in march"),
    `after remove: [${finalNotes.join(", ")}] (wren's note untouched by miles)`,
  );

  await registerHttp(commons.base, opToken("commons"), {
    hyperschema: { name: "Ledger", alg: 1, body: GATHER },
    schema: { props: { amount: PICK, memo: PICK }, default: PICK },
    roots: ["ledger:commons"],
    writable: ["amount"],
  });
  const wroteAmount = await gql(commons.base, tok("wren", "commons"), `mutation { ledger(entity: "ledger:commons", amount: 42) { amount } }`);
  const wroteMemo = await gql(commons.base, tok("wren", "commons"), `mutation { ledger(entity: "ledger:commons", memo: "sneaky") { amount } }`);
  const clearedMemo = await gql(
    commons.base,
    tok("wren", "commons"),
    `mutation { clearLedger(entity: "ledger:commons", fields: ["memo"]) { amount } }`,
  );
  check(
    "20.5",
    "a read-only field refuses assert and clear at the door; the writable field still writes",
    wroteAmount.body?.data?.ledger?.amount === 42 &&
      wroteMemo.body?.errors !== undefined &&
      /read-only/.test((clearedMemo.body?.errors ?? []).join(" ")),
    `amount=42 ok; memo write refused; clear memo → ${(clearedMemo.body?.errors ?? []).join(" ").slice(0, 40)}`,
  );
} finally {
  if (commons) await commons.close().catch(() => {});
}
summary("phase 20");
