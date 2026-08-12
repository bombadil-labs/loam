// T35 — §24.7's SEQUESTERED FRAME: a stranger's app running against real ground, visibly on probation.
//
// The rails ask at BOTH levels, because either alone is blind here. At the DELTA level: a write made
// through a quarantined route lands in the pool's store under the renderer's pen and is absent from the
// primary's — the failure that matters is a sequestered write escaping into canonical, and no reading of
// rendered HTML can see it. At the OBJECT level: what a person actually receives from the door says the
// thing is on probation, the app reads its own write back (it is live, not a preview), and a canonical
// route served by the primary is untouched by any of it.
//
// What these rails deliberately do NOT assert: that the frame is UNFORGEABLE. It is chrome inside the
// same document as untrusted markup, so a hostile bundle can cover or restyle it. Visual containment
// wants a sandboxed iframe, which drops the same-origin credentials the §23.3 write path needs — a
// separate slice with its own design. The rail here is that the sequestration statement is in the served
// bytes on every rendered response from a probationary pool.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Policy,
  type Schema,
} from "@bombadil/rhizomatic";
import { grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
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
const PEN_SEED = "5a".repeat(32); // the stranger renderer's granted author
const PEN = authorForSeed(PEN_SEED);

const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
// TWO fields, and the second one is load-bearing. `message` is what the stranger's form writes;
// `note` only the operator ever authors — so an erasure rail can watch a canonical value disappear
// from a field the pool's own write is not sitting on top of. With one field, `pick`-by-timestamp
// would hide the erased value behind the pool's newer write and the rail would pass with the
// erasure fan-out deleted.
const GUESTBOOK: Schema = {
  props: new Map<string, Policy>([
    ["message", pick],
    ["note", pick],
  ]),
  default: pick,
};

// The stranger's app: it paints what the lens currently resolves, and offers the form that writes
// `message`. Deliberately ordinary — the point of §24.7 is that a NORMAL app is what runs behind glass.
const APP =
  'export default (n) => `<main><p id=msg>${n.view.message ?? ""}</p>' +
  '<p id=note>${n.view.note ?? ""}</p>' +
  "<form method=post><input name=message></form></main>`;";

const CONTAINER = "container:stranger";

// A primary store: Plant registered as a one-field guestbook, the stranger's pen provisioned AND granted
// write standing, and one canonical message already on the ground.
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
  // The operator's OWN route over the same lens — the canonical control for every frame assertion.
  await gw.publishRenderer({
    route: "mine",
    schema: "Plant",
    consumes: ["message", "note"],
    bundle: APP,
  });
  return { gw, backend };
};

