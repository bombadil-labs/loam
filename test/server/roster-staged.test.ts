import { describe, expect, it } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import { readContainerTable } from "../../src/gateway/container-law.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { SEALED_LEEWAY, type Leeway } from "../../src/gateway/leeway.js";
import { containerClaims } from "../../src/gateway/container-law.js";
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

const PEER_SEED = "7a".repeat(32);
const PEER_TOKEN = "peer-door-token";
const OPEN: Leeway = {
  ...SEALED_LEEWAY,
  receive: true,
  delegate: { receive: true, offer: true, publish: true, envelope: "large", delegate: "same" },
};

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
    host: "127.0.0.1",
  });
  peers.push(handle);
  return `${handle.url}/default`;
}
const closePeers = async (): Promise<void> => {
  while (peers.length > 0) await new Promise<void>((r) => peers.pop()!.server.close(() => r()));
};

const declareAs = (gw: Gateway, container: string, leeway: Leeway): Promise<unknown> => {
  const standing = readContainerTable(
    gw.reactor,
    gw.validityNow(),
    gw.operatorAuthor,
  ).containers.get(container);
  return gw.append([
    signClaims(
      withStamp(gw.stamp(OPERATOR), (t) =>
        containerClaims(
          {
            container,
            trust: standing?.trust ?? ("curated" as const),
            posture: standing?.posture ?? ("separate" as const),
            ...(standing?.parent === undefined ? {} : { parent: standing.parent }),
            ...(standing?.membership === undefined ? {} : { membership: standing.membership }),
            ...(standing?.membershipAt === undefined
              ? {}
              : { membershipAt: standing.membershipAt }),
            ...(standing?.version === undefined ? {} : { version: standing.version }),
            leeway,
          },
          OPERATOR,
          t,
        ),
      ),
      OPERATOR_SEED,
    ),
  ]);
};

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

async function withChannel(): Promise<{
  base: string;
  gateway: Gateway;
  ada: string;
  channel: string;
  poolSize: number;
}> {
  const { base, gateway } = await connectionServer();
  const ada = await connect(base, "ada", "journal");
  await declareAs(gateway, "ada:journal", OPEN);
  const from = await peerStore();
  const opened = await callTool(base, ada, "loam_container_receive", {
    from,
    into: "ada:journal",
    prefix: "ada:journal:peer",
    token: PEER_TOKEN,
  });
  expect(opened.isError, opened.text).toBe(false);
  const channel = gateway.channelStatus()[0]!.name;
  const pool = gateway.channelPools.get(channel)!.gateway!;
  return { base, gateway, ada, channel, poolSize: [...pool.reactor.snapshot()].length };
}

async function toolNamed(
  base: string,
  want: string,
): Promise<
  { name: string; description?: string; annotations?: Record<string, unknown> } | undefined
