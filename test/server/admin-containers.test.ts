// §40 phase A2 — the container lifecycle through the admin page (T141). Criteria (5)–(7) of
// .adlc/specs/40-admin-page.md, transcribed. `POST /admin/declare` declares a child inside the
// session user's subtree; `POST /admin/detach` and `POST /admin/reattach` drive the at-rest keep
// lifecycle; `POST /admin/drop` renders the confirm page and `POST /admin/drop-confirm` does it —
// two steps, byte-verified where bytes exist, refused honestly where they do not.
//
// What this file deliberately does NOT assert, and which rail closes each gap:
//   - The door itself (login, CSP, peek, subtree GETs) — phase A1 (`admin-door.test.ts`).
//   - drop()'s own purge-verify internals — the frozen T138 rails (`connection-container.test.ts`).
//   - Schema registration — A3; promotion/federation — A4; connections list/revoke — A5.
//
// Erasure standing rule: every store here is this file's own mkdtemp/memory fixture.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { containerClaims, detachClaims, CTX_CONTAINER } from "../../src/gateway/container.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { writeUserSeed } from "../../src/cli/config.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

const SEEDS = { ada: "aa".repeat(32), bea: "bb".repeat(32), cal: "cc".repeat(32) } as const;
const KEYS = {
  ada: authorForSeed(SEEDS.ada),
  bea: authorForSeed(SEEDS.bea),
  cal: authorForSeed(SEEDS.cal),
} as const;
const CONN_SEED = "1d".repeat(32);
const CONN2_SEED = "2d".repeat(32);
const CONN = authorForSeed(CONN_SEED);
const CONN2 = authorForSeed(CONN2_SEED);

/** The membership shape §40 fixes — the same author-select Term §39's inboxes use. */
const authoredBy = (key: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: key } },
  in: "input",
});

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const note = (text: string, seed: string, timestamp: number): ReturnType<typeof signClaims> =>
  signClaims(
    {
      timestamp,
      author: authorForSeed(seed),
      pointers: [{ role: "note", target: { kind: "primitive", value: text } }],
    },
    seed,
  );

/**
 * A store with two rooted users (ada, bea), a shared child of ada (`ada:letters`, gathering one
 * delta authored by cal's key), a detached separate child (`ada:vault`), and two live connection
 * inboxes bound to ada's root — each with its own backend, the first carrying a purge spy. One
 * primary delta authored by ada sits in the ground (the drop rails' second bystander).
 */
async function containerServer(): Promise<{
  base: string;
  gateway: Gateway;
  adaNote: { id: string };
  calNote: { id: string };
  w1: { id: string };
  w2: { id: string };
  backend1: MemoryBackend;
  backend2: MemoryBackend;
  purged: string[];
  inboxes: { one: string; two: string };
}> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  for (const name of ["ada", "bea"] as const) {
    await op(userClaims(name, OPERATOR, ts++));
    await op(roleClaims(name, "actor", OPERATOR, ts++));
  }
  const declare = (
    container: string,
    extra: Partial<Parameters<typeof containerClaims>[0]> = {},
  ): Promise<unknown> =>
    op(
      containerClaims(
        {
          container,
          trust: "curated",
          posture: "shared",
          membership: authoredBy(KEYS.ada),
          ...extra,
        },
        OPERATOR,
        ts++,
      ),
    );
  await declare("ada");
  await declare("bea", { membership: authoredBy(KEYS.bea) });
  // The shared child whose detach/reattach and shared-drop the rails drive. Its membership selects
  // cal's key, so its gather is disjoint from ada's root gather.
  await declare("ada:letters", { parent: "ada", membership: authoredBy(KEYS.cal) });
  // Declared separate, detached on the record: the honest-refusal rails' fixture.
  await op(
    containerClaims(
      { container: "ada:vault", trust: "curated", posture: "separate", parent: "ada" },
      OPERATOR,
      ts++,
    ),
  );
  await op(detachClaims("ada:vault", undefined, OPERATOR, ts++));

  await op(grantClaims(STORE_ENTITY, KEYS.ada, "write", OPERATOR, ts++));
  await op(grantClaims(STORE_ENTITY, KEYS.cal, "write", OPERATOR, ts++));
  const adaNote = note("a primary note", SEEDS.ada, ts++);
  await gateway.append([adaNote]);
  const calNote = note("a letter", SEEDS.cal, ts++);
  await gateway.append([calNote]);

  // Two live connections into ada's root, each with its own store — the T138 fixture shape. The
  // first backend carries a purge SPY: `holds` throws once drop() closes the store, so the byte
  // witness is the purge call itself, independent of drop()'s own refuse-on-survivors verify.
  const backend1 = new MemoryBackend();
  const backend2 = new MemoryBackend();
  const purged: string[] = [];
  const origPurge = backend1.purge.bind(backend1);
  backend1.purge = (ids: Iterable<string>): Promise<number> => {
    purged.push(...ids);
    return origPurge(ids);
  };
  const inbox1 = await gateway.bindConnection({
    container: "ada",
    connectionKey: CONN,
    ownerSeed: SEEDS.ada,
    backend: backend1,
  });
  const inbox2 = await gateway.bindConnection({
    container: "ada",
    connectionKey: CONN2,
    ownerSeed: SEEDS.ada,
    backend: backend2,
  });
  const w1 = note("first connection write", CONN_SEED, ts++);
  const w2 = note("second connection write", CONN2_SEED, ts++);
  await inbox1.gateway!.append([w1]);
  await inbox2.gateway!.append([w2]);

  const home = mkdtempSync(join(tmpdir(), "loam-admin-a2-"));
  homes.push(home);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(home, { version: 1, users: { ada: hash, bea: hash } });
  writeUserSeed(home, "ada", SEEDS.ada);
  writeUserSeed(home, "bea", SEEDS.bea);

  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return {
    base: handle.url,
    gateway,
    adaNote,
    calNote,
    w1,
    w2,
    backend1,
    backend2,
    purged,
    inboxes: { one: `inbox:ada:${CONN}`, two: `inbox:ada:${CONN2}` },
  };
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

