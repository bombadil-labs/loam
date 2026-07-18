// PLANNER — the second real Loam app, run end to end (ticket T23). Things go in my planner; a
// plan carries a guest list; my plans federate. Two sovereign stores — Priya hosts, Sam is
// invited — and the RSVP is Sam's OWN SIGNED CLAIM, made in Sam's own store and pulled back:
// nobody can answer for anyone else, and nobody wrote an authorization system.
//
// The finale is the promise Larder's README made: with BOTH bundles installed in Priya's store,
// "do we have enough beer for the BBQ?" is answered by reading the plan's guest list beside
// Larder's Pantry lens — two apps, one ground, ZERO integration code.

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authorForSeed, parseSchema, parseTerm, signClaims } from "@bombadil/rhizomatic";
import {
  Gateway,
  SqliteBackend,
  assembleGenesis,
  grantClaims,
  initHome,
  pullFrom,
  serve,
} from "../../dist/index.js";
import { readSeed } from "../../dist/cli/config.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOMES = join(ROOT, "homes");
const spec = (dir, f) => JSON.parse(readFileSync(join(ROOT, "..", dir, "bundle", f), "utf8"));

const PEN_SEED = "2b".repeat(32);
const PEN = authorForSeed(PEN_SEED);

const results = [];
const check = (id, label, ok, detail = "") => {
  results.push({ id, ok });
  console.log(`${ok ? "  ok " : "  FAIL"} ${id} ${label}${detail ? ` — ${detail}` : ""}`);
};

async function openMember(name, port) {
  const home = join(HOMES, name);
  initHome(home);
  const seed = readSeed(home);
  const gateway = await Gateway.open(new SqliteBackend(join(home, "store.sqlite")), {
    seed,
    pens: { "planner-pen": PEN_SEED, "larder-pen": PEN_SEED },
  });
  await gateway.append(assembleGenesis({ operatorSeed: seed }).deltas);
  const handle = await serve({
    mounts: { plans: gateway },
    tokens: { [`op-${name}`]: { operator: true } },
    port,
    host: "127.0.0.1",
  });
  return {
    name,
    gateway,
    seed,
    operator: authorForSeed(seed),
    base: `${handle.url}/plans`,
    close: async () => {
      await handle.close();
      await gateway.close();
    },
  };
}

async function installBundle(member, dir, files, publicLenses, renderers) {
  for (const f of files) {
    const s = spec(dir, f);
    await member.gateway.publishRegistration(
      { ...s.hyperschema, body: parseTerm(s.hyperschema.body) },
      parseSchema(s.schema),
      s.roots,
      undefined,
      undefined,
      s.mutations,
      s.writable,
      s.resolvers,
    );
  }
  for (const r of renderers) await member.gateway.publishRenderer(spec(dir, r));
  await member.gateway.declarePublic(publicLenses);
  await member.gateway.append([
    signClaims(grantClaims("loam:store", PEN, "write", member.operator, Date.now()), member.seed),
  ]);
}

const q = (g, src) => g.query(src);

