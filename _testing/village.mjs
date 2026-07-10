// The Village, running: all four stores up, the pulse beating, small lives being lived, and a
// viewer at http://127.0.0.1:4400 that watches the almanac's dossiers change in real time.
//
// The browser talks ONLY to the viewer (same-origin SSE, no tokens in the page); the viewer
// subscribes to the almanac over its real authed HTTP surface and re-broadcasts. Every
// simulated write goes through the stores' real surfaces too — GraphQL mutations for
// properties, hand-signed deltas for relations — then federates in on the next pulse.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  AUTHORS,
  PEOPLE,
  SEEDS,
  appendAs,
  attendClaims,
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
for (const name of ["commons", "reel", "hive", "almanac"]) stores[name] = await openStore(name);
const { commons, reel, hive, almanac } = stores;
// The living village is self-sufficient: the whole cast holds standing from boot (fixed
// timestamps — content addressing makes re-runs free).
const { constitute } = await import("./harness.mjs");
await constitute(commons, ["wren", "miles", "odile", "petra"], 1_000_000);
await constitute(reel, ["miles"], 1_000_000);
await constitute(hive, ["odile"], 1_000_000);
console.log("the village is up: commons 4401, reel 4402, hive 4403, almanac 4404");

// ---- the broadcast ----------------------------------------------------------------------------
const clients = new Set();
const latest = new Map(); // person → last dossier frame, replayed to late-joining browsers
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
async function pulse() {
  for (;;) {
    try {
      const a = await pullFrom(reel.gateway, commons.base, opToken("commons"));
      const b = await pullFrom(almanac.gateway, commons.base, opToken("commons"));
      const c = await pullFrom(almanac.gateway, reel.base, opToken("reel"));
      const d = await pullFrom(almanac.gateway, hive.base, opToken("hive"));
      broadcast({ kind: "pulse", accepted: a.accepted + b.accepted + c.accepted + d.accepted });
      // the trust duel, sampled each beat — three lenses over one ground
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
      forgeryOut = false;
      tell(`🌿 Wren speaks again — new words outlive struck ones`, "patch");
      return;
    }
    if (forgeryOut === true) {
      // escalate: Mallory STRIKES Wren's latest surviving bio delta (erasure, not fabrication)
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
          `🦝 Mallory STRIKES Wren's words from the record — the plain dossier forgets; the guarded lens does not`,
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
        `🦝 Mallory federates a forged bio for Wren — pick-latest falls for it; byAuthorRank does not`,
        "forgery",
      );
    }
  },
];

async function life() {
  await sleep(3000);
  let i = 0;
  for (;;) {
    try {
      // mostly the small stuff; the forgery drama every 8th act
      const act = i % 8 === 7 ? acts[acts.length - 1] : pick(acts.slice(0, -1));
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
