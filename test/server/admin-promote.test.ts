// §40 phase A4 — promotion and federation through the admin page (T141). Criteria (10)–(11) of
// .adlc/specs/40-admin-page.md, transcribed. `POST /admin/promote` drives `gw.promote` — T33's
// promote-outputs, never a reimplementation — from a subtree container into the primary ground;
// `POST /admin/federate` lands a pasted offer (the body of `GET /federate`) into one subtree
// container, admission intact: a SEPARATE container takes it through its pool's own door, a SHARED
// one through the primary's door with its membership deciding the gather after.
//
// Criterion 11 is asserted at BOTH levels on one fixture: the admitted delta is in the container's
// gather (delta level) and resolves through a lens (object level); the refused one never enters the
// container's world. The result page's two numbers — what LANDED and what the container GATHERS —
// are pinned as the true ones.
//
// What this file deliberately does NOT assert, and which rail closes each gap:
//   - The door itself (login, CSP, peek) — phase A1 (`admin-door.test.ts`).
//   - promote's own law (refusing law-shapes, dangling cites, idempotence) — the §24.3 rails
//     (`test/gateway/promotion.test.ts`); this file proves the page DRIVES that door, not that
//     the door is sound.
//   - The URL-pull path — the page is paste-only by design; `loam pull` owns the network leg.
//
// Erasure standing rule: every store here is this file's own memory/mkdtemp fixture.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, type Claims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { toWire } from "../../src/federation/wire.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { containerClaims } from "../../src/gateway/container.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { signClaims } from "@bombadil/rhizomatic";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

const SEEDS = { ada: "aa".repeat(32), bea: "bb".repeat(32), stranger: "cd".repeat(32) } as const;
const KEYS = { ada: authorForSeed(SEEDS.ada) } as const;

// Distinctive values: the admitted tag (must enter ada's world) and the refused height (must not)
// can never collide with an id or a count by accident.
const ADA_TAG = "ada-landed-tag";
const STRANGER_HEIGHT = 4242;

/** The membership shape §40 fixes — the same author-select Term §39's inboxes use. */
const authoredBy = (key: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: key } },
  in: "input",
});

/** The exact bytes `GET /federate` serves — what the paste form takes. */
const offerOf = (...deltas: Delta[]): string =>
  JSON.stringify({ deltas: deltas.map((d) => toWire(d)) });

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

/**
 * A store with two users. Ada's root `ada` is a shared container gathering what she authors;
 * `ada:lab` is a SEPARATE child, declared and ATTACHED — its own store, seeded once at the attach.
 * The offer deltas exist only as bytes in each test's paste until a door lands them.
 */
async function promoteServer(): Promise<{ base: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  for (const name of ["ada", "bea"] as const) {
    await op(userClaims(name, OPERATOR, ts++));
    await op(roleClaims(name, "actor", OPERATOR, ts++));
  }
  await op(
    containerClaims(
      { container: "ada", trust: "curated", posture: "shared", membership: authoredBy(KEYS.ada) },
      OPERATOR,
      ts++,
    ),
  );
  await op(
    containerClaims(
      { container: "ada:lab", trust: "curated", posture: "separate", parent: "ada" },
      OPERATOR,
      ts++,
    ),
  );
  await gateway.openContainer({ name: "ada:lab" });

  const home = mkdtempSync(join(tmpdir(), "loam-admin-a4-"));
  homes.push(home);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(home, { version: 1, users: { ada: hash, bea: hash } });
  writeUserSeed(home, "ada", SEEDS.ada);
  writeUserSeed(home, "bea", SEEDS.bea);

  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return { base: handle.url, gateway };
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

/** Sign in over the REAL login doors; returns the session cookie value. */
async function signIn(base: string, user: string): Promise<string> {
  const form = await fetch(`${base}/login`, { redirect: "manual" });
  const nonceCookie = cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!;
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())![1]!;
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${PRESESSION_COOKIE}=${valueOf(nonceCookie)}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ form_token: token, user, password: PASSWORD }).toString(),
  });
  const sessionCookie = cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
  return valueOf(sessionCookie);
}

