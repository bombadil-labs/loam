// T103(b) — `loam serve --host`: ServeOptions.host existed and the CLI hardcoded the default, so
// a LAN-reachable store (the phone case) could not be served by the CLI at all. This rail proves
// the BIND, not the flag parse. It needs a SECOND address the host genuinely holds: the narrow
// bind must REFUSE there (ECONNREFUSED — the address exists, the socket just does not cover it)
// and the wide bind must ANSWER there. An address the host does not have refuses for the wrong
// reason, which would let the narrow half pass even against a wide-open bind.
//
// The address is probed, not assumed, because platforms differ: Linux and Windows carry loopback
// aliases so 127.0.0.2 binds, while macOS puts only 127.0.0.1 on lo0. Loopback aliases are tried
// FIRST and a real interface is the fallback, so CI stays on loopback — traffic no host firewall
// filters, and no port briefly exposed on the runner's network. On CI that is ASSERTED, not
// assumed: a runner that fell through to an interface would still pass every other line here.
//
// Three mutants this pair catches, each verified by hand:
//   default widened to 0.0.0.0        → the narrow test's refusal assertion fails
//   default widened to a LAN address  → the narrow test's 127.0.0.1 CONTROL fails
//   the --host flag ignored           → the wide test gets no answer on the second address
// The control on the loopback line is load-bearing, not decoration; it carries the second mutant
// on its own.
//
// Two gaps, named rather than papered over:
//   Only `--host 0.0.0.0` is exercised. A bind that special-cased the wildcard and ignored every
//   other value would survive. The wildcard is the flag's point, so the cheaper rail is the honest
//   one — but the hole is real.
//   The CI guard reads process.env.CI. A runner that does not set it skips the bind tests, and no
//   assertion can see that, because the guard reads the same signal it would need to check.
//
// Known red, not flaky: a host firewall that DROPS instead of refusing turns the narrow test's
// ECONNREFUSED into a timeout, and blocks the wide test's answer. Only a host that falls back to a
// real interface can hit this — macOS, never CI. It is a persistent host setting and an honest
// failure. Accepting a timeout would restore the wrong-reason pass, so the assertion stays strict.

import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";

vi.setConfig({ testTimeout: 15000 }); // real listening servers

/** True when this host will accept a listening socket on `address` — i.e. the address is its own. */
const hostHolds = (address: string): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.on("error", () => resolve(false));
    probe.listen(0, address, () => probe.close(() => resolve(true)));
  });

/** An address this host holds besides 127.0.0.1 — somewhere the narrow bind must refuse. */
async function secondAddress(): Promise<string | undefined> {
  const candidates = [
    "127.0.0.2", // the loopback alias Linux and Windows carry; absent on macOS
    ...Object.values(networkInterfaces())
      .flatMap((addrs) => addrs ?? [])
      .filter((a) => a.family === "IPv4" && !a.internal)
      .map((a) => a.address),
  ];
  for (const address of candidates) if (await hostHolds(address)) return address;
  return undefined;
}

const second = await secondAddress();

/** CI=false is a real convention; treating it as truthy would fail the guard on a dev machine. */
const onCI = !!process.env.CI && process.env.CI !== "false" && process.env.CI !== "0";

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

/** Every error undici nests under a fetch failure, flattened to the codes we can assert on. */
const causeCodes = (e: unknown): string[] => {
  const seen: string[] = [];
  for (let cur: unknown = e; cur instanceof Error; cur = cur.cause) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") seen.push(code);
    if (cur instanceof AggregateError)
      for (const inner of cur.errors) seen.push(...causeCodes(inner));
  }
  return seen;
};

describe("T103(b) — loam serve --host widens the bind on purpose, and only on purpose", () => {
  it.runIf(onCI)("CI holds a loopback alias, so neither bind test may skip", () => {
    // An empty probe here means the probe broke, and the skip below would retire this rail on the
    // platform that gates merges — leaving `--host` covered by a help-string match alone.
    expect(second, "the probe found no second address on a CI runner").toBeDefined();
    // And on a platform that carries loopback aliases it must BE one. Falling through to a real
    // interface still passes every other line here, while opening a port on the runner's network.
    // Scoped by platform so that CI=1 on a mac — which has no alias to find — is not a false red.
    if (process.platform === "linux" || process.platform === "win32")
      expect(second, "CI fell off loopback; a port would open on the runner network").toMatch(
        /^127\./,
      );
  });

  it.skipIf(!second)(`the default stays loopback-only: ${second} is refused`, async () => {
    const server = await serveDetached([]);
    try {
      const port = new URL(server.url).port;
      // The control — the port is real and answering on the bound address. This also fails when
      // the default is widened to a SPECIFIC address, which no longer accepts on loopback.
      expect((await askTypename(`http://127.0.0.1:${port}`)).status).toBe(200);
      // ...and refused on an address this host DOES hold, because the socket holds 127.0.0.1
      // alone. The code matters: a refusal proves a narrow bind, a timeout proves nothing.
      const refusal = await askTypename(`http://${second}:${port}`).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(
        refusal,
        `the default bind answered on ${second}; it must hold 127.0.0.1 alone`,
      ).toBeDefined();
      expect(causeCodes(refusal), `${second} rejected, but not by refusing`).toContain(
        "ECONNREFUSED",
      );
    } finally {
      await server.close();
    }
  });

  it.skipIf(!second)(`--host 0.0.0.0 answers on ${second}, which the default refuses`, async () => {
    const server = await serveDetached(["--host", "0.0.0.0"]);
    try {
      const port = new URL(server.url).port;
      const res = await askTypename(`http://${second}:${port}`);
      expect(res.status, `--host 0.0.0.0 did not answer on ${second}`).toBe(200);
      // Same mounts, same token, same answer — the wide bind adds reach, not a second world.
      expect(await res.text()).toBe(await (await askTypename(`http://127.0.0.1:${port}`)).text());
    } finally {
      await server.close();
    }
  });

  it("the manual names the flag", async () => {
    expect(await run(["serve", "--help"], io())).toBe(0);
    expect(out.join("\n")).toContain("--host");
  });
});
