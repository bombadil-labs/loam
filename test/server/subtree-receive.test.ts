import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims, readContainerTable } from "../../src/gateway/container-law.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SEALED_LEEWAY, type Leeway } from "../../src/gateway/leeway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import {
  closeAll,
  connect,
  connectionServer,
  OPERATOR,
  OPERATOR_SEED,
} from "../helpers/connection-fixture.js";
import { FERN, observed } from "../spike/garden.js";
import { withStamp } from "../../src/gateway/stamp.js";
import { channelRecordClaims } from "../../src/federation/channel.js";

const PEER_SEED = "7a".repeat(32);
const PEER_TOKEN = "peer-door-token";
const HOLDER_SEED = "5c".repeat(32);
const HOLDER_TOKEN = "holder-token";
const RECEIVES: Leeway = { ...SEALED_LEEWAY, receive: true };

const peers: ServerHandle[] = [];
async function peerStore(): Promise<string> {
  const peer = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: PEER_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  await peer.append([observed(FERN, "height", 11, peer.stamp(), PEER_SEED)]);
  const handle = await serve({
    mounts: { default: peer },
    tokens: { [PEER_TOKEN]: { operator: true } },
    port: 0,
  });
  peers.push(handle);
  return `${handle.url}/default`;
}
const closePeers = async (): Promise<void> => {
  while (peers.length > 0) await new Promise<void>((r) => peers.pop()!.server.close(() => r()));
};

const declare = (
  gw: Gateway,
  container: string,
  leeway: Leeway,
  parent?: string,
): Promise<unknown> => {
  const standing = readContainerTable(
    gw.reactor,
    gw.validityNow(),
    gw.operatorAuthor,
  ).containers.get(container);
  const spec =
    standing === undefined
      ? {
          container,
          trust: "curated" as const,
          posture: "separate" as const,
          ...(parent === undefined ? {} : { parent }),
          leeway,
        }
      : {
          container,
          trust: standing.trust,
          posture: standing.posture,
          ...(standing.parent === undefined ? {} : { parent: standing.parent }),
          ...(standing.membership === undefined ? {} : { membership: standing.membership }),
          ...(standing.membershipAt === undefined ? {} : { membershipAt: standing.membershipAt }),
          ...(standing.version === undefined ? {} : { version: standing.version }),
          leeway,
        };
  return gw.append([
    signClaims(
      withStamp(gw.stamp(OPERATOR), (t) => containerClaims(spec, OPERATOR, t)),
      OPERATOR_SEED,
    ),
  ]);
};
const leewayOf = (gw: Gateway, container: string): Leeway | undefined =>
  readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor).containers.get(container)
    ?.leeway;

