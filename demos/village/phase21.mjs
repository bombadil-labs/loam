// Phase 21 — THE SCHEMA IS A CITIZEN (SPEC §21 slice 2). Until now a lens rode INLINE in its
// registration — canonical JSON with no identity of its own. Slice 2 lifts it: register a lens and the
// almanac's ground gains a living `schema:<name>` entity (a domain node like any Person or Film) and a
// frozen, content-addressed VersionedSchema snapshot beside it. Evolve the lens and a NEW snapshot is
// minted while the OLD one goes on answering — coexist, never superseded — so each §17 version resolves
// against its OWN frozen reading. This act reads those entities straight out of the running store.

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

// The lens this act owns end to end (a name of its own, so a re-run is idempotent by law).
const LEDGER = { name: "Ledger21", alg: 1, body: parseTerm(GATHER) };
const ALL = { all: { order: { byTimestamp: "asc" } } };
const V1 = parseSchema({ props: { amount: PICK }, default: PICK });
// v2 declares `memo` as ALL (a list). v1 never named it, so v1's DEFAULT (pick) answers the same fact
// as a SCALAR — one ground, two frozen readings, the shape of §17 freezing made visible.
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

  // Clear the stage: strike every surviving Ledger21 version (the almanac's home persists between runs).
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

  // Register the lens, and give it one fact to resolve.
  await almanac.gateway.publishRegistration(LEDGER, V1, ["ledger:almanac"]);
  await almanac.gateway.append([
    signClaims(
      {
        timestamp: Date.now(),
        author: operator,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: "ledger:almanac", context: "amount" } } },
          { role: "value", target: { kind: "primitive", value: 100 } },
        ],
      },
      almanac.seed,
    ),
  ]);

  // 21.1 — the lens is a living entity now: `schema:Ledger21` reads back as a genuine domain node.
  const living = loadSchema(ground(), schemaLivingEntityFor("Ledger21"));
  check(
    "21.1",
    "registering a lens plants a first-class schema:<name> entity — a domain node, not an inline blob",
    living.name === "Ledger21" && living.props.has("amount"),
    `schema:Ledger21 → {${[...living.props.keys()].join(", ")}}`,
  );

  // 21.2 — a frozen, content-addressed VersionedSchema snapshot stands beside the living lens.
  const v1Snap = versionedSchemaEntityFor("Ledger21", V1);
  const frozenV1 = loadSchema(ground(), v1Snap);
  check(
    "21.2",
    "a content-addressed VersionedSchema snapshot is minted beside it — name@hash, frozen",
    v1Snap.startsWith("schema:Ledger21@") && frozenV1.props.has("amount") && !frozenV1.props.has("memo"),
    `${v1Snap.slice(0, 26)}…`,
  );

  // 21.3 — evolve: a NEW snapshot is minted; the OLD one still answers (coexist, never superseded).
  await almanac.gateway.publishRegistration(LEDGER, V2, ["ledger:almanac"]);
  // a memo fact, so v2 (which declares memo) shows it where v1 (which never named it) omits it entirely
  await almanac.gateway.append([
    signClaims(
      {
        timestamp: Date.now(),
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
  const stillFrozenV1 = loadSchema(ground(), v1Snap); // the old snapshot, untouched by the new mint
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

  // 21.4 — end to end: each §17 version freezes against its OWN snapshot, straight through the REST door.
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
