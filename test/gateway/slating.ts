import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  containerClaims,
  termClaims,
  type ContainerPosture,
  type ContainerTrust,
} from "../../src/gateway/container-law.js";
import { frozenMembershipTerm, slateClaims } from "../../src/gateway/slate.js";
import { type SlateClosure } from "../../src/gateway/slate-law.js";
import { MemoryBackend } from "../../src/store/memory.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

export const OP_SEED = "6c".repeat(32);
export const OP = authorForSeed(OP_SEED);

export const DEADLINE = 4_070_908_800_000;
export const BEFORE_DEADLINE = DEADLINE - 600_000;
export const AFTER_DEADLINE = DEADLINE + 600_000;
export const LAPSED_DEADLINE = 1_700_000_000_000;
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

export const declareContainer = (
  spec: Parameters<typeof containerClaims>[0],
  ts: number,
  validFrom = ts,
): Delta => signClaims({ ...containerClaims(spec, OP, ts), validFrom }, OP_SEED);

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
  readonly validFrom?: number;
  readonly omitVersion?: boolean;
  readonly wrongVersion?: string;
  readonly danglingMembership?: boolean;
  readonly recordPins?: { membershipAt: string; version: string };
  readonly liveTerm?: unknown;
}

export async function standSlate(gw: Gateway, spec: SlateFixture): Promise<StoodSlate> {
  const container = spec.container ?? "container:slate:subject-42";
  const ts = spec.ts ?? 50_000;
  const validFrom = spec.validFrom ?? ts;
  const term = spec.liveTerm ?? frozenMembershipTerm(spec.members.map((d) => d.id));
  const published = signClaims({ ...termClaims(term, OP, ts), validFrom }, OP_SEED);
  await gw.append([published]);
  const version = spec.wrongVersion ?? gw.freeze(term).id;
  const membershipAt = spec.danglingMembership ? `${published.id.slice(0, -4)}dead` : published.id;
  const recordPins = spec.recordPins ?? { membershipAt, version };
  const declaration = declareContainer(
    {
      container,
      trust: spec.trust ?? "curated",
      posture: spec.posture ?? "shared",
      membershipAt,
      ...(spec.omitVersion === true ? {} : { version }),
    },
    ts + 1,
    spec.validFrom ?? ts + 1,
  );
  await gw.append([declaration]);
  const record = signClaims(
    {
      ...slateClaims(
        {
          container,
          membershipAt: recordPins.membershipAt,
          version: recordPins.version,
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
      validFrom: spec.validFrom ?? ts + 2,
    },
    OP_SEED,
  );
  await gw.append([record]);
  return { container, record: record.id, version, membershipAt, term, declaration: declaration.id };
}

export const groundIds = (gw: Gateway): string[] => {
  const ids = [...gw.reactor.snapshot()].map((d) => d.id).sort();
  if (ids.length === 0)
    throw new Error("groundIds: a governed store is never empty — the probe broke");
  return ids;
};

export const strike = (targetId: string, ts: number): Delta =>
  signClaims(
    {
      timestamp: ts,
      validFrom: ts,
      author: OP,
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
    },
    OP_SEED,
  );
