import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";

vi.setConfig({ testTimeout: 20_000 });

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-oauth-register-cli-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const PUBLIC_URL = "https://loam.example:9443";

async function serveDetached(
  extra: readonly string[],
): Promise<{ url: string; close(): Promise<void> }> {
  const handle = await run(
    ["serve", "--http", "--home", home, "--port", "0", "--token", "tok", ...extra],
    io(),
    { detach: true },
  );
  if (typeof handle === "number") throw new Error("serve should return a running handle");
  return handle;
}

const registerAt = (base: string, redirectUri: string): Promise<Response> =>
  fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirectUri] }),
  });

describe("T134 — loam serve --oauth-allow-redirect", () => {
  it("the manual names the flag, its argument, and what it opens", async () => {
    expect(await run(["serve", "--help"], io())).toBe(0);
    const help = out.join("\n");
    expect(help).toContain("--oauth-allow-redirect <origins>");
    expect(help).toContain("§37");
  });

  it("absent: POST /oauth/register is an unrouted path, exactly as before this ticket", async () => {
    const server = await serveDetached(["--public-url", PUBLIC_URL]);
    const reg = await registerAt(server.url, `${PUBLIC_URL}/cb`);
    const unmounted = await fetch(`${server.url}/nowhere-at-all`, { method: "POST" });
    expect(reg.status).toBe(unmounted.status);
    await server.close();
  });

  it("configured: an allowlisted redirect registers; an off-allowlist one is refused", async () => {
    const server = await serveDetached([
      "--public-url",
      PUBLIC_URL,
      "--oauth-allow-redirect",
      "https://claude.ai, https://example.test",
    ]);
    const ok = await registerAt(server.url, "https://example.test/deep/cb");
    expect(ok.status).toBe(201);
    expect((await ok.json()) as { client_id: string }).toHaveProperty("client_id");
    const claude = await registerAt(server.url, "https://claude.ai/cb");
    expect(claude.status).toBe(201);
    const evil = await registerAt(server.url, "https://attacker.example/cb");
    expect(evil.status).toBe(400);
    await server.close();
  });

  it("--oauth-allow-redirect with no --public-url refuses at boot", async () => {
    const code = await run(
      [
        "serve",
        "--http",
        "--home",
        home,
        "--port",
        "0",
        "--token",
        "tok",
        "--oauth-allow-redirect",
        "https://claude.ai",
      ],
      io(),
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/public-url/i);
  });

  it("a malformed allowlist origin refuses at boot rather than refusing every registration", async () => {
    const code = await run(
      [
        "serve",
        "--http",
        "--home",
        home,
        "--port",
        "0",
        "--token",
        "tok",
        "--public-url",
        PUBLIC_URL,
        "--oauth-allow-redirect",
        "https://claude.ai:443",
      ],
      io(),
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/oauth-allow-redirect|origin/i);
  });
});
