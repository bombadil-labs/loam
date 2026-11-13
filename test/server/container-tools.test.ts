import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import {
  containerClaims,
  containerDefect,
  danglingAncestor,
  treeRootsOf,
  everDeclared,
  readContainerTable,
  survivingDeclarationIds,
} from "../../src/gateway/container-law.js";
import { subtreeOf } from "../../src/server/subtree.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { SEALED_LEEWAY, type Leeway, type Terms } from "../../src/gateway/leeway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { appendRefusal } from "../../src/server/refusal.js";
import { run } from "../../src/cli/cli.js";
import { readPenSeed } from "../../src/cli/config.js";
import { readCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { reservedNameDefect, userNameDefect } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { readOAuthFile } from "../../src/server/oauth-file.js";
import {
  closeAll,
  connect,
  connectionServer,
  consent,
  pkce,
  redeem,
  OPERATOR,
  OPERATOR_SEED,
} from "../helpers/connection-fixture.js";
import { FERN, observed } from "../spike/garden.js";
import { withStamp } from "../../src/gateway/stamp.js";
import { plant } from "../helpers/plant.js";

const PEER_SEED = "7a".repeat(32);
const PEER_TOKEN = "peer-door-token";
const OPEN_TERMS: Terms = {
  receive: true,
  offer: true,
  publish: true,
  envelope: "large",
  delegate: "same",
};
const OPEN: Leeway = { ...SEALED_LEEWAY, receive: true, delegate: OPEN_TERMS };
const ANNEX: Leeway = { ...SEALED_LEEWAY, receive: false, delegate: OPEN_TERMS };
const NAMESPACE: Leeway = { ...SEALED_LEEWAY, delegate: "off" };

const CHEAP_SCRYPT: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };

const ANY_AUTHOR = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: "x" } },
  in: "input",
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
  await peer.append([
    observed(FERN, "height", 11, peer.stamp(authorForSeed(PEER_SEED)), PEER_SEED),
  ]);
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
    signClaims(
      withStamp(gw.stamp(), (t) => containerClaims(spec, OPERATOR, t)),
      OPERATOR_SEED,
    ),
  ]);
};

const nest = (depth: number): Record<string, unknown> =>
  depth <= 0 ? { envelope: "small" } : { envelope: "small", delegate: nest(depth - 1) };

