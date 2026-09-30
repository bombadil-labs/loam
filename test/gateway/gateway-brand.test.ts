// The renderer context's guard accepts only a real gateway. The brand is claimed once, by
// gateway.ts; no other module can mark an object, and a borrowed prototype is not a gateway.

import { describe, expect, it } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";
import { claimGatewayMarker, isGateway } from "../../src/gateway/gateway-brand.js";
import { createRootRendererContext } from "../../src/gateway/renderer-context.js";
import { MemoryBackend } from "../../src/store/memory.js";

describe("the gateway brand", () => {
  it("is claimed once: a second claim throws, so nothing else can brand an object", () => {
    expect(() => claimGatewayMarker()).toThrow(/already claimed/);
  });

  it("a look-alike is refused, including one that borrows the gateway's prototype", () => {
    const plain = {};
    const borrowed = Object.create(Gateway.prototype) as object;
    for (const fake of [plain, borrowed]) {
      expect(isGateway(fake)).toBe(false);
      expect(() => createRootRendererContext(fake as Gateway, "full", () => 1)).toThrow(
        /renderer context refuses this request/,
      );
    }
  });

  it("a real gateway passes (the control)", async () => {
    const gw = await Gateway.open(new MemoryBackend(), {});
    expect(isGateway(gw)).toBe(true);
    expect(() => createRootRendererContext(gw, "full", () => 1)).not.toThrow();
    await gw.close();
  });
});
