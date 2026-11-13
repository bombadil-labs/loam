import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import * as loam from "../src/index.js";
import {
  Gateway,
  MemoryBackend,
  assembleGenesis,
  entityGatherBody,
  type ErasureHealth,
  type NegatedHealth,
  type SlateHealth,
  type StoreHealth,
} from "../src/index.js";
import { parseSchema } from "@bombadil/rhizomatic";

const OP_SEED = "6c".repeat(32);
const OP = authorForSeed(OP_SEED);
const FERN = "plant:fern";

const healthDoor: (gw: Gateway, now?: number) => Promise<StoreHealth> = (gw, now) => gw.health(now);

const erasureOf: (report: StoreHealth) => ErasureHealth = (report) => report.erasure;
const slatesOf: (report: StoreHealth) => SlateHealth = (report) => report.slates;
const forgivenOf: (report: StoreHealth) => NegatedHealth = (report) => report.negated;

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        {
          hyperschema: { name: "Plant", alg: 1, body: entityGatherBody() },
          schema: parseSchema({
            props: { height: { pick: { order: { byTimestamp: "desc" } } } },
            default: { pick: { order: { byTimestamp: "desc" } } },
          }),
          roots: [FERN],
          writable: ["height"],
        },
      ],
    }),
  );

describe("T111 — the health report is nameable from the package barrel", () => {
  it("does NOT export the plumbing behind the door", () => {
    const names = Object.keys(loam);
    for (const internal of [
      "healthImpl",
      "outstandingAmong",
      "slateHealth",
      "negatedHealth",
      "StoreHealth",
      "ErasureHealth",
      "SlateHealth",
      "NegatedHealth",
    ]) {
      expect(names).not.toContain(internal);
    }
  });

  it("boots, writes, erases, and reads health through the barrel alone", async () => {
    const gw = await boot();

    const fresh: StoreHealth = await healthDoor(gw);
    expect(fresh.status).toBe("ok");
    expect(erasureOf(fresh).settled).toBe(true);
    expect(erasureOf(fresh).promised).toBe(0);
    expect(slatesOf(fresh).open).toBe(0);
    expect(forgivenOf(fresh).count).toBe(0);
    expect(fresh.nonSwept.length).toBeGreaterThan(0);

    const delta = signClaims(
      {
        timestamp: 1000,
        validFrom: 1000,
        author: OP,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "height" } } },
          { role: "value", target: { kind: "primitive", value: 30 } },
        ],
      },
      OP_SEED,
    );
    await gw.append([delta]);
    await gw.erase(delta.id, { reason: "t111 rail" });

    const after: StoreHealth = await healthDoor(gw, Date.now());
    const erasure: ErasureHealth = erasureOf(after);
    expect(erasure.promised).toBe(1);
    expect(erasure.settled).toBe(true);
    expect(erasure.outstanding).toEqual([]);
    expect(erasure.unproven).toBe(false);
    const slates: SlateHealth = slatesOf(after);
    expect(slates.lapsed).toBe(0);
    expect(slates.lapsedIds).toEqual([]);
    const negated: NegatedHealth = forgivenOf(after);
    expect(negated.present).toBe(0);
    expect(negated.unreadable).toEqual([]);
    expect(after.status).toBe("ok");

    await gw.close();
  });
});
