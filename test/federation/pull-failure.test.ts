// T149 item 1 — a failed pull names the peer, what fetch saw, and the cure. The bare error
// ("fetch failed") named nothing; the operator typed the address, so the refusal says it back.
// Cause classes are asserted through the injectable fetch seam (no network dependence), and the
// live refused case through a real closed port.

import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
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
    // Bind then close: on loopback the freed port is a near-certain ECONNREFUSED (the
    // theoretical race — another listener taking it in the window — fails LOUD, never false-green).
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
    const failing = (): Promise<Response> =>
      Promise.reject(
        new TypeError("fetch failed", {
          cause: new Error("getaddrinfo ENOTFOUND nowhere.invalid"),
        }),
      );
    await expect(
      pullFrom(gw, "http://nowhere.invalid/default", "tok", { fetch: failing }),
    ).rejects.toThrow(/the host does not resolve/);
    await gw.close();
  });

  it("a TLS fault is named as such, through the injectable fetch", async () => {
    const gw = await local();
    const failing = (): Promise<Response> =>
      Promise.reject(
        new TypeError("fetch failed", { cause: new Error("self-signed certificate") }),
      );
    await expect(
      pullFrom(gw, "https://peer.example/default", "tok", { fetch: failing }),
    ).rejects.toThrow(/TLS certificate was not trusted/);
    await gw.close();
  });

  it("a peer that dies MID-OFFER is named too — the reset class, not a bare failure", async () => {
    // The connect edge is the easy one; the reset lands after the response starts, in boundedText.
    const gw = await local();
    const dying = async (): Promise<Response> => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"deltas":'));
          controller.error(new Error("other side closed"));
        },
      });
      return new Response(stream, { status: 200 });
    };
    await expect(
      pullFrom(gw, "http://peer.example/default", "tok", { fetch: dying }),
    ).rejects.toThrow(/peer closed the connection/);
    await expect(
      pullFrom(gw, "http://peer.example/default", "tok", { fetch: dying }),
    ).rejects.toThrow(/check the address|retry/);
    await gw.close();
  });

  it("a transient resolver hiccup is a retry, not a wrong address", async () => {
    const gw = await local();
    const failing = (): Promise<Response> =>
      Promise.reject(new TypeError("fetch failed", { cause: new Error("getaddrinfo EAI_AGAIN") }));
    await expect(
      pullFrom(gw, "http://peer.example/default", "tok", { fetch: failing }),
    ).rejects.toThrow(/temporarily unavailable/);
    await gw.close();
  });
});
