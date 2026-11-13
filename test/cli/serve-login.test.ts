import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";
import { hashPassword, writeCredentials } from "../../src/server/credentials.js";

vi.setConfig({ testTimeout: 20_000 });

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-serve-login-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function writeUsers(): Promise<void> {
  writeCredentials(home, {
    version: 1,
    users: { myk: await hashPassword("pw", { N: 1024, r: 8, p: 1, keylen: 32 }) },
  });
}

async function serveDetached(
  extra: readonly string[] = [],
): Promise<{ url: string; close(): Promise<void> }> {
  const handle = await run(
    ["serve", "--http", "--home", home, "--port", "0", "--token", "tok", ...extra],
    io(),
    { detach: true },
  );
  if (typeof handle === "number") {
    throw new Error(`serve refused (${handle}): ${err.join("\n")}`);
  }
  return handle;
}

describe("T126 — loam serve and the login doors", () => {
  it("(m) a home with credentials.json opens the doors; one without does not; a late write waits for the next serve", async () => {
    const bare = await serveDetached();
    const loginBefore = await fetch(`${bare.url}/login`);
    const other = await fetch(`${bare.url}/zzz`);
    expect(loginBefore.status).toBe(other.status);
    expect(await loginBefore.text()).toBe(await other.text());

    await writeUsers();
    const still = await fetch(`${bare.url}/login`);
    expect(still.status).toBe(other.status);
    await bare.close();

    const opened = await serveDetached();
    const login = await fetch(`${opened.url}/login`);
    expect(login.status).toBe(200);
    expect(await login.text()).toContain("form_token");
    await opened.close();
  });

  it("(t) a non-loopback bind over plain HTTP refuses to open the doors, by name", async () => {
    await writeUsers();
    const code = await run(
      ["serve", "--http", "--home", home, "--port", "0", "--token", "tok", "--host", "0.0.0.0"],
      io(),
    );
    expect(code).toBe(2);
    const said = err.join("\n");
    expect(said).toMatch(/login/i);
    expect(said).toMatch(/https|TLS/i);
    expect(said).toMatch(/--public-url|loopback/i);

    const proxied = await serveDetached([
      "--host",
      "0.0.0.0",
      "--public-url",
      "https://loam.example",
    ]);
    expect((await fetch(`${proxied.url}/login`)).status).toBe(200);
    await proxied.close();
    const local = await serveDetached();
    expect((await fetch(`${local.url}/login`)).status).toBe(200);
    await local.close();
  });

  it("(t2) the refusal keys on the credentials, not on the bind: a users-less wide bind still boots", async () => {
    const wide = await serveDetached(["--host", "0.0.0.0"]);
    expect((await fetch(`${wide.url.replace("0.0.0.0", "127.0.0.1")}/zzz`)).status).toBeGreaterThan(
      0,
    );
    await wide.close();
  });
});
