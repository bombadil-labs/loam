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
import { survivingDeclarationIds } from "../../src/gateway/container-law.js";
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

const blockFor = (name: string): string => out.find((s) => s.startsWith(name)) ?? "";

describe("T218 — federate list marks an orphaned channel", () => {
  it("marks the channel whose container is gone, and leaves a healthy one unmarked", async () => {
    const home = join(root, "me");
    initHome(home);

    const seed = readSeed(home);
    const gateway = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
      { channelBackend: channelBackendFor(home, io()) },
    );
    await gateway.openChannel({ into: "keep", prefix: "alice", source: reaches });
    await gateway.openChannel({ into: "gone", prefix: "bob", source: reaches });
    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor!,
      "gone",
    );
    expect(ids.length).toBeGreaterThan(0);
    await gateway.append(
      ids.map((id) => signClaims(makeNegationClaims(gateway.operatorAuthor!, 5000, id), seed)),
    );
    expect(gateway.containers().containers.has("gone")).toBe(false);
    expect(gateway.containers().containers.has("keep")).toBe(true);
    const names = gateway.channelStatus().map((c) => c.name);
    expect(names).toContain("channel:gone:bob");
    expect(names).toContain("channel:keep:alice");
    await gateway.close();

    expect(await run(["federate", "list", "--home", home], io())).toBe(0);

    const orphan = blockFor("channel:gone:bob");
    const healthy = blockFor("channel:keep:alice");
    expect(orphan).not.toBe("");
    expect(healthy).not.toBe("");

    expect(orphan).toContain("orphaned");
    expect(orphan).toContain('its receiving container "gone" is gone');
    expect(orphan).toContain("loam federate drop --channel channel:gone:bob --yes");
    expect(orphan).toContain("loam federate set --channel channel:gone:bob --receiving false");

    expect(healthy).not.toContain("orphaned");
  });
});
