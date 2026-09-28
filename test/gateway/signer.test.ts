// The signing seam (step 5 PR 3j). A signer signs in one key's voice and refuses claims naming any
// other author. A gateway's signer is its governing key; an ungoverned gateway has none, and the
// acts that need one refuse as before.

import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, verifyDelta, type Claims } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { seedSigner } from "../../src/gateway/signer.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";

const SEED = "5c".repeat(32);
const OTHER = authorForSeed("6d".repeat(32));
const claims = (author: string): Claims => ({
  timestamp: 1,
  validFrom: 1,
  author,
  pointers: [{ role: "note", target: { kind: "primitive", value: "x" } }],
});

const open: Gateway[] = [];
afterEach(async () => {
  for (const gw of open.splice(0)) await gw.close();
});

describe("the signing seam", () => {
  it("signs its own author's claims, verifiably, and refuses any other author", () => {
    const signer = seedSigner(SEED);
    expect(signer.author).toBe(authorForSeed(SEED));
    const d = signer.sign(claims(signer.author));
    expect([d.claims.author, verifyDelta(d)]).toEqual([signer.author, "verified"]);
    expect(() => signer.sign(claims(OTHER))).toThrow(/refuses claims authored by/);
  });

  it("a governed gateway's signer is its governing key", async () => {
    const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: SEED }));
    open.push(gw);
    expect(gw.signer?.author).toBe(gw.operatorAuthor);
    expect(gw.signer?.author).toBe(authorForSeed(SEED));
  });

  it("an ungoverned gateway has no signer, and the acts that need one refuse as before", async () => {
    const gw = await Gateway.open(new MemoryBackend());
    open.push(gw);
    expect(gw.signer).toBeUndefined();
    await expect(gw.erase("0".repeat(64))).rejects.toThrow(
      /erasure is the instance operator's alone/,
    );
    await expect(
      gw.bindConnection({ container: "c", connectionKey: OTHER, ownerSeed: SEED }),
    ).rejects.toThrow(/only an operated store can bind a connection/);
    await expect(gw.promote(gw, FERN)).rejects.toThrow(/only an operated store may promote/);
  });
});

describe("a pool's own law is signed and authored by the pool's key", () => {
  it("bindConnection writes the owner grant in the pool under a pool key distinct from the host's", async () => {
    const { vi } = await import("vitest");
    const { containerClaims } = await import("../../src/gateway/container.js");
    const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: SEED }));
    open.push(gw);
    const POOL_SEED = "7e".repeat(32);
    vi.spyOn(gw, "childSeed").mockReturnValue(POOL_SEED); // as step 6 will: a key of its own
    const owner = "a1".repeat(32);
    await gw.append([
      gw.signer!.sign(
        containerClaims(
          { container: "home", trust: "curated", posture: "separate" },
          gw.operatorAuthor!,
          20,
        ),
      ),
    ]);
    const inbox = await gw.bindConnection({
      container: "home",
      connectionKey: OTHER,
      ownerSeed: owner,
    });
    const pool = inbox.gateway!;
    expect(pool.signer!.author).toBe(authorForSeed(POOL_SEED));
    const grant = pool.reactor
      .arrivalLog()
      .find((d) =>
        d.claims.pointers.some(
          (p) => p.role === "verb" && p.target.kind === "primitive" && p.target.value === "admin",
        ),
      )!;
    expect(grant.claims.author).toBe(authorForSeed(POOL_SEED));
    // The inbox's declaration is the host's law.
    const declaration = gw.reactor
      .arrivalLog()
      .find((d) => d.claims.pointers.some((p) => p.role === "inboxOf"))!;
    expect(declaration.claims.author).toBe(gw.operatorAuthor);
  });
});
