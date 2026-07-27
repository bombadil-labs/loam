// T103(b) — `loam serve --host`: ServeOptions.host existed and the CLI hardcoded the default, so
// a LAN-reachable store (the phone case) could not be served by the CLI at all. This rail proves
// the BIND, not the flag parse: it connects through 127.0.0.2 — an address inside the loopback
// range that a 127.0.0.1 socket provably refuses (both CI platforms answer all of 127/8) — so the
// same test holds both sides without depending on the machine having a LAN interface.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";

vi.setConfig({ testTimeout: 15000 }); // real listening servers

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-host-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
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

const askTypename = (origin: string): Promise<Response> =>
  fetch(`${origin}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer tok" },
    body: JSON.stringify({ query: "{ __typename }" }),
  });

describe("T103(b) — loam serve --host widens the bind on purpose, and only on purpose", () => {
  it("the default stays loopback-only: 127.0.0.2 is refused", async () => {
    const server = await serveDetached([]);
    const port = new URL(server.url).port;
    // The control first — the port is real and answering on the bound address...
    expect((await askTypename(`http://127.0.0.1:${port}`)).status).toBe(200);
    // ...and refused one address over, because the socket holds 127.0.0.1 alone.
    await expect(askTypename(`http://127.0.0.2:${port}`)).rejects.toThrow();
    await server.close();
  });

  it("--host 0.0.0.0 answers a connection the default bind refuses", async () => {
    const server = await serveDetached(["--host", "0.0.0.0"]);
    const port = new URL(server.url).port;
    const res = await askTypename(`http://127.0.0.2:${port}`);
    expect(res.status).toBe(200);
    // The wide bind serves the same world, not a different one: byte-for-byte the answer the
    // loopback address gives.
    expect(await res.text()).toBe(await (await askTypename(`http://127.0.0.1:${port}`)).text());
    await server.close();
  });

  it("the manual names the flag", async () => {
    expect(await run(["serve", "--help"], io())).toBe(0);
    expect(out.join("\n")).toContain("--host");
  });
});
