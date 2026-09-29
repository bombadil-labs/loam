// A child ground's law policy (step 6, refactor/audit/step6-pool-keys.md, stage 1b). The pool key
// still equals the host key in production, so these rails set a DIFFERENT host key by hand: they
// prove the rule, not today's wiring. What they do not cover: grants at a container mount (the
// http standing checks), which the mount rails exercise with equal keys.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { bindingPolicyClaims } from "../../src/gateway/binding-policy.js";
import { maskReadings } from "../../src/gateway/erase.js";
import { withStamp } from "../../src/gateway/stamp.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_READING } from "./fixtures.js";
import {
  hostChain,
  inboxLaw,
  lawAuthors,
  localAuthors,
  seededLaw,
} from "../../src/gateway/child-law.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
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
  gw.childLaw = seededLaw([HOST]);
  return gw;
}

describe("lawAuthors and localAuthors", () => {
  it("a seeded child reads its own key first, then the host, and only in selected contexts", () => {
    expect(lawAuthors(POOL, seededLaw([HOST]), "trust")).toEqual([POOL, HOST]);
    expect(lawAuthors(POOL, inboxLaw([HOST]), "trust")).toEqual([POOL]);
    expect(lawAuthors(POOL, undefined, "grants")).toEqual([POOL]);
    expect(lawAuthors(HOST, seededLaw([HOST]), "grants")).toEqual([HOST]); // equal keys: one
    expect(localAuthors(POOL, inboxLaw([HOST]))).toEqual([POOL, HOST]);
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
    gw.childLaw = inboxLaw([HOST]);
    await gw.federate([signClaims(trustClaims("closed", [], HOST, 6_000), HOST_SEED)], {
      admit: () => true,
    });
    expect(gw.admitFor()(byPeer(4))).toBe(true); // the child's own default: open
    await gw.close();
  });

  it("an inbox's own roster is not widened for its host's key", async () => {
    const gw = await child();
    gw.childLaw = inboxLaw([HOST]);
    await gw.append([signClaims(trustClaims("roster", [], POOL, 6_000), POOL_SEED)]);
    const hostDatum = signClaims({ ...byPeer(5).claims, author: HOST }, HOST_SEED);
    expect(gw.admitFor()(hostDatum)).toBe(false);
    expect(gw.admitFor()(signClaims({ ...byPeer(6).claims, author: POOL }, POOL_SEED))).toBe(true);
    await gw.close();
  });

  it("a nested pool keeps its root host's seeded law through the host chain", async () => {
    const gw = await child();
    const MIDDLE = authorForSeed("4d".repeat(32));
    // opened by a pool (MIDDLE) that itself was opened by HOST: the chain is [MIDDLE, HOST]
    gw.childLaw = seededLaw(hostChain(MIDDLE, seededLaw([HOST])));
    expect(gw.lawAuthors("trust")).toEqual([POOL, MIDDLE, HOST]);
    await gw.federate([signClaims(trustClaims("closed", [], HOST, 6_000), HOST_SEED)], {
      admit: () => true,
    });
    expect(gw.admitFor()(byPeer(7))).toBe(false); // the root host's copy governs
    await gw.close();
  });
});

describe("stage 1b-ii: standing and registrations read own and selected host law", () => {
  const WRITER_SEED = "5e".repeat(32);
  const WRITER = authorForSeed(WRITER_SEED);
  const byWriter = (n: number): Delta =>
    signClaims({ ...byPeer(n).claims, author: WRITER }, WRITER_SEED);
  const hostGrant = signClaims(grantClaims(STORE_ENTITY, WRITER, "write", HOST, 7_000), HOST_SEED);

  it("a host-rooted write grant gives standing in a seeded child, and not in an inbox", async () => {
    const gw = await child();
    await gw.federate([hostGrant], { admit: () => true });
    await gw.append([byWriter(10)]);
    expect(gw.reactor.get(byWriter(10).id)).toBeDefined();
    const inbox = await child();
    inbox.childLaw = inboxLaw([HOST]);
    await inbox.federate([hostGrant], { admit: () => true });
    await expect(inbox.append([byWriter(11)])).rejects.toThrow(/not permitted/);
    await gw.close();
    await inbox.close();
  });

  it("a host-rooted grant is the host chain's to strike, not the pool's", async () => {
    const gw = await child();
    await gw.federate([hostGrant], { admit: () => true });
    await gw.append([signClaims(makeNegationClaims(POOL, 7_100, hostGrant.id), POOL_SEED)]);
    await gw.append([byWriter(12)]); // the pool's strike does not end a host-rooted grant
    await gw.federate([signClaims(makeNegationClaims(HOST, 7_200, hostGrant.id), HOST_SEED)], {
      admit: () => true,
    });
    await expect(gw.append([byWriter(13)])).rejects.toThrow(/not permitted/);
    await gw.close();
  });

  it("a host's registration copy binds in a seeded child, and not in an inbox", async () => {
    const hostRegs = assembleGenesis({
      operatorSeed: HOST_SEED,
      registrations: [{ hyperschema: PLANT, schema: PLANT_READING, roots: [FERN] }],
    }).deltas;
    const gw = await child();
    await gw.federate(hostRegs, { admit: () => true });
    gw.replayRegistrations();
    expect(gw.registered.map((r) => r.hyperschema.name)).toContain("Plant");
    const inbox = await child();
    inbox.childLaw = inboxLaw([HOST]);
    await inbox.federate(hostRegs, { admit: () => true });
    inbox.replayRegistrations();
    expect(inbox.registered.map((r) => r.hyperschema.name)).not.toContain("Plant");
    await gw.close();
    await inbox.close();
  });

  it("a selected host has no standing of its own in a child: only its grants count", async () => {
    const gw = await child();
    const hostDatum = signClaims({ ...byPeer(14).claims, author: HOST }, HOST_SEED);
    await expect(gw.append([hostDatum])).rejects.toThrow(/not permitted/);
    await gw.close();
  });

  it("a host copy does not fill a name the child claimed and its own policy withheld", async () => {
    const gw = await child();
    await gw.append([
      signClaims(
        withStamp(gw.stamp(), (t) => bindingPolicyClaims("conflicts", POOL, t)),
        POOL_SEED,
      ),
    ]);
    const named = (name: string) => ({ ...PLANT_READING, name });
    await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
    await gw.publishRegistration(
      { name: "Two", alg: 1, body: PLANT.body },
      named("Shared"),
      [FERN],
      undefined,
      "hyperschema:Two",
    );
    const lenses = () => gw.registered.map((r) => r.lensName ?? r.hyperschema.name);
    expect(lenses()).not.toContain("Shared"); // withheld under the child's own `conflicts`
    const hostShared = assembleGenesis({
      operatorSeed: HOST_SEED,
      registrations: [{ hyperschema: PLANT, schema: named("Shared"), roots: [FERN] }],
    }).deltas;
    await gw.federate(hostShared, { admit: () => true });
    gw.replayRegistrations();
    expect(lenses()).not.toContain("Shared");
    await gw.close();
  });

  it("the erasure reading mask counts a host-seeded reading the child serves", async () => {
    const hostRegs = assembleGenesis({
      operatorSeed: HOST_SEED,
      registrations: [{ hyperschema: PLANT, schema: PLANT_READING, roots: [FERN] }],
    }).deltas;
    const gw = await child();
    await gw.federate(hostRegs, { admit: () => true });
    gw.replayRegistrations();
    const labels = [...maskReadings(gw).masks.values()].flatMap((m) =>
      m.readings.map((r) => r.label),
    );
    expect(labels).toContain("Plant");
    await gw.close();
  });
});
