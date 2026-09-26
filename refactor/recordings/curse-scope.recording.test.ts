// Records the scope of a channel curse before step 6 decides it. `curseChannelLaw` strikes the
// cursed lens's live registration bindings in the channel's POOL, and it also searches the ROOT
// ground for a live binding under the same lens name, so an older store's pre-pool blessings are
// reached. The root search does not ask where a root binding came from. The question for step 6:
// does a curse on a channel strike an independent root registration that only shares the name?
//
// Cast: `peer` is alice, a real gateway that publishes the lens `Plant` and the tag "alice's tag"
// on the fern. `operator` is this store; it opens the channel `friends` with prefix `alice`, so the
// pool serves the lens `alice:Plant`. In the root, the operator writes the tag "root tag" on the
// fern. `tag` resolves with `all`, so a query shows every ground the answering lens reads.
//
// Recorded (`curse-scope.cases`), per case, before and after the curse:
// - delta level: every registration binding in the pool and in the root, as location + lens name +
//   live or struck, and the negations that the curse added in each ground. Ids are not recorded:
//   a binding id hashes the gateway clock, so the projection keeps the goldens stable.
// - served level: the root surface's rows, as lens name + the ground the row came from + its
//   hyperschema entity, whether `def` resolves each lens of interest, and
//   the GraphQL answer for `alice_Plant` and for the control lens.
// - the curse call's outcome: resolved, or the text of its refusal.
//
// Cases: (a) the pool lens alone; (b) the same plus an independent root registration published by
// the operator under the name `alice:Plant`, before the channel opens and after it syncs; (c) a
// root registration under the different name `Sprout`, the control bystander.
//
// Deliberately not recorded: the lift (`{ lift: true }`), the standing sync's re-blessing after a
// curse, a bound connection's container surface, and a store whose bindings predate the pool
// move. The clock is a counter: each `Date.now()` call returns the next integer from a fixed start,
// so the run is repeatable. A frozen clock does not work here: with every timestamp equal, the sync
// parks the lens ("persisted but does not serve") and nothing is blessed.

import { afterEach, describe, it, vi } from "vitest";
import type { Delta, Reactor } from "@bombadil/rhizomatic";
import { isRegistrationBinding } from "../../src/gateway/adopt-law.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { lensOf } from "../../src/gateway/registration.js";
import { negatedAt } from "../../src/gateway/negation.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../../test/spike/garden.js";
import { PLANT, PLANT_POLICY } from "../../test/gateway/fixtures.js";
import { KEY, record, SEEDS } from "./corpus.js";

const NOW = 2_000_000;

afterEach(() => {
  vi.restoreAllMocks();
});

const SPROUT = { name: "Sprout", alg: 1, body: PLANT.body } as const;
const LENSES = ["alice:Plant", "Sprout"] as const;

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
  );
}

const lensAt = (d: Delta): string | undefined => {
  const p = d.claims.pointers.find((pt) => pt.role === "schema");
  if (p?.target.kind !== "entity") return undefined;
  const id = p.target.entity.id;
  return id.startsWith("schema:") ? id.slice("schema:".length) : id;
};

/** Every registration binding in `reactor`, as lens name + live or struck (by an operator
 * negation that survives), sorted. */
function bindings(reactor: Reactor): string[] {
  const struck = negatedAt(reactor, NOW, KEY.operator);
  return [...reactor.snapshot()]
    .filter((d) => isRegistrationBinding(d.claims))
    .map((d) => `${lensAt(d)}: ${struck(d.id) ? "struck" : "live"}`)
    .sort();
}

/** The negations in `reactor` that strike a registration binding, as the struck binding's lens. */
function strikes(reactor: Reactor): string[] {
  const byId = new Map([...reactor.snapshot()].map((d) => [d.id, d]));
  const out: string[] = [];
  for (const d of reactor.snapshot()) {
    if (!isRegistrationBinding(d.claims)) continue;
    for (const n of reactor.negationsOf(d.id)) {
      if (byId.has(n)) out.push(`negation of ${lensAt(d)}`);
    }
  }
  return out.sort();
}

async function observe(gw: Gateway, channel: string) {
  const pool = gw.channelPools.get(channel)?.gateway;
  const served = (name: string): boolean => {
    try {
      gw.def(name);
      return true;
    } catch {
      return false;
    }
  };
  const ask = async (field: string) => {
    try {
      const r = await gw.query(`{ ${field}(entity: "${FERN}") { tag } }`);
      return r.errors === undefined ? r.data : { errors: r.errors };
    } catch (e) {
      return { thrown: (e as Error).message };
    }
  };
  return {
    delta: {
      pool: pool === undefined ? "no pool" : bindings(pool.reactor),
      root: bindings(gw.reactor),
      "pool strikes": pool === undefined ? "no pool" : strikes(pool.reactor),
      "root strikes": strikes(gw.reactor),
    },
    served: {
      "root surface": gw.registered
        .map((r) => `${lensOf(r)} from ${r.channel === undefined ? "root" : "pool"} (${r.entity})`)
        .sort(),
      def: Object.fromEntries(LENSES.map((l) => [l, served(l)])),
      "alice_Plant query": await ask("alice_Plant"),
      "sprout query": await ask("sprout"),
    },
  };
}

type Bystander = "none" | "same name, before open" | "same name, after sync" | "other name";

async function run(bystander: Bystander) {
  let tick = NOW;
  vi.spyOn(Date, "now").mockImplementation(() => tick++);
  const alice = await store(SEEDS.peer);
  const me = await store(SEEDS.operator);
  try {
    await alice.append([observed(FERN, "tag", "alice's tag", 100, SEEDS.peer)]);
    await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    await me.append([observed(FERN, "tag", "root tag", 101, SEEDS.operator)]);

    const rootBystander = async (): Promise<string> => {
      try {
        if (bystander === "other name") {
          await me.publishRegistration(SPROUT, PLANT_POLICY, [FERN]);
        } else {
          await me.publishRegistration(
            PLANT,
            { ...PLANT_POLICY, name: "alice:Plant" },
            [FERN],
            undefined,
            "hyperschema:RootPlant",
          );
        }
        return "published";
      } catch (e) {
        return `refused: ${(e as Error).message}`;
      }
    };

    const out: Record<string, unknown> = {};
    if (bystander === "same name, before open") out["root publish"] = await rootBystander();
    const ch = await me.openChannel({
      into: "friends",
      prefix: "alice",
      source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
    });
    const synced = await ch.sync();
    out.sync = { bound: synced.bound, parked: synced.parked };
    if (bystander === "same name, after sync" || bystander === "other name") {
      out["root publish"] = await rootBystander();
    }
    out.before = await observe(me, ch.name);
    try {
      await me.curseChannelLaw(ch.name, "alice:Plant");
      out.curse = "resolved";
    } catch (e) {
      out.curse = `refused: ${(e as Error).message}`;
    }
    out.after = await observe(me, ch.name);
    return out;
  } finally {
    await alice.close();
    await me.close();
  }
}

describe("recordings: curse scope", () => {
  it("a channel curse, with and without a root bystander", async () => {
    await record("curse-scope.cases", {
      "a. pool lens only": await run("none"),
      "b1. root registration of the same name, published before the channel opens":
        await run("same name, before open"),
      "b2. root registration of the same name, published after the channel syncs":
        await run("same name, after sync"),
      "c. root registration of another name (control)": await run("other name"),
    });
  });
});
