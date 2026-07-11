// Phase 11 (the mill) — THE VILLAGE'S FIRST ANIMATE STORE. The v1 runner machinery, exercised
// in the open air at last: the almanac's operator blesses ONE derived function (grind), the
// MILLER attaches a Runner, and village life becomes flour — a `presence` line on each
// dossier, derived, signed, superseding on recompute, durable without the runner present.
// Passive vs animate is one attach call; standing and blessing are separate authorities.
// Re-runnable against a lived-in home: every check asserts CHANGE, never absolute counts.

import { readBindingDefinitions } from "../../dist/index.js";
import { attachMill, ensurePresence, plantMill } from "./mill.mjs";
import {
  attendClaims,
  appendAs,
  check,
  constitute,
  followClaims,
  gql,
  openStore,
  opToken,
  summary,
} from "./harness.mjs";

// presence resolves as a JSON object: our value pointer beside the host's provenance pointers
// (rhizomatic.derived.by / .from — the function id and the gathered evidence). We read .value.
const flourOf = async (base, person) => {
  const r = await gql(base, opToken("almanac"), `{ dossier(entity: "${person}") { presence } }`);
  return r.body?.data?.dossier?.presence?.value;
};

const ts = Date.now();
let almanac;
try {
  // 11.1 — PASSIVE: the recipe is in the ground; grist arrives; the wheel does not turn
  almanac = await openStore("almanac");
  await constitute(almanac, ["wren", "miles", "odile", "petra", "miller"], 1_000_000);
  await ensurePresence(almanac.base, opToken("almanac"));
  await plantMill(almanac);
  const baseline = await flourOf(almanac.base, "person:wren"); // old flour, or none — lived-in homes
  await appendAs(almanac.gateway, "odile", [
    attendClaims(`gathering:mill-raising-${ts}`, "person:wren", ts),
  ]);
  await almanac.gateway.flush();
  const still = await flourOf(almanac.base, "person:wren");
  const definitions = readBindingDefinitions(almanac.gateway.reactor, almanac.operator);
  check(
    "11.1",
    "passive: the blessed recipe sits in the ground; new grist grinds nothing",
    definitions.some((d) => d.name === "binding:grind") && still === baseline,
    `presence unchanged: ${JSON.stringify(still)}`,
  );

  // 11.2 — ANIMATE: the miller attaches; the SAME kind of ingest now produces flour
  const runner = await attachMill(almanac);
  await appendAs(almanac.gateway, "odile", [
    followClaims("person:odile", "person:wren", ts + 1),
  ]);
  await almanac.gateway.flush();
  const flour = await flourOf(almanac.base, "person:wren");
  check(
    "11.2",
    "animate: one attach call and village life grinds into presence",
    runner.installed.includes("binding:grind") &&
      typeof flour === "string" &&
      flour.includes("attended") &&
      flour !== baseline,
    `presence: ${JSON.stringify(flour)}`,
  );

  // 11.3 — SUPERSEDE: more grist moves the line; pick-latest serves exactly one per villager
  await appendAs(almanac.gateway, "odile", [
    attendClaims(`gathering:harvest-moon-${ts}`, "person:wren", ts + 2),
  ]);
  await almanac.gateway.flush();
  const updated = await flourOf(almanac.base, "person:wren");
  check(
    "11.3",
    "recompute supersedes: the presence line moves with the ground",
    typeof updated === "string" && updated !== flour,
    `presence: ${JSON.stringify(updated)}`,
  );

  // 11.4 — FLOUR IS GROUND: reopen with NO runner; the derived line persists as plain deltas
  await almanac.close();
  almanac = await openStore("almanac");
  const cold = await flourOf(almanac.base, "person:wren");
  check(
    "11.4",
    "what the mill ground persists without the mill: emissions are deltas, not cache",
    cold === updated,
    `presence after passive reopen: ${JSON.stringify(cold)}`,
  );
} finally {
  await almanac?.close().catch(() => {});
}
summary("phase 11 — the mill");