// A declared, untrusted, separate container — §24's quarantine as a NAMED container (§27), so the frame
// has a name to point its promotion controls at.
const quarantine = async (gw: Gateway) => {
  await gw.append([
    signClaims(
      containerClaims({ container: CONTAINER, trust: "untrusted", posture: "separate" }, OP, 9_200),
      OP_SEED,
    ),
  ]);
  const c = await gw.openContainer({ name: CONTAINER });
  // The stranger's law BINDS here, which is the whole point of the pool: untrusted law may run.
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

// The same primary, with `Plant` declared open to tokenless callers BEFORE the container opens — so the
// pool inherits the declaration through the seeding edge, exactly as a real quarantine does. This is the
// configuration the anonymous write door needs, and the one the root's second key is asked about.
const publicPrimary = async (): Promise<{ gw: Gateway; backend: MemoryBackend }> => {
  const made = await primary();
  await made.gw.append([signClaims(publicClaims(["Plant"], OP, 9_800), OP_SEED)]);
  return made;
};

// The primary's surviving `loam:public` declaration, for a rail that needs to strike it.
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

    // DELTA LEVEL, positive: the pool holds a delta the PEN authored carrying the stranger's message.
    const inPool = [...c.gateway!.reactor.snapshot()].filter((d) => d.claims.author === PEN);
    expect(inPool.length).toBe(1);
    expect(JSON.stringify(inPool[0]!.claims)).toContain("the stranger was here");

    // DELTA LEVEL, negative — the failure that matters. Nothing the pen wrote is in the primary, at the
    // reactor OR at the bytes, and the primary's own delta set is byte-for-byte what it was.
    expect([...gw.reactor.snapshot()].some((d) => d.claims.author === PEN)).toBe(false);
    expect(await backend.holds(inPool[0]!.id)).toBe(false);
    const after = new Set((await backend.deltasSince(new Set())).map((d) => d.id));
    expect([...after]).toEqual([...before]);

    // OBJECT LEVEL, both sides: the pool's reader sees the stranger's message; the primary's reader,
    // through the same lens and the same route, still resolves the operator's own words.
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
    // Before: the app paints the ground it was seeded with.
    const first = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "full"));
    expect(first).toContain("the operator's own words");

    await c.gateway!.writeRoute("stranger", FERN, { message: "one" }, "full");
    expect(bodyOf(await c.gateway!.serveRoute("stranger", FERN, "full"))).toContain(
      "<p id=msg>one</p>",
    );
    // And it is STATEFUL across gestures: a second write supersedes the first through the same door.
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
    expect(await poolBackend.holds(strangerDelta)).toBe(true); // it was really there
    const before = bodyOf(await gw.serveRoute("mine", FERN, "full"));

    await c.drop();

    // The pool is gone whole — out of the erasure registry and closed at its store, which is what
    // makes the discard an erase-by-construction rather than a cleanup. (drop() verifies the bytes
    // itself and refuses over doubt; that contract is railed in pool-drop-detach.) And the primary is
    // exactly as it was: same rendered answer, same delta set, never a byte of the pool's write.
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

    // Present, in a person's words: probation, live writes into a named pool, promotion as the only
    // crossing, and a droppable pool.
    expect(html).toContain("On probation");
    expect(html.toLowerCase()).toContain("writes are live");
    expect(html).toContain(CONTAINER);
    expect(html).toContain("Promotion is the only crossing");
    expect(html).toContain("Drop the pool and this app's writes go with the store");

    // ABSENT — §24.7's named lie, in every spelling this repo could think of. The frame must never
    // tell an operator the app is inert: its writes are real, and they are in the pool.
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

    // An ANONYMOUS caller learns the truth about what they are looking at and is handed no door into
    // the operator's controls — the same discipline the rest of the public door runs. (Declared public
    // IN THE POOL: a container mounts its own world, so its anonymous surface is its own to declare.)
    await c.gateway!.append([signClaims(publicClaims(["Plant"], OP, 9_400), OP_SEED)]);
    const pub = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "public"));
    expect(pub).toContain("the operator's own words"); // the route really served
    expect(pub).toContain("On probation");
    expect(pub).toContain("Promotion is the only crossing");
    expect(pub).not.toContain("/admin/container");
    await c.drop();
  });

  it("the anonymous door withholds the container's declared name, as it withholds the link", async () => {
    // A container name is the OPERATOR's choice and routinely names a counterparty — "the quarantine
    // pool \"container:acme-trial\"" tells a stranger who this store is talking to. The door that
    // withholds the promotion controls withholds what they point at.
    const { gw } = await primary();
    const c = await quarantine(gw);
    await c.gateway!.append([signClaims(publicClaims(["Plant"], OP, 9_410), OP_SEED)]);

    const pub = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "public"));
    expect(pub).not.toContain(CONTAINER);
    expect(pub).not.toContain("stranger"); // nor the bare name inside it
    // TWO-SIDED, and the second half is what stops this passing with the name deleted everywhere: the
    // operator's own door still names the pool, because an operator must know WHICH pool this is.
    expect(pub).toContain("this quarantine pool");
    const full = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "full"));
    expect(full).toContain(CONTAINER);
    await c.drop();
  });

  it("the drop sentence carries the same qualifier the crossing sentence does", () => {
    // "Nothing it wrote crosses into your ground" is flatly false once an operator promotes an output
    // (§24.3) — and it sat one sentence away from the hedged version of the same claim. A frame that
    // overclaims the drop is the §24.7 failure pointed the other way.
    for (const door of ["full", "public"] as const) {
      const html = probationBanner({ container: CONTAINER }, door);
      expect(html).toContain(
        "Nothing it wrote crosses into your ground unless you promoted it first",
      );
      // The absolute form must not survive anywhere in the banner, under either door.
      expect(html).not.toMatch(/crosses into your ground\.\s*<\/span>/);
    }
  });

  it("a container name is escaped into the banner, never injected as markup", async () => {
    // The name reaches the frame from a DECLARATION, and a declaration is content — a store that
    // federated one in, or an operator who pasted one, must not thereby author markup on a page the
    // renderer door composes.
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
    expect(html).not.toContain("<script>"); // no tag the name spelled reaches the document
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;"); // and the ampersand is escaped, not left to start an entity
    expect(html).toContain(`name=${encodeURIComponent(hostile)}`); // the href carries it encoded
    await c.drop();
  });

  it("a store that is not a quarantine frames nothing — canonical reads are untouched", async () => {
    const { gw } = await primary();
    const mine = bodyOf(await gw.serveRoute("mine", FERN, "full"));
    expect(mine).not.toContain("data-loam-probation");
    expect(mine).not.toContain("On probation");

    // And neither does a CURATED separate container: it holds the operator's own law, so calling it
    // probation would be the same lie pointed the other way.
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

    // And it inherits no PENS either. The pens travel into the container the frame exists for and no
    // other: a curated container and a §39 inbox pool build authority in their own ground on purpose,
    // and handing them the host's signing keys would widen what they may do in the host's name.
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
    // Granted: the pen writes.
    expect((await pool.writeRoute("stranger", FERN, { message: "before" }, "full")).status).toBe(
      200,
    );

    // The operator strikes the pen's grant in the PRIMARY, and nothing re-pulses the seeding edge —
    // the pool's own copy of the grant still stands. The write must refuse anyway: a revocation that
    // only arrives on a pulse nobody calls is not a revocation.
    const grant = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some((p) => p.role === "subject" && JSON.stringify(p.target).includes(PEN)),
    )!;
    await gw.append([
      signClaims(makeNegationClaims(OP, 9_600_000, grant.id, "revoke the pen"), OP_SEED),
    ]);
    expect(holdsGrant(pool.reactor, STORE_ENTITY, PEN, "write", OP)).toBe(true); // stale copy stands

    const refused = await pool.writeRoute("stranger", FERN, { message: "after" }, "full");
    expect(refused.status).toBe(403);
    expect(refused.body).toContain("holds no write grant in the store this pool reads");
    // At the delta level: nothing the pen authored after the strike is in the pool.
    expect(
      [...pool.reactor.snapshot()].some((d) => JSON.stringify(d.claims).includes("after")),
    ).toBe(false);
    // Two-sided: the page still SERVES, still framed, still showing what was written while granted.
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

    // Strike at the ROOT. The intermediate pool's copy of the grant is as frozen as the inner one's,
    // so a check that climbed only one link would ask a store that still says yes.
    const grant = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some((p) => p.role === "subject" && JSON.stringify(p.target).includes(PEN)),
    )!;
    await gw.append([
      signClaims(makeNegationClaims(OP, 9_700_000, grant.id, "revoke the pen"), OP_SEED),
    ]);
    expect(holdsGrant(outer.gateway.reactor, STORE_ENTITY, PEN, "write", OP)).toBe(true);

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

    // Detaching the middle pool makes it the END of the pointer chain — still readable, permanently
    // frozen, and never again told about a revocation. A check that trusted whatever `attachedTo`
    // landed on would now believe it. "I cannot verify the chain" must refuse.
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
    // Two-sided: its own backend opens fine, and the primary is still whole afterwards.
    const ok = await gw.openQuarantine({ backend: new MemoryBackend() });
    expect(ok.gateway.probation).toEqual({});
    await ok.drop();
    expect(bodyOf(await gw.serveRoute("mine", FERN, "full"))).toContain("the operator's own words");
  });
});

