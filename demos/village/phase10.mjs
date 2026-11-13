import { readdirSync } from "node:fs";
import { dropStore, check, constitute, gql, openStore, opToken, summary, tok } from "./harness.mjs";

const coldCount = (vault) =>
  readdirSync(vault, { recursive: true }).filter((f) => f.toString().endsWith(".json")).length;

const wrenBio = async (base) =>
  (await gql(base, opToken("almanac"), `{ dossier(entity: "person:wren") { bio } }`)).body?.data
    ?.dossier?.bio;

let almanac;
try {
  almanac = await openStore("almanac");
  await constitute(almanac, ["wren", "miles", "odile", "petra"], 1_000_000);
  await gql(
    almanac.base,
    tok("wren", "almanac"),
    `mutation { person(entity: "person:wren", bio: "keeper of the commons; ash-proof") { bio } }`,
  );
  const hot = [...almanac.gateway.reactor.snapshot()].length;
  const cold = coldCount(almanac.vault);
  check(
    "10.1",
    "the vault holds a cold copy of every delta the store holds",
    hot > 0 && cold === hot,
    `${hot} hot, ${cold} cold`,
  );
  const bioBefore = await wrenBio(almanac.base);
  await almanac.close();

  dropStore("almanac");
  almanac = await openStore("almanac");
  check(
    "10.2",
    "the recovered store heals from the vault before the gateway reads",
    almanac.healed.toPrimary === hot &&
      [...almanac.gateway.reactor.snapshot()].length === hot,
    `${almanac.healed.toPrimary} replanted`,
  );

  const bioAfter = await wrenBio(almanac.base);
  check(
    "10.3",
    "Wren's dossier survives the crash word for word",
    bioBefore !== undefined && bioAfter === bioBefore,
    `bio: ${JSON.stringify(bioAfter)}`,
  );

  await gql(
    almanac.base,
    tok("wren", "almanac"),
    `mutation { person(entity: "person:wren", bio: "keeper of the commons; twice-planted") { bio } }`,
  );
  const hotNow = [...almanac.gateway.reactor.snapshot()].length;
  check(
    "10.4",
    "a post-crash write lands hot and cold in the same append",
    hotNow === hot + 1 && coldCount(almanac.vault) === hotNow,
    `${hotNow} hot, ${coldCount(almanac.vault)} cold`,
  );
} finally {
  await almanac?.close().catch(() => {});
}
summary("phase 10 — the crash");
