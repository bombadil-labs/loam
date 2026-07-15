// SPEC §23 renderers, v1 — a UI unit pushed as deltas, bound to a Schema and a route, served by a host
// that hands it a resolved View and nothing else. These suites prove the vertical: publish → serve
// (HTML rendered from the live view), push-time verification (existence + field coverage + operator-only),
// latest-per-route and pinned-version serving, read discipline (the anonymous door serves only a declared
// lens's latest), the §23.6 "an app never outlives its source" law (withdraw stops serving), and that a
// faulting bundle refuses cleanly without leaking.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { publicClaims } from "../../src/gateway/public.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

// A v1 renderer: a resolved node in, HTML out. Reads `height` and paints it.
const HEIGHT_CARD = 'export default (n) => `<p class="h">height: ${n.view.height}</p>`;';

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

const spec = (over: Record<string, unknown> = {}) => ({
  route: "plant",
  schema: "Plant",
  consumes: ["height"],
  bundle: HEIGHT_CARD,
  ...over,
});

describe("§23: a renderer serves HTML rendered from the store's live view", () => {
  it("publishes a renderer and serves the route as HTML", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
    await gw.publishRenderer(spec());
    const out = await gw.serveRoute("plant", FERN, "full");
    expect(out.status).toBe(200);
    expect(out.contentType).toContain("text/html");
    expect(out.body).toBe('<p class="h">height: 42</p>');
    await gw.close();
  });

  it("re-resolves live — a new fact changes the rendered route", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 10, 1000, OP_SEED)]);
    await gw.publishRenderer(spec());
    expect((await gw.serveRoute("plant", FERN, "full")).body).toContain("height: 10");
    await gw.append([observed(FERN, "height", 77, 2000, OP_SEED)]);
    expect((await gw.serveRoute("plant", FERN, "full")).body).toContain("height: 77");
    await gw.close();
  });

  it("an unknown route is a 404", async () => {
    const gw = await boot();
    expect((await gw.serveRoute("nope", FERN, "full")).status).toBe(404);
    await gw.close();
  });
});

describe("§23.4: proven at push, not hoped at runtime", () => {
  it("refuses a renderer over an unregistered schema", async () => {
    const gw = await boot();
    await expect(gw.publishRenderer(spec({ schema: "Nonesuch" }))).rejects.toThrow(
      /no registered schema/,
    );
    await gw.close();
  });

  it("refuses a renderer that consumes a field the schema does not have", async () => {
    const gw = await boot();
    await expect(gw.publishRenderer(spec({ consumes: ["height", "nonesuch"] }))).rejects.toThrow(
      /no such field/,
    );
    await gw.close();
  });

  it("refuses a pinned version that does not exist", async () => {
    const gw = await boot();
    await expect(gw.publishRenderer(spec({ version: 5 }))).rejects.toThrow(/no version v5/);
    await gw.close();
  });

  it("refuses a bundle that is not runnable ESM exporting a function", async () => {
    const gw = await boot();
    await expect(gw.publishRenderer(spec({ bundle: "export default 42;" }))).rejects.toThrow(
      /export default/,
    );
    await gw.close();
  });
});

describe("§23.5: latest per route, and pinned versions", () => {
  it("re-pushing a route evolves it (latest wins)", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 5, 1000, OP_SEED)]);
    await gw.publishRenderer(spec());
    await gw.publishRenderer(
      spec({ bundle: "export default (n) => `<b>${n.view.height}cm</b>`;" }),
    );
    expect(gw.renderers().filter((r) => r.route === "plant")).toHaveLength(1);
    expect((await gw.serveRoute("plant", FERN, "full")).body).toBe("<b>5cm</b>");
    await gw.close();
  });

  it("a version-pinned renderer resolves against that frozen version", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 30, 1000, OP_SEED)]);
    // evolve the schema to v2 (adds `note`), so v1 and v2 are distinct frozen readings
    const evolved = {
      ...PLANT_POLICY,
      props: new Map([
        ...PLANT_POLICY.props,
        [
          "note",
          { kind: "all" as const, order: { kind: "byTimestamp" as const, dir: "asc" as const } },
        ],
      ]),
    };
    await gw.publishRegistration(PLANT, evolved, [FERN], undefined, undefined, undefined, [
      ...PLANT_WRITABLE,
      "note",
    ]);
    // a renderer pinned to v1 reads the v1 reading; note-free
    await gw.publishRenderer(
      spec({
        route: "plantV1",
        version: 1,
        bundle: "export default (n) => `<i>${n.view.note ?? 'none'}</i>`;",
      }),
    );
    // v1 froze before `note`, so its view has no note — the renderer paints 'none'
    expect((await gw.serveRoute("plantV1", FERN, "full")).body).toBe("<i>none</i>");
    await gw.close();
  });
});

