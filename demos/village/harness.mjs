// The Village harness — shared machinery for every phase. Ephemeral, never committed.

import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ArchiveBackend,
  Gateway,
  tombstonesIn,
  MirrorBackend,
  SqliteBackend,
  assembleGenesis,
  governedGatherBody,
  grantClaims,
  initHome,
  membershipClaims,
  pullFrom,
  readConfig,
  serve,
} from "../../dist/index.js";
import { readSeed } from "../../dist/cli/config.js";
import { authorForSeed, parseTerm, signClaims, termToJson } from "@bombadil/rhizomatic";

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const HOMES = join(ROOT, "homes");
export const SCHEMAS = join(ROOT, "schemas");

// ---- the cast ---------------------------------------------------------------------------------
export const SEEDS = {
  wren: "11".repeat(32),
  miles: "22".repeat(32),
  odile: "33".repeat(32),
  petra: "44".repeat(32),
  sasha: "55".repeat(32), // the stranger: cinelog's only resident
  miller: "77".repeat(32), // the runner identity: grinds the almanac's ground into flour
  // the palisade gate: a TRANSPORT identity only (Unit 3b) — its token may sit in a public
  // page because a token lends no authority; it signs nothing and holds no standing
  gate: "99".repeat(32),
  mallory: "ee".repeat(32),
};
export const AUTHORS = Object.fromEntries(
  Object.entries(SEEDS).map(([k, s]) => [k, authorForSeed(s)]),
);
export const PEOPLE = ["person:wren", "person:miles", "person:odile", "person:petra"];

// ---- the stores -------------------------------------------------------------------------------
// The hive publishes everything EXCEPT Odile's frank grumbles — the offered lens.
const GRUMBLE_LENS = parseTerm({
  op: "select",
  pred: { not: { hasPointer: { context: { exact: "grumbles" } } } },
  in: { op: "mask", policy: "drop", in: "input" },
});

const actorTokens = (store) =>
  Object.fromEntries(
    Object.entries(SEEDS).map(([who, seed]) => [`${who}-${store}`, { actor: seed }]),
  );

export const STORES = {
  commons: { port: 4401 },
  reel: { port: 4402 },
  hive: { port: 4403, lens: GRUMBLE_LENS },
  almanac: { port: 4404, archive: true }, // the aggregator keeps a seed vault — cold copies of every delta
  cinelog: { port: 4405 }, // the stranger's app — an alien dialect, normalized by translation
};

export const opToken = (store) => `op-${store}`;
export const tok = (who, store) => `${who}-${store}`;

export function homeOf(store) {
  return join(HOMES, store);
}

export function operatorOf(store) {
  return readConfig(homeOf(store)).operator;
}

// Open a store from its home (idempotent boot: genesis re-lands the same marker), serve it.
// The gateway is in-process (so tests may introspect); the HTTP surface is real.
export async function openStore(name, opts = {}) {
  const cfg = STORES[name];
  const home = homeOf(name);
  initHome(home);
  const seed = readSeed(home);
  let backend = new SqliteBackend(join(home, "store.sqlite"));
  // A store with a vault mirrors every append into cold files and heals BEFORE the gateway
  // reads — so a lost sqlite is replanted from the vault's memory (the crash act relies on it).
  const vault = cfg.archive ? join(home, "vault") : undefined;
  let healed = { toMirror: 0, toPrimary: 0 };
  if (vault !== undefined) {
    const archive = new ArchiveBackend(vault);
    backend = new MirrorBackend(backend, archive, {
      onLag: (err) => console.log(`  ${name}'s vault is lagging: ${err}`),
    });
    // the law reaches the vault: tombstoned ids are never replanted by a heal (SPEC §11)
    const dead = tombstonesIn(
      [...(await backend.deltasSince(new Set())), ...(await archive.deltasSince(new Set()))],
      authorForSeed(seed),
    );
    healed = await backend.heal(dead);
  }
  const gateway = await Gateway.open(backend, {
    seed,
    ...(cfg.lens === undefined ? {} : { offeredLens: cfg.lens }),
    // Provisioned renderer-pen seeds (SPEC §23.3) — custody in config, so a write-enabled renderer act
    // can sign form-submits as a granted author. Passed by the act, never persisted to the ground.
    ...(opts.pens === undefined ? {} : { pens: opts.pens }),
  });
  await gateway.append(assembleGenesis({ operatorSeed: seed }).deltas);
  const handle = await serve({
    mounts: { [name]: gateway },
    tokens: { [opToken(name)]: { operator: true }, ...actorTokens(name) },
    port: cfg.port,
    host: "127.0.0.1",
  });
  return {
    name,
    gateway,
    seed,
    operator: authorForSeed(seed),
    base: `${handle.url}/${name}`,
    vault,
    healed,
    async close() {
      await handle.close();
      await gateway.close();
    },
  };
}

