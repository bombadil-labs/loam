// Grow a store, live: `node demos/village/grow.mjs <name> --port <p> --schema <file> [--claims <file>]`
//
// The demo's item 7 — mid-meeting, a new sovereign store for whatever she names, federating
// into the village before the coffee refills. One command: a home is minted (its own
// operator — never share seeds across stores), the store boots governed and serves, the
// schema registers over HTTP, a scribe gains standing, the claims file lands as signed
// deltas, and the confluence learns the address (homes/peers.json — the village's pulse
// reads it every beat and narrates first contact). Blocks like the server it is; ^C to stop.
//
// The claims file is triples: [{ "at": "plant:rose", "context": "note", "value": "thorny" }]
// — each becomes one signed delta at that entity/context. Fixed timestamps make re-runs
// dedup by content address.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway, SqliteBackend, assembleGenesis, initHome, serve } from "../../dist/index.js";
import { readSeed } from "../../dist/cli/config.js";
import { HOMES, grantAuthor, registerHttp } from "./harness.mjs";

const [name, ...rest] = process.argv.slice(2);
const flag = (f) => {
  const i = rest.indexOf(`--${f}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error("grow wants a lowercase store name: node demos/village/grow.mjs <name> --schema <file>");
  process.exit(2);
}
const port = Number(flag("port") ?? 4406);
const schemaFile = flag("schema");
const claimsFile = flag("claims");

// A home of its own — its own operator, its own law.
const home = join(HOMES, name);
initHome(home);
const seed = readSeed(home);
const gateway = await Gateway.boot(
  new SqliteBackend(join(home, "store.sqlite")),
  assembleGenesis({ operatorSeed: seed }),
);
const opToken = `op-${name}`;
const handle = await serve({
  mounts: { [name]: gateway },
  tokens: { [opToken]: { operator: true } },
  port,
  host: "127.0.0.1",
});
const base = `${handle.url}/${name}`;
console.log(`${name} is up at ${base} — its own operator, its own law`);

// The schema, registered over the running surface (the store gains a voice with no restart).
if (schemaFile !== undefined) {
  // The schema file IS the register-request shape ({ hyperschema, schema, roots }) — send it.
  const spec = JSON.parse(readFileSync(schemaFile, "utf8"));
  const reg = await registerHttp(base, opToken, spec);
  if (reg.status !== 200) {
    console.error(`the schema was refused: ${JSON.stringify(reg.body)}`);
    process.exit(1);
  }
  console.log(`registered ${spec.hyperschema.name} — the surface answers already`);
}

// The scribe: a minted identity with write standing. The seed stays in the home beside the
// operator's; the author is safe to show around.
const scribePath = join(home, "scribe.seed");
if (!existsSync(scribePath)) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  writeFileSync(scribePath, [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
}
const scribeSeed = readFileSync(scribePath, "utf8").trim();
const scribe = authorForSeed(scribeSeed);
await grantAuthor({ gateway, operator: authorForSeed(seed), seed }, scribe, 2_000_000);
console.log(`the scribe holds standing: ${scribe.slice(0, 28)}…`);

// First facts, if any: triples become signed deltas (fixed timestamps — re-runs dedup).
if (claimsFile !== undefined) {
  const triples = JSON.parse(readFileSync(claimsFile, "utf8"));
  const deltas = triples.map((t, i) =>
    signClaims(
      {
        timestamp: 2_000_100 + i,
        author: scribe,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: t.at, context: t.context } } },
          { role: "value", target: { kind: "primitive", value: t.value } },
        ],
      },
      scribeSeed,
    ),
  );
  const receipt = await gateway.append(deltas);
  console.log(`${receipt.accepted} facts on the ground (${receipt.duplicates} already known)`);
}

// The confluence learns the address: the village's pulse reads peers.json every beat.
const peersPath = join(HOMES, "peers.json");
let peers = [];
try {
  peers = JSON.parse(readFileSync(peersPath, "utf8"));
} catch {
  // no peers yet — this store is the first newcomer
}
if (!peers.some((p) => p.base === base)) {
  peers.push({ name, base, token: opToken });
  writeFileSync(peersPath, `${JSON.stringify(peers, null, 2)}\n`);
  console.log(`the confluence will find ${name} on its next beat (homes/peers.json)`);
}

console.log(`${name} grows. ^C to stop.`);
await new Promise((resolve) => {
  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);
});
await handle.close();
await gateway.close();
