// T218 — `loam federate list` marks a channel whose receiving container is GONE.
//
// A channel receives into a container. Strike that container and the channel is orphaned: its pool's
// `inboxOf` edge dangles, no subtree reaches it, no page shows it — yet `channelStatus` still lists
// it `receiving: true` and a resumed sync keeps writing peer bytes to disk. The shell reader must say
// so, so an operator on the store's own machine can find the ownerless channel and release it.
//
// Two-sided, as the ticket's criterion (b) requires: the orphan carries the marker AND a healthy
// channel — one whose receiving container still resolves — carries none. A marker on every row would
// pass a one-sided assertion and tell an operator nothing.
//
// The orphan is produced by striking the receiving container's declaration with the operator's own
// key — the same negation the drop-confirm door lands — then a FRESH `federate list` invocation reads
// the store back from disk. The list must not contradict the strike.
//
// Erasure standing rule: every store here is this file's own mkdtemp fixture.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { channelBackendFor } from "../../src/cli/cli.js";
import { initHome, readSeed, storePath } from "../../src/cli/config.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { survivingDeclarationIds } from "../../src/gateway/container.js";
import { SqliteBackend } from "../../src/store/sqlite.js";

let root: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "loam-t218-cli-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const reaches = { pull: (): Promise<never[]> => Promise.resolve([]) };

/** One channel's own block in the listing — a single `io.out` call starting with its name. */
const blockFor = (name: string): string => out.find((s) => s.startsWith(name)) ?? "";

describe("T218 — federate list marks an orphaned channel", () => {
  it("marks the channel whose container is gone, and leaves a healthy one unmarked", async () => {
    const home = join(root, "me");
    initHome(home);

    // Build the store the way the CLI opens it, so a later `run` reads exactly this back.
    const seed = readSeed(home);
    const gateway = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
      { channelBackend: channelBackendFor(home, io()) },
    );
    // Two channels: one into "keep" (survives) and one into "gone" (struck below). openChannel
    // auto-declares each missing receiving container.
    await gateway.openChannel({ into: "keep", prefix: "alice", source: reaches });
    await gateway.openChannel({ into: "gone", prefix: "bob", source: reaches });
    // Strike "gone" with the operator's own key — the negation the drop-confirm door lands.
    const ids = survivingDeclarationIds(gateway.reactor, gateway.operatorAuthor!, "gone");
    expect(ids.length).toBeGreaterThan(0);
    await gateway.append(
      ids.map((id) => signClaims(makeNegationClaims(gateway.operatorAuthor!, 5000, id), seed)),
    );
    // Delta level: "gone" is off the table, "keep" is still on it, and both channel records survive.
    expect(gateway.containers().containers.has("gone")).toBe(false);
    expect(gateway.containers().containers.has("keep")).toBe(true);
    const names = gateway.channelStatus().map((c) => c.name);
    expect(names).toContain("channel:gone:bob");
    expect(names).toContain("channel:keep:alice");
    await gateway.close();

    // Object level: a FRESH invocation reads the store from disk and renders the listing.
    expect(await run(["federate", "list", "--home", home], io())).toBe(0);

    const orphan = blockFor("channel:gone:bob");
    const healthy = blockFor("channel:keep:alice");
    expect(orphan).not.toBe("");
    expect(healthy).not.toBe("");

    // The orphan is marked, names the gone container IN the marker (not merely on the pre-existing
    // `into` line), and prints both release verbs.
    expect(orphan).toContain("orphaned");
    expect(orphan).toContain('its receiving container "gone" is gone');
    expect(orphan).toContain("loam federate drop --channel channel:gone:bob --yes");
    expect(orphan).toContain("loam federate set --channel channel:gone:bob --receiving false");

    // Two-sided: the healthy channel, whose container still resolves, carries no orphan marker.
    expect(healthy).not.toContain("orphaned");
  });
});
