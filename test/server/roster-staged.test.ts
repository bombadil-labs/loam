// T263 — THE ROSTER'S STAGED ACTS (SPEC §58 position 3): `sever` and `promote-stage`.
//
// Both verbs answer the same way and for the same reason: an agent NOMINATES and a person DECIDES.
// Neither moves a byte. `sever` purges a peer's pool, and `promote` re-signs a claim under the
// store's own name in canonical history, where erasure is the only way back out — so both hand
// back a preview and a link, and the act itself happens behind a session gate a connector token
// can never obtain. MCP callers are a TokenIdentity; the admin door sits behind SessionGate. They
// are different authentication paths, not one path with a flag.
//
// `sever` is `loam_federate_drop` under the roster's name: ONE ROAD, TWO NAMES, so the two cannot
// answer one caller differently. That is the same shape `receive` takes, and the same reason.
//
// THE PROPERTY THAT MATTERS MOST IS A NEGATIVE ONE, so every case asserts it at the bytes: after
// the call, the channel still stands, the pool's deltas are all still there, and the store's own
// ground holds nothing new. A staged act that quietly acted would be the worst defect this file
// could miss, and `isError: false` alone cannot see it.
//
// NOT HERE, and said so: `bless-renderer` is the roster's sixth verb and decides a new capability,
// so it ships in its own change. The admin page's own promote and drop roads are railed where they
// live (admin-promote.test.ts, admin-channel-drop.test.ts); this file pins only that the roster
// hands a person to them without doing their work.
//
// RAILS-RED on origin/main, this file copied in: 6 red, 0 green — 6 cases. No control.
//
// One case was green on the base at first, and the reason is worth keeping. A store without these
// tools answers "unknown tool", which is an error like any other — so a case asserting only that a
// refusal HAPPENED passed where the feature did not exist. It now matches the verb's own sentence.
//
// REVERT PROBES, MEASURED against this file as it stands — 8 cases.
//   sever is not routed to the staged road          → 2 red, 6 green
//   sever stages an unnamed channel                 → 1 red, 7 green
//   promote-stage does not ask the gather           → 1 red, 7 green
//   promote-stage skips the primary-ground gate     → 1 red, 7 green
//   promote-stage admits an unbound caller          → 1 red, 7 green
//   the preview names only the other channels       → 1 red, 7 green
//   the roster block swallows the staged verbs      → 1 red, 7 green (and 1 red in container-tools)
//   the promote fault is echoed to the caller       → 0 red, 8 green
//   a description promises an expiry it lacks       → 1 red, 7 green
//
// THE LAST PROBE IS GREEN, AND THAT IS THE HONEST RECORD. `containerScope` throws only when a
// SEPARATE container in the gather is not attached, and this fixture has no detached pool to
// build one with. The guard maps that throw onto a fixed sentence and logs the detail, because
// the raw refusal names the container it could not attach — which can be a sibling pool the
// caller never opened. It is written down rather than deleted.

import { describe, expect, it } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import { readContainerTable } from "../../src/gateway/container.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { SEALED_LEEWAY, type Leeway } from "../../src/gateway/leeway.js";
import { containerClaims } from "../../src/gateway/container.js";
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
  await peer.append([observed(FERN, "height", 11, peer.nextTimestamp(), PEER_SEED)]);
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
  const standing = readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(container);
  return gw.append([
    signClaims(
      containerClaims(
        {
          container,
          trust: standing?.trust ?? ("curated" as const),
          posture: standing?.posture ?? ("separate" as const),
          ...(standing?.parent === undefined ? {} : { parent: standing.parent }),
          ...(standing?.membership === undefined ? {} : { membership: standing.membership }),
          ...(standing?.membershipAt === undefined ? {} : { membershipAt: standing.membershipAt }),
          ...(standing?.version === undefined ? {} : { version: standing.version }),
          leeway,
        },
        OPERATOR,
        gw.nextTimestamp(),
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

/** A store with a bound connection, an open leeway, and one live channel into the container. */
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

/** One tool's declaration, as the door advertises it. */
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
    // `channelStatus(undefined)` returns EVERY channel, so an omitted argument used to stage the
    // FIRST one the caller could reach — handing back a ready confirm link and a `--yes` command
    // line for a channel nobody chose. It purges nothing by itself, and it is still the one
    // artifact of this road that leads to a real deletion.
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
    // AND THE DESCRIPTION PROMISES ONLY WHAT THE REPLY CARRIES. Both names of this act once said
    // they return an expiry, and a staged id; there is neither. A tool description is read by a
    // machine that will plan around it, so an overclaim there is the same defect as an overclaim
    // in the preview — which is what this whole file is about.
    for (const verb of ["loam_container_sever", "loam_federate_drop"]) {
      const described = await toolNamed(base, verb);
      expect(described, `${verb} is offered`).toBeDefined();
      expect(described!.description, `${verb} promises no expiry`).not.toMatch(/expiry/);
      expect(described!.description, `${verb} promises no staged id`).not.toMatch(/staged id/);
    }
    expect(said.wouldPurge.join(" "), "naming what would go").toContain(channel);
    // TWO-SIDED, LIKE EVERY OTHER PREVIEW OF A REMOVAL. `wouldSurvive` listing only the OTHER
    // channels is an empty array on a store with one, under a field name that reads as a claim
    // that nothing survives. The container the channel receives into does.
    expect(said.wouldSurvive.join(" "), "and naming what stays").toContain("ada:journal");

    // AT THE BYTES, which is the only assertion that can see a staged act that acted.
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

    // And a channel this container did not open is refused under BOTH names, the same way.
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
    // AT THE BYTES: the store's own ground is exactly as large as it was.
    expect([...gateway.reactor.snapshot()].length, "nothing was adopted").toBe(before);
    await closePeers();
    await closeAll();
  });

  it("promote-stage asks the gather, and names nothing outside it", async () => {
    const { base, gateway, ada } = await withChannel();
    // A delta that EXISTS and is NOT in this container's gather: bea's own container holds it.
    // The refusal must not confirm that it exists anywhere — the same no-oracle rule the admin
    // page's promote gate keeps. An invented id would be answered the same way, which is the
    // point: the two must be indistinguishable.
    await connect(base, "bea", "notes");
    const before = [...gateway.reactor.snapshot()].length;
    const beaHeld = gateway.containerScope({ containers: ["bea:notes"] })[0];
    // ASSERTED, NOT ASSUMED. Guarding the comparison behind `if (beaHeld)` would let the whole
    // point of this case vanish the day the fixture stops yielding one — which is the shape this
    // case was rewritten to repair.
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
    // THE SECOND GATE THE PAGE ASKS. A delta already in the primary has nothing left to move, and
    // the page renders no control for it — so staging one hands a person a link to a button that
    // is not there, over a preview naming something that can never be adopted. A preview must be
    // true of what a completion would do.
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
    // THE VERB'S OWN REFUSAL, not a door that never heard of it. A store without this tool answers
    // "unknown tool", which is also an error and would satisfy a looser assertion — so the case
    // would pass on a base where the feature does not exist at all.
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
      // A shell reads readOnlyHint as a licence to cache and REPLAY. Both of these stage an act.
      expect(found!.annotations?.["readOnlyHint"], `${verb} is not a read`).toBe(false);
    }
    await closePeers();
    await closeAll();
  });
});
