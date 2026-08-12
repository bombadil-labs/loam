// T102 — `loam serve` can provision a pen. A write-enabled renderer (SPEC §23.3) signs its form
// POSTs as a PEN whose seed lives in `GatewayOptions.pens`, and before this ticket the CLI offered
// no way to supply one: a CLI-served store's forms answered 403 forever. The convention railed
// here is the house precedent, exactly parallel to `user.<name>.seed`: per-pen seed files
// `pen.<name>.seed` in the home, 0600, read at boot — the filesystem is the trust root.
//
// A pen has THREE facts, and this file rails all of them: the seed file (custody), the ground's
// write grant (authorization), and the ground's pen record (which author the NAME signs as). The
// record is what makes re-keying a leaked seed complete — without it the replaced key keeps its
// standing under an author derivable only from the file the operator was told to delete.
//
// ASSERTED AT BOTH LEVELS. DELTA: the landed write is AUTHORED BY THE PEN (never the operator),
// `pen create`'s grant is on the ground, and a re-key's strike is a real negation of a real grant
// id rather than an absence. OBJECT: what the HTTP door answers — the form POST re-renders with
// the new fact, a re-keyed pen's old seed is refused even when restored to its own file, and the
// unprovisioned refusal names its cure on the token door while the anonymous door keeps the
// uniform body.
//
// Deliberately not asserted: the seed file's 0600 mode on win32 (chmod is advisory there — the
// config.ts header names that caveat), and the record-present-but-UNREADABLE pen file branch (no
// portable fixture makes a file unreadable on every CI platform). The unlistable-home rail needs a
// process that permission bits actually bind, so it stages nothing under root or win32 and asserts
// that it is on one of those rather than passing quietly.

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import {
  penSeedPath,
  readPenSeeds,
  readSeed,
  storePath,
  writePenSeed,
} from "../../src/cli/config.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { CTX_GRANTS } from "../../src/gateway/accounts.js";
import { publicClaims } from "../../src/gateway/public.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import type { ServerHandle } from "../../src/server/http.js";

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-pen-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Every operator-authored grant for `subject` at the given VERB, read straight off the store file
// and split by survival — the delta-level half of every assertion below. The verb is checked
// because a grant naming the subject is not the same fact as a grant naming it FOR WRITE, and the
// door only ever honors the second; the split is checked because a struck grant and an absent one
// are opposite facts that a bare count cannot tell apart.
async function grantIds(
  subject: string,
  verb = "write",
): Promise<{ surviving: string[]; struck: string[] }> {
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
  try {
    const operator = authorForSeed(readSeed(home));
    const surviving: string[] = [];
    const struck: string[] = [];
    for (const delta of gw.reactor.snapshot()) {
      if (delta.claims.author !== operator) continue;
      const filed = delta.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.id === STORE_ENTITY &&
          p.target.entity.context === CTX_GRANTS,
      );
      const names = delta.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === subject,
      );
      const acts = delta.claims.pointers.some(
        (p) => p.role === "verb" && p.target.kind === "primitive" && p.target.value === verb,
      );
      if (!filed || !names || !acts) continue;
      (gw.reactor.negationsOf(delta.id).length === 0 ? surviving : struck).push(delta.id);
    }
    return { surviving, struck };
  } finally {
    await gw.close();
  }
}

const grantsFor = async (subject: string, verb = "write"): Promise<number> =>
  (await grantIds(subject, verb)).surviving.length;

// Retire a pen the way the help text prescribes: strike every surviving write grant its author
// holds. There is no `loam pen retire` yet, so this is the operator's own negation.
async function strikeGrantsOf(subject: string): Promise<void> {
  const { surviving } = await grantIds(subject);
  const seed = readSeed(home);
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: seed }),
  );
  try {
    const operator = authorForSeed(seed);
    const at = Date.now();
    await gw.append(
      surviving.map((id, i) => signClaims(makeNegationClaims(operator, at + i, id), seed)),
    );
  } finally {
    await gw.close();
  }
}

const penSeedOf = (name: string): string => readFileSync(penSeedPath(home, name), "utf8").trim();

