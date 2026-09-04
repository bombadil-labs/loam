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
// RAILS-RED on origin/main, this file copied in: 16 red, 0 green — 16 cases. No control: every
// case names a verb or a rule this slice adds, and none of them exists on the base.
//
// REVERT PROBES, MEASURED against this file as it stands — 16 cases. Re-measure when you add one.
//   the fence drops its colon                        → 11 red, 4 green
//   the fence admits an empty segment                →  1 red, 15 green
//   no bound on the name's length or depth           →  1 red, 15 green
//   leeway admits the caller's OWN container         →  1 red, 15 green
//   declare skips the standing-name check            →  1 red, 15 green
//   declare writes no parent edge                    →  8 red, 7 green
//   declare declares the target and not the middles  →  1 red, 15 green
//   leeway drops the record's pool refusal           →  1 red, 15 green
//   leeway asks the name and not the reach           →  1 red, 15 green
//   the standing check is gone                       →  1 red, 15 green
//   the unbound check is gone                        →  1 red, 15 green
//   the parser drops an unknown key                  →  1 red, 15 green
//   the leeway re-declaration drops the parent       →  3 red, 12 green
//   the reservation is gone from the minting door    →  1 red, 15 green
//   the reservation is folded into userNameDefect    →  1 red, 15 green
//   the refusal helper slices a non-law error        →  1 red, 15 green
//
// SIX OF THESE PROBES WERE GREEN BEFORE AN INDEPENDENT REVIEW, and each green was a rail that
// looked right: the pool case asked for a leeway the one rule refused anyway, so it could not tell
// a pool rule from no rule; the parser was exercised with one switch, so two thirds of it could
// have been deleted; the reservation was asserted against the rule rather than a door; a
// re-declared parent was unasserted; and two refusals were read as booleans, so a different rule's
// sentence satisfied them.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import { containerClaims, readContainerTable } from "../../src/gateway/container.js";
import { subtreeOf } from "../../src/server/subtree.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { SEALED_LEEWAY, type Leeway, type Terms } from "../../src/gateway/leeway.js";
import { appendRefusal, serve, type ServerHandle } from "../../src/server/http.js";
import { run } from "../../src/cli/cli.js";
import { readCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { reservedNameDefect, userNameDefect } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { readOAuthFile } from "../../src/server/oauth-file.js";
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

/** A fixed, cheap cost so one `user create` does not pay the interactive scrypt floor. */
const CHEAP_SCRYPT: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };

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
      expect(r.text).toMatch(FENCE);
    }
    expect(gateway.containers().containers.size, "and none of them stands").toBe(before);
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

    // THE DOOR. `loam user create` is where a person's name is minted; nothing is written when it
    // refuses, and an ordinary name still mints.
    const home = mkdtempSync(join(tmpdir(), "loam-roster-user-"));
    try {
      const err: string[] = [];
      const io = { out: () => {}, err: (m: string) => err.push(m) };
      const pw = { readSecret: () => Promise.resolve("pw"), scrypt: CHEAP_SCRYPT };
      expect(await run(["init", "--home", home, "--no-user"], io)).toBe(0);
      expect(await run(["user", "create", "inbox", "--home", home], io, pw)).toBe(2);
      expect(err.join("\n"), "the door says why").toMatch(/reserved/);
      expect(readCredentials(home).users["inbox"], "and mints nothing").toBeUndefined();
      expect(await run(["user", "create", "inboxer", "--home", home], io, pw)).toBe(0);
      expect(readCredentials(home).users["inboxer"], "the ordinary name mints").toBeDefined();
    } finally {
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
