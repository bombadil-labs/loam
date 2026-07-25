// T32 — the container vocabulary mint (criteria 2 and 17). Two rails share this file because they
// are two faces of one promise: the vocabulary collides with nothing that exists (prefix rail +
// malformation refusals at the door), and nothing that is not the operator's can move it (a
// federated stranger's declaration, exclusion, or detach record lands as DATA and binds NOTHING —
// asserted at both levels: the delta is in the ground, and the table, the scope, and the detached
// listing are unmoved). What this file deliberately does not assert: resolution semantics
// (container-declare), scope algebra (container-scope), the tree (container-tree).

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, CTX_OPERATOR } from "../../src/gateway/genesis.js";
import { CTX_GRANTS, CTX_MEMBERS, CTX_TENANT } from "../../src/gateway/accounts.js";
import { CTX_TRUST } from "../../src/gateway/trust.js";
import { CTX_ERASE } from "../../src/gateway/erase.js";
import { CTX_PUBLIC } from "../../src/gateway/public.js";
import { CTX_BUDGET } from "../../src/gateway/budget.js";
import { CTX_ADOPTION } from "../../src/gateway/adopt.js";
import { CTX_RENDERER } from "../../src/gateway/renderers.js";
import { CTX_REGISTRATION } from "../../src/gateway/registration.js";
import {
  CONTAINER_CONTEXTS,
  CTX_CONTAINER,
  CTX_CONTAINER_DETACHED,
  CTX_CONTAINER_EXCLUDED,
  containerClaims,
  detachClaims,
  exclusionClaims,
} from "../../src/gateway/container.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "2a".repeat(32);
const OP = authorForSeed(OP_SEED);
const STRANGER_SEED = "2b".repeat(32);

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};

// A raw declaration the builders would refuse to build — the door must see what any client can
// hand it, not only what our own claim builder emits.
const rawDeclaration = (container: string, pointers: Claims["pointers"], ts: number): Claims => ({
  timestamp: ts,
  author: OP,
  pointers: [
    {
      role: "container",
      target: { kind: "entity", entity: { id: container, context: CTX_CONTAINER } },
    },
    ...pointers,
  ],
});

const prim = (role: string, value: string): Claims["pointers"][number] => ({
  role,
  target: { kind: "primitive", value },
});

