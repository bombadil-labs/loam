import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OP = "0e".repeat(32);
const OPERATOR = authorForSeed(OP);
const ADA_SEED = "aa".repeat(32);
const ADA = authorForSeed(ADA_SEED);
const ALICE_SEED = "a1".repeat(32);
const CAROL_SEED = "c0".repeat(32);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const INTO = "ada:friends";

const homes: string[] = [];
const handles: ServerHandle[] = [];
const gateways: Gateway[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (gateways.length > 0) await gateways.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const authoredBy = (key: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: key } },
  in: "input",
});

const note = (text: string, seed: string, timestamp: number): Delta =>
  signClaims(
    {
      timestamp,
      validFrom: timestamp,
      author: authorForSeed(seed),
      pointers: [{ role: "note", target: { kind: "primitive", value: text } }],
    },
    seed,
  );

async function channelServer(): Promise<{
  base: string;
  gateway: Gateway;
  alice: { name: string; note: Delta; backend: MemoryBackend; purged: string[] };
  carol: { name: string; note: Delta; backend: MemoryBackend };
  detachAlice: () => Promise<void>;
}> {
  const pools = new Map<string, MemoryBackend>();
  const purged: string[] = [];
  const gateway = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: OP, registrations: [] }),
    {
      channelBackend: (pool: string): MemoryBackend => {
        const held = pools.get(pool) ?? new MemoryBackend();
        pools.set(pool, held);
        return held;
      },
    },
  );
  gateways.push(gateway);
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> => gateway.append([signClaims(claims, OP)]);
  await op(userClaims("ada", OPERATOR, ts++));
  await op(roleClaims("ada", "actor", OPERATOR, ts++));
  await op(
    containerClaims(
      { container: "ada", trust: "curated", posture: "shared", membership: authoredBy(ADA) },
      OPERATOR,
      ts++,
    ),
  );
  await op(
    containerClaims(
      {
        container: INTO,
        trust: "curated",
        posture: "shared",
        parent: "ada",
        membership: authoredBy(ADA),
      },
      OPERATOR,
      ts++,
    ),
  );
  await op(grantClaims(STORE_ENTITY, ADA, "write", OPERATOR, ts++));

  const aliceNote = note("alice's word", ALICE_SEED, ts++);
  const carolNote = note("carol's word", CAROL_SEED, ts++);
  const one = await gateway.openChannel({
    into: INTO,
    prefix: "alice",
    source: { pull: () => Promise.resolve([aliceNote]) },
  });
  const two = await gateway.openChannel({
    into: INTO,
    prefix: "carol",
    source: { pull: () => Promise.resolve([carolNote]) },
  });
  await one.sync();
  await two.sync();
  const aliceBackend = pools.get(one.name)!;
  const origPurge = aliceBackend.purge.bind(aliceBackend);
  aliceBackend.purge = (ids: Iterable<string>): Promise<number> => {
    purged.push(...ids);
    return origPurge(ids);
  };

  const home = mkdtempSync(join(tmpdir(), "loam-t257-"));
  homes.push(home);
  writeCredentials(home, { version: 1, users: { ada: await hashPassword(PASSWORD, CHEAP) } });
  writeUserSeed(home, "ada", ADA_SEED);
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
    alice: { name: one.name, note: aliceNote, backend: aliceBackend, purged },
    carol: { name: two.name, note: carolNote, backend: pools.get(two.name)! },
    detachAlice: () => one.pool.detach(),
  };
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

async function signIn(base: string): Promise<string> {
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
    body: new URLSearchParams({ form_token: token, user: "ada", password: PASSWORD }).toString(),
  });
  return valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
}

const getPage = (base: string, sessionId: string, path = "/admin"): Promise<Response> =>
  fetch(`${base}${path}`, {
    redirect: "manual",
    headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
  });

const post = (
  base: string,
  path: string,
  sessionId: string,
  fields: Record<string, string>,
): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${sessionId}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams(fields).toString(),
  });

const tokenOf = (html: string): string => /name="form_token" value="([^"]+)"/.exec(html)![1]!;
const confirmTokenOf = (html: string): string | undefined =>
  /name="confirm_token" value="([^"]+)"/.exec(html)?.[1];

