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
  it("list says INERT with the recipe, bless-app mounts it, list says it serves", async () => {
    const root = mkdtempSync(join(tmpdir(), "loam-t209-cli-"));
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    try {
      const cli = await cliHome(root, alice);
      const { me, io, said, fresh } = cli;

      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain('app "hello" — the peer offers');
      expect(said()).toContain("ARRIVED, INERT");
      expect(said()).toContain("federate bless-app --channel channel:friends:alice --route hello");

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
    const root = mkdtempSync(join(tmpdir(), "loam-t209-flags-"));
    const alice = await peer(ALICE_SEED, { route: "hello", app: APP, height: 62 });
    try {
      const { me, io, said, fresh } = await cliHome(root, alice);

      expect(await run(["federate", "bless-app", "--channel", CHANNEL, "--home", me], io())).toBe(
        2,
      );
      expect(said()).toContain("wants --route");

      fresh();
      expect(
        await run(["federate", "frobnicate", "--channel", CHANNEL, "--yes", "--home", me], io()),
      ).toBe(2);
      expect(said()).toContain("federate takes a verb");

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
      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain("blessing");
      expect(said()).not.toContain("NOT blessing");

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
    const root = mkdtempSync(join(tmpdir(), "loam-t209-grant-"));
    const alice = await resolverPeer();
    try {
      const { me, io, said, fresh } = await cliHome(root, alice);

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
      expect(said()).toContain("not in the render worker");

      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).not.toContain("computed fields REFUSE");
    } finally {
      await alice.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("a toggle spelling this does not understand is refused, never read as yes", async () => {
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
      expect(said()).not.toContain("NOT blessing");
      expect(said()).not.toContain("zoe");

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
      expect(said()).not.toContain("ARRIVED, INERT");

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

      fresh();
      expect(
        await run(
          ["federate", "bless-app", "--channel", CHANNEL, "--route", "hello", "--home", me],
          io(),
        ),
      ).toBe(2);
      expect(said()).toContain("holds a PEN");

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

      fresh();
      expect(await run(["federate", "list", "--home", me], io()), said()).toBe(0);
      expect(said()).toContain("it cannot mount");
      expect(said()).toContain("holds that name");
      expect(said()).not.toContain("ARRIVED, INERT");
      expect(said()).not.toContain("bless-app --channel");

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
