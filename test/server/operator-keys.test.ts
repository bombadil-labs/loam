// §36 phase 3 (T124), the per-operator-keys letters A-I from
// `.adlc/specs/36-03-the-bootstrap-the-role-commands-and-per-operator-keys.md`. The CLI's own
// behaviour (delta counts, refusals, help text) is `test/cli/user-roles.test.ts`; this file asserts
// the GROUND/GRANT mechanics: whose signature counts, and why — `lawfulStrikersJson`,
// `governedGatherBody` and `dataStruck` (`src/gateway/accounts.ts`, unmodified by this ticket).
//
// Two levels, every time a negation is in play (CLAUDE.md's P3 rule): the DELTA level (is the
// strike genuinely in the reactor?) and the OBJECT level (does a governed reader honor it?).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, Reactor } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { readSeed, readUserSeed, storePath } from "../../src/cli/config.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { dataStruck, grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import type { ScryptParams } from "../../src/server/credentials.js";

let home: string;
const io = () => ({ out: () => undefined, err: () => undefined });
const CHEAP_SCRYPT: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
const password = (value: string) => ({
  readSecret: () => Promise.resolve(value),
  scrypt: CHEAP_SCRYPT,
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-operator-keys-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function ground(): Promise<{
  reactor: Reactor;
  operator: string;
  close: () => Promise<void>;
}> {
  const seed = readSeed(home);
  const gateway = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: seed }),
  );
  return { reactor: gateway.reactor, operator: gateway.operator!, close: () => gateway.close() };
}

// A throwaway data claim + its negation, admitted straight into a Reactor (bypassing the append
// door, exactly as phase 2's own rails do) — this file is testing the TRUST MASK, not standing.
// `strikerSeed` signs the NEGATION — the key under test; the claim itself is signed by a fixed,
// irrelevant throwaway seed (entities are unowned, so anyone with write standing may claim one).
const CLAIMANT_SEED = "00".repeat(32);
function plantAndStrike(reactor: Reactor, strikerSeed: string, uniqueTs: number) {
  const claimant = authorForSeed(CLAIMANT_SEED);
  const claim = signClaims(userClaims(`probe-${uniqueTs}`, claimant, uniqueTs), CLAIMANT_SEED);
  const claimResult = reactor.ingest(claim);
  if (claimResult.status !== "accepted") throw new Error("fixture claim refused");
  const strikerKey = authorForSeed(strikerSeed);
  const negation = signClaims(makeNegationClaims(strikerKey, uniqueTs + 1, claim.id), strikerSeed);
  const negResult = reactor.ingest(negation);
  if (negResult.status !== "accepted") throw new Error("fixture negation refused");
  return { claim, negation };
}

describe("A/H — a fresh keypair, local only", () => {
  it("create --operator and assign-role --role=operator both mint a key that never enters the ground", async () => {
    await run(["user", "create", "alice", "--operator", "--home", home], io(), password("pw"));
    const aliceKey = readUserSeed(home, "alice");
    expect(aliceKey.kind).toBe("present");
    const g1 = await ground();
    const leaked = g1.reactor
      .arrivalLog()
      .some((d) => aliceKey.kind === "present" && JSON.stringify(d.claims).includes(aliceKey.seed));
    expect(leaked).toBe(false);
    await g1.close();

    await run(["init", "--home", home], io());
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    const g2 = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
    );
    await g2.append([signClaims(userClaims("bob", operator, 10), seed)]);
    await g2.close();
    await run(["user", "assign-role", "bob", "--role=operator", "--home", home], io());
    const bobKey = readUserSeed(home, "bob");
    expect(bobKey.kind).toBe("present");
  });
});