const getPage = (base: string, sessionId: string, path = "/admin"): Promise<Response> =>
  fetch(`${base}${path}`, {
    redirect: "manual",
    headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
  });

const post = (
  base: string,
  path: string,
  sessionId: string,
  fields: Record<string, string>,
): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${sessionId}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams(fields).toString(),
  });

const tokenOf = (html: string): string => /name="form_token" value="([^"]+)"/.exec(html)![1]!;

const federate = (
  base: string,
  sessionId: string,
  token: string,
  name: string,
  offer: string,
): Promise<Response> =>
  post(base, "/admin/federate", sessionId, { form_token: token, name, offer });

const promote = (
  base: string,
  sessionId: string,
  token: string,
  name: string,
  delta: string,
): Promise<Response> => post(base, "/admin/promote", sessionId, { form_token: token, name, delta });

/** A signed-in ada with her dashboard's form token. */
async function adaSession(base: string): Promise<{ ada: string; token: string }> {
  const ada = await signIn(base, "ada");
  const token = tokenOf(await (await getPage(base, ada)).text());
  return { ada, token };
}

describe("§40 phase A4 — federate in (criterion 11)", () => {
  it("(11) a tenant cannot seed ANOTHER user's container through their own federate form", async () => {
    // The attack the bound exists to stop: ada pastes an offer of deltas that BEA's membership
    // selects, targeting her own container (where the subtree gate passes trivially). Landing them
    // in the shared primary would put them inside bea's world without bea ever admitting them.
    const { base, gateway } = await promoteServer();
    const { ada, token } = await adaSession(base);
    const forBea = observed(FERN, "tag", "meant-for-bea", 9600, SEEDS.bea);

    const res = await federate(base, ada, token, "ada", offerOf(forBea));
    expect(res.status).toBe(200);

    // It never landed in the primary at all, so no container cutting that ground can gather it —
    // the store-level fact, which is stronger than checking one container's view.
    expect(gateway.reactor.get(forBea.id)).toBeUndefined();
    expect(gateway.containerScope({ containers: ["ada"] }).map((d) => d.id)).not.toContain(
      forBea.id,
    );
    // Positive control: ada's OWN delta, through the same form, does land and does gather.
    const mine = observed(FERN, "tag", ADA_TAG, 9601, SEEDS.ada);
    const ok = await federate(base, ada, token, "ada", offerOf(mine));
    expect(ok.status).toBe(200);
    expect(gateway.reactor.get(mine.id)).toBeDefined();
    expect(gateway.containerScope({ containers: ["ada"] }).map((d) => d.id)).toContain(mine.id);
  });

  it("(11) shared: the offer lands in the primary, the membership gathers only its own — two numbers, both levels", async () => {
    const { base, gateway } = await promoteServer();
    const { ada, token } = await adaSession(base);
    const adaTag = observed(FERN, "tag", ADA_TAG, 9500, SEEDS.ada);
    const height = observed(FERN, "height", STRANGER_HEIGHT, 9501, SEEDS.stranger);

    const res = await federate(base, ada, token, "ada", offerOf(adaTag, height));
    expect(res.status).toBe(200);
    const html = await res.text();
    // The two numbers, both true: what LANDED and what the membership GATHERS.
    expect(html).toContain("1 landed newly");
    expect(html).toContain("gathers 1 of the 2 offered");

    // Delta level, and the SECURITY property: a shared container has no store of its own, so this
    // write goes to the primary ground — the ground every other user's containers also cut. The
    // door therefore bounds it to what THIS container's membership selects. ada's own delta lands;
    // the stranger-authored one the membership refuses never enters the store at all. Without that
    // bound, any tenant could seed the primary with deltas another user's Term happens to select.
    expect(gateway.reactor.get(adaTag.id)).toBeDefined();
    expect(gateway.reactor.get(height.id)).toBeUndefined();
    const gathered = gateway.containerScope({ containers: ["ada"] }).map((d) => d.id);
    expect(gathered).toContain(adaTag.id);
    expect(gathered).not.toContain(height.id);

    // Object level: through a registered lens, the container's view resolves ada's value and
    // never the refused one — it did not enter this container's world.
    await gateway.publishRegistration(
      PLANT,
      PLANT_POLICY,
      [FERN],
      undefined,
      undefined,
      undefined,
      [...PLANT_WRITABLE],
    );
    const view = await getPage(
      base,
      ada,
      `/admin/view?container=ada&lens=Plant&entity=${encodeURIComponent(FERN)}`,
    );
    const viewHtml = await view.text();
    expect(viewHtml).toContain(ADA_TAG);
    expect(viewHtml).not.toContain(String(STRANGER_HEIGHT));
  });

  it("(11) separate: the offer lands through the container's own door — in its store, not the primary", async () => {
    const { base, gateway } = await promoteServer();
    const { ada, token } = await adaSession(base);
    const adaTag = observed(FERN, "tag", ADA_TAG, 9500, SEEDS.ada);

    const res = await federate(base, ada, token, "ada:lab", offerOf(adaTag));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("1 landed newly");
    expect(html).toContain("gathers 1 of the 1 offered");
    expect(html).toContain("its own store");

    // The container's own world took it; the primary ground did not.
    const pool = gateway.attachedContainers.get("ada:lab")!;
    expect(pool.reactor.get(adaTag.id)).toBeDefined();
    expect(gateway.reactor.get(adaTag.id)).toBeUndefined();

    // The detail page now shows the member with its promote form — the delta is somewhere to
    // move FROM, so the form is offered.
    const detail = await (await getPage(base, ada, "/admin/container?name=ada:lab")).text();
    expect(detail).toContain(adaTag.id);
    expect(detail).toContain('action="/admin/promote"');
  });

  it("(11) a malformed offer refuses naming the defect, escaped, and lands nothing", async () => {
    const { base, gateway } = await promoteServer();
    const { ada, token } = await adaSession(base);

    // Not JSON, carrying a script: the defect is named, the hostile bytes never ride back.
    const notJson = await federate(base, ada, token, "ada", '{"deltas": <script>alert(1)</script>');
    expect(notJson.status).toBe(400);
    const notJsonBody = await notJson.text();
    expect(notJsonBody).toContain("not JSON");
    expect(notJsonBody).not.toContain("<script");
    expect(notJsonBody).not.toContain("alert(1)");

    // A wire delta whose claims do not recompute to its claimed id: refused whole, the forged
    // id escaped on its way into the refusal.
    const adaTag = observed(FERN, "tag", ADA_TAG, 9500, SEEDS.ada);
    const forgedWire = JSON.stringify({
      deltas: [{ ...toWire(adaTag), id: "<script>alert(1)</script>" }],
    });
    const forged = await federate(base, ada, token, "ada", forgedWire);
    expect(forged.status).toBe(400);
    const forgedBody = await forged.text();
    expect(forgedBody).toContain("does not recompute");
    expect(forgedBody).not.toContain("<script>");
    expect(gateway.reactor.get(adaTag.id)).toBeUndefined();
  });

  it("(11) a forged token and a foreign container land nothing — one uniform 403 each, positive control beside", async () => {
    const { base, gateway } = await promoteServer();
    const { ada, token } = await adaSession(base);
    const adaTag = observed(FERN, "tag", ADA_TAG, 9500, SEEDS.ada);

    const forged = await federate(base, ada, "not-the-token", "ada", offerOf(adaTag));
    expect(forged.status).toBe(403);
    expect(gateway.reactor.get(adaTag.id)).toBeUndefined();

    // Bea addressing ada's container: the one uniform refusal, nothing landed.
    const bea = await signIn(base, "bea");
    const beaToken = tokenOf(await (await getPage(base, bea)).text());
    const foreign = await federate(base, bea, beaToken, "ada", offerOf(adaTag));
    expect(foreign.status).toBe(403);
    expect(await foreign.text()).toContain("not yours to see");
    expect(gateway.reactor.get(adaTag.id)).toBeUndefined();

    // Positive control: the honest token, the owner's own container.
    const honest = await federate(base, ada, token, "ada", offerOf(adaTag));
    expect(honest.status).toBe(200);
    expect(gateway.reactor.get(adaTag.id)).toBeDefined();
  });
});