/** Sign in over the REAL login doors; returns the session cookie value. */
async function signIn(base: string, user: string): Promise<string> {
  const form = await fetch(`${base}/login`, { redirect: "manual" });
  const nonceCookie = cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!;
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())![1]!;
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${PRESESSION_COOKIE}=${valueOf(nonceCookie)}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ form_token: token, user, password: PASSWORD }).toString(),
  });
  const sessionCookie = cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
  return valueOf(sessionCookie);
}

const getPage = (base: string, sessionId: string, path = "/admin"): Promise<Response> =>
  fetch(`${base}${path}`, {
    redirect: "manual",
    headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
  });

const getDetail = (base: string, sessionId: string, name: string): Promise<Response> =>
  getPage(base, sessionId, `/admin/container?name=${encodeURIComponent(name)}`);

const post = (
  base: string,
  path: string,
  sessionId: string,
  fields: Record<string, string>,
  headers: Record<string, string> = { ...SAME_ORIGIN },
): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${sessionId}`,
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });

/** The dashboard's session-bound form token (any lifecycle form carries it). */
const tokenOf = (html: string): string => /name="form_token" value="([^"]+)"/.exec(html)![1]!;

const confirmTokenOf = (html: string): string | undefined =>
  /name="confirm_token" value="([^"]+)"/.exec(html)?.[1];

/** The ids a scoped read of one container resolves — the delta-level probe. */
const scopedIds = (gateway: Gateway, name: string): string[] =>
  gateway.containerScope({ containers: [name] }).map((d) => d.id);

describe("§40 phase A2 — the container lifecycle", () => {
  it("(5) declare: a namespaced child under the root lands; foreign/absent parents and foreign names refuse", async () => {
    const { base, gateway } = await containerServer();
    const ada = await signIn(base, "ada");
    const token = tokenOf(await (await getPage(base, ada)).text());
    const before = gateway.containers().containers.size;

    // Parent outside the subtree — foreign (bea's root) and absent alike — is ONE uniform 403.
    const foreign = await post(base, "/admin/declare", ada, {
      form_token: token,
      name: "ada:evil",
      parent: "bea",
      posture: "shared",
      membership: JSON.stringify(authoredBy(KEYS.ada)),
    });
    const absent = await post(base, "/admin/declare", ada, {
      form_token: token,
      name: "ada:evil",
      parent: "utterly-absent",
      posture: "shared",
      membership: JSON.stringify(authoredBy(KEYS.ada)),
    });
    expect(foreign.status).toBe(403);
    expect(absent.status).toBe(403);
    expect(await foreign.text()).toBe(await absent.text());
    expect(gateway.containers().containers.size).toBe(before);

    // A name not namespaced under the session user refuses: a system-looking name and another
    // user's namespace alike. Neither declares anything.
    for (const name of ["system", "bea:evil"]) {
      const res = await post(base, "/admin/declare", ada, {
        form_token: token,
        name,
        parent: "ada",
        posture: "shared",
        membership: JSON.stringify(authoredBy(KEYS.ada)),
      });
      expect(res.status).toBe(400);
      expect(gateway.containers().containers.size).toBe(before);
    }

    // Positive control: the honest declare lands, operator-signed, parent edge on the table,
    // and the dashboard renders the new name.
    const ok = await post(base, "/admin/declare", ada, {
      form_token: token,
      name: "ada:notes",
      parent: "ada",
      posture: "shared",
      membership: JSON.stringify(authoredBy(KEYS.ada)),
    });
    expect(ok.status).toBe(303);
    const table = gateway.containers();
    expect(table.containers.get("ada:notes")?.parent).toBe("ada");
    const decl = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.id === "ada:notes" &&
          p.target.entity.context === CTX_CONTAINER,
      ),
    )!;
    expect(decl.claims.author).toBe(OPERATOR);
    const dashboard = await (await getPage(base, ada)).text();
    expect(dashboard).toContain("ada:notes");
  });

  it("(5) declare: a malformed membership Term refuses naming the defect, echoing nothing back", async () => {
    const { base, gateway } = await containerServer();
    const ada = await signIn(base, "ada");
    const token = tokenOf(await (await getPage(base, ada)).text());
    const before = gateway.containers().containers.size;

    const HOSTILE_JSON = '{"op": <script>alert(1)</script>';
    const notJson = await post(base, "/admin/declare", ada, {
      form_token: token,
      name: "ada:bad",
      parent: "ada",
      posture: "shared",
      membership: HOSTILE_JSON,
    });
    expect(notJson.status).toBe(400);
    const notJsonBody = await notJson.text();
    expect(notJsonBody).toContain("not valid JSON");
    expect(notJsonBody).not.toContain("<script");
    expect(notJsonBody).not.toContain("alert(1)");

    const notTerm = await post(base, "/admin/declare", ada, {
      form_token: token,
      name: "ada:bad",
      parent: "ada",
      posture: "shared",
      membership: '{"op": "not-a-real-op"}',
    });
    expect(notTerm.status).toBe(400);
    expect(await notTerm.text()).toContain("not a valid Term");

    // A shared child with no membership at all refuses too — H9 at the form.
    const noTerm = await post(base, "/admin/declare", ada, {
      form_token: token,
      name: "ada:bad",
      parent: "ada",
      posture: "shared",
      membership: "",
    });
    expect(noTerm.status).toBe(400);
    expect(gateway.containers().containers.size).toBe(before);
  });

  it("(6) detach and reattach a shared child: the record lands and clears, the members leave and return", async () => {
    const { base, gateway, calNote } = await containerServer();
    const ada = await signIn(base, "ada");
    const token = tokenOf(await (await getPage(base, ada)).text());

    // Baseline: the child gathers its member and the dashboard lists it active.
    expect(scopedIds(gateway, "ada:letters")).toContain(calNote.id);

    const detached = await post(base, "/admin/detach", ada, {
      form_token: token,
      name: "ada:letters",
    });
    expect(detached.status).toBe(303);
    // Delta level: the detach record survives on the table. Object level: the scoped read
    // resolves the child empty, and the dashboard says "detached" beside the name.
    expect(gateway.containers().detached.has("ada:letters")).toBe(true);
    expect(scopedIds(gateway, "ada:letters")).toEqual([]);
    const dashboard = await (await getPage(base, ada)).text();
    expect(dashboard).toContain("ada:letters");
    expect(dashboard).toContain("detached");

    const reattached = await post(base, "/admin/reattach", ada, {
      form_token: token,
      name: "ada:letters",
    });
    expect(reattached.status).toBe(303);
    expect(gateway.containers().detached.has("ada:letters")).toBe(false);
    expect(scopedIds(gateway, "ada:letters")).toContain(calNote.id);

    // Reattaching what is not detached refuses rather than minting stray negations.
    const again = await post(base, "/admin/reattach", ada, {
      form_token: token,
      name: "ada:letters",
    });
    expect(again.status).toBe(409);
  });

  it("(6) reattach of a detached SEPARATE container is refused honestly — a form cannot hand back its store", async () => {
    const { base, gateway } = await containerServer();
    const ada = await signIn(base, "ada");
    const token = tokenOf(await (await getPage(base, ada)).text());

    // The detail page states the limitation rather than offering a form that would lie.
    const detail = await (await getDetail(base, ada, "ada:vault")).text();
    expect(detail).toContain("command line");
    expect(detail).not.toContain(`action="/admin/reattach"`);

    const res = await post(base, "/admin/reattach", ada, {
      form_token: token,
      name: "ada:vault",
    });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("command line");
    // The record stands: the container is still deliberately kept.
    expect(gateway.containers().detached.has("ada:vault")).toBe(true);
  });

  it("(7) drop of a separate attached child is TWO steps and two-sided: bytes gone, declaration struck, bystanders survive", async () => {
    const { base, gateway, adaNote, w1, w2, backend1, backend2, purged, inboxes } =
      await containerServer();
    const ada = await signIn(base, "ada");
    const token = tokenOf(await (await getPage(base, ada)).text());

    // Baseline: the bytes are there, and the gather composes both connections' writes.
    expect(await backend1.holds(w1.id)).toBe(true);
    const beforeIds = gateway.connectionScope({ bound: "ada" }).map((d) => d.id);
    expect(beforeIds).toContain(w1.id);
    expect(beforeIds).toContain(w2.id);

    // Step 1: the drop form posts to a CONFIRM page that says what will be forgotten.
    const confirm = await post(base, "/admin/drop", ada, { form_token: token, name: inboxes.one });
    expect(confirm.status).toBe(200);
    const confirmBody = await confirm.text();
    expect(confirmBody).toContain(inboxes.one);
    expect(confirmBody).toMatch(/\d+ delta/);
    expect(confirmBody).toContain("cannot be undone");
    // An inbox drop names the connection it kills — the parent it wrote into.
    expect(confirmBody).toContain("connection");
    const confirmToken = confirmTokenOf(confirmBody)!;
    expect(confirmToken).toBeDefined();

    // The no-confirm path: a direct POST to the confirm endpoint without the minted token
    // (session form token and all) does NOTHING.
    const forged = await post(base, "/admin/drop-confirm", ada, {
      form_token: token,
      name: inboxes.one,
      confirm_token: "not-the-token",
    });
    expect(forged.status).toBe(403);
    expect(await backend1.holds(w1.id)).toBe(true);
    expect(gateway.containers().containers.has(inboxes.one)).toBe(true);

    // Step 2: the confirmed POST drops. Byte level: the purge spy saw the write's id (drop()'s
    // own verify refuses survivors — T138's frozen rails prove that half). Delta level: the
    // declaration is struck. Object level: the gather no longer resolves the write.
    const done = await post(base, "/admin/drop-confirm", ada, {
      form_token: token,
      name: inboxes.one,
      confirm_token: confirmToken,
    });
    expect(done.status).toBe(303);
    expect(purged).toContain(w1.id);
    expect(gateway.containers().containers.has(inboxes.one)).toBe(false);
    const afterIds = gateway.connectionScope({ bound: "ada" }).map((d) => d.id);
    expect(afterIds).not.toContain(w1.id);
    // The bystanders SURVIVE, named: the sibling inbox's bytes and gather, and the primary member.
    expect(await backend2.holds(w2.id)).toBe(true);
    expect(afterIds).toContain(w2.id);
    expect(afterIds).toContain(adaNote.id);
    expect(gateway.containers().containers.has(inboxes.two)).toBe(true);

    // The consumed confirm token buys nothing twice.
    const replay = await post(base, "/admin/drop-confirm", ada, {
      form_token: token,
      name: inboxes.one,
      confirm_token: confirmToken,
    });
    expect(replay.status).toBe(403);
  });

  it("(7) drop of a SHARED container strikes the shape and keeps the deltas — and the confirm page says so", async () => {
    const { base, gateway, calNote } = await containerServer();
    const ada = await signIn(base, "ada");
    const token = tokenOf(await (await getPage(base, ada)).text());

    const confirm = await post(base, "/admin/drop", ada, {
      form_token: token,
      name: "ada:letters",
    });
    expect(confirm.status).toBe(200);
    const confirmBody = await confirm.text();
    // The exact promise, in the page's own words: shape forgotten, deltas kept.
    expect(confirmBody).toContain("forgets its shape");
    expect(confirmBody).toContain("remain in the store");
    expect(confirmBody).toContain("cannot be undone");

    const done = await post(base, "/admin/drop-confirm", ada, {
      form_token: token,
      name: "ada:letters",
      confirm_token: confirmTokenOf(confirmBody)!,
    });
    expect(done.status).toBe(303);
    // Two-sided: the declaration is struck (the name stops resolving), AND the delta it gathered
    // remains in the primary ground; the sibling root container still stands.
    expect(gateway.containers().containers.has("ada:letters")).toBe(false);
    expect(gateway.reactor.get(calNote.id)).toBeDefined();
    expect(gateway.containers().containers.has("ada")).toBe(true);
  });

  it("(7) drop of a DETACHED separate container refuses honestly — its bytes are not here to verify", async () => {
    const { base, gateway } = await containerServer();
    const ada = await signIn(base, "ada");
    const token = tokenOf(await (await getPage(base, ada)).text());

    const res = await post(base, "/admin/drop", ada, { form_token: token, name: "ada:vault" });
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain("detached");
    // No confirm token is minted for a drop that cannot happen.
    expect(confirmTokenOf(body)).toBeUndefined();
    // The declaration and the record both stand: nothing was forgotten, nothing was claimed.
    expect(gateway.containers().containers.has("ada:vault")).toBe(true);
    expect(gateway.containers().detached.has("ada:vault")).toBe(true);
  });

  it("every lifecycle POST sits behind the same-origin + form-token gate and the subtree gate", async () => {
    const { base, gateway, backend1, w1, inboxes } = await containerServer();
    const ada = await signIn(base, "ada");
    const token = tokenOf(await (await getPage(base, ada)).text());
    const before = [...gateway.reactor.snapshot()].length;

    // One forged-token negative per endpoint class. Nothing lands, nothing is purged.
    const attempts: [string, Record<string, string>][] = [
      ["/admin/declare", { name: "ada:x", parent: "ada", posture: "separate" }],
      ["/admin/detach", { name: "ada:letters" }],
      ["/admin/reattach", { name: "ada:vault" }],
      ["/admin/drop", { name: inboxes.one }],
      ["/admin/drop-confirm", { name: inboxes.one, confirm_token: "whatever" }],
    ];
    for (const [path, fields] of attempts) {
      const forged = await post(base, path, ada, { ...fields, form_token: "not-the-token" });
      expect(forged.status).toBe(403);
      const foreign = await post(
        base,
        path,
        ada,
        { ...fields, form_token: token },
        { origin: "https://evil.example" },
      );
      expect(foreign.status).toBe(403);
    }
    expect([...gateway.reactor.snapshot()].length).toBe(before);
    expect(await backend1.holds(w1.id)).toBe(true);

    // The subtree gate on a write path: bea's session addressing ada's child gets the SAME
    // refusal as an absent name — no existence confirmation on any lifecycle POST.
    const bea = await signIn(base, "bea");
    const beaToken = tokenOf(await (await getPage(base, bea)).text());
    const foreignName = await post(base, "/admin/detach", bea, {
      form_token: beaToken,
      name: "ada:letters",
    });
    const absentName = await post(base, "/admin/detach", bea, {
      form_token: beaToken,
      name: "utterly-absent",
    });
    expect(foreignName.status).toBe(403);
    expect(absentName.status).toBe(403);
    expect(await foreignName.text()).toBe(await absentName.text());
    expect(gateway.containers().detached.has("ada:letters")).toBe(false);

    // Positive control beside the negatives: the honest POST with the honest token acts.
    const ok = await post(base, "/admin/detach", ada, { form_token: token, name: "ada:letters" });
    expect(ok.status).toBe(303);
    expect(gateway.containers().detached.has("ada:letters")).toBe(true);
  });

  it("an ATTACHED inbox refuses detach through the page — the durable lifecycle is revoke or drop", async () => {
    const { base, gateway, inboxes } = await containerServer();
    const ada = await signIn(base, "ada");
    const token = tokenOf(await (await getPage(base, ada)).text());

    const res = await post(base, "/admin/detach", ada, { form_token: token, name: inboxes.one });
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/durable|revoke|drop/i);
    expect(gateway.containers().detached.has(inboxes.one)).toBe(false);
  });
});
