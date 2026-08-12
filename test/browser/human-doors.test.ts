// T146 — the human journey, in real Chrome. door-smoke.test.ts (frozen) proved a person can get
// IN when everything goes right; this file proves a person who gets something WRONG is never
// stranded on a bare JSON document, and that the pages link each other into a walk:
//
//   story A — a wrong password lands the browser on the sign-in page again, refusal stated,
//             the typed user still in the field; retyping only the password signs in.
//   story B — the link-walk: signed-in page → /admin by its own link → sign out by the admin
//             page's own form → the signed-out page.
//
// Chrome ABSENT is a FAILURE, not a skip (cdp.ts's rule) — a skipped browser rail is how T143
// shipped. This is a NEW file beside the frozen one; it imports the driver and edits nothing.

import { createServer } from "node:http";
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
import { Browser, type Tab } from "./cdp.js";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

let browser: Browser;
let handle: ServerHandle;
let base: string;
const homes: string[] = [];

beforeAll(async () => {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([signClaims(userClaims("alice", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([
    signClaims(roleClaims("alice", "operator", OPERATOR, ts++), OPERATOR_SEED),
  ]);
  const home = mkdtempSync(join(tmpdir(), "loam-human-doors-home-"));
  homes.push(home);
  writeCredentials(home, { version: 1, users: { alice: await hashPassword(PASSWORD, CHEAP) } });

  // The browser sends a REAL Origin, so ownOrigins — derived from publicUrl — must name the
  // address Chrome actually uses (door-smoke's probe pattern: reserve a port, then bind it).
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
  });
  base = handle.url;
  browser = await Browser.launch();
});

afterAll(async () => {
  await browser?.close();
  await handle?.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const fill = (tab: Tab, name: string, value: string): Promise<unknown> =>
  tab.eval(`document.querySelector('input[name="${name}"]').value = ${JSON.stringify(value)}`);

/** Submit the page's form whose action matches, and wait for the navigation it causes. */
const submit = async (tab: Tab, action: string): Promise<void> => {
  const done = tab.loaded(`the navigation after submitting ${action}`);
  await tab.eval(`document.querySelector('form[action="${action}"]').submit()`);
  await done;
};

const bodyText = (tab: Tab): Promise<unknown> => tab.eval("document.body.textContent");

describe("T146 — a person who gets it wrong is never stranded", () => {
  it("story A: alice mistypes her password, stays on a usable page, and retypes ONLY the password", async () => {
    const tab = await browser.tab();
    await tab.navigate(`${base}/login`);
    await fill(tab, "user", "alice");
    await fill(tab, "password", "not it");
    await submit(tab, "/login");
    // A page, not a JSON document: the refusal is stated, the form is standing, and the user
    // field still says alice — the person retypes one field, not two.
    const refusedText = await bodyText(tab);
    expect(refusedText).toContain("the login was refused");
    const formStands = await tab.eval(`document.querySelector('form[action="/login"]') !== null`);
    expect(formStands).toBe(true);
    const kept = await tab.eval(`document.querySelector('input[name="user"]').value`);
    expect(kept).toBe("alice");
    await fill(tab, "password", PASSWORD);
    await submit(tab, "/login");
    expect(await bodyText(tab)).toContain("Signed in.");
    tab.close();
  });

  it("story B: the link-walk — signed-in names /admin, and the admin page's own form signs out", async () => {
    const tab = await browser.tab();
    await tab.navigate(`${base}/login`);
    // Story A may have left a session in the shared cookie jar; the signed-in page is fine
    // either way — reach it, then walk.
    const signedIn = await tab.eval(`document.querySelector('form[action="/logout"]') !== null`);
    if (!signedIn) {
      await fill(tab, "user", "alice");
      await fill(tab, "password", PASSWORD);
      await submit(tab, "/login");
    }
    expect(await bodyText(tab)).toContain("Signed in.");
    // The signed-in page names /admin — follow ITS link, no typed URL.
    const link = tab.loaded("the navigation into /admin");
    await tab.eval(`document.querySelector('a[href="/admin"]').click()`);
    await link;
    expect((await tab.eval("location.pathname")) as string).toBe("/admin");
    // The admin page carries the sign-out form — use IT, and land signed out.
    await submit(tab, "/logout");
    expect(await bodyText(tab)).toContain("Signed out.");
    tab.close();
  });
});
