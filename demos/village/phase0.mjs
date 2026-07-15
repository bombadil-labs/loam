// Phase 0 — Groundwork: homes, operators, first registrations through all three surfaces.

import { execFileSync } from "node:child_process";
import { existsSync, join } from "./harness.mjs";
import {
  HOMES,
  ROOT,
  STORES,
  check,
  gql,
  homeOf,
  loadSpec,
  mcp,
  openStore,
  operatorOf,
  opToken,
  registerHttp,
  summary,
} from "./harness.mjs";
import { initHome } from "../../dist/index.js";

const stores = {};
try {
  // 0.1 — dist present, schemas generated
  check(
    "0.1",
    "dist built and schema files present",
    existsSync(join(ROOT, "..", "..", "dist", "index.js")),
  );
  execFileSync("node", [join(ROOT, "gen-schemas.mjs")], { stdio: "inherit" });

  // 0.2 — one home per store, every operator DISTINCT (shared seeds would federate law)
  for (const name of Object.keys(STORES)) initHome(homeOf(name));
  const operators = Object.keys(STORES).map((n) => operatorOf(n));
  check(
    "0.2",
    `${operators.length} homes minted with ${operators.length} distinct operators`,
    new Set(operators).size === Object.keys(STORES).length,
    operators.map((o) => o.slice(0, 20)).join(" "),
  );

  // 0.3 — Person registered on commons via the CLI, BEFORE any serve (single-writer rule)
  const bin = join(ROOT, "..", "..", "dist", "cli", "bin.js");
  const regOut = execFileSync(
    "node",
    [bin, "register", join(ROOT, "schemas", "person.json"), "--home", homeOf("commons")],
    { encoding: "utf8" },
  );
  check(
    "0.3a",
    "loam register (CLI) announces the registration",
    /registered\s+Person/i.test(regOut),
    regOut.trim().split("\n")[0],
  );
  const storeOut = execFileSync("node", [bin, "store", "--home", homeOf("commons")], {
    encoding: "utf8",
  });
  const count = Number(/(\d+) deltas/.exec(storeOut)?.[1] ?? -1);
  check(
    "0.3b",
    "the store holds marker + hyperschema + living Schema + snapshot + binding (5 deltas, SPEC §21)",
    count === 5,
    `${count} deltas`,
  );

  // 0.4 — all four serve; a junk token is 401 everywhere
  for (const name of Object.keys(STORES)) stores[name] = await openStore(name);
  let junk401 = true;
  for (const s of Object.values(stores)) {
    const r = await gql(s.base, "junk", "{ __typename }");
    if (r.status !== 401) junk401 = false;
  }
  check("0.4", "all four stores serve; junk token is 401 on every mount", junk401);

  // 0.5 — the remaining schemas, through the remaining surfaces, each answering immediately
  const viaHttp = async (store, file) => {
    const r = await registerHttp(stores[store].base, opToken(store), loadSpec(file));
    if (r.status !== 200)
      throw new Error(`${store}/${file}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  await viaHttp("commons", "circle.json");
  await viaHttp("reel", "film.json");
  await viaHttp("reel", "screening-v1.json");
  await viaHttp("reel", "reel-person.json");
  await viaHttp("reel", "film-night.json");
  await viaHttp("almanac", "dossier.json");
  await viaHttp("almanac", "presence.json");
  await viaHttp("almanac", "trusted-dossier.json");
  await viaHttp("almanac", "almanac-person.json");
  // hive goes through MCP — the third surface
  for (const file of ["colony.json", "gathering.json"]) {
    const r = await mcp(stores.hive.base, opToken("hive"), "tools/call", {
      name: "loam_register",
      arguments: loadSpec(file),
    });
    if (r.body?.result?.isError) throw new Error(`hive/${file}: ${r.body.result.content[0].text}`);
  }

  const probes = [
    ["commons", `{ circle(entity: "person:wren") { _hex } }`],
    ["reel", `{ filmNight(entity: "screening:s1") { _hex } }`],
    ["hive", `{ colony(entity: "colony:1") { _hex } }`],
    ["almanac", `{ trustedDossier(entity: "person:wren") { _hex } }`],
  ];
  let allAnswer = true;
  for (const [store, q] of probes) {
    const r = await gql(stores[store].base, opToken(store), q);
    if (r.body?.errors !== undefined) {
      allAnswer = false;
      console.log(`    ${store}: ${JSON.stringify(r.body?.errors)}`);
    }
  }
  check(
    "0.5",
    "every registered type answers immediately — HTTP, MCP, CLI paths all live",
    allAnswer,
  );
} finally {
  for (const s of Object.values(stores)) await s.close().catch(() => {});
}
summary("phase 0");
