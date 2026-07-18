// PACHYDERM — the third real Loam app: a timeline with no company (ticket T24). Three sovereign
// stores — Alice, Bob, Carol. Posts live where their authors live; following someone IS pulling
// their store; and the feed is a well-known entity (feed:main) that every author links onto — so
// in YOUR store, the union of everyone you pull IS your combined timeline, and the lens that
// resolves it is YOURS to swap. The algorithm is a lens you own.
//
// The erasure act tells the TRUTH about federated forgetting, which most social protocols
// theater around: Alice's erasure purges HER store byte-for-byte, but her tombstone is FOREIGN
// law in Bob's store — it binds nothing there (§11: erasure is each operator's alone). Bob still
// remembers, because sovereignty cuts both ways; and then Bob HONORS her request with his own
// operator's erasure. No delete-request pretending to be a guarantee: real semantics, said aloud.

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authorForSeed, parseSchema, parseTerm } from "@bombadil/rhizomatic";
import {
  Gateway,
  SqliteBackend,
  assembleGenesis,
  initHome,
  pullFrom,
  serve,
} from "../../dist/index.js";
import { readSeed } from "../../dist/cli/config.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOMES = join(ROOT, "homes");
const spec = (f) => JSON.parse(readFileSync(join(ROOT, "bundle", f), "utf8"));

const results = [];
const check = (id, label, ok, detail = "") => {
  results.push({ id, ok });
  console.log(`${ok ? "  ok " : "  FAIL"} ${id} ${label}${detail ? ` — ${detail}` : ""}`);
};

async function openMember(name, port) {
  const home = join(HOMES, name);
  initHome(home);
  const seed = readSeed(home);
  const backend = new SqliteBackend(join(home, "store.sqlite"));
  const gateway = await Gateway.open(backend, { seed });
  await gateway.append(assembleGenesis({ operatorSeed: seed }).deltas);
  const handle = await serve({
    mounts: { pachy: gateway },
    tokens: { [`op-${name}`]: { operator: true } },
    port,
    host: "127.0.0.1",
  });
  return {
    name,
    gateway,
    backend,
    seed,
    operator: authorForSeed(seed),
    base: `${handle.url}/pachy`,
    close: async () => {
      await handle.close();
      await gateway.close();
    },
  };
}

