// SPEC §49 criterion (c) — the dashboard leads with attention (T212; the working spec at
// .adlc/specs/49-legibility.md, settled 2026-08-28). The page a PERSON reads: the first screen
// is the since-last-looked summary, the container tree demoted beneath it; a quiet container
// collapses to one line; a trust claim renders LOUD. The marks are written through the REAL
// forms — the looked-mark in the session user's own voice, the quiet-mark in the operator's —
// never by hand-appending what the door would have signed (T143's lesson: drive the surface).
//
// Both levels: the ground holds the row the form wrote, authored by the right key; the page
// answers from it. Admin-page-only in v1 (settled question 2); the CLI reads the same reading
// later.
//
// Erasure standing rule: every store here is this file's own memory/mkdtemp fixture.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { CTX_LOOKED, CTX_QUIET } from "../../src/gateway/attention.js";
import { containerClaims } from "../../src/gateway/container.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import { roleClaims, userClaims, type UserRole } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SAME_ORIGIN, formTokenOf, signIn } from "../helpers/session-fixture.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const SEEDS = { opal: "0a".repeat(32), nina: "17".repeat(32) } as const;
const KEYS = { opal: authorForSeed(SEEDS.opal), nina: authorForSeed(SEEDS.nina) } as const;

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

/** opal (operator) and nina (actor), each with a root; `opal:notes` nested under opal. */
async function seeded(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  const roles: Record<keyof typeof KEYS, UserRole> = { opal: "operator", nina: "actor" };
  for (const name of ["opal", "nina"] as const) {
    await op(userClaims(name, OPERATOR, ts++));
    await op(roleClaims(name, roles[name], OPERATOR, ts++));
    await op(
      containerClaims(
        {
          container: name,
          trust: "curated",
          posture: "shared",
          membership: authoredBy(KEYS[name]),
        },
        OPERATOR,
        ts++,
      ),
    );
    await op(grantClaims(STORE_ENTITY, KEYS[name], "write", OPERATOR, ts++));
  }
  await op(
    containerClaims(
      {
        container: "opal:notes",
        trust: "curated",
        posture: "shared",
        parent: "opal",
        membership: authoredBy(KEYS.opal),
      },
      OPERATOR,
      ts++,
    ),
  );
  return gateway;
}

async function doorOver(gateway: Gateway): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "loam-t212-"));
  homes.push(home);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(home, { version: 1, users: { opal: hash, nina: hash } });
  writeUserSeed(home, "opal", SEEDS.opal);
  writeUserSeed(home, "nina", SEEDS.nina);
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return handle.url;
}

const textOf = async (base: string, session: string): Promise<string> =>
  (
    await fetch(`${base}/admin`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    })
  ).text();

const post = (
  base: string,
  path: string,
  session: string,
  fields: Record<string, string>,
): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${session}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams(fields).toString(),
  });

/** One ordinary data claim by opal into her root's membership. */
const opalNote = (t: number) =>
  signClaims(
    {
      timestamp: t,
      author: KEYS.opal,
      pointers: [
        { role: "notes", target: { kind: "entity", entity: { id: "note:day", context: "diary" } } },
        { role: "text", target: { kind: "primitive", value: `written at ${t}` } },
      ],
    } as never,
    SEEDS.opal,
  );

describe("§49(c) — the first screen is the summary; the tree is beneath it", () => {
  it("attention renders before the container tree, with counts by class — never claim bodies", async () => {
    const gateway = await seeded();
    await gateway.append([opalNote(20_000)]);
    const base = await doorOver(gateway);
    const session = await signIn(base, "opal", PASSWORD);
    const html = await textOf(base, session);

    const attentionAt = html.indexOf("What changed");
    const treeAt = html.indexOf("Your containers");
    expect(attentionAt, "the attention section is missing").toBeGreaterThan(-1);
    expect(treeAt).toBeGreaterThan(-1);
    expect(attentionAt, "the tree renders before the attention summary").toBeLessThan(treeAt);
    // The count is there; the body is not (counted, never listed).
    expect(html).toContain("data-attention-total");
    expect(html).not.toContain("written at 20000");
  });

  it("a trust claim renders LOUD; marking read in the user's own voice quiets the count", async () => {
    const gateway = await seeded();
    await gateway.append([opalNote(20_000)]);
    // A trust-class claim since the look: a fresh grant, operator-authored, in opal's subtree
    // reach (the summary is store-law; the row lands via the store's own vocabulary).
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, "ed25519:ff", "write", OPERATOR, 21_000), OPERATOR_SEED),
    ]);
    const base = await doorOver(gateway);
    const session = await signIn(base, "opal", PASSWORD);
    const before = await textOf(base, session);
    expect(before, "no loud marker for a trust claim").toContain("attention-loud");

    // Mark opal's root read through the REAL form.
    const token = formTokenOf(before);
    const res = await post(base, "/admin/looked", session, { form_token: token, name: "opal" });
    expect(res.status).toBe(303);

    // Delta level: the looked-row exists and is authored by OPAL'S key, not the operator's.
    const looked = [...gateway.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_LOOKED,
      ),
    );
    expect(looked.length).toBe(1);
    expect(looked[0]!.claims.author).toBe(KEYS.opal);

    // Object level: the page now reads quiet for that container.
    const after = await textOf(base, session);
    expect(after).toContain('data-attention-total="0"');
  });

  it("a container outside the session user's subtree cannot be marked read", async () => {
    const gateway = await seeded();
    const base = await doorOver(gateway);
    const session = await signIn(base, "nina", PASSWORD);
    const token = formTokenOf(await textOf(base, session));
    const res = await post(base, "/admin/looked", session, { form_token: token, name: "opal" });
    expect(res.status).toBe(403);
    const looked = [...gateway.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_LOOKED,
      ),
    );
    expect(looked).toEqual([]);
  });
});

describe("§49(c)+(d) — quiet collapses on the page, and only the operator's mark binds", () => {
  it("the operator quiets a child: one collapsed line, no counts; un-quieting restores it", async () => {
    const gateway = await seeded();
    await gateway.append([opalNote(20_000)]);
    const base = await doorOver(gateway);
    const session = await signIn(base, "opal", PASSWORD);
    const token = formTokenOf(await textOf(base, session));

    const res = await post(base, "/admin/quiet", session, {
      form_token: token,
      name: "opal:notes",
      value: "true",
    });
    expect(res.status).toBe(303);

    // Delta level: one operator-authored quiet row.
    const rows = [...gateway.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_QUIET,
      ),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.claims.author).toBe(OPERATOR);

    // Object level: the quiet container collapses to one line without counts.
    const quieted = await textOf(base, session);
    expect(quieted).toContain('data-quiet="opal:notes"');
    expect(quieted).not.toContain('data-attention-container="opal:notes"');

    const token2 = formTokenOf(quieted);
    await post(base, "/admin/quiet", session, {
      form_token: token2,
      name: "opal:notes",
      value: "false",
    });
    const restored = await textOf(base, session);
    expect(restored).toContain('data-attention-container="opal:notes"');
  });

  it("an actor's quiet POST is refused: the mark is the operator's", async () => {
    const gateway = await seeded();
    const base = await doorOver(gateway);
    const session = await signIn(base, "nina", PASSWORD);
    const token = formTokenOf(await textOf(base, session));
    const res = await post(base, "/admin/quiet", session, {
      form_token: token,
      name: "nina",
      value: "true",
    });
    expect(res.status).toBe(403);
  });
});
