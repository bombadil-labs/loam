// T263 — LEEWAY FITS ITS PARENT'S TERMS, AND CASCADES (SPEC §58 position 4, the one rule folded
// twice; criterion 5). A child's leeway — its switches, its envelope, its own delegate — must fit
// inside its parent's DELEGATE terms; the parent's own switches never enter the comparison. So a
// sealed room may hold an open annex, and `delegate: off` makes a subtree a pure namespace where
// no child may declare a leeway of its own. The rule is weighed TWICE: where a leeway is
// DECLARED, so the refusal names the ceiling (`containerDefect`, which every append runs through
// the trust policy, so every road reads one rule), and where a leeway is READ, so a parent
// tightened after its child declared narrows the child on the next request — no subtree exceeds
// what the person set at its top. THE CASCADE: a channel a connection opened is rooted in that
// connection's binding; revoking the connection revokes its channels on the next request, and an
// unrelated binding is untouched.
//
// Two-sided everywhere: the refusal AND the sibling that binds; the revoked channel gone AND the
// other connection's channel served.
//
// NOT HERE, and said so: a helper KEY bound below a container by a connection, and its cascade,
// wait on the roster slice's verbs; the publish switch has no road yet (§12's public lens for a
// bound connection is the roster's too); offering is T264's. A revoked opener's channel is also
// skipped by the standing sync, which no rail here observes: the fold and the doors are what a
// reader can see, and they are pinned. The standing sync obeys the same switch as the fold and the
// doors, so a closed container follows nothing more; no rail here watches a tick.
//
// THE CASCADE IS A SUSPENSION, KEYED ON STANDING, and that is a decision rather than a fallback.
// Nothing is struck: a channel serves exactly while the binding that opened it stands, so if the
// person consents again — the same key, the same inbox, a fresh grant — the channels that binding
// opened serve again, and the case below says so. A revoke that mints a NEW key instead leaves
// the old channel standing for nobody, since no binding answers to it; only the person can drop
// it. The alternative, striking each channel's record inside the revoke, would make revocation
// final and unrecoverable, and nothing in position 4 asks for that.
//
// RAILS-RED on origin/main, this file copied in: 10 red, 1 green — 11 cases. The green is a
// CONTROL: under terms that allow it, an annex that declared receive on already received on main
// (the walk there stops at the annex's own leeway); it pins that this slice did not narrow that.
//
// REVERT PROBES, MEASURED against this file as it stands — 11 cases. Re-measure when you add one.
//   fit not weighed where a leeway is declared             → 3 red,  8 green
//   the read never narrows by the terms above              → 5 red,  6 green
//   the terms do not descend a level per level             → 2 red,  9 green
//   the chains do not descend inside one another           → 1 red, 10 green
//   the open door caps its walk at the binding             → 1 red, 10 green
//   the open door inherits a room above the binding        → 1 red, 10 green
//   a record that names an opener but no binding stands    → 1 red, 10 green
//   a tightened switch reaches nothing                     → 1 red, 10 green
//   only the doors weigh receive, never the fold           → 1 red, 10 green
//   the opener always stands                               → 2 red,  9 green
//   the larger envelope wins a narrowing                   → 1 red, 10 green
// The two door probes are named apart because they pull in opposite directions: capping the walk
// at the binding let a tightening ABOVE it pass, and removing the cap outright let a connection
// inherit a room it was never bound to. What the cap was doing is kept as its own rule — a leeway
// must be declared at or inside the binding's own container — and each half reds its own case.
// The two descent probes are named apart for the same reason: the terms a parent delegates
// descend one level per container level, and the chains those terms carry descend inside one
// another. The second was green until the depth-three case existed.
//
// A sealed child under a parent that delegates nothing, and the person's home narrowing nothing
// below it, are pinned only by rails that landed before this slice and are frozen: reverting
// either reds one case in test/server/subtree-receive.test.ts or test/server/subtree-walls.test.ts.
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
import {
  containerClaims,
  inboxName,
  readContainerTable,
  survivingWriteGrantIds,
} from "../../src/gateway/container.js";
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

/** Declare (or re-declare, copying the record) a container with a leeway, as the operator. */
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
/** Bind a connection to a container that already stands, however deep it sits. */
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
/** The envelope a pool renders under, by its container name. */
const envelopeOf = (gw: Gateway, container: string) =>
  gw.envelopeReports().find((r) => r.container === container)?.envelope;
