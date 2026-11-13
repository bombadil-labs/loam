import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import {
  credentialsPath,
  hashPassword,
  readCredentials,
  writeCredentials,
  type ScryptParams,
} from "../../src/server/credentials.js";
import { locksPath } from "../../src/server/login-locks.js";
import { userSeedPath } from "../../src/cli/config.js";
import { roleClaims, rolesOf, userClaims, resolveUserView } from "../../src/server/users.js";
import { SESSION_COOKIE, PRESESSION_COOKIE } from "../../src/server/session.js";
import { bootSlateStore, standSlate, BEFORE_DEADLINE } from "../gateway/slating.js";
import { FERN, observed } from "../spike/garden.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

const SURFACE_HOME = "/loam-home";
const CREDENTIALS_FILE = basename(credentialsPath(SURFACE_HOME));
const LOCKS_FILE = basename(locksPath(SURFACE_HOME));
const SEED_FAMILY = basename(userSeedPath(SURFACE_HOME, "<name>"));
const MUST_DISCLOSE = [CREDENTIALS_FILE, LOCKS_FILE, SEED_FAMILY].sort();

const namesUnswept = (list: readonly string[], file: string): boolean =>
  list.some((line) => line.includes(file) && /not\b|never\b|outside\b/i.test(line));

const disclosesAll = (list: readonly string[] | undefined): boolean =>
  list !== undefined && MUST_DISCLOSE.every((file) => namesUnswept(list, file));

const fileTokens = (list: readonly string[]): string[] =>
  [...new Set(list.flatMap((line) => line.match(/[\w.<>-]+\.(?:json|seed)/g) ?? []))].sort();

const nonSweptOf = (health: unknown): readonly string[] | undefined =>
  (health as { nonSwept?: readonly string[] }).nonSwept;

const backends: MemoryBackend[] = [];
const gateways: Gateway[] = [];
const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (gateways.length > 0) await gateways.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
  backends.length = 0;
});

async function plainStore(): Promise<{ gw: Gateway; backend: MemoryBackend }> {
  const backend = new MemoryBackend();
  const gw = await Gateway.open(backend, { seed: OPERATOR_SEED });
  backends.push(backend);
  gateways.push(gw);
  return { gw, backend };
}

describe("T131 criterion 1 — the health report names the surfaces erasure does not sweep", () => {
  it("health() names credentials.json, login-locks.json and user.<name>.seed as unswept", async () => {
    const { gw } = await plainStore();
    const health = await gw.health();
    const list = nonSweptOf(health);
    expect(list).toBeDefined();
    expect(namesUnswept(list!, CREDENTIALS_FILE)).toBe(true);
    expect(namesUnswept(list!, LOCKS_FILE)).toBe(true);
    expect(namesUnswept(list!, SEED_FAMILY)).toBe(true);
    expect(list!.join("\n")).toMatch(/delta/i);
  });
});

describe("T131 criterion 2 — the disclosure reaches the compliance receipt", () => {
  it("the receipt's nonClaim names credentials.json, login-locks.json and user.<name>.seed", async () => {
    const gw = await bootSlateStore();
    gateways.push(gw);
    const member = observed(FERN, "height", 30, 1000, "6c".repeat(32));
    const bystander = observed(FERN, "tag", "shade", 1100, "6c".repeat(32));
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    expect(namesUnswept(receipt.nonClaim, CREDENTIALS_FILE)).toBe(true);
    expect(namesUnswept(receipt.nonClaim, LOCKS_FILE)).toBe(true);
    expect(namesUnswept(receipt.nonClaim, SEED_FAMILY)).toBe(true);
    expect(await gw.backend.holds(member.id)).toBe(false);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
  });
});

interface Account {
  readonly roles: readonly ("operator" | "actor")[];
  readonly password: string;
}

async function loginServer(accounts: Record<string, Account>): Promise<{
  base: string;
  gw: Gateway;
  home: string;
  recordIds: Record<string, string>;
}> {
  const backend = new MemoryBackend();
  const gw = await Gateway.open(backend, { seed: OPERATOR_SEED });
  gateways.push(gw);
  let ts = 9001;
  const recordIds: Record<string, string> = {};
  for (const [name, acct] of Object.entries(accounts)) {
    const record = signClaims(userClaims(name, OPERATOR, ts++), OPERATOR_SEED);
    recordIds[name] = record.id;
    await gw.append([record]);
    for (const role of acct.roles) {
      await gw.append([signClaims(roleClaims(name, role, OPERATOR, ts++), OPERATOR_SEED)]);
    }
  }
  const home = mkdtempSync(join(tmpdir(), "loam-users-erasure-"));
  homes.push(home);
  const users: Record<string, Awaited<ReturnType<typeof hashPassword>>> = {};
  for (const [name, acct] of Object.entries(accounts)) {
    users[name] = await hashPassword(acct.password, CHEAP);
  }
  writeCredentials(home, { version: 1, users });
  const handle = await serve({
    mounts: { default: gw },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return { base: handle.url, gw, home, recordIds };
}

const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;
const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));