const recOf = (gw: Gateway, name: string) =>
  readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor).containers.get(name);

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
    expect(JSON.parse(made.text), "and the reply names what it signed").toMatchObject({
      declared: ["ada:journal:notes"],
    });
    const rec = recOf(gateway, "ada:journal:notes");
    expect(rec, "the container stands").toBeDefined();
    expect(rec!.parent, "under its path parent").toBe("ada:journal");
    expect(rec!.leewayDeclared, "and declares none of its own").toBe(false);

    const up = await declareTool(base, ada, "ada:diary");
    expect(up.isError, "a sibling of the connection's own container is refused").toBe(true);
    expect(up.text).toMatch(FENCE);
    expect(recOf(gateway, "ada:diary"), "and nothing was declared").toBeUndefined();
    await closeAll();
  });

  it("declare refuses a name that merely shares the connection's letters", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const shared = await declareTool(base, ada, "ada:journalism");
    expect(shared.isError, shared.text).toBe(true);
    expect(shared.text).toMatch(FENCE);
    expect(recOf(gateway, "ada:journalism")).toBeUndefined();
    const self = await declareTool(base, ada, "ada:journal");
    expect(self.isError, self.text).toBe(true);
    expect(self.text, "refused by the fence").toMatch(FENCE);
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
    expect(recOf(gateway, "ada:journal:notes")?.leeway.receive, "and the leeway stands").toBe(true);
    await closeAll();
  });

  it("leeway turns a switch on below the fence, and the next request obeys it", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", ANNEX);
    await declareTool(base, ada, "ada:journal:notes");
    const from = await peerStore();

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
    const channel = gateway.channelStatus().find((c) => c.into === "ada:journal:notes");
    expect(channel, "the channel stands").toBeDefined();
    expect(channel!.openedBy, "opened by the connection's container").toBe("ada:journal");
    expect(before.isError, "the same call was refused before the switch").toBe(true);
    expect(before.text, "and refused for the leeway, not the fence").toMatch(/does not receive/);
    expect(before.text, "naming the container whose leeway said no").toContain("ada:journal");
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
    expect(wide.text, "the refusal names the rule").toMatch(/delegates nothing|does not fit/);
    expect(wide.text, "and the container whose terms refused").toContain("ada:journal");
    expect(wide.text, "and it is the law's sentence, not the raw fault").not.toMatch(
      /malformed law/,
    );
    expect(recOf(gateway, "ada:journal:notes")?.leewayDeclared, "nothing was written").toBe(false);
    await declareAs(gateway, "ada:journal", OPEN);
    const fits = await leewayTool(base, ada, { name: "ada:journal:notes", receive: true });
    expect(fits.isError, fits.text).toBe(false);
    await closeAll();
  });

  it("declare names every level it stands on, so the person's own doors can see it", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const deep = await declareTool(base, ada, "ada:journal:notes:drafts:old");
    expect(deep.isError, deep.text).toBe(false);
    expect(JSON.parse(deep.text)).toMatchObject({
      declared: ["ada:journal:notes", "ada:journal:notes:drafts", "ada:journal:notes:drafts:old"],
    });
    for (const level of [
      "ada:journal:notes",
      "ada:journal:notes:drafts",
      "ada:journal:notes:drafts:old",
    ]) {
      const rec = recOf(gateway, level);
      expect(rec, `${level} stands`).toBeDefined();
      expect(rec!.parent, `${level} hangs off its path parent`).toBe(
        level.slice(0, level.lastIndexOf(":")),
      );
    }
    const reach = subtreeOf(gateway.containers(), "ada");
    for (const level of ["ada:journal:notes", "ada:journal:notes:drafts:old"]) {
      expect(reach.has(level), `${level} is in the person's reach`).toBe(true);
    }
    expect(recOf(gateway, "ada:journal:notes:drafts")?.posture).toBe("shared");
    const still = await callTool(base, ada, "loam_query", { query: "{ __typename }" });
    expect(still.isError, `the connection still reads: ${still.text}`).toBe(false);
    await closeAll();
  });

  it("declare refuses a name with an empty segment, and a name without end", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const before = gateway.containers().containers.size;
    for (const bad of [
      "ada:journal:",
      "ada:journal::notes",
      "ada:journal:notes:",
      `ada:journal:${"x".repeat(600)}`,
      `ada:journal${":x".repeat(20)}`,
    ]) {
      const r = await declareTool(base, ada, bad);
      expect(r.isError, `${bad.slice(0, 40)} is refused`).toBe(true);
      expect(r.text, "and the refusal names the rule it broke").toMatch(
        /empty level|at most \d+ (characters|levels)|the path and its colon/,
      );
    }
    expect(gateway.containers().containers.size, "and none of them stands").toBe(before);
    await closeAll();
  });

  it("declare refuses a name whose own parent leads out of the subtree", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    await declareAs(gateway, "ada:sibling", OPEN);
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:journal:away",
              trust: "curated",
              posture: "shared",
              membership: recOf(gateway, "ada:journal")!.membership,
              parent: "ada:sibling",
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    expect(recOf(gateway, "ada:journal:away")?.parent, "premise: its edge leads out").toBe(
      "ada:sibling",
    );

    const under = await declareTool(base, ada, "ada:journal:away:z");
    expect(under.isError, under.text).toBe(true);
    expect(under.text, "and the refusal names the disagreement").toMatch(
      /does not stand inside it/,
    );
    expect(under.text, "without naming where it went").not.toContain("sibling");
    expect(recOf(gateway, "ada:journal:away:z"), "nothing was made").toBeUndefined();

    const from = await peerStore();
    const minted = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "ada:journal:away:x",
      prefix: "ada:journal:away:x:peer",
      token: PEER_TOKEN,
    });
    expect(minted.isError, minted.text).toBe(true);
    expect(minted.text).toMatch(/does not stand inside it/);
    expect(recOf(gateway, "ada:journal:away:x"), "and nothing was minted").toBeUndefined();
    expect(gateway.channelStatus().length, "and no peer bytes landed").toBe(0);
    await closePeers();

    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:journal:rootless",
              trust: "curated",
              posture: "shared",
              membership: recOf(gateway, "ada:journal")!.membership,
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const rootless = await declareTool(base, ada, "ada:journal:rootless:z");
    expect(rootless.isError, rootless.text).toBe(true);
    expect(rootless.text, "the same sentence the leeway verb speaks").toMatch(
      /does not stand inside it/,
    );
    const shaped = await leewayTool(base, ada, { name: "ada:journal:rootless" });
    expect(shaped.isError, "the leeway verb refuses it too").toBe(true);
    expect(shaped.text).toMatch(/does not stand inside it/);
    expect(shaped.text, "and says what is true of a container with no parent").toMatch(
      /edges do not lead back to ada:journal/,
    );
    expect(rootless.text, "the same words at the other verb").toMatch(
      /edges do not lead back to ada:journal/,
    );
    await closeAll();
  });

  it("leeway asks the record, not only the name: a pool and a name whose edge is elsewhere", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);

    await declareTool(base, ada, "ada:journal:held");
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:journal:held",
              trust: "curated",
              posture: "shared",
              membership: recOf(gateway, "ada:journal:held")!.membership,
              parent: "ada:journal",
              inboxOf: "ada:journal",
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    expect(recOf(gateway, "ada:journal:held")?.inboxOf, "premise: it is a pool").toBe(
      "ada:journal",
    );
    const pooled = await leewayTool(base, ada, { name: "ada:journal:held", receive: true });
    expect(pooled.isError, pooled.text).toBe(true);
    expect(pooled.text, "and names its host").toContain("takes its leeway from ada:journal");
    expect(recOf(gateway, "ada:journal:held")?.inboxOf, "the pointer survives").toBe("ada:journal");

    await declareAs(gateway, "ada:elsewhere", OPEN);
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:journal:away",
              trust: "curated",
              posture: "shared",
              membership: recOf(gateway, "ada:journal:held")!.membership,
              parent: "ada:elsewhere",
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const away = await leewayTool(base, ada, { name: "ada:journal:away", receive: true });
    expect(away.isError, away.text).toBe(true);
    expect(away.text, "the refusal names the disagreement").toMatch(/does not stand inside it/);
    expect(recOf(gateway, "ada:journal:away")?.leewayDeclared, "nothing was written").toBe(false);
    await closeAll();
  });

  it("leeway writes every switch it was given, and nothing it was not", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    await declareTool(base, ada, "ada:journal:notes");
    const set = await leewayTool(base, ada, {
      name: "ada:journal:notes",
      receive: true,
      offer: true,
      publish: true,
      envelope: "medium",
      delegate: { receive: true, offer: false, publish: true, envelope: "small", delegate: "same" },
    });
    expect(set.isError, set.text).toBe(false);
    expect(recOf(gateway, "ada:journal:notes")?.leeway).toEqual({
      receive: true,
      offer: true,
      publish: true,
      envelope: "medium",
      delegate: {
        receive: true,
        offer: false,
        publish: true,
        envelope: "small",
        delegate: "same",
      },
    });

    const cleared = await leewayTool(base, ada, { name: "ada:journal:notes" });
    expect(cleared.isError, cleared.text).toBe(false);
    expect(recOf(gateway, "ada:journal:notes")?.leeway).toEqual(SEALED_LEEWAY);
    await closeAll();
  });

  it("leeway refuses a shape the law does not admit, and writes nothing", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    await declareTool(base, ada, "ada:journal:notes");
    const stood = { name: "ada:journal:notes", receive: true, envelope: "medium" as const };
    expect((await leewayTool(base, ada, stood)).isError, "premise: it stands").toBe(false);

    const bad: [Record<string, unknown>, RegExp][] = [
      [{ envelope: "enormous" }, /envelope is "small", "medium" or "large"/],
      [{ envelope: 3 }, /envelope is "small", "medium" or "large"/],
      [{ delegate: "yes please" }, /a leeway is an object/],
      [{ delegate: { envelope: "enormous" } }, /envelope is "small", "medium" or "large"/],
      [{ delegate: nest(40) }, /nests deeper/],
      [{ recieve: true }, /unknown key "recieve"/],
      [{ delegate: { publsh: true } }, /unknown key "publsh"/],
    ];
    for (const [args, why] of bad) {
      const r = await leewayTool(base, ada, { name: "ada:journal:notes", ...args });
      expect(r.isError, `${JSON.stringify(args)} is refused`).toBe(true);
      expect(r.text, `${JSON.stringify(args)} says which shape`).toMatch(why);
      expect(recOf(gateway, "ada:journal:notes")?.leeway.envelope, "unchanged").toBe("medium");
      expect(recOf(gateway, "ada:journal:notes")?.leeway.receive, "unchanged").toBe(true);
    }
    const deep = await leewayTool(base, ada, { name: "ada:journal:notes", delegate: nest(20) });
    expect(deep.isError, deep.text).toBe(false);
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
    const table = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    );
    const pool = [...table.containers.entries()].find(([, r]) => r.inboxOf !== undefined)?.[0];
    expect(pool, "premise: a pool stands").toBeDefined();
    expect(pool!.startsWith("ada:journal:"), "premise: it is not inside the fence").toBe(false);

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

  it("a connection whose standing ended shapes nothing, though its token still says bound", async () => {
    const { base, gateway, connectorsHome } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    expect((await declareTool(base, ada, "ada:journal:before")).isError, "premise").toBe(false);

    const grant = readOAuthFile(connectorsHome).grants[0]!;
    await gateway.revokeConnection({
      inbox: gateway.connectionInboxes.get(grant.inbox!)!,
      connectionKey: grant.actor,
      asPool: true,
    });

    for (const [verb, args] of [
      ["loam_container_declare", { name: "ada:journal:after" }],
      ["loam_container_leeway", { name: "ada:journal:before", receive: true }],
    ] as const) {
      const r = await callTool(base, ada, verb, args);
      expect(r.isError, `${verb} is refused`).toBe(true);
      expect(r.text, `${verb} says the standing ended`).toMatch(/no longer stands/);
    }
    expect(recOf(gateway, "ada:journal:after"), "and nothing was declared").toBeUndefined();
    expect(recOf(gateway, "ada:journal:before")?.leewayDeclared, "nor shaped").toBe(false);
    await closeAll();
  });

  it("a dropped container is not resurrected by the connection it held", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await declareTool(base, ada, "ada:journal:before")).isError, "premise").toBe(false);

    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor!,
      "ada:journal",
    );
    expect(ids.length, "premise: ada:journal was declared").toBeGreaterThan(0);
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            ...gateway.stamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    expect(recOf(gateway, "ada:journal"), "premise: the container is gone").toBeUndefined();
    expect(gateway.connectionInboxes.size, "premise: the pool outlives it").toBeGreaterThan(0);

    const after = await declareTool(base, ada, "ada:journal:after");
    expect(after.isError, after.text).toBe(true);
    expect(after.text, "and it says the standing ended").toMatch(/no longer stands/);
    expect(recOf(gateway, "ada:journal"), "the dropped container stays dropped").toBeUndefined();
    expect(recOf(gateway, "ada:journal:after"), "and nothing new stands").toBeUndefined();
    await closeAll();
  });

  it("a dropped MIDDLE is not resurrected, by either road, and its subtree stays out of reach", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    expect((await declareTool(base, ada, "ada:journal:work")).isError, "premise").toBe(false);
    expect((await declareTool(base, ada, "ada:journal:work:notes")).isError, "premise").toBe(false);

    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor!,
      "ada:journal:work",
    );
    expect(ids.length, "premise: the middle was declared").toBeGreaterThan(0);
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            ...gateway.stamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    expect(recOf(gateway, "ada:journal:work"), "premise: the middle is gone").toBeUndefined();
    expect(
      recOf(gateway, "ada:journal:work:notes"),
      "premise: the child still stands",
    ).toBeDefined();
    const reachBefore = subtreeOf(gateway.containers(), "ada");
    expect(reachBefore.has("ada:journal:work:notes"), "premise: and is out of reach").toBe(false);

    const declared = await declareTool(base, ada, "ada:journal:work:x");
    expect(declared.isError, declared.text).toBe(true);
    expect(declared.text, "and it says the level was dropped").toMatch(/declared and then dropped/);

    const from = await peerStore();
    const received = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "ada:journal:work:peer",
      prefix: "ada:journal:work:peer:p",
      token: PEER_TOKEN,
    });
    expect(received.isError, received.text).toBe(true);

    expect(
      survivingDeclarationIds(
        gateway.reactor,
        gateway.validityNow(),
        gateway.operatorAuthor!,
        "ada:journal:work",
      ),
      "the drop stands",
    ).toEqual([]);
    expect(subtreeOf(gateway.containers(), "ada").has("ada:journal:work:notes")).toBe(false);
    await closePeers();
    await closeAll();
  });

  it("the dropped subtree is not grown through a descendant that outlived it", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    expect((await declareTool(base, ada, "ada:journal:work")).isError, "premise").toBe(false);
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:journal:zeta",
              trust: "curated",
              posture: "shared",
              membership: recOf(gateway, "ada:journal:work")!.membership,
              parent: "ada:journal:work",
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);

    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor!,
      "ada:journal:work",
    );
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            ...gateway.stamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    expect(recOf(gateway, "ada:journal:zeta"), "premise: the child outlived it").toBeDefined();
    expect(
      subtreeOf(gateway.containers(), "ada").has("ada:journal:zeta"),
      "premise: and is unreachable",
    ).toBe(false);

    const grown = await declareTool(base, ada, "ada:journal:zeta:z");
    expect(grown.isError, grown.text).toBe(true);
    expect(grown.text, "and it says the edge hangs from a container that is not there").toMatch(
      /hangs from a container that does not/,
    );
    expect(grown.text, "without naming it").not.toContain("work");
    expect(recOf(gateway, "ada:journal:zeta:z"), "nothing was made").toBeUndefined();

    const from = await peerStore();
    const received = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "ada:journal:zeta",
      prefix: "ada:journal:zeta:peer",
      token: PEER_TOKEN,
    });
    expect(received.isError, received.text).toBe(true);
    expect(gateway.channelStatus().length, "and no peer bytes landed there").toBe(0);
    await closePeers();
    await closeAll();
  });

  it("the write seam asks the chain too, so a dropped subtree stops taking law", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const wrote = await callTool(base, ada, "loam_mutate", {
      mutation: `mutation { plant(entity: "${FERN}", height: 43) { height } }`,
    });
    expect(wrote.isError, `premise: it can write: ${wrote.text}`).toBe(false);

    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor!,
      "ada",
    );
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            ...gateway.stamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    expect(recOf(gateway, "ada"), "premise: the home is gone").toBeUndefined();
    expect(
      recOf(gateway, "ada:journal"),
      "premise: the bound container stands alone",
    ).toBeDefined();
    expect(subtreeOf(gateway.containers(), "ada").size, "and the person's reach is empty").toBe(0);

    const after = await callTool(base, ada, "loam_mutate", {
      mutation: `mutation { plant(entity: "${FERN}", height: 44) { height } }`,
    });
    expect(after.isError, "the write seam refuses").toBe(true);
    expect(after.text, "and says the container no longer stands").toMatch(/no longer stands/);
    await closeAll();
  });

  it("the operator's own receive hangs its container from something", async () => {
    const { base, gateway } = await connectionServer();
    await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    const from = await peerStore();
    const deep = await callTool(base, "op-token", "loam_federate_connect", {
      from,
      into: "ada:journal:fresh:deeper",
      prefix: "ada:journal:fresh:deeper:peer",
      token: PEER_TOKEN,
    });
    expect(deep.isError, deep.text).toBe(false);
    expect(recOf(gateway, "ada:journal:fresh"), "the middle stands").toBeDefined();
    expect(recOf(gateway, "ada:journal:fresh")?.parent, "under its path parent").toBe(
      "ada:journal",
    );
    expect(recOf(gateway, "ada:journal:fresh:deeper")?.parent, "and the target under it").toBe(
      "ada:journal:fresh",
    );
    const reach = subtreeOf(gateway.containers(), "ada");
    expect(reach.has("ada:journal:fresh")).toBe(true);
    expect(reach.has("ada:journal:fresh:deeper")).toBe(true);

    const root = await callTool(base, "op-token", "loam_federate_connect", {
      from,
      into: "friends",
      prefix: "friends:peer",
      token: PEER_TOKEN,
    });
    expect(root.isError, root.text).toBe(false);
    expect(recOf(gateway, "friends")?.parent, "a root hangs from nothing").toBeUndefined();
    await closePeers();
    await closeAll();
  });

  it("the tree a binding stands in is WALKED, never split off its name", async () => {
    const { base, gateway } = await connectionServer();
    await connect(base, "bea", "notes");
    await connect(base, "ada", "journal");
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    const membership = recOf(gateway, "ada:journal")!.membership;
    const declare = (container: string, parent: string): Promise<unknown> =>
      gateway.append([
        signClaims(
          withStamp(gateway.stamp(), (t) =>
            containerClaims(
              { container, trust: "curated", posture: "shared", membership, parent },
              OPERATOR,
              t,
            ),
          ),
          OPERATOR_SEED,
        ),
      ]);
    await declare("bea:shared", "ada:journal");
    await declare("bea:shared:mine", "ada:journal");
    await declare("bea:shared:leak", "bea");
    expect(
      subtreeOf(gateway.containers(), "ada").has("bea:shared"),
      "premise: ada reaches it",
    ).toBe(true);
    expect(subtreeOf(gateway.containers(), "bea").has("bea:shared:leak"), "premise").toBe(true);
    await declareAs(gateway, "bea:shared", OPEN);

    const p = pkce();
    const { code, status } = await consent(base, "ada", p.challenge, { bind: "bea:shared" });
    expect(status, "premise: consent offers a container ada reaches").toBe(302);
    const redeemed = await redeem(base, code, p.verifier);
    expect(redeemed.status).toBe(200);
    const ada = ((await redeemed.json()) as { access_token: string }).access_token;

    const from = await peerStore();
    const leak = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "bea:shared:leak",
      prefix: "bea:shared:leak:peer",
      token: PEER_TOKEN,
    });
    expect(leak.isError, `the leak is refused: ${leak.text}`).toBe(true);
    expect(gateway.channelStatus().length, "and no peer bytes landed").toBe(0);

    await declare("bea:shared:double", "bea:notes");
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "bea:shared:double",
              trust: "curated",
              posture: "shared",
              membership,
              parent: "bea:notes",
              inboxOf: "bea:shared",
              leeway: OPEN,
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    expect(
      treeRootsOf(gateway.containers(), "bea:shared:double").sort(),
      "premise: the target stands in two trees",
    ).toEqual(["ada", "bea"]);
    expect(
      subtreeOf(gateway.containers(), "bea").has("bea:shared:double"),
      "premise: and bea's pages hold it",
    ).toBe(true);
    const double = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "bea:shared:double",
      prefix: "bea:shared:double:peer",
      token: PEER_TOKEN,
    });
    expect(double.isError, double.text).toBe(true);
    expect(gateway.channelStatus().length, "and still no peer bytes landed").toBe(0);

    const fresh = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "bea:shared:double:fresh",
      prefix: "bea:shared:double:fresh:peer",
      token: PEER_TOKEN,
    });
    expect(fresh.isError, fresh.text).toBe(true);
    expect(recOf(gateway, "bea:shared:double:fresh"), "and nothing was minted").toBeUndefined();
    expect(gateway.channelStatus().length, "and no peer bytes landed").toBe(0);

    const mine = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "bea:shared:mine",
      prefix: "bea:shared:mine:peer",
      token: PEER_TOKEN,
    });
    expect(mine.isError, `and the one inside her own tree is admitted: ${mine.text}`).toBe(false);

    const pool = [...gateway.containers().containers.entries()].find(
      ([, r]) => r.inboxOf === "bea:shared",
    )?.[0];
    expect(pool, "premise: the connection's pool stands under the binding").toBeDefined();
    await declare("bea:shared:pooled", pool!);
    expect(subtreeOf(gateway.containers(), "ada").has("bea:shared:pooled"), "premise").toBe(true);
    const pooled = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "bea:shared:pooled",
      prefix: "bea:shared:pooled:peer",
      token: PEER_TOKEN,
    });
    expect(pooled.isError, `a container under a pool is hers too: ${pooled.text}`).toBe(false);

    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "bea:shared",
              trust: "curated",
              posture: "shared",
              membership,
              parent: "ada:journal",
              inboxOf: "bea",
              leeway: OPEN,
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    expect(
      treeRootsOf(gateway.containers(), "bea:shared").sort(),
      "premise: it stands in two trees",
    ).toEqual(["ada", "bea"]);
    const ambiguous = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "bea:shared:mine",
      prefix: "bea:shared:mine:second",
      token: PEER_TOKEN,
    });
    expect(ambiguous.isError, ambiguous.text).toBe(true);
    expect(ambiguous.text, "and it says the tree is not decided").toMatch(/not decided/);
    await closePeers();
    await closeAll();
  });

  it("a channel is refused into a name that hangs in ANOTHER person's tree", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await connect(base, "bea", "notes");
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:journal:y",
              trust: "curated",
              posture: "shared",
              membership: recOf(gateway, "ada:journal")!.membership,
              parent: "bea:notes",
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    expect(subtreeOf(gateway.containers(), "bea").has("ada:journal:y"), "premise").toBe(true);
    expect(subtreeOf(gateway.containers(), "ada").has("ada:journal:y"), "premise").toBe(false);

    const from = await peerStore();
    const refused = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "ada:journal:y",
      prefix: "ada:journal:y:peer",
      token: PEER_TOKEN,
    });
    expect(refused.isError, refused.text).toBe(true);
    expect(refused.text, "and it says the name hangs outside").toMatch(/hangs outside it/);
    expect(refused.text, "without naming whose tree it is in").not.toContain("bea:notes");
    expect(gateway.channelStatus().length, "and no peer bytes landed").toBe(0);

    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:journal:x",
              trust: "curated",
              posture: "shared",
              membership: recOf(gateway, "ada:journal")!.membership,
              parent: "ada",
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const admitted = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "ada:journal:x",
      prefix: "ada:journal:x:peer",
      token: PEER_TOKEN,
    });
    expect(admitted.isError, admitted.text).toBe(false);
    await closePeers();
    await closeAll();
  });

  it("the operator's road writes an edge only where a parent stands", async () => {
    const { base, gateway } = await connectionServer();
    await connect(base, "ada", "journal");
    const from = await peerStore();

    const under = await callTool(base, "op-token", "loam_federate_connect", {
      from,
      into: "ada:journal:fresh",
      prefix: "ada:journal:fresh:peer",
      token: PEER_TOKEN,
    });
    expect(under.isError, under.text).toBe(false);
    expect(recOf(gateway, "ada:journal:fresh")?.parent).toBe("ada:journal");
    expect(subtreeOf(gateway.containers(), "ada").has("ada:journal:fresh")).toBe(true);

    const deep = await callTool(base, "op-token", "loam_federate_connect", {
      from,
      into: "zed:room:leaf",
      prefix: "zed:room:leaf:peer",
      token: PEER_TOKEN,
    });
    expect(deep.isError, deep.text).toBe(false);
    expect(recOf(gateway, "zed"), "a colon-free ancestor is never minted").toBeUndefined();
    expect(recOf(gateway, "zed:room")?.parent, "the topmost new level hangs from nothing").toBe(
      undefined,
    );
    expect(recOf(gateway, "zed:room:leaf")?.parent, "and the leaf hangs from it").toBe("zed:room");
    expect(danglingAncestor(gateway.containers(), "zed:room:leaf")).toBeUndefined();
    expect(subtreeOf(gateway.containers(), "zed").has("zed:room"), "T277: still unreachable").toBe(
      false,
    );
    await closePeers();
    await closeAll();
  });

  it("the operator's road refuses a top-level name the person dropped", async () => {
    const { base, gateway } = await connectionServer();
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            { container: "zed", trust: "curated", posture: "shared", membership: ANY_AUTHOR },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    expect(recOf(gateway, "zed"), "premise: it stood").toBeDefined();
    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor!,
      "zed",
    );
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            ...gateway.stamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    expect(recOf(gateway, "zed"), "premise: and was dropped").toBeUndefined();

    const from = await peerStore();
    const refused = await callTool(base, "op-token", "loam_federate_connect", {
      from,
      into: "zed:room:leaf",
      prefix: "zed:room:leaf:peer",
      token: PEER_TOKEN,
    });
    expect(refused.isError, refused.text).toBe(true);
    expect(refused.text, "and it names the dropped level").toMatch(/declared and then dropped/);
    expect(recOf(gateway, "zed:room"), "and nothing beneath it was made").toBeUndefined();
    expect(gateway.channelStatus().length, "and no peer bytes landed").toBe(0);
    await closePeers();
    await closeAll();
  });

  it("the operator's road refuses a target whose standing ancestor dangles", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    expect((await declareTool(base, ada, "ada:journal:room")).isError, "premise").toBe(false);
    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor!,
      "ada:journal",
    );
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            ...gateway.stamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    expect(recOf(gateway, "ada:journal"), "premise: the middle is gone").toBeUndefined();
    expect(recOf(gateway, "ada:journal:room"), "premise: its child stands").toBeDefined();

    const from = await peerStore();
    const refused = await callTool(base, "op-token", "loam_federate_connect", {
      from,
      into: "ada:journal:room:peers",
      prefix: "ada:journal:room:peers:p",
      token: PEER_TOKEN,
    });
    expect(refused.isError, refused.text).toBe(true);
    expect(recOf(gateway, "ada:journal:room:peers"), "and nothing was minted").toBeUndefined();
    expect(gateway.channelStatus().length, "and no peer bytes landed").toBe(0);
    await closePeers();
    await closeAll();
  });

  it("an unbound caller cannot receive into an orphan either", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    expect((await declareTool(base, ada, "ada:journal:work")).isError, "premise").toBe(false);
    expect((await declareTool(base, ada, "ada:journal:work:notes")).isError, "premise").toBe(false);
    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor!,
      "ada:journal:work",
    );
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            ...gateway.stamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    expect(recOf(gateway, "ada:journal:work:notes"), "premise: the orphan stands").toBeDefined();

    const from = await peerStore();
    const refused = await callTool(base, "op-token", "loam_federate_connect", {
      from,
      into: "ada:journal:work:notes",
      prefix: "ada:journal:work:notes:peer",
      token: PEER_TOKEN,
    });
    expect(refused.isError, refused.text).toBe(true);
    expect(refused.text, "and it says the edge hangs from a container that is not there").toMatch(
      /hangs from a container that does not/,
    );
    expect(gateway.channelStatus().length, "and no peer bytes landed").toBe(0);

    const ok = await callTool(base, "op-token", "loam_federate_connect", {
      from,
      into: "ada:journal",
      prefix: "ada:journal:peer",
      token: PEER_TOKEN,
    });
    expect(ok.isError, ok.text).toBe(false);
    await closePeers();
    await closeAll();
  });

  it("openChannel refuses a target that does not hang under its opener", async () => {
    const { gateway } = await connectionServer();
    await expect(
      gateway.openChannel({
        into: "nowhere:deep:leaf",
        prefix: "nowhere:deep:leaf:peer",
        source: { pull: () => Promise.resolve([]) },
        openedBy: "ada:journal",
      }),
    ).rejects.toThrow(/does not stand/);
    expect(recOf(gateway, "nowhere:deep:leaf"), "and nothing was minted").toBeUndefined();
    expect(recOf(gateway, "nowhere:deep"), "at any level").toBeUndefined();
    await closeAll();
  });

  it("a connection bound BELOW a dropped container stands with it, and falls with it", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    expect((await declareTool(base, ada, "ada:journal:notes")).isError, "premise").toBe(false);

    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor!,
      "ada",
    );
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            ...gateway.stamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    expect(recOf(gateway, "ada"), "premise: the parent is gone").toBeUndefined();
    expect(recOf(gateway, "ada:journal"), "premise: the binding's own still stands").toBeDefined();

    const after = await declareTool(base, ada, "ada:journal:more");
    expect(after.isError, after.text).toBe(true);
    expect(after.text, "and it says the standing ended").toMatch(/no longer stands/);
    expect(recOf(gateway, "ada:journal:more"), "nothing was declared").toBeUndefined();
    await closeAll();
  });

  it("the act's other name asks the same questions", async () => {
    const { base, gateway, connectorsHome } = await connectionServer({
      tokens: { "stranger-token": { actor: "3f".repeat(32) } },
    });
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    const from = await peerStore();

    const before = gateway.containers().containers.size;
    for (const verb of ["loam_container_receive", "loam_federate_connect"] as const) {
      const r = await callTool(base, ada, verb, {
        from,
        into: "ada:journal:",
        prefix: "ada:journal::peer",
        token: PEER_TOKEN,
      });
      expect(r.isError, `${verb} refuses an empty level`).toBe(true);
    }
    expect(gateway.containers().containers.size, "and neither minted anything").toBe(before);

    const answers = await Promise.all(
      (["loam_container_receive", "loam_federate_connect"] as const).map((verb) =>
        callTool(base, "stranger-token", verb, {
          from,
          into: "ada:journal:inbox",
          prefix: "ada:journal:inbox:peer",
          token: PEER_TOKEN,
        }),
      ),
    );
    expect(answers[0]!.isError, "the roster name refuses a stranger").toBe(true);
    expect(answers[0]!.text, "with the federate road's own sentence").toBe(answers[1]!.text);
    expect(answers[0]!.text).toMatch(/federate. grant/);

    const grant = readOAuthFile(connectorsHome).grants[0]!;
    await gateway.revokeConnection({
      inbox: gateway.connectionInboxes.get(grant.inbox!)!,
      connectionKey: grant.actor,
      asPool: true,
    });
    for (const verb of ["loam_container_receive", "loam_federate_connect"] as const) {
      const r = await callTool(base, ada, verb, {
        from,
        into: "ada:journal:inbox",
        prefix: "ada:journal:inbox:peer",
        token: PEER_TOKEN,
      });
      expect(r.isError, `${verb} refuses a connection that no longer stands`).toBe(true);
      expect(r.text, `${verb} says why`).toMatch(/no longer stands/);
    }
    expect(gateway.channelStatus().length, "and no channel stands").toBe(0);
    await closePeers();
    await closeAll();
  });

  it("a dropped connection cannot flip its channel back on", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    const from = await peerStore();
    const opened = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "ada:journal",
      prefix: "ada:journal:peer",
      token: PEER_TOKEN,
    });
    expect(opened.isError, opened.text).toBe(false);
    const channel = gateway.channelStatus()[0]!;
    const off = await callTool(base, ada, "loam_federate_set", {
      channel: channel.name,
      receiving: false,
    });
    expect(off.isError, `premise: it can set its own channel: ${off.text}`).toBe(false);

    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor!,
      "ada:journal",
    );
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            ...gateway.stamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    expect(recOf(gateway, "ada:journal"), "premise: the container is gone").toBeUndefined();

    const back = await callTool(base, ada, "loam_federate_set", {
      channel: channel.name,
      receiving: true,
    });
    expect(back.isError, back.text).toBe(true);
    const after = gateway.channelStatus().find((c) => c.name === channel.name);
    expect(after, "the channel record survives").toBeDefined();
    expect(after!.receiving, "and stays off").toBe(false);
    await closePeers();
    await closeAll();
  });

  it("an unbound caller is refused every roster verb, and is offered them anyway", async () => {
    const { base, gateway } = await connectionServer();
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

  it("everDeclared answers the mint question, and fails closed", async () => {
    const { gateway, base } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareTool(base, ada, "ada:journal:notes");
    const op = gateway.operatorAuthor!;

    expect(everDeclared(gateway.reactor, op, "ada:journal:notes"), "a standing name").toBe(true);
    expect(everDeclared(gateway.reactor, op, "ada:journal:never"), "a name nobody made").toBe(
      false,
    );

    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.validityNow(),
      op,
      "ada:journal:notes",
    );
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            ...gateway.stamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    expect(recOf(gateway, "ada:journal:notes"), "the table forgets it").toBeUndefined();
    expect(everDeclared(gateway.reactor, op, "ada:journal:notes"), "this does not").toBe(true);

    expect(everDeclared(gateway.reactor, undefined, "ada:journal:never")).toBe(true);

    await closeAll();
  });

  it("a retired posture word is an unknown word, to the reader and the door alike", async () => {
    const legacy = "wall";
    const backend = new MemoryBackend();
    await plant(
      backend,
      [
        signClaims(
          {
            timestamp: 9000,
            validFrom: 9000,
            author: OPERATOR,
            pointers: [
              {
                role: "container",
                target: { kind: "entity", entity: { id: "ada:legacy", context: "loam.container" } },
              },
              { role: "trust", target: { kind: "primitive", value: "curated" } },
              { role: "posture", target: { kind: "primitive", value: legacy } },
            ],
          },
          OPERATOR_SEED,
        ),
      ],
      OPERATOR,
    );
    const gw = await Gateway.open(backend, { seed: OPERATOR_SEED });
    const op = gw.operatorAuthor!;
    expect(recOf(gw, "ada:legacy"), "the reader binds nothing").toBeUndefined();
    expect(everDeclared(gw.reactor, op, "ada:legacy"), "so nothing was ever declared").toBe(false);
    expect(
      containerDefect(
        [...gw.reactor.snapshot()].find(
          (d) => JSON.stringify(d.claims).includes("ada:legacy") === true,
        )!,
        gw.reactor,
        gw.validityNow(),
        op,
      ),
      "the door gives the unknown-posture refusal",
    ).toMatch(/exactly one posture: "separate"/);
  });

  it("a refusal is the store's own sentence, whole", () => {
    expect(appendRefusal(new Error("malformed law: the terms above forbid it"))).toBe(
      "the terms above forbid it",
    );
    const plain = "this gateway can no longer persist: the disk is gone";
    expect(appendRefusal(new Error(plain)), "an ordinary fault survives whole").toBe(plain);
    expect(appendRefusal(new Error("malformed law:")), "and an empty why keeps the whole").toBe(
      "malformed law:",
    );
  });

  it("the pool tokens are not names a person may take, at the door that mints one", async () => {
    for (const reserved of ["inbox", "channel"]) {
      expect(reservedNameDefect(reserved), `${reserved} may not be minted`).toBeDefined();
      expect(reservedNameDefect(reserved), "and says why").toMatch(/reserved/);
      expect(userNameDefect(reserved), `${reserved} at rest still resolves`).toBeUndefined();
    }
    for (const ok of ["inboxer", "channels", "ada"]) {
      expect(reservedNameDefect(ok), `${ok} may be minted`).toBeUndefined();
    }

    const home = mkdtempSync(join(tmpdir(), "loam-roster-user-"));
    try {
      const err: string[] = [];
      const io = { out: () => {}, err: (m: string) => err.push(m) };
      const pw = { readSecret: () => Promise.resolve("pw"), scrypt: CHEAP_SCRYPT };

      expect(await run(["init", "--home", home, "--user", "inbox"], io, pw)).toBe(2);
      expect(err.join("\n"), "init says why").toMatch(/reserved/);
      err.length = 0;

      expect(await run(["init", "--home", home, "--no-user"], io)).toBe(0);

      expect(await run(["user", "create", "inbox", "--home", home], io, pw)).toBe(2);
      expect(err.join("\n"), "user create says why").toMatch(/reserved/);
      expect(readCredentials(home).users["inbox"], "and mints nothing").toBeUndefined();
      err.length = 0;

      expect(await run(["pen", "create", "channel", "--home", home], io, pw)).toBe(2);
      expect(err.join("\n"), "pen create says why").toMatch(/reserved/);
      expect(readPenSeed(home, "channel").kind, "and writes no seed").toBe("absent");
      err.length = 0;

      expect(await run(["user", "create", "inboxer", "--home", home], io, pw)).toBe(0);
      expect(readCredentials(home).users["inboxer"], "the ordinary name mints").toBeDefined();
      expect(await run(["pen", "create", "channels", "--home", home], io, pw)).toBe(0);
      expect(readPenSeed(home, "channels").kind, "and the ordinary pen").toBe("present");
    } finally {
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
