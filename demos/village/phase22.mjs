// Phase 22 — THE LENS COMPUTES (SPEC §22, rung a). A Policy adjudicates WHICH claims survive; a custom
// resolver decides what the survivors MEAN. The almanac registers a `Ledger22` whose `amount` field
// carries a bucket-pure resolver — the value becomes a computation over the whole bucket, not the one
// the Policy would pick. The act proves the override, that erasing a fact the resolver counted RE-RUNS
// it (the cache forgets exactly when the ground does, §22.5/§11), and that changing the resolver mints
// a new version whose old reading still answers by its true name (§22.4 freezing, at the version).

import { parseSchema, parseTerm, signClaims, makeNegationClaims } from "@bombadil/rhizomatic";
import { check, openStore, opToken, summary } from "./harness.mjs";

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
const LEDGER = { name: "Ledger22", alg: 1, body: parseTerm(GATHER) };
const SCHEMA = parseSchema({ props: { amount: PICK }, default: PICK });

// Two readings of the same bucket the Policy algebra cannot express: the SUM of the amounts, then the
// COUNT of entries. Directly-runnable ESM — what is audited is what runs (§22.3).
const SUM = "export default (b) => b.reduce((s, e) => s + Number(e.value), 0);";
const COUNT = "export default (b) => b.length;";
const sumAmount = { amount: { rung: "a", type: "number", code: SUM } };

let almanac;
try {
  almanac = await openStore("almanac");
  const operator = almanac.operator;
  const rest = (path, token) =>
    fetch(`${almanac.base}${path}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
  const readAmount = async (alias) =>
    (
      await (
        await rest(`/rest/${alias}/Ledger22/${encodeURIComponent("ledger:lens22")}`, opToken("almanac"))
      ).json()
    ).view?.amount;

  // Clear the stage: strike every surviving Ledger22 version (the almanac's home persists between runs).
  for (const stale of almanac.gateway
    .registrationVersions()
    .filter((v) => v.hyperschema.name === "Ledger22")) {
    await almanac.gateway.append([
      signClaims(
        makeNegationClaims(operator, Date.now(), stale.deltaId, "phase 22 clears its stage"),
        almanac.seed,
      ),
    ]);
  }

  // Register with the SUM resolver on `amount`, and lay three entries: 10, 40, 90.
  await almanac.gateway.publishRegistration(
    LEDGER,
    SCHEMA,
    ["ledger:lens22"],
    undefined,
    undefined,
    undefined,
    ["amount"],
    sumAmount,
  );
  const entry = (v, ts) =>
    signClaims(
      {
        timestamp: ts,
        author: operator,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: "ledger:lens22", context: "amount" } } },
          { role: "value", target: { kind: "primitive", value: v } },
        ],
      },
      almanac.seed,
    );
  const e10 = entry(10, Date.now());
  await almanac.gateway.append([e10, entry(40, Date.now() + 1), entry(90, Date.now() + 2)]);

  // 22.1 — the resolver OVERRIDES the Policy: pick-latest would answer 90; the resolver sums to 140.
  check(
    "22.1",
    "a bucket-pure resolver overrides the Policy — amount resolves to the SUM (140), not the picked latest (90)",
    (await readAmount("v1")) === 140,
    `amount = ${await readAmount("v1")}`,
  );

  // 22.2 — the door advertises the DECLARED output type (§22.6): amount is a number in the OpenAPI doc.
  const spec = await (await rest("/openapi.json", opToken("almanac"))).json();
  const amountShape = Object.entries(spec.paths ?? {})
    .find(([p]) => p.includes("/Ledger22/"))?.[1]
    ?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.view?.properties
    ?.amount;
  check(
    "22.2",
    "the door speaks the field it serves: OpenAPI types the resolved amount as a number (SPEC §22.6)",
    amountShape?.type === "number",
    `amount: ${JSON.stringify(amountShape?.type)}`,
  );

  // 22.3 — erasing a counted fact RE-RUNS the resolver: the cache forgets when the ground does (§11).
  await almanac.gateway.erase(e10.id);
  check(
    "22.3",
    "erasure invalidates by construction — forget the 10 and the sum recomputes to 130, never served from a stale cache",
    (await readAmount("v1")) === 130,
    `amount after erasing 10 = ${await readAmount("v1")}`,
  );

  // 22.4 — change ONLY the resolver (sum → count): a new version mints; v1 keeps its own reading.
  await almanac.gateway.publishRegistration(
    LEDGER,
    SCHEMA,
    ["ledger:lens22"],
    undefined,
    undefined,
    undefined,
    ["amount"],
    { amount: { rung: "a", type: "number", code: COUNT } },
  );
  const versions = almanac.gateway
    .registrationVersions()
    .filter((v) => v.hyperschema.name === "Ledger22");
  const v1 = await readAmount("v1"); // SUM of the surviving two: 130
  const v2 = await readAmount("v2"); // COUNT of the surviving two: 2
  check(
    "22.4",
    "a resolver freezes with its version — v1 still SUMS (130) while v2 COUNTS (2) over one ground",
    versions.length === 2 && v1 === 130 && v2 === 2,
    `v1 sum=${v1} · v2 count=${v2}`,
  );
} finally {
  await almanac?.close().catch(() => {});
}
summary("phase 22 — the lens computes");
