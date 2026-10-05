import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Delta, type Claims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { containerClaims, exclusionClaims, termClaims } from "../../src/gateway/container-law.js";
import { frozenMembershipTerm, slateClaims } from "../../src/gateway/slate.js";
import { eraseClaims } from "../../src/gateway/erase-law.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { DEADLINE } from "./slating.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { channelRecordClaims } from "../../src/federation/channel.js";
import { withStamp } from "../../src/gateway/stamp.js";

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
const reading = async (root: Gateway, asOf?: number) => {
  const source =
    asOf === undefined ? QUERY : `{ plant(entity: "${FERN}", asOf: ${asOf}) { height tag } }`;
  const result = await root.query(source, undefined, {
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

  it("a historical bound query keeps current withheld-strike closure without admitting future strike bytes", async () =>
    fixture(async (root, child) => {
      const target = observed(FERN, "height", 87, 1001, SEED);
      const bystander = observed(FERN, "height", 12, 1000, SEED);
      await root.append([target, bystander]);
      const first = strike(root, target.id, 2000);
      await root.append([first]);
      const second = strike(child, first.id, 3000);
      await child.append([second]);
      expect((await reading(root, 1500)).height).toBe(87);
      await slate(child, [second]);
      expect(child.reactor.get(first.id)).toBeUndefined();
      expect(root.reactor.get(first.id)).toBeDefined();
      const historical = root
        .servingScope(Date.now(), { bound: HOME, asOf: 1500 })
        .map((d) => d.id);
      expect(historical).not.toContain(first.id);
      expect(historical).not.toContain(second.id);
      expect(historical).not.toContain(target.id);
      expect(historical).toContain(bystander.id);
      expect((await reading(root, 1500)).height).toBe(12);
      expect(root.containerScope({ containers: [HOME, ROOM] }).map((d) => d.id)).toEqual(
        expect.arrayContaining([target.id, first.id, second.id]),
      );
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

describe("child law refresh invalidates the parent's dependent surface", () => {
  async function channelFixture(
    body: (sender: Gateway, receiver: Gateway, child: Gateway, file: string) => Promise<void>,
    sourceName = { into: "friends", prefix: "remote" },
  ) {
    const dir = mkdtempSync(join(tmpdir(), "loam-peer-channel-law-"));
    const file = join(dir, "channel.sqlite");
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
      {
        channelBackend: () => new SqliteBackend(file),
        poolKeys: { load: () => CHILD_SEED, create: () => CHILD_SEED },
      },
    );
    try {
      await sender.append([observed(FERN, "height", 87, 1001, peerSeed)]);
      const channel = await receiver.openChannel({
        ...sourceName,
        source: { pull: () => Promise.resolve(sender.reactor.arrivalLog()) },
      });
      await channel.sync();
      await receiver.append([observed(FERN, "height", 999, 1002, SEED)]);
      const child = receiver.store.tableOf(receiver).channels.get(channel.name)!.gateway!;
      await body(sender, receiver, child, file);
    } finally {
      await receiver.close();
      await sender.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
  const remoteQuery = `{ remote_Plant(entity: "${FERN}") { height } }`;
  const nativeQuery = `{ plant(entity: "${FERN}") { height } }`;
  async function withdraw(child: Gateway, file: string) {
    const id = child.def("remote:Plant").boundId!;
    expect(id).toBeDefined();
    const writer = await Gateway.open(new SqliteBackend(file), { seed: CHILD_SEED });
    try {
      await writer.strike([id]);
    } finally {
      await writer.close();
    }
  }
  it.each([
    { into: "friends", prefix: "al:ice" },
    { into: "friends:al", prefix: "ice" },
  ])(
    "the exact channel source survives unreadable prefix for $into / $prefix, and a namespaced local binding remains local",
    async (sourceName) =>
      channelFixture(async (_sender, receiver, child, file) => {
        const lens = `${sourceName.prefix}:Plant`;
        const field = lens.replaceAll(":", "_");
        const query = `{ ${field}(entity: "${FERN}") { height } }`;
        expect((await receiver.query(query)).errors).toBeUndefined();
        await child.publishRegistration(
          PLANT,
          { ...PLANT_POLICY, name: lens },
          [FERN],
          undefined,
          undefined,
          undefined,
          ["height"],
        );
        const privateFact = receiver.reactor
          .arrivalLog()
          .find((d) =>
            d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === 999),
          )!;
        const ownAtPeer = observed(FERN, "height", 77, 1004, SEED);
        await child.append([
          child.signer!.sign(
            withStamp(child.stamp(child.operatorAuthor), (stamp) =>
              grantClaims(STORE_ENTITY, AUTHOR, "write", child.operatorAuthor!, stamp),
            ),
          ),
        ]);
        await child.append([ownAtPeer]);
        const raw = receiver.gatherForRetraction(lens, FERN);
        const cleared = await receiver.query(
          `mutation { clear${field}(entity: "${FERN}", fields: ["height"]) { height } }`,
        );
        expect(cleared.errors).toBeUndefined();
        expect(receiver.reactor.negationsOf(privateFact.id)).toHaveLength(0);
        expect(receiver.reactor.negationsOf(ownAtPeer.id)).not.toHaveLength(0);
        expect((cleared.data?.[`clear${field}`] as { height: number }).height).toBe(87);
        expect([...raw.props.values()].flat().map((e) => e.delta.id)).toContain(ownAtPeer.id);
        expect([...raw.props.values()].flat().map((e) => e.delta.id)).not.toContain(privateFact.id);
        // Same namespace, explicit LOCAL binding: prefix resemblance must not choose child rows.
        const local = `${sourceName.prefix}:Local`;
        const localField = local.replaceAll(":", "_");
        await receiver.publishRegistration(
          PLANT,
          { ...PLANT_POLICY, name: local },
          [FERN],
          undefined,
          undefined,
          undefined,
          ["height"],
        );
        const localQuery = `{ ${localField}(entity: "${FERN}") { height } }`;
        expect((await receiver.query(localQuery)).errors).toBeUndefined();
        expect(
          ((await receiver.query(localQuery)).data?.[localField] as { height: number }).height,
        ).toBe(999);
        const status = receiver.channelStatus()[0]!;
        const claims = withStamp(receiver.stamp(receiver.operatorAuthor), (stamp) =>
          channelRecordClaims(status, receiver.operatorAuthor!, stamp),
        );
        await receiver.append([
          receiver.signer!.sign({
            ...claims,
            pointers: claims.pointers.filter((p) => p.role !== "prefix"),
          }),
        ]);
        const writer = await Gateway.open(new SqliteBackend(file), { seed: CHILD_SEED });
        try {
          await writer.append([observed(FERN, "tag", "changed colon source", 1003, CHILD_SEED)]);
        } finally {
          await writer.close();
        }
        const read = await receiver.query(query);
        expect(JSON.stringify(read.data ?? {})).not.toContain("999");
        expect(JSON.stringify(read.errors)).toMatch(/does not carry its prefix/);
        expect(JSON.stringify(read.errors)).toContain(status.name);
        const head = receiver.peer!.journal.currentHead();
        const signing = vi.spyOn(receiver.signer!, "sign");
        try {
          const mutation = await receiver.query(
            `mutation { ${field}(entity: "${FERN}", height: 123) { height } }`,
          );
          expect(JSON.stringify(mutation.errors)).toMatch(/does not carry its prefix/);
          await expect(receiver.mutateEntity(lens, FERN, { height: 234 })).rejects.toThrow(
            /does not carry its prefix/,
          );
          expect(signing).not.toHaveBeenCalled();
          expect(receiver.peer!.journal.currentHead()).toBe(head);
        } finally {
          signing.mockRestore();
        }
        await expect(
          receiver.subscribe(`subscription { ${field}(entity: "${FERN}") { height } }`),
        ).rejects.toThrow(/federation channel/);
        const own = await receiver.query(localQuery);
        expect(own.errors).toBeUndefined();
        expect((own.data?.[localField] as { height: number }).height).toBe(999);
        const native = await receiver.query(
          `mutation { ${localField}(entity: "${FERN}", height: 321) { height } }`,
        );
        expect(native.errors).toBeUndefined();
        expect((native.data?.[localField] as { height: number }).height).toBe(321);
        // Withdrawing the actual child binding still removes the parent's route.
        const withdrawer = await Gateway.open(new SqliteBackend(file), { seed: CHILD_SEED });
        try {
          await withdrawer.strike(
            child.reactor
              .arrivalLog()
              .filter(
                (d) =>
                  d.claims.author === child.operatorAuthor &&
                  d.claims.pointers.some(
                    (p) =>
                      p.role === "schema" &&
                      p.target.kind === "entity" &&
                      p.target.entity.id === `schema:${lens}`,
                  ),
              )
              .map((d) => d.id),
          );
        } finally {
          await withdrawer.close();
        }
        const withdrawn = await receiver.query(query);
        expect(withdrawn.errors).toBeDefined();
        expect(receiver.registered.map((r) => r.lensName)).not.toContain(lens);
      }, sourceName),
  );
  it("an unreadable channel prefix keeps its specific refusal after a real SQLite child refold, without signing mutations or disturbing the native bystander", async () =>
    channelFixture(async (_sender, receiver, child, file) => {
      await child.publishRegistration(
        PLANT,
        { ...PLANT_POLICY, name: "remote:Plant" },
        [FERN],
        undefined,
        undefined,
        {
          setRemoteHeight: {
            pointers: [
              { role: "target", at: { arg: "entity" }, context: "height" },
              { role: "value", value: { arg: "height" } },
            ],
          },
        },
        ["height"],
      );
      expect((await receiver.query(remoteQuery)).errors).toBeUndefined();
      expect(child.def("remote:Plant").writable).toContain("height");
      // Healthy channel controls exercise BOTH signing routes before their source becomes unreadable.
      const healthyHead = receiver.peer!.journal.currentHead();
      const healthyMutation = await receiver.query(
        `mutation { remote_Plant(entity: "${FERN}", height: 999) { height } }`,
      );
      expect(healthyMutation.errors).toBeUndefined();
      expect(receiver.peer!.journal.currentHead()).not.toBe(healthyHead);
      const healthyTemplate = await receiver.query(
        `mutation { setRemoteHeight(entity: "${FERN}", height: 999) { delta } }`,
      );
      expect(healthyTemplate.errors).toBeUndefined();
      expect(healthyTemplate.data?.setRemoteHeight).toHaveProperty("delta");
      const status = receiver.channelStatus()[0]!;
      const claims = withStamp(receiver.stamp(receiver.operatorAuthor), (stamp) =>
        channelRecordClaims(status, receiver.operatorAuthor!, stamp),
      );
      await receiver.append([
        receiver.signer!.sign({
          ...claims,
          pointers: claims.pointers.filter((p) => p.role !== "prefix"),
        }),
      ]);
      expect(receiver.channelStatus()[0]!.unreadable).toContain("prefix");
      const oldHead = child.peer!.journal.currentHead();
      const writer = await Gateway.open(new SqliteBackend(file), { seed: CHILD_SEED });
      try {
        await writer.append([observed(FERN, "tag", "child changed", 1003, CHILD_SEED)]);
      } finally {
        await writer.close();
      }
      const result = await receiver.query(remoteQuery);
      expect(child.peer!.journal.currentHead()).not.toBe(oldHead);
      expect(child.def("remote:Plant")).toBeDefined();
      expect(JSON.stringify(result.errors)).toMatch(/does not carry its prefix/);
      expect(JSON.stringify(result.errors)).toContain(status.name);
      expect(JSON.stringify(result.data ?? {})).not.toContain("999");
      const head = receiver.peer!.journal.currentHead();
      const signing = vi.spyOn(receiver.signer!, "sign");
      const mutation = await receiver.query(
        `mutation { remote_Plant(entity: "${FERN}", height: 123) { height } }`,
      );
      expect(JSON.stringify(mutation.errors)).toMatch(/does not carry its prefix/);
      expect(receiver.peer!.journal.currentHead()).toBe(head);
      const template = await receiver.query(
        `mutation { setRemoteHeight(entity: "${FERN}", height: 456) { delta } }`,
      );
      expect(JSON.stringify(template.errors)).toMatch(/does not carry its prefix/);
      expect(receiver.peer!.journal.currentHead()).toBe(head);
      await expect(receiver.mutateEntity("remote:Plant", FERN, { height: 789 })).rejects.toThrow(
        /does not carry its prefix/,
      );
      await expect(receiver.list("remote:Plant")).rejects.toThrow(/does not carry its prefix/);
      expect(signing).not.toHaveBeenCalled();
      expect(receiver.peer!.journal.currentHead()).toBe(head);
      signing.mockRestore();
      await expect(
        receiver.subscribe(`subscription { remote_Plant(entity: "${FERN}") { height } }`),
      ).rejects.toThrow(/federation channel/);
      const own = await receiver.query(nativeQuery);
      expect(own.errors).toBeUndefined();
      expect((own.data?.plant as { height: number }).height).toBe(999);
      await receiver.publishRegistration(
        PLANT,
        PLANT_POLICY,
        [FERN],
        undefined,
        undefined,
        undefined,
        ["height"],
      );
      const nativeMutation = await receiver.query(
        `mutation { plant(entity: "${FERN}", height: 321) { height } }`,
      );
      expect(nativeMutation.errors).toBeUndefined();
      expect((nativeMutation.data?.plant as { height: number }).height).toBe(321);
    }));
  it("an independent SQLite child binding withdrawal retires the parent's warmed channel lens and preserves its native bystander", async () =>
    channelFixture(async (_sender, receiver, child, file) => {
      const warm = await receiver.query(remoteQuery);
      expect(warm.errors).toBeUndefined();
      expect((warm.data?.remote_Plant as { height: number }).height).toBe(87);
      await withdraw(child, file);
      expect(child.def("remote:Plant")).toBeDefined(); // the reader has not reconciled yet
      const result = await receiver.query(remoteQuery);
      expect(child.registered.map((r) => r.lensName)).not.toContain("remote:Plant");
      expect(receiver.registered.map((r) => r.lensName)).not.toContain("remote:Plant");
      expect(result.errors).toBeDefined();
      const own = await receiver.query(nativeQuery);
      expect(own.errors).toBeUndefined();
      expect((own.data?.plant as { height: number }).height).toBe(999);
    }));
  it("a failed parent refold refuses the read and retries the withdrawn child law at unchanged heads", async () =>
    channelFixture(async (_sender, receiver, child, file) => {
      expect((await receiver.query(remoteQuery)).errors).toBeUndefined();
      await withdraw(child, file);
      const replay = receiver.replayRegistrations.bind(receiver);
      let failed = false;
      receiver.replayRegistrations = () => {
        if (!failed) {
          failed = true;
          throw new Error("injected parent refold failure");
        }
        replay();
      };
      try {
        await expect(receiver.query(remoteQuery)).rejects.toThrow("injected parent refold failure");
        expect(child.registered.map((r) => r.lensName)).not.toContain("remote:Plant");
        const childHead = child.peer!.journal.currentHead();
        const parentHead = receiver.peer!.journal.currentHead();
        const recovered = await receiver.query(remoteQuery);
        expect(recovered.errors).toBeDefined();
        expect(receiver.registered.map((r) => r.lensName)).not.toContain("remote:Plant");
        expect(child.peer!.journal.currentHead()).toBe(childHead);
        expect(receiver.peer!.journal.currentHead()).toBe(parentHead);
        const own = await receiver.query(nativeQuery);
        expect(own.errors).toBeUndefined();
        expect((own.data?.plant as { height: number }).height).toBe(999);
      } finally {
        receiver.replayRegistrations = replay;
      }
    }));
});
