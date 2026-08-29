// SPEC §49 criterion (e) — the soup meter (T212; .adlc/specs/49-legibility.md, settled
// 2026-08-28). Two-sided by construction: a metronomic writer is NAMED, an organic writer is
// NOT, and the meter never gates — the flagged writer's next append still lands, asserted at
// the door, because a heuristic that blocks writes will one day block a true fact.
//
// STATED, NOT ASSERTED: the metronome detector reads `claims.timestamp`, the author's own
// clock. A pulse-writer that jitters its stamps on purpose evades the meter; the meter reports
// probable violations for a human to ticket, and an adversarial writer is out of its scope by
// design (the spec's word: it reports, tickets follow).

import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { describe, expect, it } from "vitest";
import { grantClaims } from "../../src/gateway/accounts.js";
import { soupMeterImpl } from "../../src/gateway/soup-meter.js";
import { containerClaims } from "../../src/gateway/container.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const PULSE_SEED = "1a".repeat(32);
const PULSE = authorForSeed(PULSE_SEED);
const ORGANIC_SEED = "1b".repeat(32);
const ORGANIC = authorForSeed(ORGANIC_SEED);

const authoredBy = (publicKey: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: publicKey } },
  in: "input",
});

const claim = (author: string, seed: string, entity: string, t: number) =>
  signClaims(
    {
      timestamp: t,
      author,
      pointers: [
        { role: "reading", target: { kind: "entity", entity: { id: entity, context: "sensor" } } },
        { role: "value", target: { kind: "primitive", value: t % 97 } },
      ],
    } as never,
    seed,
  );

async function store(member: string): Promise<Gateway> {
  const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let t = 100;
  await gw.append([
    signClaims(grantClaims(STORE_ENTITY, PULSE, "write", OPERATOR, ++t), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, ORGANIC, "write", OPERATOR, ++t), OPERATOR_SEED),
    signClaims(
      containerClaims(
        { container: "inbox", trust: "curated", posture: "shared", membership: authoredBy(member) },
        OPERATOR,
        ++t,
      ),
      OPERATOR_SEED,
    ),
  ]);
  return gw;
}

describe("§49(e) — the soup meter names the metronome and spares the organic", () => {
  it("a same-author same-entity stream on a fixed interval is named as periodic-shaped", async () => {
    const gw = await store(PULSE);
    // Twelve claims, exactly one hour apart, same author, same entity: the pulse-law shape.
    for (let i = 0; i < 12; i++) {
      await gw.append([claim(PULSE, PULSE_SEED, "probe:health", 10_000 + i * 3_600_000)]);
    }
    const report = soupMeterImpl(gw);
    const inbox = report.get("inbox");
    expect(inbox).toBeDefined();
    expect(inbox!.total).toBe(12);
    expect(inbox!.periodicShare).toBeGreaterThan(0.9);
    const flagged = inbox!.periodic.find((p) => p.author === PULSE && p.entity === "probe:health");
    expect(flagged, "the metronomic stream is not named").toBeDefined();
    expect(flagged!.count).toBe(12);
  });

  it("an organic writer — bursts and gaps — is NOT named; a clean result is the valid result", async () => {
    const gw = await store(ORGANIC);
    // Twelve claims in human rhythm: a morning burst, an afternoon straggler, two days of
    // silence, an evening burst. Same author, same entity — only the CLOCK separates this
    // from the metronome, which is exactly the discriminator under test.
    const moments = [
      10_000, 12_000, 13_500, 610_000, 14_400_000, 187_200_000, 187_205_000, 187_206_100,
      190_800_000, 350_000_000, 350_000_400, 353_600_000,
    ];
    for (const t of moments) await gw.append([claim(ORGANIC, ORGANIC_SEED, "note:mine", t)]);
    const report = soupMeterImpl(gw);
    const inbox = report.get("inbox");
    expect(inbox).toBeDefined();
    expect(inbox!.total).toBe(12);
    expect(inbox!.periodic).toEqual([]);
    expect(inbox!.periodicShare).toBe(0);
  });

  it("the meter NEVER gates: a flagged writer's next append lands exactly like any other", async () => {
    const gw = await store(PULSE);
    for (let i = 0; i < 12; i++) {
      await gw.append([claim(PULSE, PULSE_SEED, "probe:health", 10_000 + i * 3_600_000)]);
    }
    expect(soupMeterImpl(gw).get("inbox")!.periodic.length).toBeGreaterThan(0);
    // The flagged author writes again, straight through the ordinary governed door.
    const sizeBefore = gw.reactor.size;
    await gw.append([claim(PULSE, PULSE_SEED, "probe:health", 13 * 3_600_000 + 10_000)]);
    expect(gw.reactor.size).toBe(sizeBefore + 1);
  });

  it("fewer claims than the metronome needs stay unflagged: five ticks are rhythm, not verdict", async () => {
    const gw = await store(PULSE);
    for (let i = 0; i < 5; i++) {
      await gw.append([claim(PULSE, PULSE_SEED, "probe:health", 10_000 + i * 3_600_000)]);
    }
    const inbox = soupMeterImpl(gw).get("inbox");
    expect(inbox!.total).toBe(5);
    expect(inbox!.periodic).toEqual([]);
  });
});
