import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway, type ConnectionBinding } from "../../src/gateway/gateway.js";
import { boundChannelAdmits, connectionStands } from "../../src/gateway/connection-authority.js";
import { openerStands } from "../../src/gateway/container.js";
import { containerClaims, readContainerTable } from "../../src/gateway/container-law.js";
import { holdsGrant, revocationClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { SEALED_LEEWAY, type Leeway } from "../../src/gateway/leeway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { withStamp } from "../../src/gateway/stamp.js";

const OP_SEED = "3a".repeat(32);
const OP = authorForSeed(OP_SEED);
const OWNER_SEED = "b4".repeat(32);
const KEYS = [authorForSeed("c5".repeat(32)), authorForSeed("d6".repeat(32))];
const ROOT = "owner";
const LEAF = "owner:room";
const RECEIVES: Leeway = { ...SEALED_LEEWAY, receive: true };
const gateways: Gateway[] = [];

afterEach(async () => {
  while (gateways.length > 0) await gateways.pop()!.close();
});

async function declare(gateway: Gateway, container: string, leeway?: Leeway, parent?: string) {
  const delta = signClaims(
    withStamp(gateway.stamp(OP), (t) =>
      containerClaims(
        {
          container,
          trust: "curated",
          posture: "shared",
          membership: {
            op: "select",
            pred: { hasPointer: { context: { exact: "height" } } },
            in: "input",
          },
          ...(leeway === undefined ? {} : { leeway }),
          ...(parent === undefined ? {} : { parent }),
        },
        OP,
        t,
      ),
    ),
    OP_SEED,
  );
  await gateway.append([delta]);
  return delta;
}

async function fixture() {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
  gateways.push(gateway);
  const ancestor = await declare(gateway, ROOT);
  await declare(gateway, LEAF, RECEIVES, ROOT);
  const connections = [];
  for (const key of KEYS) {
    const inbox = await gateway.bindConnection({
      container: LEAF,
      connectionKey: key,
      ownerSeed: OWNER_SEED,
    });
    const binding: ConnectionBinding = { container: LEAF, inbox: inbox.entity! };
    const channel = await gateway.openChannel({
      into: `${LEAF}:feed`,
      prefix: `${LEAF}:feed:${connections.length}`,
      source: { pull: () => Promise.resolve([]) },
      openedBy: LEAF,
      openedFrom: inbox.entity!,
    });
    const status = gateway.channelStatus(channel.name)[0]!;
    connections.push({ inbox, binding, status, key });
  }
  return { gateway, ancestor, first: connections[0]!, second: connections[1]! };
}

function probes(gateway: Gateway, check: () => void): void {
  const stores = [gateway, ...gateway.attachedContainers.values()];
  const snapshot = () => stores.map((store) => [...store.reactor.snapshot()]);
  const before = snapshot();
  check();
  check();
  expect(snapshot()).toEqual(before);
}

describe("live bound connection authority", () => {
  it("admits the standing inbox's channel, refusing another inbox and channels without a binding", async () => {
    const { gateway, first, second } = await fixture();
    const unbound = await gateway.openChannel({
      into: `${LEAF}:feed`,
      prefix: `${LEAF}:feed:person`,
      source: { pull: () => Promise.resolve([]) },
    });
    const legacy = await gateway.openChannel({
      into: `${LEAF}:feed`,
      prefix: `${LEAF}:feed:legacy`,
      source: { pull: () => Promise.resolve([]) },
      openedBy: LEAF,
    });
    const mismatchedOpener = await gateway.openChannel({
      into: `${LEAF}:feed`,
      prefix: `${LEAF}:feed:mismatched`,
      source: { pull: () => Promise.resolve([]) },
      openedBy: ROOT,
      openedFrom: first.binding.inbox,
    });
    probes(gateway, () => {
      expect(connectionStands(gateway, first.binding)).toBe(true);
      expect(connectionStands(gateway, second.binding)).toBe(true);
      expect(boundChannelAdmits(gateway, first.binding, first.status)).toBe(true);
      expect(boundChannelAdmits(gateway, second.binding, second.status)).toBe(true);
      expect(boundChannelAdmits(gateway, first.binding, second.status)).toBe(false);
      expect(
        boundChannelAdmits(
          gateway,
          first.binding,
          gateway.channelStatus(mismatchedOpener.name)[0]!,
        ),
      ).toBe(false);
      expect(boundChannelAdmits(gateway, second.binding, first.status)).toBe(false);
      expect(
        boundChannelAdmits(gateway, first.binding, gateway.channelStatus(unbound.name)[0]!),
      ).toBe(false);
      expect(
        boundChannelAdmits(gateway, first.binding, gateway.channelStatus(legacy.name)[0]!),
      ).toBe(false);
      expect(connectionStands(gateway, { ...first.binding, inbox: "inbox:missing" })).toBe(false);
      expect(connectionStands(gateway, { container: ROOT, inbox: first.binding.inbox })).toBe(
        false,
      );
    });
  });

  it("rechecks a revoked write grant immediately while the independent connection stays authorized", async () => {
    const { gateway, first, second } = await fixture();
    probes(gateway, () => {
      expect(connectionStands(gateway, first.binding)).toBe(true);
      expect(boundChannelAdmits(gateway, first.binding, first.status)).toBe(true);
      expect(boundChannelAdmits(gateway, second.binding, second.status)).toBe(true);
    });
    const inbox = gateway.connectionInboxes.get(first.inbox.entity!)!.gateway!;
    const strikes = () =>
      [...inbox.reactor.snapshot()].filter((d) =>
        d.claims.pointers.some((p) => p.role === "negates" && p.target.kind === "delta"),
      ).length;
    const before = strikes();
    await gateway.revokeConnection({
      inbox: first.inbox,
      connectionKey: first.key,
      ownerSeed: OWNER_SEED,
    });
    expect(strikes()).toBe(before + 1);
    expect(
      holdsGrant(
        inbox.reactor,
        inbox.validityNow(),
        STORE_ENTITY,
        first.key,
        "write",
        gateway.operatorAuthor,
      ),
    ).toBe(false);
    probes(gateway, () => {
      expect(connectionStands(gateway, first.binding)).toBe(false);
      expect(boundChannelAdmits(gateway, first.binding, first.status)).toBe(false);
      expect(connectionStands(gateway, second.binding)).toBe(true);
      expect(boundChannelAdmits(gateway, second.binding, second.status)).toBe(true);
    });
  });

  it("reads receive withdrawal live, then refuses an ancestor drop even though the leaf and inbox survive", async () => {
    const { gateway, ancestor, first } = await fixture();
    probes(gateway, () => {
      expect(connectionStands(gateway, first.binding)).toBe(true);
      expect(boundChannelAdmits(gateway, first.binding, first.status)).toBe(true);
    });
    await declare(gateway, LEAF, SEALED_LEEWAY, ROOT);
    probes(gateway, () => {
      expect(connectionStands(gateway, first.binding)).toBe(true);
      expect(boundChannelAdmits(gateway, first.binding, first.status)).toBe(false);
    });
    await declare(gateway, LEAF, RECEIVES, ROOT);
    expect(boundChannelAdmits(gateway, first.binding, first.status)).toBe(true);
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(OP), (t) => revocationClaims(ancestor.id, OP, t)),
        OP_SEED,
      ),
    ]);
    const table = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    );
    expect(table.containers.has(ROOT)).toBe(false);
    expect(table.containers.has(LEAF)).toBe(true);
    expect(openerStands(gateway, first.status)).toBe(true);
    probes(gateway, () => {
      expect(connectionStands(gateway, first.binding)).toBe(false);
      expect(boundChannelAdmits(gateway, first.binding, first.status)).toBe(false);
    });
  });
});