// The crash: drop a store's sqlite files (the vault, if any, is untouched).
export function dropStore(name) {
  const home = homeOf(name);
  for (const f of ["store.sqlite", "store.sqlite-wal", "store.sqlite-shm"]) {
    rmSync(join(home, f), { force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// ---- HTTP helpers -----------------------------------------------------------------------------
// Stores restart within a phase (close → copy → reopen on the same port), and undici's
// keep-alive pool will happily hand back a socket the old server closed. Short requests say
// connection: close; everything retries a reset once or twice.
async function fetchRetry(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, opts);
    } catch (err) {
      const code = err?.cause?.code ?? "";
      if (i + 1 >= tries || !/ECONNRESET|ECONNREFUSED|UND_ERR_SOCKET/.test(String(code))) throw err;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}

export async function gql(base, token, query, variables) {
  const res = await fetchRetry(`${base}/graphql`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      connection: "close",
    },
    body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

export async function registerHttp(base, token, spec) {
  const res = await fetchRetry(`${base}/register`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      connection: "close",
    },
    body: JSON.stringify(spec),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

export async function mcp(base, token, method, params) {
  const res = await fetchRetry(`${base}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      connection: "close",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

// The GuardedDossier register body, built at runtime (its trust mask embeds the almanac's
// operator): rhizomatic 0.2.0's governed lens — negations bind only from the operator and the
// operator's grantees, so a federated stranger's strike is inert here.
export function guardedDossierSpec(operator) {
  const PICK = { pick: { order: { byTimestamp: "desc" } } };
  const ALL = { all: { order: { byTimestamp: "asc" } } };
  // Both 0.2.0 lenses at once — they guard DIFFERENT attacks: the trust MASK makes a
  // stranger's strike inert (erasure), the chain ORDER outranks a stranger's forgery
  // (fabrication). A dossier wants both.
  const TRUSTED_LATEST = {
    pick: {
      order: {
        chain: [
          { byAuthorRank: [AUTHORS.wren, AUTHORS.miles, AUTHORS.odile, AUTHORS.petra] },
          { byTimestamp: "desc" },
        ],
      },
    },
  };
  return {
    hyperschema: { name: "GuardedDossier", alg: 1, body: termToJson(governedGatherBody(operator)) },
    schema: {
      props: { name: PICK, bio: TRUSTED_LATEST, follows: ALL, companioned: ALL, attended: ALL },
      default: PICK,
    },
    roots: PEOPLE,
  };
}

// A register file IS the register-request shape now ({ hyperschema, schema, roots }) — load it.
export function loadSpec(file) {
  return JSON.parse(readFileSync(join(SCHEMAS, file), "utf8"));
}

// ---- SSE --------------------------------------------------------------------------------------
export async function sseOpen(base, token, subscription) {
  const res = await fetchRetry(`${base}/subscribe?query=${encodeURIComponent(subscription)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status !== 200 || !res.headers.get("content-type")?.includes("event-stream")) {
    throw new Error(`subscribe refused: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return {
    async nextFrame(timeoutMs = 8000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const idx = buffered.indexOf("\n\n");
        if (idx >= 0) {
          const frame = buffered.slice(0, idx);
          buffered = buffered.slice(idx + 2);
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("");
          if (data) return JSON.parse(data);
          continue;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("SSE frame timeout");
        const chunk = await Promise.race([
          reader.read(),
          new Promise((_, rej) => setTimeout(() => rej(new Error("SSE frame timeout")), remaining)),
        ]);
        if (chunk.done) throw new Error("SSE stream closed");
        buffered += decoder.decode(chunk.value, { stream: true });
      }
    },
    async expectSilence(windowMs = 1500) {
      try {
        const frame = await this.nextFrame(windowMs);
        return { silent: false, frame };
      } catch (err) {
        if (/timeout/.test(String(err))) return { silent: true };
        throw err;
      }
    },
    async close() {
      await reader.cancel().catch(() => {});
    },
  };
}

// ---- writes beyond primitives: signed multi-pointer edges -------------------------------------
// GraphQL mutations write primitive property claims; RELATIONS are entity-pointer deltas an app
// crafts and appends itself. Each edge files at BOTH ends — one delta, two views.
const entityPtr = (role, id, context) => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});

export const followClaims = (who, whom, timestamp) => ({
  timestamp,
  author: "",
  pointers: [entityPtr("subject", who, "follows"), entityPtr("friend", whom, "circle")],
});

export const companionClaims = (screening, person, timestamp) => ({
  timestamp,
  author: "",
  pointers: [
    entityPtr("screening", screening, "with"),
    entityPtr("companion", person, "companioned"),
  ],
});

export const filmOfClaims = (screening, film, timestamp) => ({
  timestamp,
  author: "",
  pointers: [entityPtr("screening", screening, "film"), entityPtr("film", film, "screened")],
});

export const attendClaims = (gathering, person, timestamp) => ({
  timestamp,
  author: "",
  pointers: [
    entityPtr("gathering", gathering, "attendee"),
    entityPtr("attendee", person, "attended"),
  ],
});

export async function appendAs(gateway, who, claimsList) {
  const seed = SEEDS[who];
  const deltas = claimsList.map((c) => signClaims({ ...c, author: AUTHORS[who] }, seed));
  return gateway.append(deltas);
}

// Operator-signed standing for a store's residents (authors, not owners: entities are unowned;
// the only write gate is the author's standing at loam:store). FIXED timestamps so re-runs
// dedup by content address.
export async function constitute(store, authors, baseTs) {
  const deltas = authors.map((who, i) =>
    signClaims(
      grantClaims("loam:store", AUTHORS[who], "write", store.operator, baseTs + 500 + i),
      store.seed,
    ),
  );
  await store.gateway.append(deltas);
}

// Standing for an author the cast never knew — a browser-minted villager, say (phase 13).
export async function grantAuthor(store, author, timestamp) {
  await store.gateway.append([
    signClaims(grantClaims("loam:store", author, "write", store.operator, timestamp), store.seed),
  ]);
}

export { pullFrom, signClaims, authorForSeed, parseTerm };

// ---- the tally --------------------------------------------------------------------------------
const results = [];
export function check(id, label, ok, detail = "") {
  results.push({ id, ok });
  const flag = ok ? "  ok " : "  FAIL";
  console.log(`${flag} ${id} ${label}${detail === "" ? "" : ` — ${detail}`}`);
}
export function summary(phase) {
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n=== ${phase}: ${results.length - failed.length}/${results.length} passed` +
      (failed.length > 0 ? ` — FAILED: ${failed.map((f) => f.id).join(", ")}` : " ==="),
  );
  process.exitCode = failed.length > 0 ? 1 : 0;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { copyFileSync, existsSync, join };
