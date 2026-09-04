// T263 — THE CONTAINER ROSTER (SPEC §58 position 3: the verbs a bound connection drives in
// conversation). This file rails the three that shape a container: `declare`, `leeway`, `receive`.
//
// One question decides every one of them, and it is asked the same way each time: is the name the
// caller gave inside the fence its binding draws — the caller's own container AND ITS COLON. So a
// name one level up is outside, a sibling that merely shares the letters is outside, and the only
// thing a connection can reach is its own subtree. Each case is TWO-SIDED: the act inside the
// subtree completes, the same act one level up refuses, and the refusal changes nothing.
//
// The three verbs divide by what they may touch. `declare` writes a NEW name below the fence.
// `leeway` re-declares a container BELOW the fence — never the connection's own, because a
// connection that could widen its own leeway would be granting itself what the person granted it.
// `receive` is `loam_federate_connect` under the roster's name: one road, two names, so an
// unbound caller keeps the road it already had.
//
// Railed at BOTH LEVELS: what the container table HOLDS after each act, and what the next request
// is SERVED — a leeway turned on is only a leeway if the door that reads it then admits.
//
// NOT HERE, and said so: `sever`, `promote-stage` and `bless-renderer` are the roster's other
// three. `sever` purges a pool's bytes, and widening who may purge is a decision rather than a
// repair, so it ships in its own change with the sentence naming what can now be deleted.
// `bless-renderer` decides a new capability. Neither is weakened by being absent here: the
// tools do not exist, so no door serves them.
//
// The pool tokens: `inbox` and `channel` lead a pool's name, and the leeway walk hops a pool to
// its host. A person named `inbox` would own a home the walk reads as a pool. The walls rail
// (subtree-walls.test.ts) named that reservation as owed by this slice; the last case pays it, at
// the one door that mints a person's name.
//
// RAILS-RED on origin/main, this file copied in: 9 red, 0 green — 9 cases. No control: every case
// names a verb or a rule this slice adds, and none of them exists on the base.
//
// REVERT PROBES, MEASURED against this file as it stands — 9 cases. Re-measure when you add one.
//   the fence drops its colon                       → 2 red, 7 green
//   leeway admits the caller's OWN container        → 1 red, 8 green
//   declare skips the standing-name check           → 1 red, 8 green
//   declare writes no parent edge                   → 1 red, 8 green
//   the unbound check is gone                       → 1 red, 8 green
//   the pool tokens are not reserved                → 1 red, 8 green
//   the leeway re-declaration drops the parent      → 1 red, 8 green
// Two of these were green until the rails were sharpened. The pool case asked for a leeway the ONE
// RULE refuses, so the law refused it whatever this door did and the case could not tell a pool
// rule from no rule; it now asks for the sealed leeway, which fits everywhere. And the re-declared
// parent was unasserted, so a leeway could silently strand the container it was setting.

import { describe, expect, it } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import { containerClaims, readContainerTable } from "../../src/gateway/container.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { SEALED_LEEWAY, type Leeway, type Terms } from "../../src/gateway/leeway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { userNameDefect } from "../../src/server/users.js";
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
const OPEN_TERMS: Terms = {
  receive: true,
  offer: true,
  publish: true,
  envelope: "large",
  delegate: "same",
};
/** What `ada:journal` stands with in most cases: it may receive, and so may everything below it. */
const OPEN: Leeway = { ...SEALED_LEEWAY, receive: true, delegate: OPEN_TERMS };
/** A sealed room with an open annex: it follows nothing itself, and a child of it may. */
const ANNEX: Leeway = { ...SEALED_LEEWAY, receive: false, delegate: OPEN_TERMS };
/** A namespace: nothing below it may declare a leeway at all. */
const NAMESPACE: Leeway = { ...SEALED_LEEWAY, delegate: "off" };

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
    host: "127.0.0.1",
  });
  peers.push(handle);
  return `${handle.url}/default`;
}
const closePeers = async (): Promise<void> => {
  while (peers.length > 0) await new Promise<void>((r) => peers.pop()!.server.close(() => r()));
};

/** Declare a container's leeway as the operator — the road the person's own page takes. */
const declareAs = (gw: Gateway, container: string, leeway: Leeway): Promise<unknown> => {
  const standing = readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(container);
  const spec = {
    container,
    trust: standing?.trust ?? ("curated" as const),
    posture: standing?.posture ?? ("separate" as const),
    ...(standing?.parent === undefined ? {} : { parent: standing.parent }),
    ...(standing?.membership === undefined ? {} : { membership: standing.membership }),
    ...(standing?.membershipAt === undefined ? {} : { membershipAt: standing.membershipAt }),
    ...(standing?.version === undefined ? {} : { version: standing.version }),
    leeway,
  };
  return gw.append([
    signClaims(containerClaims(spec, OPERATOR, gw.nextTimestamp()), OPERATOR_SEED),
  ]);
};

