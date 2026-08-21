// T209 §24.6 × §46 — INSTALL BY FEDERATION: an arriving renderer is inert until blessed.
//
// A renderer is a delta and a channel carries deltas, so a peer's app already lands in the receiver's
// pool as bytes. What it may not do is RUN. Blessing a name (§46.3's `blessing` toggle) and mounting
// code that executes are different grants, and the second one is strictly wider — so auto-bless must
// never mean auto-execute. The explicit act is `bless-app`, one route at a time.
//
// THE RAILS ASK AT BOTH LEVELS, because either alone is blind here:
//   - BYTES: the peer's renderer delta is in the POOL's store and in no tier of the receiver's own.
//   - DOOR: what a person receives from `serveRoute` — 404 before the blessing, a framed page after.
// A rail that only proved the 404 would pass with renderers deleted from the product entirely, so
// every inertness rail here carries the blessed half beside it: the refusal is the blessing's
// absence, never the app's.
//
// WHAT THESE RAILS DELIBERATELY DO NOT ASSERT. (1) That the probation frame is UNFORGEABLE — it is
// chrome inside the same document as untrusted markup (§24.7 states the limit, and
// test/gateway/probation-frame.test.ts owns the frame's own contract). (2) That a COLD process serves
// a blessed app: the served bundle is loaded by `prepareRoute`, which the HTTP door calls before
// every render, and these rails run in one process where the publish already warmed the ESM cache.
// The rail that would close it drives the door after a reboot and belongs in test/server.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorForSeed, contentAddress } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { exportOffer } from "../../src/federation/offer.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { freezeMembers } from "../../src/gateway/container-identity.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const ALICE_SEED = "a1".repeat(32);
const BOB_SEED = "b0".repeat(32);
const CAROL_SEED = "c7".repeat(32);
const PEN_SEED = "5a".repeat(32);
const PEN = authorForSeed(PEN_SEED);
const BOB = authorForSeed(BOB_SEED);

// A peer's app: it paints what the lens resolves and offers the form that writes it back.
const APP =
  'export default (n) => `<main><p id=h>${n.view.height ?? ""}</p>' +
  "<form method=post><input name=height></form></main>`;";
// A DIFFERENT app, so a hash rail cannot pass by reporting one constant.
const OTHER_APP = 'export default (n) => `<section id=other>${n.view.height ?? ""}</section>`;';

const CHANNEL = "channel:friends:alice";

const store = async (seed: string, opts?: { pens: Record<string, string> }): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: seed,
      registrations: [],
      ...(seed === BOB_SEED
        ? { grants: [grantClaims(STORE_ENTITY, PEN, "write", BOB, 9_001)] }
        : {}),
    }),
    opts,
  );

/** A peer who registered a lens, holds one observation, and publishes an app over it. */
async function peer(
  seed: string,
  opts: { route: string; app: string; height: number; writes?: boolean },
): Promise<Gateway> {
  const gw = await store(seed);
  await gw.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, undefined, undefined, [
    "height",
  ]);
  await gw.append([observed(FERN, "height", opts.height, 1_000, seed)]);
  await gw.publishRenderer({
    route: opts.route,
    schema: "Plant",
    consumes: ["height"],
    bundle: opts.app,
    ...(opts.writes === true ? { writable: ["height"], pen: "alice-pen" } : {}),
  });
  return gw;
}

const link = (bob: Gateway, from: Gateway, prefix: string, bless = true) =>
  bob.openChannel({
    into: "friends",
    prefix,
    bless,
    source: { pull: () => Promise.resolve(from.reactor.arrivalLog()) },
  });

/** The id of a renderer binding delta, found by the route it claims — never by our own reader. */
const bindingOf = (gw: Gateway, route: string): string =>
  [...gw.reactor.snapshot()].find((d) =>
    d.claims.pointers.some(
      (p) => p.role === "route" && p.target.kind === "primitive" && p.target.value === route,
    ),
  )!.id;

const bodyOf = (r: { body: string }): string => r.body;

// The expected hash, computed the substrate's way rather than read back from the reader under test
// (H10). What it pins is that the report names THIS bundle: the sibling rails change the bundle and
// watch the number move.
const hashOf = (bundle: string): string => contentAddress(new TextEncoder().encode(bundle));

