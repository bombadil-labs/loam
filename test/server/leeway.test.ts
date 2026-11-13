import { describe, expect, it } from "vitest";
import { makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import {
  channelName,
  channelRecordClaims,
  type ChannelStatus,
} from "../../src/federation/channel.js";
import {
  DEFAULT_QUARANTINE_ENVELOPE,
  ENVELOPE_ANY,
  envelopeClaims,
} from "../../src/gateway/envelope.js";
import { containerClaims, inboxName, readContainerTable } from "../../src/gateway/container-law.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SEALED_LEEWAY, type Leeway, type Terms } from "../../src/gateway/leeway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import {
  OPERATOR,
  OPERATOR_SEED,
  closeAll,
  connect,
  connectionServer,
  consent,
  grantOf,
  pkce,
  poolOf,
  redeem,
} from "../helpers/connection-fixture.js";
import { FERN } from "../spike/garden.js";
import { withStamp } from "../../src/gateway/stamp.js";

const PEER_SEED = "7a".repeat(32);
const PEER_TOKEN = "peer-door-token";
const TERMS_RECEIVE: Terms = {
  receive: true,
  offer: false,
  publish: false,
  envelope: "small",
  delegate: "off",
};
const TERMS_NONE: Terms = {
  receive: false,
  offer: false,
  publish: false,
  envelope: "small",
  delegate: "off",
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
      withStamp(gw.stamp(), (t) => containerClaims(spec, OPERATOR, t)),
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
const receive = (base: string, bearer: string, into: string, from: string) =>
  callTool(base, bearer, "loam_federate_connect", {
    from,
    into,
    prefix: `${into}:peer`,
    token: PEER_TOKEN,
  });
async function fieldsOf(base: string, bearer: string): Promise<string[]> {
  const res = await fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ query: "{ __schema { queryType { fields { name } } } }" }),
  });
  const body = (await res.json()) as {
    data?: { __schema?: { queryType?: { fields?: { name: string }[] } } };
  };
  return (body.data?.__schema?.queryType?.fields ?? []).map((f) => f.name);
}
const connectTo = async (base: string, user: string, container: string): Promise<string> => {
  const p = pkce();
  const { code, status } = await consent(base, user, p.challenge, { bind: container });
  expect(status, `consent to ${container}`).toBe(302);
  const res = await redeem(base, code, p.verifier);
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
};
const servesPeer = async (base: string, bearer: string, prefix: string): Promise<boolean> =>
  (await fieldsOf(base, bearer)).some((f) => f.startsWith(prefix.replace(/[^A-Za-z0-9_]/g, "_")));
const envelopeOf = (gw: Gateway, container: string) =>
  gw.envelopeReports().find((r) => r.container === container)?.envelope;
const wideCeiling = (gw: Gateway): Promise<unknown> =>
  gw.append([
    signClaims(
      withStamp(gw.stamp(), (t) =>
        envelopeClaims(
          ENVELOPE_ANY,
          { maxConcurrentRenders: 32, renderTimeoutMs: 4000, maxMemoryMb: 1024 },
          OPERATOR,
          t,
        ),
      ),
      OPERATOR_SEED,
    ),
  ]);

