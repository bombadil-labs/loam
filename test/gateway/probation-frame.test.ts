import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Policy,
  type Schema,
} from "@bombadil/rhizomatic";
import { grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { declareHostSizedBill } from "../helpers/pool-bill.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { publicClaims, PUBLIC_ENTITY } from "../../src/gateway/public.js";
import { probationBanner } from "../../src/gateway/probation.js";
import { ADMIN_CONTAINER_PATH } from "../../src/server/admin-pages.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "3c".repeat(32);
const OP = authorForSeed(OP_SEED);
const PEN_SEED = "5a".repeat(32);
const PEN = authorForSeed(PEN_SEED);

const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const GUESTBOOK: Schema = {
  props: new Map<string, Policy>([
    ["message", pick],
    ["note", pick],
  ]),
  default: pick,
};

const APP =
  'export default (n) => `<main><p id=msg>${n.view.message ?? ""}</p>' +
  '<p id=note>${n.view.note ?? ""}</p>' +
  "<form method=post><input name=message></form></main>`;";

const CONTAINER = "container:stranger";

const primary = async (): Promise<{ gw: Gateway; backend: MemoryBackend }> => {
  const backend = new MemoryBackend();
  const gw = await Gateway.boot(
    backend,
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: GUESTBOOK, roots: [FERN], writable: ["message"] },
      ],
      grants: [grantClaims(STORE_ENTITY, PEN, "write", OP, 9_001)],
    }),
    { pens: { "stranger-pen": PEN_SEED } },
  );
  await gw.append([
    observed(FERN, "message", "the operator's own words", 9_100, OP_SEED),
    observed(FERN, "note", "a note only the operator wrote", 9_110, OP_SEED),
  ]);
  await gw.publishRenderer({
    route: "mine",
    schema: "Plant",
    consumes: ["message", "note"],
    bundle: APP,
  });
  await declareHostSizedBill(gw, 9_150);
  return { gw, backend };
};

const quarantine = async (gw: Gateway) => {
  await gw.append([
    signClaims(
      containerClaims({ container: CONTAINER, trust: "untrusted", posture: "separate" }, OP, 9_200),
      OP_SEED,
    ),
  ]);
  const c = await gw.openContainer({ name: CONTAINER });
  await c.gateway!.publishRenderer({
    route: "stranger",
    schema: "Plant",
    consumes: ["message", "note"],
    bundle: APP,
    writable: ["message"],
    pen: "stranger-pen",
  });
  return c;
};

const bodyOf = (r: { body: string }): string => r.body;

const publicPrimary = async (): Promise<{ gw: Gateway; backend: MemoryBackend }> => {
  const made = await primary();
  await made.gw.append([signClaims(publicClaims(["Plant"], OP, 9_800), OP_SEED)]);
  return made;
};

const declarePublicIn = (pool: Gateway, ts: number): Promise<unknown> =>
  pool.append([pool.signer!.sign(publicClaims(["Plant"], pool.operatorAuthor!, ts))]);

const publicDeclarationIn = (gw: Gateway): string =>
  [...gw.reactor.snapshot()].find((d) =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.id === PUBLIC_ENTITY,
    ),
  )!.id;

