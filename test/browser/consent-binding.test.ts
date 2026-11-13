import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { holdsGrant } from "../../src/gateway/accounts.js";
import { inboxName } from "../../src/gateway/container-law.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { initHome, userSeedPath } from "../../src/cli/config.js";
import { readOAuthFile, writeOAuthFile, type OAuthClient } from "../../src/server/oauth-file.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { Browser, type Tab } from "./cdp.js";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const CLIENT_ID = "connector-fixed-0001";

const b64url = (buf: Buffer): string => buf.toString("base64url");
const VERIFIER = b64url(randomBytes(32));
const CHALLENGE = b64url(createHash("sha256").update(VERIFIER).digest());

let browser: Browser;
let handle: ServerHandle;
let gateway: Gateway;
let base: string;
let landing: Server;
let landingOrigin: string;
let home: string;
const landed: string[] = [];

beforeAll(async () => {
  landing = createServer((req, res) => {
    landed.push(req.url ?? "");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<title>landed</title>connector received the code");
  });
  await new Promise<void>((resolve) => landing.listen(0, "127.0.0.1", resolve));
  landingOrigin = `http://127.0.0.1:${(landing.address() as { port: number }).port}`;

  gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([signClaims(userClaims("ada", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("ada", "actor", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, undefined, undefined, [
    ...PLANT_WRITABLE,
  ]);

  home = mkdtempSync(join(tmpdir(), "loam-consent-story-"));
  initHome(home, OPERATOR_SEED);
  writeCredentials(home, { version: 1, users: { ada: await hashPassword(PASSWORD, CHEAP) } });
  const client: OAuthClient = {
    clientId: CLIENT_ID,
    clientName: "Example Connector",
    redirectUris: [`${landingOrigin}/cb`],
    registeredAt: 1,
    generation: 1,
  };
  writeOAuthFile(home, { version: 1, clients: [client], grants: [], tokens: [] });

  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const storePort = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: storePort,
    host: "127.0.0.1",
    publicUrl: `http://127.0.0.1:${storePort}`,
    users: { home, mount: "default" },
    connectors: { home, allowRedirectOrigins: [landingOrigin] },
  });
  base = handle.url;
  browser = await Browser.launch();
});

afterAll(async () => {
  await browser?.close();
  await handle?.close();
  await new Promise<void>((resolve) => landing.close(() => resolve()));
  rmSync(home, { recursive: true, force: true });
});

const fill = (tab: Tab, name: string, value: string): Promise<unknown> =>
  tab.eval(`document.querySelector('input[name="${name}"]').value = ${JSON.stringify(value)}`);
const submit = async (tab: Tab, action: string): Promise<void> => {
  const done = tab.loaded(`the navigation after submitting ${action}`);
  await tab.eval(`document.querySelector('form[action="${action}"]').submit()`);
  await done;
};
const bodyText = (tab: Tab): Promise<unknown> => tab.eval("document.body.textContent");

const heightDeltas = (gw: Gateway, height: number): Delta[] =>
  [...gw.reactor.snapshot()].filter(
    (d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === "height",
      ) &&
      d.claims.pointers.some(
        (p) => p.role === "value" && p.target.kind === "primitive" && p.target.value === height,
      ),
  );

const graphql = (token: string, query: string): Promise<Response> =>
  fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  });

describe("§58 S1 — the story, in a real browser", () => {
  it("ada, with no seed and no container, consents into ada:journal; the connector files a claim there", async () => {
    expect(existsSync(userSeedPath(home, "ada"))).toBe(false);
    expect(gateway.containers().containers.has("ada")).toBe(false);

    const tab = await browser.tab();
    await tab.navigate(`${base}/login`);
    await fill(tab, "user", "ada");
    await fill(tab, "password", PASSWORD);
    await submit(tab, "/login");
    expect(await bodyText(tab)).toContain("Signed in.");

    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: `${landingOrigin}/cb`,
      state: "st-58",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
    });
    await tab.navigate(`${base}/oauth/authorize?${query.toString()}`);
    const page = (await bodyText(tab)) as string;
    expect(page).toContain("Approve a connector?");
    await tab.eval('document.getElementById("bind_new").value = "journal"');
    await submit(tab, "/oauth/authorize");
    const where = (await tab.eval("location.href")) as string;
    expect(where.startsWith(`${landingOrigin}/cb`)).toBe(true);
    const code = new URL(where).searchParams.get("code");
    expect(code).toBeTruthy();
    tab.close();

    const table = gateway.containers().containers;
    expect(table.get("ada")?.parent).toBeUndefined();
    expect(table.get("ada:journal")?.parent).toBe("ada");
    expect(existsSync(userSeedPath(home, "ada"))).toBe(true);

    const redeemed = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        client_id: CLIENT_ID,
        redirect_uri: `${landingOrigin}/cb`,
        code_verifier: VERIFIER,
      }).toString(),
    });
    expect(redeemed.status).toBe(200);
    const token = ((await redeemed.json()) as { access_token: string }).access_token;
    const grant = readOAuthFile(home).grants[0]!;
    const inbox = inboxName("ada:journal", grant.actor);
    expect(grant).toMatchObject({ user: "ada", container: "ada:journal", inbox, standing: true });

    const wrote = await graphql(
      token,
      `mutation { plant(entity: "${FERN}", height: 58) { height } }`,
    );
    expect(wrote.status).toBe(200);
    expect(
      ((await wrote.json()) as { data: { plant: { height: number } } }).data.plant.height,
    ).toBe(58);
    const pool = gateway.connectionInboxes.get(inbox)!.gateway!;
    expect(heightDeltas(pool, 58).map((d) => d.claims.author)).toEqual([grant.actor]);
    expect(heightDeltas(gateway, 58)).toEqual([]);
    expect(gateway.connectionScope({ bound: "ada:journal" }).map((d) => d.id)).toContain(
      heightDeltas(pool, 58)[0]!.id,
    );
    const read = await graphql(token, `{ plant(entity: "${FERN}") { height } }`);
    expect(((await read.json()) as { data: { plant: { height: number } } }).data.plant.height).toBe(
      58,
    );
    expect(
      holdsGrant(
        gateway.reactor,
        gateway.validityNow(),
        STORE_ENTITY,
        grant.actor,
        "write",
        OPERATOR,
      ),
    ).toBe(false);
    const who = (await (
      await fetch(`${base}/default/whoami`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { kind: string; write: boolean; binding?: { container: string } };
    expect(who).toMatchObject({
      kind: "connector",
      write: true,
      binding: { container: "ada:journal" },
    });
    expect(landed.some((u) => u.includes("code="))).toBe(true);
  });
});