describe("B — a delegated operator's own grant never widens the trusted set", () => {
  it("alice (granted) grants bob directly — bob's key stays untrusted", async () => {
    await run(["user", "create", "alice", "--operator", "--home", home], io(), password("pw"));
    const g = await ground();
    const aliceSeedRead = readUserSeed(home, "alice");
    const aliceSeed = aliceSeedRead.kind === "present" ? aliceSeedRead.seed : "";
    const aliceKey = authorForSeed(aliceSeed);

    const bobSeed = randomBytes(32).toString("hex");
    const bobKey = authorForSeed(bobSeed);
    // Alice, NOT the store's seed, signs a grant for bob — malformed law is refused for everyone,
    // but this is well-formed (a grant carries exactly one subject and one verb); it is simply not
    // OPERATOR-authored, which is the only thing `lawfulStrikersJson` checks.
    const aliceGrantForBob = signClaims(
      grantClaims(STORE_ENTITY, bobKey, "admin", aliceKey, 100),
      aliceSeed,
    );
    const admitted = g.reactor.ingest(aliceGrantForBob);
    expect(admitted.status).toBe("accepted"); // delta level: it IS in the store

    // Object level: bob's own strike of a probe claim must NOT bind. His only grant is alice's,
    // and alice is not the store's seed — depth is bounded by AUTHORSHIP, not by the chain's length.
    const probe = plantAndStrike(g.reactor, bobSeed, 200);
    expect(dataStruck(g.reactor, g.operator)(probe.claim.id)).toBe(false);
    await g.close();
  });
});

describe("C — two operators are distinguishable in the ground", () => {
  it("their deltas carry different authors, each equal to their own derived key", async () => {
    await run(["init", "--home", home], io());
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    const g0 = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
    );
    await g0.append([
      signClaims(userClaims("alice", operator, 1), seed),
      signClaims(userClaims("bob", operator, 2), seed),
    ]);
    await g0.close();
    await run(["user", "assign-role", "alice", "--role=operator", "--home", home], io());
    await run(["user", "assign-role", "bob", "--role=operator", "--home", home], io());

    const aliceSeedRead = readUserSeed(home, "alice");
    const bobSeedRead = readUserSeed(home, "bob");
    const aliceKey = aliceSeedRead.kind === "present" ? authorForSeed(aliceSeedRead.seed) : "";
    const bobKey = bobSeedRead.kind === "present" ? authorForSeed(bobSeedRead.seed) : "";
    expect(aliceKey).not.toBe("");
    expect(bobKey).not.toBe("");
    expect(aliceKey).not.toBe(bobKey);

    const g = await ground();
    const aliceGrant = g.reactor
      .arrivalLog()
      .find((d) =>
        d.claims.pointers.some(
          (p) =>
            p.role === "subject" && p.target.kind === "primitive" && p.target.value === aliceKey,
        ),
      );
    const bobGrant = g.reactor
      .arrivalLog()
      .find((d) =>
        d.claims.pointers.some(
          (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === bobKey,
        ),
      );
    expect(aliceGrant).toBeDefined();
    expect(bobGrant).toBeDefined();
    expect(aliceGrant!.claims.author).toBe(operator);
    expect(bobGrant!.claims.author).toBe(operator);
    await g.close();
  });
});

describe("D — a granted key's strike resolves for a governed reader; an ungranted key's does not", () => {
  it("two-sided", async () => {
    await run(["user", "create", "alice", "--operator", "--home", home], io(), password("pw"));
    const aliceSeedRead = readUserSeed(home, "alice");
    const aliceSeed = aliceSeedRead.kind === "present" ? aliceSeedRead.seed : "";
    const strangerSeed = randomBytes(32).toString("hex");

    const g1 = await ground();
    const bound = plantAndStrike(g1.reactor, aliceSeed, 10);
    expect(g1.reactor.negationsOf(bound.claim.id)).toContain(bound.negation.id); // delta level
    expect(dataStruck(g1.reactor, g1.operator)(bound.claim.id)).toBe(true); // object level: bound
    await g1.close();

    const g2 = await ground();
    const unbound = plantAndStrike(g2.reactor, strangerSeed, 20);
    expect(g2.reactor.negationsOf(unbound.claim.id)).toContain(unbound.negation.id); // delta level: present
    expect(dataStruck(g2.reactor, g2.operator)(unbound.claim.id)).toBe(false); // object level: inert
    await g2.close();
  });
});

