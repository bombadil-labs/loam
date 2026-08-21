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

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  contentAddress,
  makeNegationClaims,
  signClaims,
  type Policy,
  type Schema,
} from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { exportOffer } from "../../src/federation/offer.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { CTX_MANIFEST, manifestExportClaims, readManifest } from "../../src/gateway/adopt-law.js";
import { freezeMembers } from "../../src/gateway/container-identity.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { publicClaims } from "../../src/gateway/public.js";
import { serve } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, pickLatest } from "../gateway/fixtures.js";

const ALICE_SEED = "a1".repeat(32);
const BOB_SEED = "b0".repeat(32);
const CAROL_SEED = "c7".repeat(32);
const PEN_SEED = "5a".repeat(32);
const PEN = authorForSeed(PEN_SEED);
const BOB = authorForSeed(BOB_SEED);

// A needle no other store in this file plants, so a byte probe over a pool FILE is about this app's
// code and nothing else. Not pure hex: a hex needle collides with delta ids and author keys.
const NEEDLE = "arrived-app-marker-zoltar";

// A peer's app: it paints what the lens resolves and offers the form that writes it back.
const APP =
  `export default (n) => \`<main data-app="${NEEDLE}"><p id=h>\${n.view.height ?? ""}</p>` +
  "<form method=post><input name=height></form></main>`;";
// A DIFFERENT app, so a hash rail cannot pass by reporting one constant.
const OTHER_APP = 'export default (n) => `<section id=other>${n.view.height ?? ""}</section>`;';
// An app that paints WHICH READING rendered it: `watered` is a field two Schemas over the same
// ground answer differently, so the page distinguishes lenses where a value never could.
const LENS_APP = "export default (n) => `<p id=w>${String(n.view.watered)}</p>`;";

// A reading of the SAME hyperschema under the SAME lens name, with different law — the corpus in
// which "a lens of that name is served here" and "this law is served here" give different answers.
const RIVAL_PLANT: Schema = {
  props: new Map<string, Policy>([
    ["height", pickLatest],
    ["tag", pickLatest],
  ]),
  default: pickLatest,
};

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

/** Is this delta a manifest export row at all? */
const isRow = (d: { claims: { pointers: readonly { target: unknown }[] } }): boolean =>
  d.claims.pointers.some(
    (p) =>
      (p.target as { kind?: string; entity?: { context?: string } }).kind === "entity" &&
      (p.target as { entity?: { context?: string } }).entity?.context === CTX_MANIFEST,
  );

// Does ANY pool file under this home still hold these bytes? EVERY file, not just the .sqlite:
// sqlite runs in WAL mode, so a recent write lives in the -wal sidecar until a checkpoint, and a
// probe that reads only the main file reports "gone" for data that is merely un-checkpointed.
const anyPoolFileHolds = (home: string, needle: string): boolean => {
  const dir = join(home, "channels");
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => readFileSync(join(dir, f)).includes(needle));
};

