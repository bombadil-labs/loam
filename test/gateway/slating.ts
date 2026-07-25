// The T64 suite's shared world: a governed Plant store, and one function that stands a real slate.
//
// A slate is TWO deltas over a T32 property container, and the ORDER is part of what is under test,
// so `standSlate` performs it the way the door demands rather than short-cutting: publish the frozen
// membership Term, declare the container citing it by address WITH the ModuleVersion address the
// Term freezes to, and only then land the `loam.erasure.slate` record — which is the batch the
// posture/trust refusal and the frozen-membership agreement check both read.

import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  containerClaims,
  termClaims,
  type ContainerPosture,
  type ContainerTrust,
} from "../../src/gateway/container.js";
import { frozenMembershipTerm, slateClaims, type SlateClosure } from "../../src/gateway/slate.js";
import { MemoryBackend } from "../../src/store/memory.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

export const OP_SEED = "6c".repeat(32);
export const OP = authorForSeed(OP_SEED);

// WALL-CLOCK moments the rails pass explicitly — never `Date.now()`, never a race (the flaky-test
// rule). The default deadline sits FAR IN THE FUTURE on purpose: a door reached without an explicit
// moment reads its own clock, so a fixture deadline in the past would make every unpinned read in
// this suite depend on the day it runs. LAPSED_DEADLINE is the past one, used only where the lapse
// itself is the subject and the rail passes `now` by hand.
export const DEADLINE = 4_070_908_800_000; // 2099-01-01
export const BEFORE_DEADLINE = DEADLINE - 600_000;
export const AFTER_DEADLINE = DEADLINE + 600_000;
export const LAPSED_DEADLINE = 1_700_000_000_000; // 2023-11-14
export const REQUESTED_AT = DEADLINE - 86_400_000;

export const bootSlateStore = (backend: StoreBackend = new MemoryBackend()): Promise<Gateway> =>
  Gateway.boot(
    backend,
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

export const declareContainer = (spec: Parameters<typeof containerClaims>[0], ts: number): Delta =>
  signClaims(containerClaims(spec, OP, ts), OP_SEED);

export interface StoodSlate {
  readonly container: string;
  readonly record: string;
  readonly version: string;
  readonly membershipAt: string;
  readonly term: unknown;
  readonly declaration: string;
}

export interface SlateFixture {
  readonly container?: string;
  /** The condemned deltas — their ids become the extensional frozen membership. */
  readonly members: readonly Delta[];
  readonly closes: readonly SlateClosure[];
  readonly deadline?: number;
  readonly requestedAt?: number;
  readonly requestedBy?: string;
  readonly requestedByForm?: "plain" | "sealed";
  readonly reason?: string;
  readonly acceptsIncomplete?: readonly string[];
  readonly trust?: ContainerTrust;
  readonly posture?: ContainerPosture;
  readonly ts?: number;
  /** Omit the `version` role, to drive the frozen-by-enforcement refusal. */
  readonly omitVersion?: boolean;
  /** Declare a `version` that the membership Term does NOT freeze to. */
  readonly wrongVersion?: string;
  /** Cite a `membershipAt` address nothing publishes — the dangling-dependency refusal. */
  readonly danglingMembership?: boolean;
}

/**
 * Stand a real slate over `members`. Returns the addresses the rails assert against. Every append
 * goes through the ordinary door, so a fixture that the door would refuse throws here — which is
 * exactly what the refusal rails want.
 */
export async function standSlate(gw: Gateway, spec: SlateFixture): Promise<StoodSlate> {
  const container = spec.container ?? "container:slate:subject-42";
  const ts = spec.ts ?? 50_000;
  const term = frozenMembershipTerm(spec.members.map((d) => d.id));
  const published = signClaims(termClaims(term, OP, ts), OP_SEED);
  await gw.append([published]);
  // The version is `Gateway.freeze` over the same Term — the ONE address the door's agreement check,
  // the cut's pre-flight, and the graveyard's frozen set all mean.
  const version = spec.wrongVersion ?? gw.freeze(term).id;
  const membershipAt = spec.danglingMembership ? `${published.id.slice(0, -4)}dead` : published.id;
  const declaration = declareContainer(
    {
      container,
      trust: spec.trust ?? "curated",
      posture: spec.posture ?? "property",
      membershipAt,
      ...(spec.omitVersion === true ? {} : { version }),
    },
    ts + 1,
  );
  await gw.append([declaration]);
  const record = signClaims(
    slateClaims(
      {
        container,
        requestedBy: spec.requestedBy ?? "subject:42",
        requestedByForm: spec.requestedByForm ?? "plain",
        requestedAt: spec.requestedAt ?? REQUESTED_AT,
        deadline: spec.deadline ?? DEADLINE,
        closes: spec.closes,
        ...(spec.reason === undefined ? {} : { reason: spec.reason }),
        ...(spec.acceptsIncomplete === undefined
          ? {}
          : { acceptsIncomplete: spec.acceptsIncomplete }),
      },
      OP,
      ts + 2,
    ),
    OP_SEED,
  );
  await gw.append([record]);
  return { container, record: record.id, version, membershipAt, term, declaration: declaration.id };
}

/** The ground, delta id by delta id — the comparison a "left byte-identical" rail makes. */
export const groundIds = (gw: Gateway): string[] =>
  [...gw.reactor.snapshot()].map((d) => d.id).sort();

/** Strike a delta in the operator's own voice (un-slating, forgiveness, an ordinary retraction). */
export const strike = (targetId: string, ts: number): Delta =>
  signClaims(
    {
      timestamp: ts,
      author: OP,
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
    },
    OP_SEED,
  );
