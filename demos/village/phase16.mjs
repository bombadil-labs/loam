import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { trustClaims } from "../../dist/index.js";
import {
  HOMES,
  check,
  join,
  openStore,
  opToken,
  pullFrom,
  signClaims,
  sleep,
  summary,
} from "./harness.mjs";

const NAME = "phasegrove";
const PORT = 4407;
const BASE = `http://127.0.0.1:${PORT}/${NAME}`;
const GROW = join(HOMES, "..", "grow.mjs");

const schemaPath = join(HOMES, "phasegrove-schema.json");
const claimsPath = join(HOMES, "phasegrove-facts.json");
writeFileSync(
  schemaPath,
  JSON.stringify({
    hyperschema: {
      name: "Grove",
      alg: 1,
      body: {
        op: "group",
        key: "byTargetContext",
        in: {
          op: "select",
          pred: { hasPointer: { targetEntity: { var: "root" } } },
          in: { op: "mask", policy: "drop", in: "input" },
        },
      },
    },
    schema: {
      props: {
        species: { pick: { order: { byTimestamp: "desc" } } },
        age: { pick: { order: { byTimestamp: "desc" } } },
        note: { all: { order: { byTimestamp: "asc" } } },
      },
      default: { pick: { order: { byTimestamp: "desc" } } },
    },
    roots: ["grove:oak", "grove:rowan"],
  }),
);
writeFileSync(
  claimsPath,
  JSON.stringify([
    { at: "grove:oak", context: "species", value: "pedunculate oak" },
    { at: "grove:oak", context: "age", value: "two hundred years, give or take" },
    { at: "grove:oak", context: "note", value: "the moot tree; the rope swing is Petra's" },
    { at: "grove:rowan", context: "species", value: "rowan" },
  ]),
);

function growChild() {
  const child = spawn(
    process.execPath,
    [GROW, NAME, "--port", String(PORT), "--schema", schemaPath, "--claims", claimsPath],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "";
  let err = "";
  const ready = new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error(`grow.mjs never became ready:\n${out}\n${err}`)), 20_000);
    child.stdout.on("data", (b) => {
      out += b;
      if (out.includes("grows.")) {
        clearTimeout(guard);
        resolve();
      }
    });
    child.stderr.on("data", (b) => (err += b));
    child.once("exit", (code) => {
      clearTimeout(guard);
      reject(new Error(`grow.mjs exited early (code ${code}):\n${out}\n${err}`));
    });
  });
  return { child, ready, out: () => out };
}

const growGql = async (query) => {
  const res = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: { authorization: `Bearer op-${NAME}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
};

let almanac, grown;
try {
  almanac = await openStore("almanac");
  await almanac.gateway.append([
    signClaims(trustClaims("open", [], almanac.operator, Date.now()), almanac.seed),
  ]);

  grown = growChild();
  await grown.ready;

  const oak = await growGql(`{ grove(entity: "grove:oak") { species age note } }`);
  check(
    "16.1",
    "the grown store answers its own schema the moment it is up — registered live, no restart",
    oak.status === 200 &&
      oak.body?.data?.grove?.species === "pedunculate oak" &&
      JSON.stringify(oak.body?.data?.grove?.note ?? []).includes("moot tree"),
    JSON.stringify(oak.body?.data?.grove?.species),
  );

  const { readFileSync } = await import("node:fs");
  let peers = [];
  try {
    peers = JSON.parse(readFileSync(join(HOMES, "peers.json"), "utf8"));
  } catch {
  }
  const entry = peers.find((p) => p.base === BASE);
  check(
    "16.2",
    "the confluence will find it: a peers.json entry the village pulse re-reads each beat",
    entry !== undefined && entry.name === NAME && entry.token === `op-${NAME}`,
    JSON.stringify(entry),
  );

  const report = await pullFrom(almanac.gateway, BASE, `op-${NAME}`);
  const landed = [...almanac.gateway.reactor.snapshot()].some((d) =>
    d.claims.pointers.some(
      (p) => p.target.kind === "primitive" && p.target.value === "pedunculate oak",
    ),
  );
  check(
    "16.3",
    "one pull lands the grove's facts in the almanac's ground — the confluence grew",
    report.accepted > 0 && landed,
    `pull accepted ${report.accepted}`,
  );
} finally {
  grown?.child.kill();
  await sleep(300);
  await almanac?.close().catch(() => {});
}
summary("phase 16 — grown live");
