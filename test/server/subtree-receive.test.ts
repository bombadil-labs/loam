// T263 — RECEIVE WITHIN THE SUBTREE (SPEC §58 position 2: "receive is a channel into a descendant
// of C from a source offered to this connection"; position 4: the container's `receive` switch).
//
// Bound to `ada:journal` with no grant, a connection opens a channel INTO its own subtree — the
// container itself or a descendant — and only where the container's leeway says receive is on.
// It is refused a channel into a sibling, into a name that merely shares the letters, into its
// parent, and under a prefix outside its fence; each refusal names the rule, not a grant. What
// arrives serves the connection and nobody else: the channel is recorded as opened by the
// container, its law folds into that container's surface (Myk's ruling, 2026-09-03), and the root
// surface never carries it. The plain `federate` grant road is untouched.
//
// "Offered" today means the peer hands its door token; the container-scoped offer token is T264.
//
// Railed at BOTH LEVELS: the channel RECORD (its `into` and `openedBy`) and what each door SERVES.
//
// NOT HERE, and said so: a renderer or resolver arriving on the channel — the walls slice; and
// the pool's bytes surviving a reboot, which is the backend's promise (§46) — this file pins that
// the RECORD survives with its opener and the root fold reads it.
//
// RAILS-RED on origin/main, this file copied in: 8 red, 1 green — 9 cases. The green is the
// CONTROL: the plain `federate` grant road, which this slice neither widens nor narrows.
//
// REVERT PROBES, MEASURED against this file as it stands — 9 cases. Re-measure when you add one.
//   the root fold keeps a connection's channel             → 2 red, 7 green
//   the bound fold drops the channel's rows                 → 3 red, 6 green
//   no subtree fence on `into`                              → 1 red, 8 green
//   no fence on the prefix                                  → 2 red, 7 green
//   the prefix fenced to the binding, not the target        → 1 red, 8 green
//   no leeway walk (receive always on)                      → 2 red, 7 green
//   the walk stops at a container that declared no leeway   → 1 red, 8 green
//   status and sever admit by the fence, not the opener     → 1 red, 8 green
//   status and sever admit by edge reach, not the opener    → 1 red, 8 green
//   the stamps carry no opener                              → 4 red, 5 green
//   the bound fold admits a foreign opener                  → 2 red, 7 green
//   no parent edge for a name a connection declares         → 2 red, 7 green
//   only the target is declared, not the middles            → 1 red, 8 green
//   the middles walk re-declares declared ancestors         → 1 red, 8 green
// Three of these were green until the rails were sharpened: the subtree fence, until the refusal
// cases carried a prefix INSIDE the fence (an outside prefix was refused for the prefix); the
// opener, until a PERSON-opened channel inside the subtree joined the sever case; and edge reach,
// until that channel's target was declared UNDER the container. The parent-edge and middles probes
// need the object level: introspection sees a field, only a read sees a row.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims, readContainerTable } from "../../src/gateway/container.js";
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

const PEER_SEED = "7a".repeat(32);
const PEER_TOKEN = "peer-door-token";
const HOLDER_SEED = "5c".repeat(32);
const HOLDER_TOKEN = "holder-token";
const RECEIVES: Leeway = { ...SEALED_LEEWAY, receive: true };

const peers: ServerHandle[] = [];
/** A second store with one lens and one row, served with an operator door token — the "offer". */
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
  });
  peers.push(handle);
  return `${handle.url}/default`;
}
const closePeers = async (): Promise<void> => {
  while (peers.length > 0) await new Promise<void>((r) => peers.pop()!.server.close(() => r()));
};

/**
 * Declare a container's leeway as the operator — the road the admin page takes. A standing
 * container is re-declared with its own record and the leeway added, so nothing else moves; a
 * new one is declared under `parent`.
 */
const declare = (
  gw: Gateway,
  container: string,
  leeway: Leeway,
  parent?: string,
): Promise<unknown> => {
  const standing = readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(container);
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
    signClaims(containerClaims(spec, OPERATOR, gw.nextTimestamp()), OPERATOR_SEED),
  ]);
};
const leewayOf = (gw: Gateway, container: string): Leeway | undefined =>
  readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(container)?.leeway;

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