describe("loam pen create", () => {
  it("mints pen.<name>.seed at 0600 and plants the write grant, never printing the seed", async () => {
    await run(["init", "--home", home], io());
    const code = await run(["pen", "create", "guest-pen", "--home", home], io());
    expect(code).toBe(0);

    const path = penSeedPath(home, "guest-pen");
    expect(existsSync(path)).toBe(true);
    const seed = penSeedOf("guest-pen");
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    // Delta level: the ground holds exactly one operator-signed write grant for the pen's author.
    expect(await grantsFor(authorForSeed(seed))).toBe(1);
    // The report names the file and the binding key, and never the secret.
    const printed = out.join("\n");
    expect(printed).toContain(path);
    expect(printed).toContain('pen: "guest-pen"');
    expect(printed).not.toContain(seed);
  });

  it("refuses a second create for a provisioned pen — nothing overwritten, no second grant", async () => {
    await run(["init", "--home", home], io());
    await run(["pen", "create", "guest-pen", "--home", home], io());
    const seed = penSeedOf("guest-pen");
    out.length = 0;
    err.length = 0;
    const code = await run(["pen", "create", "guest-pen", "--home", home], io());
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("already provisioned");
    expect(penSeedOf("guest-pen")).toBe(seed); // the key survived
    expect(await grantsFor(authorForSeed(seed))).toBe(1); // and no grant was doubled
  });

  it("repairs the grant when the seed file exists without one (the two halves converge)", async () => {
    await run(["init", "--home", home], io());
    const seed = "5c".repeat(32);
    writePenSeed(home, "hand-pen", seed); // custody present, authorization missing
    const code = await run(["pen", "create", "hand-pen", "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("repaired pen hand-pen");
    expect(penSeedOf("hand-pen")).toBe(seed); // the existing key is kept, never re-minted
    expect(await grantsFor(authorForSeed(seed))).toBe(1);
  });

  it("RE-KEYS when the seed is gone: fresh key planted, the old author's standing STRUCK", async () => {
    await run(["init", "--home", home], io());
    await run(["pen", "create", "guest-pen", "--home", home], io());
    const leaked = penSeedOf("guest-pen");
    const leakedAuthor = authorForSeed(leaked);
    expect(await grantsFor(leakedAuthor)).toBe(1);

    // The prescribed answer to a leaked seed: remove the file, run create again.
    rmSync(penSeedPath(home, "guest-pen"));
    out.length = 0;
    err.length = 0;
    expect(await run(["pen", "create", "guest-pen", "--home", home], io())).toBe(0);

    const fresh = penSeedOf("guest-pen");
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(fresh).not.toBe(leaked);
    // Delta level: the new author holds standing, the leaked one holds none — and the leaked
    // grant is STRUCK rather than merely absent, so the record says who lost it and when.
    const before = await grantIds(leakedAuthor);
    expect(before.surviving).toEqual([]);
    expect(before.struck.length).toBe(1);
    expect(await grantsFor(authorForSeed(fresh))).toBe(1);
    // The report NAMES the retired key, which is the fact the deleted file used to be the only
    // copy of — an operator cannot audit a strike against an author nobody can print.
    const printed = out.join("\n");
    expect(printed).toContain("re-keyed pen guest-pen");
    expect(printed).toContain(leakedAuthor);
    expect(printed).not.toContain(leaked);
    expect(printed).not.toContain(fresh);
  });

  it("refuses to resurrect a RETIRED pen — a struck grant is not an absent one", async () => {
    await run(["init", "--home", home], io());
    await run(["pen", "create", "guest-pen", "--home", home], io());
    const seed = penSeedOf("guest-pen");
    await strikeGrantsOf(authorForSeed(seed)); // the retirement the help text prescribes

    out.length = 0;
    err.length = 0;
    expect(await run(["pen", "create", "guest-pen", "--home", home], io())).toBe(2);
    expect(err.join("\n")).toContain("was RETIRED");
    expect(penSeedOf("guest-pen")).toBe(seed); // the key file was not touched
    // And the revocation still binds — nothing was planted to undo it.
    const after = await grantIds(authorForSeed(seed));
    expect(after.surviving).toEqual([]);
    expect(after.struck.length).toBe(1);
  });

  it("refuses a seed file `serve` would refuse, and never quotes the file back", async () => {
    await run(["init", "--home", home], io());
    writeFileSync(penSeedPath(home, "bad-pen"), "not-a-seed-at-all\n", { mode: 0o600 });
    expect(await run(["pen", "create", "bad-pen", "--home", home], io())).toBe(1);
    const said = err.join("\n");
    expect(said).toContain("pen create:");
    expect(said).toContain(penSeedPath(home, "bad-pen"));
    expect(said).toContain("64-hex");
    expect(said).not.toContain("not-a-seed-at-all"); // key bytes never reach a message
    // And no standing was planted for whatever that file holds: create and serve agree on what a
    // provisioned pen is, so the ground never grants one the next boot would skip.
    expect(readPenSeeds(home).pens).toEqual({});
    expect(readPenSeeds(home).faults.length).toBe(1);
  });

  it("reads write standing at the VERB — an admin grant is not write standing", async () => {
    await run(["init", "--home", home], io());
    const seed = "7a".repeat(32);
    writePenSeed(home, "hand-pen", seed);
    const operatorSeed = readSeed(home);
    const operator = authorForSeed(operatorSeed);
    const gw = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed }),
    );
    try {
      await gw.append([
        signClaims(
          grantClaims(STORE_ENTITY, authorForSeed(seed), "admin", operator, Date.now()),
          operatorSeed,
        ),
      ]);
    } finally {
      await gw.close();
    }
    // The pen holds an admin grant and no write grant. `create` must plant the write grant it
    // actually needs rather than reading the admin one as "already granted".
    expect(await run(["pen", "create", "hand-pen", "--home", home], io())).toBe(0);
    expect(await grantsFor(authorForSeed(seed), "write")).toBe(1);
    expect(await grantsFor(authorForSeed(seed), "admin")).toBe(1);
  });

  it("refuses a name that is not a single path component, before any path is built", async () => {
    await run(["init", "--home", home], io());
    const code = await run(["pen", "create", "../evil", "--home", home], io());
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("is not a pen name");
    // Nothing was written anywhere under the home — the refusal came before any path was built.
    expect(readdirSync(home).filter((f) => f.includes("evil"))).toEqual([]);
  });

  it("warns when a live server holds the store — serve reads pen seeds only at boot", async () => {
    await run(["init", "--home", home], io());
    const handle = (await run(
      ["serve", "--http", "--home", home, "--port", "0", "--token", "t"],
      io(),
      { detach: true },
    )) as ServerHandle;
    try {
      err.length = 0;
      const code = await run(["pen", "create", "late-pen", "--home", home], io());
      expect(code).toBe(0);
      expect(err.join("\n")).toMatch(/will not see what just landed until it restarts/);
    } finally {
      await handle.close();
    }
  });
});

