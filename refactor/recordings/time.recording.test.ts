// Records Loam's time-dependent decisions before step 3 changes the time model: a latest-wins
// tie, a deadline boundary, and the author timestamp across a process restart.
// Scope: `readLookedImpl` runs over a reactor built by raw ingest; the restart case boots real
// gateways over one memory backend with a pinned clock.

import { afterEach, describe, it, vi } from "vitest";
import { signClaims, type Delta } from "@bombadil/rhizomatic";
import { lookedClaims, readLookedImpl } from "../../src/gateway/attention.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { containerClaims } from "../../src/gateway/container.js";
import { readSlates, slateClaims } from "../../src/gateway/slate.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { channelRecordClaims, channelStatusImpl } from "../../src/federation/channel.js";
import { bothOrders, KEY, reactorOf, record, SEEDS, signed } from "./corpus.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("recordings: time", () => {
  it("a latest-wins tie on equal timestamps, in both ingest orders", async () => {
    // Two looked-markers for one key at the same timestamp. `latestByKey` keeps the first it sees
    // in the reactor's by-target index, so the winner is the same in both ingest orders.
    const a = signed(lookedClaims("ada", "home", 111, KEY.operator, 50), "operator", "looked/111");
    const b = signed(lookedClaims("ada", "home", 222, KEY.operator, 50), "operator", "looked/222");
    const later = signed(
      lookedClaims("ada", "home", 333, KEY.operator, 51),
      "operator",
      "looked/333",
    );
    const read = (deltas: readonly Delta[]) =>
      bothOrders(deltas, (reactor) =>
        readLookedImpl(
          {
            reactor,
            operatorAuthor: KEY.operator,
            validityNow: () => Date.now(),
          } as unknown as Gateway,
          "ada",
          new Set([KEY.operator]),
          ["home"],
        ),
      );
    await record("time.latest-tie", {
      "tie only": read([a, b]),
      "tie then a later marker": read([a, b, later]),
    });
  });

  it("the channel status reader on a timestamp tie, in both ingest orders", async () => {
    // Two records for one channel at the same timestamp. The reader walks `snapshot()`, which
    // iterates in arrival order, and keeps the first record on a tie.
    const status = (receiving: boolean) => ({
      name: "garden",
      into: "home",
      prefix: "garden",
      receiving,
      blessing: true,
      lastSyncedAt: 0,
      consecutiveFailures: 0,
      from: "",
      unattested: [],
      unreadable: [],
    });
    const on = signed(
      channelRecordClaims(status(true), KEY.operator, 70),
      "operator",
      "channel/on",
    );
    const off = signed(
      channelRecordClaims(status(false), KEY.operator, 70),
      "operator",
      "channel/off",
    );
    await record(
      "time.channel-tie",
      bothOrders([on, off], (reactor) =>
        channelStatusImpl(
          {
            reactor,
            operatorAuthor: KEY.operator,
            validityNow: () => Date.now(),
          } as unknown as Gateway,
          "garden",
        ).map((c) => ({ name: c.name, receiving: c.receiving })),
      ),
    );
  });

  it("a slate's deadline at T-1, T and T+1", async () => {
    const deadline = 1_000_000;
    const slate = signed(
      slateClaims(
        {
          container: "slate:one",
          membershipAt: "term:frozen",
          version: "version:one",
          requestedBy: "subject-1",
          requestedByForm: "plain",
          requestedAt: 900_000,
          deadline,
          closes: ["egress"],
        },
        KEY.operator,
        60,
      ),
      "operator",
      "slate/one",
    );
    // The container must be declared, or the reader skips the slate. Its frozen Term is never
    // published, so the slate reads as unresolved; the deadline boundary does not depend on it.
    const container = signed(
      containerClaims(
        {
          container: "slate:one",
          trust: "curated",
          posture: "shared",
          membershipAt: "term:frozen",
          version: "version:one",
        },
        KEY.operator,
        59,
      ),
      "operator",
      "container/slate-one",
    );
    const reactor = reactorOf([container, slate]);
    await record(
      "time.deadline",
      Object.fromEntries(
        [deadline - 1, deadline, deadline + 1].map((now) => [
          `now = deadline ${now - deadline >= 0 ? "+" : ""}${now - deadline}`,
          readSlates(reactor, Date.now(), KEY.operator, now),
        ]),
      ),
    );
  });

  it("the author timestamp across a restart with the clock set back", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const backend = new MemoryBackend();
    const genesis = assembleGenesis({ operatorSeed: SEEDS.operator, registrations: [] });
    // Each stamp is written, so the restarted process has the store's history to read.
    const write = async (gw: Gateway): Promise<number> => {
      const s = gw.stamp();
      const claims = {
        ...s,
        author: KEY.operator,
        pointers: [{ role: "tick", target: { kind: "primitive" as const, value: s.timestamp } }],
      };
      await gw.append([signClaims(claims, SEEDS.operator)]);
      return s.timestamp;
    };
    vi.setSystemTime(10_000);
    const first = await Gateway.boot(backend, genesis);
    const before = [await write(first), await write(first), await write(first)];
    vi.setSystemTime(5_000); // the host clock steps back before the process restarts
    const second = await Gateway.open(backend, { seed: SEEDS.operator });
    const after = [await write(second), await write(second)];
    await record("time.restart", { before, after, afterSortsBeforeBefore: after[0]! < before[2]! });
  });
});