/** The query fields a bearer is served — the object level. */
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
    // The record: into the descendant, opened by the container — the delta level.
    const channel = gateway.channelStatus().find((c) => c.into === "ada:journal:inbox");
    expect(channel?.openedBy).toBe("ada:journal");
    expect(channel?.prefix).toBe("ada:journal:inbox:peer");
    // What it serves: the peer's lens under the prefix, to the connection and to nobody else.
    expect(await servesPeer(base, ada, "ada:journal:inbox:peer")).toBe(true);
    expect(await servesPeer(base, "op-token", "ada:journal:inbox:peer"), "the root surface").toBe(
      false,
    );
    // Two-sided across containers too: a connection bound elsewhere is served nothing of it.
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
      // The prefix is INSIDE the fence here, so only the container rule can refuse — a prefix
      // outside it would be refused for the prefix, and the container fence would go unpinned.
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
    // The prefix is fenced to the TARGET: the annex receives, but not under the parent's names,
    // whose receive switch is off.
    const underParent = await receive(base, ada, "ada:journal:annex", peer, "ada:journal:peer");
    expect(underParent.isError).toBe(true);
    expect(underParent.text).toMatch(/outside ada:journal:annex:/);
    const annex = await receive(base, ada, "ada:journal:annex", peer);
    expect(annex.isError, annex.text).toBe(false);
    expect(gateway.channelStatus().map((c) => c.into)).toEqual(["ada:journal:annex"]);
    // A leeway change is a delta the next request obeys.
    await declare(gateway, "ada:journal", RECEIVES);
    const later = await receive(base, ada, "ada:journal:inbox", peer);
    expect(later.isError, later.text).toBe(false);
    await closePeers();
    await closeAll();
  });

  it("what arrives ANSWERS through the connection: the peer's row resolves, and nowhere else", async () => {
    // Introspection sees a field; only a read sees a row. A descendant the connection names is
    // declared under its path parent, so the bound read scope reaches the pool — law that is
    // served and answers nothing is the T189 shape.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", RECEIVES);
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:inbox", peer)).isError).toBe(false);
    expect(
      readContainerTable(gateway.reactor, gateway.operatorAuthor).containers.get(
        "ada:journal:inbox",
      )?.parent,
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
    expect(await height(ada)).toBe(11);
    expect(await height("op-token")).toBe("unserved");
    const bea = await connect(base, "bea", "notes");
    expect(await height(bea)).toBe("unserved");
    await closePeers();
    await closeAll();
  });

  it("a target two levels down is reached: the undeclared middle is declared under its parent too", async () => {
    // One level down the parent edge lands on a declared container. Two levels down it landed
    // on a name nothing declared, and reach — walked by declared edges — stopped at the top:
    // the peer's lens was served and answered null, one level lower than before.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", RECEIVES);
    const peer = await peerStore();
    const r = await receive(base, ada, "ada:journal:a:b", peer);
    expect(r.isError, r.text).toBe(false);
    const table = readContainerTable(gateway.reactor, gateway.operatorAuthor);
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
    // The first receive declared `ada:journal:a` with no leeway. Read as SEALED and stopped at,
    // it refused the next receive under it — and a second peer into the same target — while a
    // fresh middle beside it was admitted. A container that declared no leeway inherits; the
    // ancestor's own declaration is untouched by the receive that passed through.
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
    // A leeway change on the ancestor is a delta the next request obeys, through the middle.
    await declare(gateway, "ada:journal", SEALED_LEEWAY);
    const sealed = await receive(base, ada, "ada:journal:a:d", peer);
    expect(sealed.isError).toBe(true);
    expect(sealed.text).toMatch(/ada:journal does not receive/);
    await closePeers();
    await closeAll();
  });

  it("a plain `federate` grant holder is unchanged, and cannot receive into a container it was not granted", async () => {
    // CONTROL: the grant road. Red on neither side of this slice; it pins that the slice did not
    // widen or narrow the older door.
    const { base, gateway } = await connectionServer({
      tokens: { [HOLDER_TOKEN]: { actor: HOLDER_SEED } },
    });
    await gateway.append([
      signClaims(
        grantClaims(
          STORE_ENTITY,
          authorForSeed(HOLDER_SEED),
          "federate",
          OPERATOR,
          gateway.nextTimestamp(),
          "friends",
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
    // The pool's bytes surviving a reboot is the backend's promise (§46, railed on file-backed
    // homes); a memory backend keeps none. What THIS slice adds is on the RECORD: `openedBy` is
    // read back by the booted store, and the root fold reads it to leave the channel out.
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
    // A channel the PERSON opened into the same subtree is not the connection's to see or sever:
    // the opener decides, not the fence and not reach — the target is declared UNDER the
    // container first, so an admission by edge reach would let it through.
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