describe("T35 §24.7 — the pen writes into the pool, never into canonical", () => {
  it("a quarantined route's write lands in the pool's store and nowhere in the primary's", async () => {
    const { gw, backend } = await primary();
    const c = await quarantine(gw);
    const before = new Set((await backend.deltasSince(new Set())).map((d) => d.id));

    const wrote = await c.gateway!.writeRoute(
      "stranger",
      FERN,
      { message: "the stranger was here" },
      "full",
    );
    expect(wrote.status).toBe(200);

    const inPool = [...c.gateway!.reactor.snapshot()].filter((d) => d.claims.author === PEN);
    expect(inPool.length).toBe(1);
    expect(JSON.stringify(inPool[0]!.claims)).toContain("the stranger was here");

    expect([...gw.reactor.snapshot()].some((d) => d.claims.author === PEN)).toBe(false);
    expect(await backend.holds(inPool[0]!.id)).toBe(false);
    const after = new Set((await backend.deltasSince(new Set())).map((d) => d.id));
    expect([...after]).toEqual([...before]);

    expect(bodyOf(await c.gateway!.serveRoute("stranger", FERN, "full"))).toContain(
      "the stranger was here",
    );
    const mine = bodyOf(await gw.serveRoute("mine", FERN, "full"));
    expect(mine).toContain("the operator's own words");
    expect(mine).not.toContain("the stranger was here");
    await c.drop();
  });

  it("the app reads its own write back — it is running, not painting a preview", async () => {
    const { gw } = await primary();
    const c = await quarantine(gw);
    const first = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "full"));
    expect(first).toContain("the operator's own words");

    await c.gateway!.writeRoute("stranger", FERN, { message: "one" }, "full");
    expect(bodyOf(await c.gateway!.serveRoute("stranger", FERN, "full"))).toContain(
      "<p id=msg>one</p>",
    );
    await c.gateway!.writeRoute("stranger", FERN, { message: "two" }, "full");
    const second = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "full"));
    expect(second).toContain("<p id=msg>two</p>");
    expect(second).not.toContain("<p id=msg>one</p>");
    await c.drop();
  });

  it("dropping the pool under a live frame costs the primary nothing", async () => {
    const { gw, backend } = await primary();
    const c = await quarantine(gw);
    const pool = c.gateway!;
    await pool.writeRoute("stranger", FERN, { message: "throwaway" }, "full");
    const strangerDelta = [...pool.reactor.snapshot()].find((d) => d.claims.author === PEN)!.id;
    const poolBackend = pool.backend;
    expect(await poolBackend.holds(strangerDelta)).toBe(true);
    const before = bodyOf(await gw.serveRoute("mine", FERN, "full"));

    await c.drop();

    expect(gw.quarantinePools.size).toBe(0);
    await expect(poolBackend.holds(strangerDelta)).rejects.toThrow(/closed/);
    expect(await backend.holds(strangerDelta)).toBe(false);
    expect(bodyOf(await gw.serveRoute("mine", FERN, "full"))).toBe(before);
    expect(before).toContain("the operator's own words");
  });
});

