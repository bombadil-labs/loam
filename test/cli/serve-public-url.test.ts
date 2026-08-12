// T133 — `loam serve --public-url`: opens §37 discovery (the two well-known documents, and the
// MCP door's WWW-Authenticate challenge) when configured, and refuses a malformed one at boot
// rather than silently guessing an address from the request. `test/server/oauth-discovery.test.ts`
// proves the DOOR behavior directly against `serve()`; this file proves the CLI actually threads
// the flag there, mirroring `serve-host.test.ts`'s precedent for a plumbing-only flag.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";

vi.setConfig({ testTimeout: 20_000 }); // real listening servers

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-public-url-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  // This rmSync is a RAIL, not just hygiene: a refused serve must release the store it already
  // opened, and on Windows a leaked sqlite handle turns this removal into EPERM. POSIX cannot see
  // the leak (unlink succeeds past an open handle), so windows-latest CI is the only place this
  // asserts. Do not wrap it in try/catch or move the home somewhere shared — either change
  // silently deletes the only red the refusal path has.
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

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

describe("T133 — loam serve --public-url", () => {
  it("the manual names the flag, its argument, and what it opens", async () => {
    expect(await run(["serve", "--help"], io())).toBe(0);
    const help = out.join("\n");
    expect(help).toContain("--public-url <url>");
    expect(help).toContain("§37");
  });

  it("absent: no discovery door, no MCP challenge — unchanged from before this ticket", async () => {
    const server = await serveDetached([]);
    const resource = await fetch(`${server.url}/.well-known/oauth-protected-resource`);
    const mcp = await fetch(`${server.url}/default/mcp`, { method: "POST" });
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("www-authenticate")).toBeNull();
    expect(resource.status).toBe(mcp.status); // the well-known path is just another unmounted name
    await server.close();
  });

  it("configured: the well-known document answers, and the MCP door's 401 carries the challenge", async () => {
    const server = await serveDetached(["--public-url", "https://loam.example:9443"]);
    const doc = await fetch(`${server.url}/.well-known/oauth-protected-resource`);
    expect(doc.status).toBe(200);
    expect((await doc.json()) as { resource: string }).toMatchObject({
      resource: "https://loam.example:9443",
    });
    const mcp = await fetch(`${server.url}/default/mcp`, { method: "POST" });
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://loam.example:9443/.well-known/oauth-protected-resource"',
    );
    await server.close();
  });

  it("a malformed --public-url refuses at boot rather than guessing", async () => {
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
        "https://loam.example/store",
      ],
      io(),
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/public-url.*origin/i);
  });
});