// THE WIDENING THIS PR DECLARED, RAILED. Carrying the primary's pen seeds into an untrusted pool made
// one input newly permitted: a TOKENLESS caller can now POST a form on a public route in a quarantine
// pool and have it signed. Every other rail in this file drives the "full" (token) door, so the widened
// input had no rail at all. These drive it, at both levels, in both directions.
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
    // The re-render a browser form submit lands on is the PUBLIC door's, so it is framed and carries no
    // link into the operator's controls.
    expect(wrote.body).toContain("<p id=msg>a stranger, no token</p>");
    expect(wrote.body).toContain("On probation");
    expect(wrote.body).not.toContain("/admin/container");

    // DELTA LEVEL, positive: the pool holds one PEN-authored delta carrying what the stranger posted.
    const inPool = [...pool.reactor.snapshot()].filter((d) => d.claims.author === PEN);
    expect(inPool.length).toBe(1);
    expect(JSON.stringify(inPool[0]!.claims)).toContain("a stranger, no token");

    // DELTA LEVEL, negative — the failure that matters. The primary's byte set is unchanged, and its
    // reactor holds nothing the pen authored.
    expect([...gw.reactor.snapshot()].some((d) => d.claims.author === PEN)).toBe(false);
    expect(await backend.holds(inPool[0]!.id)).toBe(false);
    expect([...new Set((await backend.deltasSince(new Set())).map((d) => d.id))]).toEqual([
      ...before,
    ]);

    // OBJECT LEVEL, both sides: the pool's reader sees it; the primary's own route does not.
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

    // The operator closes the anonymous door in the PRIMARY, and nothing re-pulses the seeding edge.
    // The pool's own copy of the declaration still says open — that is the point of the rail.
    await gw.append([
      signClaims(
        makeNegationClaims(OP, 9_900_000, publicDeclarationIn(gw), "close the anonymous door"),
        OP_SEED,
      ),
    ]);
    expect(pool.isPublicLatest("Plant")).toBe(true); // stale copy stands

    const refused = await pool.writeRoute("stranger", FERN, { message: "after" }, "public");
    expect(refused.status).toBe(404);
    // DELTA LEVEL: nothing the pen authored after the strike reached the pool.
    expect(
      [...pool.reactor.snapshot()].some((d) => JSON.stringify(d.claims).includes("after")),
    ).toBe(false);
    // TWO-SIDED, and it has to be a SUCCESS: only the ANONYMOUS door closed. The operator's own token
    // door still writes the same route, so the rail cannot pass with the whole route disabled.
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
    // A route whose OWN writable list is wider than the registration's: `note` clears the renderer's
    // allow-list and the STORE refuses it. The route is open and the pen holds both keys, so this is
    // the one refusal that comes from §14 rather than from the door.
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
    // TWO-SIDED: the token door DOES carry the reason, so this cannot pass with both doors muted.
    expect(token.status).toBe(403);
    expect(token.body).not.toBe("the write was refused");
    await c.drop();
  });

  it("a pool whose chain is broken refuses the anonymous write, not just the token one", async () => {
    const { gw } = await publicPrimary();
    const c = await quarantine(gw);
    const pool = c.gateway!;
    expect((await pool.writeRoute("stranger", FERN, { message: "a" }, "public")).status).toBe(200);
    // Detached: the root can no longer be asked, and "I cannot tell" is not "permitted".
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
    expect(html).toContain("this quarantine pool"); // no declared name to point at
    expect(html).toContain("Promote or drop it where it was opened");
    expect(html).not.toContain("/admin/container");
    await pool.drop();
  });

  it("the banner is the first thing in the body, fragment or whole document", async () => {
    const { gw } = await primary();
    const c = await quarantine(gw);
    // A fragment: the banner precedes the app's own markup.
    const fragment = bodyOf(await c.gateway!.serveRoute("stranger", FERN, "full"));
    expect(fragment.indexOf("data-loam-probation")).toBeLessThan(fragment.indexOf("<main>"));
    expect(fragment).toContain('data-loam-probation-stage="1"'); // the app sits in its own stage

    // A whole document: the banner lands INSIDE the body, before the app, and the document's own
    // head is left where the bundle put it.
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
    // The frame hardcodes the path (a gateway may not import a server module), so pin the literal to
    // the door's own constant here rather than letting the two rot apart. WHAT THIS DOES NOT PIN:
    // the query key. `?name=` is a literal on both sides, so a door that renamed the parameter would
    // keep this green while the link landed on a page that cannot name the container. Closing it
    // wants a rail that drives the admin door itself, which lives in test/server.
    expect(probationBanner({ container: "container:x" }, "full")).toContain(
      `${ADMIN_CONTAINER_PATH}?name=`,
    );
  });

  it("a probationary store refuses to pack a route into a standalone page", async () => {
    const { gw } = await primary();
    const c = await quarantine(gw);
    // Packing lifts a route out of the store into a page that outlives the pool and carries no
    // chrome — a probationary face with its probation removed. Refused, and the reason says why.
    await c.gateway!.declareArtifact(["stranger"]); // declared, so only the probation refuses it
    expect(() => c.gateway!.packArtifact("stranger", FERN, { server: "Loam" })).toThrow(
      /quarantine pool/,
    );
    // Two-sided, and it has to be a SUCCESS: the guard reads the store it was asked about, so a
    // non-probationary store still packs. (A second refusal would prove only that packing refuses.)
    await gw.declareArtifact(["mine"]);
    const packed = gw.packArtifact("mine", FERN, { server: "Loam" }).page;
    expect(packed).toContain("<");
    expect(packed).not.toContain("data-loam-probation"); // and a page from a real store is not framed
    await c.drop();
  });
});

