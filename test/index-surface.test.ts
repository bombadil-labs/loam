// T82 — the BARREL is the package. `@bombadil/loam` resolves to `dist/index.js` (package.json
// `exports`), so a name absent from `src/index.ts` is a name no consumer can import: the feature
// ships, and nobody outside this repo can reach it except by a deep `dist/gateway/*.js` path that
// carries no semver promise. This rail pins BOTH SIDES of that line for the container surface
// (SPEC §27) and the law-adoption surface (§27.8) — the door's vocabulary is public, the door's
// plumbing is not.
//
// Three levels, because each one alone passes while the surface is broken:
//   NAME    — the export is present at runtime (a value) or at compile time (a type).
//   SIGNATURE — the door's own signature is EXPRESSIBLE from public names alone. A type re-export
//               pointing at the wrong thing satisfies the name level and fails here.
//   OBJECT  — a container is declared, opened, read, and detached through NOTHING but the barrel
//             and the substrate. That is the consumer's actual position, and it is the only level
//             that catches a name that is present, correctly typed, and unusable.
//
// Deliberately NOT asserted here: that `dist/` carries these names. That is pack.test.ts's half of
// the contract (the tarball, and the `.d.ts` files these type re-exports resolve through); the two
// files together are the chain from `src/index.ts` to `npm install`.

import { describe, expect, it } from "vitest";
import { authorForSeed, parseSchema, signClaims } from "@bombadil/rhizomatic";
import * as loam from "../src/index.js";
import {
  CONTAINER_CONTEXTS,
  CTX_CONTAINER,
  CTX_CONTAINER_DETACHED,
  CTX_CONTAINER_EXCLUDED,
  CTX_MANIFEST,
  CTX_TRUST,
  Gateway,
  MANIFEST_ENTITY,
  MemoryBackend,
  assembleGenesis,
  containerAdmission,
  containerClaims,
  containerDefect,
  detachClaims,
  entityGatherBody,
  exclusionClaims,
  freezeMembers,
  manifestExportClaims,
  readContainerTable,
  readLawAdoptions,
  readTrustPolicy,
  termClaims,
  type AdoptLawOptions,
  type AdoptionOutcome,
  type BlessAllOptions,
  type BlessAllReport,
  type Container,
  type ContainerOptions,
  type ContainerPosture,
  type ContainerSpec,
  type ContainerTable,
  type ContainerTrust,
  type DetachRecord,
  type LawAdoption,
  type LawFromRow,
  type ManifestExport,
  type ManifestRow,
  type ModuleVersion,
  type ResolvedContainer,
} from "../src/index.js";

const OP_SEED = "5e".repeat(32);
const OP = authorForSeed(OP_SEED);
const FERN = "plant:fern";

// --- the SIGNATURE level -------------------------------------------------------------------------
//
// Each binding below is an annotated alias of a real door. The annotation is written from PUBLIC
// names only, so it compiles exactly when the barrel re-exports the same types the method uses —
// which is the promise, and is not implied by the names being present.

const openDoor: (gw: Gateway, opts: ContainerOptions) => Promise<Container> = (gw, opts) =>
  gw.openContainer(opts);
const tableDoor: (gw: Gateway) => ContainerTable = (gw) => gw.containers();
const freezeDoor: (gw: Gateway, term: unknown) => ModuleVersion = (gw, term) => gw.freeze(term);
const adoptDoor: (
  gw: Gateway,
  version: ModuleVersion,
  alias: string,
  opts: AdoptLawOptions,
) => Promise<AdoptionOutcome> = (gw, version, alias, opts) => gw.adoptLaw(version, alias, opts);
const blessDoor: (
  gw: Gateway,
  version: ModuleVersion,
  opts: BlessAllOptions,
) => Promise<BlessAllReport> = (gw, version, opts) => gw.blessAll(version, opts);
const lawFromDoor: (gw: Gateway, versions: readonly ModuleVersion[]) => LawFromRow[] = (
  gw,
  versions,
) => gw.lawFrom(versions);
const lawTrailDoor: (gw: Gateway) => LawAdoption[] = (gw) => gw.lawAdoptions();

