// T209 — install by federation, through the SHIPPED COMMAND.
//
// Split from the gateway-level rails because each of these boots a sqlite home and runs the CLI
// several times, and one file holding all of it ran fifty seconds serially — long enough to starve
// its own tests under a loaded suite. Fixtures in `t209-fixtures.ts`.
//
// ONE ACT PER RAIL. These were a single test driving twenty CLI invocations, which timed out under
// load: a red bar nobody can attribute trains whoever reads it to re-run instead of look.

import { describe, expect, it } from "vitest";
import {
  ALICE_SEED,
  APP,
  CHANNEL,
  FERN,
  Gateway,
  NEEDLE,
  OTHER_APP,
  PLANT,
  PLANT_POLICY,
  SqliteBackend,
  anyPoolFileHolds,
  assembleGenesis,
  authorForSeed,
  bindingOf,
  cliHome,
  exportOffer,
  join,
  makeNegationClaims,
  mkdtempSync,
  peer,
  readSeed,
  resolverPeer,
  rmSync,
  run,
  signClaims,
  storePath,
  tmpdir,
  writeFileSync,
} from "./t209-fixtures.js";

describe("T209 — the CLI names what arrived and mounts one app", () => {
  // ONE ACT PER RAIL. This was a single test that drove twenty CLI invocations against a sqlite
  // home, and it timed out under a loaded suite — a flake in a rail, which is worse than a slow
  // test: a red bar nobody can attribute trains whoever reads it to re-run instead of look. Split,
  // each one names a behaviour, each stays well inside the clock, and a failure points at one thing.

  it("list says INERT with the recipe, bless-app mounts it, list says it serves", async () => {
    // Driven through the shipped CLI on a sqlite home, in FRESH invocations — the state where the
    // channel cannot resume (a file offer carries no token) and only its pool is re-attached. An app
    // must stay blessable and stay served there: whether this store can currently reach the peer has
    // nothing to do with whether the operator's own blessing stands.
    const root = mkdtempSync(join(tmpdir(), "loam-t209-cli-"));
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    try {
      const cli = await cliHome(root, alice);
      const { me, io, said, fresh } = cli;

      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain('app "hello" — the peer offers');
      expect(said()).toContain("ARRIVED, INERT");
      expect(said()).toContain("federate bless-app --channel channel:friends:alice --route hello");

      // THE DOCUMENTED WORKFLOW, END TO END: read the listing, paste what it printed, bless. The
      // listing used to print twelve characters and the floor demanded twenty, so pasting the id a
      // person could actually see was refused every time — a remedy the surface offering it could
      // not satisfy. The pin here is READ OUT OF THE LISTING's own bytes, never hand-typed.
      const printed = /1e20[0-9a-f]+/.exec(said())?.[0];
      expect(printed, said()).toBeDefined();
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
            printed!,
            "--home",
            me,
          ],
          io(),
        ),
        said(),
      ).toBe(0);
      expect(said()).toContain('serves the app "hello" at "alice:hello"');

      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain('it SERVES at "alice:hello"');
      expect(said()).not.toContain("ARRIVED, INERT");
    } finally {
      await alice.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("a flag this verb never reads is refused, in both halves of the parser", async () => {
    // `federate` is five commands wearing one name, and its flag allowlist is per COMMAND — so a
    // flag one verb reads was silently accepted by all the others. The direction that matters is
    // `--bless`: dropped on `bless-app`, an operator who asked to STOP new law binding was granted
    // and told nothing. A dropped `--route` merely failed to mount.
    const root = mkdtempSync(join(tmpdir(), "loam-t209-flags-"));
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    try {
      const { me, io, said, fresh } = await cliHome(root, alice);

      // The flag guard is its own refusal, before the gateway is ever asked.
      expect(await run(["federate", "bless-app", "--channel", CHANNEL, "--home", me], io())).toBe(
        2,
      );
      expect(said()).toContain("wants --route");

      // AN UNKNOWN VERB IS REFUSED BY NAME. Forward protection, not a proof of this change: the
      // allowlist already refused unknown verbs and this change only added a name to it. It is here
      // because a mutation of that allowlist's `||` SURVIVED the suite, and `drop` is the
      // fall-through at the bottom of the group — so a typo would reach an irreversible purge.
      fresh();
      expect(
        await run(["federate", "frobnicate", "--channel", CHANNEL, "--yes", "--home", me], io()),
      ).toBe(2);
      expect(said()).toContain("federate takes a verb");

      // BOTH PARSER MAPS. A declared boolean lands in `booleans` and never in `flags`, so a guard
      // that read one map would let half the names through while looking complete.
      for (const stray of ["--pen", "--supersede"]) {
        fresh();
        expect(
          await run(
            [
              "federate",
              "bless-app",
              "--channel",
              CHANNEL,
              "--resolvers",
              "alice:Plant",
              stray,
              "--home",
              me,
            ],
            io(),
          ),
          said(),
        ).toBe(2);
        expect(said()).toContain(`does not take ${stray}`);
      }

      // AND THE FAIL-OPEN ONE. `--bless` is a real flag of this command, read only by `set`.
      fresh();
      expect(
        await run(
          [
            "federate",
            "bless-app",
            "--channel",
            CHANNEL,
            "--resolvers",
            "alice:Plant",
            "--bless",
            "false",
            "--home",
            me,
          ],
          io(),
        ),
        said(),
      ).toBe(2);
      expect(said()).toContain("does not take --bless");
      // Two-sided at the STORE, not only at the exit code: the channel is still blessing, because
      // the refusal happened before anything was granted or changed.
      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain("blessing");
      expect(said()).not.toContain("NOT blessing");

      // `--route` names the OTHER act: asked for both, an operator got one and heard about one.
      fresh();
      expect(
        await run(
          [
            "federate",
            "bless-app",
            "--channel",
            CHANNEL,
            "--resolvers",
            "alice:Plant",
            "--route",
            "hello",
            "--home",
            me,
          ],
          io(),
        ),
        said(),
      ).toBe(2);
      expect(said()).toContain("does not take --route");

      // AND `--expect`, whose refusal carries a reason of its own: there is no identity for a
      // lens's resolver law to pin, so accepting it would tell an operator they had pinned.
      fresh();
      expect(
        await run(
          [
            "federate",
            "bless-app",
            "--channel",
            CHANNEL,
            "--resolvers",
            "alice:Plant",
            "--expect",
            "1e20deadbeefcafe0123456789",
            "--home",
            me,
          ],
          io(),
        ),
        said(),
      ).toBe(2);
      expect(said()).toContain("does not take --expect");
      expect(said()).toContain("Nothing was granted");

      // THE `--resolvers` BRANCH REACHING THE GATEWAY, which every assertion above stops short of:
      // each refuses at a flag guard, so none of them proves the act is wired to the door a person
      // types it at. Nothing on this channel is withheld, so the act refuses — and that refusal
      // comes from the gateway, past the guards, which is what makes it a wiring proof.
      fresh();
      expect(
        await run(
          ["federate", "bless-app", "--channel", CHANNEL, "--resolvers", "Plant", "--home", me],
          io(),
        ),
        said(),
      ).toBe(2);
      expect(said()).toContain("holds no withheld resolvers");
    } finally {
      await alice.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("the resolvers act runs through the CLI, and reports only what the store answers", async () => {
    // Every other CLI rail for this act stops at a flag guard, so none of them reaches
    // `blessChannelResolvers`, its H7 read-back, or its success line. This one drives the whole
    // branch: a peer whose fields are computed, the refusal an operator meets first, the act, and
    // the store agreeing afterwards.
    const root = mkdtempSync(join(tmpdir(), "loam-t209-grant-"));
    const alice = await resolverPeer();
    try {
      const { me, io, said, fresh } = await cliHome(root, alice);

      // The listing names the decision waiting on a person — the help points here for it.
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain('lens "alice:Plant"');
      expect(said()).toContain("computed fields REFUSE");
      expect(said()).toContain('--resolvers "alice:Plant"');

      fresh();
      expect(
        await run(
          [
            "federate",
            "bless-app",
            "--channel",
            CHANNEL,
            "--resolvers",
            "alice:Plant",
            "--home",
            me,
          ],
          io(),
        ),
        said(),
      ).toBe(0);
      expect(said()).toContain("now runs the peer's resolver code");
      // The success line does not claim the worker bounds it, because it does not.
      expect(said()).toContain("not in the render worker");

      // AND THE STORE AGREES: the listing no longer names a withheld lens, so the announcement was
      // read back rather than assumed.
      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).not.toContain("computed fields REFUSE");
    } finally {
      await alice.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("a toggle spelling this does not understand is refused, never read as yes", async () => {
    // `!== "false"` made `FALSE`, `0`, `no` and `off` all mean ON — in the one direction where
    // guessing is unsafe, since the operator was asking to stop new law binding. And `open` never
    // prints the blessing state it settled on, so there the wrong guess is silent at the door that
    // makes it.
    const root = mkdtempSync(join(tmpdir(), "loam-t209-toggle-"));
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    try {
      const { me, io, said, fresh } = await cliHome(root, alice);

      for (const spelling of ["FALSE", "0", "no"]) {
        fresh();
        expect(
          await run(
            ["federate", "set", "--channel", CHANNEL, "--bless", spelling, "--home", me],
            io(),
          ),
          said(),
        ).toBe(2);
        expect(said()).toContain('exactly "true" or "false"');
      }

      // AND ON `open`, which its own refusal calls the worse door: that one never prints the
      // blessing state it settled on, so a wrong guess there is silent at the moment it is made.
      fresh();
      expect(
        await run(
          [
            "federate",
            "open",
            "--from",
            join(root, "peer.offer"),
            "--into",
            "friends",
            "--prefix",
            "zoe",
            "--bless",
            "FALSE",
            "--home",
            me,
          ],
          io(),
        ),
        said(),
      ).toBe(2);
      expect(said()).toContain('exactly "true" or "false"');

      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).not.toContain("NOT blessing"); // none of them changed anything
      expect(said()).not.toContain("zoe"); // and nothing was opened

      // `--receiving` is the same door, and it is the remedy the drop refusal points at — a wrong
      // entry in this verb's own flag table would turn a printed remedy into a refusal.
      fresh();
      expect(
        await run(
          ["federate", "set", "--channel", CHANNEL, "--receiving", "false", "--home", me],
          io(),
        ),
        said(),
      ).toBe(0);
      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain("FROZEN");

      // Two-sided: the spelling it DOES understand works, and the listing says so.
      fresh();
      expect(
        await run(
          ["federate", "set", "--channel", CHANNEL, "--bless", "false", "--home", me],
          io(),
        ),
        said(),
      ).toBe(0);
      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain("NOT blessing");
    } finally {
      await alice.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("the peer ships new code, and --supersede is what moves the route onto it", async () => {
    const root = mkdtempSync(join(tmpdir(), "loam-t209-bump-"));
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    try {
      const cli = await cliHome(root, alice);
      const { me, io, said, fresh } = cli;
      expect(
        await run(
          ["federate", "bless-app", "--channel", CHANNEL, "--route", "hello", "--home", me],
          io(),
        ),
        said(),
      ).toBe(0);

      // ALICE SHIPS NEW CODE at the mounted route. The listing must say what runs, and the remedy
      // it prints must be one that works — a recipe that throws is worse than none.
      await alice.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      await cli.reopen();

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
    } finally {
      await alice.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("a withdrawal is reported honestly, and drop purges the app at the bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "loam-t209-drop-"));
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    try {
      const cli = await cliHome(root, alice);
      const { me, io, said, fresh } = cli;
      expect(
        await run(
          ["federate", "bless-app", "--channel", CHANNEL, "--route", "hello", "--home", me],
          io(),
        ),
        said(),
      ).toBe(0);

      // ALICE WITHDRAWS IT. There is nothing left to bless and nothing newer to move onto, so every
      // remedy but one would refuse — and the listing must not offer them. The row landing in the
      // "runs DIFFERENT code … --supersede" branch was the shape this block exists to stop.
      await alice.append([
        signClaims(
          makeNegationClaims(
            authorForSeed(ALICE_SEED),
            7_000,
            bindingOf(alice, "hello"),
            "withdrawn",
          ),
          ALICE_SEED,
        ),
      ]);
      await cli.reopen();

      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain("the peer WITHDREW it");
      expect(said()).toContain("still runs the app it blessed");
      expect(said()).toContain("federate drop --channel channel:friends:alice --yes");
      expect(said()).not.toContain("runs DIFFERENT code");
      expect(said()).not.toContain("--supersede");
      expect(said()).not.toContain("ARRIVED, INERT");

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

describe("T209 — the CLI says what it found, and never announces a mount it did not make", () => {
  it("a blocked route prints why, and a blessing that lands without serving exits 2", async () => {
    // The two CLI states an operator is most likely to hit and least able to diagnose, driven
    // through the shipped command. Both are about the same collision — a name of the operator's own
    // — met once BEFORE a blessing and once AFTER one, and each has to say a different true thing.
    const root = mkdtempSync(join(tmpdir(), "loam-t209-cli2-"));
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

      // Bob's OWN route of the same bare name, published straight into the home the CLI reads.
      const home = await Gateway.boot(
        new SqliteBackend(storePath(me)),
        assembleGenesis({ operatorSeed: readSeed(me) }),
      );
      await home.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await home.publishRenderer({
        route: "hello",
        schema: "Plant",
        consumes: ["height"],
        bundle: OTHER_APP,
      });
      await home.close();

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

      // BEFORE a blessing: nothing is mounted and nothing can be. The listing must not send the
      // operator to `bless-app`, which refuses this exact state by name.
      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain("it cannot mount");
      expect(said()).toContain("holds that name");
      expect(said()).not.toContain("ARRIVED, INERT");
      expect(said()).not.toContain("bless-app --channel");

      // And the door agrees: the act it withheld really is refused.
      fresh();
      expect(
        await run(
          ["federate", "bless-app", "--channel", CHANNEL, "--route", "hello", "--home", me],
          io(),
        ),
      ).toBe(2);
      expect(said()).toContain("YOUR OWN route");
    } finally {
      await alice.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