describe("§40 phase A4 — promote (criterion 10)", () => {
  it("(10) promote drives gw.promote: the output re-speaks in the primary and resolves there; the trail names the container", async () => {
    const { base, gateway } = await promoteServer();
    const { ada, token } = await adaSession(base);
    const adaTag = observed(FERN, "tag", ADA_TAG, 9500, SEEDS.ada);
    expect((await federate(base, ada, token, "ada:lab", offerOf(adaTag))).status).toBe(200);

    const res = await promote(base, ada, token, "ada:lab", adaTag.id);
    expect(res.status).toBe(200);
    const html = await res.text();

    // Delta level: the operator's re-spoken claim stands in the primary, and the provenance
    // trail names WHAT was adopted and WHERE it came from. The page shows the adopted id.
    const trail = gateway.adoptions().filter((a) => a.sourceDelta === adaTag.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.from).toBe("ada:lab");
    const adopted = gateway.reactor.get(trail[0]!.adoptedDelta);
    expect(adopted).toBeDefined();
    expect(adopted!.claims.author).toBe(OPERATOR);
    expect(html).toContain(trail[0]!.adoptedDelta);

    // Object level: the primary read resolves what promote's contract promises — the value
    // stands in the primary ground, in the operator's voice, through a registered lens.
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const read = await gateway.query(`{ plant(entity: "${FERN}") { tag } }`);
    // `tag` resolves under an `all` policy — the operator's re-spoken value is its one entry.
    expect((read.data as { plant?: { tag?: unknown } } | undefined)?.plant?.tag).toEqual([ADA_TAG]);
  });

  it("(10) a foreign container is one uniform 403; a delta outside the gather refuses without confirming it exists elsewhere", async () => {
    const { base, gateway } = await promoteServer();
    const { ada, token } = await adaSession(base);
    const adaTag = observed(FERN, "tag", ADA_TAG, 9500, SEEDS.ada);
    expect((await federate(base, ada, token, "ada:lab", offerOf(adaTag))).status).toBe(200);

    // Bea addressing ada's container: uniform refusal, no adoption made.
    const bea = await signIn(base, "bea");
    const beaToken = tokenOf(await (await getPage(base, bea)).text());
    const foreign = await promote(base, bea, beaToken, "ada:lab", adaTag.id);
    expect(foreign.status).toBe(403);
    expect(await foreign.text()).toContain("not yours to see");
    expect(gateway.adoptions()).toHaveLength(0);

    // A delta that EXISTS in the primary but is not in this container's gather, and a delta
    // that exists nowhere: the SAME refusal body — existence elsewhere is confirmed neither way.
    const height = observed(FERN, "height", STRANGER_HEIGHT, 9501, SEEDS.stranger);
    await gateway.federate([height]); // in the primary; the lab was seeded before it landed
    const elsewhere = await promote(base, ada, token, "ada:lab", height.id);
    const nowhere = await promote(base, ada, token, "ada:lab", "no-such-delta");
    expect(elsewhere.status).toBe(404);
    expect(nowhere.status).toBe(404);
    expect(await elsewhere.text()).toBe(await nowhere.text());
    expect(gateway.adoptions()).toHaveLength(0);

    // Positive control beside the refusals: the member itself promotes.
    const honest = await promote(base, ada, token, "ada:lab", adaTag.id);
    expect(honest.status).toBe(200);
    expect(gateway.adoptions().some((a) => a.sourceDelta === adaTag.id)).toBe(true);
  });

  it("(10) a delta already living in the primary ground refuses honestly — promotion has nothing to move", async () => {
    const { base, gateway } = await promoteServer();
    const { ada, token } = await adaSession(base);
    // Land ada's delta in the PRIMARY; the shared container gathers it in place.
    const adaTag = observed(FERN, "tag", ADA_TAG, 9500, SEEDS.ada);
    expect((await federate(base, ada, token, "ada", offerOf(adaTag))).status).toBe(200);

    const res = await promote(base, ada, token, "ada", adaTag.id);
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("already lives in the primary ground");
    expect(gateway.adoptions()).toHaveLength(0);
  });
});