const mcpDrop = async (
  base: string,
  channel: string,
): Promise<{ confirmAt: string; cliAt: string; purgedNothing: boolean; note: string }> => {
  const res = await fetch(`${base}/default/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer op-token", "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "loam_federate_drop", arguments: { channel } },
    }),
  });
  const body = (await res.json()) as { result: { content: { text: string }[] } };
  return JSON.parse(body.result.content[0]!.text) as {
    confirmAt: string;
    cliAt: string;
    purgedNothing: boolean;
    note: string;
  };
};

describe("T257 (a)+(b) — a channel severs through the page, two-sided at the bytes and the reading", () => {
  it("the confirm page renders for a channel pool, and the confirmed sever purges it while the bystander survives", async () => {
    const { base, gateway, alice, carol } = await channelServer();
    const ada = await signIn(base);
    const token = tokenOf(await (await getPage(base, ada)).text());

    expect(await alice.backend.holds(alice.note.id)).toBe(true);
    expect(await carol.backend.holds(carol.note.id)).toBe(true);
    const before = gateway.containerScope({ containers: [INTO] }).map((d) => d.id);
    expect(before).toContain(alice.note.id);
    expect(before).toContain(carol.note.id);

    const confirm = await post(base, "/admin/drop", ada, { form_token: token, name: alice.name });
    expect(confirm.status).toBe(200);
    const confirmBody = await confirm.text();
    expect(confirmBody).toContain(alice.name);
    const held = gateway.channelPools.get(alice.name)!.members().length;
    expect(confirmBody).toContain(`<p>It holds ${held} deltas.</p>`);
    expect(confirmBody).toContain("<p>This is the pool of a federation channel receiving into");
    expect(confirmBody).toContain(`<code>${INTO}</code>. Dropping it severs that channel whole`);
    expect(confirmBody).toContain("law the channel blessed");
    expect(confirmBody).toContain("that is reversible, and this is not.</p>");
    expect(confirmBody).toContain("cannot be undone");
    const confirmToken = confirmTokenOf(confirmBody);
    expect(confirmToken).toBeDefined();

    const sharedConfirm = await post(base, "/admin/drop", ada, { form_token: token, name: INTO });
    expect(sharedConfirm.status).toBe(200);
    expect(await sharedConfirm.text()).toMatch(/<p>It holds \d+ deltas?\.<\/p>/);

    const done = await post(base, "/admin/drop-confirm", ada, {
      form_token: token,
      name: alice.name,
      confirm_token: confirmToken!,
    });
    expect(done.status).toBe(303);
    expect(alice.purged).toContain(alice.note.id);
    expect(gateway.channelStatus(alice.name)).toHaveLength(0);
    const after = gateway.containerScope({ containers: [INTO] }).map((d) => d.id);
    expect(after).not.toContain(alice.note.id);

    expect(await carol.backend.holds(carol.note.id)).toBe(true);
    expect(after).toContain(carol.note.id);
    expect(gateway.channelStatus(carol.name)).toHaveLength(1);
    expect(gateway.containers().containers.has(INTO)).toBe(true);
  });
});

describe("T257 (c) — the link the agent hands back leads to this page", () => {
  it("loam_federate_drop stages nothing and its confirmAt, opened with a session, is the drop form", async () => {
    const { base, gateway, alice } = await channelServer();
    const staged = await mcpDrop(base, alice.name);
    expect(staged.purgedNothing).toBe(true);
    expect(gateway.channelStatus(alice.name)).toHaveLength(1);

    const ada = await signIn(base);
    const page = await getPage(base, ada, staged.confirmAt);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`<input type="hidden" name="name" value="${alice.name}">`);
    expect(html).toContain('action="/admin/drop"');

    const posted = /<input type="hidden" name="name" value="([^"]+)">/.exec(html)![1]!;
    const confirm = await post(base, "/admin/drop", ada, {
      form_token: tokenOf(html),
      name: posted,
    });
    expect(confirm.status).toBe(200);
    expect(confirmTokenOf(await confirm.text())).toBeDefined();
    expect(gateway.channelStatus(alice.name)).toHaveLength(1);

    expect(staged.cliAt).toBe(`loam federate drop --channel ${alice.name} --yes`);
    expect(staged.note).toContain("under the signed-in person's own name");
    expect(staged.note).toContain("`loam_federate_set` with receiving false");
  });
});

describe("T257 (d2) — a sever the store cannot complete answers 503 honestly, claiming neither direction", () => {
  it("when the purge itself refuses, the page says the sever did not complete and the channel still stands", async () => {
    const { base, gateway, alice, carol } = await channelServer();
    alice.backend.purge = (): Promise<number> => Promise.reject(new Error("the disk said no"));
    const ada = await signIn(base);
    const token = tokenOf(await (await getPage(base, ada)).text());
    const confirm = await post(base, "/admin/drop", ada, { form_token: token, name: alice.name });
    expect(confirm.status).toBe(200);
    const done = await post(base, "/admin/drop-confirm", ada, {
      form_token: token,
      name: alice.name,
      confirm_token: confirmTokenOf(await confirm.text())!,
    });
    expect(done.status).toBe(503);
    const body = await done.text();
    expect(body).toContain("The sever did not complete.");
    expect(body).not.toContain("nothing was forgotten");
    expect(gateway.channelStatus(alice.name)).toHaveLength(1);
    expect(await carol.backend.holds(carol.note.id)).toBe(true);
    expect(gateway.channelStatus(carol.name)).toHaveLength(1);
  });
});

describe("T257 (d) — a sever the store cannot prove refuses on the page, and removes nothing", () => {
  it("a channel whose pool is kept at rest answers a refusal with no confirm token, bytes untouched", async () => {
    const { base, gateway, alice, detachAlice } = await channelServer();
    await detachAlice();
    const ada = await signIn(base);
    const token = tokenOf(await (await getPage(base, ada)).text());

    const res = await post(base, "/admin/drop", ada, { form_token: token, name: alice.name });
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(confirmTokenOf(body)).toBeUndefined();
    expect(alice.purged).toEqual([]);
    expect(gateway.channelStatus(alice.name)).toHaveLength(1);
    expect(gateway.containers().detached.has(alice.name)).toBe(true);
  });
});
