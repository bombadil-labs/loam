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

const SPEC: ContainerSpec = {
  container: "container:archive",
  trust: "curated" satisfies ContainerTrust,
  posture: "shared" satisfies ContainerPosture,
  membership: { op: "select", pred: { hasPointer: { context: { exact: "height" } } }, in: "input" },
};
const MANIFEST_ROW: ManifestExport = { alias: "Plant", targetEntity: "hyperschema:Plant" };

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
      validFrom: timestamp,
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
    expect(CONTAINER_CONTEXTS).toEqual([
      CTX_CONTAINER,
      CTX_CONTAINER_EXCLUDED,
      CTX_CONTAINER_DETACHED,
    ]);
    expect(CTX_CONTAINER).toBe("loam.container");
    expect(CTX_MANIFEST).toBe("loam.manifest");
    expect(MANIFEST_ENTITY).toBe("loam:manifest");

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
    const a = height(1, 10);
    const b = height(2, 20);
    expect(freezeMembers([a, b]).id).toBe(freezeMembers([b, a]).id);

    const rows: ManifestRow[] = loam.readManifest([], Date.now());
    expect(rows).toEqual([]);
  });

  it("does NOT export the plumbing behind the doors", () => {
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

    const opts: ContainerOptions = { name: SPEC.container };
    const container: Container = await openDoor(gw, opts);
    expect(container.entity).toBe(SPEC.container);
    expect(container.posture).toBe("shared");
    expect(container.gateway).toBeUndefined();
    expect(container.members().length).toBeGreaterThan(0);

    const table: ContainerTable = tableDoor(gw);
    const resolved: ResolvedContainer | undefined = table.containers.get(SPEC.container);
    expect(resolved?.trust).toBe("curated");
    expect(
      readContainerTable(gw.reactor, gw.validityNow(), OP).containers.get(SPEC.container)?.posture,
    ).toBe("shared");

    const version: ModuleVersion = freezeMembers(container.members());
    expect(version.members.length).toBe(container.members().length);
    const wholeStore = freezeDoor(gw, { op: "mask", policy: "drop", in: "input" });
    expect(wholeStore.id).toBe(freezeMembers(wholeStore.members).id);

    await container.detach("shelved for the winter");
    const records: readonly DetachRecord[] | undefined = gw
      .containers()
      .detached.get(SPEC.container);
    expect(records?.[0]?.note).toBe("shelved for the winter");

    expect(lawFromDoor(gw, [version])).toEqual([]);
    expect(lawTrailDoor(gw)).toEqual([]);
    await expect(adoptDoor(gw, version, "Nothing", {} satisfies AdoptLawOptions)).rejects.toThrow(
      /lists no export named "Nothing"/,
    );
    await expect(blessDoor(gw, version, {} satisfies BlessAllOptions)).rejects.toThrow(
      /exports no law/,
    );
    expect(readLawAdoptions(gw.reactor, gw.validityNow(), OP)).toEqual([]);

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
    expect(containerDefect(wallFlip, gw.reactor, gw.validityNow(), OP)).toMatch(/§28\.4/);

    await gw.append([
      signClaims(
        {
          timestamp: 8100,
          validFrom: 8100,
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
    expect(containerAdmission(gw.reactor, gw.validityNow(), OP, SPEC.container).mode).toBe(
      "closed",
    );
    expect(readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode).not.toBe("closed");

    await gw.close();
  });
});