describe("T35 §24.7 — the frame, and the sentence it may never say", () => {
  it("says the writes are live in the pool, and never that they go nowhere", async () => {
    const { gw } = await primary();
    const c = await quarantine(gw);
    const html = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "full"));

    expect(html).toContain("On probation");
    expect(html.toLowerCase()).toContain("writes are live");
    expect(html).toContain(CONTAINER);
    expect(html).toContain("Promotion is the only crossing");
    expect(html).toContain("Drop the pool and this app's writes go with the store");

    const lies = [
      "go nowhere",
      "goes nowhere",
      "nothing is written",
      "nothing will be written",
      "writes nothing",
      "no writes",
      "read-only",
      "read only",
      "preview only",
      "is a preview",
      "discarded immediately",
      "has no effect",
      "changes nothing",
    ];
    const lower = html.toLowerCase();
    expect(lies.filter((l) => lower.includes(l))).toEqual([]);
    await c.drop();
  });

  it("offers the promotion controls at the frame's edge, on the operator's door only", async () => {
    const { gw } = await primary();
    const c = await quarantine(gw);

    const full = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "full"));
    expect(full).toContain(`/admin/container?name=${encodeURIComponent(CONTAINER)}`);
    expect(full).toContain("Bless this app's law, adopt one of its outputs, or drop the pool");

    await declarePublicIn(c.gateway!, 9_400);
    const pub = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "public"));
    expect(pub).toContain("the operator's own words");
    expect(pub).toContain("On probation");
    expect(pub).toContain("Promotion is the only crossing");
    expect(pub).not.toContain("/admin/container");
    await c.drop();
  });

  it("the anonymous door withholds the container's declared name, as it withholds the link", async () => {
    const { gw } = await primary();
    const c = await quarantine(gw);
    await declarePublicIn(c.gateway!, 9_410);

    const pub = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "public"));
    expect(pub).not.toContain(CONTAINER);
    expect(pub).not.toContain("stranger");
    expect(pub).toContain("this quarantine pool");
    const full = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "full"));
    expect(full).toContain(CONTAINER);
    await c.drop();
  });

  it("the drop sentence carries the same qualifier the crossing sentence does", () => {
    for (const door of ["full", "public"] as const) {
      const html = probationBanner({ container: CONTAINER }, door);
      expect(html).toContain(
        "Nothing it wrote crosses into your ground unless you promoted it first",
      );
      expect(html).not.toMatch(/crosses into your ground\.\s*<\/span>/);
    }
  });

  it("a container name is escaped into the banner, never injected as markup", async () => {
    const { gw } = await primary();
    const hostile = 'container:<script>alert("x")</script>&';
    await gw.append([
      signClaims(
        containerClaims({ container: hostile, trust: "untrusted", posture: "separate" }, OP, 9_500),
        OP_SEED,
      ),
    ]);
    const c = await gw.openContainer({ name: hostile });
    await c.gateway!.publishRenderer({
      route: "hostile",
      schema: "Plant",
      consumes: ["message", "note"],
      bundle: APP,
    });
    const html = bodyOf(await c.gateway!.serveRoute("hostile", FERN, "full"));
    expect(html).toContain("On probation");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain(`name=${encodeURIComponent(hostile)}`);
    await c.drop();
  });

  it("a store that is not a quarantine frames nothing — canonical reads are untouched", async () => {
    const { gw } = await primary();
    const mine = bodyOf(await gw.serveRoute("mine", FERN, "full"));
    expect(mine).not.toContain("data-loam-probation");
    expect(mine).not.toContain("On probation");

    await gw.append([
      signClaims(
        containerClaims(
          { container: "container:mine", trust: "curated", posture: "separate" },
          OP,
          9_300,
        ),
        OP_SEED,
      ),
    ]);
    const c = await gw.openContainer({ name: "container:mine" });
    await c.gateway!.publishRenderer({
      route: "curated",
      schema: "Plant",
      consumes: ["message", "note"],
      bundle: APP,
    });
    const curated = bodyOf(await c.gateway!.serveRoute("curated", FERN, "full"));
    expect(curated).toContain("the operator's own words");
    expect(curated).not.toContain("data-loam-probation");

    await c.gateway!.publishRenderer({
      route: "curated-write",
      schema: "Plant",
      consumes: ["message", "note"],
      bundle: APP,
      writable: ["message"],
      pen: "stranger-pen",
    });
    const refused = await c.gateway!.writeRoute("curated-write", FERN, { message: "x" }, "full");
    expect(refused.status).toBe(403);
    expect(refused.body).toContain("not provisioned");
    await c.drop();
  });
});

