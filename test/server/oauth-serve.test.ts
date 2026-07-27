// §37 (T114), criteria (g) (l): the path from `loam serve` to the fence, and the two boot refusals.
//
// This file exists because every other §37 rail hands `allowRedirectOrigins` straight to `serve()`,
// which leaves the whole CLI half untested — and the CLI half is where the fence is assembled. Two
// bugs would have been invisible without it:
//
//   - `--oauth-allow-redirect` is REPEATABLE, and the parser's `flags` map keeps only the last value.
//     Reading `flags` instead of `repeated` would silently narrow the operator's fence to one entry.
//   - the https rule lives only in `redirectOriginDefect`, which nothing but boot called. A rail that
//     never boots through the CLI cannot see it disappear.
//
// It also pins the two refusals that are pure functions of the options, and that they happen BEFORE
// the socket binds — a throw after `listen` leaves a caller that catches it holding a live listener
// with the mounts served and no login or connector doors.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { readSeed, storePath } from "../../src/cli/config.js";
import { run } from "../../src/cli/cli.js";
import {
  PASSWORD,
  bootStore,
  createUser,
  dropHome,
  makeHome,
  testIo,
  type TestIo,
} from "./user-fixture.js";
import { readOAuthFile } from "../../src/server/oauth-file.js";
import { CLAUDE_ORIGIN, OTHER_ORIGIN, register } from "./oauth-fixture.js";

vi.setConfig({ testTimeout: 30000 });

let home: string;
let handle: ServerHandle | undefined;

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
});
afterEach(async () => {
  await handle?.close();
  handle = undefined;
  dropHome(home);
});

/** `loam serve --http` in this process, detached, so a rail can dial the doors it opened. */
async function cmdServe(
  args: readonly string[],
): Promise<{ handle: ServerHandle; io: TestIo } | { code: number; io: TestIo }> {
  const io = testIo();
  const outcome = await run(
    ["serve", "--http", "--token", "op-token", "--port", "0", "--home", home, ...args],
    io.io,
    { detach: true },
  );
  if (typeof outcome === "number") return { code: outcome, io };
  handle = outcome;
  return { handle: outcome, io };
}

describe("loam serve --oauth-allow-redirect", () => {
  it("(g) the flag is REPEATABLE: every named origin is in the fence, not just the last", async () => {
    // The whole bug this rail exists for. `parseArgs` keeps one value per flag name in `flags`, so a
    // command reading that map would narrow a two-origin fence to one — and the connector registered
    // at the FIRST origin would be refused with no sign that the operator had ever named it.
    const served = await cmdServe([
      "--oauth-allow-redirect",
      CLAUDE_ORIGIN,
      "--oauth-allow-redirect",
      OTHER_ORIGIN,
    ]);
    expect("handle" in served).toBe(true);
    const base = (served as { handle: ServerHandle }).handle.url;

    for (const origin of [CLAUDE_ORIGIN, OTHER_ORIGIN]) {
      const res = await register(base, { redirectUris: [`${origin}/cb`] });
      expect(res.status, `${origin} was not in the fence`).toBe(201);
    }
    const outside = await register(base, { redirectUris: ["https://attacker.example/cb"] });
    expect(outside.status).toBe(400);
    expect(readOAuthFile(home).clients.length).toBe(2);
  });

  it("(g) a single origin still works, and the log says which origins were named", async () => {
    const served = await cmdServe(["--oauth-allow-redirect", CLAUDE_ORIGIN]);
    const { handle: live, io } = served as { handle: ServerHandle; io: TestIo };
    expect(io.out.join("\n")).toContain(CLAUDE_ORIGIN);
    expect((await register(live.url, { redirectUris: [`${CLAUDE_ORIGIN}/cb`] })).status).toBe(201);
    expect((await register(live.url, { redirectUris: [`${OTHER_ORIGIN}/cb`] })).status).toBe(400);
  });

  it("(g) without the flag, §37 is closed: no documents, no challenge, no registration", async () => {
    // The store this repo served before §37, unchanged. A rail that only ever boots WITH the flag
    // cannot tell an opt-in from a default.
    const served = await cmdServe([]);
    const base = (served as { handle: ServerHandle }).handle.url;
    expect((await fetch(`${base}/.well-known/oauth-authorization-server`)).status).toBe(401);
    expect((await fetch(`${base}/oauth/register`, { method: "POST", body: "{}" })).status).toBe(
      401,
    );
    const refused = await fetch(`${base}/default/mcp`, { method: "POST", body: "{}" });
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toBeNull();
    // and the login doors are still open, so this is §37 off rather than §36 broken
    expect((await fetch(`${base}/login`)).status).toBe(200);
  });

  it("(g) a redirect origin that is not https, and not loopback, refuses the BOOT", async () => {
    // The https rule. It lived only here, and nothing called it from a rail — so deleting the boot
    // check left `--oauth-allow-redirect http://claude.ai` admitting a plaintext redirect target with
    // nothing anywhere saying so. Now it is checked at boot AND per registration.
    for (const bad of [
      "http://claude.ai",
      "https://claude.ai/",
      "https://claude.ai/path",
      "claude.ai",
      "not a url",
      "ftp://claude.ai",
    ]) {
      const served = await cmdServe(["--oauth-allow-redirect", bad]);
      // A bad flag VALUE is a usage error, like a bad --port: exit 2, and the reason on stderr. It must
      // not reach the caller as a thrown stack — and it must not start a server either.
      expect("code" in served, `${bad} started a server`).toBe(true);
      expect((served as { code: number }).code, bad).toBe(2);
      expect((served as { io: TestIo }).io.err.join("\n"), bad).toMatch(/--oauth-allow-redirect/);
    }
    // http IS permitted for a loopback host — a local connector during development.
    const served = await cmdServe(["--oauth-allow-redirect", "http://127.0.0.1:9999"]);
    expect("handle" in served).toBe(true);
  });

  it("(g) the per-registration check enforces the scheme rule too", async () => {
    // Membership in the allowlist is not a licence. Asserted through `serve()` directly, because the
    // CLI cannot pass a list boot would reject — which is exactly why the door needs its own check.
    const gateway = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: readSeed(home) }),
    );
    try {
      // A caller of the library may hand `serve` a list boot vetted; this asserts the door re-tests it.
      handle = await serve({
        mounts: { default: gateway },
        tokens: { "op-token": { operator: true } },
        port: 0,
        host: "127.0.0.1",
        users: { home, mount: "default" },
        oauth: { home, allowRedirectOrigins: [CLAUDE_ORIGIN] },
      });
      // The origin IS allowlisted; the uri's own scheme is what the door must still refuse.
      const downgraded = await register(handle.url, { redirectUris: ["http://claude.ai/cb"] });
      expect(downgraded.status).toBe(400);
      const honest = await register(handle.url, { redirectUris: [`${CLAUDE_ORIGIN}/cb`] });
      expect(honest.status).toBe(201);
    } finally {
      await handle?.close();
      handle = undefined;
      await gateway.close();
    }
  });
});

