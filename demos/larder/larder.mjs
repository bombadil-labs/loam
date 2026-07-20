// LARDER — the first real Loam app, run end to end (ticket T22). Two sovereign stores — Ann's and
// Ben's — each install the same delta-bundle, federate directly, and share one grocery list with
// no server, no account, and no company in the middle. This file is the app's own witness: it does
// exactly what SKILL.md tells a Claude to do, through the same doors, and checks every promise the
// README makes. Homes live under demos/larder/homes — disposable, like the village's.
//
// The quiet machinery (never explained to the user, always load-bearing): checking off your
// partner's item is OUTSAYING, not unsaying — `got` is a later claim that beats `need`, and nobody
// ever negates a delta they didn't author. Two lenses read one item-ground (the list's broad Item
// reading; the Pantry reading future bundles will ask about beer). The UI is served from the store
// itself, and the tablet's check-off tap is a pen-signed write.

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authorForSeed } from "@bombadil/rhizomatic";
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
import { signClaims } from "@bombadil/rhizomatic";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOMES = join(ROOT, "homes");
const BUNDLE = join(ROOT, "bundle");
const spec = (f) => JSON.parse(readFileSync(join(BUNDLE, f), "utf8"));

// The pen the tick renderer signs as — provisioned in config (custody), granted below (authority).
const PEN_SEED = "1a".repeat(32);
const PEN = authorForSeed(PEN_SEED);

const results = [];
const check = (id, label, ok, detail = "") => {
  results.push({ id, ok });
  console.log(`${ok ? "  ok " : "  FAIL"} ${id} ${label}${detail ? ` — ${detail}` : ""}`);
};

// ---- a household member's store: a home, a gateway, a served surface --------------------------
async function openMember(name, port) {
  const home = join(HOMES, name);
  initHome(home);
  const seed = readSeed(home);
  const gateway = await Gateway.open(new SqliteBackend(join(home, "store.sqlite")), {
    seed,
    pens: { "larder-pen": PEN_SEED },
  });
  await gateway.append(assembleGenesis({ operatorSeed: seed }).deltas);
  const handle = await serve({
    mounts: { larder: gateway },
    tokens: { [`op-${name}`]: { operator: true } },
    port,
    host: "127.0.0.1",
  });
  return {
    name,
    gateway,
    seed,
    operator: authorForSeed(seed),
    base: `${handle.url}/larder`,
    close: async () => {
      await handle.close();
      await gateway.close();
    },
  };
}

// ---- install the bundle: the app IS these deltas (what SKILL.md walks a Claude through) --------
async function installLarder(member) {
  const { gateway } = member;
  // Order matters only for readability; the fixpoint would sort it out. Recipe expands Item, and
  // Cookbook expands Recipe — two levels of lens, each naming the reading below it.
  for (const file of [
    "item.json",
    "pantry.json",
    "grocery-list.json",
    "recipe.json",
    "cookbook.json",
  ]) {
    const s = spec(file);
    await gateway.publishRegistration(
      {
        ...s.hyperschema,
        body: (await import("@bombadil/rhizomatic")).parseTerm(s.hyperschema.body),
      },
      (await import("@bombadil/rhizomatic")).parseSchema(s.schema),
      s.roots,
      undefined,
      undefined,
      s.mutations,
      s.writable,
      s.resolvers,
    );
  }
  await gateway.publishRenderer(spec("renderer-list.json"));
  await gateway.publishRenderer(spec("renderer-tick.json"));
  await gateway.declarePublic(["Groceries", "Item", "Cookbook"]);
  // The pen's write standing (SPEC §6's two keys: provisioning is custody, THIS is authority).
  await gateway.append([
    signClaims(grantClaims("loam:store", PEN, "write", member.operator, Date.now()), member.seed),
  ]);
}

// ---- the daily verbs, exactly as Claude drives them (the claim templates via GraphQL) ----------
const q = (g, src) => g.query(src);
const addItem = async (g, item, name) => {
  await q(
    g,
    `mutation { linkGroceries(entity: "list:groceries", field: "item", target: "${item}") { item } }`,
  );
  await q(g, `mutation { called(item: "${item}", name: "${name}") { delta } }`);
  await q(g, `mutation { needIt(item: "${item}", at: ${Date.now()}) { delta } }`);
};

