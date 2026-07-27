// §37 (T114): the lock on a home whose filesystem will not take one.
//
// ITS OWN FILE, because reaching this state needs `node:fs` mocked and that mock must not reach any
// other rail. The graph here is `oauth-file.ts` alone — node builtins, one pure-JS package, no server
// and no sqlite — so the mock's blast radius is a single module.
//
// WHY IT HAS TO BE INDUCED AT ALL. `claimLock` hard-links the lock from a temp that already holds the
// owner's nonce, and the ONLY failure a filesystem can hand it that means "someone holds this" is
// EEXIST. Every other code — EPERM, EXDEV, ENOSYS, EOPNOTSUPP, the answers FAT and exFAT and some SMB
// and FUSE mounts give — means the operation is not available here at all, and no amount of retrying
// will change it. There is no state a test can put a normal filesystem into that produces one, so the
// other rails in `oauth-concurrency.test.ts` can only ever reach `OAuthFileBusy` by pre-creating the
// lock. That left the whole unlockable branch — and the leak it used to carry — asserted by nothing.

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The toggle the mock reads. Declared with `vi.hoisted` because `vi.mock` is hoisted above the imports.
const control = vi.hoisted(() => ({ failLinkWith: undefined as string | undefined }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const linkSync: typeof actual.linkSync = (existing, next) => {
    if (control.failLinkWith !== undefined) {
      const err = new Error(`link not supported`) as NodeJS.ErrnoException;
      err.code = control.failLinkWith;
      throw err;
    }
    return actual.linkSync(existing, next);
  };
  return { ...actual, linkSync };
});

const { OAuthFileUnlockable, oauthLockPath, readOAuthFile, withOAuthFile, writeOAuthFile } =
  await import("../../src/server/oauth-file.js");
// Imported after the mock, like the module above it: `vi.mock` is hoisted, and a static import of the
// fixture would bind `node:fs` before the factory ran.
const { PASSWORD, bootStore, createUser, dropHome, makeHome } = await import("./user-fixture.js");
const { register, serveOAuth } = await import("./oauth-fixture.js");

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-lock-fs-"));
  writeOAuthFile(home, { version: 1, clients: [], grants: [], tokens: [] });
});
afterEach(() => {
  control.failLinkWith = undefined;
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("a filesystem that will not take a hard link", () => {
  it("refuses with a DIAGNOSABLE error rather than a raw errno", () => {
    // Left raw, this reached a caller through a catch that reports "cannot read its connector records" —
    // sending the operator to read a file that is perfectly fine while every connector write is dead.
    for (const code of ["EPERM", "EXDEV", "ENOSYS", "EOPNOTSUPP"]) {
      control.failLinkWith = code;
      let thrown: unknown;
      try {
        withOAuthFile(home, (file) => ({ next: file, result: undefined }));
      } catch (err) {
        thrown = err;
      }
      expect(thrown, code).toBeInstanceOf(OAuthFileUnlockable);
      const message = (thrown as Error).message;
      // It names the real cause, the filesystems that behave this way, and what to do about it.
      expect(message, code).toMatch(/hard link/);
      expect(message, code).toMatch(/FAT|exFAT|network/);
      expect(message, code).toMatch(/--oauth-allow-redirect|local filesystem/);
      // And it carries the errno, so an unexpected one is still identifiable in the operator's log.
      expect(message, code).toContain(code);
    }
  });

  it("EEXIST is still CONTENTION, not an unsupported filesystem", () => {
    // The one code that must NOT take this branch. Reading it as unsupported would turn every ordinary
    // collision into a permanent-sounding refusal, and would make the retry loop unreachable.
    control.failLinkWith = "EEXIST";
    let thrown: unknown;
    try {
      withOAuthFile(home, (file) => ({ next: file, result: undefined }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeInstanceOf(OAuthFileUnlockable);
    // It waited its budget and gave up as busy instead — the lock "exists" on every attempt.
    expect((thrown as Error).message).toMatch(/held by another process/);
  });

  it("writes nothing, and leaves no claim temp behind", () => {
    control.failLinkWith = "EPERM";
    expect(() =>
      withOAuthFile(home, (file) => ({
        next: {
          ...file,
          clients: [
            {
              clientId: "should-not-land",
              clientName: "x",
              redirectUris: [],
              registeredAt: 1,
              generation: 1,
            },
          ],
        },
        result: undefined,
      })),
    ).toThrow(OAuthFileUnlockable);
    control.failLinkWith = undefined;
    expect(readOAuthFile(home).clients).toEqual([]);
    expect(readdirSync(home).filter((f) => f.includes(".claim"))).toEqual([]);
    // And no lock is left at the path either: nothing ever created one.
    expect(readdirSync(home).filter((f) => f === "oauth.json.lock")).toEqual([]);
    expect(oauthLockPath(home)).toContain("oauth.json.lock");
  });
});

describe("the DOOR's answer when the lock cannot be taken", () => {
  // The rails above pin what `withOAuthFile` THROWS. This pins what the unauthenticated door SAYS,
  // which is the half that carries the disclosure risk — and the half no other rail could reach,
  // because every other one induces `OAuthFileBusy` by pre-creating the lock.
  //
  // Without this, splitting the two classes apart at the catch site and forwarding the unlockable
  // message would restore the worse leak — the lock's absolute path AND a serve flag, on a door that
  // answers `access-control-allow-origin: *` — and every other rail in this suite would stay green.

  let served: Awaited<ReturnType<typeof serveOAuth>> | undefined;
  let serverHome: string;

  beforeEach(async () => {
    serverHome = makeHome();
    await bootStore(serverHome);
    await createUser(serverHome, "myk", PASSWORD);
    served = await serveOAuth(serverHome);
  });
  afterEach(async () => {
    control.failLinkWith = undefined;
    await served?.close();
    served = undefined;
    dropHome(serverHome);
  });

  it("(u) tells the caller nothing about the home or the flag, and the operator everything", async () => {
    control.failLinkWith = "EPERM";
    const registered = await register(served!.base);
    control.failLinkWith = undefined;

    expect([500, 503]).toContain(registered.status);
    const body = JSON.stringify(registered.body);
    expect(body).not.toContain(serverHome);
    expect(body).not.toContain("oauth.json");
    expect(body).not.toContain("oauth-allow-redirect");
    expect(body).not.toContain("hard link");
    expect(body).not.toContain("EPERM");
    // It still says the true thing, so the refusal is not merely opaque.
    expect(body).toMatch(/lock/);

    // The operator's channel carries the whole diagnosis, which is the point of having the class.
    const said = served!.faults.join("\n");
    expect(said).toMatch(/hard link/);
    expect(said).toContain("EPERM");
    expect(said).toContain(serverHome);
  });

  it("(u) the token endpoint answers on the same terms", async () => {
    // Both doors were changed together and can drift apart, so each is asserted.
    control.failLinkWith = "EXDEV";
    const res = await fetch(`${served!.base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "nope" }).toString(),
    });
    const text = await res.text();
    control.failLinkWith = undefined;
    expect(text).not.toContain(serverHome);
    expect(text).not.toContain("hard link");
  });
});
