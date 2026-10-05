import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta, type Claims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { containerClaims, exclusionClaims, termClaims } from "../../src/gateway/container-law.js";
import { frozenMembershipTerm, slateClaims } from "../../src/gateway/slate.js";
import { eraseClaims } from "../../src/gateway/erase-law.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { DEADLINE } from "./slating.js";

const SEED = "51".repeat(32);
const AUTHOR = authorForSeed(SEED);
const HOME = "home:reader";
const ROOM = `${HOME}:room`;
const CHILD_SEED = "52".repeat(32);
const QUERY = `{ plant(entity: "${FERN}") { height tag } }`;
const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};
const nothing = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: "unused" } },
  in: "input",
};
const strike = (gw: Gateway, id: string, at: number): Delta =>
  gw.signer!.sign({
    author: gw.operatorAuthor!,
    timestamp: at,
    validFrom: at,
    pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
  });
async function slate(gw: Gateway, members: readonly Delta[]) {
  const author = gw.operatorAuthor!;
  const sign = (claims: Claims) => gw.signer!.sign(claims);
  const container = "container:slate:peer";
  const term = frozenMembershipTerm(members.map((d) => d.id));
  const published = sign(termClaims(term, author, 50_000));
  await gw.append([published]);
  const version = gw.freeze(term).id;
  await gw.append([
    sign(
      containerClaims(
        { container, posture: "shared", trust: "curated", membershipAt: published.id, version },
        author,
        50_001,
      ),
    ),
  ]);
  await gw.append([
    sign(
      slateClaims(
        {
          container,
          membershipAt: published.id,
          version,
          requestedBy: "test:reader",
          requestedByForm: "plain",
          requestedAt: 50_000,
          deadline: DEADLINE,
          closes: ["read"],
        },
        author,
        50_002,
      ),
    ),
  ]);
}
async function fixture(body: (root: Gateway, child: Gateway, file: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "loam-peer-read-"));
  const file = join(dir, "child.sqlite");
  const root = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: SEED,
      registrations: [{ hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN] }],
    }),
    {
      poolKeys: {
        load: (name) => (name.endsWith(":other") ? "53".repeat(32) : CHILD_SEED),
        create: (name) => (name.endsWith(":other") ? "53".repeat(32) : CHILD_SEED),
      },
    },
  );
  try {
    await root.append([
      signClaims(
        containerClaims(
          { container: HOME, posture: "shared", trust: "curated", membership: "input" },
          AUTHOR,
          100,
        ),
        SEED,
      ),
      signClaims(
        containerClaims(
          {
            container: ROOM,
            parent: HOME,
            posture: "separate",
            trust: "curated",
            membership: nothing,
          },
          AUTHOR,
          101,
        ),
        SEED,
      ),
    ]);
    const child = (await root.openContainer({ name: ROOM, backend: new SqliteBackend(file) }))
      .gateway!;
    await body(root, child, file);
  } finally {
    await root.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
const reading = async (root: Gateway) => {
  const result = await root.query(QUERY, undefined, {
    binding: { container: HOME, inbox: "unused" },
  });
  expect(result.errors).toBeUndefined();
  return result.data?.plant as { height: number | null; tag: readonly string[] };
};

describe("a peer owns its serving contribution before composition", () => {
  it("a peer visited only for exclusion cannot inject its withheld-strike suppression into another scope", async () =>
    fixture(async (root, child) => {
      const target = observed(FERN, "height", 87, 1001, SEED);
      const bystander = observed(FERN, "height", 12, 1000, SEED);
      await root.append([target, bystander]);
      const negation = strike(child, target.id, 2000);
      await child.append([negation]);
      await root.append([signClaims(exclusionClaims(ROOM, AUTHOR, 3000), SEED)]);
      await slate(child, [negation]);
      const onlyParent = root.servingScope(Date.now(), { containers: [HOME] }).map((d) => d.id);
      expect(onlyParent).toContain(target.id);
      expect(onlyParent).toContain(bystander.id);
      expect(onlyParent).not.toContain(negation.id);
      // The child remains an actual contributor when explicitly selected, so its withheld
      // strike's target suppression then binds. Exclusion alone was not that selection.
      const composed = root.servingScope(Date.now(), { bound: HOME }).map((d) => d.id);
      expect(composed).not.toContain(target.id);
      expect(composed).toContain(bystander.id);
    }));

  it("a child's held read-slate hides its row at the real bound query while raw membership and freeze retain it", async () =>
    fixture(async (root, child) => {
      const target = observed(FERN, "height", 87, 1001, CHILD_SEED);
      const bystander = observed(FERN, "height", 12, 1000, CHILD_SEED);
      const hiddenEntity = observed("plant:hidden", "height", 99, 1002, CHILD_SEED);
      await child.append([bystander, target, hiddenEntity]);
      expect((await reading(root)).height).toBe(87);
      const term = frozenMembershipTerm([target.id, bystander.id]);
      const frozen = child.freeze(term).id;
      await slate(child, [target, hiddenEntity]);
      expect(child.reactor.get(target.id)).toBeDefined();
      expect(root.containerScope({ containers: [ROOM] }).map((d) => d.id)).toContain(target.id);
      expect(child.freeze(term).id).toBe(frozen);
      expect((await reading(root)).height).toBe(12);
      expect(root.servingScope(Date.now(), { bound: HOME }).map((d) => d.id)).not.toContain(
        target.id,
      );
      expect(child.readContribution(Date.now()).rows.map((d) => d.id)).toContain(bystander.id);
      const listed = await root.list("Plant", {}, { container: HOME, inbox: "unused" });
      expect(listed.map((node) => node.entity)).toEqual([FERN]);
      expect(listed[0]?.view.height).toBe(12);
    }));

  it("withholding a child's strike cannot revive a target contributed only by the parent", async () =>
    fixture(async (root, child) => {
      const target = observed(FERN, "height", 87, 1001, SEED);
      const bystander = observed(FERN, "height", 12, 1000, SEED);
      await root.append([bystander, target]);
      const negation = strike(child, target.id, 2000);
      await child.append([negation]);
      expect((await reading(root)).height).toBe(12);
      expect(child.reactor.get(target.id)).toBeUndefined();
      await slate(child, [negation]);
      const served = root.servingScope(Date.now(), { bound: HOME });
      expect(served.map((d) => d.id)).not.toContain(negation.id);
      expect(served.map((d) => d.id)).not.toContain(target.id);
      expect(served.map((d) => d.id)).toContain(bystander.id);
      expect((await reading(root)).height).toBe(12);
    }));

  it("withheld-strike suppression follows another contributor's next link without exposing either strike", async () =>
    fixture(async (root, child) => {
      const target = observed(FERN, "height", 87, 1001, SEED);
      const bystander = observed(FERN, "height", 12, 1000, SEED);
      await root.append([bystander, target]);
      const otherName = `${HOME}:other`;
      await root.append([
        signClaims(
          containerClaims(
            {
              container: otherName,
              parent: HOME,
              posture: "separate",
              trust: "curated",
              membership: nothing,
            },
            AUTHOR,
            102,
          ),
          SEED,
        ),
      ]);
      const other = (await root.openContainer({ name: otherName })).gateway!;
      const first = strike(other, target.id, 2000);
      await other.append([first]);
      const second = strike(child, first.id, 3000);
      await child.append([second]);
      expect((await reading(root)).height).toBe(87);
      expect(child.reactor.get(first.id)).toBeUndefined();
      await slate(child, [second]);
      const served = root.servingScope(Date.now(), { bound: HOME }).map((d) => d.id);
      expect(served).not.toContain(second.id);
      expect(served).not.toContain(first.id);
      expect(served).not.toContain(target.id);
      expect(served).toContain(bystander.id);
      expect((await reading(root)).height).toBe(12);
    }));

  it("a child's own erasure does not acquire authority over the parent's independent copy", async () =>
    fixture(async (root, child) => {
      const target = observed(FERN, "height", 87, 1001, CHILD_SEED);
      const bystander = observed(FERN, "tag", "kept", 1000, CHILD_SEED);
      await root.issueGrant(child.operatorAuthor!, "write");
      await root.append([target]);
      await child.append([target, bystander]);
      await child.append([
        child.signer!.sign(
          eraseClaims(target.id, child.operatorAuthor!, child.operatorAuthor!, 2000),
        ),
      ]);
      expect(child.reactor.get(target.id)).toBeDefined();
      expect(child.readContribution(Date.now()).rows.map((d) => d.id)).not.toContain(target.id);
      expect((await reading(root)).height).toBe(87);
      expect((await reading(root)).tag).toContain("kept");
    }));

  it("excluding a child's raw membership stays narrowing when that child withholds the same row", async () =>
    fixture(async (root, child) => {
      const target = observed(FERN, "height", 87, 1001, CHILD_SEED);
      const bystander = observed(FERN, "height", 12, 1000, SEED);
      await root.issueGrant(child.operatorAuthor!, "write");
      await root.append([target, bystander]);
      await child.append([target]);
      await root.append([signClaims(exclusionClaims(ROOM, AUTHOR, 2000), SEED)]);
      expect((await reading(root)).height).toBe(12);
      await slate(child, [target]);
      expect((await reading(root)).height).toBe(12);
    }));

  it("the parent query refreshes the child's admitted SQLite set after an independent removal and closes its old watch", async () =>
    fixture(async (root, child, file) => {
      const target = observed(FERN, "height", 87, 1001, CHILD_SEED);
      const bystander = observed(FERN, "height", 12, 1000, CHILD_SEED);
      await child.append([target, bystander]);
      expect((await reading(root)).height).toBe(87);
      const stream = child.watch(HEIGHTS);
      expect(JSON.stringify((await stream.next()).value)).toContain(target.id);
      const count = child.reactor.size;
      const writer = await Gateway.open(new SqliteBackend(file), { seed: CHILD_SEED });
      try {
        await writer.erase(target.id, { reason: "independent peer writer" });
        expect(writer.reactor.size).toBe(count);
        expect(child.reactor.get(target.id)).toBeDefined();
        expect((await reading(root)).height).toBe(12);
        expect(child.reactor.get(target.id)).toBeUndefined();
        expect(child.reactor.get(bystander.id)).toBeDefined();
        expect(await stream.next()).toMatchObject({ done: true });
      } finally {
        await writer.close();
      }
    }));

  it("an unavailable child source fails the parent read instead of serving its cached reactor", async () =>
    fixture(async (root, child) => {
      await child.append([observed(FERN, "height", 87, 1001, CHILD_SEED)]);
      expect((await reading(root)).height).toBe(87);
      const store = child.peer!.store;
      const original = store.readHead.bind(store);
      store.readHead = () => Promise.reject(new Error("child journal unavailable"));
      try {
        await expect(reading(root)).rejects.toThrow("child journal unavailable");
      } finally {
        store.readHead = original;
      }
    }));
});

describe("channel query serving uses the peer-owned source too", () => {
  it("keeps a child's read-slate out of the actual prefixed query without falling back to the receiver", async () => {
    const peerSeed = "56".repeat(32);
    const sender = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: peerSeed,
        registrations: [{ hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN] }],
      }),
    );
    const receiver = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: SEED,
        registrations: [{ hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN] }],
      }),
    );
    try {
      const target = observed(FERN, "height", 87, 1001, peerSeed);
      const bystander = observed(FERN, "height", 12, 1000, peerSeed);
      await sender.append([target, bystander]);
      const channel = await receiver.openChannel({
        into: "friends",
        prefix: "remote",
        source: { pull: () => Promise.resolve(sender.reactor.arrivalLog()) },
      });
      await channel.sync();
      await receiver.append([observed(FERN, "height", 999, 2000, SEED)]);
      const answer = async () => {
        const result = await receiver.query(`{ remote_Plant(entity: "${FERN}") { height } }`);
        expect(result.errors).toBeUndefined();
        return (result.data?.remote_Plant as { height: number }).height;
      };
      expect(await answer()).toBe(87);
      const child = receiver.store.tableOf(receiver).channels.get(channel.name)!.gateway!;
      await slate(child, [target]);
      expect(child.reactor.get(target.id)).toBeDefined();
      expect(await answer()).toBe(12);
      expect(child.reactor.get(bystander.id)).toBeDefined();
    } finally {
      await sender.close();
      await receiver.close();
    }
  });
});
