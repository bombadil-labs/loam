// T105 (a) — the ESM residency disclosure: health() AND the compliance receipt name the tier
// the byte probes cannot ask. This is the honesty half of §32's one standing R1 violation — a
// compiled module stays executable in this process's ESM registry after its source delta is
// erased, and no tier probe can see it — so the settled verdict must not read as exhaustive.
// Both surfaces spread ONE constant (ESM_RESIDENCY_DISCLOSURE), the T131 one-source doctrine,
// so they cannot drift; these rails assert each surface LIVE. The teardown half is T105 (b).

import { describe, expect, it } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { BEFORE_DEADLINE, OP_SEED, bootSlateStore, standSlate } from "./slating.js";

describe("T105 (a) — the ESM registry is named as the tier erasure cannot prove", () => {
  it("health() discloses loaded-module residency on every report", async () => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
    const list = (await gw.health()).nonSwept ?? [];
    expect(list.some((line) => line.includes("ESM RESIDENCY"))).toBe(true);
    expect(
      list.some((line) => line.includes("ESM RESIDENCY") && /UNPROVEN|NOT SWEPT/i.test(line)),
    ).toBe(true);
    await gw.close();
  });

  it("the compliance receipt carries the same disclosure beside its verdicts", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    expect(receipt.nonClaim.some((line) => line.includes("ESM RESIDENCY"))).toBe(true);
    expect(
      receipt.nonClaim.some((line) => line.includes("ESM RESIDENCY") && line.includes("UNPROVEN")),
    ).toBe(true);
  });
});
