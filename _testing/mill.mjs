// The mill — the village's first ANIMATE store. The machinery shipped in v1 (Runner /
// bindingDefinitionClaims / DerivationHost) and has sat inert ever since: definitions in the
// ground, no one to turn the wheel. Here the almanac's operator blesses ONE function — grind —
// and a new villager, THE MILLER, attaches a Runner and executes it. Every pulse of village
// life becomes flour: a `presence` line on each dossier, derived, signed by the miller,
// superseded on recompute, durable like any other delta (the vault archives flour too).
//
// Two authorities, deliberately separate: the OPERATOR blesses the recipe (a governed store
// honors only operator-authored definitions), and the operator GRANTS THE MILLER STANDING
// (emissions are appends; an unstanding miller's flour is refused at the door like anyone
// else's writes). The recipe and the key to the granary are different keys.
//
// The feedback rule: grind counts only the GRIST contexts, never its own `presence` output —
// a derived function whose output feeds its own input grinds forever.

import { authorForSeed, makeNegationClaims } from "@bombadil/rhizomatic";
import { Runner, bindingDefinitionClaims } from "../dist/index.js";
import { SEEDS, gql, loadSpec, registerHttp, signClaims } from "./harness.mjs";

export const MILL = {
  name: "binding:grind",
  fnId: "fn:grind",
  materialization: "Dossier",
  pure: true,
  // The budget is a LIFETIME trigger count (a runaway guard, not a rate) — village-sized, or
  // the wheel suspends itself twenty pulses into the evening.
  budget: 100_000,
  // KEYED, not "supersede": supersede is WHOLESALE (each trigger negates every live emission
  // of the binding, across all roots — one villager's grind would erase the others' flour).
  // Keyed supersession scopes to the subject: one live presence line per villager.
  emit: { keyed: ["presence"] },
};

const GRIST = ["follows", "circle", "companioned", "attended"];

// HView in, flour out: one presence claim per villager, human-readable, deterministic.
export const grind = (view, root) => {
  const counts = GRIST.map((p) => [p, (view.props.get(p) ?? []).length]).filter(([, n]) => n > 0);
  if (counts.length === 0) return []; // no grist, no flour
  const score = counts.reduce((sum, [, n]) => sum + n, 0);
  const grain = counts.map(([p, n]) => `${n} ${p}`).join(" · ");
  return [
    [
      { role: "subject", target: { kind: "entity", entity: { id: root, context: "presence" } } },
      { role: "value", target: { kind: "primitive", value: `${score} — ${grain}` } },
    ],
  ];
};

// The operator blesses the recipe. Fixed timestamp: re-runs dedup by content address. BUMP IT
// when the recipe changes — the latest blessing per binding is the law, and two blessings at
// one timestamp leave the winner to a lexicographic coin-toss.
const MILL_TS = 1_000_004;
export async function plantMill(store) {
  await store.gateway.append([
    signClaims(bindingDefinitionClaims(MILL, store.operator, MILL_TS), store.seed),
  ]);
}

// The miller attaches: the store becomes animate. Re-attach after any gateway rebirth (the
// crash) — a Runner is process machinery, not ground; only its emissions persist.
//
// FIRST, sweep stale flour. Supersession's ledger lives in the host's memory, per attach:
// a PRIOR process's surviving emission is invisible to this one, and since every pure
// emission carries timestamp 0, old flour ties the pick against new forever. The sweep
// negates every prior miller emission — ts-0 negations are content-addressed, so re-sweeps
// dedup to nothing — and the next grind leaves exactly one live line per villager.
export async function attachMill(store) {
  const MILLER = authorForSeed(SEEDS.miller);
  const stale = [...store.gateway.reactor.snapshot()].filter(
    (d) =>
      d.claims.author === MILLER &&
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === "presence",
      ),
  );
  if (stale.length > 0) {
    await store.gateway.append(
      stale.map((d) => signClaims(makeNegationClaims(MILLER, 0, d.id), SEEDS.miller)),
    );
  }
  return Runner.attach(store.gateway, {
    seed: SEEDS.miller,
    implementations: { "fn:grind": grind },
  });
}

// Schema evolution, idempotently: if the store's Dossier cannot answer `presence`, register
// the evolved spec (a new generation; old and new serve concurrently — the phase-4 capability).
export async function ensurePresence(base, token) {
  const probe = await gql(base, token, `{ dossier(entity: "person:wren") { presence } }`);
  if (probe.body?.errors === undefined) return false;
  const up = await registerHttp(base, token, loadSpec("dossier.json"));
  if (up.status !== 200) throw new Error(`dossier evolution refused: ${JSON.stringify(up.body)}`);
  return true;
}
