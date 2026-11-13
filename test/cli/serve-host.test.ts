import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";

const secondLoopbackIsLocal = await new Promise<boolean>((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(false));
  probe.listen(0, "127.0.0.2", () => probe.close(() => resolve(true)));
});

const NEEDS = "needs 127.0.0.2 local — Linux only";

vi.setConfig({ testTimeout: 20_000 });

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
  it.skipIf(!secondLoopbackIsLocal)(
    `the default stays loopback-only: 127.0.0.2 is refused (${NEEDS})`,
    async () => {
      const server = await serveDetached([]);
      const port = new URL(server.url).port;
      expect((await askTypename(`http://127.0.0.1:${port}`)).status).toBe(200);
      await expect(askTypename(`http://127.0.0.2:${port}`)).rejects.toThrow();
      await server.close();
    },
  );

  it.skipIf(!secondLoopbackIsLocal)(
    `--host 0.0.0.0 answers a connection the default bind refuses (${NEEDS})`,
    async () => {
      const server = await serveDetached(["--host", "0.0.0.0"]);
      const port = new URL(server.url).port;
      const res = await askTypename(`http://127.0.0.2:${port}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(await (await askTypename(`http://127.0.0.1:${port}`)).text());
      await server.close();
    },
  );

  it("the manual names the flag", async () => {
    expect(await run(["serve", "--help"], io())).toBe(0);
    expect(out.join("\n")).toContain("--host");
  });
});
