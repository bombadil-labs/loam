// Pinned-public — SPEC §23.8. §17 narrowed the anonymous door to the LATEST version per declared name,
// because an anonymous @hash probe was a registration-existence oracle. But a renderer PINS a version, and
// village-as-a-URL wants strangers reading that pinned route. The reconciliation: a probe is discovery, a
// DECLARATION is publication — when the operator names `Name@vN` in `loam.public`, they chose to reveal
// exactly that version, so the anonymous door serves it; every OTHER @hash stays 404. The pin is frozen to
// the version's content address at declare time, so it never slides when an earlier version is withdrawn.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Policy } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { handleRest } from "../../src/surface/rest.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const ALT_SEED = "a1".repeat(32); // a non-operator
const CARD = "export default (n) => `<p>height: ${n.view.height}</p>`;";

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

// Evolve Plant to v2 (adds `note`) so "v1" and "the latest" are genuinely different versions.
const withV2 = async (): Promise<Gateway> => {
  const gw = await boot();
  await gw.append([observed(FERN, "height", 30, 1000, OP_SEED)]);
  const noteList: Policy = { kind: "all", order: { kind: "byTimestamp", dir: "asc" } };
  const evolved = { ...PLANT_POLICY, props: new Map([...PLANT_POLICY.props, ["note", noteList]]) };
  await gw.publishRegistration(PLANT, evolved, [FERN], undefined, undefined, undefined, [
    ...PLANT_WRITABLE,
    "note",
  ]);
  return gw;
};

const v1DeltaId = (gw: Gateway): string =>
  gw.registrationVersions().filter((v) => v.hyperschema.name === "Plant")[0]!.deltaId;

// A gateway with v2 latest, a renderer pinned to v1 on route "pinned", and a latest renderer on "latest".
const staged = async (): Promise<Gateway> => {
  const gw = await withV2();
  await gw.publishRenderer({
    route: "pinned",
    schema: "Plant",
    version: 1,
    consumes: ["height"],
    bundle: CARD,
  });
  await gw.publishRenderer({
    route: "latest",
    schema: "Plant",
    consumes: ["height"],
    bundle: CARD,
  });
  return gw;
};

describe("§23.8: the anonymous door serves a pinned route IFF the operator declared that pin", () => {
  it("declare Name@v1 → the anonymous door serves the v1-pinned renderer (rail a)", async () => {
    const gw = await staged();
    expect((await gw.serveRoute("pinned", FERN, "public")).status).toBe(404); // not declared yet
    await gw.declarePublic(["Plant@v1"]);
    const out = await gw.serveRoute("pinned", FERN, "public");
    expect(out.status).toBe(200);
    expect(out.body).toContain("height: 30");
    await gw.close();
  });

  it("a pinned renderer whose version is NOT declared public is a 404 to the stranger (rail b)", async () => {
    const gw = await staged();
    await gw.declarePublic(["Plant@v1"]); // declares v1 — but a v2-pin (were there one) stays dark
    // The v1 pin is declared and serves; declaring it does NOT open the bare latest route.
    expect((await gw.serveRoute("pinned", FERN, "public")).status).toBe(200);
    expect((await gw.serveRoute("latest", FERN, "public")).status).toBe(404); // bare name never declared
    await gw.close();
  });

  it("a bare Name declaration serves only the latest — the pinned route stays 404 anon (rail c)", async () => {
    const gw = await staged();
    await gw.declarePublic(["Plant"]); // bare: the latest, unchanged
    expect((await gw.serveRoute("latest", FERN, "public")).status).toBe(200);
    expect((await gw.serveRoute("pinned", FERN, "public")).status).toBe(404); // a bare declaration is not a pin
    await gw.close();
  });

  it("withdraw the declared version's registration → the anon pinned route 404s, uniform (rail d)", async () => {
    const gw = await staged();
    await gw.declarePublic(["Plant@v1"]);
    expect((await gw.serveRoute("pinned", FERN, "public")).status).toBe(200);
    const v1 = v1DeltaId(gw);
    await gw.append([signClaims(makeNegationClaims(OP, 9_000_000, v1, "withdraw v1"), OP_SEED)]);
    // The declaration still names Plant@<v1>, but the version is gone — so it 404s exactly like a never-
    // declared pin: no oracle distinguishes "withdrawn" from "never existed" to a stranger.
    expect((await gw.serveRoute("pinned", FERN, "public")).status).toBe(404);
    await gw.close();
  });

  it("the operator (full) door serves the pinned route regardless of declaration (rail e)", async () => {
    const gw = await staged();
    expect((await gw.serveRoute("pinned", FERN, "full")).status).toBe(200); // no declaration at all
    await gw.close();
  });
});

describe("§23.8: the declare path freezes the pin and guards its authority", () => {
  it("Name@v1 is frozen to the version's content address at declare time", async () => {
    const gw = await staged();
    await gw.declarePublic(["Plant@v1"]);
    expect(gw.isPublicPin("Plant", v1DeltaId(gw))).toBe(true);
    expect(gw.isPublicLatest("Plant")).toBe(false); // a pin is not a bare-latest declaration
    await gw.close();
  });

  it("a Name@vN that names no surviving version is refused at declare time", async () => {
    const gw = await staged();
    await expect(gw.declarePublic(["Plant@v9"])).rejects.toThrow(/no version v9/);
    await gw.close();
  });

  it("a non-operator may not declare a lens public", async () => {
    const gw = await staged();
    await expect(gw.declarePublic(["Plant@v1"], { actor: ALT_SEED })).rejects.toThrow(
      /only the operator/,
    );
    await gw.close();
  });
});

describe("§23.8: the REST public @<deltaId> door serves a declared pin, symmetric to the route", () => {
  const restGet = (gw: Gateway, seg: string) =>
    handleRest(gw, "public", "GET", [seg, "Plant", FERN], undefined, undefined, undefined);

  it("a declared pinned version answers at /rest/@<deltaId> on the public door", async () => {
    const gw = await staged();
    const v1 = v1DeltaId(gw);
    expect((await restGet(gw, `@${v1}`)).status).toBe(404); // not declared yet
    await gw.declarePublic(["Plant@v1"]);
    expect((await restGet(gw, `@${v1}`)).status).toBe(200); // declared → served
    await gw.close();
  });

  it("an UNdeclared @<deltaId> stays a uniform 404 to the stranger (history un-probable)", async () => {
    const gw = await staged();
    const versions = gw.registrationVersions().filter((v) => v.hyperschema.name === "Plant");
    const v2 = versions[1]!.deltaId;
    await gw.declarePublic(["Plant@v1"]); // declares v1 only
    expect((await restGet(gw, `@${v2}`)).status).toBe(404); // v2 pin never declared
    await gw.close();
  });
});
