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
// NOT HERE, and said so. `sever`, `promote-stage` and `bless-renderer` are the roster's other
// three; they ship in their own change, and nothing here is weakened by their absence because the
// tools do not exist and no door serves them.
//
// TWO GAPS THIS FILE DOES NOT CLOSE, both inherited rather than introduced:
//   - `receive` calls `sync()` after the channel record has landed, so a bad peer token answers
//     isError over a channel that STANDS and will pull on the next poll. That is the shape
//     `loam_federate_connect` has always had; this slice only gives it a second name. The rail
//     that closes it belongs with the road, not with the roster.
//   - a delta that lands in the backend and then throws inside ingest is durable while the caller
//     is told the act failed (gateway/ingest.ts). Every door-level refusal here — the standing
//     check, the fence, the standing name, the pool pointer, the reach walk, the one rule —
//     precedes the append, so a refusal this file asserts genuinely wrote nothing.
//
// The pool tokens: `inbox` and `channel` lead a pool's name, and the leeway walk hops a pool to
// its host. A person named `inbox` would own a home the walk reads as a pool. The walls rail
// (subtree-walls.test.ts) named that reservation as owed by this slice, and the last cases pay it
// AT MINTING ONLY — `userNameDefect` is asked on every read and every login, so folding it there
// would strand a person already named `inbox` in a store provisioned before the rule.
//
// REVERT PROBES, MEASURED against this file as it stands — 34 cases. Re-measure when you add one.
// Rows are measured at the case count of the round that added them; the newest are at 34.
//   the fence drops its colon                            → 19 red, 13 green
//   the fence admits an empty level                      →  1 red, 31 green
//   no bound on the name's length or depth               →  1 red, 31 green
//   leeway admits the caller's OWN container             →  1 red, 31 green
//   declare skips the standing-name check                →  1 red, 31 green
//   declare writes no parent edge                        → 11 red, 21 green
//   declare declares the target and not the middles      → 17 red, 15 green
//   declare mints back a level the person dropped        →  1 red, 31 green
//   receive mints back a level the person dropped        →  1 red, 31 green
//   the declare door does not ask if the edge dangles    →  1 red, 31 green
//   the declare door does not ask where the edge leads   →  1 red, 31 green
//   the receive door does not gate its own mint          →  1 red, 31 green
//   the receive door admits a name in another's tree     →  1 red, 32 green
//   the receive door asks the binding, not the home      →  1 red, 32 green
//   withinSubtree answers true for a name outside        →  3 red, 30 green
//   the leeway verb keeps its own wording                →  1 red, 32 green
//   the home is split off the name instead of walked     →  1 red, 33 green
//   the reach walk follows parent only, not inboxOf      →  1 red, 33 green
//   the climb follows one edge kind, not both            →  1 red, 33 green
//   the gate asks the binding but not the target        →  1 red, 33 green
//   the gate weighs only a target that already stands    →  1 red, 33 green
//   the gate does not fail closed on two trees           →  1 red, 33 green
//   the gate does not require the root to stand          →  0 red, 34 green
//   the receive road asks the edge only when it mints    →  1 red, 31 green
//   the refusal names the dropped ancestor (an oracle)   →  1 red, 31 green
//   the write seam asks the name, not the chain          →  1 red, 31 green
//   the standing check asks one name, not the chain      →  1 red, 31 green
//   the standing check is gone entirely                  →  3 red, 29 green
//   the operator road writes an edge onto an absent name →  1 red, 31 green
//   the operator road skips the dangling-ancestor check  →  1 red, 31 green
//   the operator road mints a colon-free ancestor        →  1 red, 31 green
//   the operator road declares no parent edge at all     →  2 red, 30 green
//   the operator road declares only the name it was given→  4 red, 28 green
//   the struck rule skips the level this road won't mint →  1 red, 31 green
//   the walk may fall off its stop and mint an orphan    →  1 red, 31 green
//   everDeclared asks the door's test, not the bind test →  1 red, 31 green
//   everDeclared answers across authors with no operator →  1 red, 31 green
//   everDeclared forgets a struck name                   →  3 red, 29 green
//   declare reports only the name it was asked for       →  1 red, 31 green
//   leeway drops the record's pool refusal               →  1 red, 31 green
//   leeway asks the name and not the reach               →  2 red, 30 green
//   the act's other name asks nothing                    →  1 red, 31 green
//   the roster block swallows the receive verb           →  1 red, 31 green
//   federate_set does not ask the connection             →  1 red, 31 green
//   receive skips the shared name rule                   →  1 red, 31 green
//   the unbound check is gone                            →  1 red, 31 green
//   the parser drops an unknown key                      →  2 red, 30 green
//   the door reports success over a refused append       →  1 red, 31 green
//   the leeway re-declaration drops the parent           →  3 red, 29 green
//   the reservation is gone from loam init --user        →  1 red, 31 green
//   the reservation is gone from user create             →  1 red, 31 green
//   the reservation is gone from pen create              →  1 red, 31 green
//   the reservation is folded into userNameDefect        →  1 red, 31 green
//   the refusal helper slices a non-law error            →  1 red, 31 green
//   the receive door does not ask if the edge dangles    →  0 red, 32 green
//
// TWO PROBES ARE GREEN, AND THAT IS THE HONEST RECORD. The receive door's edge check is a second
// guard on a road whose first guard refuses earlier in every state a rail can reach: `openChannel`
// asks the same question of every caller before it mints. And the tree gate's "the root must
// stand" half needs a binding whose only upward edge is a dangling `inboxOf`; no door writes one,
// and the standing check walks `parent`, so no case reaches it.
//
// A THIRD PROBE WAS GREEN FOR A BAD REASON, AND THE RECORD SAID SO WRONGLY. The two-tree gate was
// recorded as undrivable from any door, blamed on the leeway walk hopping a pool. That mechanism
// hops on the pool NAME token, not on an `inboxOf` record. The real cause was this file's own
// fixture: it re-declared the container without its leeway, and latest-wins per declaration means
// an omitted leeway is a DELETED one, so the door refused for an unrelated reason. The fixture
// carries the leeway now and the probe is red. A rail that records a guard as untestable when it
// is testable is worse than one that omits it. It is written down rather than deleted, because a
// probe removed for being green reads exactly like a probe never run. `openChannel`'s dangling
// check inside its own minting branch is unprobed for the same reason and named here.
//
// AND ONE GAP IS ASSERTED RATHER THAN CLOSED. On the operator's road, a target two levels below a
// top-level name that does not stand mints a container with no parent edge — nothing dangles, but
// nothing reaches it either. Both repairs break a frozen rail, so the shape is a landed decision
// and T277 carries it. The case that would otherwise read as "fixed" asserts the gap instead.
//
// RAILS-RED IS NOT MEASURED FOR EVERY CASE, and the record should say which. The file does not
// LOAD on origin/main, because it imports a module this slice adds, so vitest reports one failed
// suite rather than thirty-four failed cases: that measures the import graph. The sixteen cases
// present at the last resolvable revision measured 16 red, 0 green. For the eighteen added since,
// the probe table above is the instrument, and every one of them has a probe that reds it.
//
// ONE CASE IS HELPER-LEVEL, and says so here: `a refusal is the store's own sentence, whole` calls
// `appendRefusal` directly. Every other case in this file goes through a door.
//
// THREE ROUNDS OF INDEPENDENT REVIEW, AND EVERY ROUND FOUND DEFECTS THE PREVIOUS ROUND'S FIXES
// INTRODUCED. Round one: six probes green, each a rail that read correctly and proved nothing.
// Round two: the middles walk could resurrect a container a person had dropped, the act's other
// name skipped every new check, and the receive door minted from a name rule only its sibling
// asked. Round three: the SAME resurrection one level down — a struck middle looks exactly like a
// name nobody declared — the standing check asked one name where a drop strikes one name and
// leaves its descendants standing alone, and `federate_set` wrote on a binding it never weighed.
// Two claims from round three were refuted by reading the code: the append and register roads do
// ask, through `poolForBinding`, which refuses a dropped container before anything is signed.
// Round four: the drop was STILL growable, through the descendants that outlived it. A walk that
// stops at the first STANDING name is satisfied by an orphan whose own parent was struck — the
// struck level never enters the walk at all — so both doors now ask whether the name they stopped
// at hangs from anything, and the unbound receive branch got the struck-name rule it never had.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import {
  containerClaims,
  containerDefect,
  danglingAncestor,
  treeRootsOf,
  everDeclared,
  LEGACY_POSTURES,
  readContainerTable,
  survivingDeclarationIds,
} from "../../src/gateway/container.js";
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

