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
import { containerClaims } from "../../src/gateway/container-law.js";
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

const STRUCK_HEIGHT = 3131;
const BYSTANDER_TAG = "evergreen-bystander";

const READS_NOTHING = "This lens reads nothing here";

const authoredBy = (key: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: key } },
  in: "input",
});

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
      validFrom: timestamp,
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
  await op(roleClaims("ada", "operator", OPERATOR, ts++));
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
  it("(8) registering is CONSTITUTIONAL: an actor session is refused, an operator session is not", async () => {
    const { base, gateway } = await schemaServer();
    const bea = await signIn(base, "bea");
    const page = await (await getPage(base, bea)).text();
    const before = readRegistrations(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    ).length;

    const refused = await register(base, bea, tokenOf(page), JSON.stringify(plantRegistration()));
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain("operator role");
    expect(
      readRegistrations(gateway.reactor, gateway.validityNow(), gateway.operatorAuthor).length,
    ).toBe(before);

    const ada = await signIn(base, "ada");
    const adaPage = await (await getPage(base, ada)).text();
    const ok = await register(base, ada, tokenOf(adaPage), JSON.stringify(plantRegistration()));
    expect(ok.status).toBe(303);
    expect(
      readRegistrations(gateway.reactor, gateway.validityNow(), gateway.operatorAuthor).length,
    ).toBe(before + 1);
  });

  it("(8) the register form lands the same body as `loam register`; the panel lists it; the sibling door still works", async () => {
    const { base, gateway } = await schemaServer();
    const ada = await signIn(base, "ada");
    const before = await (await getPage(base, ada)).text();
    expect(before).toContain("No lens is registered on this store yet");

    const token = tokenOf(before);
    const ok = await register(base, ada, token, JSON.stringify(plantRegistration()));
    expect(ok.status).toBe(303);
    const regs = readRegistrations(gateway.reactor, gateway.validityNow(), gateway.operatorAuthor);
    expect(regs.map((r) => r.hyperschema.name)).toContain("Plant");

    const after = await (await getPage(base, ada)).text();
    expect(after).toContain("Plant");
    expect(after).toContain(FERN);
    expect(after).not.toContain("No lens is registered on this store yet");

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

    const HOSTILE = '{"hyperschema": <script>alert(1)</script>';
    const notJson = await register(base, ada, token, HOSTILE);
    expect(notJson.status).toBe(400);
    const notJsonBody = await notJson.text();
    expect(notJsonBody).toContain("not valid JSON");
    expect(notJsonBody).not.toContain("<script");
    expect(notJsonBody).not.toContain("alert(1)");

    const partial = { ...(plantRegistration() as Record<string, unknown>) };
    delete partial["schema"];
    const noSchema = await register(base, ada, token, JSON.stringify(partial));
    expect(noSchema.status).toBe(400);
    expect(await noSchema.text()).toContain("schema");

    const forged = await register(base, ada, "not-the-token", JSON.stringify(plantRegistration()));
    expect(forged.status).toBe(403);
    expect(
      readRegistrations(gateway.reactor, gateway.validityNow(), gateway.operatorAuthor),
    ).toHaveLength(0);
    const honest = await register(base, ada, token, JSON.stringify(plantRegistration()));
    expect(honest.status).toBe(303);
    expect(
      readRegistrations(gateway.reactor, gateway.validityNow(), gateway.operatorAuthor),
    ).toHaveLength(1);
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
    expect(html).not.toContain(String(STRUCK_HEIGHT));
    expect(html).toContain(BYSTANDER_TAG);
    expect(html).not.toContain(READS_NOTHING);
    expect(html).toContain("raw member");
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
    const own = await getView(base, ada, { container: "ada" });
    expect(own.status).toBe(200);
  });
});
