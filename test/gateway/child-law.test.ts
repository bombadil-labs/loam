// A child ground's law policy (step 6, refactor/audit/step6-pool-keys.md, stage 1b). The pool key
// still equals the host key in production, so these rails set a DIFFERENT host key by hand: they
// prove the rule, not today's wiring. What they do not cover: grants at a container mount (the
// http standing checks), which the mount rails exercise with equal keys.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { inboxLaw, lawAuthors, localAuthors, seededLaw } from "../../src/gateway/child-law.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { trustClaims } from "../../src/gateway/trust.js";
import { MemoryBackend } from "../../src/store/memory.js";

const POOL_SEED = "1a".repeat(32);
const HOST_SEED = "2b".repeat(32);
const PEER_SEED = "3c".repeat(32);
const POOL = authorForSeed(POOL_SEED);
const HOST = authorForSeed(HOST_SEED);
const PEER = authorForSeed(PEER_SEED);

const byPeer = (n: number): Delta =>
  signClaims(
    {
      timestamp: 5_000 + n,
      validFrom: 5_000 + n,
      author: PEER,
      pointers: [{ role: "n", target: { kind: "primitive", value: n } }],
    },
    PEER_SEED,
  );

// A pool-shaped ground: governed by POOL, with HOST as its seeded host.
async function child(): Promise<Gateway> {
  const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: POOL_SEED }));
  gw.childLaw = seededLaw(HOST);
  return gw;
}

describe("lawAuthors and localAuthors", () => {
  it("a seeded child reads its own key first, then the host, and only in selected contexts", () => {
    expect(lawAuthors(POOL, seededLaw(HOST), "trust")).toEqual([POOL, HOST]);
    expect(lawAuthors(POOL, inboxLaw(HOST), "trust")).toEqual([POOL]);
    expect(lawAuthors(POOL, undefined, "grants")).toEqual([POOL]);
    expect(lawAuthors(HOST, seededLaw(HOST), "grants")).toEqual([HOST]); // equal keys: one
    expect(localAuthors(POOL, inboxLaw(HOST))).toEqual([POOL, HOST]);
  });
});

describe("a child's trust policy: its own first, a selected host copy only where it declares none", () => {
  it("with no declaration of its own, the host's seeded closed roster governs", async () => {
    const gw = await child();
    await gw.federate([signClaims(trustClaims("roster", [], HOST, 6_000), HOST_SEED)], {
      admit: () => true,
    });
    const admit = gw.admitFor();
    expect(admit(byPeer(1))).toBe(false); // a stranger is outside the host's roster
    expect(admit(signClaims({ ...byPeer(2).claims, author: HOST }, HOST_SEED))).toBe(true);
    await gw.close();
  });

  it("the child's own open declaration wins over the host's roster", async () => {
    const gw = await child();
    await gw.federate([signClaims(trustClaims("roster", [], HOST, 6_000), HOST_SEED)], {
      admit: () => true,
    });
    await gw.append([signClaims(trustClaims("open", [], POOL, 6_100), POOL_SEED)]);
    expect(gw.admitFor()(byPeer(3))).toBe(true);
    await gw.close();
  });

  it("an inbox selects nothing: a host declaration does not govern it", async () => {
    const gw = await child();
    gw.childLaw = inboxLaw(HOST);
    await gw.federate([signClaims(trustClaims("closed", [], HOST, 6_000), HOST_SEED)], {
      admit: () => true,
    });
    expect(gw.admitFor()(byPeer(4))).toBe(true); // the child's own default: open
    await gw.close();
  });
});
