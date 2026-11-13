import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  AUTHORS,
  PEOPLE,
  SEEDS,
  appendAs,
  attendClaims,
  dropStore,
  companionClaims,
  followClaims,
  gql,
  join,
  openStore,
  opToken,
  pullFrom,
  ROOT,
  signClaims,
  sleep,
  tok,
} from "./harness.mjs";

const VIEWER_PORT = 4400;
const stores = {};
for (const name of ["commons", "reel", "hive", "almanac", "cinelog"]) stores[name] = await openStore(name);
const { commons, reel, hive, cinelog } = stores;
let almanac = stores.almanac;
if (almanac.healed.toPrimary > 0) {
  console.log(`the seed vault replanted the almanac: ${almanac.healed.toPrimary} deltas restored`);
}
const { constitute } = await import("./harness.mjs");
await constitute(commons, ["wren", "miles", "odile", "petra"], 1_000_000);
await constitute(reel, ["miles"], 1_000_000);
await constitute(hive, ["odile"], 1_000_000);
await constitute(cinelog, ["sasha"], 1_000_000);
await constitute(almanac, ["wren", "miles", "odile", "petra", "miller"], 1_000_000);
console.log("the village is up: commons 4401, reel 4402, hive 4403, almanac 4404");

const { attachMill, ensurePresence, plantMill } = await import("./mill.mjs");
await ensurePresence(almanac.base, opToken("almanac"));
await plantMill(almanac);
await attachMill(almanac);
console.log("the mill wheel turns: the almanac is animate (fn:grind, signed by the miller)");

const { publicClaims } = await import("../../dist/index.js");
await almanac.gateway.append([
  signClaims(
    publicClaims(["Dossier", "TrustedDossier", "GuardedDossier"], almanac.operator, 1_000_002),
    almanac.seed,
  ),
]);
console.log("the almanac's door stands open: dossiers readable tokenless, three lenses public");

const clients = new Set();
let lastTrust;
function broadcast(obj) {
  if (obj.kind === "trust") lastTrust = obj;
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of [...clients]) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
}
const CAST = ["wren", "miles", "odile", "petra", "sasha", "mallory"];
const inferActor = (t) => CAST.find((c) => t.toLowerCase().includes(c));
const inferPlace = (t) => {
  const s = t.toLowerCase();
  if (s.includes("cinelog")) return "cinelog";
  if (s.includes("reel") || s.includes("screening") || s.includes("reconsider")) return "reel";
  if (
    s.includes("hive") ||
    s.includes("jars") ||
    s.includes("grumble") ||
    s.includes("harvest") ||
    s.includes("turns up")
  )
    return "hive";
  if (
    s.includes("forge") ||
    s.includes("strike") ||
    s.includes("roster") ||
    s.includes("door") ||
    s.includes("bounce")
  )
    return "gate";
  if (
    s.includes("almanac") ||
    s.includes("unsay") ||
    s.includes("mill") ||
    s.includes("disk") ||
    s.includes("vault") ||
    s.includes("render")
  )
    return "almanac";
  if (s.includes("commons") || s.includes("bio") || s.includes("follow") || s.includes("speaks"))
    return "commons";
  return undefined;
};
const tell = (text, tone = "write") => {
  console.log(`  ${text}`);
  broadcast({ kind: "event", text, tone, actor: inferActor(text), place: inferPlace(text) });
};

