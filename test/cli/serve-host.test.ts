// T103(b) — `loam serve --host`: ServeOptions.host existed and the CLI hardcoded the default, so
// a LAN-reachable store (the phone case) could not be served by the CLI at all. This rail proves
// the BIND, not the flag parse: it connects through one address that a 127.0.0.1 socket provably
// refuses and an 0.0.0.0 socket provably answers, so a single probe holds both sides.
//
// The probe address is platform-dependent, and the difference is real rather than cosmetic. Linux
// routes all of 127.0.0.0/8 to loopback, so 127.0.0.2 is reachable there with no LAN interface
// required. Darwin puts a single `inet 127.0.0.1` on lo0 and routes nothing else in that range, so
// 127.0.0.2 is not refused there — it does not exist, and a connection to it hangs until the
// client's own timeout. Probing it on Darwin proves nothing in either direction: the refusal test
// passes vacuously on the timeout, and the wide-bind test cannot pass at all.
//
// What this rail deliberately does NOT cover: a non-Linux host holding no non-loopback IPv4. There
// no address distinguishes the two binds, so both bind tests skip. They do not fall back to a
// 127.0.0.1 check — both binds answer that, so such a test would pass with `--host` deleted
// entirely. An honest skip is a visible hole; a probe that cannot fail is a hidden one.

import { mkdtempSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";

vi.setConfig({ testTimeout: 15000 }); // real listening servers

// An address the loopback bind refuses and the wide bind answers. See the header for why the
// answer differs by platform; `undefined` means this host offers no such address.
function probeAddress(): string | undefined {
  if (process.platform === "linux") return "127.0.0.2";
  for (const addrs of Object.values(networkInterfaces()))
    for (const addr of addrs ?? [])
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
  return undefined;
}

const probe = probeAddress();

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
  it.skipIf(probe === undefined)(
    `the default stays loopback-only: ${probe ?? "the probe address"} is refused`,
    async () => {
      const server = await serveDetached([]);
      const port = new URL(server.url).port;
      // The control first — the port is real and answering on the bound address...
      expect((await askTypename(`http://127.0.0.1:${port}`)).status).toBe(200);
      // ...and refused on the probe, because the socket holds 127.0.0.1 alone.
      await expect(askTypename(`http://${probe}:${port}`)).rejects.toThrow();
      await server.close();
    },
  );

  it.skipIf(probe === undefined)(
    "--host 0.0.0.0 answers a connection the default bind refuses",
    async () => {
      const server = await serveDetached(["--host", "0.0.0.0"]);
      const port = new URL(server.url).port;
      const res = await askTypename(`http://${probe}:${port}`);
      expect(res.status).toBe(200);
      // The wide bind serves the same world, not a different one: byte-for-byte the answer the
      // loopback address gives.
      expect(await res.text()).toBe(await (await askTypename(`http://127.0.0.1:${port}`)).text());
      await server.close();
    },
  );

  it("the manual names the flag", async () => {
    expect(await run(["serve", "--help"], io())).toBe(0);
    expect(out.join("\n")).toContain("--host");
  });
});
