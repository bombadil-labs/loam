import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { writeOAuthFile, type OAuthClient } from "../../src/server/oauth-file.js";
import { Browser, type Tab } from "./cdp.js";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ALICE_SEED = "a1".repeat(32);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const CLIENT_ID = "connector-fixed-0001";

const CODE_CHALLENGE = createHash("sha256")
  .update("a-verifier-of-sufficient-length-43chars-min")
  .digest("base64url");

let browser: Browser;
let handle: ServerHandle;
let gateway: Gateway;
let base: string;
let landing: Server;
let landingOrigin: string;
const landed: { url: string; referer: string | undefined }[] = [];
const homes: string[] = [];

beforeAll(async () => {
  landing = createServer((req, res) => {
    landed.push({ url: req.url ?? "", referer: req.headers.referer });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<title>landed</title>connector received the code");
  });
  await new Promise<void>((resolve) => landing.listen(0, "127.0.0.1", resolve));
  const port = (landing.address() as { port: number }).port;
  landingOrigin = `http://127.0.0.1:${port}`;

  gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  for (const [name, role] of [
    ["alice", "operator"],
    ["ada", "actor"],
  ] as const) {
    await gateway.append([signClaims(userClaims(name, OPERATOR, ts++), OPERATOR_SEED)]);
    await gateway.append([signClaims(roleClaims(name, role, OPERATOR, ts++), OPERATOR_SEED)]);
  }

  const home = mkdtempSync(join(tmpdir(), "loam-door-smoke-home-"));
  homes.push(home);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(home, { version: 1, users: { alice: hash, ada: hash } });
  writeUserSeed(home, "alice", ALICE_SEED);
  writeUserSeed(home, "ada", "ad".repeat(32));
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
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const fill = (tab: Tab, name: string, value: string): Promise<unknown> =>
  tab.eval(`document.querySelector('input[name="${name}"]').value = ${JSON.stringify(value)}`);

const submit = async (tab: Tab, action: string): Promise<void> => {
  const done = tab.loaded(`the navigation after submitting ${action}`);
  await tab.eval(`document.querySelector('form[action="${action}"]').submit()`);
  await done;
};

const bodyText = (tab: Tab): Promise<unknown> => tab.eval("document.body.textContent");

async function signIn(tab: Tab, user: string): Promise<void> {
  await tab.navigate(`${base}/login`);
  const alreadyIn = (await tab.eval(
    `document.querySelector('form[action="/logout"]') !== null`,
  )) as boolean;
  if (alreadyIn) {
    await submit(tab, "/logout");
    await tab.navigate(`${base}/login`);
  }
  await fill(tab, "user", user);
  await fill(tab, "password", PASSWORD);
  await submit(tab, "/login");
}

describe("T143 — the doors, driven by a real browser", () => {
  it("story 1: alice signs in through the real form, and signs out again", async () => {
    const tab = await browser.tab();
    await signIn(tab, "alice");
    const signedIn = await bodyText(tab);
    expect(signedIn).toContain("Signed in.");
    expect(signedIn).toContain("alice");
    expect(signedIn).toContain("operator");
    const cookies = (await tab.eval("document.cookie")) as string;
    void cookies;
    await submit(tab, "/logout");
    expect(await bodyText(tab)).toContain("Signed out.");
    tab.close();
  });

  it("story 2: alice approves a connector and lands on its registered redirect_uri with a code", async () => {
    const tab = await browser.tab();
    await signIn(tab, "alice");
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: `${landingOrigin}/cb`,
      state: "st-42",
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: "S256",
    });
    const authorize = `${base}/oauth/authorize?${query.toString()}`;
    await tab.navigate(authorize);
    expect(await bodyText(tab)).toContain("Approve a connector?");
    await tab.eval('document.getElementById("bind_new").value = "journal"');
    await submit(tab, "/oauth/authorize");
    const where = (await tab.eval("location.href")) as string;
    expect(where.startsWith(`${landingOrigin}/cb`)).toBe(true);
    expect(where).toContain("code=");
    expect(where).toContain("state=st-42");
    expect(gateway.containers().containers.get("alice:journal")?.parent).toBe("alice");
    expect(landed.length).toBeGreaterThan(0);
    for (const hit of landed) {
      if (hit.referer === undefined) continue;
      const parsed = new URL(hit.referer);
      if (parsed.origin === new URL(base).origin) {
        expect(parsed.pathname).toBe("/");
        expect(parsed.search).toBe("");
      } else {
        expect(parsed.origin).toBe(landingOrigin);
        expect(parsed.search).not.toContain("code_challenge");
      }
    }
    tab.close();
  });

  it("story 3: ada submits the admin create-root form and the container is really declared", async () => {
    const before = gateway.containers().containers.size;
    const tab = await browser.tab();
    await signIn(tab, "ada");
    await tab.navigate(`${base}/admin`);
    expect(await bodyText(tab)).toContain("ada");
    await submit(tab, "/admin/create-root");
    const after = gateway.containers().containers.size;
    expect(after).toBe(before + 1);
    expect(await bodyText(tab)).not.toContain("create");
    tab.close();
  });
});
