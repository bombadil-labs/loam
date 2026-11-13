import { describe, expect, it } from "vitest";
import { declareHostSizedBill } from "../helpers/pool-bill.js";
import {
  ALICE_SEED,
  APP,
  BOB,
  BOB_SEED,
  CAROL_SEED,
  CHANNEL,
  FERN,
  Gateway,
  LENS_APP,
  OTHER_APP,
  PEN,
  PEN_SEED,
  PLANT,
  PLANT_POLICY,
  RIVAL_PLANT,
  SqliteBackend,
  appIdOf,
  assembleGenesis,
  authorForSeed,
  bindingOf,
  bodyOf,
  freezeMembers,
  isRow,
  join,
  link,
  makeNegationClaims,
  manifestExportClaims,
  mkdtempSync,
  observed,
  peer,
  publicClaims,
  publicDeltas,
  readManifest,
  rendererBindingClaims,
  rmSync,
  serve,
  signClaims,
  store,
  tmpdir,
} from "./t209-fixtures.js";
import { gatewayOf } from "../helpers/pool-gateway.js";

describe("T209 — an arriving renderer is present at the bytes and 404 at the door", () => {
  it("lands in the pool, serves nowhere, and serves everywhere once blessed", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      const pool = gatewayOf(channel.pool);
      const arrived = bindingOf(alice, "hello");

      expect(await pool.backend.holds(arrived)).toBe(true);
      expect(await bob.backend.holds(arrived)).toBe(false);

      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      expect((await pool.serveRoute("hello", FERN, "full")).status).toBe(404);

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
      expect(bodyOf(served)).toContain("<section id=other>7</section>");
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
        hash: appIdOf(APP),
        blessed: false,
      });

      expect(bob.channelApps()).toEqual(report.apps);
      expect(bob.channelApps(CHANNEL)).toEqual(report.apps);

      await bob.blessChannelApp(CHANNEL, "hello");
      expect(bob.channelApps()[0]).toEqual({
        channel: CHANNEL,
        route: "hello",
        serves: "alice:hello",
        hash: appIdOf(APP),
        mounted: appIdOf(APP),
        serving: appIdOf(APP),
        blessed: true,
      });
      expect((await channel.sync()).apps[0]!.blessed).toBe(true);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a peer with no app reports none, and a peer's bump reads inert again", async () => {
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

      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      const after = await channel.sync();
      expect(after.apps).toHaveLength(1);
      expect(after.apps[0]!.hash).toBe(appIdOf(OTHER_APP));
      expect(after.apps[0]!.blessed).toBe(false);
      expect(after.apps[0]!.serving).toBe(appIdOf(APP));
      expect(bodyOf(await bob.serveRoute("alice:hello", FERN, "full"))).toContain("<p id=h>62</p>");

      await expect(bob.blessChannelApp(CHANNEL, "hello")).rejects.toThrow(/DIFFERENT-content law/);
      await bob.blessChannelApp(CHANNEL, "hello", { supersede: true });
      expect(bob.channelApps(CHANNEL)[0]!.blessed).toBe(true);
      expect(bodyOf(await bob.serveRoute("alice:hello", FERN, "full"))).toContain(
        "<section id=other>62</section>",
      );
    } finally {
      await alice.close();
      await plain.close();
      await bob.close();
    }
  });

  it("a FROZEN channel still names what is sitting in its pool", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.setChannel(CHANNEL, { receiving: false });

      const frozen = await channel.sync();
      expect(frozen.offered).toBe(0);
      expect(frozen.accepted).toBe(0);
      expect(frozen.apps).toHaveLength(1);
      expect(frozen.apps[0]!.hash).toBe(appIdOf(APP));
      expect(frozen.apps[0]!.blessed).toBe(false);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a peer who WITHDRAWS an app is still reported, because this store still runs it", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      const binding = bindingOf(alice, "hello");

      await alice.append([
        signClaims(
          makeNegationClaims(authorForSeed(ALICE_SEED), 5_000, binding, "withdrawn"),
          ALICE_SEED,
        ),
      ]);
      const after = await channel.sync();

      expect(after.apps).toHaveLength(1);
      expect(after.apps[0]!.hash).toBeUndefined();
      expect(after.apps[0]!.serving).toBe(appIdOf(APP));
      expect(after.apps[0]!.blessed).toBe(false);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
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
      expect(html).toContain(CHANNEL);
      expect(html).toContain("<p id=h>62</p>");

      expect(bob.renderers().some((r) => r.route.includes("hello"))).toBe(false);
      expect(
        gatewayOf(channel.pool)
          .renderers()
          .some((r) => r.route === "hello"),
      ).toBe(true);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a form write lands in the pool's store and in no tier of the receiver's", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62, writes: true });
    const bob = await store(BOB_SEED, { pens: { "alice-pen": PEN_SEED } });
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello", { pen: true });
      const pool = gatewayOf(channel.pool);
      const before = new Set((await bob.backend.deltasSince(new Set())).map((d) => d.id));

      const wrote = await bob.writeRoute("alice:hello", FERN, { height: 71 }, "full");
      expect(wrote.status).toBe(200);
      expect(bodyOf(wrote)).toContain("<p id=h>71</p>");
      expect(bodyOf(wrote)).toContain("On probation");

      const inPool = [...pool.reactor.snapshot()].filter((d) => d.claims.author === PEN);
      expect(inPool).toHaveLength(1);
      expect(JSON.stringify(inPool[0]!.claims)).toContain("71");

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
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62, writes: true });
    const bob = await store(BOB_SEED, { pens: { "alice-pen": PEN_SEED } });
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      expect(bob.channelApps(CHANNEL)[0]!.wantsPen).toBe("alice-pen");
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
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      const report = await channel.sync();

      expect(report.bound).toContain("alice:Plant");
      expect(report.apps.map((a) => a.blessed)).toEqual([false]);

      expect(
        gatewayOf(channel.pool)
          .renderers()
          .some((r) => r.route === "hello"),
      ).toBe(false);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);

      await channel.sync();
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      const answer = await bob.query('{ alice_Plant(entity: "' + FERN + '") { height } }');
      expect((answer.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(62);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("an app whose lens is not blessed refuses, and mounts nothing", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      await bob.publishRegistration(
        PLANT,
        { ...RIVAL_PLANT, name: "Plant" },
        [FERN],
        undefined,
        "hyperschema:BobPlant",
      );
      const channel = await link(bob, alice, "alice", false);
      await channel.sync();
      expect(gatewayOf(channel.pool).registered.some((r) => r.schema.name === "Plant")).toBe(true);

      await expect(bob.blessChannelApp(CHANNEL, "hello")).rejects.toThrow(
        /carries no definition of it/,
      );
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      expect(
        gatewayOf(channel.pool)
          .renderers()
          .some((r) => r.route === "hello"),
      ).toBe(false);

      await bob.setChannel(CHANNEL, { blessing: true });
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
      expect(
        gatewayOf(channel.pool)
          .renderers()
          .find((r) => r.route === "hello")!.schemaName,
      ).toBe("alice:Plant");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("an app whose lens was CURSED refuses, and says this caller blesses one export", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.curseChannelLaw(CHANNEL, "alice:Plant");

      await expect(bob.blessChannelApp(CHANNEL, "hello")).rejects.toThrow(
        /blesses one export at a time/,
      );
      expect(
        gatewayOf(channel.pool)
          .renderers()
          .some((r) => r.route === "hello"),
      ).toBe(false);
      await bob.curseChannelLaw(CHANNEL, "alice:Plant", { lift: true });
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("cursing the lens under a MOUNTED app darkens it in the same breath", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);

      await bob.curseChannelLaw(CHANNEL, "alice:Plant");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      const row = bob.channelApps(CHANNEL)[0]!;
      expect(row.serving).toBeUndefined();
      expect(row.blessed).toBe(false);
      expect(row.mounted).toBe(appIdOf(APP));
      expect(row.dark).toBe(true);
      expect(row.shadowed).toBeUndefined();
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
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      const pool = gatewayOf(channel.pool);
      const version = freezeMembers([...pool.reactor.snapshot()]);

      await expect(pool.adoptLaw(version, "app:hello", { expect: "schema" })).rejects.toThrow(
        /different grants/,
      );
      const outcome = await pool.adoptLaw(version, "app:hello", { expect: "renderer" });
      expect(outcome.kind).toBe("witnessed");
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});

describe("T209 — the prefix reaches a blessed app and nothing else", () => {
  it("the receiver's OWN app is not reachable under a channel prefix", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.append([observed(FERN, "height", 7, 2_000, BOB_SEED)]);
      await bob.publishRenderer({
        route: "mine",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      const channel = await link(bob, alice, "alice");
      await channel.sync();

      expect(
        gatewayOf(channel.pool)
          .renderers()
          .some((r) => r.route === "mine"),
      ).toBe(true);
      expect(bob.channelApps(CHANNEL).some((a) => a.route === "mine")).toBe(false);

      expect((await bob.serveRoute("alice:mine", FERN, "full")).status).toBe(404);
      expect((await bob.serveRoute("alice:mine", FERN, "public")).status).toBe(404);
      expect(bodyOf(await bob.serveRoute("mine", FERN, "full"))).toContain(
        "<section id=other>7</section>",
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a blessed app answers the token door and never the anonymous one", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      const pool = gatewayOf(channel.pool);
      await pool.append([
        pool.signer!.sign(publicClaims(["alice:Plant"], pool.operatorAuthor!, 9_400)),
      ]);

      expect((await bob.serveRoute("alice:hello", FERN, "public")).status).toBe(404);
      expect((await bob.writeRoute("alice:hello", FERN, { height: 5 }, "public")).status).toBe(404);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a prefix that itself contains a colon still reaches its own app", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "a:b");
      await channel.sync();
      await bob.blessChannelApp("channel:friends:a:b", "hello");

      expect(bob.channelApps()[0]!.serves).toBe("a:b:hello");
      const served = await bob.serveRoute("a:b:hello", FERN, "full");
      expect(served.status).toBe(200);
      expect(bodyOf(served)).toContain("<p id=h>62</p>");
      expect((await bob.serveRoute("a:hello", FERN, "full")).status).toBe(404);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a name another channel's namespace swallows is never reported as served", async () => {
    const alice = await peer(ALICE_SEED, { route: "sub:hello", app: APP, height: 62 });
    const sub = await peer(CAROL_SEED, { route: "hello", app: OTHER_APP, height: 33 });
    const bob = await store(BOB_SEED);
    try {
      const outer = await link(bob, alice, "alice");
      await outer.sync();
      await bob.blessChannelApp("channel:friends:alice", "sub:hello");

      const before = bob.channelApps("channel:friends:alice")[0]!;
      expect(before.serves).toBe("alice:sub:hello");
      expect(before.blessed).toBe(true);
      expect(bodyOf(await bob.serveRoute("alice:sub:hello", FERN, "full"))).toContain(
        "<p id=h>62</p>",
      );

      await link(bob, sub, "alice:sub");

      const after = bob.channelApps("channel:friends:alice")[0]!;
      expect(after.mounted).toBe(appIdOf(APP, { route: "sub:hello" }));
      expect(after.serving).toBeUndefined();
      expect(after.blessed).toBe(false);
      expect(after.shadowed).toContain("alice:sub");
      expect(after.remedy).toContain("drop that channel");
      expect(after.remedy).not.toContain("your own law");
      expect(bodyOf(await bob.serveRoute("alice:sub:hello", FERN, "full"))).not.toContain(
        "<p id=h>62</p>",
      );
    } finally {
      await alice.close();
      await sub.close();
      await bob.close();
    }
  });

  it("the public door resolves no channel app to prepare", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");

      await bob.prepareRoute("alice:hello", "public");
      expect((await bob.serveRoute("alice:hello", FERN, "public")).status).toBe(404);
      await bob.prepareRoute("alice:hello", "full");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("the shapes that are not a channel app all answer the one uniform refusal", async () => {
    const alice = await peer(ALICE_SEED, { route: "a:b", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "a:b");

      expect((await bob.serveRoute("alice:a:b", FERN, "full")).status).toBe(200);
      const misses = ["alice:", ":a:b", "a:b", "zoe:a:b", "alice:nope", "alic:a:b", ""];
      for (const route of misses) {
        const answer = await bob.serveRoute(route, FERN, "full");
        expect(answer.status, route).toBe(404);
        expect(answer.body, route).toBe("no such route");
      }
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});

describe("T209 — a peer may not choose what the operator blesses", () => {
  it("a planted manifest row cannot redirect bless-app to a bundle the listing never showed", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: OTHER_APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const decoy = bindingOf(alice, "hello");
      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: APP,
      });
      await alice.append([
        signClaims(
          manifestExportClaims(
            { alias: "app:hello", targetAddress: decoy, kind: "renderer" },
            authorForSeed(ALICE_SEED),
            9_999_999_999_999,
          ),
          ALICE_SEED,
        ),
      ]);
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      const pool = gatewayOf(channel.pool);

      const members = [...pool.reactor.snapshot()];
      expect(members.some((d) => d.claims.author === authorForSeed(ALICE_SEED) && isRow(d))).toBe(
        true,
      );
      expect(readManifest(members, Date.now()).find((r) => r.alias === "app:hello")?.target).toBe(
        decoy,
      );

      const listed = bob.channelApps(CHANNEL);
      expect(listed).toHaveLength(1);
      expect(listed[0]!.hash).toBe(appIdOf(APP));

      await bob.blessChannelApp(CHANNEL, "hello");

      expect(bob.channelApps(CHANNEL)[0]!.serving).toBe(appIdOf(APP));
      const html = bodyOf(await bob.serveRoute("alice:hello", FERN, "full"));
      expect(html).toContain("<p id=h>62</p>");
      expect(html).not.toContain("<section id=other>");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a planted row under a LENS alias cannot make the blessing toggle mount code", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      await alice.append([
        signClaims(
          manifestExportClaims(
            { alias: "Plant", targetAddress: bindingOf(alice, "hello"), kind: "renderer" },
            authorForSeed(ALICE_SEED),
            9_999_999_999_999,
          ),
          ALICE_SEED,
        ),
      ]);
      const channel = await link(bob, alice, "alice");
      const report = await channel.sync();
      const members = [...gatewayOf(channel.pool).reactor.snapshot()];

      expect(readManifest(members, Date.now()).find((r) => r.alias === "Plant")?.target).toBe(
        bindingOf(alice, "hello"),
      );
      expect(report.bound).toContain("alice:Plant");
      expect(
        gatewayOf(channel.pool)
          .renderers()
          .some((r) => r.route === "hello"),
      ).toBe(false);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a decoy row naming the RIGHT target cannot deny the operator their own alias", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      await alice.append([
        signClaims(
          manifestExportClaims(
            { alias: "app:hello", targetAddress: bindingOf(alice, "hello"), kind: "renderer" },
            authorForSeed(ALICE_SEED),
            9_999_999_999_999,
          ),
          ALICE_SEED,
        ),
      ]);
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      const members = [...gatewayOf(channel.pool).reactor.snapshot()];
      expect(readManifest(members, Date.now()).find((r) => r.alias === "app:hello")?.author).toBe(
        authorForSeed(ALICE_SEED),
      );

      await bob.blessChannelApp(CHANNEL, "hello");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("the receiver's OWN route of the same name is never reported as what a channel runs", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.append([observed(FERN, "height", 7, 2_000, BOB_SEED)]);
      await bob.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      const channel = await link(bob, alice, "alice");
      await channel.sync();

      expect(
        gatewayOf(channel.pool)
          .renderers()
          .some((r) => r.route === "hello"),
      ).toBe(true);
      const row = bob.channelApps(CHANNEL)[0]!;
      expect(row.hash).toBe(appIdOf(APP));
      expect(row.serving).toBeUndefined();
      expect(row.blessed).toBe(false);
      expect(row.blocked).toContain("hello");
      expect(row.shadowed).toBeUndefined();
      await expect(bob.blessChannelApp(CHANNEL, "hello")).rejects.toThrow(/YOUR OWN route/);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      expect(bodyOf(await bob.serveRoute("hello", FERN, "full"))).toContain("<section id=other>");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a peer's app binds to the PEER's lens, never to the receiver's lens of the same name", async () => {
    const alice = await store(ALICE_SEED);
    const bob = await store(BOB_SEED);
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await alice.append([observed(FERN, "height", 62, 1_000, ALICE_SEED)]);
      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["watered"],
        bundle: LENS_APP,
      });
      await bob.publishRegistration(
        PLANT,
        { ...RIVAL_PLANT, name: "Plant" },
        [FERN],
        undefined,
        "hyperschema:BobPlant",
      );
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");

      const pool = gatewayOf(channel.pool);
      const bound = pool.renderers().find((r) => r.route === "hello")!;
      expect(bound.schemaName).toBe("alice:Plant");
      expect(bound.schemaName).not.toBe("Plant");
      const html = bodyOf(await bob.serveRoute("alice:hello", FERN, "full"));
      expect(html).toContain("<p id=w>false</p>");
      expect(html).not.toContain("<p id=w>undefined</p>");
      await bob.append([observed(FERN, "height", 7, 2_000, BOB_SEED)]);
      const answer = await bob.query('{ plant(entity: "' + FERN + '") { height } }');
      expect((answer.data as { plant: { height: unknown } }).plant.height).toBe(7);
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});

describe("T209 — what an app IS, for the report and for the blessing", () => {
  it("a pen appearing on the same bundle is a CHANGE, not a match", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED, { pens: { "alice-pen": PEN_SEED } });
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect(bob.channelApps(CHANNEL)[0]!.blessed).toBe(true);
      const before = bob.channelApps(CHANNEL)[0]!.hash;

      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: APP,
        writable: ["height"],
        pen: "alice-pen",
      });
      const after = (await channel.sync()).apps[0]!;
      expect(after.hash).not.toBe(before);
      expect(after.blessed).toBe(false);
      await expect(bob.blessChannelApp(CHANNEL, "hello", { supersede: true })).rejects.toThrow(
        /holds a PEN/,
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("moving ONLY the pen moves the identity", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62, writes: true });
    const bob = await store(BOB_SEED, { pens: { "alice-pen": PEN_SEED } });
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      expect(bob.channelApps(CHANNEL)[0]!.hash).toBe(
        appIdOf(APP, { writable: ["height"], pen: "alice-pen" }),
      );

      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: APP,
        writable: ["height"],
        pen: "alice-pen-2",
      });
      expect((await channel.sync()).apps[0]!.hash).toBe(
        appIdOf(APP, { writable: ["height"], pen: "alice-pen-2" }),
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("an app that pins a version of the PEER's store is named as unmountable, not offered a blessing", async () => {
    const alice = await peer(ALICE_SEED, { route: "other", app: OTHER_APP, height: 62 });
    await alice.publishRenderer({
      route: "hello",
      schema: "Plant",
      consumes: ["height"],
      bundle: APP,
      version: 1,
    });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();

      const row = bob.channelApps(CHANNEL).find((a) => a.route === "hello")!;
      expect(row.unmountable).toContain("pins a version");
      expect(row.hash).not.toBe(appIdOf(APP));
      await expect(bob.blessChannelApp(CHANNEL, "hello")).rejects.toThrow(/pins a §17/);

      const other = bob.channelApps(CHANNEL).find((a) => a.route === "other")!;
      expect(other.unmountable).toBeUndefined();
      expect(other.hash).toBe(appIdOf(OTHER_APP, { route: "other" }));
      await bob.blessChannelApp(CHANNEL, "other");
      expect((await bob.serveRoute("alice:other", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a route this store's publish door would refuse is named, not offered a blessing", async () => {
    const alice = await peer(ALICE_SEED, { route: "fine", app: OTHER_APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      await alice.append([
        signClaims(
          rendererBindingClaims(
            {
              route: "a/b",
              schemaName: "Plant" as never,
              consumes: ["height"],
              bundle: APP,
            },
            undefined,
            authorForSeed(ALICE_SEED),
            4_000,
          ),
          ALICE_SEED,
        ),
      ]);
      const channel = await link(bob, alice, "alice");
      await channel.sync();

      const bad = bob.channelApps(CHANNEL).find((a) => a.route === "a/b")!;
      expect(bad.unmountable).toContain("publish door");
      await expect(bob.blessChannelApp(CHANNEL, "a/b")).rejects.toThrow();
      const fine = bob.channelApps(CHANNEL).find((a) => a.route === "fine")!;
      expect(fine.unmountable).toBeUndefined();
      await bob.blessChannelApp(CHANNEL, "fine");
      expect((await bob.serveRoute("alice:fine", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a pin too short to identify anything is refused, not honoured", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await expect(bob.blessChannelApp(CHANNEL, "hello", { expect: "" })).rejects.toThrow(
        /too short to identify/,
      );
      await expect(
        bob.blessChannelApp(CHANNEL, "hello", { expect: "1e20abcdefgh" }),
      ).rejects.toThrow(/too short to identify/);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      await bob.blessChannelApp(CHANNEL, "hello", {
        expect: bob.channelApps(CHANNEL)[0]!.hash!.slice(0, 24),
      });
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("the identity's encoding cannot be forged across a field boundary", () => {
    const carrier = `EVIL\u0000${JSON.stringify(["height"])}\u0000tail`;
    const a = appIdOf(carrier, { writable: ["height"], pen: "p" });
    const b = appIdOf("EVIL", {
      writable: ["height"],
      pen: `tail\u0000${JSON.stringify(["height"])}\u0000p`,
    });
    expect(a).not.toBe(b);
    expect(appIdOf(APP)).not.toBe(appIdOf(OTHER_APP));
  });

  it("--expect refuses when the peer changed the app between the listing and the blessing", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      const shown = bob.channelApps(CHANNEL)[0]!.hash!;

      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      await channel.sync();

      await expect(bob.blessChannelApp(CHANNEL, "hello", { expect: shown })).rejects.toThrow(
        /you asked for/,
      );
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      const now = bob.channelApps(CHANNEL)[0]!.hash!;
      await bob.blessChannelApp(CHANNEL, "hello", { expect: now });
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a withdrawal that resurfaces the peer's earlier app does not deadlock the route", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const first = bindingOf(alice, "hello");
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");

      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello", { supersede: true });
      expect(bodyOf(await bob.serveRoute("alice:hello", FERN, "full"))).toContain("<section");

      const second = [...alice.reactor.snapshot()].find(
        (d) =>
          d.id !== first &&
          d.claims.pointers.some(
            (p) =>
              p.role === "route" && p.target.kind === "primitive" && p.target.value === "hello",
          ),
      )!.id;
      await alice.append([
        signClaims(
          makeNegationClaims(authorForSeed(ALICE_SEED), 6_000, second, "withdrawn"),
          ALICE_SEED,
        ),
      ]);
      const after = await channel.sync();
      expect(after.apps[0]!.hash).toBe(appIdOf(APP));

      await bob.blessChannelApp(CHANNEL, "hello", { supersede: true });
      expect(bob.channelApps(CHANNEL)[0]!.blessed).toBe(true);
      expect(bodyOf(await bob.serveRoute("alice:hello", FERN, "full"))).toContain("<p id=h>62</p>");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a mounted app the receiver's own route later SHADOWS says so, and names what is in the way", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);

      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      await channel.pool.reseed();

      const row = bob.channelApps(CHANNEL)[0]!;
      expect(row.mounted).toBe(appIdOf(APP));
      expect(row.serving).toBeUndefined();
      expect(row.blessed).toBe(false);
      expect(row.shadowed).toContain("your own route");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a blessing the receiver's own PREFIXED route answers is never reported as serving", async () => {
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

      const row = bob.channelApps(CHANNEL)[0]!;
      expect(row.mounted).toBe(appIdOf(APP));
      expect(row.serving).toBeUndefined();
      expect(row.blessed).toBe(false);
      expect(row.shadowed).toContain("alice:hello");
      expect(row.blocked).toBeUndefined();
      expect(bodyOf(await bob.serveRoute("alice:hello", FERN, "full"))).toContain(
        "<section id=other>7</section>",
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a route the receiver's OWN law answers inside the pool is refused in those words", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      const channel = await link(bob, alice, "alice");
      await channel.sync();

      await expect(bob.blessChannelApp(CHANNEL, "hello")).rejects.toThrow(/YOUR OWN route/);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      expect(bodyOf(await bob.serveRoute("hello", FERN, "full"))).toContain("<section id=other>");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a second curse after a lift still retires the lens", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");

      await bob.curseChannelLaw(CHANNEL, "alice:Plant");
      await bob.curseChannelLaw(CHANNEL, "alice:Plant", { lift: true });
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);

      await bob.curseChannelLaw(CHANNEL, "alice:Plant");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});

describe("T209 — a blessing outlives the process that made it", () => {
  it("a blessed app still serves after a restart, and the report never outruns the store", async () => {
    const root = mkdtempSync(join(tmpdir(), "loam-t209-restart-"));
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    try {
      const boot = async (): Promise<Gateway> =>
        Gateway.boot(
          new SqliteBackend(join(root, "bob.sqlite")),
          assembleGenesis({ operatorSeed: BOB_SEED }),
          {
            channelBackend: (n: string) =>
              new SqliteBackend(join(root, `${n.replace(/[^a-z0-9]/gi, "_")}.sqlite`)),
          },
        );
      const bob = await boot();
      await declareHostSizedBill(bob, 9_010);
      const channel = await bob.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
      await bob.close();

      const again = await boot();
      try {
        await again.prepareRoute("alice:hello", "full");
        const served = await again.serveRoute("alice:hello", FERN, "full");
        expect(served.status).toBe(200);
        expect(bodyOf(served)).toContain("<p id=h>62</p>");
        expect(bodyOf(served)).toContain("data-loam-probation");
        const row = again.channelApps(CHANNEL)[0]!;
        expect(row.blessed).toBe(true);
        expect(row.dark).toBeUndefined();
      } finally {
        await again.close();
      }
    } finally {
      await alice.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("T209 — a channel pool is not a door for strangers", () => {
  it("the pool's own mount refuses a tokenless caller, and the token door still serves", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.append([observed(FERN, "height", 7, 2_000, BOB_SEED)]);
      await bob.publishRenderer({
        route: "own",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      await bob.append([signClaims(publicClaims(["Plant"], BOB, 9_400), BOB_SEED)]);
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect(publicDeltas(gatewayOf(channel.pool))).toBeGreaterThan(0);

      const door = await serve({
        mounts: { default: bob },
        tokens: { "tok-op": { operator: true } },
        port: 0,
      });
      try {
        const at = (path: string): string => `${door.url}${path}`;
        const poolUrl = at(`/${encodeURIComponent(CHANNEL)}/app/own/${encodeURIComponent(FERN)}`);
        const tokenless = await fetch(poolUrl);
        const absent = await fetch(at(`/no-such-mount/app/own/${encodeURIComponent(FERN)}`));
        expect(tokenless.status).toBe(absent.status);
        expect(await tokenless.text()).toBe(await absent.text());
        expect(tokenless.status).not.toBe(200);

        const served = await fetch(at(`/default/app/alice:hello/${encodeURIComponent(FERN)}`), {
          headers: { authorization: "Bearer tok-op" },
        });
        expect(served.status).toBe(200);
        expect(await served.text()).toContain("<p id=h>7</p>");
      } finally {
        await door.close();
      }
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});

describe("T209 — the pool's closed door outlives the process that opened it", () => {
  it("a REBOOTED store still refuses a tokenless caller at the pool's own mount", async () => {
    const root = mkdtempSync(join(tmpdir(), "loam-t209-reboot-"));
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    try {
      const boot = async (): Promise<Gateway> =>
        Gateway.boot(
          new SqliteBackend(join(root, "bob.sqlite")),
          assembleGenesis({ operatorSeed: BOB_SEED }),
          {
            channelBackend: (n: string) =>
              new SqliteBackend(join(root, `${n.replace(/[^a-z0-9]/gi, "_")}.sqlite`)),
          },
        );
      const bob = await boot();
      await declareHostSizedBill(bob, 9_010);
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.publishRenderer({
        route: "own",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      await bob.append([signClaims(publicClaims(["Plant"], BOB, 9_400), BOB_SEED)]);
      const channel = await bob.openChannel({
        into: "friends",
        prefix: "alice",
        source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
      });
      await channel.sync();
      await bob.close();

      const again = await boot();
      try {
        const pool = again.channelPools.get(CHANNEL)!.gateway!;
        expect(publicDeltas(pool)).toBeGreaterThan(0);

        const door = await serve({
          mounts: { default: again },
          tokens: { "tok-op": { operator: true } },
          port: 0,
        });
        try {
          const res = await fetch(
            `${door.url}/${encodeURIComponent(CHANNEL)}/app/own/${encodeURIComponent(FERN)}`,
          );
          const absent = await fetch(
            `${door.url}/no-such-mount/app/own/${encodeURIComponent(FERN)}`,
          );
          expect(res.status).toBe(absent.status);
          expect(await res.text()).toBe(await absent.text());
          expect(res.status).not.toBe(200);
          const withToken = await fetch(
            `${door.url}/${encodeURIComponent(CHANNEL)}/app/own/${encodeURIComponent(FERN)}`,
            { headers: { authorization: "Bearer tok-op" } },
          );
          expect(withToken.status).toBe(200);
        } finally {
          await door.close();
        }
      } finally {
        await again.close();
      }
    } finally {
      await alice.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("T209 — the connector tool names what arrived, and mounts nothing", () => {
  it("loam_federate_status carries the apps, and no tool can bless one", async () => {
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    const channel = await link(bob, alice, "alice");
    await channel.sync();
    const door = await serve({
      mounts: { default: bob },
      tokens: { "tok-op": { operator: true } },
      port: 0,
    });
    const call = async (name: string): Promise<{ text: string; isError: boolean }> => {
      const res = await fetch(`${door.url}/default/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer tok-op", "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: {} },
        }),
      });
      const body = (await res.json()) as {
        result?: { content?: { text?: string }[]; isError?: boolean };
      };
      return {
        text: body.result?.content?.[0]?.text ?? "",
        isError: body.result?.isError === true,
      };
    };
    try {
      const status = await call("loam_federate_status");
      expect(status.isError).toBe(false);
      const rows = JSON.parse(status.text) as { name: string; apps: { route: string }[] }[];
      const mine = rows.find((c) => c.name === CHANNEL)!;
      expect(mine.apps.map((a) => a.route)).toEqual(["hello"]);
      expect(status.text).toContain(appIdOf(APP));

      const listed = await fetch(`${door.url}/default/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer tok-op", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      const tools = (await listed.json()) as { result?: { tools?: { name: string }[] } };
      const names = (tools.result?.tools ?? []).map((t) => t.name);
      expect(names).toContain("loam_federate_status");
      expect(names.filter((n) => n.includes("bless"))).toEqual([]);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
    } finally {
      await door.close();
      await alice.close();
      await bob.close();
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

      const alicePool = gatewayOf(aliceChannel.pool);
      const carolPool = gatewayOf(carolChannel.pool);
      const aliceApp = bindingOf(alice, "hello");
      const carolApp = bindingOf(carol, "board");
      expect(await alicePool.backend.holds(aliceApp)).toBe(true);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
      expect((await bob.serveRoute("carol:board", FERN, "full")).status).toBe(200);

      await bob.dropChannel(CHANNEL);

      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      expect(bob.channelApps().map((a) => a.serves)).toEqual(["carol:board"]);
      await expect(alicePool.backend.holds(aliceApp)).rejects.toThrow(/closed/);
      expect(await bob.backend.holds(aliceApp)).toBe(false);

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