const { fromWire, grantClaims } = await import("../../dist/index.js");
const { verifyDelta } = await import("@bombadil/rhizomatic");
const { loadSpec, registerHttp } = await import("./harness.mjs");
const players = new Set();
const petitionShape = (delta) => {
  const knocks = delta.claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === "loam:gate" &&
      p.target.entity.context === "loam.petition",
  );
  const name = delta.claims.pointers.find((p) => p.role === "name")?.target;
  return knocks && name?.kind === "primitive" && typeof name.value === "string"
    ? name.value.slice(0, 24)
    : undefined;
};
async function handlePetition(req, res) {
  let body = "";
  for await (const c of req) body += c;
  try {
    const delta = fromWire(JSON.parse(body).delta);
    if (verifyDelta(delta) !== "verified") throw new Error("the petition is unsigned");
    const name = petitionShape(delta);
    if (name === undefined) throw new Error("a petition names its bearer and knocks at loam:gate");
    const author = delta.claims.author;
    tell(`🚪 a stranger knocks at the palisade — ${name} petitions for standing`, "write");
    await almanac.gateway.append([
      signClaims(
        grantClaims("loam:store", author, "write", almanac.operator, Date.now()),
        almanac.seed,
      ),
    ]);
    await almanac.gateway.append([delta]);
    players.add(`person:${name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16)}`);
    const spec = loadSpec("dossier.json");
    await registerHttp(almanac.base, opToken("almanac"), {
      ...spec,
      roots: [...spec.roots, ...players],
    });
    await attachMill(stores.almanac);
    tell(`🏡 the operator opens the palisade for ${name} — standing granted, the roll grows, the mill grinds for them now`, "patch");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ granted: author }));
  } catch (err) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ errors: [err instanceof Error ? err.message : String(err)] }));
  }
}

const page = readFileSync(join(ROOT, "dashboard.html"), "utf8")
  .replace("__ALMANAC_PUBLIC_DOOR__", almanac.base)
  .replace("__GATE_TOKEN__", tok("gate", "almanac"));