// The at-rest vocabulary, described from public names: the spec a claim builder eats, and the row
// shapes a reader hands back.
const SPEC: ContainerSpec = {
  container: "container:archive",
  trust: "curated" satisfies ContainerTrust,
  posture: "shared" satisfies ContainerPosture,
  // A property container IS its membership — the door refuses a scope Term nobody wrote.
  membership: { op: "select", pred: { hasPointer: { context: { exact: "height" } } }, in: "input" },
};
const MANIFEST_ROW: ManifestExport = { alias: "Plant", targetEntity: "hyperschema:Plant" };

// --- the world, built from the barrel alone ------------------------------------------------------

// The gather every plain entity wants, from the barrel's own constructor (T83) — which is the whole
// point of it being on the barrel: a consumer writes a schema without retyping the idiom.
const PLANT_BODY = entityGatherBody();
const PLANT_SCHEMA = parseSchema({
  props: { height: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});

const boot = (backend: MemoryBackend): Promise<Gateway> =>
  Gateway.boot(
    backend,
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        {
          hyperschema: { name: "Plant", alg: 1, body: PLANT_BODY },
          schema: PLANT_SCHEMA,
          roots: [FERN],
          writable: ["height"],
        },
      ],
    }),
  );

const height = (value: number, timestamp: number) =>
  signClaims(
    {
      timestamp,
      author: OP,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "height" } } },
        { role: "value", target: { kind: "primitive", value } },
      ],
    },
    OP_SEED,
  );

