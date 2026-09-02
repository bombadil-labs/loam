// A channel opened while the store is SERVING must be polled (SPEC §46). `loam serve` used to arm
// the poller only when a channel already existed at boot, so a store that started with none never
// created an interval — and a channel opened afterwards through the MCP `loam_federate_connect`
// tool was polled by nothing, for the life of the process, while `federate list` went on reporting
// it as `receiving`. That is the exact shape the code's own note warns against: the report
// outliving the behaviour (H9).
//
// The rail drives the reachable path end to end: a receiver served by the CLI with NO channels, a
// peer served beside it, the channel opened through the receiver's own MCP door, and then a fact
// written to the peer AFTER the channel exists. Only a live poller can carry that second fact
// across, which is what makes this a test of the timer rather than of `openChannel`'s first sync.
//
// Erasure standing rule: both stores here are this file's own mkdtemp fixtures.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

vi.setConfig({ testTimeout: 30_000 }); // two real listening servers

const PEER_SEED = "0e".repeat(32);
const PEER_OP = authorForSeed(PEER_SEED);
const PEER_TOKEN = "peer-door-token";
const MINE_TOKEN = "my-door-token";

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});
const io = () => ({ out: () => {}, err: () => {} });

/** A peer store with one Plant lens and one claim, served on a real port. */
async function peer(): Promise<{ url: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: PEER_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", PEER_OP, 500), PEER_SEED),
  ]);
  await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, undefined, undefined, [
    ...PLANT_WRITABLE,
  ]);
  await gateway.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { [PEER_TOKEN]: { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  handles.push(handle);
  return { url: `${handle.url}/default`, gateway };
}

const mcp = (base: string, token: string, name: string, args: Record<string, unknown>) =>
  fetch(`${base}/default/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

/** What the receiver's own door resolves for the peer's fern, or null. */
async function heightVia(base: string): Promise<unknown> {
  const res = await fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${MINE_TOKEN}` },
    body: JSON.stringify({ query: `{ peer_Plant(entity: "${FERN}") { height } }` }),
  });
  const body = (await res.json()) as { data?: { peer_Plant?: { height?: unknown } } };
  return body.data?.peer_Plant?.height ?? null;
}

describe("§46 — a channel opened while serving is polled, with no restart", () => {
  it("the receiver follows a fact the peer wrote AFTER the channel was opened", async () => {
    const away = await peer();
    const home = mkdtempSync(join(tmpdir(), "loam-sync-armed-"));
    homes.push(home);
    expect(await run(["init", "--home", home], io())).toBe(0);

    // Served with NO channels — the state that used to arm no poller at all.
    const handle = (await run(
      ["serve", "--http", "--home", home, "--token", MINE_TOKEN, "--port", "0"],
      io(),
      { detach: true, syncEveryMs: 40 },
    )) as ServerHandle;
    handles.push(handle);
    expect(await heightVia(handle.url)).toBeNull(); // nothing of the peer's yet

    // Opened through the RUNNING store's own door, which is the reachable path.
    const opened = await mcp(handle.url, MINE_TOKEN, "loam_federate_connect", {
      from: away.url,
      into: "peers",
      prefix: "peer",
      token: PEER_TOKEN,
    });
    expect(opened.status).toBe(200);
    await vi.waitFor(async () => expect(await heightVia(handle.url)).toBe(30), { timeout: 8000 });

    // THE ASSERTION THE TIMER OWNS: a fact written to the peer AFTER the channel exists. The open
    // call's own first sync cannot carry this one, so only a live poller can.
    await away.gateway.append([observed(FERN, "height", 41, 2000, GARDENER_SEED)]);
    await vi.waitFor(async () => expect(await heightVia(handle.url)).toBe(41), { timeout: 8000 });
  });

  it("a store with no channels still reports honestly, and arms the poll it promises", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-sync-idle-"));
    homes.push(home);
    expect(await run(["init", "--home", home], io())).toBe(0);
    const said: string[] = [];
    const handle = (await run(
      ["serve", "--http", "--home", home, "--token", MINE_TOKEN, "--port", "0"],
      { out: (s: string) => said.push(s), err: () => {} },
      { detach: true, syncEveryMs: 40 },
    )) as ServerHandle;
    handles.push(handle);
    // The boot line says what is true: no channels, and a poll that will follow one opened later.
    const line = said.join("\n");
    expect(line).toContain("no channels yet");
    expect(line).not.toContain("syncing 0 channel");
  });
});
