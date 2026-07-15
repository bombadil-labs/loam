// Promotion — promote-outputs (SPEC §24.3), the first CONTAINER operation of §27: the operator adopts a
// delta a quarantine produced by RE-SPEAKING its content as their own claim into the primary, carrying
// `loam.adoption` provenance back to the pool. The value crosses by re-assertion (authored fresh, not
// federated), so the pool can be dropped wholesale and the adopted value survives in the operator's voice —
// and its origin is kept FOREVER, which is what makes fork/pull-request native. These suites prove: the
// adopted value lands and resolves in the primary under the operator; it survives dropping the pool; the
// provenance trail is readable; and a promotion whose reference would dangle is refused (reference closure).

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { isAdoption } from "../../src/gateway/adopt.js";
import { PLANT } from "./fixtures.js";
import { FERN } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const GUEST_SEED = "9d".repeat(32); // a stranger whose fact runs in the quarantine
const GUEST = authorForSeed(GUEST_SEED);
const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const SCHEMA: Schema = { props: new Map<string, Policy>([["message", pick]]), default: pick };

// A foreign fact about FERN's `message`, authored by a STRANGER — the kind of output a quarantined app
// produces: present in the pool, inert (binds nothing, §8), until the operator adopts it.
const foreignFact = (value: string, ts: number) =>
  signClaims(
    {
      timestamp: ts,
      author: GUEST,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "message" } } },
        { role: "value", target: { kind: "primitive", value } },
      ],
    },
    GUEST_SEED,
  );

const bootPrimary = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["message"] }],
    }),
  );

const messageOf = async (gw: Gateway): Promise<unknown> => {
  const res = await gw.query(`{ plant(entity: "${FERN}") { message } }`);
  return (res.data as { plant?: { message?: unknown } } | undefined)?.plant?.message;
};

describe("§24.3 promote-outputs — adopt a quarantine's output as the operator's own claim", () => {
  it("promotes a stranger's pool fact into the primary, re-signed by the operator, and it resolves there", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const fact = foreignFact("the stranger's app said this", 3000);
    await q.gateway.federate([fact]); // the stranger's output, present in the pool (inert there)
    expect(await messageOf(primary)).toBeNull(); // the primary has NOT seen it — it's sequestered

    const { promoted } = await primary.promote(q.gateway, fact.id, { from: "trial-pool" });

    // The re-signed content now lives in the primary, authored by the OPERATOR (clean — no provenance
    // pollution), and resolves as itself. The provenance rides a SEPARATE adoption record pointing at it.
    const adopted = primary.reactor.get(promoted);
    expect(adopted?.claims.author).toBe(OP);
    expect(isAdoption(adopted!.claims)).toBe(false); // the content delta is clean
    expect(primary.adoptions().some((a) => a.adoptedDelta === promoted)).toBe(true); // the record points at it
    expect(await messageOf(primary)).toBe("the stranger's app said this");
    await q.drop();
    await primary.close();
  });

  it("keeps the provenance trail — where it came from, who made it, who blessed it (§24.3 / §27)", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const fact = foreignFact("provenance survives", 3100);
    await q.gateway.federate([fact]);
    await primary.promote(q.gateway, fact.id, { from: "trial-pool" });

    const trail = primary.adoptions();
    expect(trail).toHaveLength(1);
    expect(trail[0]!.from).toBe("trial-pool");
    expect(trail[0]!.sourceDelta).toBe(fact.id); // WHAT was adopted
    expect(trail[0]!.producedBy).toBe(GUEST); // WHO made the output (the granted author it wrote under)
    expect(trail[0]!.adoptedBy).toBe(OP); // WHO blessed it
    await q.drop();
    await primary.close();
  });

  it("the adopted value SURVIVES dropping the pool — it crossed by re-assertion, not federation", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    const fact = foreignFact("this outlives the sandbox", 3200);
    await q.gateway.federate([fact]);
    await primary.promote(q.gateway, fact.id, { from: "trial-pool" });
    await q.drop(); // discard the whole quarantine
    expect(await messageOf(primary)).toBe("this outlives the sandbox"); // still standing, in the operator's voice
    await primary.close();
  });

  it("refuses a promotion whose reference would DANGLE in the primary (reference closure, §27)", async () => {
    const primary = await bootPrimary();
    const q = await primary.openQuarantine();
    // A pool delta that cites another delta the primary does not hold — promoting it would dangle.
    const dangling = signClaims(
      {
        timestamp: 3300,
        author: GUEST,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "message" } } },
          {
            role: "cites",
            target: { kind: "delta", deltaRef: { delta: "delta:not-in-the-primary" } },
          },
        ],
      },
      GUEST_SEED,
    );
    await q.gateway.federate([dangling]);
    await expect(primary.promote(q.gateway, dangling.id, { from: "trial-pool" })).rejects.toThrow(
      /dangle/,
    );
    await q.drop();
    await primary.close();
  });
});