describe("serve with pen seeds — §23.3 form writes, end to end (T102)", () => {
  const PICK = { pick: { order: { byTimestamp: "desc" } } };
  const FERN = "plant:fern";
  const registerPlant = async (): Promise<void> => {
    const file = join(home, "plant.json");
    writeFileSync(
      file,
      JSON.stringify({
        hyperschema: {
          name: "Plant",
          alg: 1,
          body: {
            op: "group",
            key: "byTargetContext",
            in: {
              op: "select",
              pred: { hasPointer: { targetEntity: { var: "root" } } },
              in: { op: "mask", policy: "drop", in: "input" },
            },
          },
        },
        schema: { props: { height: PICK }, default: PICK },
        roots: [FERN],
        writable: ["height"],
      }),
    );
    expect(await run(["register", file, "--home", home], io())).toBe(0);
  };

  // Publish renderers offline, exactly as `loam register` plants a schema: the bindings are
  // deltas on disk, and the next serve reads them.
  const publishRenderers = async (declarePublic: boolean): Promise<void> => {
    const seed = readSeed(home);
    const gw = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
    );
    try {
      const bundle = "export default (n) => `<p>h=${n.view.height}</p>`;";
      await gw.publishRenderer({
        route: "guestbook",
        schema: "Plant",
        consumes: ["height"],
        bundle,
        writable: ["height"],
        pen: "guest-pen",
      });
      await gw.publishRenderer({
        route: "unprov",
        schema: "Plant",
        consumes: ["height"],
        bundle,
        writable: ["height"],
        pen: "ghost-pen", // never `pen create`d — no seed file will exist for it
      });
      if (declarePublic) {
        await gw.append([
          signClaims(publicClaims(["Plant"], authorForSeed(seed), Date.now()), seed),
        ]);
      }
    } finally {
      await gw.close();
    }
  };

  const serveDetached = async (): Promise<ServerHandle> =>
    (await run(["serve", "--http", "--home", home, "--port", "0", "--token", "tok"], io(), {
      detach: true,
    })) as ServerHandle;

  const post = (base: string, route: string, body: string, token?: string): Promise<Response> =>
    fetch(`${base}/default/app/${route}/${encodeURIComponent(FERN)}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body,
    });

  it("boots with pen.*.seed provisioned and a form POST lands, SIGNED AS THE PEN", async () => {
    await run(["init", "--home", home], io());
    await registerPlant();
    expect(await run(["pen", "create", "guest-pen", "--home", home], io())).toBe(0);
    await publishRenderers(false);
    const handle = await serveDetached();
    try {
      // Boot names the provisioned pen — "is my pen provisioned" is answered here, not by a 403.
      expect(out.join("\n")).toMatch(/pens guest-pen/);
      // OBJECT level: the write succeeds and the route re-renders with the new fact...
      const res = await post(handle.url, "guestbook", "height=7", "tok");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("h=7");
    } finally {
      await handle.close();
    }
    // ...and DELTA level: the landed write is authored by the PEN, never the operator.
    const penAuthor = authorForSeed(penSeedOf("guest-pen"));
    const gw = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: readSeed(home) }),
    );
    try {
      const landed = [...gw.reactor.snapshot()].find(
        (d) =>
          d.claims.pointers.some(
            (p) =>
              p.target.kind === "entity" &&
              p.target.entity.id === FERN &&
              p.target.entity.context === "height",
          ) &&
          d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === "7"),
      );
      expect(landed?.claims.author).toBe(penAuthor);
      expect(landed?.claims.author).not.toBe(authorForSeed(readSeed(home)));
    } finally {
      await gw.close();
    }
  });

  it("no seed file → the 403 names the cure on the token door; the anonymous door stays uniform", async () => {
    await run(["init", "--home", home], io());
    await registerPlant();
    await publishRenderers(true); // public, so the anonymous door sees the route at all
    const handle = await serveDetached();
    try {
      // The token door tells the operator exactly what to run and which file it will read.
      const full = await post(handle.url, "unprov", "height=7", "tok");
      expect(full.status).toBe(403);
      const cure = await full.text();
      expect(cure).toContain("loam pen create ghost-pen");
      expect(cure).toContain("pen.ghost-pen.seed");
      // The anonymous door learns neither the pen's name nor the store's file layout.
      const anon = await post(handle.url, "unprov", "height=7");
      expect(anon.status).toBe(403);
      const uniform = await anon.text();
      expect(uniform).toBe("the write was refused");
      expect(uniform).not.toContain("ghost-pen");
    } finally {
      await handle.close();
    }
  });

  it("the RE-KEYED pen's old seed cannot write at the door, even restored to its own file", async () => {
    await run(["init", "--home", home], io());
    await registerPlant();
    expect(await run(["pen", "create", "guest-pen", "--home", home], io())).toBe(0);
    const leaked = penSeedOf("guest-pen");
    await publishRenderers(false);

    // The leaked key writes today — this half fails if the fixture never proved the door open.
    let handle = await serveDetached();
    try {
      expect((await post(handle.url, "guestbook", "height=7", "tok")).status).toBe(200);
    } finally {
      await handle.close();
    }

    rmSync(penSeedPath(home, "guest-pen"));
    expect(await run(["pen", "create", "guest-pen", "--home", home], io())).toBe(0);

    // Now the attacker's copy, put back where the server will read it. Custody is restored;
    // AUTHORIZATION is not, and the door is where that has to be visible.
    writePenSeed(home, "guest-pen", leaked);
    handle = await serveDetached();
    try {
      const res = await post(handle.url, "guestbook", "height=99", "tok");
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("h=99");
    } finally {
      await handle.close();
    }
  });

  it("a home that cannot be LISTED is a fault, never an empty pen set (H9)", async () => {
    await run(["init", "--home", home], io());
    await registerPlant();
    expect(await run(["pen", "create", "guest-pen", "--home", home], io())).toBe(0);
    await publishRenderers(false);

    // 0311 is traversable but not listable: every file opens by name, and readdir refuses. A
    // process that ignores the mode (root, or win32) cannot stage this at all.
    chmodSync(home, 0o311);
    let listable = true;
    try {
      readdirSync(home);
    } catch {
      listable = false;
    }
    try {
      if (!listable) {
        // Unit level: the reader says "I could not look", not "there is nothing".
        const read = readPenSeeds(home);
        expect(read.pens).toEqual({});
        expect(read.faults.length).toBe(1);
        expect(read.faults[0]).toContain("could not be listed");

        // Object level: the operator hears it at boot, where the puzzle would otherwise start.
        err.length = 0;
        out.length = 0;
        const handle = await serveDetached();
        try {
          expect(err.join("\n")).toContain("could not be listed");
          expect(out.join("\n")).not.toMatch(/pens /); // and nothing is claimed as provisioned
        } finally {
          await handle.close();
        }
      }
    } finally {
      chmodSync(home, 0o700); // afterEach must be able to remove the tree
    }
    // An unlistable home is the whole point of the fixture; a platform that cannot make one has
    // no coverage here, and says so rather than passing quietly.
    if (listable) expect(process.platform === "win32" || process.getuid?.() === 0).toBe(true);
  });

  it("a pen file that cannot provision is a boot FAULT on the operator's log, never a silent skip", async () => {
    await run(["init", "--home", home], io());
    writeFileSync(join(home, "pen.bad.seed"), "not-a-seed\n", { mode: 0o600 });
    const handle = await serveDetached();
    try {
      expect(err.join("\n")).toMatch(/pen "bad" is not provisioned/);
      expect(out.join("\n")).not.toMatch(/pens bad/); // and it is not in the provisioned list
    } finally {
      await handle.close();
    }
  });
});