describe("T35 §24.7 — the pen's second key is asked of the HOST, live", () => {
  it("striking the grant in the primary refuses the pool's write, with no reseed", async () => {
    const { gw } = await primary();
    const c = await quarantine(gw);
    const pool = c.gateway!;
    expect((await pool.writeRoute("stranger", FERN, { message: "before" }, "full")).status).toBe(
      200,
    );

    const grant = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some((p) => p.role === "subject" && JSON.stringify(p.target).includes(PEN)),
    )!;
    await gw.append([
      signClaims(makeNegationClaims(OP, 9_600_000, grant.id, "revoke the pen"), OP_SEED),
    ]);
    expect(holdsGrant(pool.reactor, pool.validityNow(), STORE_ENTITY, PEN, "write", OP)).toBe(true);

    const refused = await pool.writeRoute("stranger", FERN, { message: "after" }, "full");
    expect(refused.status).toBe(403);
    expect(refused.body).toContain("holds no write grant in the store this pool reads");
    expect(
      [...pool.reactor.snapshot()].some((d) => JSON.stringify(d.claims).includes("after")),
    ).toBe(false);
    const html = bodyOf(await pool.serveRoute("stranger", FERN, "full"));
    expect(html).toContain("<p id=msg>before</p>");
    expect(html).toContain("On probation");
    await c.drop();
  });

  it("a pool of a pool asks the ROOT, not its own frozen parent", async () => {
    const { gw } = await primary();
    const outer = await gw.openQuarantine();
    const inner = await outer.gateway.openQuarantine();
    await inner.gateway.publishRenderer({
      route: "deep",
      schema: "Plant",
      consumes: ["message", "note"],
      bundle: APP,
      writable: ["message"],
      pen: "stranger-pen",
    });
    expect(
      (await inner.gateway.writeRoute("deep", FERN, { message: "before" }, "full")).status,
    ).toBe(200);

    const grant = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some((p) => p.role === "subject" && JSON.stringify(p.target).includes(PEN)),
    )!;
    await gw.append([
      signClaims(makeNegationClaims(OP, 9_700_000, grant.id, "revoke the pen"), OP_SEED),
    ]);
    expect(
      holdsGrant(
        outer.gateway.reactor,
        outer.gateway.validityNow(),
        STORE_ENTITY,
        PEN,
        "write",
        OP,
      ),
    ).toBe(true);

    const refused = await inner.gateway.writeRoute("deep", FERN, { message: "after" }, "full");
    expect(refused.status).toBe(403);
    expect(refused.body).toContain("holds no write grant in the store this pool reads");
    expect(
      [...inner.gateway.reactor.snapshot()].some((d) =>
        JSON.stringify(d.claims).includes('"after"'),
      ),
    ).toBe(false);
    await inner.drop();
    await outer.drop();
  });

  it("a pool whose chain is broken refuses rather than trusting a frozen store", async () => {
    const { gw } = await primary();
    const outer = await gw.openQuarantine();
    const inner = await outer.gateway.openQuarantine();
    await inner.gateway.publishRenderer({
      route: "deep",
      schema: "Plant",
      consumes: ["message", "note"],
      bundle: APP,
      writable: ["message"],
      pen: "stranger-pen",
    });
    expect((await inner.gateway.writeRoute("deep", FERN, { message: "a" }, "full")).status).toBe(
      200,
    );

    await outer.detach();
    const refused = await inner.gateway.writeRoute("deep", FERN, { message: "b" }, "full");
    expect(refused.status).toBe(403);
    expect(refused.body).toContain("not attached to a store that can answer");
    expect(
      [...inner.gateway.reactor.snapshot()].some((d) => JSON.stringify(d.claims).includes('"b"')),
    ).toBe(false);
    await inner.drop();
  });

  it("a separate container may not take the store it was opened from", async () => {
    const { gw, backend } = await primary();
    await expect(gw.openQuarantine({ backend })).rejects.toThrow(/may not take the store/);
    const ok = await gw.openQuarantine({ backend: new MemoryBackend() });
    expect(ok.gateway.probation).toEqual({});
    await ok.drop();
    expect(bodyOf(await gw.serveRoute("mine", FERN, "full"))).toContain("the operator's own words");
  });
});

