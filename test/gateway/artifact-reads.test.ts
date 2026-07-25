// SPEC §30 criteria 28 and 35 — the FLOOR, proven on the host that exists today.
//
// The floor is small, precise, and it is what makes one content address honestly one app: a `RenderFn`
// that is pure and synchronous; a `RenderNode` of `{ entity, view, hex, reads, state }`; `_view` as the
// projection on every read; `data-loam-read` / `<form>` gestures that name a lens and an entity; a
// host-neutral four-code refusal vocabulary; and the app's SCHEMA as the request surface. A bundle that
// stays on the floor runs anywhere.
//
// WHY THE SERVER-RENDERED HOST IS THE ONE THAT PROVES IT: because a request is MARKUP rather than a call,
// the same gesture is a plain `?read=<lens>:<entity>` navigation here — resolved in the gateway, under the
// door's own discipline. So an unenhanced link works with no JavaScript at all, and the floor is provable
// across two hosts inside this ticket rather than promised for a third. The artifact half of the
// comparison is `test/site/artifact-shell.test.ts`.
//
// TWO CONSTRAINTS, both inherited from `serveRouteImpl`'s existing discipline rather than invented here.
// (a) `?read=` is FULL-DOOR only: the anonymous door's whole posture is that every refusal is a uniform
// 404 leaking nothing about what exists (§17), so a per-lens "this store does not serve that lens" there
// would be exactly the lens-existence oracle that door closed. (b) each honored `?read=` costs a
// RESOLUTION, and `maxPublicRenders` caps worker renders rather than resolutions — a repeatable parameter
// is precisely the shape that turns a cap into a suggestion, so the count is bounded.
//
// WHAT IS DELIBERATELY NOT ASSERTED: "a gesture naming a field the lens does not serve is refused." A
// gesture names a lens and an entity and never a field, and the projection is `_view`, so there is no
// per-field gesture to refuse; asserting it would mean hand-composing a document — testing `/graphql`
// rather than the mediated channel.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { publicClaims } from "../../src/gateway/public.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { readKey, parseReadGesture } from "../../src/gateway/renderers.js";
import { queryFieldFor } from "../../src/gateway/gql.js";
import { coordinatesFromPage } from "../../src/gateway/artifact-page.js";
import { evalPageValue } from "../site/eval-page.js";
import { FERN, GARDENER, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { legalNameFor } from "../../src/gateway/gql.js";
import { lensOf, programOf } from "../../src/gateway/registration.js";
import { capabilityStatement } from "../../src/gateway/artifact.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const MOSS = "moss";

// A hyperschema whose gather body is PLANT's, under its own name, so the capital-initial reading
// below does not collide with the shared `Plant` registration on the main mount.
const CAPS_HYPER = { ...PLANT, name: "Plant" };

// A floor bundle that DRAWS both new members, so a host that handed it the wrong shape would render
// differently rather than silently agreeing.
const FLOOR = `export default function (node) {
  var keys = Object.keys(node.reads).sort();
  var lines = keys.map(function (k) {
    var r = node.reads[k];
    return r.error ? k + "!" + r.error.code : k + "=" + r.view.height;
  });
  var st = Object.keys(node.state).sort().map(function (k) { return k + ":" + node.state[k]; });
  return "<p>root=" + node.view.height + "|reads=" + lines.join(",") + "|state=" + st.join(",") + "</p>";
}`;

let handle: ServerHandle;
let base: string;
let gateway: Gateway;

beforeAll(async () => {
  gateway = await Gateway.open(new MemoryBackend(), { seed: OP_SEED, renderTimeoutMs: 10_000 });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 9002), OP_SEED),
  ]);
  await gateway.append([
    observed(FERN, "height", 42, 1000, OP_SEED),
    observed(MOSS, "height", 7, 1000, OP_SEED),
  ]);
  gateway.register(PLANT, PLANT_POLICY, [FERN, MOSS], undefined, PLANT_WRITABLE);
  await gateway.publishRenderer({
    route: "plant",
    schema: "Plant",
    consumes: ["height"],
    bundle: FLOOR,
  });
  // The anonymous door needs a declaration to serve the route at all — constraint (a) below is about
  // what it does with a `?read=` once it is serving.
  await gateway.append([signClaims(publicClaims(["Plant"], OP, 9_100), OP_SEED)]);
  handle = await serve({
    mounts: { garden: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

const app = (query: string, token?: string): Promise<Response> =>
  fetch(`${base}/garden/app/plant/${encodeURIComponent(FERN)}${query}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

describe("§30 criterion 35a: the host route honors the same gesture, and fills the same members", () => {
  it("a ?read= gesture lands in reads[<lens>@<entity>] with the resolved view", async () => {
    const res = await app(`?read=Plant:${encodeURIComponent(MOSS)}`, "op-token");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`reads=${readKey("Plant", MOSS)}=7`);
    expect(body).toContain("root=42");
  });

  it("a second gesture at a DIFFERENT entity leaves the first intact", async () => {
    const res = await app(
      `?read=Plant:${encodeURIComponent(MOSS)}&read=Plant:${encodeURIComponent(FERN)}`,
      "op-token",
    );
    const body = await res.text();
    expect(body).toContain(`${readKey("Plant", MOSS)}=7`);
    expect(body).toContain(`${readKey("Plant", FERN)}=42`);
  });

  it("state rides the query string, echoed verbatim — UI state has nowhere else to live", async () => {
    // A per-render realm gives a page index no home: module scope dies with the realm, the worker has
    // no `document` to read the previous paint from, and `reads` is keyed by lens and entity and holds
    // answers. So the floor carries `state`, and `RenderFn` stays a pure function of its argument.
    const res = await app(`?page=3&sort=asc`, "op-token");
    const body = await res.text();
    expect(body).toContain("state=page:3,sort:asc");
  });

  it("BOTH members are present and EMPTY on a bare first paint — never absent", async () => {
    // An optional member is the one-address/two-envelopes bug in miniature: a bundle that draws it
    // throws or paints nothing on the host where it is missing.
    const body = await (await app("", "op-token")).text();
    expect(body).toContain("|reads=|state=");
  });

  it("a read at an entity the store has nothing for is a SUCCESS carrying an empty view", async () => {
    // Absence is an answer, not an error — so a search box driven at a nonexistent key gets an empty
    // view and the renderer draws its own "nothing here". The shell cannot do it for them: an empty
    // view and an unfetched one are different states, and only the app knows what its emptiness is.
    const body = await (await app("?read=Plant:no-such-plant", "op-token")).text();
    expect(body).toContain(`${readKey("Plant", "no-such-plant")}=undefined`);
    expect(body).not.toContain("!not_served");
    expect(body).not.toContain("!refused");
  });
});

describe("§30 criterion 35b: the refusal is the FLOOR's enum, identical across hosts", () => {
  it("a lens this store does not serve yields not_served — the host-neutral code", async () => {
    // The MCP broker's codes cannot exist here (there is no broker), which is exactly why the floor
    // owns its own four-code vocabulary and each host maps its failures onto it at its own seam. A
    // bundle branching on `needs_reauth` would behave differently on one host behind one address.
    const body = await (await app("?read=NoSuchLens:x", "op-token")).text();
    expect(body).toContain(`${readKey("NoSuchLens", "x")}!not_served`);
  });

  it("a malformed gesture is DROPPED, not resolved as a guess", async () => {
    expect(parseReadGesture("Plant")).toBeUndefined();
    expect(parseReadGesture(":x")).toBeUndefined();
    expect(parseReadGesture("Plant:")).toBeUndefined();
    // An entity id may carry its own colon: the split is on the FIRST one.
    expect(parseReadGesture("Plant:urn:x:1")).toEqual({ lens: "Plant", entity: "urn:x:1" });
    const body = await (await app("?read=Plant", "op-token")).text();
    expect(body).toContain("|reads=|");
  });
});

describe("§30 criterion 35c: on the PUBLIC door a ?read= is ignored", () => {
  it("over HTTP the route renders exactly as it does today, with no per-lens refusal", async () => {
    const bare = await (await app("")).text();
    const gestured = await (await app("?read=NoSuchLens:x&page=9")).text();
    // Byte-identical: no `not_served`, no state echo, no oracle. A per-lens refusal here would be
    // precisely the lens-existence oracle §17's uniform 404 closed.
    expect(gestured).toBe(bare);
    expect(gestured).toContain("|reads=|state=");
  });

  it("and serveRoute REFUSES a gesture handed to it directly on the public door", async () => {
    // The HTTP leg above cannot see this guard: `http.ts` only calls `gestureOf` on the full-door
    // branch, so a gesture never reaches `serveRoute("…","public")` through the server at all. Two
    // independent guards is the right shape — and a rail that only drives the outer one goes green
    // when the inner one is deleted, which is exactly the hollow-rail failure. So this drives the
    // inner one, at the seam, with a gesture no HTTP request could deliver.
    const out = await gateway.serveRoute("plant", FERN, "public", {
      reads: [{ lens: "Plant", entity: MOSS }],
      state: { page: "9" },
    });
    expect(out.status).toBe(200);
    expect(out.body).toContain("|reads=|state=");
    expect(out.body).not.toContain("Plant@");
    expect(out.body).not.toContain("page:9");
    // …and the FULL door with the same gesture DOES serve it, so this is not a rail that passes by
    // everything being ignored.
    const full = await gateway.serveRoute("plant", FERN, "full", {
      reads: [{ lens: "Plant", entity: MOSS }],
      state: { page: "9" },
    });
    expect(full.body).toContain(`${readKey("Plant", MOSS)}=7`);
    expect(full.body).toContain("page:9");
  });
});

describe("§30 criterion 35: the resolution count per request is BOUNDED", () => {
  it("honors at most the cap, so a repeatable parameter cannot multiply resolutions freely", async () => {
    // `maxPublicRenders` caps worker RENDERS, not resolutions — H8's full-scan cost, N times, on one
    // GET. Twelve gestures, eight honored.
    const many = Array.from({ length: 12 }, (_, i) => `read=Plant:p${i}`).join("&");
    const body = await (await app(`?${many}`, "op-token")).text();
    expect(body.match(/Plant@p\d+/g)).toHaveLength(8);
  });
});

describe("§30 criterion 28: the SCHEMA is the request surface, and the boundary is the store's", () => {
  it("a gesture at a REGISTERED lens is served; the identical gesture at an unregistered one is refused", async () => {
    // (b). The shell — and the host route — adjudicate nothing: the STORE answers from the
    // registration the viewer installed. That refusal is more accurate than anything the page could
    // have decided, because the page is not where the law lives.
    const served = await (await app(`?read=Plant:${encodeURIComponent(MOSS)}`, "op-token")).text();
    expect(served).toContain(`${readKey("Plant", MOSS)}=7`);
    const refused = await (await app("?read=Ledger:whatever", "op-token")).text();
    expect(refused).toContain("!not_served");
    // Zero fabricated or partial data: no view value rides a refusal.
    expect(refused).not.toMatch(/Ledger@whatever=/);
  });

  it("two mounts whose registered lens sets DIFFER serve different sets for the same gesture", async () => {
    // (c), the positive form of the boundary claim. What bounds an app is the pair (the schemas this
    // viewer installed, the MOUNT their connector points at) — two existing boundaries, neither
    // invented here. Note which the second is NOT: a per-token read filter, which does not exist —
    // `hooks.resolve` carries no identity.
    const other = await Gateway.open(new MemoryBackend(), {
      seed: OP_SEED,
      renderTimeoutMs: 10_000,
    });
    await other.append([observed(MOSS, "height", 999, 1000, OP_SEED)]);
    other.register(PLANT, PLANT_POLICY, [MOSS], undefined, PLANT_WRITABLE);
    await other.publishRenderer({
      route: "plant",
      schema: "Plant",
      consumes: ["height"],
      bundle: FLOOR,
    });
    handle.addMount("other", other);
    const here = await (await app(`?read=Plant:${encodeURIComponent(MOSS)}`, "op-token")).text();
    const there = await (
      await fetch(`${base}/other/app/plant/${encodeURIComponent(MOSS)}?read=Plant:${MOSS}`, {
        headers: { authorization: "Bearer op-token" },
      })
    ).text();
    expect(here).toContain(`${readKey("Plant", MOSS)}=7`);
    expect(there).toContain(`${readKey("Plant", MOSS)}=999`);
    await handle.removeMount("other");
    await other.close();
  });

  it("a token individuates WRITE standing, not reads — so the same mount answers identically", async () => {
    // The correction criterion 8 records too, asserted from the other side: `SurfaceHooks.resolve`
    // takes no identity and every query field resolves through it without a context value, so two
    // distinct tokens on ONE mount get byte-identical readings. §7's isolation unit for reads is the
    // MOUNT. Asserting a per-token read difference would have been satisfiable only by a stubbed
    // harness inventing two answers — a green rail over a false claim.
    handle.addMount("shared", gateway);
    const asOperator = await (
      await app(`?read=Plant:${encodeURIComponent(MOSS)}`, "op-token")
    ).text();
    const viaOtherMountName = await (
      await fetch(`${base}/shared/app/plant/${encodeURIComponent(FERN)}?read=Plant:${MOSS}`, {
        headers: { authorization: "Bearer op-token" },
      })
    ).text();
    expect(viaOtherMountName).toBe(asOperator);
    await handle.removeMount("shared");
  });
});

describe("§30: the page's TWO manglings, both executed against the real schema", () => {
  // The read side already had this rail and it is why the write side's bug was confined to writes. The
  // store has TWO manglings — `legalNameFor` for the view type, every prop field, and every per-prop
  // MUTATION ARGUMENT; `queryFieldFor` (the same, initial-lowercased) for the query-root and
  // mutation-root FIELD — and they differ by exactly one character, for exactly the names whose initial
  // is an uppercase ASCII letter. A page carrying one function for both sites spells the ARGUMENT wrong
  // and nothing else, so the read path is unaffected: the page paints correctly and every form is
  // silently dead. That is the shape a stub cannot see, because a stub echoes back whatever it was sent.
  const shellFns = (
    page: string,
  ): { legalName: (s: string) => string; rootField: (s: string) => string } => {
    const m =
      /function legalName\(s\) \{[\s\S]*?\n {2}\}\n {2}function rootField\(s\) \{[\s\S]*?\n {2}\}/.exec(
        page,
      );
    expect(m, "the page carries BOTH manglings").not.toBeNull();
    // Through the ONE door that may execute page-extracted source (test/site/eval-page.ts), which also
    // refuses an empty extraction — a regex that matched nothing would otherwise compile to a function
    // that silently does nothing, and every comparison below would pass vacuously.
    return evalPageValue<{ legalName: (s: string) => string; rootField: (s: string) => string }>(
      `${m![0]}; return { legalName: legalName, rootField: rootField };`,
    );
  };

  it("both agree with gql.ts, and they DIVERGE on a capital initial", async () => {
    await gateway.declareArtifact(["plant"]);
    const { page } = gateway.packArtifact("plant", FERN, { server: "My Loam" });
    const fns = shellFns(page);
    for (const name of ["Plant", "plant", "Height", "NotesByTag", "a-b c", "9lives", "_x", "A"]) {
      expect(fns.legalName(name), `legalName(${name})`).toBe(legalNameFor(name));
      expect(fns.rootField(name), `rootField(${name})`).toBe(queryFieldFor(name));
    }
    // The divergence is real and is the whole reason there are two: a rail that only checked names
    // already lowercase would pass with one function doing both jobs.
    expect(fns.legalName("Height")).toBe("Height");
    expect(fns.rootField("Height")).toBe("height");
    expect(fns.legalName("Height")).not.toBe(fns.rootField("Height"));
  });

  it("the page's composed MUTATION executes against the live door for a CAPITAL-initial prop", async () => {
    // The rail the write side did not have. A store whose `writable` names `Height` — the store builds
    // `Mutation.plant(entity: ID!, Height: PrimitiveValue)`, so a page that lowercased the argument
    // would be refused `Unknown argument "height"` on every form, forever, while painting perfectly.
    const capital = await Gateway.open(new MemoryBackend(), {
      seed: OP_SEED,
      renderTimeoutMs: 10_000,
    });
    await capital.append([
      signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 9002), OP_SEED),
    ]);
    // `Height` and NOT `height`: the lowercased spelling must have no argument to land on, or the bug
    // would be masked by the very prop it mis-spells into.
    const CAPS = {
      ...PLANT_POLICY,
      props: new Map(
        [...PLANT_POLICY.props].map(([k, v]) => [k === "height" ? "Height" : k, v] as const),
      ),
    };
    capital.register(CAPS_HYPER, CAPS, [FERN], undefined, ["Height", "tag", "watered", "readings"]);
    await capital.publishRenderer({
      route: "caps",
      schema: "Plant",
      consumes: ["Height"],
      bundle: FLOOR,
    });
    await capital.declareArtifact(["caps"]);
    handle.addMount("caps", capital);
    const { page } = capital.packArtifact("caps", FERN, { server: "My Loam" });
    const fns = shellFns(page);
    // Compose exactly as the shell's submit handler does: the ROOT FIELD for the field, and
    // `legalName` for each argument.
    const doc =
      `mutation { ${fns.rootField("Plant")}(entity: ${JSON.stringify(FERN)}, ` +
      `${fns.legalName("Height")}: 42) { _entity _hex _view } }`;
    const res = await fetch(`${base}/caps/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: JSON.stringify({ query: doc }),
    });
    const body = (await res.json()) as { data?: unknown; errors?: string[] };
    expect(body.errors, JSON.stringify(body.errors)).toBeUndefined();
    expect(JSON.stringify(body.data)).toContain("42");
    // And the wrong spelling — the bug — is refused, so this rail is not passing by everything working.
    const wrong = await fetch(`${base}/caps/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: JSON.stringify({
        query: `mutation { ${fns.rootField("Plant")}(entity: ${JSON.stringify(FERN)}, ${fns.rootField("Height")}: 43) { _entity } }`,
      }),
    });
    expect(JSON.stringify(await wrong.json())).toContain("Unknown argument");
    await handle.removeMount("caps");
    await capital.close();
  });
});

describe("§30: a lens name is not a program name — §21.7 coexistence, packed", () => {
  // Every other artifact fixture registers PLANT with no `lensName`, so the LENS name and the PROGRAM
  // name coincide — which is exactly the fixture shape H6's own footnote says cannot see the hazard: the
  // suite would pass identically if a future edit read `r.hyperschema.name` where a reading was meant.
  // One hyperschema, two readings differing only by sort direction, packed for one of them.
  it("the capability statement and the coordinates name the READING, not the hyperschema", async () => {
    const two = await Gateway.open(new MemoryBackend(), { seed: OP_SEED, renderTimeoutMs: 10_000 });
    await two.append([observed(FERN, "height", 1, 1000, OP_SEED)]);
    // ONE reading whose LENS name is its own — the hyperschema is `Plant`, the reading is `PlantDesc`.
    // That is all the fixture needs: the two names no longer coincide, so a path that read the program
    // name where a reading was meant now answers the wrong string. (Two sibling readings collide on the
    // materialization through `register()`, which is `coexistence.test.ts`'s territory, not this one's.)
    const desc = { ...PLANT_POLICY, name: "PlantDesc" };
    two.register(PLANT, desc, [FERN], undefined, PLANT_WRITABLE);
    const readings = two.registered;
    expect(readings.map((r) => lensOf(r))).toEqual(["PlantDesc"]);
    expect(readings.map((r) => programOf(r))).toEqual(["Plant"]);
    expect(lensOf(readings[0]!)).not.toBe(programOf(readings[0]!));
    await two.publishRenderer({
      route: "desc",
      schema: "PlantDesc",
      consumes: ["height"],
      bundle: FLOOR,
    });
    await two.declareArtifact(["desc"]);
    const { page, capability } = two.packArtifact("desc", FERN, { server: "My Loam" });
    // The load-bearing assertions: both name the READING. Swapping `lensOf` for `hyperschema.name`
    // anywhere on this path turns these red — which is the whole point of the fixture.
    expect(capability.join(" ")).toContain("PlantDesc");
    expect(capability.join(" ")).not.toContain('lens "Plant"');
    expect(coordinatesFromPage(page)!.lens).toBe("PlantDesc");
    // …and the shell's own document names the reading too, executed against this store's live schema —
    // the program name would be `plant` and the reading's is `plantDesc`.
    expect(queryFieldFor("PlantDesc")).toBe("plantDesc");
    const served = await two.query(
      `query { ${queryFieldFor("PlantDesc")}(entity: ${JSON.stringify(FERN)}) { _entity _hex } }`,
    );
    expect(served.errors).toBeUndefined();
    const byProgram = await two.query(
      `query { ${queryFieldFor("Plant")}(entity: ${JSON.stringify(FERN)}) { _entity } }`,
    );
    expect(byProgram.errors?.join(" ")).toMatch(/Cannot query field/);
    void capabilityStatement;
    await two.close();
  });
});