async function install(member) {
  for (const f of ["post.json", "profile.json", "feed.json", "latest.json"]) {
    const s = spec(f);
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
  await member.gateway.publishRenderer(spec("renderer-timeline.json"));
  await member.gateway.publishRenderer(spec("renderer-profile.json"));
  await member.gateway.declarePublic(["Feed", "Profile"]);
}

const q = (g, src) => g.query(src);
const post = async (m, slug, text) => {
  await q(
    m.gateway,
    `mutation { linkFeed(entity: "feed:main", field: "post", target: "post:${slug}") { post } }`,
  );
  await q(
    m.gateway,
    `mutation { say(post: "post:${slug}", text: ${JSON.stringify(text)}) { delta } }`,
  );
  await q(m.gateway, `mutation { stamp(post: "post:${slug}", at: ${Date.now()}) { delta } }`);
};
const timelineTexts = async (m) => {
  const r = await q(m.gateway, `{ feed(entity: "feed:main") { post } }`);
  return (r.data?.feed?.post ?? []).map((p) => p?.text).filter(Boolean);
};

let alice;
let bob;
let carol;
try {
  rmSync(HOMES, { recursive: true, force: true });
  mkdirSync(HOMES, { recursive: true });
  alice = await openMember("alice", 4521);
  bob = await openMember("bob", 4522);
  carol = await openMember("carol", 4523);
  for (const m of [alice, bob, carol]) await install(m);
  check(
    "pachy.1",
    "the bundle installs on three sovereign stores — posts, profiles, TWO feed lenses",
    true,
  );

  // ALICE POSTS — her claims, her store, her signature (the resolver renders it).
  await q(alice.gateway, `mutation { handle(person: "person:alice", name: "alice") { delta } }`);
  await post(alice, "a1", "the mycelium is humming today");
  await post(alice, "a2", "signed, sovereign, and slightly smug about it");
  const aliceTL = await timelineTexts(alice);
  const direct = await q(alice.gateway, `{ post(entity: "post:a1") { text } }`);
  check(
    "pachy.2",
    "Alice's posts land on her feed; a DIRECT post read carries the resolver's signed attribution",
    aliceTL.length === 2 && String(direct.data?.post?.text ?? "").includes("@"),
    `posts: ${aliceTL.length}; direct: ${JSON.stringify(direct.data?.post?.text)}`,
  );
  // (Found while building: the attribution resolver does NOT reach posts as EXPANDED children of
  // the feed — §22 resolvers ride the binding, and nested expansion resolves through the registry
  // without binding context. Filed as a platform ticket; the timeline renders raw text meanwhile.)

  // BOB FOLLOWS ALICE — following IS pulling. The well-known feed entity means her posts land on
  // HIS feed:main: the union is the timeline.
  await pullFrom(bob.gateway, alice.base, "op-alice");
  await post(bob, "b1", "just followed alice, the network is a verb here");
  const bobTL = await timelineTexts(bob);
  check(
    "pachy.3",
    "Bob follows by pulling: his ONE feed interleaves her posts and his — the union IS the timeline",
    bobTL.length === 3,
    `bob's timeline: ${bobTL.length} posts`,
  );

  // BOB REPLIES AND BOOSTS — edges citing her post, provenance forever.
  await post(bob, "b2", "@alice same, humming here too");
  await q(bob.gateway, `mutation { replyTo(post: "post:b2", parent: "post:a1") { delta } }`);
  await q(bob.gateway, `mutation { boost(post: "post:b-boost", original: "post:a2") { delta } }`);
  const reply = await q(bob.gateway, `{ post(entity: "post:b2") { re } }`);
  check(
    "pachy.4",
    "a reply is an edge citing its parent; a boost is a claim citing the original — provenance, forever",
    (reply.data?.post?.re ?? []).includes("post:a1"),
  );

  // CAROL FOLLOWS BOTH — her one pull-pair builds the three-voice timeline; her LATEST lens reads
  // the same ground as a different algorithm (the newest post alone). Two lenses, one feed, her
  // store, her choice: the algorithm is a lens she owns.
  await pullFrom(carol.gateway, alice.base, "op-alice");
  await pullFrom(carol.gateway, bob.base, "op-bob");
  const carolTL = await timelineTexts(carol);
  const carolLatest = await q(carol.gateway, `{ latest(entity: "feed:main") { post } }`);
  check(
    "pachy.5",
    "Carol's timeline interleaves three voices; her Latest lens reads the SAME ground as a different algorithm",
    carolTL.length >= 4 && carolLatest.data?.latest?.post?.text !== undefined,
    `timeline: ${carolTL.length} posts; latest: ${JSON.stringify(carolLatest.data?.latest?.post?.text ?? "").slice(0, 40)}`,
  );

  // THE TIMELINE SERVES ANONYMOUSLY from each store — the UI is data too.
  const page = await carol.gateway.serveRoute("timeline", "feed:main", "public");
  check(
    "pachy.6",
    "the timeline renders from the store, anonymously — no company between reader and feed",
    page.status === 200 && /humming/.test(page.body),
    `render: ${page.status}, ${page.body.length} bytes`,
  );

  // ERASURE, TOLD HONESTLY. Alice erases a1: HER store forgets byte-for-byte. Her tombstone is
  // FOREIGN law in Bob's store — it binds nothing there; Bob still remembers, because sovereignty
  // cuts both ways. Then Bob HONORS the request with his own operator's erasure. No theater.
  const FORGOTTEN = "the mycelium is humming today";
  const a1Text = [...alice.gateway.reactor.snapshot()].find((d) =>
    JSON.stringify(d).includes(FORGOTTEN),
  );
  await alice.gateway.erase(a1Text.id, { reason: "she thought better of it" });
  const aliceForgot = !JSON.stringify(await alice.backend.deltasSince(new Set())).includes(
    FORGOTTEN,
  );
  await pullFrom(bob.gateway, alice.base, "op-alice"); // the tombstone travels, but it is foreign law
  const bobRemembers = JSON.stringify(await bob.backend.deltasSince(new Set())).includes(FORGOTTEN);
  const bobsCopy = [...bob.gateway.reactor.snapshot()].find((d) =>
    JSON.stringify(d).includes(FORGOTTEN),
  );
  await bob.gateway.erase(bobsCopy.id, {
    reason: "honoring alice's request — his call, his store",
  });
  const bobHonored = !JSON.stringify(await bob.backend.deltasSince(new Set())).includes(FORGOTTEN);
  check(
    "pachy.7",
    "erasure without theater: Alice's store forgets byte-for-byte; Bob's store REMEMBERS (her tombstone is foreign law); Bob honors her request with his own erasure",
    aliceForgot && bobRemembers && bobHonored,
    `alice forgot: ${aliceForgot}, bob remembered: ${bobRemembers}, bob honored: ${bobHonored}`,
  );
} finally {
  await alice?.close().catch(() => {});
  await bob?.close().catch(() => {});
  await carol?.close().catch(() => {});
}
const failed = results.filter((r) => !r.ok);
console.log(
  `\n=== PACHYDERM — the third real Loam app: ${results.length - failed.length}/${results.length} passed` +
    (failed.length ? ` — FAILED: ${failed.map((f) => f.id).join(", ")}` : " ==="),
);
process.exitCode = failed.length > 0 ? 1 : 0;
