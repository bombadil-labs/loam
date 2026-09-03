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
// reader can see, and they are pinned.
//
// RAILS-RED on origin/main, this file copied in: 4 red, 1 green — 5 cases. The green is a CONTROL:
// under terms that allow it, an annex that declared receive on already received on main (the walk
// stops at the annex's own leeway); it pins that this slice did not narrow that. The cascade case
// reds on main for a second reason too, the write-grant reader it imports is not exported there.
//
// REVERT PROBES, MEASURED against this file as it stands — 5 cases. Re-measure when you add one.
//   fit not weighed where a leeway is declared             → 2 red, 3 green
//   the read never narrows by the terms above              → 1 red, 4 green
//   a sealed child leeway refused under delegate off       → 0 red here; 1 red in the frozen rails
//   fit weighed against the person's home                  → 0 red here; 1 red in the frozen rails
//   the opener always stands                               → 1 red, 4 green
//   the opener's inbox not recorded on the channel         → 1 red, 4 green
//   the bound fold ignores the opener's standing           → 1 red, 4 green
// Two rules are pinned only by rails that landed before this slice and are frozen: a child that
// declares SEALED under a parent that delegates nothing is admitted (the receive rails declare
// one), and the person's home narrows nothing below it (the walls rails declare a leeway on the
// home and then on a room beneath it). Each reds exactly one of those files when reverted.

import { describe, expect, it } from "vitest";
import { makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
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
  closeAll,
  connect,
  connectionServer,
  grantOf,
  OPERATOR,
  OPERATOR_SEED,
  poolOf,
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
const servesPeer = async (base: string, bearer: string, prefix: string): Promise<boolean> =>
  (await fieldsOf(base, bearer)).some((f) => f.startsWith(prefix.replace(/[^A-Za-z0-9_]/g, "_")));

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
    await closePeers();
    await closeAll();
  });
});