describe("T35 §24.7 — erasure reaches through a mounted frame (§24.8)", () => {
  it("erasing in the primary forgets the byte behind a live probationary route", async () => {
    const { gw } = await primary();
    const c = await quarantine(gw);
    const pool = c.gateway!;
    // A live frame over the seeded ground, and a live pool-side write beside it.
    expect(bodyOf(await pool.serveRoute("stranger", FERN, "full"))).toContain(
      "the operator's own words",
    );
    await pool.writeRoute("stranger", FERN, { message: "the stranger's own" }, "full");
    // ERASE THE FIELD THE POOL DID NOT WRITE. Erasing `message` would prove nothing: the pool's own
    // newer write already wins `pick`-by-timestamp, so the value would vanish from the page whether
    // or not the fan-out ever reached this store. `note` is the operator's alone.
    const canonical = [...gw.reactor.snapshot()].find((d) =>
      JSON.stringify(d.claims).includes("a note only the operator wrote"),
    )!.id;
    expect(await pool.backend.holds(canonical)).toBe(true); // the pool really held the byte
    const bystander = [...gw.reactor.snapshot()].find((d) =>
      JSON.stringify(d.claims).includes("the operator's own words"),
    )!.id;

    await gw.erase(canonical, { reason: "the author asked" });

    // The byte is gone from the pool's store, and the frame — still mounted, still serving — can no
    // longer paint it. Two-sided: the pool's own output and the operator's un-erased words both live.
    expect(await pool.backend.holds(canonical)).toBe(false);
    // TWO-SIDED at the bytes: a named live bystander — the operator's un-erased `message` — is still
    // held by BOTH stores. A rail that only proves removal cannot see an over-purge.
    expect(await gw.backend.holds(bystander)).toBe(true);
    expect(await pool.backend.holds(bystander)).toBe(true);
    // And at the OBJECT level, on the side that can still show it: the primary's own route.
    expect(bodyOf(await gw.serveRoute("mine", FERN, "full"))).toContain("the operator's own words");
    const after = bodyOf(await pool.serveRoute("stranger", FERN, "full"));
    expect(after).not.toContain("a note only the operator wrote");
    expect(after).toContain("the stranger's own");
    expect(after).toContain("On probation");
    await c.drop();
  });
});