describe("T32 criterion 2 — the mint collides with nothing", () => {
  it("every new context begins loam.container, and no reserved context shares the prefix", () => {
    expect(CONTAINER_CONTEXTS).toEqual([
      CTX_CONTAINER,
      CTX_CONTAINER_EXCLUDED,
      CTX_CONTAINER_DETACHED,
    ]);
    for (const ctx of CONTAINER_CONTEXTS) {
      expect(ctx.startsWith("loam.container")).toBe(true);
    }
    expect(new Set(CONTAINER_CONTEXTS).size).toBe(3);
    // The reserved vocabulary that predates the mint — none of it may share the prefix, so
    // shape-detection (the §20 corollary) can never confuse an old delta for a container claim.
    const reserved = [
      CTX_OPERATOR,
      CTX_GRANTS,
      CTX_MEMBERS,
      CTX_TENANT,
      CTX_TRUST,
      CTX_ERASE,
      CTX_PUBLIC,
      CTX_BUDGET,
      CTX_ADOPTION,
      CTX_RENDERER,
      CTX_REGISTRATION,
    ];
    for (const ctx of reserved) {
      expect(ctx.startsWith("loam.container")).toBe(false);
    }
  });

  it("the door refuses a NUL in a container name", async () => {
    const gw = await boot();
    const claims = containerClaims(
      { container: "container:a\u0000b", trust: "curated", posture: "separate" },
      OP,
      5000,
    );
    await expect(gw.append([signClaims(claims, OP_SEED)])).rejects.toThrow(/NUL/);
    await gw.close();
  });

  it("a declaration missing trust refuses", async () => {
    const gw = await boot();
    const claims = rawDeclaration("container:no-trust", [prim("posture", "separate")], 5001);
    await expect(gw.append([signClaims(claims, OP_SEED)])).rejects.toThrow(/trust/);
    await gw.close();
  });

  it("a declaration missing posture refuses, naming the §28.4 recommendation (separate)", async () => {
    const gw = await boot();
    const claims = rawDeclaration("container:no-posture", [prim("trust", "curated")], 5002);
    // The default lives in the MESSAGE and never in silent vocabulary semantics: the refusal
    // recommends "separate" rather than allocating one nobody asked for.
    await expect(gw.append([signClaims(claims, OP_SEED)])).rejects.toThrow(/posture.*separate/s);
    await gw.close();
  });

  it("a declaration carrying BOTH membership roles refuses naming the conflict", async () => {
    const gw = await boot();
    const claims = rawDeclaration(
      "container:both",
      [
        prim("trust", "curated"),
        prim("posture", "shared"),
        prim("membership", JSON.stringify(HEIGHTS)),
        prim("membershipAt", "some-content-address"),
      ],
      5003,
    );
    await expect(gw.append([signClaims(claims, OP_SEED)])).rejects.toThrow(/never both/);
    await gw.close();
  });

  it("a PROPERTY declaration carrying neither membership role refuses (the H9 shape)", async () => {
    const gw = await boot();
    const claims = rawDeclaration(
      "container:empty-property",
      [prim("trust", "curated"), prim("posture", "shared")],
      5004,
    );
    await expect(gw.append([signClaims(claims, OP_SEED)])).rejects.toThrow(/membership/);
    // The same shape on a WALL is lawful — a seeded arena needs no scope Term (the quarantine's
    // own shape); without this leg the rail above could pass on a validator that rejects every
    // membership-less declaration regardless of posture.
    const wall = rawDeclaration(
      "container:bare-wall",
      [prim("trust", "curated"), prim("posture", "separate")],
      5005,
    );
    await gw.append([signClaims(wall, OP_SEED)]);
    expect(gw.containers().containers.has("container:bare-wall")).toBe(true);
    await gw.close();
  });
});

describe("T32 criterion 17 — a stranger's container claims are inert", () => {
  it("a federated declaration, exclusion, and detach record land as data and move nothing", async () => {
    const gw = await boot();
    const h = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([h]);
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: "container:mine",
            trust: "curated",
            posture: "shared",
            membership: HEIGHTS,
          },
          OP,
          6000,
        ),
        OP_SEED,
      ),
    ]);

    const stranger = authorForSeed(STRANGER_SEED);
    const foreignDeclaration = signClaims(
      containerClaims(
        {
          container: "container:theirs",
          trust: "curated",
          posture: "shared",
          membership: HEIGHTS,
        },
        stranger,
        6100,
      ),
      STRANGER_SEED,
    );
    const foreignExclusion = signClaims(
      exclusionClaims("container:mine", stranger, 6200),
      STRANGER_SEED,
    );
    const foreignDetach = signClaims(
      detachClaims("container:mine", "a stranger's say-so", stranger, 6300),
      STRANGER_SEED,
    );
    const report = await gw.federate([foreignDeclaration, foreignExclusion, foreignDetach], {
      admit: () => true,
    });
    expect(report.accepted).toBe(3);

    // Delta level: all three sit in the ground — federation is union, the data landed.
    expect(gw.reactor.get(foreignDeclaration.id)).toBeDefined();
    expect(gw.reactor.get(foreignExclusion.id)).toBeDefined();
    expect(gw.reactor.get(foreignDetach.id)).toBeDefined();

    // Object level: the table, the scope, and the detached listing are UNMOVED. A stranger holds
    // no denial-of-visibility primitive over the operator's scoped reads, and cannot pollute the
    // repair listing.
    const table = gw.containers();
    expect(table.containers.has("container:theirs")).toBe(false);
    expect(table.containers.has("container:mine")).toBe(true);
    expect(table.excluded.has("container:mine")).toBe(false);
    expect(table.detached.has("container:mine")).toBe(false);
    const scoped = gw.containerScope({ containers: ["container:mine"] }).map((d) => d.id);
    expect(scoped).toContain(h.id); // neither the foreign exclusion nor the detach subtracted it
    await gw.close();
  });
});
