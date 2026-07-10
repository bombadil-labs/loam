// Phase 12 (SPEC §11) — THE UNSAYING: a villager erases her own words. The bytes are cleared from
// every tier (the vault forgets too — heal is tombstone-guarded), the signed hole remains,
// the dossier reverts, and the door refuses the id's return — even when a peer store still
// holds the original and offers it back on every pulse. Sovereignty both ways: the almanac
// forgets; the commons remembers; neither can force the other.

import { readTombstones, tombstonesIn } from "../dist/index.js";
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

  // 12.1 — the regret: said on the commons, federated to the almanac, visible in the dossier
  // Future-dated PAST Mallory's forgeries (the lived-in home holds +8_000_000 fakes): the
  // regret must top the naive pick for 12.1 to say anything.
  const regret = signClaims(
    {
      timestamp: ts + 10_000_000,
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

  // 12.2 — the unsaying: Wren erases HER OWN words on the almanac; the dossier reverts
  const report = await almanac.gateway.erase(regret.id, {
    actorSeed: SEEDS.wren,
    reason: "unsaid by request",
  });
  const after = await bioOf(almanac.base);
  check(
    "12.2",
    "erase clears the bytes and the dossier reverts; the signed hole remains",
    report.erased === regret.id &&
      after !== `regrettable-${ts}` &&
      readTombstones(almanac.gateway.reactor, almanac.operator).has(regret.id),
    `bio now: ${JSON.stringify(after)}`,
  );

  // 12.3 — the door remembers: the commons still offers the original; the pulse refuses it
  const repull = await pullFrom(almanac.gateway, commons.base, opToken("commons"));
  const held = almanac.gateway.reactor.get(regret.id) !== undefined;
  check(
    "12.3",
    "sovereignty both ways: the commons remembers, the almanac's door refuses the return",
    !held && (await bioOf(almanac.base)) !== `regrettable-${ts}`,
    `repull accepted ${repull.accepted}, erased id held: ${held}`,
  );

  // 12.4 — the vault forgets too: reopen (heal runs tombstone-guarded) and the hole holds
  await almanac.close();
  almanac = await openStore("almanac");
  const ground = [...almanac.gateway.reactor.snapshot()];
  check(
    "12.4",
    "the vault cannot replant the unsaid: heal is tombstone-guarded, reopen stays clean",
    almanac.gateway.reactor.get(regret.id) === undefined &&
      tombstonesIn(ground, almanac.operator).has(regret.id),
    `${ground.length} deltas on reopen`,
  );
} finally {
  await almanac?.close().catch(() => {});
  await commons?.close().catch(() => {});
}
summary("phase 12 — the unsaying");