describe("T35 §24.7 — the anonymous write door into a quarantine pool", () => {
  it("an anonymous form-write over a public route lands in the pool and nowhere else", async () => {
    const { gw, backend } = await publicPrimary();
    const c = await quarantine(gw);
    const pool = c.gateway!;
    const before = new Set((await backend.deltasSince(new Set())).map((d) => d.id));

    const wrote = await pool.writeRoute(
      "stranger",
      FERN,
      { message: "a stranger, no token" },
      "public",
    );
    expect(wrote.status).toBe(200);
    expect(wrote.body).toContain("<p id=msg>a stranger, no token</p>");
    expect(wrote.body).toContain("On probation");
    expect(wrote.body).not.toContain("/admin/container");

    const inPool = [...pool.reactor.snapshot()].filter((d) => d.claims.author === PEN);
    expect(inPool.length).toBe(1);
    expect(JSON.stringify(inPool[0]!.claims)).toContain("a stranger, no token");

    expect([...gw.reactor.snapshot()].some((d) => d.claims.author === PEN)).toBe(false);
    expect(await backend.holds(inPool[0]!.id)).toBe(false);
    expect([...new Set((await backend.deltasSince(new Set())).map((d) => d.id))]).toEqual([
      ...before,
    ]);

    expect(bodyOf(await pool.serveRoute("stranger", FERN, "public"))).toContain(
      "a stranger, no token",
    );
    expect(bodyOf(await gw.serveRoute("mine", FERN, "full"))).not.toContain("a stranger, no token");
    await c.drop();
  });

  it("striking the primary's public declaration closes the pool's anonymous write door", async () => {
    const { gw } = await publicPrimary();
    const c = await quarantine(gw);
    const pool = c.gateway!;
    expect((await pool.writeRoute("stranger", FERN, { message: "before" }, "public")).status).toBe(
      200,
    );

    await gw.append([
      signClaims(
        makeNegationClaims(OP, 9_900_000, publicDeclarationIn(gw), "close the anonymous door"),
        OP_SEED,
      ),
    ]);
    expect(pool.isPublicLatest("Plant")).toBe(true);

    const refused = await pool.writeRoute("stranger", FERN, { message: "after" }, "public");
    expect(refused.status).toBe(404);
    expect(
      [...pool.reactor.snapshot()].some((d) => JSON.stringify(d.claims).includes("after")),
    ).toBe(false);
    const still = await pool.writeRoute("stranger", FERN, { message: "after" }, "full");
    expect(still.status).toBe(200);
    expect(bodyOf(await pool.serveRoute("stranger", FERN, "full"))).toContain(
      "<p id=msg>after</p>",
    );
    await c.drop();
  });

  it("the closed anonymous door is the same 404 an absent route is — no oracle", async () => {
    const { gw } = await publicPrimary();
    const c = await quarantine(gw);
    const pool = c.gateway!;
    await gw.append([
      signClaims(
        makeNegationClaims(OP, 9_910_000, publicDeclarationIn(gw), "close the anonymous door"),
        OP_SEED,
      ),
    ]);
    const closed = await pool.writeRoute("stranger", FERN, { message: "x" }, "public");
    const absent = await pool.writeRoute("no-such-route", FERN, { message: "x" }, "public");
    expect(closed.status).toBe(absent.status);
    expect(closed.body).toBe(absent.body);

    await c.drop();
  });

  it("a store refusal stays uniform on the anonymous door — the reason is the token door's", async () => {
    const { gw } = await publicPrimary();
    const c = await quarantine(gw);
    const pool = c.gateway!;
    await pool.publishRenderer({
      route: "wider",
      schema: "Plant",
      consumes: ["message", "note"],
      bundle: APP,
      writable: ["message", "note"],
      pen: "stranger-pen",
    });
    const anon = await pool.writeRoute("wider", FERN, { note: "x" }, "public");
    const token = await pool.writeRoute("wider", FERN, { note: "x" }, "full");
    expect(anon.status).toBe(403);
    expect(anon.body).toBe("the write was refused");
    expect(token.status).toBe(403);
    expect(token.body).not.toBe("the write was refused");
    await c.drop();
  });

  it("a pool whose chain is broken refuses the anonymous write, not just the token one", async () => {
    const { gw } = await publicPrimary();
    const c = await quarantine(gw);
    const pool = c.gateway!;
    expect((await pool.writeRoute("stranger", FERN, { message: "a" }, "public")).status).toBe(200);
    await c.detach();
    const refused = await pool.writeRoute("stranger", FERN, { message: "b" }, "public");
    expect(refused.status).toBe(404);
    expect([...pool.reactor.snapshot()].some((d) => JSON.stringify(d.claims).includes('"b"'))).toBe(
      false,
    );
  });
});

