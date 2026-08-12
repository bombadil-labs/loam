// T111 — the health surface (SPEC §11 / §29.4) is nameable from the package barrel, on T82's rule:
// the barrel IS the package, so a name absent from `src/index.ts` is a name no consumer can import
// except by a deep `dist/gateway/*.js` path that carries no semver promise. `Gateway.health()` is
// the DOOR; this rail pins that the report it answers — `StoreHealth` and the component shapes it
// is made of (`ErasureHealth`, `SlateHealth`, `ForgivenHealth`) — is public vocabulary, and that
// the plumbing computing it is not.
//
// A NEW file rather than an extension of `test/index-surface.test.ts` or `test/slate-surface.test.ts`,
// deliberately: those are T82's and T109's frozen rails (rails freeze at landing; the CI backstop
// fails any edit), so each surface arrival earns its rails in its own file. Same idiom, same three
// levels:
//   NAME      — the export is present at compile time (these are all types; the negatives check
//               no VALUE rode along).
//   SIGNATURE — the door's signature is EXPRESSIBLE from public names alone, down to each
//               component field. A re-export pointing at the wrong thing passes the name level
//               and fails here.
//   OBJECT    — a store is booted, written, erased, and health-checked through NOTHING but the
//               barrel and the substrate. That is the consumer's actual position.
//
// Deliberately NOT asserted here: the report's semantics — settling arithmetic, the lapsed-slate /
// status separation, the nonSwept disclosure set — are T70/T64/T131's frozen rails' subject. This
// file asks only whether a consumer can NAME what the door answers.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import * as loam from "../src/index.js";
import {
  Gateway,
  MemoryBackend,
  assembleGenesis,
  entityGatherBody,
  type ErasureHealth,
  type ForgivenHealth,
  type SlateHealth,
  type StoreHealth,
} from "../src/index.js";
import { parseSchema } from "@bombadil/rhizomatic";

const OP_SEED = "6c".repeat(32);
const OP = authorForSeed(OP_SEED);
const FERN = "plant:fern";

// --- the SIGNATURE level -------------------------------------------------------------------------
//
// The door, aliased from PUBLIC names only — this compiles exactly when the barrel re-exports the
// same type the method returns, which is the promise, and is not implied by the name being present.

const healthDoor: (gw: Gateway, now?: number) => Promise<StoreHealth> = (gw, now) => gw.health(now);

// Each component shape is reachable from the report by its OWN public name — a barrel that
// exported `StoreHealth` alone would leave `report.slates` a shape no consumer can annotate.
const erasureOf: (report: StoreHealth) => ErasureHealth = (report) => report.erasure;
const slatesOf: (report: StoreHealth) => SlateHealth = (report) => report.slates;
const forgivenOf: (report: StoreHealth) => ForgivenHealth = (report) => report.forgiven;

// --- the world, built from the barrel alone ------------------------------------------------------

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
    // Each name below is exported from its module for one reason — another module in this package
    // reaches it — and every one takes a `Gateway` seam. The door is `Gateway.health()`; publishing
    // a body would freeze a seam as API. And the health names themselves are TYPES: no value may
    // ride along under them.
    const names = Object.keys(loam);
    for (const internal of [
      "healthImpl",
      "outstandingAmong",
      "slateHealth",
      "forgivenHealth",
      "StoreHealth",
      "ErasureHealth",
      "SlateHealth",
      "ForgivenHealth",
    ]) {
      expect(names).not.toContain(internal);
    }
  });

  it("boots, writes, erases, and reads health through the barrel alone", async () => {
    const gw = await boot();

    // A fresh store: every promise vacuously settled, and the report's edges disclosed even here.
    const fresh: StoreHealth = await healthDoor(gw);
    expect(fresh.status).toBe("ok");
    expect(erasureOf(fresh).settled).toBe(true);
    expect(erasureOf(fresh).promised).toBe(0);
    expect(slatesOf(fresh).open).toBe(0);
    expect(forgivenOf(fresh).count).toBe(0);
    expect(fresh.nonSwept.length).toBeGreaterThan(0);

    // Promise an erasure and watch the report count it — the annotated component accessors above
    // only prove their worth on a report with content in every section they name.
    const delta = signClaims(
      {
        timestamp: 1000,
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
    const forgiven: ForgivenHealth = forgivenOf(after);
    expect(forgiven.present).toBe(0);
    expect(forgiven.unreadable).toEqual([]);
    expect(after.status).toBe("ok");

    await gw.close();
  });
});