async function callTool(
  base: string,
  bearer: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const res = await fetch(`${base}/default/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = (await res.json()) as {
    result?: { content?: { text?: string }[]; isError?: boolean };
  };
  return { text: body.result?.content?.[0]?.text ?? "", isError: body.result?.isError === true };
}
const receive = (
  base: string,
  bearer: string,
  into: string,
  from: string,
  prefix = `${into}:peer`,
) => callTool(base, bearer, "loam_federate_connect", { from, into, prefix, token: PEER_TOKEN });

async function fieldsOf(base: string, bearer: string | undefined): Promise<string[]> {
  const res = await fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify({ query: "{ __schema { queryType { fields { name } } } }" }),
  });
  const body = (await res.json()) as {
    data?: { __schema?: { queryType?: { fields?: { name: string }[] } } };
  };
  return (body.data?.__schema?.queryType?.fields ?? []).map((f) => f.name);
}
const servesPeer = async (
  base: string,
  bearer: string | undefined,
  prefix: string,
): Promise<boolean> =>
  (await fieldsOf(base, bearer)).some((f) => f.startsWith(prefix.replace(/[^A-Za-z0-9_]/g, "_")));

const RULE = /inside (its|your) own container|the path and its colon|descendant/i;

describe("§58 — receive within the subtree", () => {
  it("a bound connection receives into a descendant of its container, and only it is served", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", RECEIVES);
    expect(leewayOf(gateway, "ada:journal")?.receive, "premise: the leeway is declared").toBe(true);
    const peer = await peerStore();
    const r = await receive(base, ada, "ada:journal:inbox", peer);
    expect(r.isError, r.text).toBe(false);
    const channel = gateway.channelStatus().find((c) => c.into === "ada:journal:inbox");
    expect(channel?.openedBy).toBe("ada:journal");
    expect(channel?.prefix).toBe("ada:journal:inbox:peer");
    expect(await servesPeer(base, ada, "ada:journal:inbox:peer")).toBe(true);
    expect(await servesPeer(base, "op-token", "ada:journal:inbox:peer"), "the root surface").toBe(
      false,
    );
    const bea = await connect(base, "bea", "notes");
    expect(await servesPeer(base, bea, "ada:journal:inbox:peer"), "a sibling's surface").toBe(
      false,
    );
    expect(gateway.registered.map((r) => r.lensName ?? r.hyperschema.name)).not.toContainEqual(
      expect.stringMatching(/^ada:journal:inbox:peer/),
    );
    await closePeers();
    await closeAll();
  });

  it("refuses a sibling, a name sharing the letters, the parent, and a prefix outside the fence", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", RECEIVES);
    const peer = await peerStore();
    for (const into of ["ada:agent1", "ada:journalx:inbox", "ada", "friends"]) {
      const r = await receive(base, ada, into, peer, "ada:journal:peer");
      expect(r.isError, `into ${into}`).toBe(true);
      expect(r.text, `into ${into}`).toMatch(RULE);
      expect(r.text, `into ${into}: the container, not the prefix`).toMatch(
        new RegExp(`${into} is outside`),
      );
      expect(r.text, `into ${into}: no grant is wanted`).not.toMatch(/federate` grant/);
    }
    const outside = await receive(base, ada, "ada:journal:inbox", peer, "peer:x");
    expect(outside.isError).toBe(true);
    expect(outside.text).toMatch(RULE);
    expect(gateway.channelStatus()).toEqual([]);
    await closePeers();
    await closeAll();
  });

  it("obeys the leeway: receive off refuses the container's own channel; a child declared with receive on receives", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect(leewayOf(gateway, "ada:journal")?.receive ?? false, "premise: receive is off").toBe(
      false,
    );
    const peer = await peerStore();
    const own = await receive(base, ada, "ada:journal:inbox", peer);
    expect(own.isError).toBe(true);
    expect(own.text).toMatch(/receive/);
    await declare(gateway, "ada:journal:annex", RECEIVES, "ada:journal");
    const underParent = await receive(base, ada, "ada:journal:annex", peer, "ada:journal:peer");
    expect(underParent.isError).toBe(true);
    expect(underParent.text).toMatch(/outside ada:journal:annex:/);
    const annex = await receive(base, ada, "ada:journal:annex", peer);
    expect(annex.isError, annex.text).toBe(false);
    expect(gateway.channelStatus().map((c) => c.into)).toEqual(["ada:journal:annex"]);
    await declare(gateway, "ada:journal", RECEIVES);
    const later = await receive(base, ada, "ada:journal:inbox", peer);
    expect(later.isError, later.text).toBe(false);
    await closePeers();
    await closeAll();
  });

  it("what arrives ANSWERS through the connection: the peer's row resolves, and nowhere else", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", RECEIVES);
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:inbox", peer)).isError).toBe(false);
    expect(
      readContainerTable(
        gateway.reactor,
        gateway.validityNow(),
        gateway.operatorAuthor,
      ).containers.get("ada:journal:inbox")?.parent,
    ).toBe("ada:journal");
    const height = async (bearer: string | undefined): Promise<unknown> => {
      const res = await fetch(`${base}/default/graphql`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
        },
        body: JSON.stringify({
          query: `{ ada_journal_inbox_peer_Plant(entity: "${FERN}") { height } }`,
        }),
      });
      const body = (await res.json()) as {
        data?: Record<string, { height?: unknown } | null>;
        errors?: unknown[];
      };
      return body.errors !== undefined
        ? "unserved"
        : (body.data?.ada_journal_inbox_peer_Plant?.height ?? null);
    };
    await gateway.append([observed(FERN, "height", 999, gateway.stamp(), OPERATOR_SEED)]);
    expect(await height(ada)).toBe(11);
    expect(await height("op-token")).toBe("unserved");
    const bea = await connect(base, "bea", "notes");
    expect(await height(bea)).toBe("unserved");
    const status = gateway.channelStatus().find((c) => c.openedBy === "ada:journal")!;
    const claims = withStamp(gateway.stamp(), (stamp) =>
      channelRecordClaims(status, OPERATOR, stamp),
    );
    await gateway.append([
      gateway.signer!.sign({
        ...claims,
        pointers: claims.pointers.filter((p) => p.role !== "prefix"),
      }),
    ]);
    const heads = [
      gateway,
      ...[...gateway.store.tableOf(gateway).inboxes.values()].flatMap((p) =>
        p.gateway === undefined ? [] : [p.gateway],
      ),
    ].map((g) => ({ g, head: g.peer!.journal.currentHead() }));
    for (const query of [
      `{ ada_journal_inbox_peer_Plant(entity: "${FERN}") { height } }`,
      `mutation { ada_journal_inbox_peer_Plant(entity: "${FERN}", height: 123) { height } }`,
    ]) {
      const response = await fetch(`${base}/default/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ada}` },
        body: JSON.stringify({ query }),
      });
      const result = (await response.json()) as { errors?: unknown; data?: unknown };
      expect(JSON.stringify(result.errors)).toMatch(/does not carry its prefix/);
      expect(JSON.stringify(result.data ?? {})).not.toContain("999");
      for (const { g, head } of heads) expect(g.peer!.journal.currentHead()).toBe(head);
    }
    await closePeers();
    await closeAll();
  });

  it("a target two levels down is reached: the undeclared middle is declared under its parent too", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", RECEIVES);
    const peer = await peerStore();
    const r = await receive(base, ada, "ada:journal:a:b", peer);
    expect(r.isError, r.text).toBe(false);
    const table = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    );
    expect(table.containers.get("ada:journal:a")?.parent).toBe("ada:journal");
    expect(table.containers.get("ada:journal:a:b")?.parent).toBe("ada:journal:a");
    const res = await fetch(`${base}/default/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ada}` },
      body: JSON.stringify({
        query: `{ ada_journal_a_b_peer_Plant(entity: "${FERN}") { height } }`,
      }),
    });
    const body = (await res.json()) as { data?: Record<string, { height?: unknown } | null> };
    expect(body.data?.ada_journal_a_b_peer_Plant?.height).toBe(11);
    await closePeers();
    await closeAll();
  });

  it("a middle a receive brought into being is a pure namespace: the next receive under it inherits", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", RECEIVES);
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:a:b", peer)).isError).toBe(false);
    expect(leewayOf(gateway, "ada:journal")?.receive, "the ancestor's declaration stands").toBe(
      true,
    );
    const under = await receive(base, ada, "ada:journal:a:c", peer);
    expect(under.isError, under.text).toBe(false);
    const again = await receive(base, ada, "ada:journal:a:b", peer, "ada:journal:a:b:peer2");
    expect(again.isError, again.text).toBe(false);
    await declare(gateway, "ada:journal", SEALED_LEEWAY);
    const sealed = await receive(base, ada, "ada:journal:a:d", peer);
    expect(sealed.isError).toBe(true);
    expect(sealed.text).toMatch(/ada:journal does not receive/);
    await closePeers();
    await closeAll();
  });

  it("a road that re-declares a standing container carries the leeway it found: sealed stays sealed, silent stays silent", async () => {
    const { gateway } = await connectionServer();
    const listing = (program: string): string => `container:hyperschema:${program}`;
    await gateway.list("Plant", { limit: 1 });
    await declare(gateway, listing("Plant"), SEALED_LEEWAY);
    const before = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    );
    expect(before.containers.get(listing("Plant"))?.leewayDeclared).toBe(true);
    await gateway.publishRegistration({ ...PLANT, name: "Bed" }, { ...PLANT_POLICY, name: "Bed" }, [
      FERN,
    ]);
    await gateway.publishRegistration(
      PLANT,
      { ...PLANT_POLICY, props: new Map([...PLANT_POLICY.props, ["girth", PLANT_POLICY.default]]) },
      [FERN],
    );
    await gateway.list("Plant", { limit: 1 });
    await gateway.list("Bed", { limit: 1 });
    await gateway.publishRegistration(
      { ...PLANT, name: "Bed" },
      {
        ...PLANT_POLICY,
        name: "Bed",
        props: new Map([...PLANT_POLICY.props, ["girth", PLANT_POLICY.default]]),
      },
      [FERN],
    );
    await gateway.list("Bed", { limit: 1 });
    const after = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    );
    expect(after.containers.get(listing("Plant"))?.leewayDeclared, "sealed stays sealed").toBe(
      true,
    );
    expect(after.containers.get(listing("Plant"))?.leeway.receive).toBe(false);
    expect(after.containers.get(listing("Bed"))?.leewayDeclared, "silent stays silent").toBe(false);
    await closeAll();
  });

  it("a plain `federate` grant holder is unchanged, and cannot receive into a container it was not granted", async () => {
    const { base, gateway } = await connectionServer({
      tokens: { [HOLDER_TOKEN]: { actor: HOLDER_SEED } },
    });
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(OPERATOR), (t) =>
          grantClaims(STORE_ENTITY, authorForSeed(HOLDER_SEED), "federate", OPERATOR, t, "friends"),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const peer = await peerStore();
    expect((await receive(base, HOLDER_TOKEN, "friends", peer, "friends:peer")).isError).toBe(
      false,
    );
    const refused = await receive(base, HOLDER_TOKEN, "ada:journal:inbox", peer);
    expect(refused.isError).toBe(true);
    await closePeers();
    await closeAll();
  });

  it("the record survives a reboot with its opener, and the root fold still leaves it out", async () => {
    const primary = new MemoryBackend();
    const { base, gateway } = await connectionServer({ primary });
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", RECEIVES);
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:inbox", peer)).isError).toBe(false);
    await closeAll();
    const again = await Gateway.open(primary, { seed: OPERATOR_SEED });
    await again.resumeChannels();
    const standing = again.channelStatus().find((c) => c.into === "ada:journal:inbox");
    expect(standing?.openedBy).toBe("ada:journal");
    expect(again.registered.map((r) => r.lensName ?? r.hyperschema.name)).not.toContainEqual(
      expect.stringMatching(/^ada:journal:inbox:peer/),
    );
    await closePeers();
  });

  it("a connection sees and severs only the channels its container opened", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const bea = await connect(base, "bea", "notes");
    await declare(gateway, "ada:journal", RECEIVES);
    const peer = await peerStore();
    const opened = await receive(base, ada, "ada:journal:inbox", peer);
    expect(opened.isError, opened.text).toBe(false);
    const channel = (JSON.parse(opened.text) as { channel: string }).channel;
    const mine = await callTool(base, ada, "loam_federate_status", {});
    expect(mine.isError, mine.text).toBe(false);
    expect(mine.text).toMatch(/ada:journal:inbox/);
    await declare(gateway, "ada:journal:other", SEALED_LEEWAY, "ada:journal");
    await gateway.openChannel({
      into: "ada:journal:other",
      prefix: "ada:journal:other:theirs",
      source: { pull: () => Promise.resolve([]) },
    });
    const mineAgain = await callTool(base, ada, "loam_federate_status", {});
    expect(mineAgain.text).not.toMatch(/ada:journal:other/);
    const theirs = gateway.channelStatus().find((c) => c.into === "ada:journal:other")!.name;
    expect((await callTool(base, ada, "loam_federate_drop", { channel: theirs })).isError).toBe(
      true,
    );
    const hers = await callTool(base, bea, "loam_federate_status", {});
    expect(hers.isError, hers.text).toBe(false);
    expect(hers.text).not.toMatch(/ada:journal/);
    const sever = await callTool(base, bea, "loam_federate_drop", { channel });
    expect(sever.isError).toBe(true);
    expect(sever.text).not.toMatch(/federate` grant/);
    const set = await callTool(base, bea, "loam_federate_set", { channel, receiving: false });
    expect(set.isError).toBe(true);
    expect(set.text).not.toMatch(/federate grant/);
    const own = await callTool(base, ada, "loam_federate_drop", { channel });
    expect(own.isError, own.text).toBe(false);
    await closePeers();
    await closeAll();
  });
});
