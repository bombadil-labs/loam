import { readErasures, erasuresIn } from "../../dist/index.js";
import {
  AUTHORS,
  SEEDS,
  check,
  constitute,
  gql,
  openStore,
  opToken,
  pullFrom,
  signClaims,
  summary,
} from "./harness.mjs";

const bioOf = async (base) =>
  (await gql(base, opToken("almanac"), `{ dossier(entity: "person:wren") { bio } }`)).body?.data
    ?.dossier?.bio;

const ts = Date.now();
let almanac, commons;
try {
  almanac = await openStore("almanac");
  commons = await openStore("commons");
  await constitute(almanac, ["wren", "miles", "odile", "petra", "miller"], 1_000_000);
  await constitute(commons, ["wren", "miles", "odile", "petra"], 1_000_000);

  const regret = signClaims(
    {
      timestamp: ts + 10_000_000, validFrom: ts + 10_000_000,
      author: AUTHORS.wren,
      pointers: [
        {
          role: "subject",
          target: { kind: "entity", entity: { id: "person:wren", context: "bio" } },
        },
        { role: "value", target: { kind: "primitive", value: `regrettable-${ts}` } },
      ],
    },
    SEEDS.wren,
  );
  await commons.gateway.append([regret]);
  await pullFrom(almanac.gateway, commons.base, opToken("commons"));
  check("12.1", "the regret federates in and tops the dossier", (await bioOf(almanac.base)) === `regrettable-${ts}`);

  const report = await almanac.gateway.erase(regret.id, {
    reason: "unsaid at the subject's request",
  });
  const after = await bioOf(almanac.base);
  check(
    "12.2",
    "erase clears the bytes and the dossier reverts; the signed hole remains",
    report.erased === regret.id &&
      after !== `regrettable-${ts}` &&
      readErasures(almanac.gateway.reactor, almanac.gateway.validityNow(), almanac.operator).has(regret.id),
    `bio now: ${JSON.stringify(after)}`,
  );

  const repull = await pullFrom(almanac.gateway, commons.base, opToken("commons"));
  const held = almanac.gateway.reactor.get(regret.id) !== undefined;
  check(
    "12.3",
    "sovereignty both ways: the commons remembers, the almanac's door refuses the return",
    !held && (await bioOf(almanac.base)) !== `regrettable-${ts}`,
    `repull accepted ${repull.accepted}, erased id held: ${held}`,
  );

  await almanac.close();
  almanac = await openStore("almanac");
  const ground = [...almanac.gateway.reactor.snapshot()];
  check(
    "12.4",
    "the vault cannot replant the unsaid: heal is erasure-guarded, reopen stays clean",
    almanac.gateway.reactor.get(regret.id) === undefined &&
      erasuresIn(ground, Date.now(), almanac.operator).has(regret.id),
    `${ground.length} deltas on reopen`,
  );
} finally {
  await almanac?.close().catch(() => {});
  await commons?.close().catch(() => {});
}
summary("phase 12 — the unsaying");