/** A fixed, cheap cost so one `user create` does not pay the interactive scrypt floor. */
const CHEAP_SCRYPT: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };

/** A membership Term that matches any author — what a plain container's own ground admits. */
const ANY_AUTHOR = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: "x" } },
  in: "input",
};

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

/** Terms nested `depth` levels deep, each level delegating to the next. */
const nest = (depth: number): Record<string, unknown> =>
  depth <= 0 ? { envelope: "small" } : { envelope: "small", delegate: nest(depth - 1) };

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
    expect(JSON.parse(made.text), "and the reply names what it signed").toMatchObject({
      declared: ["ada:journal:notes"],
    });
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
    // And the fence itself is outside the fence: `ada:journal` does not begin `ada:journal:`, so
    // the connection cannot re-declare its own container either. The rule that refuses it is the
    // fence, not the standing-name check — the case below owns that one — so the sentence is read
    // here rather than the boolean alone.
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
    // And the refusal before it was the LEEWAY, not the fence: same call, same names, and the
    // sentence names the container that does not receive. A boolean alone could not tell the two
    // rules apart, and the fence is the one this file tests everywhere else.
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
    // NAMES THE CEILING. The alternation must not admit a fence-shaped or generic refusal, so it
    // matches the law's own words and the case then asserts the container whose terms refused.
    expect(wide.text, "the refusal names the rule").toMatch(/delegates nothing|does not fit/);
    expect(wide.text, "and the container whose terms refused").toContain("ada:journal");
    expect(wide.text, "and it is the law's sentence, not the raw fault").not.toMatch(
      /malformed law/,
    );
    expect(recOf(gateway, "ada:journal:notes")?.leewayDeclared, "nothing was written").toBe(false);
    // The other side: under terms that allow it, the same call completes.
    await declareAs(gateway, "ada:journal", OPEN);
    const fits = await leewayTool(base, ada, { name: "ada:journal:notes", receive: true });
    expect(fits.isError, fits.text).toBe(false);
    await closeAll();
  });

  it("declare names every level it stands on, so the person's own doors can see it", async () => {
    // REACH IS WALKED BY DECLARED PARENT EDGES; THE FENCE IS READ FROM THE NAME. A container hung
    // off an undeclared middle is governed by the leeway walk, which climbs by name, and invisible
    // to every door the person has, which walks edges. So the missing middles are declared with it.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const deep = await declareTool(base, ada, "ada:journal:notes:drafts:old");
    expect(deep.isError, deep.text).toBe(false);
    // REPORTS WHAT IT SIGNED. Naming one level below an undeclared one declares them all, and a
    // reply naming only the target would hide permanent law the caller never asked for (H7).
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
    // The object level: the person's own reach, walked by edges, reaches all of it.
    const reach = subtreeOf(gateway.containers(), "ada");
    for (const level of ["ada:journal:notes", "ada:journal:notes:drafts:old"]) {
      expect(reach.has(level), `${level} is in the person's reach`).toBe(true);
    }
    // And it is SHARED, not separate: a separate container with no backend fails the scope walk
    // closed, so one successful declaration would brick every later read this connection makes.
    expect(recOf(gateway, "ada:journal:notes:drafts")?.posture).toBe("shared");
    const still = await callTool(base, ada, "loam_query", { query: "{ __typename }" });
    expect(still.isError, `the connection still reads: ${still.text}`).toBe(false);
    await closeAll();
  });

  it("declare refuses a name with an empty segment, and a name without end", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const before = gateway.containers().containers.size;
    // `ada:journal:` passes a bare prefix test and is the fence itself. It would stand as a
    // container whose listed name reads as its parent's, and whose children's fence doubles the
    // colon.
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
    // THE FENCE READS THE NAME; REACH IS WALKED BY THE EDGE. The law admits a parent that
    // disagrees with the name — it refuses only cycles and cross-trust moves — so a name under
    // this connection's path can resolve inside a subtree it was never bound to. Writing law
    // beneath such a name administers it from somewhere the person did not put it.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    // The leeway permits, so the rule under test is the MINT rule and not the switch.
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    await declareAs(gateway, "ada:sibling", OPEN);
    await gateway.append([
      signClaims(
        containerClaims(
          {
            container: "ada:journal:away",
            trust: "curated",
            posture: "shared",
            membership: recOf(gateway, "ada:journal")!.membership,
            parent: "ada:sibling",
          },
          OPERATOR,
          gateway.nextTimestamp(),
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

    // AND THE RECEIVE DOOR REFUSES THE SAME MINT. Resolution governs by name — the walls settled
    // that — but MAKING a container beneath a name whose edges lead elsewhere is new law
    // administered from outside this subtree, which is the act the write verbs gate. One rule,
    // whichever door asks to mint.
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

    // A NAME WITH NO PARENT EDGE AT ALL IS OUTSIDE TOO, and both write verbs say so the same way.
    // Reach is walked by edges: a container that hangs from nothing is on no page the person has,
    // so law written beneath it is law they cannot see or drop — the same harm as the case above,
    // reached by a name that was never joined to the tree rather than one whose join was struck.
    await gateway.append([
      signClaims(
        containerClaims(
          {
            container: "ada:journal:rootless",
            trust: "curated",
            posture: "shared",
            membership: recOf(gateway, "ada:journal")!.membership,
          },
          OPERATOR,
          gateway.nextTimestamp(),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const rootless = await declareTool(base, ada, "ada:journal:rootless:z");
    expect(rootless.isError, rootless.text).toBe(true);
    expect(rootless.text, "the same sentence the leeway verb speaks").toMatch(
      /does not stand inside it/,
    );
    // And the two write verbs agree about the very same target.
    const shaped = await leewayTool(base, ada, { name: "ada:journal:rootless" });
    expect(shaped.isError, "the leeway verb refuses it too").toBe(true);
    expect(shaped.text).toMatch(/does not stand inside it/);
    // WORD FOR WORD, and this fixture is the one that catches a divergence: `rootless` has no
    // parent at all, so a sentence saying "its parent is elsewhere" is false about it. Both verbs
    // say what is true instead, and say it the same way.
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

    // A POOL, ASKED OF THE RECORD. The law lets an `inboxOf` stand on any name, so a name inside
    // the fence can carry one. The name argument would admit it; the record's own pointer is what
    // refuses, and the pointer survives.
    await declareTool(base, ada, "ada:journal:held");
    await gateway.append([
      signClaims(
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
          gateway.nextTimestamp(),
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

    // A NAME WHOSE EDGE IS ELSEWHERE. The fence reads the name; reach walks the parent edge. The
    // law refuses only cycles and cross-trust moves, so the two can disagree — and then the name
    // is not the question to ask.
    await declareAs(gateway, "ada:elsewhere", OPEN);
    await gateway.append([
      signClaims(
        containerClaims(
          {
            container: "ada:journal:away",
            trust: "curated",
            posture: "shared",
            membership: recOf(gateway, "ada:journal:held")!.membership,
            parent: "ada:elsewhere",
          },
          OPERATOR,
          gateway.nextTimestamp(),
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
    // THE WHOLE PAYLOAD, NOT JUST ONE SWITCH. Every field this verb parses is asked for here and
    // read back off the record: the three switches, the envelope, and nested terms. Without this
    // case the parser could be replaced by one that reads `receive` and hard-codes the rest.
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

    // AND NOTHING IT WAS NOT. Every switch starts off, so a second call naming only the container
    // turns all of them off again — an omitted field is not an unchanged field.
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

    // Each of these is a shape the leeway law has no reading for. The door names the shape rather
    // than coercing it into something the caller did not ask for — a silent coercion here would
    // write a leeway nobody chose, which is the one thing a permission must never do.
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ envelope: "enormous" }, /envelope is "small", "medium" or "large"/],
      [{ envelope: 3 }, /envelope is "small", "medium" or "large"/],
      [{ delegate: "yes please" }, /a leeway is an object/],
      [{ delegate: { envelope: "enormous" } }, /envelope is "small", "medium" or "large"/],
      [{ delegate: nest(40) }, /nests deeper/],
      // THE REFUSAL THAT MATTERS MOST: a misspelled switch. Dropping it would write a permission
      // the caller did not choose and report it as what they asked for.
      [{ recieve: true }, /unknown key "recieve"/],
      [{ delegate: { publsh: true } }, /unknown key "publsh"/],
    ];
    for (const [args, why] of bad) {
      const r = await leewayTool(base, ada, { name: "ada:journal:notes", ...args });
      expect(r.isError, `${JSON.stringify(args)} is refused`).toBe(true);
      expect(r.text, `${JSON.stringify(args)} says which shape`).toMatch(why);
      // And the leeway that stood is still standing: a refusal writes nothing.
      expect(recOf(gateway, "ada:journal:notes")?.leeway.envelope, "unchanged").toBe("medium");
      expect(recOf(gateway, "ada:journal:notes")?.leeway.receive, "unchanged").toBe(true);
    }
    // The other side of the nesting depth: one level short of the refusal is accepted.
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

  it("a connection whose standing ended shapes nothing, though its token still says bound", async () => {
    // STANDING LIVES IN THE POOL, NOT THE TOKEN. A person can end a connection by striking its
    // write grant in its inbox pool; the token is untouched and keeps resolving with its container
    // recorded. These verbs write with the STORE'S OWN KEY, so they ask the pool, like every
    // federation road does, rather than trusting the token's own word.
    const { base, gateway, connectorsHome } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    expect((await declareTool(base, ada, "ada:journal:before")).isError, "premise").toBe(false);

    const grant = readOAuthFile(connectorsHome).grants[0]!;
    await gateway.revokeConnection({
      inbox: gateway.connectionInboxes.get(grant.inbox!)!,
      connectionKey: grant.actor,
      ownerSeed: OPERATOR_SEED,
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
    // THE POOL OUTLIVES THE CONTAINER. Dropping a shared container strikes that container's
    // declarations and leaves the connection's inbox pool declared and attached, so the grant
    // check alone still says the connection stands. A walk that climbed to the nearest declared
    // ancestor would then re-declare the dropped container itself — undoing the person's act,
    // signed with the store's own key, at the request of the party it was aimed at.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await declareTool(base, ada, "ada:journal:before")).isError, "premise").toBe(false);

    // Strike the container's declarations and leave the pool alone. This is the SHIPPED shape:
    // `survivingDeclarationIds` is what the admin page's drop-confirm road gathers for a shared
    // container, and negating them is what it appends.
    const ids = survivingDeclarationIds(gateway.reactor, gateway.operatorAuthor!, "ada:journal");
    expect(ids.length, "premise: ada:journal was declared").toBeGreaterThan(0);
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            timestamp: gateway.nextTimestamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    expect(recOf(gateway, "ada:journal"), "premise: the container is gone").toBeUndefined();
    // And the pool it was bound under is still there: that is exactly why the grant check alone
    // would still say this connection stands.
    expect(gateway.connectionInboxes.size, "premise: the pool outlives it").toBeGreaterThan(0);

    const after = await declareTool(base, ada, "ada:journal:after");
    expect(after.isError, after.text).toBe(true);
    expect(after.text, "and it says the standing ended").toMatch(/no longer stands/);
    expect(recOf(gateway, "ada:journal"), "the dropped container stays dropped").toBeUndefined();
    expect(recOf(gateway, "ada:journal:after"), "and nothing new stands").toBeUndefined();
    await closeAll();
  });

  it("a dropped MIDDLE is not resurrected, by either road, and its subtree stays out of reach", async () => {
    // THE DROP IS ONE LEVEL DOWN, WHICH IS WHERE THE FIRST FIX MISSED. A shared drop strikes only
    // the container it names, so a grandchild keeps standing while its parent edge dangles — and
    // to a walk that mints missing levels, "dropped" and "never declared" look identical. Minting
    // it back hands the person's dropped subtree to the party the drop was aimed at.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    expect((await declareTool(base, ada, "ada:journal:work")).isError, "premise").toBe(false);
    expect((await declareTool(base, ada, "ada:journal:work:notes")).isError, "premise").toBe(false);

    // Drop the MIDDLE, the shipped way, leaving the grandchild's own declaration standing.
    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.operatorAuthor!,
      "ada:journal:work",
    );
    expect(ids.length, "premise: the middle was declared").toBeGreaterThan(0);
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            timestamp: gateway.nextTimestamp(),
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

    // Neither road may mint it back.
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

    // Delta level: the struck middle has no surviving declaration. Object level: its subtree is
    // still out of the person's reach, which is what the drop bought them.
    expect(
      survivingDeclarationIds(gateway.reactor, gateway.operatorAuthor!, "ada:journal:work"),
      "the drop stands",
    ).toEqual([]);
    expect(subtreeOf(gateway.containers(), "ada").has("ada:journal:work:notes")).toBe(false);
    await closePeers();
    await closeAll();
  });

  it("the dropped subtree is not grown through a descendant that outlived it", async () => {
    // THE ORPHAN IS THE ROAD. A shared drop strikes one container and leaves its children standing.
    // A walk that stops at the first STANDING name is satisfied by one of those children — the
    // struck level never enters the walk at all — and everything minted beneath it inherits the
    // orphan's invisibility. So the door asks reach by PARENT EDGES, not by name.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    expect((await declareTool(base, ada, "ada:journal:work")).isError, "premise").toBe(false);
    // DECLARED WITH ITS PARENT SPELLED OUT, and named so the parent's name is NOT a substring of
    // the child's. The no-oracle assertion below is "the refusal does not contain that name", and
    // a child called `…:work:notes` would satisfy it by accident whatever the door said.
    await gateway.append([
      signClaims(
        containerClaims(
          {
            container: "ada:journal:zeta",
            trust: "curated",
            posture: "shared",
            membership: recOf(gateway, "ada:journal:work")!.membership,
            parent: "ada:journal:work",
          },
          OPERATOR,
          gateway.nextTimestamp(),
        ),
        OPERATOR_SEED,
      ),
    ]);

    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.operatorAuthor!,
      "ada:journal:work",
    );
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            timestamp: gateway.nextTimestamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    // The orphan: it stands, and it is out of the person's reach.
    expect(recOf(gateway, "ada:journal:zeta"), "premise: the child outlived it").toBeDefined();
    expect(
      subtreeOf(gateway.containers(), "ada").has("ada:journal:zeta"),
      "premise: and is unreachable",
    ).toBe(false);

    // Neither road may hang anything from it.
    const grown = await declareTool(base, ada, "ada:journal:zeta:z");
    expect(grown.isError, grown.text).toBe(true);
    expect(grown.text, "and it says the edge hangs from a container that is not there").toMatch(
      /hangs from a container that does not/,
    );
    // AND IT DOES NOT NAME IT, at all. A parent edge need not agree with the name, so the dropped
    // ancestor can be a container in another person's subtree; naming it would teach this caller
    // that it existed. The child's name does not carry the parent's, so this asserts the property.
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
    // THE ROSTER IS NOT THE ONLY ROAD THAT WRITES. Every append, every registration and the raw
    // mutate door land in the connection's pool through one seam, and that seam asked whether the
    // container's NAME stood. A shared drop strikes one container, so a connection bound BELOW the
    // dropped one kept writing law into a subtree the person had removed from every page they
    // have — unseeable, because their pages walk edges, and so un-droppable.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const wrote = await callTool(base, ada, "loam_mutate", {
      mutation: `mutation { plant(entity: "${FERN}", height: 43) { height } }`,
    });
    expect(wrote.isError, `premise: it can write: ${wrote.text}`).toBe(false);

    // Drop the person's HOME, one level above the bound container, the shipped way.
    const ids = survivingDeclarationIds(gateway.reactor, gateway.operatorAuthor!, "ada");
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            timestamp: gateway.nextTimestamp(),
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
    // THE ROAD THAT MAKES ONE. Every rule in this file refuses an orphan; this branch used to
    // MINT one — an unbound caller receiving into `ada:journal:fresh` got a container declared
    // with no parent at any depth, holding a live peer channel that no page of the person's could
    // show or drop. Two-sided: the deep name hangs from its path parent, and a colon-free name is
    // a root, which is what a root is.
    const { base, gateway } = await connectionServer();
    // Consent declares `ada` and `ada:journal` with the edge between them, which is the tree a
    // person actually has; this case is about the level BELOW that the operator's road adds.
    await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    const from = await peerStore();
    // TWO LEVELS BELOW A STANDING NAME, so the walk has a middle to declare. Declaring only the
    // name it was given would leave that middle absent and the target hanging off nothing.
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
    // The object level: the person's own reach, walked by edges, now finds all of it.
    const reach = subtreeOf(gateway.containers(), "ada");
    expect(reach.has("ada:journal:fresh")).toBe(true);
    expect(reach.has("ada:journal:fresh:deeper")).toBe(true);

    // A colon-free name is a root and hangs from nothing.
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
    // THE SHARPEST SHAPE IN THIS FILE. A parent edge need not agree with a name, so the name's
    // first token says where a container is NAMED, never where it STANDS. A door that derived the
    // person's home by splitting the name would get it exactly backwards for the containers this
    // rule exists to judge: it would admit the ones whose edges leave the person's tree, and
    // refuse the ones squarely inside it.
    const { base, gateway } = await connectionServer();
    await connect(base, "bea", "notes");
    await connect(base, "ada", "journal");
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    const membership = recOf(gateway, "ada:journal")!.membership;
    const declare = (container: string, parent: string): Promise<unknown> =>
      gateway.append([
        signClaims(
          containerClaims(
            { container, trust: "curated", posture: "shared", membership, parent },
            OPERATOR,
            gateway.nextTimestamp(),
          ),
          OPERATOR_SEED,
        ),
      ]);
    // Named in bea's namespace, standing in ada's tree — so ada reaches it and may bind to it.
    await declare("bea:shared", "ada:journal");
    await declare("bea:shared:mine", "ada:journal");
    await declare("bea:shared:leak", "bea");
    expect(
      subtreeOf(gateway.containers(), "ada").has("bea:shared"),
      "premise: ada reaches it",
    ).toBe(true);
    expect(subtreeOf(gateway.containers(), "bea").has("bea:shared:leak"), "premise").toBe(true);
    await declareAs(gateway, "bea:shared", OPEN);

    // ADA BINDS TO IT. Her consent page offers it because her own reach walk finds it, so the
    // binding's name begins `bea:` while the tree it stands in is hers.
    const p = pkce();
    const { code, status } = await consent(base, "ada", p.challenge, { bind: "bea:shared" });
    expect(status, "premise: consent offers a container ada reaches").toBe(302);
    const redeemed = await redeem(base, code, p.verifier);
    expect(redeemed.status).toBe(200);
    const ada = ((await redeemed.json()) as { access_token: string }).access_token;

    // Splitting `bea:shared` on its colon gives "bea", which is the WRONG tree: it would admit
    // the leak, which stands in bea's tree, and refuse `mine`, which stands in ada's. Walking the
    // edges gives "ada", and the two answers come out the other way round.
    const from = await peerStore();
    const leak = await callTool(base, ada, "loam_container_receive", {
      from,
      into: "bea:shared:leak",
      prefix: "bea:shared:leak:peer",
      token: PEER_TOKEN,
    });
    expect(leak.isError, `the leak is refused: ${leak.text}`).toBe(true);
    expect(gateway.channelStatus().length, "and no peer bytes landed").toBe(0);

    // ASKED OF THE TARGET TOO. A binding standing in ONE tree can still name a target standing in
    // TWO, and then a second person sees a peer nobody let them in to. The question is the same
    // question; asking it of the binding alone left this open.
    await declare("bea:shared:double", "bea:notes");
    await gateway.append([
      signClaims(
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
          gateway.nextTimestamp(),
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

    // AND THE SAME HARM IS ONE MINT AWAY. A name that does not stand yet is judged by the nearest
    // standing name it will hang from, because that is what its pool will be seen through. A gate
    // that only weighed a container already standing left this open: mint a fresh child of the
    // two-tree container and the bytes land in both people's pages again.
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

    // AND THE WALK FOLLOWS THE EDGES A PERSON'S PAGES FOLLOW. Their reach grows through `inboxOf`
    // as well as `parent`, and their own declare page offers any container in that reach as a
    // parent — so a container hung under a pool is on their page. A walk that followed only
    // `parent` would stop at the pool and refuse them a container they made themselves.
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

    // AND A BINDING THAT STANDS IN TWO TREES AT ONCE IS REFUSED, NOT CHOSEN BETWEEN. Re-declare
    // the bound container carrying BOTH edges: it now belongs to ada's tree and to bea's, and
    // following one and not the other would pick whose page sees a peer's bytes. There is no
    // right pick, so the door fails closed.
    await gateway.append([
      signClaims(
        containerClaims(
          {
            container: "bea:shared",
            trust: "curated",
            posture: "shared",
            membership,
            parent: "ada:journal",
            inboxOf: "bea",
            // CARRIED, because latest-wins is per declaration: omitting it here DELETES the
            // leeway, and the door then refuses for a reason that has nothing to do with the
            // ambiguity under test. An earlier draft of this case omitted it and recorded the
            // guard as unreachable from any door, which was false.
            leeway: OPEN,
          },
          OPERATOR,
          gateway.nextTimestamp(),
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
    // RESOLUTION GOVERNS BY NAME, AND THAT STANDS: a container named here but parented one level
    // up is still governed by the leeway set here, which the walls settled. This is the other
    // case. A container parented into another PERSON'S tree sits on their pages and on none of
    // this person's, so a peer's pool composed into it would be invisible to the person who let
    // the peer in and visible to one who never did.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await connect(base, "bea", "notes");
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    await gateway.append([
      signClaims(
        containerClaims(
          {
            container: "ada:journal:y",
            trust: "curated",
            posture: "shared",
            membership: recOf(gateway, "ada:journal")!.membership,
            parent: "bea:notes",
          },
          OPERATOR,
          gateway.nextTimestamp(),
        ),
        OPERATOR_SEED,
      ),
    ]);
    // The premise, at both ends: it stands, it is on bea's pages, and on none of ada's.
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

    // The other side, one level up inside the SAME person's tree: still admitted, because the
    // name governs and the leeway in force is the one this person set.
    await gateway.append([
      signClaims(
        containerClaims(
          {
            container: "ada:journal:x",
            trust: "curated",
            posture: "shared",
            membership: recOf(gateway, "ada:journal")!.membership,
            parent: "ada",
          },
          OPERATOR,
          gateway.nextTimestamp(),
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
    // THREE RULES, ONE CASE. A level below a standing name gets an edge onto it. A level whose own
    // parent does not stand gets NO edge, because an edge onto a name the table does not hold is
    // the dangling one every rule here refuses — and a colon-free ancestor is never minted, since
    // nobody named it. Getting the middle rule wrong is how this road made an orphan while the
    // code around it was refusing them.
    const { base, gateway } = await connectionServer();
    await connect(base, "ada", "journal");
    const from = await peerStore();

    // (a) below a standing name: the edge is written, and the person's reach finds it.
    const under = await callTool(base, "op-token", "loam_federate_connect", {
      from,
      into: "ada:journal:fresh",
      prefix: "ada:journal:fresh:peer",
      token: PEER_TOKEN,
    });
    expect(under.isError, under.text).toBe(false);
    expect(recOf(gateway, "ada:journal:fresh")?.parent).toBe("ada:journal");
    expect(subtreeOf(gateway.containers(), "ada").has("ada:journal:fresh")).toBe(true);

    // (b) two levels under a name that does NOT stand: the middle is declared with no edge, the
    // leaf hangs from the middle, and the top-level name is never minted.
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
    // The point of (b): no edge anywhere points at a name the table does not hold.
    expect(danglingAncestor(gateway.containers(), "zed:room:leaf")).toBeUndefined();
    // AND A GAP THIS SLICE DOES NOT CLOSE, ASSERTED SO IT CANNOT BE MISTAKEN FOR CLOSED. Nothing
    // dangles, but `zed:room` hangs from nothing either, so once a person owns `zed` their pages
    // — which walk edges from their home — still cannot see it. Three repairs, three frozen rails:
    // refusing the target breaks the rail that opens into a name with no owner; minting the
    // colon-free ancestor breaks the rail that pins this road does not mint one; and refusing only
    // the DEEP case — the repair a reader reaches for first — breaks prefix-collision.test.ts:164,
    // which opens into `one:deep:nest` on a store with no `one` and depends on exactly this shape.
    // The shape is a landed decision, and T277 carries it.
    expect(subtreeOf(gateway.containers(), "zed").has("zed:room"), "T277: still unreachable").toBe(
      false,
    );
    await closePeers();
    await closeAll();
  });

  it("the operator's road refuses a top-level name the person dropped", async () => {
    // THE LEVEL THIS ROAD DECLINES TO MINT STILL HAS TO BE ASKED ABOUT. The struck-name rule ran
    // over the levels being made, and a colon-free ancestor is never one of them when the target
    // is two or more levels below it — so the one name a person is most likely to have dropped,
    // their own top-level one, was the one name nobody asked about.
    const { base, gateway } = await connectionServer();
    await gateway.append([
      signClaims(
        containerClaims(
          { container: "zed", trust: "curated", posture: "shared", membership: ANY_AUTHOR },
          OPERATOR,
          gateway.nextTimestamp(),
        ),
        OPERATOR_SEED,
      ),
    ]);
    expect(recOf(gateway, "zed"), "premise: it stood").toBeDefined();
    const ids = survivingDeclarationIds(gateway.reactor, gateway.operatorAuthor!, "zed");
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            timestamp: gateway.nextTimestamp(),
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
    // The ancestor the walk STOPS at may itself be what a drop left behind. Everything hung
    // beneath it inherits the invisibility, so the walk asks before it mints.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    expect((await declareTool(base, ada, "ada:journal:room")).isError, "premise").toBe(false);
    const ids = survivingDeclarationIds(gateway.reactor, gateway.operatorAuthor!, "ada:journal");
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            timestamp: gateway.nextTimestamp(),
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
    // THE GRANT ROAD NEVER PASSES THE BOUND DOOR. A caller holding a federate grant, or the
    // operator's own token, reaches openChannel through federateAdmits alone — so the reachability
    // question has to live where BOTH roads pass, and it has to be asked whether or not the name
    // needs minting. A container that outlived its parent's drop already stands, so a guard that
    // only ran while declaring never saw it.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada", OPEN);
    await declareAs(gateway, "ada:journal", OPEN);
    expect((await declareTool(base, ada, "ada:journal:work")).isError, "premise").toBe(false);
    expect((await declareTool(base, ada, "ada:journal:work:notes")).isError, "premise").toBe(false);
    const ids = survivingDeclarationIds(
      gateway.reactor,
      gateway.operatorAuthor!,
      "ada:journal:work",
    );
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            timestamp: gateway.nextTimestamp(),
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

    // The other side, same caller and same road: a container that hangs from something works.
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
    // THE GATEWAY API IS ITS OWN DOOR. `openedBy` is the caller's argument, and no HTTP door hands
    // it a target outside the opener's fence — but this is a public method, and a walk whose stop
    // it never meets strips down to a name nothing holds. Minting beneath THAT manufactures the
    // orphan every rule here exists to refuse, with the store's own key.
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
    // A shared drop strikes one name. A connection bound to a descendant keeps its own container's
    // declaration, so asking only that name leaves the dropped subtree reachable by exactly the
    // party the drop was aimed at — and by nobody else, since every parent-edge walk the person's
    // pages make has already lost it. The whole chain is the question.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    expect((await declareTool(base, ada, "ada:journal:notes")).isError, "premise").toBe(false);

    // Drop the person's home, one level ABOVE the container this connection is bound to.
    const ids = survivingDeclarationIds(gateway.reactor, gateway.operatorAuthor!, "ada");
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            timestamp: gateway.nextTimestamp(),
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
    // `loam_container_receive` and `loam_federate_connect` are one road. A check only the roster
    // name asks is a check a caller skips by typing the other name, and tools/list hands every
    // caller both.
    const { base, gateway, connectorsHome } = await connectionServer({
      tokens: { "stranger-token": { actor: "3f".repeat(32) } },
    });
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);
    const from = await peerStore();

    // The name rule: an empty level is refused under BOTH names, and mints nothing.
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

    // AND AN UNBOUND CALLER MEETS ONE ROAD TOO. `loam_container_receive` never enters the roster
    // block, so a caller with no binding is answered by the same road under either name — with
    // the FEDERATE road's sentence, about the grant it lacks, not the roster's about a binding it
    // was never going to have. Two names for one act must answer one way.
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

    // The standing rule: once the connection's grant is struck, both names refuse.
    const grant = readOAuthFile(connectorsHome).grants[0]!;
    await gateway.revokeConnection({
      inbox: gateway.connectionInboxes.get(grant.inbox!)!,
      connectionKey: grant.actor,
      ownerSeed: OPERATOR_SEED,
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
    // A CHANNEL OUTLIVES THE CONTAINER IT WAS OPENED FROM, the same way a pool does. Its own
    // `into` keeps standing, and the leeway walk climbs by name past the level that is now
    // absent — so without asking whether the CONNECTION still stands, a dropped connection could
    // set receiving back to true and keep pulling a peer's bytes into the subtree the person
    // removed.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    // The HOME receives too, so the leeway walk still says yes after the drop: it climbs by
    // name past the level that is gone. Without that, this case would be refused by the leeway
    // rather than by the standing, and could not tell the two apart.
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

    const ids = survivingDeclarationIds(gateway.reactor, gateway.operatorAuthor!, "ada:journal");
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            timestamp: gateway.nextTimestamp(),
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
    // Two-sided at the record: the channel is still off, and the bystander channel record survives
    // rather than being severed by the refusal.
    const after = gateway.channelStatus().find((c) => c.name === channel.name);
    expect(after, "the channel record survives").toBeDefined();
    expect(after!.receiving, "and stays off").toBe(false);
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

  it("everDeclared answers the mint question, and fails closed", async () => {
    // HELPER-LEVEL, and said so. Both halves below are unreachable through a door — the fixture
    // always has an operator, and the append refuses malformed law — so they are asked here
    // directly. They are the two directions this predicate must not get wrong: a false ABSENCE is
    // a licence to mint, and a false PRESENCE refuses a road forever.
    const { gateway, base } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareTool(base, ada, "ada:journal:notes");
    const op = gateway.operatorAuthor!;

    expect(everDeclared(gateway.reactor, op, "ada:journal:notes"), "a standing name").toBe(true);
    expect(everDeclared(gateway.reactor, op, "ada:journal:never"), "a name nobody made").toBe(
      false,
    );

    // Struck, and still true: that is the whole point — the table forgets it, this does not.
    const ids = survivingDeclarationIds(gateway.reactor, op, "ada:journal:notes");
    await gateway.append(
      ids.map((id) =>
        signClaims(
          {
            timestamp: gateway.nextTimestamp(),
            author: OPERATOR,
            pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: id } } }],
          },
          OPERATOR_SEED,
        ),
      ),
    );
    expect(recOf(gateway, "ada:journal:notes"), "the table forgets it").toBeUndefined();
    expect(everDeclared(gateway.reactor, op, "ada:journal:notes"), "this does not").toBe(true);

    // FAILS CLOSED, and closed here is TRUE. With no operator to weigh law by, a store cannot say
    // a name was never declared — and saying so would be a licence to mint it.
    expect(everDeclared(gateway.reactor, undefined, "ada:journal:never")).toBe(true);

    await closeAll();
  });

  it("everDeclared asks the BIND test, not the door's", async () => {
    // A STORE OLDER THAN THE RENAME. The door refuses a retired posture word outright, naming the
    // migration; the READER still honours one, because until a person runs `loam migrate`,
    // dropping every legacy container would empty every scope without saying a word. So a legacy
    // declaration BOUND, and the mint question must remember it — a door test here would report
    // every dropped legacy container as never declared, and a walk would mint them all back.
    //
    // The bytes are written straight to the backend, because the door that refuses them is the
    // very thing under test. That is what an unmigrated store IS.
    const legacy = [...LEGACY_POSTURES.keys()][0]!;
    const backend = new MemoryBackend();
    await backend.append([
      signClaims(
        {
          timestamp: 9000,
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
    ]);
    const gw = await Gateway.open(backend, { seed: OPERATOR_SEED });
    const op = gw.operatorAuthor!;
    expect(recOf(gw, "ada:legacy"), "premise: the reader binds the retired word").toBeDefined();
    expect(everDeclared(gw.reactor, op, "ada:legacy"), "and the mint question remembers it").toBe(
      true,
    );
    // The other side: the DOOR refuses that same declaration, which is why the two tests differ.
    expect(
      containerDefect(
        [...gw.reactor.snapshot()].find(
          (d) => JSON.stringify(d.claims).includes("ada:legacy") === true,
        )!,
        gw.reactor,
        op,
      ),
      "the door refuses what the reader binds",
    ).toMatch(/retired word/);
  });

  it("a refusal is the store's own sentence, whole", () => {
    // A container defect arrives wrapped as "malformed law: <why>", and the wrapper carries
    // nothing a caller can act on. Slicing on the marker's index alone cuts thirteen characters
    // off every OTHER failure — and the one that matters most, the store cannot write, is exactly
    // an other failure.
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
    // A leeway walk hops a container whose leading token is `inbox` or `channel` to its host. A
    // person named `inbox` would own a home the walk reads as a pool.
    for (const reserved of ["inbox", "channel"]) {
      expect(reservedNameDefect(reserved), `${reserved} may not be minted`).toBeDefined();
      expect(reservedNameDefect(reserved), "and says why").toMatch(/reserved/);
      // AT MINTING ONLY, AND THIS IS THE HALF THAT MATTERS. `userNameDefect` is asked on every
      // read and every login, so folding the reservation in would strand a person already named
      // `inbox` in a store provisioned before this rule: no login, no roles, and no road back.
      expect(userNameDefect(reserved), `${reserved} at rest still resolves`).toBeUndefined();
    }
    // The other side: a name that merely starts with those letters is an ordinary name. `inboxer`
    // is the sharp one — a prefix test rather than an exact one would refuse it.
    for (const ok of ["inboxer", "channels", "ada"]) {
      expect(reservedNameDefect(ok), `${ok} may be minted`).toBeUndefined();
    }

    // EVERY DOOR THAT MINTS ONE, and there are THREE. A rule one door asks is a rule the other
    // two do not: `loam init --user`, `loam user create` and `loam pen create` each name a person
    // or a pen, and each writes a home or a seed file under that name.
    const home = mkdtempSync(join(tmpdir(), "loam-roster-user-"));
    try {
      const err: string[] = [];
      const io = { out: () => {}, err: (m: string) => err.push(m) };
      const pw = { readSecret: () => Promise.resolve("pw"), scrypt: CHEAP_SCRYPT };

      // `loam init --user inbox` — refused before the store is even made.
      expect(await run(["init", "--home", home, "--user", "inbox"], io, pw)).toBe(2);
      expect(err.join("\n"), "init says why").toMatch(/reserved/);
      err.length = 0;

      expect(await run(["init", "--home", home, "--no-user"], io)).toBe(0);

      // `loam user create inbox` — refused, and nothing is minted.
      expect(await run(["user", "create", "inbox", "--home", home], io, pw)).toBe(2);
      expect(err.join("\n"), "user create says why").toMatch(/reserved/);
      expect(readCredentials(home).users["inbox"], "and mints nothing").toBeUndefined();
      err.length = 0;

      // `loam pen create channel` — refused, and no seed file is written.
      expect(await run(["pen", "create", "channel", "--home", home], io, pw)).toBe(2);
      expect(err.join("\n"), "pen create says why").toMatch(/reserved/);
      expect(readPenSeed(home, "channel").kind, "and writes no seed").toBe("absent");
      err.length = 0;

      // The other side, at the same doors: an ordinary name still mints.
      expect(await run(["user", "create", "inboxer", "--home", home], io, pw)).toBe(0);
      expect(readCredentials(home).users["inboxer"], "the ordinary name mints").toBeDefined();
      expect(await run(["pen", "create", "channels", "--home", home], io, pw)).toBe(0);
      expect(readPenSeed(home, "channels").kind, "and the ordinary pen").toBe("present");
    } finally {
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