describe("T82 — the container and law surfaces are reachable from the package barrel", () => {
  it("exports the vocabulary, the claim builders, and the readers", () => {
    // The CONTEXT mint: a consumer recognizing container law on the wire needs every one of them,
    // and `CONTAINER_CONTEXTS` is the enumerable whole.
    expect(CONTAINER_CONTEXTS).toEqual([
      CTX_CONTAINER,
      CTX_CONTAINER_EXCLUDED,
      CTX_CONTAINER_DETACHED,
    ]);
    expect(CTX_CONTAINER).toBe("loam.container");
    expect(CTX_MANIFEST).toBe("loam.manifest");
    expect(MANIFEST_ENTITY).toBe("loam:manifest");

    // The builders and readers, by their behavior rather than by `typeof` — a name bound to the
    // wrong function is a `function` too.
    const declared = containerClaims(SPEC, OP, 100);
    expect(declared.pointers).toContainEqual({
      role: "container",
      target: { kind: "entity", entity: { id: "container:archive", context: CTX_CONTAINER } },
    });
    expect(detachClaims("container:archive", "shelved", OP, 200).pointers).toContainEqual({
      role: "note",
      target: { kind: "primitive", value: "shelved" },
    });
    expect(manifestExportClaims(MANIFEST_ROW, OP, 300).pointers).toContainEqual({
      role: "alias",
      target: { kind: "primitive", value: "Plant" },
    });
    // Order-free by construction (§27.2): the address is over WHICH deltas are in, nothing else.
    const a = height(1, 10);
    const b = height(2, 20);
    expect(freezeMembers([a, b]).id).toBe(freezeMembers([b, a]).id);

    // The barrel's readers and their row types, used: an exported alias for a shape nobody can
    // name is the same defect one level up.
    const rows: ManifestRow[] = loam.readManifest([]);
    expect(rows).toEqual([]);
  });

  it("does NOT export the plumbing behind the doors", () => {
    // Each name below is exported from its module for one reason — another module in this package
    // reaches it — and every one of them takes a `Gateway` or writes an `@internal` seam field.
    // The door is the method; publishing the body would freeze a seam as API.
    const names = Object.keys(loam);
    for (const internal of [
      "openContainerImpl",
      "containerScopeImpl",
      "unreachableWallReport",
      "adoptLawImpl",
      "blessAllImpl",
      "lawFromImpl",
      "withLivingNames",
    ]) {
      expect(names).not.toContain(internal);
    }
  });

  it("declares, opens, reads, and detaches a container through the barrel alone", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    await gw.append([height(30, 1000)]);
    await gw.append([signClaims(containerClaims(SPEC, OP, 7000), OP_SEED)]);

    // OBJECT level: the door answers, and the handle's members are the ground it names.
    const opts: ContainerOptions = { name: SPEC.container };
    const container: Container = await openDoor(gw, opts);
    expect(container.entity).toBe(SPEC.container);
    expect(container.posture).toBe("shared");
    expect(container.gateway).toBeUndefined(); // a property container is a query, not an arena
    expect(container.members().length).toBeGreaterThan(0);

    // The resolved table, through the door AND through the exported reader — the two must agree,
    // or the barrel is publishing a reader that answers a different question than the gateway.
    const table: ContainerTable = tableDoor(gw);
    const resolved: ResolvedContainer | undefined = table.containers.get(SPEC.container);
    expect(resolved?.trust).toBe("curated");
    expect(readContainerTable(gw.reactor, OP).containers.get(SPEC.container)?.posture).toBe(
      "shared",
    );

    // A frozen module version over what the container holds, named from the barrel — and the same
    // address the DOOR computes over the same members, which is what makes `freezeMembers` public
    // API rather than a re-implementation a consumer must trust.
    const version: ModuleVersion = freezeMembers(container.members());
    expect(version.members.length).toBe(container.members().length);
    const wholeStore = freezeDoor(gw, { op: "mask", policy: "drop", in: "input" });
    expect(wholeStore.id).toBe(freezeMembers(wholeStore.members).id);

    // DETACH keeps the bytes and lands the at-rest record — read back through the public table.
    await container.detach("shelved for the winter");
    const records: readonly DetachRecord[] | undefined = gw
      .containers()
      .detached.get(SPEC.container);
    expect(records?.[0]?.note).toBe("shelved for the winter");

    // The law doors, over a version that publishes no manifest: the read side answers empty, and
    // the write side refuses IN ITS OWN VOICE. The message is asserted on purpose — it is what
    // tells a real door from a name bound to something that merely throws.
    expect(lawFromDoor(gw, [version])).toEqual([]);
    expect(lawTrailDoor(gw)).toEqual([]);
    await expect(adoptDoor(gw, version, "Nothing", {} satisfies AdoptLawOptions)).rejects.toThrow(
      /lists no export named "Nothing"/,
    );
    await expect(blessDoor(gw, version, {} satisfies BlessAllOptions)).rejects.toThrow(
      /exports no law/,
    );
    expect(readLawAdoptions(gw.reactor, OP)).toEqual([]);

    // The rest of the surface, each name asserted by what it DOES: an export nobody exercises can
    // be deleted from the barrel with the rail still green, which is the same unreachability one
    // level up. `containerDefect` is the door's own verdict, reachable so a caller can pre-check
    // claims before handing them to `append`; `containerAdmission` is §28.6's admission axis, the
    // one question no method answers.
    expect(exclusionClaims(SPEC.container, OP, 400).pointers).toContainEqual({
      role: "container",
      target: {
        kind: "entity",
        entity: { id: SPEC.container, context: CTX_CONTAINER_EXCLUDED },
      },
    });
    expect(termClaims({ op: "input" }, OP, 500).pointers).toContainEqual({
      role: "term",
      target: { kind: "primitive", value: '{"op":"input"}' },
    });
    const wallFlip = signClaims(
      containerClaims({ ...SPEC, trust: "untrusted", posture: "separate" }, OP, 8000),
      OP_SEED,
    );
    expect(containerDefect(wallFlip, gw.reactor, OP)).toMatch(/§28\.4/);

    // §28.6's ADMISSION axis, filed at the container's own entity — a `loam:trust` shape whose
    // subject is the container rather than the store. `CTX_TRUST` is the whole vocabulary needed
    // to write one, and `containerAdmission` is the only way to read it back.
    await gw.append([
      signClaims(
        {
          timestamp: 8100,
          author: OP,
          pointers: [
            {
              role: "declares",
              target: { kind: "entity", entity: { id: SPEC.container, context: CTX_TRUST } },
            },
            { role: "mode", target: { kind: "primitive", value: "closed" } },
          ],
        },
        OP_SEED,
      ),
    ]);
    expect(containerAdmission(gw.reactor, OP, SPEC.container).mode).toBe("closed");
    // And the axis is the CONTAINER's, not the store's — the root policy is untouched by it.
    expect(readTrustPolicy(gw.reactor, OP).mode).not.toBe("closed");

    await gw.close();
  });
});