const clientJs = readFileSync(join(ROOT, "..", "..", "dist", "client", "index.js"));
const viewer = createServer((req, res) => {
  if (req.url === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(":welcome to the village\n\n");
    if (lastTrust) res.write(`data: ${JSON.stringify(lastTrust)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (req.url === "/client.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end(clientJs);
    return;
  }
  if (req.url === "/petition" && req.method === "POST") {
    void handlePetition(req, res);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
});
await new Promise((r) => viewer.listen(VIEWER_PORT, "127.0.0.1", r));
console.log(`the almanac is readable at http://127.0.0.1:${VIEWER_PORT}`);

const { translate, translationClaims } = await import("../../dist/index.js");
await almanac.gateway.append([
  signClaims(
    translationClaims(
      "cinelog",
      {
        and: [
          { hasPointer: { role: { exact: "film_watched" } } },
          { hasPointer: { role: { exact: "viewer" } } },
        ],
      },
      {
        pointers: [
          { role: "guest", at: { from: { role: "viewer" } }, context: "attended" },
          { role: "film", at: { from: { role: "film_watched" } }, context: "screenings" },
          { role: "date", value: { from: { role: "on" } } },
          { role: "origin", value: "cinelog" },
        ],
      },
      almanac.operator,
      1_000_001,
    ),
    almanac.seed,
  ),
]);

const seenPeers = new Set();
async function pullPeers() {
  let peers = [];
  try {
    peers = JSON.parse(readFileSync(join(ROOT, "homes", "peers.json"), "utf8"));
  } catch {
    return 0;
  }
  let accepted = 0;
  for (const peer of peers) {
    if (typeof peer?.base !== "string" || typeof peer?.token !== "string") continue;
    try {
      const report = await pullFrom(almanac.gateway, peer.base, peer.token);
      accepted += report.accepted;
      if (!seenPeers.has(peer.base)) {
        seenPeers.add(peer.base);
        tell(
          `🌱 a new store joins the confluence: ${peer.name ?? peer.base} — the almanac renders it in`,
          "patch",
        );
      }
    } catch {
    }
  }
  return accepted;
}

async function pulse() {
  for (;;) {
    try {
      const a = await pullFrom(reel.gateway, commons.base, opToken("commons"));
      const b = await pullFrom(almanac.gateway, commons.base, opToken("commons"));
      const c = await pullFrom(almanac.gateway, reel.base, opToken("reel"));
      const d = await pullFrom(almanac.gateway, hive.base, opToken("hive"));
      const e = await pullFrom(almanac.gateway, cinelog.base, opToken("cinelog"));
      const f = await pullPeers();
      const rendered = await translate(almanac.gateway, { seed: almanac.seed });
      if (rendered.emitted > 0) {
        tell(
          `🗣️ the almanac renders ${rendered.emitted} cinelog ${rendered.emitted === 1 ? "entry" : "entries"} into the village's tongue`,
          "patch",
        );
      }
      broadcast({
        kind: "pulse",
        accepted: a.accepted + b.accepted + c.accepted + d.accepted + e.accepted + f,
      });
      const plain = (
        await gql(almanac.base, opToken("almanac"), `{ dossier(entity: "person:wren") { bio } }`)
      ).body?.data?.dossier?.bio;
      const trusted = (
        await gql(
          almanac.base,
          opToken("almanac"),
          `{ trustedDossier(entity: "person:wren") { bio } }`,
        )
      ).body?.data?.trustedDossier?.bio;
      const guarded = (
        await gql(
          almanac.base,
          opToken("almanac"),
          `{ guardedDossier(entity: "person:wren") { bio } }`,
        )
      ).body?.data?.guardedDossier?.bio;
      broadcast({ kind: "trust", plain, trusted, guarded });
      const milled = (
        await gql(
          almanac.base,
          opToken("almanac"),
          `{ ${PEOPLE.map(
            (p, i) => `m${i}: dossier(entity: "${p}") { presence }`,
          ).join(" ")} }`,
        )
      ).body?.data;
      broadcast({
        kind: "mill",
        flour: Object.fromEntries(
          PEOPLE.map((p, i) => [p, milled?.[`m${i}`]?.presence?.value ?? null]),
        ),
      });
    } catch (err) {
      console.log(`  pulse stumbled: ${err}`);
    }
    await sleep(2000);
  }
}
void pulse();

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const BIOS = {
  wren: [
    "keeper of the commons; the fern archive grows",
    "keeper of the commons; teaching moss to newcomers",
    "keeper of the commons; the chanterelles are early this year",
    "keeper of the commons; mending the low wall",
  ],
  petra: [
    "new to the village, old to bees",
    "new to the village; learning every path twice",
    "newcomer; the hive tolerates her, which is high praise",
  ],
  miles: [
    "cinephile; projectionist of the barn",
    "cinephile; subtitling by candlelight",
    "cinephile; the reel never lies, only edits",
  ],
};
const SCREENINGS = ["screening:s1", "screening:s2", "screening:s3", "screening:s4"];
const TITLES = {
  "screening:s1": "Solaris",
  "screening:s2": "The Secret Garden",
  "screening:s3": "Local Hero",
  "screening:s4": "The Secret Garden (again)",
};
const followPool = [
  ["odile", "person:wren"],
  ["petra", "person:wren"],
  ["petra", "person:odile"],
  ["miles", "person:odile"],
  ["odile", "person:petra"],
  ["wren", "person:miles"],
];
const companionPool = [
  ["screening:s4", "person:petra"],
  ["screening:s3", "person:odile"],
  ["screening:s1", "person:wren"],
  ["screening:s4", "person:odile"],
];
const attendPool = [
  ["gathering:harvest-2", "person:wren"],
  ["gathering:harvest-2", "person:miles"],
  ["gathering:harvest-1", "person:petra"],
];
let forgeryOut = false;

const acts = [
  async () => {
    const s = pick(SCREENINGS);
    const rating = 3 + Math.floor(Math.random() * 3);
    await gql(
      reel.base,
      tok("miles", "reel"),
      `mutation { screening(entity: "${s}", rating: ${rating}) { rating } }`,
    );
    tell(`🎬 Miles reconsiders ${TITLES[s]}: ★${rating}`);
  },
  async () => {
    const who = pick(["wren", "miles", "petra"]);
    const bio = pick(BIOS[who]);
    await gql(
      commons.base,
      tok(who, "commons"),
      `mutation { person(entity: "person:${who}", bio: ${JSON.stringify(bio)}) { bio } }`,
    );
    tell(
      `🌿 ${who[0].toUpperCase() + who.slice(1)} tends ${who === "miles" ? "his" : "her"} bio on the commons`,
    );
  },
  async () => {
    const films = ["film:stalker", "film:solaris", "film:mirror", "film:nostalghia"];
    const viewers = ["person:wren", "person:miles", "person:odile", "person:sasha"];
    const film = pick(films);
    const viewer = pick(viewers);
    await appendAs(cinelog.gateway, "sasha", [
      {
        ...((t) => ({ timestamp: t, validFrom: t }))(Date.now()),
        author: AUTHORS.sasha,
        pointers: [
          { role: "film_watched", target: { kind: "entity", entity: { id: film, context: "log" } } },
          { role: "viewer", target: { kind: "entity", entity: { id: viewer, context: "watch_history" } } },
          { role: "on", target: { kind: "primitive", value: new Date().toISOString().slice(0, 10) } },
        ],
      },
    ]);
    tell(`📽️ Sasha's cinelog notes ${viewer.replace("person:", "")} watched ${film.replace("film:", "")} — in a dialect the village doesn't speak`);
  },
  async () => {
    const jars = 11 + Math.floor(Math.random() * 8);
    await gql(
      hive.base,
      tok("odile", "hive"),
      `mutation { colony(entity: "colony:1", yield: ${jars}) { yield } }`,
    );
    tell(`🐝 Odile counts ${jars} jars from the west boxes`);
  },
  async () => {
    await gql(
      hive.base,
      tok("odile", "hive"),
      `mutation { colony(entity: "colony:1", grumbles: "the swarm eyes the church eaves again") { queen } }`,
    );
    tell(
      `🐝 Odile grumbles into her journal (the lens keeps it home — the almanac will never know)`,
    );
  },
  async () => {
    if (followPool.length === 0) return;
    const [who, whom] = followPool.shift();
    await appendAs(commons.gateway, who, [followClaims(`person:${who}`, whom, Date.now())]);
    tell(`🤝 ${who[0].toUpperCase() + who.slice(1)} now follows ${whom.replace("person:", "")}`);
  },
  async () => {
    if (companionPool.length === 0) return;
    const [s, p] = companionPool.shift();
    await appendAs(reel.gateway, "miles", [companionClaims(s, p, Date.now())]);
    tell(`🎬 ${p.replace("person:", "")} joins the ${TITLES[s]} screening on the reel`);
  },
  async () => {
    if (attendPool.length === 0) return;
    const [g, p] = attendPool.shift();
    await appendAs(hive.gateway, "odile", [attendClaims(g, p, Date.now())]);
    tell(`🐝 ${p.replace("person:", "")} turns up for ${g.replace("gathering:", "")}`);
  },
  async () => {
    if (forgeryOut === "struck") {
      const bio = pick(BIOS.wren);
      await gql(
        commons.base,
        tok("wren", "commons"),
        `mutation { person(entity: "person:wren", bio: ${JSON.stringify(bio)}) { bio } }`,
      );
      forgeryOut = "healing";
      tell(`🌿 Wren speaks again — new words outlive struck ones`, "patch");
      return;
    }
    if (forgeryOut === "healing") {
      const { trustClaims } = await import("../../dist/index.js");
      await almanac.gateway.append([
        signClaims(
          trustClaims(
            "roster",
            [AUTHORS.wren, AUTHORS.miles, AUTHORS.odile, AUTHORS.petra,
             commons.operator, reel.operator, hive.operator],
            almanac.operator,
            Date.now(),
          ),
          almanac.seed,
        ),
      ]);
      const bounced = signClaims(
        {
          ...((t) => ({ timestamp: t, validFrom: t }))(Date.now() + 8_000_000),
          author: AUTHORS.mallory,
          pointers: [
            { role: "subject", target: { kind: "entity", entity: { id: "person:wren", context: "bio" } } },
            { role: "value", target: { kind: "primitive", value: "raccoon, I insist" } },
          ],
        },
        SEEDS.mallory,
      );
      const report = await almanac.gateway.federate([bounced]);
      forgeryOut = "rostered";
      tell(
        `🚪 The almanac declares its roster — one delta, and Mallory's next forgery bounces at the door (accepted: ${report.accepted})`,
        "patch",
      );
      return;
    }
    if (forgeryOut === "rostered") {
      const { trustClaims } = await import("../../dist/index.js");
      await almanac.gateway.append([
        signClaims(trustClaims("open", [], almanac.operator, Date.now()), almanac.seed),
      ]);
      forgeryOut = false;
      tell(`🚪 The almanac opens its door again — an aggregator by choice, not by default`, "write");
      return;
    }
    if (forgeryOut === true) {
      const latest = [...almanac.gateway.reactor.snapshot()]
        .filter(
          (d) =>
            d.claims.author === AUTHORS.wren &&
            d.claims.pointers.some(
              (p) => p.target.kind === "entity" && p.target.entity.context === "bio",
            ),
        )
        .sort((a, b) => b.claims.timestamp - a.claims.timestamp)[0];
      if (latest) {
        const { makeNegationClaims } = await import("@bombadil/rhizomatic");
        await almanac.gateway.federate([
          signClaims(
            makeNegationClaims(AUTHORS.mallory, Date.now() + 9_000_000, latest.id),
            SEEDS.mallory,
          ),
        ]);
        tell(
          `🦝 Mallory negates Wren's words in the record — the plain dossier forgets; the guarded lens does not`,
          "forgery",
        );
      }
      forgeryOut = "struck";
      return;
    }
    if (forgeryOut) {
      const bio = pick(BIOS.wren);
      await gql(
        commons.base,
        tok("wren", "commons"),
        `mutation { person(entity: "person:wren", bio: ${JSON.stringify(bio)}) { bio } }`,
      );
      forgeryOut = false;
      tell(`🌿 Wren reclaims her own story — the newest honest word wins again`, "patch");
    } else {
      const forgery = signClaims(
        {
          ...((t) => ({ timestamp: t, validFrom: t }))(Date.now() + 8_000_000),
          author: AUTHORS.mallory,
          pointers: [
            {
              role: "subject",
              target: { kind: "entity", entity: { id: "person:wren", context: "bio" } },
            },
            {
              role: "value",
              target: { kind: "primitive", value: "definitely a raccoon in a coat" },
            },
          ],
        },
        SEEDS.mallory,
      );
      await almanac.gateway.federate([forgery]);
      forgeryOut = true;
      tell(
        `🦝 Mallory federates a forged bio for Wren — pick-latest falls for it; byAuthorRank does not`,
        "forgery",
      );
    }
  },
];

async function theUnsaying() {
  const regret = signClaims(
    {
      ...((t) => ({ timestamp: t, validFrom: t }))(Date.now()),
      author: AUTHORS.wren,
      pointers: [
        { role: 'subject', target: { kind: 'entity', entity: { id: 'person:wren', context: 'bio' } } },
        { role: 'value', target: { kind: 'primitive', value: 'keeper of the commons; and frankly, the hive smells' } },
      ],
    },
    SEEDS.wren,
  );
  await almanac.gateway.append([regret]);
  tell('🌿 Wren speaks in haste, then asks the almanac to unsay it…', 'write');
  await sleep(4000);
  const report = await almanac.gateway.erase(regret.id, { reason: 'unsaid at the subject’s request' });
  const { attachMill } = await import('./mill.mjs');
  await attachMill(stores.almanac);
  tell(
    `🕳️ the almanac's operator honors it — the bytes are cleared from every tier, the signed hole remains (${report.citations.length} citations), and the door will refuse its return`,
    "patch",
  );
}

async function theCrash() {
  const before = [...almanac.gateway.reactor.snapshot()].length;
  tell(`💥 the almanac's disk fails — ${before} deltas of hot store, gone in an instant`, "forgery");
  await stores.almanac.close();
  dropStore("almanac");
  stores.almanac = await openStore("almanac");
  almanac = stores.almanac;
  tell(
    `🌱 the seed vault replants the almanac — ${almanac.healed.toPrimary} deltas restored, every dossier intact`,
    "patch",
  );
  const { attachMill } = await import("./mill.mjs");
  await attachMill(stores.almanac);
  tell(`🌾 the mill wheel is rehung — the reborn almanac grinds on`, "patch");
}

async function life() {
  await sleep(3000);
  let i = 0;
  for (;;) {
    try {
      const act =
        i % 24 === 15
          ? theCrash
          : i % 24 === 4
            ? theUnsaying
            : i % 8 === 3
              ? acts[acts.length - 1]
              : pick(acts.slice(0, -1));
      await act();
    } catch (err) {
      console.log(`  an act stumbled: ${err}`);
    }
    i += 1;
    await sleep(4000 + Math.random() * 4000);
  }
}
void life();

async function shutdown() {
  console.log("\nthe village sleeps.");
  viewer.close();
  for (const s of Object.values(stores)) await s.close().catch(() => {});
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