async function attemptLogin(base: string, user: string, password: string): Promise<Response> {
  const form = await fetch(`${base}/login`, { redirect: "manual" });
  const nonceCookie = cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!;
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())![1]!;
  return fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${PRESESSION_COOKIE}=${valueOf(nonceCookie)}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ form_token: token, user, password }).toString(),
  });
}

const sessionCookieOf = (res: Response): string | undefined =>
  cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));

describe("T131 criteria 3 & 4 — a login whose user record delta was erased is refused", () => {
  it("refuses a login whose user record delta was erased, at the delta and the door levels", async () => {
    const { base, gw, recordIds } = await loginServer({
      alice: { roles: ["operator"], password: PASSWORD },
      bob: { roles: ["operator"], password: PASSWORD },
    });

    expect(sessionCookieOf(await attemptLogin(base, "alice", PASSWORD))).toBeDefined();

    await gw.erase(recordIds.alice!);

    expect(gw.reactor.get(recordIds.alice!)).toBeUndefined();
    expect(resolveUserView(gw.reactor, OPERATOR, Date.now(), "alice")).toBeUndefined();
    expect(rolesOf(gw.reactor, OPERATOR, Date.now(), "alice").size).toBe(0);
    expect(gw.reactor.get(recordIds.bob!)).toBeDefined();
    expect(rolesOf(gw.reactor, OPERATOR, Date.now(), "bob").has("operator")).toBe(true);

    const refused = await attemptLogin(base, "alice", PASSWORD);
    expect(refused.status).toBe(401);
    expect((await refused.json()) as unknown).toEqual({ errors: ["the login was refused"] });
    expect(sessionCookieOf(refused)).toBeUndefined();

    expect(sessionCookieOf(await attemptLogin(base, "bob", PASSWORD))).toBeDefined();
  });

  it("erasing a user record leaves credentials.json untouched, for the erased user and a bystander", async () => {
    const { gw, home, recordIds } = await loginServer({
      alice: { roles: ["operator"], password: PASSWORD },
      bob: { roles: ["operator"], password: PASSWORD },
    });
    await gw.erase(recordIds.alice!);
    const creds = readCredentials(home);
    expect(creds.users.alice).toBeDefined();
    expect(creds.users.bob).toBeDefined();
  });
});

describe("T131 criterion 5 — the disclosure is not conditional on the erasure outcome", () => {
  it("the unswept disclosure is present on a zero-erasure, a partial, and a refused path", async () => {
    const fresh = await plainStore();
    const zero = await fresh.gw.health();
    expect(zero.erasure.promised).toBe(0);
    expect(disclosesAll(nonSweptOf(zero))).toBe(true);
    const zeroList = nonSweptOf(zero)!;

    await expect(fresh.gw.erase("delta:nothing-here")).rejects.toThrow();
    const afterRefusal = await fresh.gw.health();
    expect(disclosesAll(nonSweptOf(afterRefusal))).toBe(true);
    expect(nonSweptOf(afterRefusal)).toEqual(zeroList);

    const { gw, backend } = await plainStore();
    const target = observed(FERN, "height", 30, 1000, OPERATOR_SEED);
    await gw.append([target]);
    await gw.erase(target.id);
    backend.holds = () => Promise.reject(new Error("this tier is offline"));
    const partial = await gw.health();
    expect(partial.status).not.toBe("ok");
    expect(disclosesAll(nonSweptOf(partial))).toBe(true);
    expect(nonSweptOf(partial)).toEqual(zeroList);
  });
});

describe("T131 criterion 7 — both surfaces disclose exactly the derived home auth surfaces", () => {
  it("both surfaces disclose the same set, and it equals the path-function-derived MUST_DISCLOSE", async () => {
    const gw = await bootSlateStore();
    gateways.push(gw);
    const member = observed(FERN, "height", 30, 1000, "6c".repeat(32));
    await gw.append([member]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress"] });
    const report = await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    const receipt = await gw.receipt(report.graveyard, { now: BEFORE_DEADLINE });
    const health = await gw.health();

    expect(MUST_DISCLOSE).toEqual([CREDENTIALS_FILE, LOCKS_FILE, SEED_FAMILY].sort());
    expect(fileTokens(receipt.nonClaim)).toEqual(MUST_DISCLOSE);
    expect(fileTokens(nonSweptOf(health)!)).toEqual(MUST_DISCLOSE);
  });
});
