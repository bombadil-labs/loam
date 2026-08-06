// T149 item 1 — a failed pull names the peer, what fetch saw, and the cure. The bare error
// ("fetch failed") named nothing; the operator typed the address, so the refusal says it back.
// Cause classes are asserted through the injectable fetch seam (no network dependence), and the
// live refused case through a real closed port.

import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { pullFrom } from "../../src/federation/pull.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OP_SEED = "0e".repeat(32);

async function local(): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
  );
}

describe("a failed pull says what happened", () => {
  it("a refused connection names the peer address, the cause, and the cure", async () => {
    // Bind then close: the port is a guaranteed ECONNREFUSED, no service in between.
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    await new Promise<void>((r) => server.close(() => r()));
    const gw = await local();
    await expect(pullFrom(gw, `http://127.0.0.1:${port}/default`, "tok")).rejects.toThrow(
      /http:\/\/127\.0\.0\.1:\d+\/default/,
    );
    await expect(pullFrom(gw, `http://127.0.0.1:${port}/default`, "tok")).rejects.toThrow(
      /connection was refused/,
    );
    await expect(pullFrom(gw, `http://127.0.0.1:${port}/default`, "tok")).rejects.toThrow(
      /check the address/,
    );
    await gw.close();
  });

  it("an unresolvable host is named as such, through the injectable fetch", async () => {
    const gw = await local();
    const failing = async (): Promise<Response> => {
      throw new TypeError("fetch failed", {
        cause: new Error("getaddrinfo ENOTFOUND nowhere.invalid"),
      });
    };
    await expect(
      pullFrom(gw, "http://nowhere.invalid/default", "tok", { fetch: failing }),
    ).rejects.toThrow(/the host does not resolve/);
    await gw.close();
  });

  it("a TLS fault is named as such, through the injectable fetch", async () => {
    const gw = await local();
    const failing = async (): Promise<Response> => {
      throw new TypeError("fetch failed", { cause: new Error("self-signed certificate") });
    };
    await expect(
      pullFrom(gw, "https://peer.example/default", "tok", { fetch: failing }),
    ).rejects.toThrow(/TLS certificate was not trusted/);
    await gw.close();
  });
});