/** Raise the operator's own ceiling out of the way, so a size is what binds. */
const wideCeiling = (gw: Gateway): Promise<unknown> =>
  gw.append([
    signClaims(
      envelopeClaims(
        ENVELOPE_ANY,
        { maxConcurrentRenders: 32, renderTimeoutMs: 4000, maxMemoryMb: 1024 },
        OPERATOR,
        gw.nextTimestamp(),
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
    // Two-sided: a child that declares NO leeway is a pure namespace and binds.
    await gateway.append([
      signClaims(
        containerClaims(
          {
            container: "ada:journal:plain",
            trust: "curated",
            posture: "separate",
            parent: "ada:journal",
          },
          OPERATOR,
          gateway.nextTimestamp(),
        ),
        OPERATOR_SEED,
      ),
    ]);
    expect(
      readContainerTable(gateway.reactor, gateway.operatorAuthor).containers.has(
        "ada:journal:plain",
      ),
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
    // Two-sided: a child inside the terms binds.
    await declare(
      gateway,
      "ada:journal:small",
      { ...SEALED_LEEWAY, envelope: "small" },
      "ada:journal",
    );
    expect(
      readContainerTable(gateway.reactor, gateway.operatorAuthor).containers.get(
        "ada:journal:small",
      )?.leewayDeclared,
    ).toBe(true);
    await closeAll();
  });

  it("a parent tightened AFTER its child declared narrows the child on the next request", async () => {
    // The rule is read as well as declared: no subtree exceeds what the person set at its top,
    // even when the top moved later. A child that declared receive on under terms that allowed
    // it stops receiving when the parent's terms close.
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
    // The rule is read at every depth. Narrowing by each ancestor's top-level terms at every
    // depth left a person who wrote terms about grandchildren governing nobody: the standing
    // grandchild kept receiving, and a fresh one was weighed against its parent's stale written
    // terms rather than the terms its parent actually has.
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
    // Children may still receive; grandchildren may not.
    const narrow: Terms = { ...TERMS_RECEIVE, delegate: { ...TERMS_NONE } };
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, delegate: narrow });
    const later = await receive(base, ada, "ada:journal:c:g:more", peer);
    expect(later.isError, "the grandchild stopped receiving").toBe(true);
    expect(later.text).toMatch(/does not receive/);
    // And a FRESH grandchild asking for it is refused where a leeway is declared.
    await expect(
      declare(gateway, "ada:journal:c:g2", { ...SEALED_LEEWAY, receive: true }, "ada:journal:c"),
    ).rejects.toThrow(/does not fit the terms/);
    // Two-sided: the child itself still receives, because the terms about children did not move.
    expect((await receive(base, ada, "ada:journal:c", peer)).isError, "the child").toBe(false);
    await closePeers();
    await closeAll();
  });

  it("terms written three levels deep govern three levels deep, through containers that declared nothing", async () => {
    // The chains narrow one level per level, on both sides. A person who wrote that
    // great-grandchildren may not receive governs great-grandchildren, and the containers between
    // need declare nothing: an undeclared container is governed by the terms like any other, since
    // the terms bound the whole subtree.
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
    // A leeway change is a delta the next request obeys. The switch a container had when the
    // channel opened is not the switch it has now, so the fold and the doors ask again.
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
    // The record stands untouched, and turning the switch back on serves it again.
    expect(gateway.channelStatus().some((c) => c.into === "ada:journal:inbox")).toBe(true);
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true });
    expect(await servesPeer(base, ada, "ada:journal:inbox:peer"), "receive on again").toBe(true);
    await closePeers();
    await closeAll();
  });

  it("a bound record that names an opener but no binding serves nobody", async () => {
    // The cascade weighs the binding a channel was opened from. A record that names the container
    // but not the binding — one stamped before the binding was recorded — cannot be weighed, so
    // it fails CLOSED, matching the door, which admits only the inbox the record names.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true });
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:inbox", peer)).isError).toBe(false);
    expect(await servesPeer(base, ada, "ada:journal:inbox:peer")).toBe(true);
    const name = channelName("ada:journal:inbox", "ada:journal:inbox:peer");
    const standing = gateway.channelStatus(name)[0]!;
    // The same record, minus the binding it was opened from — the shape a channel stamped before
    // the binding was recorded still carries.
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
        channelRecordClaims(withoutBinding, OPERATOR, gateway.nextTimestamp()),
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
    // The envelope is narrowed on read like every other switch, and what it narrows is a live
    // ceiling: the pools inside the child render under it.
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
    // The parent lowers the ceiling its terms set: the child's pool renders under it now.
    const small: Terms = { ...TERMS_RECEIVE, envelope: "small" };
    await declare(gateway, "ada:journal", {
      ...SEALED_LEEWAY,
      receive: true,
      envelope: "large",
      delegate: small,
    });
    expect(envelopeOf(gateway, pool), "narrowed to small").toEqual(DEFAULT_QUARANTINE_ENVELOPE);
    // Two-sided, and it is the whole of the rule: the terms bound the SUBTREE, so an undeclared
    // child's pool is narrowed with the rest, while the container's OWN pool keeps its own size,
    // which its terms never bound.
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
    // The door read a leeway capped at the binding's own container while the fold read the whole
    // chain. A person who closed the room above a helper stopped the helper's rows being SERVED
    // and not the helper's following: the peer's bytes went on landing in a subtree she had
    // closed. Both reads are the same read now.
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
    // The person closes the room above the helper.
    await declare(gateway, "ada:agent1", { ...SEALED_LEEWAY, receive: true, delegate: TERMS_NONE });
    const after = await receive(base, helper, "ada:agent1:helper:more", peer);
    expect(after.isError, "the door obeys the tightening above").toBe(true);
    expect(after.text).toMatch(/ada:agent1:helper does not receive/);
    // The refusal names the binding's own container, never the room above it.
    expect(after.text).not.toMatch(/\bada:agent1 does not receive/);
    // Two-sided: a binding whose chain nobody tightened still receives, and one bound to a
    // container that declared nothing is still refused for declaring nothing.
    const bea = await connect(base, "bea", "notes");
    await declare(gateway, "bea:notes", { ...SEALED_LEEWAY, receive: true });
    expect((await receive(base, bea, "bea:notes:inbox", peer)).isError, "untouched").toBe(false);
    // A leeway ABOVE the binding is not the binding's to inherit: the person's home may receive
    // and a room she never gave a leeway to still does not.
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
    // Revoke ada's connection: strike its write grant in its own pool, as the revoke road does.
    const grant = grantOf(connectorsHome, "ada");
    const pool = poolOf(gateway, inboxName("ada:journal", grant.actor));
    const grants = survivingWriteGrantIds(pool.reactor, grant.actor);
    expect(
      grants.length,
      "premise: the connection holds a write grant in its pool",
    ).toBeGreaterThan(0);
    await pool.append(
      grants.map((id) =>
        signClaims(makeNegationClaims(OPERATOR, pool.nextTimestamp(), id), OPERATOR_SEED),
      ),
    );
    // The channel record still stands — nothing was deleted — but it serves nobody and is not
    // the connection's to see any more.
    expect(gateway.channelStatus().some((c) => c.into === "ada:journal:inbox")).toBe(true);
    expect(await servesPeer(base, ada, "ada:journal:inbox:peer"), "revoked: not served").toBe(
      false,
    );
    const status = await callTool(base, ada, "loam_federate_status", {});
    expect(status.text).not.toMatch(/ada:journal:inbox/);
    // Two-sided: bea's channel, in her own container, is untouched.
    expect(await servesPeer(base, bea, "bea:notes:inbox:peer")).toBe(true);
    const hers = await callTool(base, bea, "loam_federate_status", {});
    expect(hers.text).toMatch(/bea:notes:inbox/);
    // THE CASCADE IS A SUSPENSION, KEYED ON STANDING, AND THAT IS THE DECISION. The record is
    // never struck, so if the person consents again — the same key, the same inbox, a fresh
    // grant — the channel they opened serves again. A revoke that mints a NEW key leaves the old
    // channel standing for nobody, since no binding answers to it; only the person can drop it.
    const again = await connect(base, "ada", "journal");
    expect(await servesPeer(base, again, "ada:journal:inbox:peer"), "re-bound").toBe(true);
    await closePeers();
    await closeAll();
  });
});