describe("T35 §24.7 — the frame's other shapes", () => {
  it("an anonymous openQuarantine pool is framed too, and names no page it cannot name", async () => {
    const { gw } = await primary();
    const pool = await gw.openQuarantine();
    await pool.gateway.publishRenderer({
      route: "anon",
      schema: "Plant",
      consumes: ["message", "note"],
      bundle: APP,
    });
    const html = bodyOf(await pool.gateway.serveRoute("anon", FERN, "full"));
    expect(html).toContain("On probation");
    expect(html).toContain("this quarantine pool");
    expect(html).toContain("Promote or drop it where it was opened");
    expect(html).not.toContain("/admin/container");
    await pool.drop();
  });

  it("the banner is the first thing in the body, fragment or whole document", async () => {
    const { gw } = await primary();
    const c = await quarantine(gw);
    const fragment = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "full"));
    expect(fragment.indexOf("data-loam-probation")).toBeLessThan(fragment.indexOf("<main>"));
    expect(fragment).toContain('data-loam-probation-stage="1"');

    await c.gateway!.publishRenderer({
      route: "doc",
      schema: "Plant",
      consumes: ["message", "note"],
      bundle:
        'export default () => "<!doctype html><html><head><title>t</title></head>' +
        '<body class=x><main>app</main></body></html>";',
    });
    const doc = bodyOf(await c.gateway!.serveRoute("doc", FERN, "full"));
    expect(doc.indexOf("<title>")).toBeLessThan(doc.indexOf("data-loam-probation"));
    expect(doc.indexOf("<body class=x>")).toBeLessThan(doc.indexOf("data-loam-probation"));
    expect(doc.indexOf("data-loam-probation")).toBeLessThan(doc.indexOf("<main>app</main>"));
    await c.drop();
  });

  it("the promotion link uses the admin door's own container path", () => {
    expect(probationBanner({ container: "container:x" }, "full")).toContain(
      `${ADMIN_CONTAINER_PATH}?name=`,
    );
  });

  it("a probationary store refuses to pack a route into a standalone page", async () => {
    const { gw } = await primary();
    const c = await quarantine(gw);
    await c.gateway!.declareArtifact(["stranger"]);
    expect(() => c.gateway!.packArtifact("stranger", FERN, { server: "Loam" })).toThrow(
      /quarantine pool/,
    );
    await gw.declareArtifact(["mine"]);
    const packed = gw.packArtifact("mine", FERN, { server: "Loam" }).page;
    expect(packed).toContain("<");
    expect(packed).not.toContain("data-loam-probation");
    await c.drop();
  });
});

describe("T35 §24.7 — erasure reaches through a mounted frame (§24.8)", () => {
  it("erasing in the primary forgets the byte behind a live probationary route", async () => {
    const { gw } = await primary();
    const c = await quarantine(gw);
    const pool = c.gateway!;
    expect(bodyOf(await pool.serveRoute("stranger", FERN, "full"))).toContain(
      "the operator's own words",
    );
    await pool.writeRoute("stranger", FERN, { message: "the stranger's own" }, "full");
    const canonical = [...gw.reactor.snapshot()].find((d) =>
      JSON.stringify(d.claims).includes("a note only the operator wrote"),
    )!.id;
    expect(await pool.backend.holds(canonical)).toBe(true);
    const bystander = [...gw.reactor.snapshot()].find((d) =>
      JSON.stringify(d.claims).includes("the operator's own words"),
    )!.id;

    await gw.erase(canonical, { reason: "the author asked" });

    expect(await pool.backend.holds(canonical)).toBe(false);
    expect(await gw.backend.holds(bystander)).toBe(true);
    expect(await pool.backend.holds(bystander)).toBe(true);
    expect(bodyOf(await gw.serveRoute("mine", FERN, "full"))).toContain("the operator's own words");
    const after = bodyOf(await pool.serveRoute("stranger", FERN, "full"));
    expect(after).not.toContain("a note only the operator wrote");
    expect(after).toContain("the stranger's own");
    expect(after).toContain("On probation");
    await c.drop();
  });
});