describe("§23.4 + §17: a pin is the version's CONTENT ADDRESS, durable against withdrawal", () => {
  // evolve Plant to v2 (adds `note`), returning the gateway with versions [v1, v2].
  const withV2 = async (): Promise<Gateway> => {
    const gw = await boot();
    await gw.append([
      observed(FERN, "height", 30, 1000, OP_SEED),
      observed(FERN, "note", "hi", 1500, OP_SEED),
    ]);
    const evolved = {
      ...PLANT_POLICY,
      props: new Map([
        ...PLANT_POLICY.props,
        [
          "note",
          { kind: "all" as const, order: { kind: "byTimestamp" as const, dir: "asc" as const } },
        ],
      ]),
    };
    await gw.publishRegistration(PLANT, evolved, [FERN], undefined, undefined, undefined, [
      ...PLANT_WRITABLE,
      "note",
    ]);
    return gw;
  };

  it("a pin resolves the SAME frozen version even after an EARLIER version is withdrawn (no vN shift)", async () => {
    const gw = await withV2();
    // pin to v2 (which declares `note` as a list), render it
    await gw.publishRenderer(
      spec({
        route: "pinned2",
        version: 2,
        consumes: ["note"],
        bundle: "export default (n) => `<i>${JSON.stringify(n.view.note)}</i>`;",
      }),
    );
    const before = (await gw.serveRoute("pinned2", FERN, "full")).body;
    expect(before).toBe('<i>["hi"]</i>'); // v2 sees `note` as a list

    // withdraw v1 — the numeric alias would now renumber v2 to "v1", but the pin is by content address
    const v1 = gw.registrationVersions().filter((v) => v.hyperschema.name === "Plant")[0]!;
    await gw.append([
      signClaims(makeNegationClaims(OP, 9_000_000, v1.deltaId, "withdraw v1"), OP_SEED),
    ]);
    // the pinned renderer STILL resolves v2's frozen reading — it never slid to a different version
    expect((await gw.serveRoute("pinned2", FERN, "full")).body).toBe('<i>["hi"]</i>');
    await gw.close();
  });

  it("field coverage is checked against the PINNED version, not the latest (§23.4)", async () => {
    const gw = await withV2();
    // `note` exists only in v2; a renderer pinned to v1 that consumes it must be refused at push,
    // not accepted-because-latest-has-it (the false-accept the panel caught).
    await expect(
      gw.publishRenderer(spec({ route: "p1", version: 1, consumes: ["note"] })),
    ).rejects.toThrow(/no such field/);
    // ...and consuming a field v1 DOES have is accepted for a v1 pin
    await expect(
      gw.publishRenderer(spec({ route: "p1", version: 1, consumes: ["height"] })),
    ).resolves.toBeUndefined();
    await gw.close();
  });
});

describe("§23.6: an app never outlives its source", () => {
  it("a route whose schema is not in the door's surface serves a clean 404, never a resolve-error leak", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 3, 1000, OP_SEED)]);
    // raw-append a renderer over a schema the store never registered (past publishRenderer's guard) — the
    // surface check darkens it with a uniform 404, never a 400 leaking the resolver's internals (§23.6 /
    // the correctness panel's door-asymmetry finding).
    const { rendererBindingClaims } = await import("../../src/gateway/renderers.js");
    await gw.append([
      signClaims(
        rendererBindingClaims(
          { route: "ghost", schemaName: "Ghost", consumes: [], bundle: HEIGHT_CARD },
          undefined,
          OP,
          9_000_000,
        ),
        OP_SEED,
      ),
    ]);
    const out = await gw.serveRoute("ghost", FERN, "full");
    expect(out.status).toBe(404);
    expect(out.body).toBe("no such route");
    await gw.close();
  });

  it("withdrawing the renderer binding stops serving the route", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 9, 1000, OP_SEED)]);
    await gw.publishRenderer(spec());
    expect((await gw.serveRoute("plant", FERN, "full")).status).toBe(200);
    const binding = gw.renderers().find((r) => r.route === "plant")!;
    await gw.append([
      signClaims(
        makeNegationClaims(OP, 9_000_000, binding.deltaId, "retire the plant renderer"),
        OP_SEED,
      ),
    ]);
    expect((await gw.serveRoute("plant", FERN, "full")).status).toBe(404); // gone with its source
    await gw.close();
  });
});

