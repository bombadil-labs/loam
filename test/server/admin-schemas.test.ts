// §40 phase A3 — schemas and data through the admin page (T141). Criteria (8)–(9) of
// .adlc/specs/40-admin-page.md, transcribed. `POST /admin/register` takes the SAME JSON body as
// `loam register`, operator-signed by the server behind the session + form token; `GET /admin/view`
// resolves a container's gather through a registered lens beside the raw member count.
//
// Criterion 9 is asserted at BOTH levels on one fixture: the members list (delta level) shows a
// struck member's strike — the §39.4 gather includes negations — and the view page (object level)
// resolves WITHOUT the struck value while a live bystander field resolves. The honest-empty copy is
// two-sided: asserted present where the lens reads nothing, asserted ABSENT where data resolves.
//
// What this file deliberately does NOT assert, and which rail closes each gap:
//   - The door itself (login, CSP, peek, subtree GETs) — phase A1 (`admin-door.test.ts`).
//   - The container lifecycle POSTs — phase A2 (`admin-containers.test.ts`).
//   - publishRegistration's own law (evolution, withdrawal) — the §21 gateway rails.
//
// Erasure standing rule: every store here is this file's own memory/mkdtemp fixture.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorForSeed,
  schemaToJson,
  signClaims,
  termToJson,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { readRegistrations } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { containerClaims } from "../../src/gateway/container.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

const SEEDS = { ada: "aa".repeat(32), bea: "bb".repeat(32) } as const;
const KEYS = { ada: authorForSeed(SEEDS.ada), bea: authorForSeed(SEEDS.bea) } as const;
const UNUSED_KEY = authorForSeed("cc".repeat(32));

// Distinctive values: the struck height (must NOT appear in the resolved view) and the live
// bystander tag (must appear) can never collide with an id or a count by accident.
const STRUCK_HEIGHT = 3131;
const BYSTANDER_TAG = "evergreen-bystander";

// The one honest-empty sentence the view page speaks; both sides of criterion 9 pin it.
const READS_NOTHING = "This lens reads nothing here";

/** The membership shape §40 fixes — the same author-select Term §39's inboxes use. */
const authoredBy = (key: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: key } },
  in: "input",
});

/** The SAME JSON body `loam register` takes, built from the shared Plant fixture. */
const plantRegistration = (): unknown => ({
  hyperschema: { name: "Plant", alg: 1, body: termToJson(PLANT.body) },
  schema: schemaToJson(PLANT_POLICY),
  roots: [FERN],
  writable: [...PLANT_WRITABLE],
});

const strikeOf = (targetId: string, seed: string, timestamp: number): Delta =>
  signClaims(
    {
      timestamp,
      author: authorForSeed(seed),
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
    },
    seed,
  );

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

/**
 * A store with two rooted users. Ada's root gathers what she authors: a height claim (struck — the
 * §39.4 fixture), its strike, and a live tag claim (the bystander). `ada:empty` is a shared child
 * whose membership selects a key that authored nothing — the honest-empty fixture.
 */
async function schemaServer(): Promise<{
  base: string;
  gateway: Gateway;
  height: Delta;
  strike: Delta;
}> {
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
      { container: "bea", trust: "curated", posture: "shared", membership: authoredBy(KEYS.bea) },
      OPERATOR,
      ts++,
    ),
  );
  await op(
    containerClaims(
      {
        container: "ada:empty",
        trust: "curated",
        posture: "shared",
        parent: "ada",
        membership: authoredBy(UNUSED_KEY),
      },
      OPERATOR,
      ts++,
    ),
  );
  await op(grantClaims(STORE_ENTITY, KEYS.ada, "write", OPERATOR, ts++));

  const height = observed(FERN, "height", STRUCK_HEIGHT, ts++, SEEDS.ada);
  const tag = observed(FERN, "tag", BYSTANDER_TAG, ts++, SEEDS.ada);
  await gateway.append([height, tag]);
  const strike = strikeOf(height.id, SEEDS.ada, ts++);
  await gateway.append([strike]);

  const home = mkdtempSync(join(tmpdir(), "loam-admin-a3-"));
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
  return { base: handle.url, gateway, height, strike };
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

const getView = (
  base: string,
  sessionId: string,
  params: Record<string, string>,
): Promise<Response> =>
  getPage(base, sessionId, `/admin/view?${new URLSearchParams(params).toString()}`);

