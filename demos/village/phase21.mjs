import {
  DeltaSet,
  loadSchema,
  makeNegationClaims,
  parseSchema,
  parseTerm,
  signClaims,
} from "@bombadil/rhizomatic";
import { schemaLivingEntityFor, versionedSchemaEntityFor } from "../../dist/index.js";
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

const LEDGER = { name: "Ledger21", alg: 1, body: parseTerm(GATHER) };
const ALL = { all: { order: { byTimestamp: "asc" } } };
const V1 = parseSchema({ props: { amount: PICK }, default: PICK });
const V2 = parseSchema({ props: { amount: PICK, memo: ALL }, default: PICK });

let almanac;
try {
  almanac = await openStore("almanac");
  const operator = almanac.operator;
  const ground = () => DeltaSet.from([...almanac.gateway.reactor.snapshot()]);
  const rest = (path, token) =>
    fetch(`${almanac.base}${path}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });

  for (const stale of almanac.gateway
    .registrationVersions()
    .filter((v) => v.hyperschema.name === "Ledger21")) {
    await almanac.gateway.append([
      signClaims(
        makeNegationClaims(operator, Date.now(), stale.deltaId, "phase 21 clears its stage"),
        almanac.seed,
      ),
    ]);
  }

  await almanac.gateway.publishRegistration(LEDGER, V1, ["ledger:almanac"]);
  await almanac.gateway.append([
    signClaims(
      {
        ...((t) => ({ timestamp: t, validFrom: t }))(Date.now()),
        author: operator,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: "ledger:almanac", context: "amount" } } },
          { role: "value", target: { kind: "primitive", value: 100 } },
        ],
      },
      almanac.seed,
    ),
  ]);

  const living = loadSchema(ground(), schemaLivingEntityFor("Ledger21"));
  check(
    "21.1",
    "registering a lens plants a first-class schema:<name> entity — a domain node, not an inline blob",
    living.name === "Ledger21" && living.props.has("amount"),
    `schema:Ledger21 → {${[...living.props.keys()].join(", ")}}`,
  );

  const v1Snap = versionedSchemaEntityFor("Ledger21", V1);
  const frozenV1 = loadSchema(ground(), v1Snap);
  check(
    "21.2",
    "a content-addressed VersionedSchema snapshot is minted beside it — name@hash, frozen",
    v1Snap.startsWith("schema:Ledger21@") && frozenV1.props.has("amount") && !frozenV1.props.has("memo"),
    `${v1Snap.slice(0, 26)}…`,
  );

  await almanac.gateway.publishRegistration(LEDGER, V2, ["ledger:almanac"]);
  await almanac.gateway.append([
    signClaims(
      {
        ...((t) => ({ timestamp: t, validFrom: t }))(Date.now()),
        author: operator,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: "ledger:almanac", context: "memo" } } },
          { role: "value", target: { kind: "primitive", value: "audited and true" } },
        ],
      },
      almanac.seed,
    ),
  ]);
  const v2Snap = versionedSchemaEntityFor("Ledger21", V2);
  const stillFrozenV1 = loadSchema(ground(), v1Snap);
  const frozenV2 = loadSchema(ground(), v2Snap);
  check(
    "21.3",
    "evolving mints a new snapshot; the old one is undisturbed — two readings coexist, neither struck",
    v1Snap !== v2Snap &&
      !stillFrozenV1.props.has("memo") &&
      frozenV2.props.has("memo") &&
      loadSchema(ground(), schemaLivingEntityFor("Ledger21")).props.has("memo"),
    `v1 ${v1Snap.slice(15, 23)}… ≠ v2 ${v2Snap.slice(15, 23)}…`,
  );

  const versions = almanac.gateway
    .registrationVersions()
    .filter((v) => v.hyperschema.name === "Ledger21");
  const v1Body = await (
    await rest(`/rest/v1/Ledger21/${encodeURIComponent("ledger:almanac")}`, opToken("almanac"))
  ).json();
  const v2Body = await (
    await rest(`/rest/v2/Ledger21/${encodeURIComponent("ledger:almanac")}`, opToken("almanac"))
  ).json();
  check(
    "21.4",
    "each version resolves against its own frozen snapshot: v1 answers memo as a scalar, v2 as a list — §17 freezing, on entities",
    versions.length === 2 &&
      typeof v1Body.view?.memo === "string" &&
      Array.isArray(v2Body.view?.memo) &&
      v1Body._hex !== v2Body._hex,
    `v1 memo=${JSON.stringify(v1Body.view?.memo)} · v2 memo=${JSON.stringify(v2Body.view?.memo)}`,
  );
} finally {
  await almanac?.close().catch(() => {});
}
summary("phase 21 — the schema is a citizen");