> {
  const res = await fetch(`${base}/default/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer op-token`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const body = (await res.json()) as {
    result?: {
      tools?: { name: string; description?: string; annotations?: Record<string, unknown> }[];
    };
  };
  return (body.result?.tools ?? []).find((t) => t.name === want);
}

describe("§58 — the roster stages, and a person decides", () => {
  it("sever wants the channel by name, and stages nothing without one", async () => {
    const { base, gateway, ada, channel } = await withChannel();
    for (const args of [{}, { channel: 7 }, { channel: ["x"] }, { channel: null }]) {
      const r = await callTool(base, ada, "loam_container_sever", args);
      expect(r.isError, `${JSON.stringify(args)} is refused`).toBe(true);
      expect(r.text, "and it asks for the name").toMatch(/wants the `channel`/);
      expect(r.text, "without naming one it picked").not.toContain(channel);
    }
    expect(gateway.channelStatus().length, "and the channel stands").toBe(1);
    await closePeers();
    await closeAll();
  });

  it("sever hands back a preview and a link, and purges nothing", async () => {
    const { base, gateway, ada, channel, poolSize } = await withChannel();
    const staged = await callTool(base, ada, "loam_container_sever", { channel });
    expect(staged.isError, staged.text).toBe(false);
    const said = JSON.parse(staged.text) as {
      channel: string;
      purgedNothing: boolean;
      confirmAt: string;
      wouldPurge: string[];
      wouldSurvive: string[];
    };
    expect(said.channel).toBe(channel);
    expect(said.purgedNothing, "it says so plainly").toBe(true);
    expect(said.confirmAt, "and hands a person the page").toContain("/admin/container");
    for (const verb of ["loam_container_sever", "loam_federate_drop"]) {
      const described = await toolNamed(base, verb);
      expect(described, `${verb} is offered`).toBeDefined();
      expect(described!.description, `${verb} promises no expiry`).not.toMatch(/expiry/);
      expect(described!.description, `${verb} promises no staged id`).not.toMatch(/staged id/);
    }
    expect(said.wouldPurge.join(" "), "naming what would go").toContain(channel);
    expect(said.wouldSurvive.join(" "), "and naming what stays").toContain("ada:journal");

    expect(
      gateway.channelStatus().some((c) => c.name === channel),
      "the channel stands",
    ).toBe(true);
    const pool = gateway.channelPools.get(channel)?.gateway;
    expect(pool, "the pool is still attached").toBeDefined();
    expect([...pool!.reactor.snapshot()].length, "with every delta it had").toBe(poolSize);
    await closePeers();
    await closeAll();
  });

  it("sever and federate_drop are one road: same caller, same answer", async () => {
    const { base, gateway, ada, channel } = await withChannel();
    const underRoster = await callTool(base, ada, "loam_container_sever", { channel });
    const underFederate = await callTool(base, ada, "loam_federate_drop", { channel });
    expect(underRoster.isError).toBe(underFederate.isError);
    expect(underRoster.text, "word for word").toBe(underFederate.text);

    const foreign = "channel:bea:notes:someone";
    const rosterNo = await callTool(base, ada, "loam_container_sever", { channel: foreign });
    const federateNo = await callTool(base, ada, "loam_federate_drop", { channel: foreign });
    expect(rosterNo.isError, rosterNo.text).toBe(true);
    expect(rosterNo.text).toBe(federateNo.text);
    expect(gateway.channelStatus().length, "and nothing was severed").toBe(1);
    await closePeers();
    await closeAll();
  });

  it("promote-stage nominates one output and adopts nothing", async () => {
    const { base, gateway, ada } = await withChannel();
    const before = [...gateway.reactor.snapshot()].length;
    const mine = gateway.containerScope({ containers: ["ada:journal"] })[0];
    expect(mine, "premise: the container gathers something").toBeDefined();

    const staged = await callTool(base, ada, "loam_container_promote_stage", { delta: mine!.id });
    expect(staged.isError, staged.text).toBe(false);
    const said = JSON.parse(staged.text) as {
      delta: string;
      movedNothing: boolean;
      confirmAt: string;
    };
    expect(said.delta).toBe(mine!.id);
    expect(said.movedNothing, "it says so plainly").toBe(true);
    expect(said.confirmAt).toContain("/admin/container");
    expect([...gateway.reactor.snapshot()].length, "nothing was adopted").toBe(before);
    await closePeers();
    await closeAll();
  });

  it("promote-stage asks the gather, and names nothing outside it", async () => {
    const { base, gateway, ada } = await withChannel();
    await connect(base, "bea", "notes");
    const before = [...gateway.reactor.snapshot()].length;
    const beaHeld = gateway.containerScope({ containers: ["bea:notes"] })[0];
    expect(beaHeld, "premise: bea's container holds something").toBeDefined();
    expect(
      gateway.containerScope({ containers: ["ada:journal"] }).some((d) => d.id === beaHeld!.id),
      "premise: and it is outside ada's gather",
    ).toBe(false);
    const elsewhere = await callTool(base, ada, "loam_container_promote_stage", {
      delta: beaHeld!.id,
    });
    const invented = await callTool(base, ada, "loam_container_promote_stage", {
      delta: "0".repeat(64),
    });
    expect(invented.isError, invented.text).toBe(true);
    expect(invented.text).toMatch(/nothing in ada:journal's gather/);
    expect(elsewhere.isError, elsewhere.text).toBe(true);
    expect(elsewhere.text, "word for word what a name nobody holds gets").toBe(invented.text);
    expect(elsewhere.text, "and it names no other container").not.toContain("bea:notes");
    expect([...gateway.reactor.snapshot()].length, "and nothing was adopted").toBe(before);
    await closePeers();
    await closeAll();
  });

  it("promote-stage refuses a delta the primary ground already holds", async () => {
    const { base, gateway, ada } = await withChannel();
    const primary = gateway
      .containerScope({ containers: ["ada:journal"] })
      .find((d) => gateway.reactor.get(d.id) !== undefined);
    expect(primary, "premise: the gather holds something the primary already has").toBeDefined();
    const staged = await callTool(base, ada, "loam_container_promote_stage", {
      delta: primary!.id,
    });
    expect(staged.isError, staged.text).toBe(true);
    expect(staged.text).toMatch(/already lives in the primary ground/);
    await closePeers();
    await closeAll();
  });

  it("an unbound caller cannot stage a promotion, and is told where one happens", async () => {
    const { base } = await withChannel();
    const refused = await callTool(base, "op-token", "loam_container_promote_stage", {
      delta: "0".repeat(64),
    });
    expect(refused.isError, refused.text).toBe(true);
    expect(refused.text, "and it names the road a person takes").toMatch(
      /A person promotes from the container's own page/,
    );
    await closePeers();
    await closeAll();
  });

  it("both staged verbs are advertised, and neither claims to be a read", async () => {
    const { base } = await withChannel();
    const res = await fetch(`${base}/default/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer op-token`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const body = (await res.json()) as {
      result?: { tools?: { name: string; annotations?: Record<string, unknown> }[] };
    };
    const tools = body.result?.tools ?? [];
    for (const verb of ["loam_container_sever", "loam_container_promote_stage"]) {
      const found = tools.find((t) => t.name === verb);
      expect(found, `${verb} is offered`).toBeDefined();
      expect(found!.annotations?.["readOnlyHint"], `${verb} is not a read`).toBe(false);
    }
    await closePeers();
    await closeAll();
  });
});
