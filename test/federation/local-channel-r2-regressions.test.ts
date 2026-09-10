import { describe, expect, it } from "vitest";
import { makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { localChannelEvidence } from "../../src/federation/local-channel-events.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const SEED = "cc".repeat(32);
const inContext = (d: Delta, context: string) =>
  d.claims.pointers.some((p) => p.target.kind === "entity" && p.target.entity.context === context);

describe("T288 R2 regression controls", () => {
  it.each(["attachment", "status"])(
    "retry after failed %s never promotes a partial opening",
    async (fault) => {
      class Primary extends MemoryBackend {
        failStatus = fault === "status";
        override async append(deltas: Iterable<Delta>): Promise<number> {
          const batch = [...deltas];
          if (this.failStatus && batch.some((d) => inContext(d, "loam.channel"))) {
            this.failStatus = false;
            throw new Error("fixture status failure");
          }
          return super.append(batch);
        }
      }
      let failAttachment = fault === "attachment";
      const gw = await Gateway.boot(
        new Primary(),
        assembleGenesis({ operatorSeed: SEED, registrations: [] }),
        {
          channelBackend: () => {
            if (failAttachment) {
              failAttachment = false;
              throw new Error("fixture attachment failure");
            }
            return new MemoryBackend();
          },
        },
      );
      const opts = { into: "friends", prefix: "peer", source: { pull: () => Promise.resolve([]) } };
      const name = "channel:friends:peer";
      try {
        await expect(gw.openChannel(opts)).rejects.toThrow(`fixture ${fault} failure`);
        const declarations = [...gw.reactor.snapshot()].filter((d) =>
          d.claims.pointers.some(
            (p) =>
              p.target.kind === "entity" &&
              p.target.entity.context === "loam.container" &&
              p.target.entity.id === name,
          ),
        );
        expect(declarations).toHaveLength(1);
        // Legacy retry may return or refuse, but cannot manufacture protected authority.
        await gw.openChannel(opts).catch(() => undefined);
        expect(localChannelEvidence(gw, name).state).not.toBe("open");
        expect(
          [...gw.reactor.snapshot()].filter((d) => inContext(d, "loam.local.channel.event")),
        ).toEqual([]);
      } finally {
        await gw.close();
      }
    },
  );

  it("reserved forgiveness corrupts otherwise usable receipt-erasure history", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: SEED, registrations: [] }),
      {
        channelBackend: () => new MemoryBackend(),
      },
    );
    try {
      const source = observed(FERN, "height", 1, 1001, "a1".repeat(32));
      const ch = await gw.openChannel({
        into: "friends",
        prefix: "peer",
        source: { pull: () => Promise.resolve([source]) },
      });
      await ch.sync();
      const receipt = [...gw.reactor.snapshot()].find(
        (d) =>
          inContext(d, "loam.local.channel.event") &&
          d.claims.pointers.some(
            (p) =>
              p.role === "action" && p.target.kind === "primitive" && p.target.value === "received",
          ),
      )!;
      expect(receipt).toBeDefined();
      const erased = await gw.erase(receipt.id);
      const baseline = localChannelEvidence(gw, ch.name);
      expect(baseline.state).toBe("open");
      if (baseline.state === "open") expect(baseline.received).toEqual([]);
      const claims = makeNegationClaims(gw.operatorAuthor!, gw.nextTimestamp(), erased.tombstone);
      const unsupported = signClaims(
        {
          ...claims,
          pointers: [
            ...claims.pointers,
            {
              role: "local-control",
              target: {
                kind: "entity",
                entity: { id: receipt.id, context: "loam.local.channel.control" },
              },
            },
            { role: "local-control-version", target: { kind: "primitive", value: 1 } },
            { role: "local-control-kind", target: { kind: "primitive", value: "forgive" } },
          ],
        },
        SEED,
      );
      // Trusted corrupted restore, deliberately outside guarded federation.
      await gw.backend.append([unsupported]);
      gw.reactor.ingest(unsupported);
      expect(localChannelEvidence(gw, ch.name)).toEqual({
        state: "unavailable",
        reason: "unsupported or malformed local control history",
      });
    } finally {
      await gw.close();
    }
  });
});