describe("§23: read discipline on the anonymous door (§17)", () => {
  it("the public door serves a renderer only for a publicly-declared lens", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 21, 1000, OP_SEED)]);
    await gw.publishRenderer(spec());
    // not declared public yet → the anonymous door refuses (uniform 404, no oracle)
    expect((await gw.serveRoute("plant", FERN, "public")).status).toBe(404);
    // declare Plant public → the anonymous door serves it
    await gw.append([signClaims(publicClaims(["Plant"], OP, 2000), OP_SEED)]);
    const out = await gw.serveRoute("plant", FERN, "public");
    expect(out.status).toBe(200);
    expect(out.body).toContain("height: 21");
    // ...but the operator door serves it regardless
    expect((await gw.serveRoute("plant", FERN, "full")).status).toBe(200);
    await gw.close();
  });

  it("the public door refuses a version-pinned renderer (latest-only until the §23.8 amendment)", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 8, 1000, OP_SEED)]);
    await gw.append([signClaims(publicClaims(["Plant"], OP, 2000), OP_SEED)]);
    await gw.publishRenderer(spec({ route: "pinned", version: 1 }));
    expect((await gw.serveRoute("pinned", FERN, "public")).status).toBe(404); // no pinned-public in v1
    expect((await gw.serveRoute("pinned", FERN, "full")).status).toBe(200); // full door is fine
    await gw.close();
  });
});

describe("§23: a faulting renderer refuses cleanly", () => {
  it("a bundle that throws at render time is a 500, not a leak or a crash", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 1, 1000, OP_SEED)]);
    await gw.publishRenderer(
      spec({ bundle: "export default () => { throw new Error('boom secret internals'); };" }),
    );
    const out = await gw.serveRoute("plant", FERN, "full");
    expect(out.status).toBe(500);
    expect(out.body).not.toContain("secret internals"); // the operator's fault, not leaked
    await gw.close();
  });

  it("a bundle that returns a non-string is a 500, not garbage HTML", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 1, 1000, OP_SEED)]);
    await gw.publishRenderer(spec({ bundle: "export default () => 42;" }));
    const out = await gw.serveRoute("plant", FERN, "full");
    expect(out.status).toBe(500);
    expect(out.body).toMatch(/did not return HTML/);
    await gw.close();
  });

  it("only the operator may publish a renderer", async () => {
    const gw = await boot();
    await expect(gw.publishRenderer(spec(), { actor: "cd".repeat(32) })).rejects.toThrow(
      /only the operator/,
    );
    await gw.close();
  });
});

describe("§23: an unloaded bundle is UNMOUNTED (404), and prepareRoute loads it", () => {
  it("a renderer binding appended raw (not preloaded) serves 404 until prepareRoute loads it", async () => {
    const gw = await boot();
    await gw.append([observed(FERN, "height", 7, 1000, OP_SEED)]);
    // hand-forge a valid renderer binding with a UNIQUE bundle (never loaded by another test — the ESM
    // cache is process-global) and append it RAW — no publishRenderer, so no preload.
    const uniqueBundle = "export default (n) => `<u>raw ${n.view.height}</u>`;";
    const { rendererBindingClaims } = await import("../../src/gateway/renderers.js");
    await gw.append([
      signClaims(
        rendererBindingClaims(
          { route: "raw", schemaName: "Plant", consumes: ["height"], bundle: uniqueBundle },
          undefined,
          OP,
          9_000_000,
        ),
        OP_SEED,
      ),
    ]);
    // the binding is live, but its bundle is not in the ESM cache → unmounted, a clean 404 (never a 500)
    expect((await gw.serveRoute("raw", FERN, "full")).status).toBe(404);
    // prepareRoute (the async serve-path step) loads it, and then it mounts
    await gw.prepareRoute("raw");
    expect((await gw.serveRoute("raw", FERN, "full")).status).toBe(200);
    await gw.close();
  });
});