describe("E — the store's own seed stays trusted, before and after a second operator exists", () => {
  it("the operator's own strikes bind identically", async () => {
    const g1 = await (async () => {
      await run(["init", "--home", home], io());
      return ground();
    })();
    const before = plantAndStrike(g1.reactor, readSeed(home), 30);
    expect(dataStruck(g1.reactor, g1.operator)(before.claim.id)).toBe(true);
    await g1.close();

    await run(["user", "create", "carl", "--operator", "--home", home], io(), password("pw"));

    const g2 = await ground();
    const after = plantAndStrike(g2.reactor, readSeed(home), 40);
    expect(dataStruck(g2.reactor, g2.operator)(after.claim.id)).toBe(true);
    await g2.close();
  });
});

describe("F — no on-wire migration is owed: shapes are pinned literals, not self-referential", () => {
  it("roleClaims and grantClaims produce byte-identical output for fixed inputs", () => {
    const FIXED_SEED = "cd".repeat(32);
    const operator = authorForSeed(FIXED_SEED);
    const roleDelta = signClaims(roleClaims("pinuser", "operator", operator, 12345), FIXED_SEED);
    const grantDelta = signClaims(
      grantClaims(STORE_ENTITY, "ed25519:pinned-subject-key", "admin", operator, 12345),
      FIXED_SEED,
    );
    // Pinned against a LITERAL computed once and hard-coded (H10) — never against the function's
    // own answer. A change here means a delta's bytes moved and a §20 migration step is owed.
    expect(roleDelta.id).toBe(
      "1e20fa69af47264786f83c3f00758ff8573c4dde81e122f99d0a4882d3c9268952a7",
    );
    expect(grantDelta.id).toBe(
      "1e20cff97051e6c82ce38eefea410d06f42a7dc5fd7d3fed6264972f99b8609109f4",
    );
  });
});

describe("G — a user with no operator role gets no seed and no grant", () => {
  it("plain create and assign-role --role=actor mint nothing", async () => {
    await run(["user", "create", "dana", "--home", home], io(), password("pw"));
    expect(readUserSeed(home, "dana").kind).toBe("absent");
    const g = await ground();
    const hasSubjectClaim = g.reactor
      .arrivalLog()
      .some((d) => d.claims.pointers.some((p) => p.role === "subject"));
    expect(hasSubjectClaim).toBe(false);
    await g.close();
  });
});

describe("13b — remove-role strikes the grant too: two-sided at the governed-reader level", () => {
  it("the struck user's key stops resolving; a different operator's key still does", async () => {
    await run(["user", "create", "eve", "--operator", "--home", home], io(), password("pw"));
    await run(["user", "create", "finn", "--home", home], io(), password("pw"));
    const g0 = await ground();
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    const finnDelta = signClaims(userClaims("finn2", operator, 5), seed);
    await g0.close();
    const gAppend = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
    );
    await gAppend.append([finnDelta]);
    await gAppend.close();
    await run(["user", "assign-role", "finn", "--role=operator", "--home", home], io());

    const eveSeedRead = readUserSeed(home, "eve");
    const eveSeed = eveSeedRead.kind === "present" ? eveSeedRead.seed : "";
    const finnSeedRead = readUserSeed(home, "finn");
    const finnSeed = finnSeedRead.kind === "present" ? finnSeedRead.seed : "";

    // Both resolve before eve's role is removed.
    const gBefore = await ground();
    const eveProbe = plantAndStrike(gBefore.reactor, eveSeed, 50);
    expect(dataStruck(gBefore.reactor, gBefore.operator)(eveProbe.claim.id)).toBe(true);
    await gBefore.close();

    await run(["user", "remove-role", "eve", "--role=operator", "--home", home], io());

    const gAfter = await ground();
    const eveProbeAfter = plantAndStrike(gAfter.reactor, eveSeed, 60);
    expect(dataStruck(gAfter.reactor, gAfter.operator)(eveProbeAfter.claim.id)).toBe(false); // eve: gone
    const finnProbeAfter = plantAndStrike(gAfter.reactor, finnSeed, 70);
    expect(dataStruck(gAfter.reactor, gAfter.operator)(finnProbeAfter.claim.id)).toBe(true); // finn: unaffected
    await gAfter.close();
  });
});