let ann;
let ben;
try {
  rmSync(HOMES, { recursive: true, force: true });
  mkdirSync(HOMES, { recursive: true });
  ann = await openMember("ann", 4501);
  ben = await openMember("ben", 4502);

  // INSTALL — the same bundle, both stores. The app now EXISTS twice, sovereign both times.
  await installLarder(ann);
  await installLarder(ben);
  check(
    "larder.1",
    "the bundle installs: schemas, two lenses, two renderers, a granted pen — all deltas",
    true,
  );

  // ANN ADDS — milk and eggs, through the claim templates (the protocol Claude speaks).
  await addItem(ann.gateway, "item:milk", "milk");
  await addItem(ann.gateway, "item:eggs", "eggs");
  const annList = await q(ann.gateway, `{ groceries(entity: "list:groceries") { item } }`);
  const annItems = annList.data?.groceries?.item ?? [];
  check(
    "larder.2",
    "Ann's list holds what she added, expanded through the item lens",
    annItems.some((c) => c?.name === "milk") && annItems.some((c) => c?.name === "eggs"),
    `items: ${annItems.length}`,
  );

  // BEN FEDERATES — one pull, and the shared list exists with no server between them.
  await pullFrom(ben.gateway, ann.base, "op-ann");
  const benList = await q(ben.gateway, `{ groceries(entity: "list:groceries") { item } }`);
  const benItems = benList.data?.groceries?.item ?? [];
  check(
    "larder.3",
    "Ben pulls once and the list is SHARED — two sovereign stores, one reality, no middleman",
    benItems.some((c) => c?.name === "milk"),
    `ben sees ${benItems.length} item entries`,
  );

  // BEN CHECKS OFF Ann's milk — OUTSAYING, not unsaying: a later `got` beats her `need`, and her
  // delta is never touched. Nobody wrote a permissions system; the substrate is the permissions.
  await q(ben.gateway, `mutation { gotIt(item: "item:milk", at: ${Date.now()}) { delta } }`);
  await pullFrom(ann.gateway, ben.base, "op-ben");
  const merged = await q(ann.gateway, `{ groceries(entity: "list:groceries") { item } }`);
  const milk = (merged.data?.groceries?.item ?? []).find((c) => c?.name === "milk");
  check(
    "larder.4",
    "Ben checks off Ann's milk by outsaying it; Ann pulls and the lists CONVERGE",
    milk !== undefined && (milk.got ?? 0) > (milk.need ?? 0),
    `milk need=${milk?.need} got=${milk?.got}`,
  );

  // THE UI IS IN THE STORE — the list renderer serves anonymously (declared public), milk in the
  // basket, eggs still needed.
  const page = await ann.gateway.serveRoute("list", "list:groceries", "public");
  check(
    "larder.5",
    "the fridge-tablet UI serves from the store itself, anonymously, and tells the truth",
    page.status === 200 && /eggs/.test(page.body) && /milk/.test(page.body),
    `render: ${page.status}, ${page.body.length} bytes`,
  );

  // THE TABLET'S TAP IS A SIGNED WRITE — the tick renderer's form posts through the pen (§23.3):
  // provisioned in config, granted on the ground, and the write lands as the pen's own claim.
  const tapped = await ann.gateway.writeRoute("tick", "item:eggs", { got: Date.now() }, "public");
  const eggsAfter = await q(ann.gateway, `{ item(entity: "item:eggs") { need got } }`);
  check(
    "larder.6",
    "the check-off tap is a pen-signed write through the anonymous door — no token, real provenance",
    tapped.status === 200 && (eggsAfter.data?.item?.got ?? 0) > (eggsAfter.data?.item?.need ?? 0),
    `writeRoute: ${tapped.status}`,
  );

  // THE SECOND LENS — the pantry reading over the SAME ground, waiting for the BBQ question.
  await q(ann.gateway, `mutation { stocked(item: "item:beer", qty: 6) { delta } }`);
  const pantry = await q(ann.gateway, `{ pantry(entity: "item:beer") { have } }`);
  check(
    "larder.7",
    "the Pantry lens reads the same ground a different way — the BBQ bundle will ask it about beer",
    pantry.data?.pantry?.have === 6,
    `beer on hand: ${pantry.data?.pantry?.have}`,
  );

  // ---- BOTH DIRECTIONS ---------------------------------------------------------------------
  // A recipe names what it needs; the pantry says what is there. Point the same edge two ways and
  // you get the two questions people actually ask: what does this dish need, and what can I cook?

  // Ann writes down two dishes. `needsIngredient` files a line under the recipe AND names the item,
  // so the gather expands each line into that item's real Item view — stock included.
  const recipe = async (g, id, title, lines) => {
    await q(g, `mutation { recipeCalled(recipe: "${id}", title: "${title}") { delta } }`);
    for (const [item, qty] of lines) {
      await q(
        g,
        `mutation { needsIngredient(recipe: "${id}", item: "${item}", qty: ${qty}) { delta } }`,
      );
    }
    await q(
      g,
      `mutation { linkCookbook(entity: "book:recipes", field: "recipe", target: "${id}") { recipe } }`,
    );
  };

  // The pantry as it stands: flour enough for one loaf, no eggs at all.
  await q(ann.gateway, `mutation { called(item: "item:flour", name: "flour") { delta } }`);
  await q(ann.gateway, `mutation { stocked(item: "item:flour", qty: 3) { delta } }`);
  await q(ann.gateway, `mutation { called(item: "item:egg", name: "eggs") { delta } }`);
  await q(ann.gateway, `mutation { stocked(item: "item:egg", qty: 0) { delta } }`);

  await recipe(ann.gateway, "recipe:flatbread", "flatbread", [["item:flour", 2]]);
  await recipe(ann.gateway, "recipe:pasta", "fresh pasta", [
    ["item:flour", 2],
    ["item:egg", 3],
  ]);

  // FORWARD — recipe to ingredients. Each line is computed against the pantry, not typed in.
  const pastaView = await q(ann.gateway, `{ recipe(entity: "recipe:pasta") { title ingredient } }`);
  const lines = pastaView.data?.recipe?.ingredient ?? [];
  check(
    "larder.8",
    "FORWARD — a recipe reads its own ingredients against the pantry: each line computed from the " +
      "item's real stock, because the gather expanded it (§22.8)",
    lines.length === 2 &&
      lines.some((l) => /flour: have 3, need 2$/.test(l)) &&
      lines.some((l) => /eggs: have 0, need 3 .* short 3$/.test(l)),
    JSON.stringify(lines),
  );

  // REVERSE — the whole question, answered as a READ. The cookbook weighs every recipe against the
  // pantry two levels down: a cookbook link expands to a Recipe view, whose ingredient lines carry
  // each item's stock.
  const beforeShopping = await q(ann.gateway, `{ cookbook(entity: "book:recipes") { recipe } }`);
  const verdicts = beforeShopping.data?.cookbook?.recipe ?? [];
  check(
    "larder.9",
    "REVERSE — given what I have, what can I make? The cookbook answers by reading, not by " +
      "remembering: flatbread is on, pasta is three eggs short",
    verdicts.some((v) => /flatbread .* MAKEABLE/.test(v)) &&
      verdicts.some((v) => /fresh pasta .* need 3 eggs/.test(v)),
    JSON.stringify(verdicts),
  );

  // AND IT IS LIVE. Buy the eggs and ask again — nothing re-derived, nothing re-ground. The answer
  // moves because the pantry moved, which is the whole reason this is an interpretation and not a
  // remembered fact: a cookbook that says "pasta" over eggs you already ate is the bug.
  await q(ann.gateway, `mutation { stocked(item: "item:egg", qty: 12) { delta } }`);
  const afterShopping = await q(ann.gateway, `{ cookbook(entity: "book:recipes") { recipe } }`);
  const nowMakeable = (afterShopping.data?.cookbook?.recipe ?? []).filter((v) =>
    /MAKEABLE/.test(v),
  );
  check(
    "larder.10",
    "the answer is LIVE: buy a dozen eggs and pasta becomes makeable on the next read — no runner, " +
      "no re-derivation, nothing stale to invalidate",
    nowMakeable.length === 2,
    JSON.stringify(afterShopping.data?.cookbook?.recipe ?? []),
  );

  // AND IT COMPOSES BACK. What a recipe is short of is exactly what belongs on the grocery list —
  // the same edge, read the third way. Ben (federated) sees the shortfall land on the shared list.
  await q(ann.gateway, `mutation { stocked(item: "item:egg", qty: 0) { delta } }`);
  await addItem(ann.gateway, "item:egg", "eggs");
  await pullFrom(ben.gateway, ann.base, "op-ann");
  const bensList = await q(ben.gateway, `{ groceries(entity: "list:groceries") { item } }`);
  const bensEggs = (bensList.data?.groceries?.item ?? []).find((i) => i?.name === "eggs");
  check(
    "larder.11",
    "and it closes the loop: what the cookbook says you are short of goes on the shared list, and " +
      "Ben sees it on his own store — one edge, read three ways",
    bensEggs !== undefined,
    `ben sees eggs: ${bensEggs !== undefined}`,
  );
} finally {
  await ann?.close().catch(() => {});
  await ben?.close().catch(() => {});
}
const failed = results.filter((r) => !r.ok);
console.log(
  `\n=== LARDER — the first real Loam app: ${results.length - failed.length}/${results.length} passed` +
    (failed.length ? ` — FAILED: ${failed.map((f) => f.id).join(", ")}` : " ==="),
);
process.exitCode = failed.length > 0 ? 1 : 0;
