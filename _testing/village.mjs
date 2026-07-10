// The Village, running: all four stores up, the pulse beating, small lives being lived, and a
// viewer at http://127.0.0.1:4400 that watches the almanac's dossiers change in real time.
//
// The browser talks ONLY to the viewer (same-origin SSE, no tokens in the page); the viewer
// subscribes to the almanac over its real authed HTTP surface and re-broadcasts. Every
// simulated write goes through the stores' real surfaces too â€” GraphQL mutations for
// properties, hand-signed deltas for relations â€” then federates in on the next pulse.

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
  sseOpen,
  tok,
} from "./harness.mjs";

const VIEWER_PORT = 4400;
const stores = {};
for (const name of ["commons", "reel", "hive", "almanac", "cinelog"]) stores[name] = await openStore(name);
const { commons, reel, hive, cinelog } = stores;
// `let`, not destructured: the crash act closes the almanac, drops its sqlite, and rebinds a
// fresh one healed from the vault — every closure below reads this binding at call time.
let almanac = stores.almanac;
if (almanac.healed.toPrimary > 0) {
  console.log(`the seed vault replanted the almanac: ${almanac.healed.toPrimary} deltas restored`);
}
// The living village is self-sufficient: the whole cast holds standing from boot (fixed
// timestamps â€” content addressing makes re-runs free).
const { constitute } = await import("./harness.mjs");
await constitute(commons, ["wren", "miles", "odile", "petra"], 1_000_000);
await constitute(reel, ["miles"], 1_000_000);
await constitute(hive, ["odile"], 1_000_000);
await constitute(cinelog, ["sasha"], 1_000_000);
await constitute(almanac, ["wren", "miles", "odile", "petra", "miller"], 1_000_000);
console.log("the village is up: commons 4401, reel 4402, hive 4403, almanac 4404");

// THE MILL (phase 11): the almanac becomes the village's first ANIMATE store. The operator
// blesses the grind recipe, the dossier learns the presence field (schema evolution), and the
// MILLER attaches a Runner — from here, village life grinds into flour on every ingest.
const { attachMill, ensurePresence, plantMill } = await import("./mill.mjs");
await ensurePresence(almanac.base, opToken("almanac"));
await plantMill(almanac);
await attachMill(almanac);
console.log("the mill wheel turns: the almanac is animate (fn:grind, signed by the miller)");