// THE APP IDENTITY THE REPORT SHOULD PRINT, spelled out here as a literal rather than imported from
// the reader under test (H10): a shared helper cannot witness its own bug, and this is the number an
// operator compares two stores by. It covers everything the binding serves with EXCEPT the lens
// name, which the receiver renames on the way in — the sibling rails move the bundle, the writable
// list and the PEN in turn and watch it change.
//
// LENGTH-PREFIXED, restated here for the same reason: a peer signs these fields, so a separator any
// of them may contain would let two different bindings mint one identity.
const appIdOf = (
  bundle: string,
  opts: { route?: string; consumes?: string[]; writable?: string[]; pen?: string } = {},
): string =>
  contentAddress(
    new TextEncoder().encode(
      [
        "loam.channel.app",
        opts.route ?? "hello",
        JSON.stringify(opts.consumes ?? ["height"]),
        bundle,
        JSON.stringify(opts.writable ?? []),
        opts.pen ?? "",
      ]
        .map((field) => `${field.length}:${field}`)
        .join(""),
    ),
  );

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
        hash: appIdOf(APP),
        blessed: false,
      });

      // The standing listing says the same thing, so a person who missed the sync can still find it.
      expect(bob.channelApps()).toEqual(report.apps);
      expect(bob.channelApps(CHANNEL)).toEqual(report.apps);

      // And it turns true only when THIS code is what serves — with `serving` naming the bundle the
      // store actually runs, so the two facts stay separate.
      await bob.blessChannelApp(CHANNEL, "hello");
      // MOUNTED and SERVING are separate facts and both are present here, which is what makes the
      // sibling rails able to show a mount that answers nothing.
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
      expect(after.apps[0]!.hash).toBe(appIdOf(OTHER_APP));
      expect(after.apps[0]!.blessed).toBe(false);
      // AND IT SAYS WHAT IS RUNNING. `blessed: false` alone would read as "nothing runs", which is
      // the H7 shape: the old code IS running, and an operator told otherwise would look for the
      // wrong problem. The two facts are separate fields precisely so neither can imply the other.
      expect(after.apps[0]!.serving).toBe(appIdOf(APP));
      expect(bodyOf(await bob.serveRoute("alice:hello", FERN, "full"))).toContain("<p id=h>62</p>");

      // And the remedy the listing offers actually works: superseding moves the route onto the
      // peer's newer code. Without it the re-blessing refuses, which is why it is a flag.
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
    // Freezing stops new deltas arriving. It does not make what already arrived stop existing, and a
    // report that went quiet would leave an operator unable to see the app they still have to
    // decide about — while the sync itself honestly reports zero accepted.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.setChannel(CHANNEL, { receiving: false });

      const frozen = await channel.sync();
      // `accepted: 0` alone cannot tell a freeze from a quiet poll — re-pulling the same log accepts
      // nothing either way. `offered: 0` is what only the frozen branch produces: it returns before
      // the peer is ever asked.
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
    // The event that most argues for unmounting a stranger's code is the stranger withdrawing it.
    // Dropping the row would make exactly that moment invisible: the listing would go quiet while
    // the blessed bundle went on serving. The row survives, with no `hash` and a live `serving`.
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
      expect(after.apps[0]!.hash).toBeUndefined(); // the peer offers it no longer
      expect(after.apps[0]!.serving).toBe(appIdOf(APP)); // and this store still runs what it blessed
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
    //
    // AND THE REFUSAL IS ABOUT IDENTITY, NOT SCARCITY. The store here DOES serve a lens named
    // "Plant" — its own, seeded into the pool by the one-way edge. A door that asked "is some law of
    // that name served?" would mount the peer's app over the operator's own reading and call it
    // success, which is the capture the address matching exists to prevent, arriving by the one path
    // that skips it. So the fixture registers that rival deliberately.
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
      expect(channel.pool.gateway!.registered.some((r) => r.schema.name === "Plant")).toBe(true);

      await expect(bob.blessChannelApp(CHANNEL, "hello")).rejects.toThrow(
        /carries no definition of it/,
      );
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      expect(channel.pool.gateway!.renderers().some((r) => r.route === "hello")).toBe(false);

      // Two-sided: turn blessing on, sync, and the same call now mounts it — reading ALICE's lens.
      await bob.setChannel(CHANNEL, { blessing: true });
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
      expect(channel.pool.gateway!.renderers().find((r) => r.route === "hello")!.schemaName).toBe(
        "alice:Plant",
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("an app whose lens was CURSED refuses, and says this caller blesses one export", async () => {
    // The other refusal, and the branch that only a channel caller can reach: the module DOES carry
    // the lens, and this store binds that law under no name — because the operator retired it. A
    // door that pulled the dependency in would re-bless what the operator just retired, on the
    // strength of a request about something else.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.curseChannelLaw(CHANNEL, "alice:Plant");

      await expect(bob.blessChannelApp(CHANNEL, "hello")).rejects.toThrow(
        /blesses one export at a time/,
      );
      expect(channel.pool.gateway!.renderers().some((r) => r.route === "hello")).toBe(false);
      // Two-sided: lift the curse, sync, and the same call mounts it.
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
    // A curse strikes a binding that lives in the POOL, and a mounted app resolves through the
    // POOL's surface. Retiring the reading for the root's readers while the stranger's code goes on
    // rendering it is the retirement reporting a success it did not achieve.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);

      await bob.curseChannelLaw(CHANNEL, "alice:Plant");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      // …and the listing stops calling it served, in the same process.
      expect(bob.channelApps(CHANNEL)[0]!.serving).toBeUndefined();
      expect(bob.channelApps(CHANNEL)[0]!.blessed).toBe(false);
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

describe("T209 — the prefix reaches a blessed app and nothing else", () => {
  it("the receiver's OWN app is not reachable under a channel prefix", async () => {
    // A pool is one-way seeded with the receiver's whole ground, so every renderer this store owns
    // has an operator-signed twin inside every channel pool. Without a custody check, `alice:<any
    // route of mine>` would render MY app over the PEER's claims, with no blessing anywhere — and
    // the arrivals listing, which is peer-authored only, would show nothing at all.
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

      // The twin really is in the pool — this rail is about a reachable thing, not an absent one.
      expect(channel.pool.gateway!.renderers().some((r) => r.route === "mine")).toBe(true);
      expect(bob.channelApps(CHANNEL).some((a) => a.route === "mine")).toBe(false);

      // And the prefixed name answers nothing, on either door.
      expect((await bob.serveRoute("alice:mine", FERN, "full")).status).toBe(404);
      expect((await bob.serveRoute("alice:mine", FERN, "public")).status).toBe(404);
      // Two-sided: bob's own route still serves bob's own ground.
      expect(bodyOf(await bob.serveRoute("mine", FERN, "full"))).toContain(
        "<section id=other>7</section>",
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a blessed app answers the token door and never the anonymous one", async () => {
    // A pool decides its own anonymous surface from its own `loam:public` deltas, and its copy of
    // this store's ground is FROZEN at seeding — so a declaration the operator has since struck
    // still stands in there. Putting a second, stale, tokenless view of this store on its own front
    // door is not a decision this seam makes. The pool's own container mount is untouched.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      // Declared public IN THE POOL, which is the strongest case an anonymous caller could have.
      await channel.pool.gateway!.append([
        signClaims(publicClaims(["alice:Plant"], BOB, 9_400), BOB_SEED),
      ]);

      expect((await bob.serveRoute("alice:hello", FERN, "public")).status).toBe(404);
      expect((await bob.writeRoute("alice:hello", FERN, { height: 5 }, "public")).status).toBe(404);
      // Two-sided, and it must be a SUCCESS: the token door serves the same route.
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

      // The split is on the FIRST colon, so a peer's own colon-bearing route still resolves.
      expect((await bob.serveRoute("alice:a:b", FERN, "full")).status).toBe(200);
      // And every near-miss is the same 404 an unknown route gives — no existence oracle.
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
    // The pool is a store the PEER writes into, and `readManifest` is latest-per-alias across ALL
    // authors — so a peer can author a row that wins `app:<route>` and points at other code. The
    // operator would then bless the hash the listing showed and mount something else.
    const alice = await peer(ALICE_SEED, { route: "hello", app: OTHER_APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const decoy = bindingOf(alice, "hello");
      // Alice's LATER binding at the same route is what the listing will name.
      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: APP,
      });
      // …and she plants a manifest row, far in the future, pointing the alias back at the decoy.
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
      const pool = channel.pool.gateway!;

      // THE PLANT IS LIVE, asserted rather than assumed. Without this the rail would keep passing in
      // a world where the row never reached the pool at all — an empty-set pass, and the guard would
      // be measuring nothing (H10 one step removed).
      const members = [...pool.reactor.snapshot()];
      expect(members.some((d) => d.claims.author === authorForSeed(ALICE_SEED) && isRow(d))).toBe(
        true,
      );
      // …and it really does WIN the alias when the manifest is read unscoped, which is the whole
      // premise: the operator-scoped read is what makes the blessing ignore it.
      expect(readManifest(members).find((r) => r.alias === "app:hello")?.target).toBe(decoy);

      const listed = bob.channelApps(CHANNEL);
      expect(listed).toHaveLength(1);
      expect(listed[0]!.hash).toBe(appIdOf(APP)); // what the operator is shown

      await bob.blessChannelApp(CHANNEL, "hello");

      // What MOUNTED is what was shown, at both levels: the pool binds that bundle, and the page a
      // person receives is that bundle's output — never the decoy's.
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
    // The same trick pointed at the name-binding pass: `bindArrived` looks its rows up by lens name,
    // so a row aliased `Plant` naming a RENDERER would let auto-bless become auto-execute.
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
      const members = [...channel.pool.gateway!.reactor.snapshot()];

      // The plant is live and it WINS the alias unscoped — the premise, asserted.
      expect(readManifest(members).find((r) => r.alias === "Plant")?.target).toBe(
        bindingOf(alice, "hello"),
      );
      // The lens still binds under the receiver's own name — the pass did its job…
      expect(report.bound).toContain("alice:Plant");
      // …and mounted nothing.
      expect(channel.pool.gateway!.renderers().some((r) => r.route === "hello")).toBe(false);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a decoy row naming the RIGHT target cannot deny the operator their own alias", async () => {
    // The other half of the same guard, and it fails the other way: unscoped, a peer's row naming
    // the very binding the operator means suppresses the operator's own mint — and the scoped read
    // then finds no row at all, so `bless-app` refuses forever for that route. A peer must not be
    // able to make an act impossible any more than they can redirect it.
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
      const members = [...channel.pool.gateway!.reactor.snapshot()];
      expect(readManifest(members).find((r) => r.alias === "app:hello")?.author).toBe(
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
    // `serving` is what this store RUNS at that route, and a pool holds a twin of every renderer the
    // receiver owns. Counting a twin tells an operator their peer's route runs code it does not, and
    // offers `--supersede` for a conflict that does not exist — whose remedy would strike the
    // operator's own binding.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.append([observed(FERN, "height", 7, 2_000, BOB_SEED)]);
      // Bob's OWN app, at the same bare route name the peer uses.
      await bob.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      const channel = await link(bob, alice, "alice");
      await channel.sync();

      // The twin is really in the pool and really servable there — this is about a reachable thing.
      expect(channel.pool.gateway!.renderers().some((r) => r.route === "hello")).toBe(true);
      const row = bob.channelApps(CHANNEL)[0]!;
      expect(row.hash).toBe(appIdOf(APP));
      expect(row.serving).toBeUndefined(); // nothing of THIS channel runs there
      expect(row.blessed).toBe(false);
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      // Two-sided: bob's own route still serves bob's own app.
      expect(bodyOf(await bob.serveRoute("hello", FERN, "full"))).toContain("<section id=other>");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a peer's app binds to the PEER's lens, never to the receiver's lens of the same name", async () => {
    // A pool holds a seeded copy of the receiver's own registrations, so "a lens of that name is
    // already served here" is true of the RECEIVER's law. Matching on the bare name would mount a
    // stranger's app over the operator's own Schema — and inherit whatever the operator had
    // declared about it. Identity is the law's address; the name is the receiver's to assign.
    //
    // THE GAP THIS DOES NOT CLOSE, and it is older than this seam: the two lenses here are distinct
    // ENTITIES. When two stores file law at the SAME hyperschema entity, the manifest row a channel
    // mints names that shared entity, and `classify` resolves it against whichever definition and
    // binding win there — so the receiver's own law can answer for the peer's before any of this
    // runs. That is the entity-collision the blessing door's own capture guard is about, at the
    // federation edge rather than at a publish, and closing it wants its own ticket.
    const alice = await store(ALICE_SEED);
    const bob = await store(BOB_SEED);
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await alice.append([observed(FERN, "height", 62, 1_000, ALICE_SEED)]);
      // The app reads `watered`, which the two readings answer DIFFERENTLY over identical ground:
      // alice's Schema fills an absent value with `false`, bob's has no rule for it at all. So the
      // page itself says which lens rendered it — a value comparison cannot, because both readings
      // resolve the same `height` from the same pooled ground.
      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["watered"],
        bundle: LENS_APP,
      });
      // Bob serves his own "Plant" — SAME lens name, DIFFERENT law, at his own entity.
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

      const pool = channel.pool.gateway!;
      const bound = pool.renderers().find((r) => r.route === "hello")!;
      expect(bound.schemaName).toBe("alice:Plant");
      expect(bound.schemaName).not.toBe("Plant");
      // At the OBJECT level: the page is what ALICE's reading resolves, not bob's.
      const html = bodyOf(await bob.serveRoute("alice:hello", FERN, "full"));
      expect(html).toContain("<p id=w>false</p>");
      expect(html).not.toContain("<p id=w>undefined</p>");
      // Two-sided: bob's own lens is untouched and still answers on his own ground.
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
    // The bundle alone is not the app. A peer who re-points a route to the SAME code carrying a PEN
    // and a writable list has changed what it may DO — §6's two keys are a decision about a specific
    // binding — and a report that called that no change would hide the one re-point that matters.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED, { pens: { "alice-pen": PEN_SEED } });
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect(bob.channelApps(CHANNEL)[0]!.blessed).toBe(true);
      const before = bob.channelApps(CHANNEL)[0]!.hash;

      // Same bundle, now write-enabled.
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
      // And the pen still cannot ride the re-blessing implicitly.
      await expect(bob.blessChannelApp(CHANNEL, "hello", { supersede: true })).rejects.toThrow(
        /holds a PEN/,
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("moving ONLY the pen moves the identity", async () => {
    // The sibling rail moves `writable` and `pen` together, because the parse gate keeps them
    // paired — so it cannot see a reader that dropped the PEN alone. This one holds `writable`
    // constant and swaps the pen name, which is a §6 write-standing change and nothing else.
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
        writable: ["height"], // held constant
        pen: "alice-pen-2", // the only thing that moved
      });
      expect((await channel.sync()).apps[0]!.hash).toBe(
        appIdOf(APP, { writable: ["height"], pen: "alice-pen-2" }),
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a pin too short to identify anything is refused, not honoured", async () => {
    // `startsWith("")` is true of every identity, so an empty pin reads as a pin and is not one.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await expect(bob.blessChannelApp(CHANNEL, "hello", { expect: "" })).rejects.toThrow(
        /too short to identify/,
      );
      await expect(bob.blessChannelApp(CHANNEL, "hello", { expect: "1e20" })).rejects.toThrow(
        /too short to identify/,
      );
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
      // Two-sided: a pin long enough to mean something is honoured.
      await bob.blessChannelApp(CHANNEL, "hello", {
        expect: bob.channelApps(CHANNEL)[0]!.hash!.slice(0, 12),
      });
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a peer cannot mint two different apps with one identity", () => {
    // The fields are length-prefixed, not separated. A peer SIGNS these bytes and never passes this
    // store's publish door, so any separator they can put inside a field would let them move bytes
    // across a boundary — and pin one identity to two different bundles.
    const carrier = `EVIL\u0000${JSON.stringify(["height"])}\u0000tail`;
    const a = appIdOf(carrier, { writable: ["height"], pen: "p" });
    const b = appIdOf("EVIL", {
      writable: ["height"],
      pen: `tail\u0000${JSON.stringify(["height"])}\u0000p`,
    });
    expect(a).not.toBe(b);
    // …and the encoding is not merely long: two ordinary apps still differ.
    expect(appIdOf(APP)).not.toBe(appIdOf(OTHER_APP));
  });

  it("--expect refuses when the peer changed the app between the listing and the blessing", async () => {
    // `list` and `bless-app` are separate acts with a standing sync between them. Without a pin the
    // door is last-writer-wins; with one, the operator blesses the identity they read.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      const shown = bob.channelApps(CHANNEL)[0]!.hash!;

      // The peer moves underneath the operator.
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
      // Two-sided: the identity that IS current is accepted, and mounts.
      const now = bob.channelApps(CHANNEL)[0]!.hash!;
      await bob.blessChannelApp(CHANNEL, "hello", { expect: now });
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a withdrawal that resurfaces the peer's earlier app does not deadlock the route", async () => {
    // The dedupe asks which row WINS the alias, not whether one exists. Presence is not victory: an
    // older row naming the resurfaced binding is still there, and a presence test would skip the
    // mint, leave the newer row winning, and refuse that route forever — while the listing went on
    // recommending the command that refuses.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const first = bindingOf(alice, "hello");
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");

      // A second app at the same route, blessed over the first.
      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello", { supersede: true });
      expect(bodyOf(await bob.serveRoute("alice:hello", FERN, "full"))).toContain("<section");

      // …and now alice withdraws it, so her FIRST app resurfaces as what she offers.
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
      expect(after.apps[0]!.hash).toBe(appIdOf(APP)); // the first app again

      // The remedy the listing prints must WORK. This is the call that used to refuse forever.
      await bob.blessChannelApp(CHANNEL, "hello", { supersede: true });
      expect(bob.channelApps(CHANNEL)[0]!.blessed).toBe(true);
      expect(bodyOf(await bob.serveRoute("alice:hello", FERN, "full"))).toContain("<p id=h>62</p>");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a mounted app the receiver's own route later SHADOWS says so, and names what is in the way", async () => {
    // The twin guard runs at bless time, and the seeding edge re-pulses on every attach — so an
    // operator who publishes their own route AFTER blessing a peer's app of the same bare name
    // silently unmounts it. Reporting that as "ARRIVED, INERT" would print a remedy that refuses.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200);

      // Bob now publishes his OWN route of that bare name, and the edge re-pulses.
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      await channel.pool.reseed();

      const row = bob.channelApps(CHANNEL)[0]!;
      expect(row.mounted).toBe(appIdOf(APP)); // the blessing is still there…
      expect(row.serving).toBeUndefined(); // …and it answers nothing
      expect(row.blessed).toBe(false);
      expect(row.shadowed).toContain("your own route");
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a blessing the receiver's own PREFIXED route answers is never reported as serving", async () => {
    // The receiver's own law wins its own name, prefix and all (§46.2) — so the channel's app is
    // mounted in the pool and the operator's door never reaches it. Asking the POOL would say
    // "serving"; asking the door that a person hits says otherwise, and that is the one that counts.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      await bob.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await bob.append([observed(FERN, "height", 7, 2_000, BOB_SEED)]);
      await bob.publishRenderer({
        route: "alice:hello", // the literal name the channel would serve under
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
      // And the door confirms it: bob's own app answers that name, on bob's own ground.
      expect(bodyOf(await bob.serveRoute("alice:hello", FERN, "full"))).toContain(
        "<section id=other>7</section>",
      );
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a route the receiver's OWN law answers inside the pool is refused in those words", async () => {
    // The listing hides the seeded twin (it is not this channel's app), but the blessing door's own
    // name guard sees it — and refused with a delta id no listing shows, offering a remedy that
    // would strike the copy of the operator's own binding.
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
      // Two-sided: bob's own route is untouched and still serves.
      expect(bodyOf(await bob.serveRoute("hello", FERN, "full"))).toContain("<section id=other>");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("a second curse after a lift still retires the lens", async () => {
    // A lift revives a binding by negating the curse's negation; the negation stays on the ground.
    // Asked as presence, a second curse then finds nothing to strike and reports "nothing to
    // retire" while the lens is served and a mounted app is rendering it.
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    const bob = await store(BOB_SEED);
    try {
      const channel = await link(bob, alice, "alice");
      await channel.sync();
      await bob.blessChannelApp(CHANNEL, "hello");

      await bob.curseChannelLaw(CHANNEL, "alice:Plant");
      await bob.curseChannelLaw(CHANNEL, "alice:Plant", { lift: true });
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(200); // back

      await bob.curseChannelLaw(CHANNEL, "alice:Plant"); // the call that used to refuse
      expect((await bob.serveRoute("alice:hello", FERN, "full")).status).toBe(404);
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
      expect(said()).toContain('app "hello" — the peer offers');
      expect(said()).toContain("ARRIVED, INERT");
      expect(said()).toContain("federate bless-app --channel channel:friends:alice --route hello");

      fresh();
      expect(
        await run(
          ["federate", "bless-app", "--channel", CHANNEL, "--route", "nope", "--home", me],
          io(),
        ),
      ).toBe(2);
      expect(said()).toContain('"hello"'); // it names what it does have

      // The flag guard is its own refusal, before the gateway is ever asked.
      fresh();
      expect(await run(["federate", "bless-app", "--channel", CHANNEL, "--home", me], io())).toBe(
        2,
      );
      expect(said()).toContain("wants --route");

      // AN UNKNOWN VERB IS REFUSED BY NAME. This one is FORWARD protection, not a proof of anything
      // in this change: the allowlist already refused unknown verbs and this change only added a
      // name to it. It is here because a mutation of that allowlist's `||` SURVIVED the suite, and
      // what it survives into is ugly — `drop` is the fall-through at the bottom of the group, so a
      // typo would reach an irreversible purge. Two-sided: the channel is still here afterwards.
      fresh();
      expect(
        await run(["federate", "frobnicate", "--channel", CHANNEL, "--yes", "--home", me], io()),
      ).toBe(2);
      expect(said()).toContain("federate takes a verb");
      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain(CHANNEL);

      // --expect REACHES THE GATEWAY FROM THE COMMAND LINE. The flag whose whole purpose is to stop
      // a peer moving between `list` and `bless-app` is only worth having at the door a person types
      // it at, so the wiring is driven here rather than only through the method.
      fresh();
      expect(
        await run(
          [
            "federate",
            "bless-app",
            "--channel",
            CHANNEL,
            "--route",
            "hello",
            "--expect",
            "1e20deadbeefcafe",
            "--home",
            me,
          ],
          io(),
        ),
      ).toBe(2);
      expect(said()).toContain("you asked for 1e20deadbeefcafe");

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
      expect(said()).toContain('it SERVES at "alice:hello"');
      expect(said()).not.toContain("ARRIVED, INERT");

      // ALICE SHIPS NEW CODE at the mounted route. The listing must say what runs, and the remedy it
      // prints must be one that works — a recipe that throws is worse than none.
      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      writeFileSync(offer, exportOffer(alice));
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
      expect(said()).toContain("runs DIFFERENT code");
      expect(said()).toContain("--supersede");
      expect(said()).not.toContain("ARRIVED, INERT"); // it is NOT inert; code is running

      fresh();
      expect(
        await run(
          [
            "federate",
            "bless-app",
            "--channel",
            CHANNEL,
            "--route",
            "hello",
            "--supersede",
            "--home",
            me,
          ],
          io(),
        ),
        said(),
      ).toBe(0);
      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain('it SERVES at "alice:hello"');
      expect(said()).not.toContain("runs DIFFERENT code");

      // THE BYTES, on a real file. Every other drop rail here runs on an in-memory pool, where
      // "gone" and "closed" are the same observation. The bundle carries a needle no other store
      // has, so the file probe is about this app's code and nothing else.
      expect(anyPoolFileHolds(me, NEEDLE)).toBe(true);
      fresh();
      expect(
        await run(["federate", "drop", "--channel", CHANNEL, "--yes", "--home", me], io()),
        said(),
      ).toBe(0);
      expect(anyPoolFileHolds(me, NEEDLE)).toBe(false);

      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).not.toContain("hello");
    } finally {
      await alice.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("--pen reaches the gateway as the second key, and its absence is what refuses", async () => {
    // The flag is only a flag if the parser knows it is one: registered as a value flag it would
    // demand an argument, and the blessing would then refuse the pen-holding app it was typed for.
    const root = mkdtempSync(join(tmpdir(), "loam-t209-pen-"));
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
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62, writes: true });
    try {
      writeFileSync(offer, exportOffer(alice));
      expect(await run(["init", "--home", me], io())).toBe(0);
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

      // WITHOUT the flag: §6's two keys refuse, and nothing mounts.
      fresh();
      expect(
        await run(
          ["federate", "bless-app", "--channel", CHANNEL, "--route", "hello", "--home", me],
          io(),
        ),
      ).toBe(2);
      expect(said()).toContain("holds a PEN");

      // WITH it, typed as a bare word: accepted by the parser and carried to the gateway.
      fresh();
      expect(
        await run(
          [
            "federate",
            "bless-app",
            "--channel",
            CHANNEL,
            "--route",
            "hello",
            "--pen",
            "--home",
            me,
          ],
          io(),
        ),
        said(),
      ).toBe(0);
      expect(said()).toContain('serves the app "hello"');
    } finally {
      await alice.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("T209 — the connector tool names what arrived, and mounts nothing", () => {
  it("loam_federate_status carries the apps, and no tool can bless one", async () => {
    // §46.5: tools are the unit of CONSENT, and mounting a stranger's code is not a consent a
    // connector token may give. So the arrivals are READABLE here and the act is the CLI's alone.
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
      expect(status.text).toContain(appIdOf(APP)); // the identity, not a count

      // And READING is all this surface does: no tool it offers mounts an app.
      const listed = await fetch(`${door.url}/default/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer tok-op", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      const tools = (await listed.json()) as { result?: { tools?: { name: string }[] } };
      const names = (tools.result?.tools ?? []).map((t) => t.name);
      expect(names).toContain("loam_federate_status"); // the listing really is offered…
      expect(names.filter((n) => n.includes("bless"))).toEqual([]); // …and nothing mounts
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
