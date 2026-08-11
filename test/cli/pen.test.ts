// T102 — `loam serve` can provision a pen. A write-enabled renderer (SPEC §23.3) signs its form
// POSTs as a PEN whose seed lives in `GatewayOptions.pens`, and before this ticket the CLI offered
// no way to supply one: a CLI-served store's forms answered 403 forever. The convention railed
// here is the house precedent, exactly parallel to `user.<name>.seed`: per-pen seed files
// `pen.<name>.seed` in the home, 0600, read at boot — the filesystem is the trust root.
//
// ASSERTED AT BOTH LEVELS. DELTA: the landed write is AUTHORED BY THE PEN (never the operator),
// and `pen create`'s grant is on the ground. OBJECT: what the HTTP door answers — the form POST
// re-renders with the new fact, and the unprovisioned refusal names its cure on the token door
// while the anonymous door keeps the uniform body.
//
// Deliberately not asserted: the seed file's 0600 mode on win32 (chmod is advisory there — the
// config.ts header names that caveat), and the record-present-but-UNREADABLE pen file branch (no
// portable fixture makes a file unreadable on every CI platform).

import {
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { penSeedPath, readSeed, storePath, writePenSeed } from "../../src/cli/config.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { CTX_GRANTS } from "../../src/gateway/accounts.js";
import { publicClaims } from "../../src/gateway/public.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import type { ServerHandle } from "../../src/server/http.js";

vi.setConfig({ testTimeout: 15000 }); // real sqlite homes and a real HTTP server

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

// The surviving operator-authored write grants for `subject`, read straight off the store file —
// the delta-level half of every assertion below.
async function grantsFor(subject: string): Promise<number> {
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
  try {
    const operator = authorForSeed(readSeed(home));
    let count = 0;
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
      if (filed && names && gw.reactor.negationsOf(delta.id).length === 0) count += 1;
    }
    return count;
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