describe("T209 — an arriving renderer is present at the bytes and 404 at the door", () => {
  it("lands in the pool, serves nowhere, and serves everywhere once blessed", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      const pool = channel.pool.gateway!;
      const arrived = bindingOf(alice, "hello");

      // BYTES, both sides: the peer's renderer binding is really in the pool's store, and no tier of
      // the receiver's own store holds it. Inertness is not absence.
      expect(await pool.backend.holds(arrived)).toBe(true);
      expect(await bob.backend.holds(arrived)).toBe(false);

      // DOOR, both doors: the receiver's prefixed name answers nothing, and neither does the pool's
      // own bare route. Foreign law mounts nothing (§8/§12/§15).
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      expect((await pool.serveRoute("hello", FERN, "full")).status).toBe(404);

      // AND THE OTHER HALF, which is what stops this rail passing with the feature deleted: the one
      // explicit act mounts it, at the name the RECEIVER assigned.
      await bob.blessChannelApp(CHANNEL, "hello");
      const served = await bob.serveRoute("alice:hello", FERN, "full");
      expect(served.status).toBe(200);
      expect(bodyOf(served)).toContain("<p id=h>62</p>");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("the receiver's own route of the same name keeps it — a prefix never shadows your law", async () => {
    // The prefix is the receiver's namespace, so `alice:hello` is theirs to assign. If they already
    // answer that literal route themselves, their own law wins it: delegation is the fallback, never
    // an override.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.append([observed(FERN, "height", 7, 2_000, BOB_SEED)]);
      await bob.publishRenderer({
        route: "alice:hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");

      const served = await bob.serveRoute("alice:hello", FERN, "full");
      expect(served.status).toBe(200);
      expect(bodyOf(served)).toContain("<section id=other>7</section>"); // bob's own app, bob's own ground
      expect(bodyOf(served)).not.toContain("<p id=h>");
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});

describe("T209 — the report and the listing name what arrived", () => {
  it("the sync report carries the route and the bundle's content hash, arrived-inert", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      const report = await channel.sync();

      expect(report.apps).toHaveLength(1);
      expect(report.apps[0]).toEqual({
        channel: CHANNEL,
        route: "hello",
        serves: "alice:hello",
        hash: hashOf(APP),
        blessed: false,
      });

      // The standing listing says the same thing, so a person who missed the sync can still find it.
      expect(bob.channelApps()).toEqual(report.apps);
      expect(bob.channelApps(CHANNEL)).toEqual(report.apps);

      // And it turns true only when THIS code is what serves.
      await bob.blessChannelApp(CHANNEL, "hello");
      expect(bob.channelApps()[0]!.blessed).toBe(true);
      expect((await channel.sync()).apps[0]!.blessed).toBe(true);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a peer with no app reports none, and a peer's bump reads inert again", async () => {
    // TWO-SIDED against a reader that always finds something: a channel carrying only law reports an
    // empty list, and the hash is the BUNDLE's, so re-pointing the route to different code moves it.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const plain = await store(CAROL_SEED);
    await plain.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    const bob = await store(BOB_SEED);
    try {
      const quiet = await link(bob, plain, "carol");
      expect((await quiet.sync()).apps).toEqual([]);

      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect(bob.channelApps(CHANNEL)[0]!.blessed).toBe(true);

      // Alice ships new code at the same route. The blessed binding still serves the OLD bundle, so
      // reporting `blessed` here would tell an operator their peer's new app is live when it is not.
      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      const after = await channel.sync();
      expect(after.apps).toHaveLength(1);
      expect(after.apps[0]!.hash).toBe(hashOf(OTHER_APP));
      expect(after.apps[0]!.blessed).toBe(false);
      // The old code is still what runs, which is exactly why the flag reads false.
      expect(bodyOf(await bob.serveRoute("alice:hello", FERN, "full"))).toContain("<p id=h>62</p>");
    } finally {
      await alice.close();
      await plain.close();
      await bob.close();
    }
  });
});

describe("T209 — bless-app mounts behind the probation frame, writes sequestered to the pool", () => {
  it("the served page carries the frame and reads the pool's ground", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");

      const html = bodyOf(await bob.serveRoute("alice:hello", FERN, "full"));
      expect(html).toContain("data-loam-probation");
      expect(html).toContain("On probation");
      expect(html).toContain(CHANNEL); // the frame names the pool a person would drop
      // It ran on the POOL's ground: 62 is alice's observation, and bob's own store holds none.
      expect(html).toContain("<p id=h>62</p>");

      // DELTA LEVEL: the blessing lives in the pool, and the receiver's own store gained no renderer.
      expect(bob.renderers().some((r) => r.route.includes("hello"))).toBe(false);
      expect(channel.pool.gateway!.renderers().some((r) => r.route === "hello")).toBe(true);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a form write lands in the pool's store and in no tier of the receiver's", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62, writes: true });
    // The pen is the SECOND key (§6): the receiver provisions the seed and grants it write standing.
    const bob = await store(BOB_SEED, { pens: { "alice-pen": PEN_SEED } });
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello", { pen: true });
      const pool = channel.pool.gateway!;
      const before = new Set((await bob.backend.deltasSince(new Set())).map((d) => d.id));

      const wrote = await bob.writeRoute("alice:hello", FERN, { height: 71 }, "full");
      expect(wrote.status).toBe(200);
      expect(bodyOf(wrote)).toContain("<p id=h>71</p>");
      expect(bodyOf(wrote)).toContain("On probation");

      // DELTA LEVEL, positive: the pool holds one pen-authored delta carrying what was written.
      const inPool = [...pool.reactor.snapshot()].filter((d) => d.claims.author === PEN);
      expect(inPool).toHaveLength(1);
      expect(JSON.stringify(inPool[0]!.claims)).toContain("71");

      // DELTA LEVEL, negative — the failure that matters. The receiver's byte set is unchanged and
      // its reactor holds nothing the pen authored.
      expect([...bob.reactor.snapshot()].some((d) => d.claims.author === PEN)).toBe(false);
      expect(await bob.backend.holds(inPool[0]!.id)).toBe(false);
      expect([...new Set((await bob.backend.deltasSince(new Set())).map((d) => d.id))]).toEqual([
        ...before,
      ]);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a pen-holding app never rides the blessing implicitly", async () => {
    // §6's two keys at the blessing door: blessing code that can WRITE takes its own deliberate
    // flag, and the refusal says so. Two-sided — the flag is what makes it mount.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62, writes: true });
    const bob = await store(BOB_SEED, { pens: { "alice-pen": PEN_SEED } });
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await expect(bob.blessChannelApp(CHANNEL, "hello")).rejects.toThrow(/holds a PEN/);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);

      await bob.blessChannelApp(CHANNEL, "hello", { pen: true });
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});

describe("T209 — the blessing toggle does not extend to renderers", () => {
  it("blessing true binds the peer's lens and still mounts no app", async () => {
    // The toggle is ON and demonstrably EFFECTIVE — the lens binds on the same sync. The app is seen,
    // named, and left inert. Auto-bless never auto-executes.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      const report = await channel.sync();

      expect(report.bound).toContain("alice:Plant");
      expect(report.apps.map((a) => a.blessed)).toEqual([false]);

      // Not merely unreported: nothing binds it in the pool either, and no door answers.
      expect(channel.pool.gateway!.renderers().some((r) => r.route === "hello")).toBe(false);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);

      // A standing sync must not drift into it either: poll again, still inert.
      await channel.sync();
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      // And the receiver CAN read the peer's data through the blessed lens the whole time, so this
      // rail cannot pass with the channel simply doing nothing.
      const answer = await bob.query('{ alice_Plant(entity: "' + FERN + '") { height } }');
      expect((answer.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(62);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("an app whose lens is not blessed refuses, and mounts nothing", async () => {
    // Ordering: a renderer is not law that stands alone. With blessing off the peer's lens binds
    // nowhere, so the app has no reading to render and the adoption door says which act comes first.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice", false);
      await channel.sync();
      await expect(bob.blessChannelApp(CHANNEL, "hello")).rejects.toThrow(
        /bless the schema it reads first/,
      );
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      expect(channel.pool.gateway!.renderers().some((r) => r.route === "hello")).toBe(false);

      // Two-sided: turn blessing on, sync, and the same call now mounts it.
      await bob.setChannel(CHANNEL, { blessing: true });
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("names what it cannot find rather than failing silently", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await expect(bob.blessChannelApp(CHANNEL, "nope")).rejects.toThrow(/"hello"/);
      await expect(bob.blessChannelApp("channel:friends:zoe", "hello")).rejects.toThrow(
        /channel:friends:zoe/,
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});

describe("T209 — an alias a peer chose cannot turn one blessing into another", () => {
  it("the row that mounts code refuses to be blessed as a name, and the reverse still works", async () => {
    // A manifest alias is a LOOKUP KEY, and a peer's own law can collide with one. The name-binding
    // pass (`bindArrived`) looks its rows up by lens name, so an alias collision is the one path by
    // which the toggle that binds NAMES could publish a renderer — auto-bless becoming auto-execute
    // through a back door. Each caller states the kind it means, and a mismatch refuses.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      const pool = channel.pool.gateway!;
      const version = freezeMembers([...pool.reactor.snapshot()]);

      await expect(pool.adoptLaw(version, "app:hello", { expect: "schema" })).rejects.toThrow(
        /different grants/,
      );
      // Two-sided: the same alias, asked for as what it is, still answers.
      const outcome = await pool.adoptLaw(version, "app:hello", { expect: "renderer" });
      expect(outcome.kind).toBe("witnessed");
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});

describe("T209 — the CLI names what arrived and mounts one app", () => {
  it("list says INERT with the recipe, bless-app mounts it, list says it serves", async () => {
    // Driven through the shipped CLI on a sqlite home, in FRESH invocations — the state where the
    // channel cannot resume (a file offer carries no token) and only its pool is re-attached. An app
    // must stay blessable and stay served there: whether this store can currently reach the peer has
    // nothing to do with whether the operator's own blessing stands.
    const root = mkdtempSync(join(tmpdir(), "loam-t209-cli-"));
    const out: string[] = [];
    const err: string[] = [];
    const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });
    const said = (): string => [...out, ...err].join("\n");
    const fresh = (): void => {
      out.length = 0;
      err.length = 0;
    };
    const me = join(root, "me");
    const offer = join(root, "alice.offer");
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    try {
      writeFileSync(offer, exportOffer(alice));
      expect(await run(["init", "--home", me], io())).toBe(0);
      fresh();
      expect(
        await run(
          [
            "federate",
            "open",
            "--from",
            offer,
            "--into",
            "friends",
            "--prefix",
            "alice",
            "--home",
            me,
          ],
          io(),
        ),
        said(),
      ).toBe(0);

      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain('app "hello" ARRIVED, INERT');
      expect(said()).toContain("federate bless-app --channel channel:friends:alice --route hello");

      fresh();
      expect(
        await run(
          ["federate", "bless-app", "--channel", CHANNEL, "--route", "nope", "--home", me],
          io(),
        ),
      ).toBe(2);
      expect(said()).toContain('"hello"'); // it names what it does have

      fresh();
      expect(
        await run(
          ["federate", "bless-app", "--channel", CHANNEL, "--route", "hello", "--home", me],
          io(),
        ),
        said(),
      ).toBe(0);
      expect(said()).toContain('serves the app "hello" at "alice:hello"');

      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain('app "hello" serves at "alice:hello"');
      expect(said()).not.toContain("ARRIVED, INERT");
    } finally {
      await alice.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("T209 — dropping the channel unmounts the app and purges its bytes", () => {
  it("the route goes dark and the bytes are gone, while a bystander channel still serves", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const carol = await peer(CAROL_SEED, { route: "board", app: OTHER_APP, height: 33 });
    const bob = await store(BOB_SEED);
    try {
      const aliceChannel = await link(bob, alice, "alice");
      await aliceChannel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      const carolChannel = await link(bob, carol, "carol");
      await carolChannel.sync();
      await bob.blessChannelApp("channel:friends:carol", "board");

      const alicePool = aliceChannel.pool.gateway!;
      const carolPool = carolChannel.pool.gateway!;
      const aliceApp = bindingOf(alice, "hello");
      const carolApp = bindingOf(carol, "board");
      expect(await alicePool.backend.holds(aliceApp)).toBe(true);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
      expect((await bob.serveRoute("carol:board", FERN, "full")).status).toBe(200);

      await bob.dropChannel(CHANNEL);

      // The app is UNMOUNTED — the door answers nothing — and the listing no longer names it.
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      expect(bob.channelApps().map((a) => a.serves)).toEqual(["carol:board"]);
      // At the BYTES: the pool's store is gone, and the receiver never held the app anyway.
      await expect(alicePool.backend.holds(aliceApp)).rejects.toThrow(/closed/);
      expect(await bob.backend.holds(aliceApp)).toBe(false);

      // TWO-SIDED, and it must be a SUCCESS: carol's app still serves its own page from its own
      // pool, and its bytes survive. A drop that over-reached would fail here, not above.
      const still = await bob.serveRoute("carol:board", FERN, "full");
      expect(still.status).toBe(200);
      expect(bodyOf(still)).toContain("<section id=other>33</section>");
      expect(await carolPool.backend.holds(carolApp)).toBe(true);
    } finally {
      await alice.close();
      await carol.close();
      await bob.close();
    }
  });
});
