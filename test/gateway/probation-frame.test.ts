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
import { authorForSeed, signClaims, type Policy, type Schema } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { publicClaims } from "../../src/gateway/public.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "3c".repeat(32);
const OP = authorForSeed(OP_SEED);
const PEN_SEED = "5a".repeat(32); // the stranger renderer's granted author
const PEN = authorForSeed(PEN_SEED);

const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const GUESTBOOK: Schema = { props: new Map<string, Policy>([["message", pick]]), default: pick };

// The stranger's app: it paints whatever `message` currently resolves to, and offers the form that
// writes it. Deliberately ordinary — the point of §24.7 is that a NORMAL app is what runs behind glass.
const APP =
  'export default (n) => `<main><p id=msg>${n.view.message ?? ""}</p>' +
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
  await gw.append([observed(FERN, "message", "the operator's own words", 9_100, OP_SEED)]);
  // The operator's OWN route over the same lens — the canonical control for every frame assertion.
  await gw.publishRenderer({ route: "mine", schema: "Plant", consumes: ["message"], bundle: APP });
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
    consumes: ["message"],
    bundle: APP,
    writable: ["message"],
    pen: "stranger-pen",
  });
  return c;
};

const bodyOf = (r: { body: string }): string => r.body;

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
    expect(html).toContain("Drop the pool");

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
      consumes: ["message"],
      bundle: APP,
    });
    const curated = bodyOf(await c.gateway!.serveRoute("curated", FERN, "full"));
    expect(curated).toContain("the operator's own words");
    expect(curated).not.toContain("data-loam-probation");
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
    const canonical = [...gw.reactor.snapshot()].find((d) =>
      JSON.stringify(d.claims).includes("the operator's own words"),
    )!.id;

    await gw.erase(canonical, { reason: "the author asked" });

    // The byte is gone from the pool's store, and the frame — still mounted, still serving — can no
    // longer paint it. Two-sided: what the pool authored ITSELF survives the erasure untouched.
    expect(await pool.backend.holds(canonical)).toBe(false);
    const after = bodyOf(await pool.serveRoute("stranger", FERN, "full"));
    expect(after).not.toContain("the operator's own words");
    expect(after).toContain("the stranger's own");
    expect(after).toContain("On probation");
    await c.drop();
  });
});