// ---- the broadcast ----------------------------------------------------------------------------
const clients = new Set();
const latest = new Map(); // person â†’ last dossier frame, replayed to late-joining browsers
let lastTrust;
function broadcast(obj) {
  if (obj.kind === "dossier") latest.set(obj.person, obj);
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
const tell = (text, tone = "write") => {
  console.log(`  ${text}`);
  broadcast({ kind: "event", text, tone });
};

// ---- the viewer -------------------------------------------------------------------------------
const page = readFileSync(join(ROOT, "dashboard.html"));
const viewer = createServer((req, res) => {
  if (req.url === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(":welcome to the village\n\n");
    // catch the newcomer up: the latest known state of every dossier, then the live stream
    for (const frame of latest.values()) res.write(`data: ${JSON.stringify(frame)}\n\n`);
    if (lastTrust) res.write(`data: ${JSON.stringify(lastTrust)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
});
await new Promise((r) => viewer.listen(VIEWER_PORT, "127.0.0.1", r));
console.log(`the almanac is readable at http://127.0.0.1:${VIEWER_PORT}`);

// ---- watch the almanac's dossiers over its real SSE surface, forward every frame --------------
async function watchDossier(person) {
  for (;;) {
    try {
      const stream = await sseOpen(
        almanac.base,
        opToken("almanac"),
        `subscription { dossier(entity: "${person}") { name bio follows companioned attended _hex _changed } }`,
      );
      for (;;) {
        const frame = await stream.nextFrame(600_000);
        broadcast({ kind: "dossier", person, data: frame.dossier });
      }
    } catch {
      await sleep(2000); // the almanac may be mid-restart; resubscribe
    }
  }
}
for (const person of PEOPLE) void watchDossier(person);

// ---- the pulse --------------------------------------------------------------------------------
// The almanac publishes the cinelog translation ONCE (idempotent: fixed timestamp).
const { translate, translationClaims } = await import("../dist/index.js");
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

async function pulse() {
  for (;;) {
    try {
      const a = await pullFrom(reel.gateway, commons.base, opToken("commons"));
      const b = await pullFrom(almanac.gateway, commons.base, opToken("commons"));
      const c = await pullFrom(almanac.gateway, reel.base, opToken("reel"));
      const d = await pullFrom(almanac.gateway, hive.base, opToken("hive"));
      const e = await pullFrom(almanac.gateway, cinelog.base, opToken("cinelog"));
      // every pulse ends with a translation pass: the stranger's tongue becomes the village's
      const rendered = await translate(almanac.gateway, { seed: almanac.seed });
      if (rendered.emitted > 0) {
        tell(
          `🗣️ the almanac renders ${rendered.emitted} cinelog ${rendered.emitted === 1 ? "entry" : "entries"} into the village's tongue`,
          "patch",
        );
      }
      broadcast({
        kind: "pulse",
        accepted: a.accepted + b.accepted + c.accepted + d.accepted + e.accepted,
      });
      // the trust duel, sampled each beat â€” three lenses over one ground
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
      // the mill's flour, sampled each beat: presence per villager (the .value beside the
      // host's provenance pointers — the evidence hex stays server-side, off the wire)
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

// ---- village life -----------------------------------------------------------------------------
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
    tell(`ðŸŽ¬ Miles reconsiders ${TITLES[s]}: â˜…${rating}`);
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
      `ðŸŒ¿ ${who[0].toUpperCase() + who.slice(1)} tends ${who === "miles" ? "his" : "her"} bio on the commons`,
    );
  },
  async () => {
    // Sasha's app knows nothing of the village — it logs a watch in its own dialect, and the
    // pulse's translation pass renders it into Wren's (or a friend's) dossier.
    const films = ["film:stalker", "film:solaris", "film:mirror", "film:nostalghia"];
    const viewers = ["person:wren", "person:miles", "person:odile", "person:sasha"];
    const film = pick(films);
    const viewer = pick(viewers);
    await appendAs(cinelog.gateway, "sasha", [
      {
        timestamp: Date.now(),
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
    tell(`ðŸ Odile counts ${jars} jars from the west boxes`);
  },
  async () => {
    await gql(
      hive.base,
      tok("odile", "hive"),
      `mutation { colony(entity: "colony:1", grumbles: "the swarm eyes the church eaves again") { queen } }`,
    );
    tell(
      `ðŸ Odile grumbles into her journal (the lens keeps it home â€” the almanac will never know)`,
    );
  },
  async () => {
    if (followPool.length === 0) return;
    const [who, whom] = followPool.shift();
    await appendAs(commons.gateway, who, [followClaims(`person:${who}`, whom, Date.now())]);
    tell(`ðŸ¤ ${who[0].toUpperCase() + who.slice(1)} now follows ${whom.replace("person:", "")}`);
  },
  async () => {
    if (companionPool.length === 0) return;
    const [s, p] = companionPool.shift();
    await appendAs(reel.gateway, "miles", [companionClaims(s, p, Date.now())]);
    tell(`ðŸŽ¬ ${p.replace("person:", "")} joins the ${TITLES[s]} screening on the reel`);
  },
  async () => {
    if (attendPool.length === 0) return;
    const [g, p] = attendPool.shift();
    await appendAs(hive.gateway, "odile", [attendClaims(g, p, Date.now())]);
    tell(`ðŸ ${p.replace("person:", "")} turns up for ${g.replace("gathering:", "")}`);
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
      tell(`ðŸŒ¿ Wren speaks again â€” new words outlive struck ones`, "patch");
      return;
    }
    if (forgeryOut === "healing") {
      // TRUST IS DATA (step 13): the almanac's operator declares a roster â€” the villagers, no
      // one else. One delta; the very next federate obeys it.
      const { trustClaims } = await import("../dist/index.js");
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
          timestamp: Date.now() + 8_000_000,
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
        `ðŸšª The almanac declares its roster â€” one delta, and Mallory's next forgery bounces at the door (accepted: ${report.accepted})`,
        "patch",
      );
      return;
    }
    if (forgeryOut === "rostered") {
      const { trustClaims } = await import("../dist/index.js");
      await almanac.gateway.append([
        signClaims(trustClaims("open", [], almanac.operator, Date.now()), almanac.seed),
      ]);
      forgeryOut = false;
      tell(`ðŸšª The almanac opens its door again â€” an aggregator by choice, not by default`, "write");
      return;
    }
    if (forgeryOut === true) {
      // escalate: Mallory negates Wren's latest surviving bio delta (suppression, not fabrication)
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
          `ðŸ¦ Mallory negates Wren's words in the record â€” the plain dossier forgets; the guarded lens does not`,
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
      tell(`ðŸŒ¿ Wren reclaims her own story â€” the newest honest word wins again`, "patch");
    } else {
      const forgery = signClaims(
        {
          timestamp: Date.now() + 8_000_000,
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
        `ðŸ¦ Mallory federates a forged bio for Wren â€” pick-latest falls for it; byAuthorRank does not`,
        "forgery",
      );
    }
  },
];

// ---- the unsaying -----------------------------------------------------------------------------
// ERASURE (SPEC §11): Wren speaks in haste, regrets it, and UNSAYS it — the bytes are cleared from every
// tier (the vault forgets too), the signed hole remains, and the door refuses its return. The
// erase re-seats the almanac's reactor, so the mill wheel is rehung after (like the crash).
async function theUnsaying() {
  const regret = signClaims(
    {
      timestamp: Date.now(),
      author: AUTHORS.wren,
      pointers: [
        { role: 'subject', target: { kind: 'entity', entity: { id: 'person:wren', context: 'bio' } } },
        { role: 'value', target: { kind: 'primitive', value: 'keeper of the commons; and frankly, the hive smells' } },
      ],
    },
    SEEDS.wren,
  );
  await almanac.gateway.append([regret]);
  tell('🌿 Wren speaks in haste about the hive…', 'write');
  await sleep(4000);
  const report = await almanac.gateway.erase(regret.id, { actorSeed: SEEDS.wren, reason: 'unsaid by request' });
  const { attachMill } = await import('./mill.mjs');
  await attachMill(stores.almanac);
  tell(
    `🕳️ …and UNSAYS it — the bytes are cleared from every tier, the signed hole remains (${report.citations.length} citations), and the door will refuse its return`,
    "patch",
  );
}

// ---- the crash ---------------------------------------------------------------------------------
// COLD STORAGE (PR #22): the almanac keeps a seed vault — every append lands hot and cold in
// one motion. Every so often the sqlite is lost mid-story, and the reopen heals
// from the vault BEFORE the gateway reads. The dashboard barely blinks: the dossier watchers
// resubscribe, the pulse resumes, and every word is where it was.
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
  // a Runner is process machinery, not ground: the flour survived in the vault, but the
  // wheel must be rehung on the reborn gateway
  const { attachMill } = await import("./mill.mjs");
  await attachMill(stores.almanac);
  tell(`🌾 the mill wheel is rehung — the reborn almanac grinds on`, "patch");
}

async function life() {
  await sleep(3000);
  let i = 0;
  for (;;) {
    try {
      // mostly the small stuff; the imposter drama every 8th act; the crash every 24th
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

// ---- a tidy end -------------------------------------------------------------------------------
async function shutdown() {
  console.log("\nthe village sleeps.");
  viewer.close();
  for (const s of Object.values(stores)) await s.close().catch(() => {});
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
