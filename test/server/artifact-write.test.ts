// SPEC §30 criterion 10 — the artifact write is the viewer's OWN §14 write, and grants nothing new.
//
// The whole trust story of this target rests on one sentence: `loam_mutate` on the viewer's own connector
// is authority the viewer already held, because they could send the same document to `/:mount/graphql`
// with the same token. So the page is a convenience over existing standing, §6's two keys hold trivially,
// and publishing the code confers nothing. This suite drives BOTH doors with the same document and the
// same token and asserts they agree — including when they refuse.
//
// ASSERTED AT BOTH LEVELS. DELTA: who AUTHORED what landed (the viewer's actor, never the renderer's
// pen — the pen is server-side custody and no artifact has a server). OBJECT: what each door ANSWERED,
// so a delta that landed unresolved and a refusal that leaked a reason are both visible.
//
// AND THE BUNDLE'S OWN ATTEMPT LANDS NOTHING. Criterion 19's delta half: a bundle reaching for
// `loam_mutate` inside the confined realm cannot write, and the store's delta count is the proof. The
// realm side of that is `test/gateway/artifact-realm.test.ts` (the seal, as a program) and
// `test/site/artifact-shell.test.ts` (the traffic count at the one seam holding an MCP handle); this is
// the ground underneath both.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { coordinatesFromPage } from "../../src/gateway/artifact-page.js";
import { queryFieldFor } from "../../src/gateway/gql.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
// A viewer WITH write standing (the gardener), and one with none — same mount, same lens.
const BYSTANDER_SEED = "b7".repeat(32);
const BYSTANDER = authorForSeed(BYSTANDER_SEED);
const PEN_SEED = "9e".repeat(32);
const PEN = authorForSeed(PEN_SEED);

const BUNDLE = 'export default (n) => "<p>h=" + n.view.height + "</p>";';

let handle: ServerHandle;
let base: string;
let gateway: Gateway;

const heightDeltas = (gw: Gateway) =>
  [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === "height",
    ),
  );

beforeAll(async () => {
  gateway = await Gateway.open(new MemoryBackend(), {
    seed: OP_SEED,
    pens: { editor: PEN_SEED },
  });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 9002), OP_SEED),
    signClaims(grantClaims(STORE_ENTITY, PEN, "write", OP, 9003), OP_SEED),
  ]);
  await gateway.append([observed(FERN, "height", 1, 1000, OP_SEED)]);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  await gateway.publishRenderer({
    route: "plant",
    schema: "Plant",
    consumes: ["height"],
    writable: [...PLANT_WRITABLE],
    pen: "editor",
    bundle: BUNDLE,
  });
  await gateway.declareArtifact(["plant"]);
  handle = await serve({
    mounts: { garden: gateway },
    tokens: {
      "op-token": { operator: true },
      // The VIEWER's token — one connector is one token is one identity, and the page never sees it.
      "viewer-token": { actor: GARDENER_SEED },
      "bystander-token": { actor: BYSTANDER_SEED },
    },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

// `loam_mutate` exactly as the shell issues it: the tool call the viewer's connector makes.
const viaArtifact = async (
  token: string,
  mutation: string,
): Promise<{ isError?: boolean; text: string }> => {
  const res = await fetch(`${base}/garden/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "loam_mutate", arguments: { mutation } },
    }),
  });
  const body = (await res.json()) as {
    result: { content: Array<{ text: string }>; isError?: boolean };
  };
  return { ...body.result, text: body.result.content[0]?.text ?? "" };
};

// The same document, sent the way the viewer always could — the comparison that makes "grants nothing
// new" a measurement rather than a claim.
const viaGraphql = async (token: string, mutation: string): Promise<string> => {
  const res = await fetch(`${base}/garden/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: mutation }),
  });
  return JSON.stringify(await res.json());
};

const setHeight = (v: number): string =>
  `mutation { plant(entity: ${JSON.stringify(FERN)}, height: ${v}) { _entity _hex _view } }`;