describe("§58 — leeway fits its parent's terms, and cascades", () => {
  it("delegate off makes a pure namespace: a child leeway is refused with the sentence naming the ceiling; a leewayless child binds", async () => {
    const { gateway } = await connectionServer();
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, delegate: "off" });
    await expect(
      declare(gateway, "ada:journal:annex", { ...SEALED_LEEWAY, receive: true }, "ada:journal"),
    ).rejects.toThrow(/delegates nothing|fit/);
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:journal:plain",
              trust: "curated",
              posture: "separate",
              parent: "ada:journal",
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    expect(
      readContainerTable(
        gateway.reactor,
        gateway.validityNow(),
        gateway.operatorAuthor,
      ).containers.has("ada:journal:plain"),
    ).toBe(true);
    await closeAll();
  });

  it("receive off with delegate {receive: on}: the room's own channel refuses while an annex with receive on binds and receives", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", {
      ...SEALED_LEEWAY,
      receive: false,
      delegate: TERMS_RECEIVE,
    });
    await declare(gateway, "ada:journal:annex", { ...SEALED_LEEWAY, receive: true }, "ada:journal");
    const peer = await peerStore();
    const own = await receive(base, ada, "ada:journal:inbox", peer);
    expect(own.isError).toBe(true);
    expect(own.text).toMatch(/ada:journal does not receive/);
    const annex = await receive(base, ada, "ada:journal:annex", peer);
    expect(annex.isError, annex.text).toBe(false);
    expect(await servesPeer(base, ada, "ada:journal:annex:peer")).toBe(true);
    await closePeers();
    await closeAll();
  });

  it("delegate {receive: off} refuses that same annex, and an envelope above the terms' ceiling is refused", async () => {
    const { gateway } = await connectionServer();
    await declare(
      gateway,
      "ada:journal",
      { ...SEALED_LEEWAY, receive: true, delegate: TERMS_NONE },
      undefined,
    );
    await expect(
      declare(gateway, "ada:journal:annex", { ...SEALED_LEEWAY, receive: true }, "ada:journal"),
    ).rejects.toThrow(/receive|fit/);
    await expect(
      declare(gateway, "ada:journal:big", { ...SEALED_LEEWAY, envelope: "large" }, "ada:journal"),
    ).rejects.toThrow(/envelope|fit/);
    await declare(
      gateway,
      "ada:journal:small",
      { ...SEALED_LEEWAY, envelope: "small" },
      "ada:journal",
    );
    expect(
      readContainerTable(
        gateway.reactor,
        gateway.validityNow(),
        gateway.operatorAuthor,
      ).containers.get("ada:journal:small")?.leewayDeclared,
    ).toBe(true);
    await closeAll();
  });

  it("a parent tightened AFTER its child declared narrows the child on the next request", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", {
      ...SEALED_LEEWAY,
      receive: false,
      delegate: TERMS_RECEIVE,
    });
    await declare(gateway, "ada:journal:annex", { ...SEALED_LEEWAY, receive: true }, "ada:journal");
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:annex", peer)).isError).toBe(false);
    await declare(gateway, "ada:journal", {
      ...SEALED_LEEWAY,
      receive: false,
      delegate: TERMS_NONE,
    });
    const later = await receive(base, ada, "ada:journal:annex:more", peer);
    expect(later.isError, "the tightened parent governs on the next request").toBe(true);
    expect(later.text).toMatch(/does not receive/);
    await closePeers();
    await closeAll();
  });

  it("terms about GRANDCHILDREN govern grandchildren: a tightening two levels up binds on the next request", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const wide: Terms = { ...TERMS_RECEIVE, delegate: { ...TERMS_RECEIVE } };
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, delegate: wide });
    await declare(
      gateway,
      "ada:journal:c",
      { ...SEALED_LEEWAY, receive: true, delegate: TERMS_RECEIVE },
      "ada:journal",
    );
    await declare(gateway, "ada:journal:c:g", { ...SEALED_LEEWAY, receive: true }, "ada:journal:c");
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:c:g", peer)).isError, "before").toBe(false);
    const narrow: Terms = { ...TERMS_RECEIVE, delegate: { ...TERMS_NONE } };
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, delegate: narrow });
    const later = await receive(base, ada, "ada:journal:c:g:more", peer);
    expect(later.isError, "the grandchild stopped receiving").toBe(true);
    expect(later.text).toMatch(/does not receive/);
    await expect(
      declare(gateway, "ada:journal:c:g2", { ...SEALED_LEEWAY, receive: true }, "ada:journal:c"),
    ).rejects.toThrow(/does not fit the terms/);
    expect((await receive(base, ada, "ada:journal:c", peer)).isError, "the child").toBe(false);
    await closePeers();
    await closeAll();
  });

  it("terms written three levels deep govern three levels deep, through containers that declared nothing", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const deep: Terms = {
      ...TERMS_RECEIVE,
      delegate: { ...TERMS_RECEIVE, delegate: { ...TERMS_NONE } },
    };
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, delegate: deep });
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:c", peer)).isError, "the child").toBe(false);
    expect((await receive(base, ada, "ada:journal:c:g", peer)).isError, "the grandchild").toBe(
      false,
    );
    const deeper = await receive(base, ada, "ada:journal:c:g:h", peer);
    expect(deeper.isError, "the great-grandchild").toBe(true);
    expect(deeper.text).toMatch(/does not receive/);
    await closePeers();
    await closeAll();
  });

  it("a receive switch turned off after a channel opened stops serving it on the next request", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true });
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:inbox", peer)).isError).toBe(false);
    expect(await servesPeer(base, ada, "ada:journal:inbox:peer")).toBe(true);
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: false });
    expect(await servesPeer(base, ada, "ada:journal:inbox:peer"), "receive off").toBe(false);
    const status = await callTool(base, ada, "loam_federate_status", {});
    expect(status.text).not.toMatch(/ada:journal:inbox/);
    expect(gateway.channelStatus().some((c) => c.into === "ada:journal:inbox")).toBe(true);
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true });
    expect(await servesPeer(base, ada, "ada:journal:inbox:peer"), "receive on again").toBe(true);
    await closePeers();
    await closeAll();
  });

  it("a bound record that names an opener but no binding serves nobody", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true });
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:inbox", peer)).isError).toBe(false);
    expect(await servesPeer(base, ada, "ada:journal:inbox:peer")).toBe(true);
    const name = channelName("ada:journal:inbox", "ada:journal:inbox:peer");
    const standing = gateway.channelStatus(name)[0]!;
    const withoutBinding: ChannelStatus = {
      name: standing.name,
      into: standing.into,
      prefix: standing.prefix,
      receiving: standing.receiving,
      blessing: standing.blessing,
      lastSyncedAt: standing.lastSyncedAt,
      consecutiveFailures: standing.consecutiveFailures,
      from: standing.from,
      unattested: standing.unattested,
      unreadable: [],
      ...(standing.openedBy === undefined ? {} : { openedBy: standing.openedBy }),
    };
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) => channelRecordClaims(withoutBinding, OPERATOR, t)),
        OPERATOR_SEED,
      ),
    ]);
    expect(
      gateway.channelStatus(name)[0]?.openedFrom,
      "premise: the binding is gone",
    ).toBeUndefined();
    expect(gateway.channelStatus(name)[0]?.openedBy, "premise: the opener stands named").toBe(
      "ada:journal",
    );
    expect(await servesPeer(base, ada, "ada:journal:inbox:peer"), "fails closed").toBe(false);
    const status = await callTool(base, ada, "loam_federate_status", {});
    expect(status.text).not.toMatch(/ada:journal:inbox/);
    await closePeers();
    await closeAll();
  });

  it("an envelope ceiling in the terms narrows a child's pools on the next render", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await wideCeiling(gateway);
    const large: Terms = { ...TERMS_RECEIVE, envelope: "large" };
    await declare(gateway, "ada:journal", {
      ...SEALED_LEEWAY,
      receive: true,
      envelope: "large",
      delegate: large,
    });
    await declare(
      gateway,
      "ada:journal:c",
      { ...SEALED_LEEWAY, receive: true, envelope: "large" },
      "ada:journal",
    );
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:c", peer)).isError).toBe(false);
    const pool = channelName("ada:journal:c", "ada:journal:c:peer");
    expect(envelopeOf(gateway, pool), "large").toEqual({
      maxConcurrentRenders: 16,
      renderTimeoutMs: 2000,
      maxMemoryMb: 512,
    });
    const small: Terms = { ...TERMS_RECEIVE, envelope: "small" };
    await declare(gateway, "ada:journal", {
      ...SEALED_LEEWAY,
      receive: true,
      envelope: "large",
      delegate: small,
    });
    expect(envelopeOf(gateway, pool), "narrowed to small").toEqual(DEFAULT_QUARANTINE_ENVELOPE);
    expect((await receive(base, ada, "ada:journal:undeclared", peer)).isError).toBe(false);
    expect(
      envelopeOf(gateway, channelName("ada:journal:undeclared", "ada:journal:undeclared:peer")),
      "an undeclared child is governed too",
    ).toEqual(DEFAULT_QUARANTINE_ENVELOPE);
    expect((await receive(base, ada, "ada:journal", peer)).isError).toBe(false);
    expect(
      envelopeOf(gateway, channelName("ada:journal", "ada:journal:peer")),
      "the container's own pool",
    ).toEqual({ maxConcurrentRenders: 16, renderTimeoutMs: 2000, maxMemoryMb: 512 });
    await closePeers();
    await closeAll();
  });

  it("a tightening ABOVE the binding reaches the open door, not only the fold", async () => {
    const { base, gateway } = await connectionServer();
    await connect(base, "ada", "agent1");
    await declare(gateway, "ada:agent1", {
      ...SEALED_LEEWAY,
      receive: true,
      delegate: TERMS_RECEIVE,
    });
    await declare(gateway, "ada:agent1:helper", { ...SEALED_LEEWAY, receive: true }, "ada:agent1");
    const helper = await connectTo(base, "ada", "ada:agent1:helper");
    const peer = await peerStore();
    expect((await receive(base, helper, "ada:agent1:helper", peer)).isError, "before").toBe(false);
    await declare(gateway, "ada:agent1", { ...SEALED_LEEWAY, receive: true, delegate: TERMS_NONE });
    const after = await receive(base, helper, "ada:agent1:helper:more", peer);
    expect(after.isError, "the door obeys the tightening above").toBe(true);
    expect(after.text).toMatch(/ada:agent1:helper does not receive/);
    expect(after.text).not.toMatch(/\bada:agent1 does not receive/);
    const bea = await connect(base, "bea", "notes");
    await declare(gateway, "bea:notes", { ...SEALED_LEEWAY, receive: true });
    expect((await receive(base, bea, "bea:notes:inbox", peer)).isError, "untouched").toBe(false);
    await declare(gateway, "ada", { ...SEALED_LEEWAY, receive: true });
    const quiet = await connect(base, "ada", "quiet");
    const silent = await receive(base, quiet, "ada:quiet:inbox", peer);
    expect(silent.isError).toBe(true);
    expect(silent.text).toMatch(/no leeway is declared for it/);
    expect(silent.text).toMatch(/ada:quiet does not receive/);
    await closePeers();
    await closeAll();
  });

  it("CASCADE: revoking the connection revokes the channels it opened on the next request; an unrelated binding is untouched", async () => {
    const server = await connectionServer();
    const { base, gateway, connectorsHome } = server;
    const ada = await connect(base, "ada", "journal");
    const bea = await connect(base, "bea", "notes");
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true });
    await declare(gateway, "bea:notes", { ...SEALED_LEEWAY, receive: true });
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:inbox", peer)).isError).toBe(false);
    expect((await receive(base, bea, "bea:notes:inbox", peer)).isError).toBe(false);
    expect(await servesPeer(base, ada, "ada:journal:inbox:peer")).toBe(true);
    const grant = grantOf(connectorsHome, "ada");
    const pool = poolOf(gateway, inboxName("ada:journal", grant.actor));
    const grants = [...pool.reactor.snapshot()]
      .filter((d) => {
        const at = (role: string) => d.claims.pointers.find((p) => p.role === role)?.target;
        const kind = at("kind");
        const key = at("key");
        return (
          kind?.kind === "primitive" &&
          kind.value === "delegation" &&
          key?.kind === "primitive" &&
          key.value === grant.actor
        );
      })
      .map((d) => d.id);
    expect(
      grants.length,
      "premise: a delegation lets the connection write in its pool",
    ).toBeGreaterThan(0);
    await pool.append(
      grants.map((id) =>
        pool.signer!.sign(
          withStamp(pool.stamp(), (t) => makeNegationClaims(pool.operatorAuthor!, t, id)),
        ),
      ),
    );
    expect(gateway.channelStatus().some((c) => c.into === "ada:journal:inbox")).toBe(true);
    expect(await servesPeer(base, ada, "ada:journal:inbox:peer"), "revoked: not served").toBe(
      false,
    );
    const status = await callTool(base, ada, "loam_federate_status", {});
    expect(status.text).not.toMatch(/ada:journal:inbox/);
    expect(await servesPeer(base, bea, "bea:notes:inbox:peer")).toBe(true);
    const hers = await callTool(base, bea, "loam_federate_status", {});
    expect(hers.text).toMatch(/bea:notes:inbox/);
    const again = await connect(base, "ada", "journal");
    expect(await servesPeer(base, again, "ada:journal:inbox:peer"), "re-bound").toBe(true);
    await closePeers();
    await closeAll();
  });
});
