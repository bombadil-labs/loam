// T263 — THE WALLS (SPEC §58 position 3: "full leeway inside the subtree; the walls are the edge";
// criterion 4). A bound connection cannot cross its edge upward, cannot exceed its envelope, and is
// told so in words. The decision this slice makes is THE ENVELOPE BINDS: a container's leeway names
// an envelope SIZE, and every pool opened inside that container renders under it — never above the
// operator's own ceiling, which nothing below the operator can widen (§24.5).
//
// The other walls here already stood when this slice arrived; their cases are CONTROLS that pin the
// sentence a person reads, and each says so: nothing a bound connection writes lands in `ada` or the
// primary ground (S1's sink, railed at the delta level there; the object level and the sibling are
// here); the rendered route and the byte door refuse a bound bearer (connection-writes.test.ts:205
// owns the door rail; here the sentence is pinned once more beside its siblings); a binding above
// the root — the person's home, the store itself, another person's subtree — is refused at consent.
//
// NOT HERE, and said so: a resolver arriving on the connection's channel stays inert and its bless
// attempt refuses, and a renderer it blesses serves behind glass — those need the `bless-renderer`
// verb of the roster slice; offering above the root is the offer token's (T264); declaring above the
// root is the `declare` verb's; a child leeway that does not FIT its parent's terms is the cascade
// slice. Each of those slices owes this file's successor a case. And the envelope cases assert the
// ceiling a pool's REPORT resolves, not a render bounded at it: a render refused at the size's
// slot count and not the operator's is owed by the slice that mounts a renderer behind glass.
//
// RAILS-RED on origin/main, this file copied in: 4 red, 3 green — 7 cases. The three greens are
// the CONTROLS named above; the reds are the envelope's, which is what this slice decides (the
// cycle case reds on main because the walk does not exist there).
//
// REVERT PROBES, MEASURED against this file as it stands — 7 cases. Re-measure when you add one.
//   no size clamp at all                                    → 3 red, 4 green
//   the size composes OVER the operator's ceiling           → 1 red, 6 green
//   whether a size governs decided ONCE, at open            → 2 red, 5 green
//   the walk climbs by name only, never by a declared edge  → 2 red, 5 green
//   the walk keeps no memory                                → the file HANGS (killed at 180s)
//   the table read from the OPENER's copy, not the root's   → 1 red, 6 green
// Every size is asserted by number under a wide ceiling; a mutant that moved medium's slots by
// one survived until it was. A probe that removes the walk's memory does not red a case, it
// stops the run: the walk is synchronous, so no test timeout can catch it, and the rail is the
// external clock. A fifth probe once measured a clause DEAD and it was deleted rather than kept:
// metering a pool because a size governs it changed nothing any case could see, since a channel
// pool is untrusted and metered already. The shared walk (`governingLeeway`) also serves the
// receive door; that file's two walk probes were re-measured here against the shared walk and
// each reds one case.
import { describe, expect, it } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import {
  containerClaims,
  governingLeeway,
  inboxName,
  readContainerTable,
} from "../../src/gateway/container.js";
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