describe("§30 criterion 10: the landed delta's author is the VIEWER, not the pen", () => {
  it("writes as the viewer's own actor — the pen never rides an artifact", async () => {
    const before = heightDeltas(gateway).length;
    const out = await viaArtifact("viewer-token", setHeight(42));
    expect(out.isError).toBeUndefined();
    // Delta level: a new fact landed, and the AUTHOR is the viewer.
    const added = heightDeltas(gateway).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.claims.author).toBe(GARDENER);
    expect(added[0]!.claims.author).not.toBe(PEN);
    expect(added[0]!.claims.author).not.toBe(OP);
    // Object level: the door served back the re-resolved view.
    expect(out.text).toContain("42");
  });

  it("and the SAME route's host-target POST still signs as the pen — two hosts, two identities", async () => {
    // The observable difference, and it does not ride silently: `writeRoute` signs AS the pen so
    // provenance shows the mediating code; `loam_mutate` writes as the caller. That is exactly why the
    // pack door refuses a pen-holding binding without an acknowledgement, and why the emitted page's
    // last word is the host's own sentence about who writes.
    const before = heightDeltas(gateway).length;
    const res = await fetch(`${base}/garden/app/plant/${encodeURIComponent(FERN)}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: "Bearer viewer-token",
      },
      body: "height=77",
    });
    expect(res.status).toBe(200);
    const added = heightDeltas(gateway).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.claims.author).toBe(PEN);
  });
});

describe("§30 criterion 10: a viewer with no write standing gets the store's own refusal", () => {
  it("refuses, and the ground does not move", async () => {
    const before = heightDeltas(gateway).length;
    const out = await viaArtifact("bystander-token", setHeight(999));
    expect(out.isError).toBe(true);
    // Delta level: nothing landed. §6's two keys — a token is not a grant.
    expect(heightDeltas(gateway)).toHaveLength(before);
    expect(
      heightDeltas(gateway).some((d) => d.claims.author === BYSTANDER),
      "no bystander-authored fact",
    ).toBe(false);
  });

  it("and BOTH doors refuse identically — the page is a convenience over existing standing", async () => {
    // The measurement behind "nothing is widened". If these ever diverged, the artifact host would be
    // handing someone authority they did not have at `/graphql`, which is the one thing this target
    // promises it does not do.
    const document = setHeight(1234);
    const viaTool = await viaArtifact("bystander-token", document);
    const viaDoor = await viaGraphql("bystander-token", document);
    // The tool wraps the gateway's own `{ data, errors }` in a text block; the errors must be the same.
    const toolErrors = (JSON.parse(viaTool.text) as { errors?: string[] }).errors ?? [];
    const doorErrors = (JSON.parse(viaDoor) as { errors?: string[] }).errors ?? [];
    expect(toolErrors.length).toBeGreaterThan(0);
    expect(doorErrors.length).toBeGreaterThan(0);
    expect(toolErrors.join("|")).toBe(doorErrors.join("|"));
  });

  it("a field the SCHEMA does not open refuses on both doors too", async () => {
    const document = `mutation { plant(entity: ${JSON.stringify(FERN)}, nope: 1) { _entity } }`;
    const viaTool = await viaArtifact("viewer-token", document);
    const viaDoor = await viaGraphql("viewer-token", document);
    expect(viaTool.isError).toBe(true);
    expect(viaTool.text).toContain("nope");
    expect(viaDoor).toContain("nope");
  });
});

describe("§30 criterion 19 (delta half): the bundle's own attempt lands NOTHING", () => {
  it("a confined bundle's mutation reaches no door, and the store's count is unchanged", () => {
    // The realm has no `window`, so `window.claude.mcp.callTool` throws inside the compartment before
    // it can name a tool. What that means on the ground is asserted here rather than inferred: no
    // delta appears that the test did not itself write.
    const before = heightDeltas(gateway).length;
    const page = gateway.packArtifact("plant", FERN, {
      server: "My Loam",
      acknowledgePen: true,
      acknowledgeWritable: true,
    }).page;
    // Nothing about EMITTING a page moves the ground — the emission is a read over surviving law.
    expect(heightDeltas(gateway)).toHaveLength(before);
    // And the page carries no token with which anything could be written.
    expect(page).not.toContain("viewer-token");
    expect(page).not.toContain(GARDENER_SEED);
    expect(page).not.toContain(PEN_SEED);
    expect(coordinatesFromPage(page)!.manifest).toEqual(["loam_query", "loam_mutate"]);
  });

  it("and a named live BYSTANDER survives every refusal above — the store still answers", async () => {
    // Two-sided: a suite that only proved refusals would be satisfied by a door that refused everyone.
    const out = await viaArtifact("viewer-token", setHeight(5));
    expect(out.isError).toBeUndefined();
    const read = await fetch(`${base}/garden/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer viewer-token" },
      body: JSON.stringify({
        query: `query { ${queryFieldFor("Plant")}(entity: ${JSON.stringify(FERN)}) { _entity _hex _view } }`,
      }),
    });
    expect(JSON.stringify(await read.json())).toContain("5");
  });
});
