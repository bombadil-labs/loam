import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { sourceFor } from "../../src/federation/channel.js";

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) =>
    server === undefined ? resolve() : server.close(() => resolve()),
  );
  server = undefined;
});

async function countingPeer(): Promise<{
  base: string;
  sockets: () => number;
  seen: IncomingMessage[];
}> {
  let sockets = 0;
  const seen: IncomingMessage[] = [];
  server = createServer((req, res) => {
    seen.push(req);
    res.end("");
  });
  server.on("connection", () => (sockets += 1));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}/default`, sockets: () => sockets, seen };
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("a federation pull", () => {
  it("asks for its connection to close, so no stale socket is pooled for the next one", async () => {
    const peer = await countingPeer();
    const source = sourceFor(
      peer.base,
      "tok",
      () => "",
      () => [],
    );
    await source.pull();
    await settle();
    await source.pull();
    expect(peer.seen.map((r) => r.headers.connection)).toEqual(["close", "close"]);
    expect(peer.seen.map((r) => r.url)).toEqual(["/default/federate", "/default/federate"]);
    expect(peer.sockets()).toBe(2);
  });

  it("CONTROL: two plain fetches share one socket — the probe can see reuse", async () => {
    const peer = await countingPeer();
    for (let i = 0; i < 2; i += 1) {
      await (await fetch(`${peer.base}/federate`)).text();
      await settle();
    }
    expect(peer.sockets()).toBe(1);
  });
});