const post = (
  base: string,
  path: string,
  sessionId: string,
  fields: Record<string, string>,
  headers: Record<string, string> = { ...SAME_ORIGIN },
): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${sessionId}`,
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });

const tokenOf = (html: string): string => /name="form_token" value="([^"]+)"/.exec(html)![1]!;

const register = (
  base: string,
  sessionId: string,
  token: string,
  registration: string,
): Promise<Response> =>
  post(base, "/admin/register", sessionId, { form_token: token, registration });

describe("§40 phase A3 — the schema panel", () => {
  it("(8) the register form lands the same body as `loam register`; the panel lists it; the sibling door still works", async () => {
    const { base, gateway } = await schemaServer();
    const ada = await signIn(base, "ada");
    const before = await (await getPage(base, ada)).text();
    expect(before).toContain("No lens is registered on this store yet");

    const token = tokenOf(before);
    const ok = await register(base, ada, token, JSON.stringify(plantRegistration()));
    expect(ok.status).toBe(303);
    const regs = readRegistrations(gateway.reactor, gateway.operatorAuthor);
    expect(regs.map((r) => r.hyperschema.name)).toContain("Plant");

    // The panel lists the lens with its roots, and the honest-empty line is gone.
    const after = await (await getPage(base, ada)).text();
    expect(after).toContain("Plant");
    expect(after).toContain(FERN);
    expect(after).not.toContain("No lens is registered on this store yet");

    // No regression on the sibling door: the SAME body through POST /:mount/register still lands
    // (a republish at the same entity is evolution, not a conflict).
    const sibling = await fetch(`${base}/default/register`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: JSON.stringify(plantRegistration()),
    });
    expect(sibling.status).toBe(200);
    expect(((await sibling.json()) as { registered: string }).registered).toBe("Plant");
  });

  it("(8) a malformed body refuses naming the defect, script inert, and a forged token registers nothing", async () => {
    const { base, gateway } = await schemaServer();
    const ada = await signIn(base, "ada");
    const token = tokenOf(await (await getPage(base, ada)).text());

    // Bad JSON carrying a script: the defect is named, the hostile bytes never ride back.
    const HOSTILE = '{"hyperschema": <script>alert(1)</script>';
    const notJson = await register(base, ada, token, HOSTILE);
    expect(notJson.status).toBe(400);
    const notJsonBody = await notJson.text();
    expect(notJsonBody).toContain("not valid JSON");
    expect(notJsonBody).not.toContain("<script");
    expect(notJsonBody).not.toContain("alert(1)");

    // Missing schema: the parser names the missing piece in plain English.
    const partial = { ...(plantRegistration() as Record<string, unknown>) };
    delete partial["schema"];
    const noSchema = await register(base, ada, token, JSON.stringify(partial));
    expect(noSchema.status).toBe(400);
    expect(await noSchema.text()).toContain("schema");

    // Forged token: nothing lands. Positive control beside it: the honest token does.
    const forged = await register(base, ada, "not-the-token", JSON.stringify(plantRegistration()));
    expect(forged.status).toBe(403);
    expect(readRegistrations(gateway.reactor, gateway.operatorAuthor)).toHaveLength(0);
    const honest = await register(base, ada, token, JSON.stringify(plantRegistration()));
    expect(honest.status).toBe(303);
    expect(readRegistrations(gateway.reactor, gateway.operatorAuthor)).toHaveLength(1);
  });
});

describe("§40 phase A3 — the resolved view, both levels on one fixture", () => {
  it("(9) delta level: the members list shows the struck member AND its strike (§39.4)", async () => {
    const { base, height, strike } = await schemaServer();
    const ada = await signIn(base, "ada");
    const detail = await (await getPage(base, ada, "/admin/container?name=ada")).text();
    expect(detail).toContain(height.id);
    expect(detail).toContain(strike.id);
  });

  it("(9) object level: the view resolves WITHOUT the struck value while the bystander resolves", async () => {
    const { base, gateway } = await schemaServer();
    const ada = await signIn(base, "ada");
    const token = tokenOf(await (await getPage(base, ada)).text());
    expect((await register(base, ada, token, JSON.stringify(plantRegistration()))).status).toBe(
      303,
    );

    const res = await getView(base, ada, { container: "ada", lens: "Plant", entity: FERN });
    expect(res.status).toBe(200);
    const html = await res.text();
    // The struck height does not resolve; the live bystander does; the honest-empty copy is
    // ABSENT here — data resolved, and the page must not speak the empty sentence over it.
    expect(html).not.toContain(String(STRUCK_HEIGHT));
    expect(html).toContain(BYSTANDER_TAG);
    expect(html).not.toContain(READS_NOTHING);
    // The raw members ride beside the view: the count names the whole gather, strike included.
    expect(html).toContain("raw member");
    // The scratch resolution leaves the primary ground exactly as it was.
    expect(gateway.containerScope({ containers: ["ada"] }).length).toBeGreaterThan(0);
  });

  it("(9) a lens over a container it does not read says so in words — never a bare empty table", async () => {
    const { base } = await schemaServer();
    const ada = await signIn(base, "ada");
    const token = tokenOf(await (await getPage(base, ada)).text());
    expect((await register(base, ada, token, JSON.stringify(plantRegistration()))).status).toBe(
      303,
    );

    const res = await getView(base, ada, { container: "ada:empty", lens: "Plant", entity: FERN });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(READS_NOTHING);
  });

  it("the view is subtree-gated: another user's container and an absent one get ONE uniform 403", async () => {
    const { base } = await schemaServer();
    const ada = await signIn(base, "ada");
    const foreign = await getView(base, ada, { container: "bea", lens: "Plant", entity: FERN });
    const absent = await getView(base, ada, {
      container: "utterly-absent",
      lens: "Plant",
      entity: FERN,
    });
    expect(foreign.status).toBe(403);
    expect(absent.status).toBe(403);
    expect(await foreign.text()).toBe(await absent.text());
    // Positive control: her own container answers 200 (the lens picker, since none is named).
    const own = await getView(base, ada, { container: "ada" });
    expect(own.status).toBe(200);
  });
});
