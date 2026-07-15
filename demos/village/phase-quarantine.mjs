// Phase QUARANTINE — A PLACE WHERE UNTRUSTED LAW MAY BIND (SPEC §24, slice 1). Today foreign law is
// inert-by-default: safe, but untestable. The quarantine closes that gap — a SECOND store over the
// operator's own ground, seeded ONE-WAY from the primary, where a stranger's app could run sequestered.
// This act stands one up over the almanac, shows the ONE-WAY GLASS (the pool mirrors the primary's living
// ground; a write in the pool never reaches the primary), then the non-negotiable law: ERASE a fact in the
// primary and watch it vanish from the quarantine too (§11 reaches through the glass — no erasure-evasion),
// and finally DROP the whole pool and show the primary unscathed (discard = erase-by-construction).

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
const PICK = { pick: { order: { byTimestamp: "desc" } } };
const DOSSIER = { name: "Dossier", alg: 1, body: parseTerm(GATHER) };
const SCHEMA = parseSchema({ props: { note: PICK, title: PICK }, default: PICK });

let almanac;
let pool;
try {
  almanac = await openStore("almanac");
  const primary = almanac.gateway;
  const operator = almanac.operator;
  const subject = "dossier:townhall";
  const fact = (ctx, value, ts) =>
    signClaims(
      {
        timestamp: ts,
        author: operator,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: subject, context: ctx } } },
          { role: "value", target: { kind: "primitive", value } },
        ],
      },
      almanac.seed,
    );
  const fieldOf = async (gw, field) => {
    const res = await gw.query(`{ dossier(entity: "${subject}") { ${field} } }`);
    return res.data?.dossier?.[field];
  };
  const holds = (gw, id) => [...gw.reactor.snapshot()].some((d) => d.id === id);

  // Register the lens and lay two facts: a durable title, and a secret that will later be forgotten.
  await primary.publishRegistration(DOSSIER, SCHEMA, [subject], undefined, undefined, undefined, ["note", "title"]);
  await primary.append([fact("title", "The Townhall Dossier", Date.now())]);
  const secret = fact("note", "a private thing, to be forgotten", Date.now() + 1);
  await primary.append([secret]);

  // QUARANTINE.1 — stand up a one-way pool; it RESOLVES the primary's living ground.
  pool = await primary.openQuarantine();
  check(
    "quarantine.1",
    "a quarantine pool stands up over the operator's own ground and resolves it — a real lens over real ground (§24.1)",
    (await fieldOf(pool.gateway, "note")) === "a private thing, to be forgotten" &&
      holds(pool.gateway, secret.id),
    `pool reads note: ${JSON.stringify(await fieldOf(pool.gateway, "note"))}`,
  );

  // QUARANTINE.2 — the glass is ONE-WAY: a write in the pool stays in the pool.
  const poolOnly = fact("note", "scribbled inside the sandbox", Date.now() + 1);
  await pool.gateway.append([poolOnly]);
  check(
    "quarantine.2",
    "the one-way glass: a write in the pool never reaches the primary (§24.2) — the sandbox writes go INTO the sandbox, nowhere else",
    holds(pool.gateway, poolOnly.id) && !holds(primary, poolOnly.id),
    `pool has it: ${holds(pool.gateway, poolOnly.id)}, primary has it: ${holds(primary, poolOnly.id)}`,
  );

  // QUARANTINE.3 — ERASE the secret in the primary; it vanishes from the quarantine too (§24.8, the law).
  await primary.erase(secret.id, { reason: "the subject exercised their right to be forgotten" });
  check(
    "quarantine.3",
    "§11 reaches THROUGH the glass: erase a primary fact and the byte is gone from the quarantine too — no erasure-evasion channel inside the operator's own walls (§24.8)",
    !holds(primary, secret.id) && !holds(pool.gateway, secret.id),
    `gone from primary: ${!holds(primary, secret.id)}, gone from pool: ${!holds(pool.gateway, secret.id)}`,
  );

  // QUARANTINE.4 — DROP the pool; the primary is unscathed (discard = erase-by-construction). Its durable
  // title still resolves, exactly as before — the sandbox and everything in it simply cease to exist.
  await pool.drop();
  pool = undefined;
  check(
    "quarantine.4",
    "drop is consequence-free: discard the whole quarantine and the primary's coherence is untouched — its title still reads true (§24.1)",
    (await fieldOf(primary, "title")) === "The Townhall Dossier",
    `primary title after drop: ${JSON.stringify(await fieldOf(primary, "title"))}`,
  );
} finally {
  await pool?.drop().catch(() => {});
  await almanac?.close().catch(() => {});
}
summary("phase quarantine — a place where untrusted law may bind (§24)");