/** Re-declare a standing container with a leeway, copying its record, as the admin page would. */
const declare = (gw: Gateway, container: string, leeway: Leeway): Promise<unknown> => {
  const standing = readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(container);
  if (standing === undefined) throw new Error(`${container} is not declared`);
  return gw.append([
    signClaims(
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
const receive = (base: string, bearer: string, into: string, from: string) =>
  callTool(base, bearer, "loam_federate_connect", {
    from,
    into,
    prefix: `${into}:peer`,
    token: PEER_TOKEN,
  });

/** The envelope a pool renders under, by its container name. */
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
          envelopeClaims(ENVELOPE_ANY, limits, OPERATOR, gateway.nextTimestamp()),
          OPERATOR_SEED,
        ),
      ]);
    // With no operator envelope declared, the operator's ceiling IS the floor, and a size can only
    // sit under it: small and large alike render at the floor.
    expect(envelopeOf(gateway, pool), "small under the floor").toEqual(DEFAULT_QUARANTINE_ENVELOPE);
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, envelope: "large" });
    expect(envelopeOf(gateway, pool), "large under the floor").toEqual(DEFAULT_QUARANTINE_ENVELOPE);
    // The operator raises the ceiling: now the size is what binds, and it is a delta the next
    // render obeys.
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
    // The operator tightens below the size: the operator's numbers win, every dimension.
    await operators({ maxConcurrentRenders: 2, renderTimeoutMs: 250, maxMemoryMb: 64 });
    expect(envelopeOf(gateway, pool), "the operator's ceiling wins").toEqual({
      maxConcurrentRenders: 2,
      renderTimeoutMs: 250,
      maxMemoryMb: 64,
    });
    // Two-sided: a pool the person opens at the root carries no size and keeps the operator's
    // ceiling alone.
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
    // Whether a size governs is asked on every resolve, never fixed at open. A pool opened
    // before its container declared any leeway renders under the operator's ceiling; declaring
    // the size binds it; re-declaring the container without a pointer (a pure namespace again)
    // releases it to the operator's ceiling.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true });
    await gateway.append([
      signClaims(
        envelopeClaims(
          ENVELOPE_ANY,
          { maxConcurrentRenders: 32, renderTimeoutMs: 4000, maxMemoryMb: 1024 },
          OPERATOR,
          gateway.nextTimestamp(),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:inbox", peer)).isError).toBe(false);
    const pool = "channel:ada:journal:inbox:ada:journal:inbox:peer";
    // `ada:journal` declared a leeway with the default size: small binds from the start.
    expect(envelopeOf(gateway, pool)).toEqual(DEFAULT_QUARANTINE_ENVELOPE);
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, envelope: "medium" });
    expect(envelopeOf(gateway, pool), "declared after").toEqual({
      maxConcurrentRenders: 8,
      renderTimeoutMs: 1000,
      maxMemoryMb: 256,
    });
    // Withdrawn: the container re-declared with no pointer inherits, and nothing above it spoke.
    const standing = readContainerTable(gateway.reactor, gateway.operatorAuthor).containers.get(
      "ada:journal",
    )!;
    await gateway.append([
      signClaims(
        containerClaims(
          {
            container: "ada:journal",
            trust: standing.trust,
            posture: standing.posture,
            ...(standing.parent === undefined ? {} : { parent: standing.parent }),
            ...(standing.membership === undefined ? {} : { membership: standing.membership }),
          },
          OPERATOR,
          gateway.nextTimestamp(),
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

  it("the governing walk ends on a cycle the door admits", async () => {
    // The table restores a forest over parent edges only; an `inboxOf` edge can point a
    // container at itself and the door admits it. Without memory the walk hung the event loop
    // on one lawful delta; with it, a revisit ends the walk with nothing governing.
    const { gateway } = await connectionServer();
    await gateway.append([
      signClaims(
        containerClaims(
          { container: "loop", trust: "curated", posture: "separate", inboxOf: "loop" },
          OPERATOR,
          gateway.nextTimestamp(),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const table = readContainerTable(gateway.reactor, gateway.operatorAuthor);
    expect(table.containers.get("loop")?.inboxOf).toBe("loop");
    expect(governingLeeway(table, "loop")).toBeUndefined();
    expect(governingLeeway(table, "loop:child")).toBeUndefined();
    await closeAll();
  });

  it("a pool nested in a pool renders under the size too: the walk reads the root's table", async () => {
    // A pool's own reactor is a seeded copy that never saw the leeway; read from it, a nested
    // pool escaped the size. The table is the root's, on every resolve.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true });
    await gateway.append([
      signClaims(
        envelopeClaims(
          ENVELOPE_ANY,
          { maxConcurrentRenders: 32, renderTimeoutMs: 4000, maxMemoryMb: 1024 },
          OPERATOR,
          gateway.nextTimestamp(),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const peer = await peerStore();
    expect((await receive(base, ada, "ada:journal:inbox", peer)).isError).toBe(false);
    // The size is declared AFTER the channel pool opened, so the pool's seeded copy never sees it:
    // only the root's table can govern what is opened inside the pool from here on.
    await declare(gateway, "ada:journal", { ...SEALED_LEEWAY, receive: true, envelope: "medium" });
    const outer = gateway.channelPools.get("channel:ada:journal:inbox:ada:journal:inbox:peer")!;
    // Declared IN THE POOL: a pool's reactor is a seeded copy the root's later deltas never reach,
    // and the nested pool's declaration lives where it is opened. The root's table never sees it,
    // so the walk climbs by the name's own colon to the container that declared the size.
    await outer.gateway!.append([
      signClaims(
        containerClaims(
          {
            container: "ada:journal:inbox:nested",
            trust: "untrusted",
            posture: "separate",
            parent: "ada:journal:inbox",
          },
          OPERATOR,
          outer.gateway!.nextTimestamp(),
        ),
        OPERATOR_SEED,
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

  it("nothing a bound connection writes lands in `ada` or the primary ground — the object level and the sibling", async () => {
    // CONTROL at the delta level (S1 railed the sink); the object level and the sibling are new.
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
    // CONTROL: connection-writes.test.ts:205 owns this rail; the sentence is pinned here beside its siblings.
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
    // CONTROL: the consent door already refuses; the sentences are pinned here.
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
