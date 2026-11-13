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
        timestamp: ts, validFrom: ts,
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

  const members = gw.select(scope).map((d) => d.id);
  check(
    "member.1",
    "membership is a query: select(term) carves exactly the scope from the living ground (§27.6)",
    members.includes(entry.id) && !members.includes(secret.id),
    `members: ${members.length} — entry in, drafts out`,
  );

  const version = gw.freeze(scope);
  const sameAgain = gw.freeze(scope);
  check(
    "member.1b",
    "freezing the scope mints a content-addressed module version, and freezing it again agrees (§27.2)",
    version.id === sameAgain.id && version.members.length === members.length,
    `version ${version.id.slice(0, 12)}… over ${version.members.length} members`,
  );

  pool = await gw.openQuarantine({ membership: scope });
  check(
    "member.2",
    "a trial pool seeded over the scope: the entry crosses, the drafts never do (§24.10 — the admit knob, generalized)",
    holds(pool.gateway, entry.id) && !holds(pool.gateway, secret.id),
    `pool holds entry: ${holds(pool.gateway, entry.id)}, drafts: ${holds(pool.gateway, secret.id)}`,
  );

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

  const nowVersion = gw.freeze(scope);
  const stillHeld = gw.select(scope).length;
  check(
    "member.3b",
    "the frozen version does not drift as the ground grows — the living scope re-reads, the version stays put (§27.2)",
    version.members.length < stillHeld && nowVersion.id !== version.id,
    `frozen at ${version.members.length} members (${version.id.slice(0, 12)}…), living now ${stillHeld} (${nowVersion.id.slice(0, 12)}…)`,
  );

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
