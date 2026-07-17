// Phase MEMBERSHIP — THE SCOPE IS A QUERY (SPEC §27.6, ticket T15). The operator stands up a
// TRIAL POOL over a hand-picked scope: one author's claims MINUS an excluded slice — a nested
// difference, the composition the old depth-1 idiom could never say — watches it live-follow the
// ground, proves the §24.8 law still reaches through the scoped glass, and drops it. Membership is
// not a config file: it is a rhizomatic Term, evaluated like everything else here.

import { signClaims } from "@bombadil/rhizomatic";
import { check, openStore, summary } from "./harness.mjs";

let almanac;
let pool;
try {
  almanac = await openStore("almanac");
  const gw = almanac.gateway;
  const subject = "trial:ledger";
  const fact = (ctx, value, ts) =>
    signClaims(
      {
        timestamp: ts,
        author: almanac.operator,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: subject, context: ctx } } },
          { role: "value", target: { kind: "primitive", value } },
        ],
      },
      almanac.seed,
    );
  const holds = (g, id) => [...g.reactor.snapshot()].some((d) => d.id === id);

  const entry = fact("entry", "first harvest weighed", Date.now());
  const secret = fact("drafts", "unweighed guesses, not for the trial", Date.now() + 1);
  await gw.append([entry, secret]);

  // The hand-picked scope, said as algebra: the operator's claims about the trial ledger, MINUS
  // the drafts — a difference whose operand is itself a select, nested and live.
  const OPERATOR_TRIAL = {
    op: "select",
    pred: { hasPointer: { targetEntity: subject } },
    in: "input",
  };
  const scope = {
    op: "difference",
    of: OPERATOR_TRIAL,
    without: {
      op: "select",
      pred: { hasPointer: { context: { exact: "drafts" } } },
      in: OPERATOR_TRIAL,
    },
  };

  // MEMBER.1 — select IS the reading: the scope carves exactly the members from the live ground.
  const members = gw.select(scope).map((d) => d.id);
  check(
    "member.1",
    "membership is a query: select(term) carves exactly the scope from the living ground (§27.6)",
    members.includes(entry.id) && !members.includes(secret.id),
    `members: ${members.length} — entry in, drafts out`,
  );

  // MEMBER.2 — the trial pool seeds over the SAME term; the drafts never cross the glass.
  pool = await gw.openQuarantine({ membership: scope });
  check(
    "member.2",
    "a trial pool seeded over the scope: the entry crosses, the drafts never do (§24.10 — the admit knob, generalized)",
    holds(pool.gateway, entry.id) && !holds(pool.gateway, secret.id),
    `pool holds entry: ${holds(pool.gateway, entry.id)}, drafts: ${holds(pool.gateway, secret.id)}`,
  );

  // MEMBER.3 — the scope is LIVE: a new entry lands in the primary and the pulse carries it
  // through the same algebra; a new draft stays home.
  const later = fact("entry", "second harvest weighed", Date.now() + 10);
  const laterDraft = fact("drafts", "still guessing", Date.now() + 11);
  await gw.append([later, laterDraft]);
  await pool.reseed();
  check(
    "member.3",
    "the scope live-follows: the pulse re-evaluates the term — new entries cross, new drafts stay home",
    holds(pool.gateway, later.id) && !holds(pool.gateway, laterDraft.id),
    `after the pulse — later entry: ${holds(pool.gateway, later.id)}, later draft: ${holds(pool.gateway, laterDraft.id)}`,
  );

  // MEMBER.4 — the law reaches through the scoped glass (§24.8): erase in the primary, and the
  // byte is gone from the Term-seeded pool too. Then drop the trial wholesale.
  await gw.erase(entry.id, { reason: "the trial forgets like anywhere else" });
  const gone = !holds(pool.gateway, entry.id);
  await pool.drop();
  pool = undefined;
  check(
    "member.4",
    "erasure reaches the Term-seeded pool byte-for-byte, and drop discards the trial wholesale (§24.8)",
    gone,
    `entry gone from pool before drop: ${gone}`,
  );
} finally {
  await pool?.drop().catch(() => {});
  await almanac?.close().catch(() => {});
}
summary("phase membership — the scope is a query (§27.6)");
