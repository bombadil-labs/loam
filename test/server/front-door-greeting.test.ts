// T104 — the words on the front door, and the header they ride in on.
//
// test/server/front-door.test.ts (frozen) pins the greeting's SHAPE: one constant body, blind to
// mounts, tokens and public declarations, enumerating nothing. This file rails the CONTENT that
// arrived after it froze, at both levels:
//
//   * object level — what a browser at `/` actually receives: a page that says what Loam is,
//     names `/login` as the human door (a fixed path, not store knowledge), and carries
//     `Referrer-Policy: same-origin`, the house policy for documents this store serves
//     (test/server/referrer-policy.test.ts bans the no-referrer combination outright);
//   * delta level — the greeting's bytes across the ONE axis the frozen file could not know
//     about: whether the operator configured human accounts. A greeting that varied on `users`
//     would be an oracle for "this store has people"; it must be byte-identical either way.
//
// Deliberately not asserted here: constancy across mounts/tokens/declarations (frozen file owns
// it), the uniform-refusal discipline on mount paths (test/server/dynamic-mounts.test.ts), and
// the greeting's full bytes — the prose may be reworded without editing a rail. Only the two
// structural lines a browser needs (the doctype and the charset) are pinned below.

import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

vi.setConfig({ testTimeout: 15000 }); // real listening servers

import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { initHome } from "../../src/cli/config.js";

const OPERATOR_SEED = "4d".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };

const homes: string[] = [];
const handles: ServerHandle[] = [];
const gateways: Gateway[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (gateways.length > 0) await gateways.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

/** A store with no human accounts at all — the plainest server that can greet. */
async function bareStore(): Promise<string> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  gateways.push(gateway);
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  handles.push(handle);
  return handle.url;
}

/** The same store with the login doors open: a user, a role, credentials on disk. */
async function peopledStore(): Promise<string> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  gateways.push(gateway);
  let ts = 9001;
  await gateway.append([signClaims(userClaims("myk", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, ts++), OPERATOR_SEED)]);
  const home = mkdtempSync(join(tmpdir(), "loam-front-door-"));
  homes.push(home);
  initHome(home, OPERATOR_SEED);
  writeCredentials(home, {
    version: 1,
    users: { myk: await hashPassword("correct horse", CHEAP) },
  });
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return handle.url;
}

describe("T104 — the greeting's words and headers", () => {
  it("says what Loam is and names /login as the human door, with a real link", async () => {
    const base = await bareStore();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    // The two structural lines: a real document, declaring the charset its em-dashes need.
    expect(text.startsWith("<!doctype html>")).toBe(true);
    expect(text).toContain('<meta charset="utf-8">');
    // What Loam is: the three properties of the merge, in the page's own words.
    expect(text).toMatch(/delta/i);
    expect(text).toMatch(/union/i);
    expect(text).toMatch(/order-blind, idempotent, conflict-free/);
    // The human door is a working link, not a mention — a browser can click it.
    expect(text).toContain('<a href="/login">');
    expect(text).toMatch(/sign in/i);
  });

  it("sends Referrer-Policy: same-origin — the document policy, not the JSON refusals' no-referrer", async () => {
    const base = await bareStore();
    const res = await fetch(`${base}/`);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
  });

  it("is byte-identical whether or not accounts exist — naming /login reveals nothing about people", async () => {
    const bare = await bareStore();
    const peopled = await peopledStore();
    // First, prove the axis is live — the two stores genuinely differ at /login — so the
    // parity below compares two different worlds, not one server twice.
    const bareLogin = await fetch(`${bare}/login`);
    const peopledLogin = await fetch(`${peopled}/login`);
    expect(bareLogin.status).toBe(401);
    expect(peopledLogin.status).toBe(200);
    expect(peopledLogin.headers.get("content-type")).toContain("text/html");
    // Now the parity: the greeting itself must not see that difference.
    const bareAnswer = await fetch(`${bare}/`);
    const peopledAnswer = await fetch(`${peopled}/`);
    expect(bareAnswer.status).toBe(200);
    const bareText = await bareAnswer.text();
    expect(bareText).toContain("A Loam store serves here.");
    expect(await peopledAnswer.text()).toBe(bareText);
    // The header rides constant too — a policy that appeared only when /login was live would be
    // the same oracle in a different field.
    expect(peopledAnswer.headers.get("referrer-policy")).toBe(
      bareAnswer.headers.get("referrer-policy"),
    );
  });
});
