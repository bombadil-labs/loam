// §37 (T114): the lock on a home whose filesystem will not take one.
//
// ITS OWN FILE, because reaching this state needs `node:fs` mocked, and a mock of a builtin must not
// reach a rail that did not ask for one.
//
// WHY THE MOCK IS SAFE HERE, stated as what is actually true rather than as a claim about the graph:
// the second half of this file boots a real `SqliteBackend`, a real `Gateway` and a live HTTP server,
// so `node:fs` is mocked across all of that. It is safe because the override is PASS-THROUGH unless a
// test asks otherwise, because `oauth-file.ts` is the only module in the tree that calls `linkSync` at
// all, and because `better-sqlite3` is native CJS reached through `require` outside vitest's module
// registry. The toggle is cleared in `afterEach` on both halves, so a failing test cannot leave it on.
//
// WHY IT HAS TO BE INDUCED AT ALL. `claimLock` hard-links the lock from a temp that already holds the
// owner's nonce, and the ONLY failure a filesystem hands it that means "someone holds this" is EEXIST.
// Every other code — EPERM, EXDEV, ENOSYS, EOPNOTSUPP, the answers FAT and exFAT and some SMB and FUSE
// mounts give — means the operation is unavailable here, and no retry will change that. No state a test
// can put a normal filesystem into produces one, so every rail in `oauth-concurrency.test.ts` reaches
// `OAuthFileBusy` alone. That left the unlockable branch, and the disclosure it once carried, pinned by
// nothing.

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

// The toggle the mock reads. `vi.hoisted` because `vi.mock` is hoisted above the imports.
const control = vi.hoisted(() => ({ failLinkWith: undefined as string | undefined }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const linkSync: typeof actual.linkSync = (existing, next) => {
    if (control.failLinkWith !== undefined) {
      const err = new Error("link not supported") as NodeJS.ErrnoException;
      err.code = control.failLinkWith;
      throw err;
    }
    return actual.linkSync(existing, next);
  };
  // The DEFAULT export is overridden too. A spread copies the real one, so a module that ever switches
  // to `import fs from "node:fs"; fs.linkSync(...)` would bypass the override silently — nothing does
  // today, and a trap that costs one line to close is worth closing.
  const asRecord = actual as unknown as Record<string, unknown>;
  return {
    ...actual,
    linkSync,
    default: { ...(asRecord["default"] as object), linkSync },
  };
});

const { OAuthFileUnlockable, oauthLockPath, readOAuthFile, withOAuthFile, writeOAuthFile } =
  await import("../../src/server/oauth-file.js");
// Imported after the mock, like the module above: `vi.mock` is hoisted, and a static import would bind
// `node:fs` before the factory ran.
const { PASSWORD, bootStore, createUser, dropHome, makeHome, signIn } =
  await import("./user-fixture.js");
const {
  CLAUDE_REDIRECT,
  approve,
  codeFrom,
  formTokenIn,
  getAuthorize,
  pkce,
  redeem,
  register,
  serveOAuth,
  wellFormedAuthorize,
} = await import("./oauth-fixture.js");

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
  it("takes the lock normally when the toggle is OFF", () => {
    // THE MOCK'S PASS-THROUGH, ASSERTED. Every other rail in this file wants `linkSync` to fail, so a
    // mock that failed unconditionally would satisfy all of them — and the toggle, which is what gives
    // those rails their meaning, would be testing nothing. This is the one that fails if the override
    // stops calling through.
    withOAuthFile(home, (file) => ({
      next: {
        ...file,
        clients: [
          {
            clientId: "written-under-a-real-lock",
            clientName: "x",
            redirectUris: [],
            registeredAt: 1,
            generation: 1,
          },
        ],
      },
      result: undefined,
    }));
    expect(readOAuthFile(home).clients.map((c) => c.clientId)).toEqual([
      "written-under-a-real-lock",
    ]);
    // And it released: a lock left behind would wedge every later writer.
    expect(readdirSync(home).filter((f) => f === "oauth.json.lock")).toEqual([]);
    expect(readdirSync(home).filter((f) => f.includes(".claim"))).toEqual([]);
  });

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
    // collision into a permanent-sounding refusal and make the retry loop unreachable.
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
  // The rails above pin what `withOAuthFile` THROWS. These pin what the unauthenticated doors SAY,
  // which is the half that carries the disclosure risk — and the half no other rail can reach, because
  // every other one induces `OAuthFileBusy` by pre-creating the lock.
  //
  // Without these, splitting the two classes apart at a catch site and forwarding the unlockable
  // message would restore the worse leak — the lock's absolute path AND a serve flag, on doors that
  // answer `access-control-allow-origin: *` — and every other rail in the suite would stay green.

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

  it("(u) registration tells the caller nothing, and the operator everything", async () => {
    control.failLinkWith = "EPERM";
    const registered = await register(served!.base);
    control.failLinkWith = undefined;

    // A POSITIVE control first: this is the LOCK refusal, not the damaged-file one and not a generic
    // 503. Without it the negative assertions below could all pass on an unrelated answer.
    expect(registered.status).toBe(503);
    const body = JSON.stringify(registered.body);
    expect(body).toMatch(/lock/);
    expect(body).not.toMatch(/cannot read/);

    expect(body).not.toContain(serverHome);
    expect(body).not.toContain("oauth.json");
    expect(body).not.toContain("oauth-allow-redirect");
    expect(body).not.toContain("hard link");
    expect(body).not.toContain("EPERM");

    // The operator's channel carries the whole diagnosis, which is the point of having the class.
    const said = served!.faults.join("\n");
    expect(said).toMatch(/hard link/);
    expect(said).toContain("EPERM");
    expect(said).toContain(serverHome);
  });

  it("(u) the token endpoint answers on the same terms", async () => {
    // THE CODE MUST BE REAL. `withOAuthFile` is reached only from `mintToken`, which runs AFTER the code
    // lookup, the expiry check, `client_id`, `redirect_uri` and PKCE all pass. A redemption of a
    // made-up code returns `invalid_grant` long before the lock is touched, so it would answer 400 with
    // the toggle set and every negative assertion here would pass for an unrelated reason.
    const client = await register(served!.base);
    expect(client.status).toBe(201);
    const session = await signIn(served!.base);
    const secret = pkce();
    const params = wellFormedAuthorize(client.clientId, secret.challenge);
    const page = await getAuthorize(served!.base, params, session.cookie);
    const approved = await approve(served!.base, params, {
      cookie: session.cookie,
      formToken: formTokenIn(page.body),
    });
    const code = codeFrom(approved);
    expect(code).toBeDefined();

    control.failLinkWith = "EXDEV";
    const redeemed = await redeem(served!.base, {
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: client.clientId,
      code_verifier: secret.verifier,
    });
    control.failLinkWith = undefined;

    // The positive control: the mint reached the lock and refused there.
    expect(redeemed.res.status).toBe(503);
    const body = JSON.stringify(redeemed.body);
    expect(body).toMatch(/lock/);
    expect(body).not.toMatch(/invalid_grant/);
    expect(body).not.toMatch(/cannot read/);

    expect(body).not.toContain(serverHome);
    expect(body).not.toContain("oauth.json");
    expect(body).not.toContain("oauth-allow-redirect");
    expect(body).not.toContain("hard link");
    expect(body).not.toContain("EXDEV");

    const said = served!.faults.join("\n");
    expect(said).toMatch(/hard link/);
    expect(said).toContain("EXDEV");
    // And no token was minted, so the refusal is not merely cosmetic.
    expect(readOAuthFile(serverHome).tokens).toEqual([]);
  });
});
