// Phase RENDERCAP — THE DOOR THAT SAYS "BUSY" (SPEC §23.9, ticket T18). The village's public
// square gains a rendered notice board, and a crowd hammers it: more anonymous readers at once
// than the door will spawn workers for. The over-cap callers get a clean "busy" that names
// nothing; the board keeps serving; and the host never wavers. The cap is the anonymous door's
// own discipline — the operator's token door renders past it.

import { check, openStore, summary } from "./harness.mjs";

const BOARD_BUNDLE =
  "export default (n) => `<h1>Town Notice</h1><p>${n.view.note ?? \"(the board is bare)\"}</p>`;";

let commons;
try {
  commons = await openStore("commons", { maxPublicRenders: 2 });
  const gw = commons.gateway;
  const subject = "notice:square";

  await gw.publishRegistration(
    { name: "Notice", alg: 1, body: (await import("@bombadil/rhizomatic")).parseTerm({
      op: "group",
      key: "byTargetContext",
      in: {
        op: "select",
        pred: { hasPointer: { targetEntity: { var: "root" } } },
        in: { op: "mask", policy: "drop", in: "input" },
      },
    }) },
    (await import("@bombadil/rhizomatic")).parseSchema({
      name: "Notice",
      alg: 1,
      props: { note: { pick: { order: { byTimestamp: "desc" } } } },
      default: { pick: { order: { byTimestamp: "desc" } } },
    }),
    [subject],
    undefined,
    undefined,
    undefined,
    ["note"],
  );
  await gw.query(`mutation { notice(entity: "${subject}", note: "harvest fair at noon") { note } }`);
  await gw.publishRenderer({ route: "board", schema: "Notice", consumes: ["note"], bundle: BOARD_BUNDLE });
  await gw.declarePublic(["Notice"]);

  // RENDERCAP.1 — the crowd: six anonymous readers at once against a cap of two. The door serves
  // what it can and says "busy" to the rest — cleanly, naming nothing.
  const crowd = await Promise.all(
    Array.from({ length: 6 }, () => gw.serveRoute("board", subject, "public")),
  );
  const served = crowd.filter((r) => r.status === 200).length;
  const busy = crowd.filter((r) => r.status === 503);
  check(
    "rendercap.1",
    "the crowd meets the cap: some are served, the rest get a clean busy that names nothing (§23.9)",
    served >= 1 &&
      busy.length >= 1 &&
      busy.every((r) => !/board|Notice|notice:|worker/i.test(r.body)),
    `served: ${served}, busy: ${busy.length} of 6`,
  );

  // RENDERCAP.2 — the slots come back: the board serves everyone who queues politely.
  let sequentialOk = true;
  for (let i = 0; i < 4; i += 1) {
    const r = await gw.serveRoute("board", subject, "public");
    if (r.status !== 200) sequentialOk = false;
  }
  check(
    "rendercap.2",
    "a finished render returns its slot: four polite readers in a row are all served",
    sequentialOk,
    `4/4 sequential renders 200: ${sequentialOk}`,
  );

  // RENDERCAP.3 — the operator's own door is not the anonymous fan: it renders past the cap.
  const spinning = [
    gw.serveRoute("board", subject, "public"),
    gw.serveRoute("board", subject, "public"),
  ];
  const operatorRead = await gw.serveRoute("board", subject, "full");
  await Promise.all(spinning);
  check(
    "rendercap.3",
    "the token door renders past the public cap — the discipline is the anonymous fan's, not the operator's",
    operatorRead.status === 200 && operatorRead.body.includes("harvest fair"),
    `operator door: ${operatorRead.status}`,
  );
} finally {
  await commons?.close().catch(() => {});
}
summary("phase rendercap — the door that says busy (§23.9)");
