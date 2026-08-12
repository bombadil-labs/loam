// T103(b) — `loam serve --host`: ServeOptions.host existed and the CLI hardcoded the default, so
// a LAN-reachable store (the phone case) could not be served by the CLI at all. This rail proves
// the BIND, not the flag parse: it connects through 127.0.0.2 — an address inside the loopback
// range that a 127.0.0.1 socket provably refuses — so the same test holds both sides without
// depending on the machine having a LAN interface.
//
// That trick needs the whole 127.0.0.0/8 block to reach this host, and that is a PLATFORM
// property: Linux routes the block, macOS aliases only 127.0.0.1 on lo0. Where it does not hold,
// the two address-dependent tests SKIP rather than weaken their assertion — `skipIf`, the same
// shape the win32 holes elsewhere in this suite use.
//
// THE HOLE, STATED: on such a machine nothing here checks that --host widens the bind. CI is Linux
// and proves it. Both tests skip, not just the wide one — an unroutable 127.0.0.2 makes the
// default-bind test vacuous too, since it would then pass on a connect timeout instead of on the
// refusal it claims to observe. To close the hole locally: `sudo ifconfig lo0 alias 127.0.0.2 up`.

import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";

// Bindability is the exact question: an address the kernel refuses a listen on is an address no
// packet of ours reaches either. It answers in microseconds, where a connect probe would have to
// spend the same 10s timeout the failure did.
const secondLoopbackIsLocal = await new Promise<boolean>((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(false));
  probe.listen(0, "127.0.0.2", () => probe.close(() => resolve(true)));
});

// Named so the two titles below can say WHY they vanished. The reporter prints a skipped title and
// nothing else, so the title is the whole message a reader gets.
const NEEDS = "needs 127.0.0.2 local — Linux only";

vi.setConfig({ testTimeout: 20_000 }); // real listening servers

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
      // The control first — the port is real and answering on the bound address...
      expect((await askTypename(`http://127.0.0.1:${port}`)).status).toBe(200);
      // ...and refused one address over, because the socket holds 127.0.0.1 alone.
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
