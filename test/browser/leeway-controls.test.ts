// T263 — THE FIVE CONTROLS, DRIVEN BY A REAL BROWSER (SPEC §58 position 4, criterion 4). Chrome
// over CDP, because two of the promises in that position are not strings a server test can read:
// that Delegate's terms UNFOLD BENEATH IT WHEN ON, and that a person who checks a box and submits
// gets a container that says what the box said.
//
// Chrome ABSENT is a FAILURE, not a skip — resolveChrome() throws, naming LOAM_CHROME. A skipped
// browser rail is how T143 shipped: every gate green and no person able to use the thing.
//
// The story: ada signs in, meets the five, sees Delegate's terms hidden until she turns Delegate
// on, turns Receive on and picks a bigger envelope, and creates her journal. Then she opens that
// container's own page, finds the same five reading what she chose, turns Receive back off, and
// saves. What the store holds after each act is read at the bytes, not at the page.

import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
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
import { initHome } from "../../src/cli/config.js";
import { LEEWAY_CONTROLS } from "../../src/gateway/leeway-copy.js";
import { writeOAuthFile, type OAuthClient } from "../../src/server/oauth-file.js";
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

  // ada has a password and NOTHING else: no seed on disk, no container in the store.
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

describe("§58 — the five controls, in a real browser", () => {
  it("ada meets the five, unfolds the terms, chooses, and changes her mind on the container's page", async () => {
    const tab = await browser.tab();
    await tab.navigate(`${base}/login`);
    await fill(tab, "user", "ada");
    await fill(tab, "password", PASSWORD);
    await submit(tab, "/login");
    expect(await bodyText(tab)).toContain("Signed in.");

    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: `${landingOrigin}/cb`,
      state: "st-controls",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
    });
    await tab.navigate(`${base}/oauth/authorize?${query.toString()}`);

    // The five are here, in the words the spec writes, where a person can read them without
    // hovering anything.
    const shown = (await bodyText(tab)) as string;
    for (const c of LEEWAY_CONTROLS) {
      expect(shown.replace(/\s+/g, " "), c.label).toContain(c.capability.replace(/\s+/g, " "));
    }

    // Every switch starts off, and the envelope starts small.
    for (const field of ["leeway_receive", "leeway_offer", "leeway_publish", "leeway_delegate"]) {
      expect(
        await tab.eval(`document.getElementById(${JSON.stringify(field)}).checked`),
        field,
      ).toBe(false);
    }
    expect(await tab.eval('document.getElementById("leeway_envelope").value')).toBe("small");

    // DELEGATE'S TERMS UNFOLD BENEATH IT WHEN ON — and are folded away until then. This is the
    // sentence no server test can read: it is a rule the browser applies, not a string.
    const termsDisplay = (): Promise<unknown> =>
      tab.eval('getComputedStyle(document.getElementById("delegate_terms")).display');
    expect(await termsDisplay(), "folded away while Delegate is off").toBe("none");
    await tab.eval('document.getElementById("leeway_delegate").click()');
    expect(await termsDisplay(), "unfolded when Delegate is on").not.toBe("none");
    // She thinks better of delegating, and the terms fold away again.
    await tab.eval('document.getElementById("leeway_delegate").click()');
    expect(await termsDisplay(), "folded away again").toBe("none");

    // She lets this container follow other stores, and gives it a little more room to run things.
    await tab.eval('document.getElementById("leeway_receive").click()');
    await tab.eval('document.getElementById("leeway_envelope").value = "medium"');
    await tab.eval('document.getElementById("bind_new").value = "journal"');
    await submit(tab, "/oauth/authorize");
    expect(((await tab.eval("location.href")) as string).startsWith(`${landingOrigin}/cb`)).toBe(
      true,
    );

    // What she checked is what her container declares, at the bytes.
    const declared = gateway.containers().containers.get("ada:journal");
    expect(declared?.leewayDeclared).toBe(true);
    expect(declared?.leeway).toEqual({
      receive: true,
      offer: false,
      publish: false,
      envelope: "medium",
      delegate: "off",
    });

    // The container's own page shows the same five, reading what she chose.
    await tab.navigate(`${base}/admin/container?name=${encodeURIComponent("ada:journal")}`);
    const onPage = (await bodyText(tab)) as string;
    for (const c of LEEWAY_CONTROLS) {
      expect(onPage.replace(/\s+/g, " "), c.label).toContain(c.capability.replace(/\s+/g, " "));
    }
    expect(await tab.eval('document.getElementById("leeway_receive").checked')).toBe(true);
    expect(await tab.eval('document.getElementById("leeway_envelope").value')).toBe("medium");

    // She changes her mind. A leeway is a declaration, so saving it is a delta the next request
    // obeys — and the page she lands back on says so.
    await tab.eval('document.getElementById("leeway_receive").click()');
    await submit(tab, "/admin/leeway");
    const after = gateway.containers().containers.get("ada:journal");
    expect(after?.leeway.receive, "off, at the bytes").toBe(false);
    expect(after?.leeway.envelope, "and the rest of her choice stands").toBe("medium");
    await tab.navigate(`${base}/admin/container?name=${encodeURIComponent("ada:journal")}`);
    expect(
      await tab.eval('document.getElementById("leeway_receive").checked'),
      "and on the page",
    ).toBe(false);
    tab.close();
  });
});
