import { parseSchema, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { trustClaims } from "../../dist/index.js";
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
let nestedOuter;
let nestedInner;
try {
  almanac = await openStore("almanac");
  const primary = almanac.gateway;
  const operator = almanac.operator;
  const subject = "dossier:townhall";
  const fact = (ctx, value, ts) =>
    signClaims(
      {
        timestamp: ts, validFrom: ts,
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

  await primary.publishRegistration(DOSSIER, SCHEMA, [subject], undefined, undefined, undefined, ["note", "title"]);
  await primary.append([fact("title", "The Townhall Dossier", Date.now())]);
  const secret = fact("note", "a private thing, to be forgotten", Date.now() + 1);
  await primary.append([secret]);

  pool = await primary.openQuarantine();
  check(
    "quarantine.1",
    "a quarantine pool stands up over the operator's own ground and resolves it — a real lens over real ground (§24.1)",
    (await fieldOf(pool.gateway, "note")) === "a private thing, to be forgotten" &&
      holds(pool.gateway, secret.id),
    `pool reads note: ${JSON.stringify(await fieldOf(pool.gateway, "note"))}`,
  );

  const poolOnly = fact("note", "scribbled inside the sandbox", Date.now() + 1);
  await pool.gateway.append([poolOnly]);
  check(
    "quarantine.2",
    "the one-way glass: a write in the pool never reaches the primary (§24.2) — the sandbox writes go INTO the sandbox, nowhere else",
    holds(pool.gateway, poolOnly.id) && !holds(primary, poolOnly.id),
    `pool has it: ${holds(pool.gateway, poolOnly.id)}, primary has it: ${holds(primary, poolOnly.id)}`,
  );

  await primary.erase(secret.id, { reason: "the subject exercised their right to be forgotten" });
  check(
    "quarantine.3",
    "§11 reaches THROUGH the glass: erase a primary fact and the byte is gone from the quarantine too — no erasure-evasion channel inside the operator's own walls (§24.8)",
    !holds(primary, secret.id) && !holds(pool.gateway, secret.id),
    `gone from primary: ${!holds(primary, secret.id)}, gone from pool: ${!holds(pool.gateway, secret.id)}`,
  );

  await pool.drop();
  pool = undefined;
  check(
    "quarantine.4",
    "drop is consequence-free: discard the whole quarantine and the primary's coherence is untouched — its title still reads true (§24.1)",
    (await fieldOf(primary, "title")) === "The Townhall Dossier",
    `primary title after drop: ${JSON.stringify(await fieldOf(primary, "title"))}`,
  );

  const FORGOTTEN = "a confidence that must not survive, at any depth";
  const secret2 = fact("note", FORGOTTEN, Date.now() + 10);
  await primary.append([secret2]);
  await primary.append([
    signClaims(trustClaims("closed", [], operator, Date.now() + 11), almanac.seed),
  ]);
  nestedOuter = await primary.openQuarantine();
  nestedInner = await nestedOuter.gateway.openQuarantine();
  check(
    "quarantine.5",
    "a pool of a pool: P → Q → R all hold the ground, under a CLOSED trust door — the exact posture where the old fan-out went silent",
    holds(nestedOuter.gateway, secret2.id) && holds(nestedInner.gateway, secret2.id),
    `Q holds it: ${holds(nestedOuter.gateway, secret2.id)}, R holds it: ${holds(nestedInner.gateway, secret2.id)}`,
  );

  await primary.erase(secret2.id, { reason: "forgotten at every depth, or the operator learns why" });
  const tierForgot = (gw) => {
    const ground = [...gw.reactor.snapshot()];
    return ground.every((d) => d.id !== secret2.id) && !JSON.stringify(ground).includes(FORGOTTEN);
  };
  check(
    "quarantine.6",
    "the fan-out re-derives its own reach (T16): erase once and the byte is gone from P, Q, AND R — a closed door does not stop the law, and depth is no shelter (§24.8)",
    tierForgot(primary) && tierForgot(nestedOuter.gateway) && tierForgot(nestedInner.gateway),
    `forgot in P: ${tierForgot(primary)}, Q: ${tierForgot(nestedOuter.gateway)}, R: ${tierForgot(nestedInner.gateway)}`,
  );

  await primary.append([signClaims(trustClaims("open", [], operator, Date.now() + 20), almanac.seed)]);
  await nestedInner.drop();
  nestedInner = undefined;
  await nestedOuter.drop();
  nestedOuter = undefined;
} finally {
  await nestedInner?.drop().catch(() => {});
  await nestedOuter?.drop().catch(() => {});
  await pool?.drop().catch(() => {});
  await almanac?.close().catch(() => {});
}
summary("phase quarantine — a place where untrusted law may bind (§24)");