const recOf = (gw: Gateway, name: string) =>
  readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(name);

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
const declareTool = (base: string, bearer: string, name: string) =>
  callTool(base, bearer, "loam_container_declare", { name });
const leewayTool = (base: string, bearer: string, args: Record<string, unknown>) =>
  callTool(base, bearer, "loam_container_leeway", args);

/** The tool names this door advertises. */
async function toolNames(base: string, bearer: string): Promise<string[]> {
  const res = await fetch(`${base}/default/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const body = (await res.json()) as { result?: { tools?: { name: string }[] } };
  return (body.result?.tools ?? []).map((t) => t.name);
}

const FENCE = /the path and its colon|inside its own container|below its own container/i;

describe("§58 — the container roster", () => {
  it("declare writes a name inside the subtree, and refuses one a level up", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");

    const made = await declareTool(base, ada, "ada:journal:notes");
    expect(made.isError, made.text).toBe(false);
    // The delta level: the record stands, with the path parent as its edge.
    const rec = recOf(gateway, "ada:journal:notes");
    expect(rec, "the container stands").toBeDefined();
    expect(rec!.parent, "under its path parent").toBe("ada:journal");
    // The object level: a new name declares no leeway, so it INHERITS rather than asserting.
    expect(rec!.leewayDeclared, "and declares none of its own").toBe(false);

    // The other side: one level up is outside the fence, whatever it is named.
    const up = await declareTool(base, ada, "ada:diary");
    expect(up.isError, "a sibling of the connection's own container is refused").toBe(true);
    expect(up.text).toMatch(FENCE);
    expect(recOf(gateway, "ada:diary"), "and nothing was declared").toBeUndefined();
    await closeAll();
  });

  it("declare refuses a name that merely shares the connection's letters", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    // No colon after the fence: `ada:journalism` starts with `ada:journal` as a STRING and is a
    // different container. A prefix test without the colon would admit it.
    const shared = await declareTool(base, ada, "ada:journalism");
    expect(shared.isError, shared.text).toBe(true);
    expect(shared.text).toMatch(FENCE);
    expect(recOf(gateway, "ada:journalism")).toBeUndefined();
    // And the fence itself — the connection's own container — is not a name it may re-declare.
    const self = await declareTool(base, ada, "ada:journal");
    expect(self.isError, "its own container already stands").toBe(true);
    expect(recOf(gateway, "ada:journal")?.leewayDeclared, "untouched").toBe(false);
    await closeAll();
  });

  it("declare refuses a standing name and leaves the standing record whole", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    const first = await declareTool(base, ada, "ada:journal:notes");
    expect(first.isError, first.text).toBe(false);
    await leewayTool(base, ada, { name: "ada:journal:notes", receive: true });
    expect(recOf(gateway, "ada:journal:notes")?.leeway.receive, "premise: it is on").toBe(true);

    const again = await declareTool(base, ada, "ada:journal:notes");
    expect(again.isError, "a standing name is refused").toBe(true);
    // A re-declaration that went through would have reset the leeway to nothing.
    expect(recOf(gateway, "ada:journal:notes")?.leeway.receive, "and the leeway stands").toBe(true);
    await closeAll();
  });

  it("leeway turns a switch on below the fence, and the next request obeys it", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    // A SEALED ROOM WITH AN OPEN ANNEX: `ada:journal` follows nothing itself, and its terms say a
    // child of it may. A child that declares nothing INHERITS the sealed leeway, so receive is off
    // there until this verb turns it on.
    await declareAs(gateway, "ada:journal", ANNEX);
    await declareTool(base, ada, "ada:journal:notes");
    const from = await peerStore();

    // Before: the child inherits `ada:journal`'s own leeway, which does not receive.
    const before = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "ada:journal:notes",
      prefix: "ada:journal:notes:peer",
      token: PEER_TOKEN,
    });
    const on = await leewayTool(base, ada, { name: "ada:journal:notes", receive: true });
    expect(on.isError, on.text).toBe(false);
    expect(recOf(gateway, "ada:journal:notes")?.leeway.receive, "the switch is on").toBe(true);
    expect(recOf(gateway, "ada:journal:notes")?.leewayDeclared, "and declared here").toBe(true);
    // A LEEWAY IS A RE-DECLARATION, so every pointer the record stood on rides along. Latest-wins
    // is per declaration: a pointer omitted here is a pointer deleted, and a container that loses
    // its parent edge leaves the person's reach with no door left to put it back.
    expect(recOf(gateway, "ada:journal:notes")?.parent, "and keeps its parent edge").toBe(
      "ada:journal",
    );
    const after = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "ada:journal:notes",
      prefix: "ada:journal:notes:peer",
      token: PEER_TOKEN,
    });
    expect(after.isError, after.text).toBe(false);
    // The object level: the channel exists, opened by the container that asked for it.
    const channel = gateway.channelStatus().find((c) => c.into === "ada:journal:notes");
    expect(channel, "the channel stands").toBeDefined();
    expect(channel!.openedBy, "opened by the connection's container").toBe("ada:journal");
    // And the refusal before it was the LEEWAY, not the fence: same call, same names.
    expect(before.isError, "the same call was refused before the switch").toBe(true);
    await closePeers();
    await closeAll();
  });

  it("leeway refuses the connection's OWN container: that is the person's to set", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", { ...SEALED_LEEWAY, delegate: OPEN_TERMS });
    const self = await leewayTool(base, ada, { name: "ada:journal", receive: true });
    expect(self.isError, self.text).toBe(true);
    expect(self.text).toMatch(FENCE);
    expect(recOf(gateway, "ada:journal")?.leeway.receive, "its own leeway stands").toBe(false);
    // The other side, one act apart: BELOW it is allowed.
    await declareTool(base, ada, "ada:journal:notes");
    const below = await leewayTool(base, ada, { name: "ada:journal:notes", receive: true });
    expect(below.isError, below.text).toBe(false);
    await closeAll();
  });

  it("leeway is weighed by the one rule: a leeway wider than the terms above is refused", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", NAMESPACE);
    await declareTool(base, ada, "ada:journal:notes");
    const wide = await leewayTool(base, ada, { name: "ada:journal:notes", receive: true });
    expect(wide.isError, wide.text).toBe(true);
    expect(wide.text, "the refusal names the ceiling, not the fence").toMatch(
      /delegates nothing|namespace|does not fit|refus/i,
    );
    expect(recOf(gateway, "ada:journal:notes")?.leewayDeclared, "nothing was written").toBe(false);
    // The other side: under terms that allow it, the same call completes.
    await declareAs(gateway, "ada:journal", OPEN);
    const fits = await leewayTool(base, ada, { name: "ada:journal:notes", receive: true });
    expect(fits.isError, fits.text).toBe(false);
    await closeAll();
  });

  it("a pool is outside the fence: no roster verb can name one", async () => {
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
    const table = readContainerTable(gateway.reactor, gateway.operatorAuthor);
    const pool = [...table.containers.entries()].find(([, r]) => r.inboxOf !== undefined)?.[0];
    expect(pool, "premise: a pool stands").toBeDefined();
    expect(pool!.startsWith("ada:journal:"), "premise: it is not inside the fence").toBe(false);

    // ASKS FOR A LEEWAY THAT WOULD FIT: the sealed leeway fits everywhere, so the law refuses
    // nothing here and only the fence stands between the ask and a re-declaration that drops the
    // pool's pointer to its host — which would sever it from that container for good.
    const refused = await leewayTool(base, ada, { name: pool! });
    expect(refused.isError, refused.text).toBe(true);
    expect(refused.text, "refused by the fence").toMatch(FENCE);
    expect(recOf(gateway, pool!)?.inboxOf, "the pool keeps its host").toBe(
      table.containers.get(pool!)!.inboxOf,
    );
    expect(recOf(gateway, pool!)?.leewayDeclared, "and declares nothing of its own").toBe(false);
    await closePeers();
    await closeAll();
  });

  it("an unbound caller is refused every roster verb, and is offered them anyway", async () => {
    const { base, gateway } = await connectionServer();
    // `op-token` is the operator's own door token: full authority, and bound to no container.
    const names = await toolNames(base, "op-token");
    expect(names, "the roster is advertised").toContain("loam_container_declare");
    expect(names).toContain("loam_container_leeway");
    expect(names).toContain("loam_container_receive");
    for (const verb of ["loam_container_declare", "loam_container_leeway"]) {
      const r = await callTool(base, "op-token", verb, { name: "ada:journal:notes" });
      expect(r.isError, `${verb} refuses an unbound caller`).toBe(true);
      expect(r.text, `${verb} says why`).toMatch(/not bound|bound connection/i);
    }
    expect(recOf(gateway, "ada:journal:notes"), "and nothing was declared").toBeUndefined();
    await closeAll();
  });

  it("the pool tokens are not names a person may take", () => {
    // A leeway walk hops a container whose leading token is `inbox` or `channel` to its host. A
    // person named `inbox` would own a home the walk reads as a pool, so the name is refused at
    // the one door that mints one.
    for (const reserved of ["inbox", "channel", "INBOX"]) {
      expect(userNameDefect(reserved), `${reserved} is refused`).toBeDefined();
    }
    // The other side: a name that merely starts with those letters is an ordinary name.
    for (const ok of ["inboxer", "channels", "ada"]) {
      expect(userNameDefect(ok), `${ok} is a name`).toBeUndefined();
    }
  });
});
