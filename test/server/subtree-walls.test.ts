import { describe, expect, it } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import {
  containerClaims,
  governingLeeway,
  inboxName,
  readContainerTable,
} from "../../src/gateway/container-law.js";
import {
  DEFAULT_QUARANTINE_ENVELOPE,
  ENVELOPE_ANY,
  envelopeClaims,
} from "../../src/gateway/envelope.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SEALED_LEEWAY, type Leeway } from "../../src/gateway/leeway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import {
  closeAll,
  connect,
  connectionServer,
  consent,
  heightDeltas,
  heightVia,
  mutateHeight,
  OPERATOR,
  OPERATOR_SEED,
  pkce,
  poolOf,
  grantOf,
} from "../helpers/connection-fixture.js";
import { FERN } from "../spike/garden.js";
import { withStamp } from "../../src/gateway/stamp.js";

const PEER_SEED = "7a".repeat(32);
const PEER_TOKEN = "peer-door-token";

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

const declare = (gw: Gateway, container: string, leeway: Leeway): Promise<unknown> => {
  const standing = readContainerTable(
    gw.reactor,
    gw.validityNow(),
    gw.operatorAuthor,
  ).containers.get(container);
  if (standing === undefined) throw new Error(`${container} is not declared`);
  return gw.append([
    signClaims(
      withStamp(gw.stamp(), (t) =>
        containerClaims(
          {
            container,
            trust: standing.trust,
            posture: standing.posture,
            ...(standing.parent === undefined ? {} : { parent: standing.parent }),
            ...(standing.membership === undefined ? {} : { membership: standing.membership }),
            ...(standing.membershipAt === undefined ? {} : { membershipAt: standing.membershipAt }),
            ...(standing.version === undefined ? {} : { version: standing.version }),
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
const receive = (base: string, bearer: string, into: string, from: string) =>
  callTool(base, bearer, "loam_federate_connect", {
    from,
    into,
    prefix: `${into}:peer`,
    token: PEER_TOKEN,
  });

const envelopeOf = (gw: Gateway, container: string) =>
  gw.envelopeReports().find((r) => r.container === container)?.envelope;

describe("§58 — the walls", () => {
  it("THE ENVELOPE BINDS: a pool opened inside a container renders under the container's envelope size", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, envelope: "small" });
    const peer = await peerStore();
    const r = await receive(base, ada, "ada:journal:inbox", peer);
    expect(r.isError, r.text).toBe(false);
    const pool = "channel:ada:journal:inbox:ada:journal:inbox:peer";
    const operators = (limits: Record<string, number>): Promise<unknown> =>
      gateway.append([
        signClaims(
          withStamp(gateway.stamp(), (t) => envelopeClaims(ENVELOPE_ANY, limits, OPERATOR, t)),
          OPERATOR_SEED,
        ),
      ]);
    expect(envelopeOf(gateway, pool), "small under the floor").toEqual(DEFAULT_QUARANTINE_ENVELOPE);
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, envelope: "large" });
    expect(envelopeOf(gateway, pool), "large under the floor").toEqual(DEFAULT_QUARANTINE_ENVELOPE);
    await operators({ maxConcurrentRenders: 32, renderTimeoutMs: 4000, maxMemoryMb: 1024 });
    expect(envelopeOf(gateway, pool), "large under a wide ceiling").toEqual({
      maxConcurrentRenders: 16,
      renderTimeoutMs: 2000,
      maxMemoryMb: 512,
    });
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, envelope: "medium" });
    expect(envelopeOf(gateway, pool), "medium under a wide ceiling").toEqual({
      maxConcurrentRenders: 8,
      renderTimeoutMs: 1000,
      maxMemoryMb: 256,
    });
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, envelope: "small" });
    expect(envelopeOf(gateway, pool), "small under a wide ceiling").toEqual(
      DEFAULT_QUARANTINE_ENVELOPE,
    );
    await operators({ maxConcurrentRenders: 2, renderTimeoutMs: 250, maxMemoryMb: 64 });
    expect(envelopeOf(gateway, pool), "the operator's ceiling wins").toEqual({
      maxConcurrentRenders: 2,
      renderTimeoutMs: 250,
      maxMemoryMb: 64,
    });
    await gateway.openChannel({
      into: "friends",
      prefix: "friends:carol",
      source: { pull: () => Promise.resolve([]) },
    });
    expect(envelopeOf(gateway, "channel:friends:friends:carol")).toEqual({
      maxConcurrentRenders: 2,
      renderTimeoutMs: 250,
      maxMemoryMb: 64,
    });
    await closePeers();
    await closeAll();
  });

  it("a size declared AFTER the pool opened binds it, and one withdrawn releases it", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true });
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
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
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:inbox", peer)).isError).toBe(false);
    const pool = "channel:ada:journal:inbox:ada:journal:inbox:peer";
    expect(envelopeOf(gateway, pool)).toEqual(DEFAULT_QUARANTINE_ENVELOPE);
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, envelope: "medium" });
    expect(envelopeOf(gateway, pool), "declared after").toEqual({
      maxConcurrentRenders: 8,
      renderTimeoutMs: 1000,
      maxMemoryMb: 256,
    });
    const standing = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    ).containers.get("ada:journal")!;
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:journal",
              trust: standing.trust,
              posture: standing.posture,
              ...(standing.parent === undefined ? {} : { parent: standing.parent }),
              ...(standing.membership === undefined ? {} : { membership: standing.membership }),
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    expect(envelopeOf(gateway, pool), "withdrawn").toEqual({
      maxConcurrentRenders: 32,
      renderTimeoutMs: 4000,
      maxMemoryMb: 1024,
    });
    await closePeers();
    await closeAll();
  });

  it("the governing walk ends on a cycle the door admits, and reads it as sealed", async () => {
    const { gateway } = await connectionServer();
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "inbox:loop",
              trust: "curated",
              posture: "separate",
              inboxOf: "inbox:loop",
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const table = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    );
    expect(table.containers.get("inbox:loop")?.inboxOf).toBe("inbox:loop");
    expect(governingLeeway(table, "inbox:loop")).toEqual({
      at: "inbox:loop",
      leeway: SEALED_LEEWAY,
    });
    expect(governingLeeway(table, "inbox:loop:child")).toBeUndefined();
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            { container: "bea", trust: "curated", posture: "separate", leeway: SEALED_LEEWAY },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada",
              trust: "curated",
              posture: "separate",
              leeway: { ...SEALED_LEEWAY, receive: true },
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:plain",
              trust: "curated",
              posture: "separate",
              inboxOf: "bea:elsewhere",
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const later = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    );
    expect(governingLeeway(later, "ada:plain")?.at).toBe("ada");
    await closeAll();
  });

  it("a pool nested in a pool renders under the size too: the walk reads the root's table", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true });
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
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
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:inbox", peer)).isError).toBe(false);
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, envelope: "medium" });
    const outer = gateway.channelPools.get("channel:ada:journal:inbox:ada:journal:inbox:peer")!;
    const pool = outer.gateway!;
    await pool.append([
      pool.signer!.sign(
        withStamp(pool.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:journal:inbox:nested",
              trust: "untrusted",
              posture: "separate",
              parent: "ada:journal:inbox",
            },
            pool.operatorAuthor!,
            t,
          ),
        ),
      ),
    ]);
    const inner = await outer.gateway!.openContainer({
      name: "ada:journal:inbox:nested",
      trust: "untrusted",
      posture: "separate",
      backend: new MemoryBackend(),
    });
    expect(inner.entity).toBe("ada:journal:inbox:nested");
    const report = gateway
      .envelopeReports()
      .find((r) => r.container === "ada:journal:inbox:nested");
    expect(report?.envelope, "the nested pool").toEqual({
      maxConcurrentRenders: 8,
      renderTimeoutMs: 1000,
      maxMemoryMb: 256,
    });
    await closePeers();
    await closeAll();
  });

  it("a container named under the binding but PARENTED elsewhere is governed by its name", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await connect(base, "bea", "notes");
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: false, envelope: "small" });
    await declare(gateway, "ada", { ...SEALED_LEEWAY, receive: true, envelope: "large" });
    await declare(gateway, "bea:notes", { ...SEALED_LEEWAY, receive: false });
    const parented = (name: string, parent: string): Promise<unknown> =>
      gateway.append([
        signClaims(
          withStamp(gateway.stamp(), (t) =>
            containerClaims(
              { container: name, trust: "curated", posture: "separate", parent },
              OPERATOR,
              t,
            ),
          ),
          OPERATOR_SEED,
        ),
      ]);
    await parented("ada:journal:x", "ada");
    await parented("ada:journal:y", "bea:notes");
    const peer = await peerStore();
    const x = await receive(base, ada, "ada:journal:x", peer);
    expect(x.isError, "the name's own binding says receive off").toBe(true);
    expect(x.text).toMatch(/ada:journal does not receive/);
    expect(x.text).not.toMatch(/\bada does not receive|bea:notes/);
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, envelope: "small" });
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
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
    expect((await receive(base, ada, "ada:journal:x", peer)).isError).toBe(false);
    expect(envelopeOf(gateway, "channel:ada:journal:x:ada:journal:x:peer")).toEqual(
      DEFAULT_QUARANTINE_ENVELOPE,
    );
    await closePeers();
    await closeAll();
  });

  it("a container parented under ANOTHER PERSON'S container is governed by its name, and no refusal names them", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await connect(base, "bea", "notes");
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: false });
    await declare(gateway, "bea:notes", { ...SEALED_LEEWAY, receive: false });
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:journal:y",
              trust: "curated",
              posture: "separate",
              parent: "bea:notes",
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const peer = await peerStore();
    const y = await receive(base, ada, "ada:journal:y", peer);
    expect(y.isError).toBe(true);
    expect(y.text).toMatch(/ada:journal does not receive/);
    expect(y.text).not.toMatch(/bea:notes/);
    await closePeers();
    await closeAll();
  });

  it("nothing a bound connection writes lands in `ada` or the primary ground — the object level and the sibling", async () => {
    const server = await connectionServer();
    const { base, gateway } = server;
    const ada = await connect(base, "ada", "journal");
    const bea = await connect(base, "bea", "notes");
    expect((await mutateHeight(base, ada, 41)).status).toBe(200);
    expect(heightDeltas(gateway, 41), "the primary ground").toEqual([]);
    const { connectorsHome } = server;
    const inboxOf = (user: string, container: string): string =>
      inboxName(container, grantOf(connectorsHome, user).actor);
    expect(heightDeltas(poolOf(gateway, inboxOf("ada", "ada:journal")), 41)).toHaveLength(1);
    expect(
      heightDeltas(poolOf(gateway, inboxOf("bea", "bea:notes")), 41),
      "the sibling's pool",
    ).toEqual([]);
    expect(await heightVia(base, ada)).toBe(41);
    expect(await heightVia(base, bea)).not.toBe(41);
    await closeAll();
  });

  it("the rendered route and the byte door refuse a bound bearer in the words that name the wall", async () => {
    const { base } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    for (const path of [
      "/default/app/plant/plant:fern",
      "/default/bytes/abc?from=Plant/plant:fern",
    ]) {
      const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${ada}` } });
      expect(await res.text(), path).toContain("reads only that container");
    }
    await closeAll();
  });

  it("a binding above the root is refused at consent: the home, the store, another person's subtree", async () => {
    const { base } = await connectionServer();
    const p = pkce();
    const home = await consent(base, "ada", p.challenge, { bind: "ada" });
    expect(home.status).toBe(400);
    expect(home.text).toContain("Your home container is never bound");
    const store = await consent(base, "ada", p.challenge, { bind: "" });
    expect(store.status).toBe(400);
    expect(store.text).toContain("never bound to the store or to your home");
    await connect(base, "bea", "notes");
    const theirs = await consent(base, "ada", p.challenge, { bind: "bea:notes" });
    expect(theirs.status).toBe(404);
    expect(theirs.text).toMatch(/Nothing under your name answers to that|not yours/i);
    await closeAll();
  });
});