describe("the connector doors ride the login doors", () => {
  it("(l) the CLI refuses --oauth-allow-redirect on a home with no users", async () => {
    const bare = makeHome();
    try {
      await bootStore(bare);
      const io = testIo();
      const code = await run(
        [
          "serve",
          "--http",
          "--token",
          "op-token",
          "--port",
          "0",
          "--home",
          bare,
          "--oauth-allow-redirect",
          CLAUDE_ORIGIN,
        ],
        io.io,
        { detach: true },
      );
      expect(code).toBe(2);
      expect(io.err.join("\n")).toMatch(/login doors/);
      expect(io.err.join("\n")).toMatch(/loam user create/);

      // NAMED GAP: this does NOT assert that the refusal gave the store back, and the obvious way to
      // try is hollow. The refusal happens after the store is open, and re-opening it here passes
      // whether or not the first handle was released, because sqlite permits concurrent readers on
      // POSIX — I wrote that assertion, measured it against the unfixed code, and it stayed green.
      //
      // What actually proves it is `dropHome` below, ON WINDOWS ONLY: a held directory cannot be
      // removed there, so a leaked handle fails this test's teardown with EPERM. That is how the leak
      // was found, and the Windows CI leg is the rail. On POSIX an unlinked open file simply goes when
      // the process does, so there is nothing here to observe.
    } finally {
      dropHome(bare);
    }
  });

  it("(l) serve() itself refuses oauth without users, BEFORE it binds a socket", async () => {
    // A throw after `listen` leaves a caller that catches it holding a live listener with the mounts
    // served and no login or connector doors — strictly worse than not starting. Proved by asking the
    // same port twice: if the refused boot had bound it, the second boot could not.
    const gateway = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: readSeed(home) }),
    );
    try {
      const probe = await serve({
        mounts: { default: gateway },
        tokens: { "op-token": { operator: true } },
        port: 0,
        host: "127.0.0.1",
      });
      const port = probe.port;
      await probe.close();

      await expect(
        serve({
          mounts: { default: gateway },
          tokens: { "op-token": { operator: true } },
          port,
          host: "127.0.0.1",
          oauth: { home, allowRedirectOrigins: [CLAUDE_ORIGIN] },
        }),
      ).rejects.toThrow(/login doors/);

      // The port is free, so nothing was left listening.
      handle = await serve({
        mounts: { default: gateway },
        tokens: { "op-token": { operator: true } },
        port,
        host: "127.0.0.1",
      });
      expect(handle.port).toBe(port);
      await handle.close();
      handle = undefined;
    } finally {
      await gateway.close();
    }
  });

  it("(l) a malformed allowlist also refuses before the socket binds", async () => {
    const gateway = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: readSeed(home) }),
    );
    try {
      const probe = await serve({
        mounts: { default: gateway },
        tokens: { "op-token": { operator: true } },
        port: 0,
        host: "127.0.0.1",
      });
      const port = probe.port;
      await probe.close();

      await expect(
        serve({
          mounts: { default: gateway },
          tokens: { "op-token": { operator: true } },
          port,
          host: "127.0.0.1",
          users: { home, mount: "default" },
          oauth: { home, allowRedirectOrigins: ["http://claude.ai"] },
        }),
      ).rejects.toThrow(/--oauth-allow-redirect/);

      handle = await serve({
        mounts: { default: gateway },
        tokens: { "op-token": { operator: true } },
        port,
        host: "127.0.0.1",
      });
      expect(handle.port).toBe(port);
      await handle.close();
      handle = undefined;
    } finally {
      await gateway.close();
    }
  });
});
