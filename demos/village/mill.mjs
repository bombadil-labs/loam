import { authorForSeed, makeNegationClaims } from "@bombadil/rhizomatic";
import { Runner, bindingDefinitionClaims } from "../../dist/index.js";
import { SEEDS, gql, loadSpec, registerHttp, signClaims } from "./harness.mjs";

export const MILL = {
  name: "binding:grind",
  fnId: "fn:grind",
  materialization: "Dossier",
  pure: true,
  budget: 100_000,
  emit: { keyed: ["presence"] },
};

const GRIST = ["follows", "circle", "companioned", "attended"];

export const grind = (view, root) => {
  const counts = GRIST.map((p) => [p, (view.props.get(p) ?? []).length]).filter(([, n]) => n > 0);
  if (counts.length === 0) return [];
  const score = counts.reduce((sum, [, n]) => sum + n, 0);
  const grain = counts.map(([p, n]) => `${n} ${p}`).join(" · ");
  return [
    [
      { role: "subject", target: { kind: "entity", entity: { id: root, context: "presence" } } },
      { role: "value", target: { kind: "primitive", value: `${score} — ${grain}` } },
    ],
  ];
};

const MILL_TS = 1_000_004;
export async function plantMill(store) {
  await store.gateway.append([
    signClaims(bindingDefinitionClaims(MILL, store.operator, MILL_TS), store.seed),
  ]);
}

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

export async function ensurePresence(base, token) {
  const probe = await gql(base, token, `{ dossier(entity: "person:wren") { presence } }`);
  if (probe.body?.errors === undefined) return false;
  const up = await registerHttp(base, token, loadSpec("dossier.json"));
  if (up.status !== 200) throw new Error(`dossier evolution refused: ${JSON.stringify(up.body)}`);
  return true;
}
