// Records Loam's time-dependent decisions before step 3 changes the time model: a latest-wins
// tie, a deadline boundary, and the author timestamp across a process restart.
// Scope: `readLookedImpl` runs over a reactor built by raw ingest; the restart case boots real
// gateways over one memory backend with a pinned clock.

import { afterEach, describe, it, vi } from "vitest";
import type { Delta } from "@bombadil/rhizomatic";
import { lookedClaims, readLookedImpl } from "../../src/gateway/attention.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { containerClaims } from "../../src/gateway/container.js";
import { readSlates, slateClaims } from "../../src/gateway/slate.js";
import { MemoryBackend } from "../../src/store/memory.js";
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
          { reactor, operatorAuthor: KEY.operator } as unknown as Gateway,
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
          readSlates(reactor, KEY.operator, now),
        ]),
      ),
    );
  });

  it("the author timestamp across a restart with the clock set back", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const backend = new MemoryBackend();
    const genesis = assembleGenesis({ operatorSeed: SEEDS.operator, registrations: [] });
    vi.setSystemTime(10_000);
    const first = await Gateway.boot(backend, genesis);
    const before = [first.nextTimestamp(), first.nextTimestamp(), first.nextTimestamp()];
    vi.setSystemTime(5_000); // the host clock steps back before the process restarts
    const second = await Gateway.open(backend, { seed: SEEDS.operator });
    const after = [second.nextTimestamp(), second.nextTimestamp()];
    await record("time.restart", { before, after, afterSortsBeforeBefore: after[0]! < before[2]! });
  });
});
