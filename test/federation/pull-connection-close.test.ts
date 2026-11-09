// A federation pull leaves no pooled socket behind (the Windows `fetch failed` flake, drop-cli).
//
// A pull is one GET per poll, and polls sit far apart next to a server's keep-alive window, so a
// pooled socket never carries a second pull; it only waits to be reused when it is already stale.
// Reuse is a race between the client's idle timer and the server's. When the server reaps first,
// the request is written onto a closed socket and fails as `fetch failed` (ECONNRESET). A busy
// event loop decides that race, and in-process (`serve --detach`) the server's clock runs on the
// SAME loop as the client's, so any stall longer than the window loses it.
//
// What this pins: every pull arrives on its own connection, asking for it to close. Two-sided: a
// control pair of plain fetches to the same server shares one socket, so the probe can see reuse.

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

/** A peer that answers anything with an empty body and counts the sockets it was reached on. */
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

// One turn of the loop after a response, so the client's pool has taken back a finished socket
// before the next request is dispatched. Both tests pace their requests the same way.
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