let priya;
let sam;
try {
  rmSync(HOMES, { recursive: true, force: true });
  mkdirSync(HOMES, { recursive: true });
  priya = await openMember("priya", 4511);
  sam = await openMember("sam", 4512);

  // INSTALL — the Planner bundle on both stores.
  await installBundle(
    priya,
    "planner",
    ["plan.json", "planner-book.json"],
    ["Planner", "Plan"],
    ["renderer-agenda.json", "renderer-plan.json"],
  );
  await installBundle(
    sam,
    "planner",
    ["plan.json", "planner-book.json"],
    ["Planner", "Plan"],
    ["renderer-agenda.json", "renderer-plan.json"],
  );
  check(
    "plan.1",
    "the Planner bundle installs on two sovereign stores — schemas, resolver, renderers, pen",
    true,
  );

  // PRIYA PLANS the BBQ — title, time, place, and a guest list of entity refs.
  const when = Date.now() + 2 * 24 * 3600 * 1000;
  await q(
    priya.gateway,
    `mutation { linkPlanner(entity: "planner:mine", field: "plan", target: "plan:bbq") { plan } }`,
  );
  await q(priya.gateway, `mutation { planIt(plan: "plan:bbq", title: "Saturday BBQ") { delta } }`);
  await q(priya.gateway, `mutation { scheduleIt(plan: "plan:bbq", when: ${when}) { delta } }`);
  await q(
    priya.gateway,
    `mutation { whereAt(plan: "plan:bbq", where: "the back garden") { delta } }`,
  );
  await q(priya.gateway, `mutation { invite(plan: "plan:bbq", person: "person:sam") { delta } }`);
  await q(priya.gateway, `mutation { invite(plan: "plan:bbq", person: "person:ada") { delta } }`);
  const plan = await q(priya.gateway, `{ plan(entity: "plan:bbq") { title when guest } }`);
  check(
    "plan.2",
    "the plan holds its shape: title, time, and a guest list of entity refs",
    plan.data?.plan?.title === "Saturday BBQ" && (plan.data?.plan?.guest ?? []).length === 2,
    `guests: ${(plan.data?.plan?.guest ?? []).join(", ")}`,
  );

  // SAM IS INVITED — pulls Priya's plans into his own store; his planner now shows the BBQ.
  await pullFrom(sam.gateway, priya.base, "op-priya");
  const samsBook = await q(sam.gateway, `{ planner(entity: "planner:mine") { plan } }`);
  check(
    "plan.3",
    "Sam pulls and the plan is in HIS planner — federated, no shared server, no invite email",
    (samsBook.data?.planner?.plan ?? []).some((p) => p?.title === "Saturday BBQ"),
  );

  // SAM RSVPS FROM HIS OWN STORE — his claim, his signature. Priya pulls the answer back, and
  // the resolver renders WHO said yes from cryptographic authorship, not from anything typed.
  await q(sam.gateway, `mutation { rsvp(plan: "plan:bbq", answer: "yes") { delta } }`);
  await pullFrom(priya.gateway, sam.base, "op-sam");
  const rsvps = await q(priya.gateway, `{ plan(entity: "plan:bbq") { rsvp } }`);
  const rsvpList = rsvps.data?.plan?.rsvp ?? [];
  const samSig = sam.operator.slice(-8);
  check(
    "plan.4",
    "the RSVP is Sam's own signed claim — pulled back, attributed by the resolver from real authorship",
    rsvpList.some((r) => String(r).startsWith(samSig) && String(r).endsWith("yes")),
    `rsvps: ${JSON.stringify(rsvpList)}`,
  );

  // THE AGENDA SERVES ANONYMOUSLY — the planner UI from the store itself.
  const agenda = await priya.gateway.serveRoute("planner", "planner:mine", "public");
  check(
    "plan.5",
    "the agenda renders from the store, anonymously, soonest-first",
    agenda.status === 200 && /Saturday BBQ/.test(agenda.body),
    `render: ${agenda.status}`,
  );

  // A GUEST WITH JUST THE LINK can answer — the plan page's form is a pen-signed write.
  const tapped = await priya.gateway.writeRoute("plan", "plan:bbq", { rsvp: "yes" }, "public");
  check(
    "plan.6",
    "the plan page's RSVP button is a pen-signed write through the anonymous door",
    tapped.status === 200,
    `writeRoute: ${tapped.status}`,
  );

  // THE PROMISE KEPT — Larder's bundle joins Priya's store, beer goes in the pantry, and the
  // BBQ question is answered across two apps with ZERO integration code: one ground, two lenses.
  await installBundle(
    priya,
    "larder",
    ["item.json", "pantry.json", "grocery-list.json"],
    ["Groceries"],
    ["renderer-list.json"],
  );
  await q(priya.gateway, `mutation { stocked(item: "item:beer", qty: 6) { delta } }`);
  const guests =
    (await q(priya.gateway, `{ plan(entity: "plan:bbq") { guest } }`)).data?.plan?.guest ?? [];
  const beer =
    (await q(priya.gateway, `{ pantry(entity: "item:beer") { have } }`)).data?.pantry?.have ?? 0;
  const enough = beer >= guests.length * 2;
  check(
    "plan.7",
    "ZERO INTEGRATION CODE: the BBQ question reads the plan's guests beside Larder's Pantry — two apps, one ground",
    guests.length === 2 && beer === 6 && enough,
    `${guests.length} guests, ${beer} beers — ${enough ? "enough" : "make a run"}`,
  );
} finally {
  await priya?.close().catch(() => {});
  await sam?.close().catch(() => {});
}
const failed = results.filter((r) => !r.ok);
console.log(
  `\n=== PLANNER — the second real Loam app: ${results.length - failed.length}/${results.length} passed` +
    (failed.length ? ` — FAILED: ${failed.map((f) => f.id).join(", ")}` : " ==="),
);
process.exitCode = failed.length > 0 ? 1 : 0;
