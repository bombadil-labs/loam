import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writtenByUser } from "../../src/gateway/member-of.js";
import { FERN, observed } from "../spike/garden.js";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { CSP, PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { containerClaims, detachClaims, CTX_CONTAINER } from "../../src/gateway/container-law.js";
import { grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { writeUserSeed, userSeedPath } from "../../src/cli/config.js";

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

const HOSTILE = "<script>alert(1)</script>";
const INBOX = "inbox:ada:demo-connection";

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

async function adminServer(
  opts: { monotonicNow?: () => number; calSeed?: "present" | "unreadable" | "none" } = {},
): Promise<{ base: string; home: string; gateway: Gateway; adaNoteId: string }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  for (const name of ["ada", "bea", "cal"] as const) {
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
  await declare("ada-notes", { parent: "ada", membership: authoredBy(KEYS.cal) });
  await declare(HOSTILE, { parent: "ada" });
  await declare("ada-archive", { parent: "ada", membership: authoredBy(KEYS.cal) });
  await op(detachClaims("ada-archive", undefined, OPERATOR, ts++));
  await op(
    containerClaims(
      { container: "ada-vault", trust: "curated", posture: "separate", parent: "ada" },
      OPERATOR,
      ts++,
    ),
  );
  await op(
    containerClaims(
      {
        container: INBOX,
        trust: "curated",
        posture: "separate",
        membership: authoredBy(KEYS.cal),
        inboxOf: "ada",
      },
      OPERATOR,
      ts++,
    ),
  );
  await declare("bea", { membership: authoredBy(KEYS.bea) });
  await declare("bea-notes", { parent: "bea", membership: authoredBy(KEYS.bea) });
  await op(grantClaims(STORE_ENTITY, KEYS.ada, "write", OPERATOR, ts++));
  const note = signClaims(
    {
      timestamp: ts++,
      validFrom: ts++,
      author: KEYS.ada,
      pointers: [{ role: "note", target: { kind: "primitive", value: "a first note" } }],
    },
    SEEDS.ada,
  );
  await gateway.append([note]);
  const inbox = await gateway.openContainer({ name: INBOX });
  const pool = inbox.gateway!;
  await pool.append([
    pool.signer!.sign(grantClaims(STORE_ENTITY, KEYS.ada, "admin", pool.operatorAuthor!, ts++)),
  ]);

  const home = mkdtempSync(join(tmpdir(), "loam-admin-"));
  homes.push(home);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(home, { version: 1, users: { ada: hash, bea: hash, cal: hash } });
  writeUserSeed(home, "ada", SEEDS.ada);
  writeUserSeed(home, "bea", SEEDS.bea);
  const calSeed = opts.calSeed ?? "present";
  if (calSeed === "present") writeUserSeed(home, "cal", SEEDS.cal);
  if (calSeed === "unreadable") mkdirSync(userSeedPath(home, "cal"));

  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: {
      home,
      mount: "default",
      ...(opts.monotonicNow === undefined ? {} : { monotonicNow: opts.monotonicNow }),
    },
  });
  handles.push(handle);
  return { base: handle.url, home, gateway, adaNoteId: note.id };
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

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

const getAdmin = (base: string, sessionId?: string, path = "/admin"): Promise<Response> =>
  fetch(`${base}${path}`, {
    redirect: "manual",
    ...(sessionId === undefined ? {} : { headers: { cookie: `${SESSION_COOKIE}=${sessionId}` } }),
  });

const getDetail = (base: string, sessionId: string, name: string): Promise<Response> =>
  getAdmin(base, sessionId, `/admin/container?name=${encodeURIComponent(name)}`);

const postCreate = (
  base: string,
  sessionId: string,
  formToken: string,
  headers: Record<string, string> = { ...SAME_ORIGIN },
): Promise<Response> =>
  fetch(`${base}/admin/create-root`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${sessionId}`,
      ...headers,
    },
    body: new URLSearchParams({ form_token: formToken }).toString(),
  });

const tokenOf = (html: string): string | undefined =>
  /name="form_token" value="([^"]+)"/.exec(html)?.[1];

const declCount = (gateway: Gateway): number => gateway.containers().containers.size;

describe("§40 phase A1 — the admin door", () => {
  it("(1) no session renders the login form and declares nothing; each user sees ONLY their subtree", async () => {
    const { base, gateway } = await adminServer();
    const before = declCount(gateway);

    const anon = await getAdmin(base);
    expect(anon.status).toBe(200);
    const anonBody = await anon.text();
    expect(anonBody).toContain("Sign in.");
    expect(anonBody).not.toContain("Your containers");
    expect(declCount(gateway)).toBe(before);

    const ada = await signIn(base, "ada");
    const adaPage = await (await getAdmin(base, ada)).text();
    expect(adaPage).toContain("Your containers");
    for (const name of ["ada", "ada-notes", "ada-vault"]) expect(adaPage).toContain(name);
    expect(adaPage).toContain(INBOX);
    expect(adaPage).toContain("inbox");
    expect(adaPage).toContain("detached");
    expect(adaPage).not.toContain("<code>bea</code>");
    expect(adaPage).not.toContain("name=bea");

    const bea = await signIn(base, "bea");
    const beaPage = await (await getAdmin(base, bea)).text();
    expect(beaPage).toContain("<code>bea</code>");
    expect(beaPage).toContain("bea-notes");
    expect(beaPage).not.toContain("<code>ada</code>");
    expect(beaPage).not.toContain("name=ada");
  });

  it("(2a) a refused GET reads the session with peek — it does not slide the idle window", async () => {
    let clock = 0;
    const { base } = await adminServer({ monotonicNow: () => clock });
    const MIN = 60_000;

    const s1 = await signIn(base, "ada");
    clock = 29 * MIN;
    const refused = await getDetail(base, s1, "no-such-container");
    expect(refused.status).toBe(403);
    clock = 31 * MIN;
    const after = await getAdmin(base, s1);
    expect(await after.text()).toContain("Sign in.");

    const s2 = await signIn(base, "ada");
    clock = 60 * MIN;
    await fetch(`${base}/login`, { headers: { cookie: `${SESSION_COOKIE}=${s2}` } });
    clock = 62 * MIN;
    const alive = await getAdmin(base, s2);
    expect(await alive.text()).toContain("Your containers");
  });

  it("(2b) the create POST needs same-origin + the session's form token; anything less declares nothing", async () => {
    const { base, gateway } = await adminServer();
    const cal = await signIn(base, "cal");
    const offer = await (await getAdmin(base, cal)).text();
    const token = tokenOf(offer)!;
    const before = declCount(gateway);

    const foreign = await postCreate(base, cal, token, { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect(declCount(gateway)).toBe(before);

    const forged = await postCreate(base, cal, "not-the-token");
    expect(forged.status).toBe(403);
    expect(declCount(gateway)).toBe(before);

    const ok = await postCreate(base, cal, token);
    expect(ok.status).toBe(303);
    expect(declCount(gateway)).toBe(before + 1);
  });

  it("(3) the no-script CSP rides every admin response, and a hostile container name renders inert", async () => {
    const { base } = await adminServer();
    const ada = await signIn(base, "ada");

    const dashboard = await getAdmin(base, ada);
    const detail = await getDetail(base, ada, "ada");
    const refusal = await getDetail(base, ada, "bea");
    for (const res of [dashboard, detail, refusal]) {
      expect(res.headers.get("content-security-policy")).toBe(CSP);
    }

    const body = await dashboard.text();
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).not.toContain("<script");

    const hostileDetail = await getDetail(base, ada, HOSTILE);
    expect(hostileDetail.status).toBe(200);
    const hostileBody = await hostileDetail.text();
    expect(hostileBody).toContain("&lt;script&gt;");
    expect(hostileBody).not.toContain("<script");
  });

  it("(4) a fresh user is offered the create; the POST declares <username> with the author-select Term", async () => {
    const { base, gateway } = await adminServer();
    const cal = await signIn(base, "cal");

    const offer = await (await getAdmin(base, cal)).text();
    expect(offer).toContain("create your container");
    const prose = offer.replace(/name="form_token" value="[^"]*"/, "");
    expect(prose).not.toContain("<code>ada</code>");
    expect(prose).not.toContain("<code>bea</code>");
    expect(prose).not.toContain("?name=");

    const ok = await postCreate(base, cal, tokenOf(offer)!);
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/admin");

    const table = gateway.containers();
    expect(table.containers.get("cal")).toBeDefined();
    expect(table.containers.get("cal")!.membership).toEqual(authoredBy(KEYS.cal));
    const decl = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.id === "cal" &&
          p.target.entity.context === CTX_CONTAINER,
      ),
    )!;
    expect(decl.claims.author).toBe(OPERATOR);

    const after = await (await getAdmin(base, cal)).text();
    expect(after).toContain("Your containers");
    expect(after).toContain("cal");
    const count = declCount(gateway);
    const again = await postCreate(base, cal, tokenOf(offer)!);
    expect(again.status).toBe(409);
    expect(declCount(gateway)).toBe(count);
  });

  it("(members) the detail page lists a container's gather: id, author, timestamp — and only the subtree's", async () => {
    const { base, adaNoteId } = await adminServer();
    const ada = await signIn(base, "ada");

    const detail = await (await getDetail(base, ada, "ada")).text();
    expect(detail).toContain(adaNoteId);
    expect(detail).toContain(KEYS.ada);

    const empty = await (await getDetail(base, ada, "ada-notes")).text();
    expect(empty).not.toContain(adaNoteId);
    expect(empty).toContain("Nothing has gathered here yet");
  });

  it("(H9) a declared, unattached separate container says so — never an empty member list", async () => {
    const { base } = await adminServer();
    const ada = await signIn(base, "ada");
    const res = await getDetail(base, ada, "ada-vault");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("not attached");
    expect(body).toContain("bytes are not readable from here");
    expect(body).not.toContain("Nothing has gathered here yet");
    expect(body).not.toContain("member");
  });

  it("(subtree) a name outside the subtree refuses 403 without confirming existence", async () => {
    const { base } = await adminServer();
    const ada = await signIn(base, "ada");

    const foreign = await getDetail(base, ada, "bea");
    const absent = await getDetail(base, ada, "utterly-absent");
    expect(foreign.status).toBe(403);
    expect(absent.status).toBe(403);
    const foreignBody = await foreign.text();
    expect(foreignBody).toBe(await absent.text());
    expect(foreignBody).not.toContain("bea");

    expect((await getDetail(base, ada, "ada")).status).toBe(200);
  });

  it("(13) no admin response carries a Location off this server, on any path including refusals", async () => {
    const { base } = await adminServer();
    const ada = await signIn(base, "ada");
    const cal = await signIn(base, "cal");
    const offer = await (await getAdmin(base, cal)).text();
    const token = tokenOf(offer)!;

    const responses = [
      await getAdmin(base),
      await getAdmin(base, ada),
      await getDetail(base, ada, "ada"),
      await getDetail(base, ada, "bea"),
      await getDetail(base, ada, "ada-vault"),
      await postCreate(base, cal, "wrong-token"),
      await postCreate(base, cal, token, { origin: "https://evil.example" }),
      await fetch(`${base}/admin`, { method: "POST", redirect: "manual" }),
      await postCreate(base, cal, token),
    ];
    for (const res of responses) {
      const location = res.headers.get("location");
      expect(location === null || location.startsWith("/")).toBe(true);
    }
    expect(responses[responses.length - 1]!.headers.get("location")).toBe("/admin");
  });

  it("(14) a create fault names no home path, no seed filename, no flag", async () => {
    const { base, home, gateway } = await adminServer({ calSeed: "unreadable" });
    const cal = await signIn(base, "cal");
    const offer = await (await getAdmin(base, cal)).text();
    const before = declCount(gateway);

    const res = await postCreate(base, cal, tokenOf(offer)!);
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain("cannot be used");
    expect(body).not.toContain(home);
    expect(body).not.toContain("user.cal");
    expect(body).not.toContain("seed");
    expect(body).not.toContain("--");
    expect(declCount(gateway)).toBe(before);
  });

  it("(provisioning) a keyless actor's create MINTS their signing key: 0600 file, write grant, their Term", async () => {
    const { base, home, gateway } = await adminServer({ calSeed: "none" });
    const cal = await signIn(base, "cal");
    const offer = await (await getAdmin(base, cal)).text();

    const ok = await postCreate(base, cal, tokenOf(offer)!);
    expect(ok.status).toBe(303);

    const seedPath = userSeedPath(home, "cal");
    const raw = readFileSync(seedPath, "utf8").trim();
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") {
      expect(statSync(seedPath).mode & 0o777).toBe(0o600);
    }
    const mintedKey = authorForSeed(raw);

    expect(
      holdsGrant(
        gateway.reactor,
        gateway.validityNow(),
        STORE_ENTITY,
        mintedKey,
        "write",
        OPERATOR,
      ),
    ).toBe(true);
    const term = gateway.containers().containers.get("cal")!.membership!;
    expect(term).toEqual(writtenByUser("cal", "cal"));
    const byCal = observed(FERN, "height", 1, gateway.stamp(mintedKey).timestamp, raw);
    await gateway.append([byCal]);
    expect(gateway.select(term).map((d) => d.id)).toContain(byCal.id);
    const scan = (needle: string): boolean =>
      [...gateway.reactor.snapshot()].some((d) => JSON.stringify(d.claims).includes(needle));
    expect(scan(mintedKey)).toBe(true);
    expect(scan(raw)).toBe(false);
  });
});
