// T143 — criteria 1–3 of .adlc/specs/36-06-origin-null-repair.md. A `no-referrer` policy on a
// page that hosts a form makes Chrome serialize the form POST's Origin as the string `null`, and
// `fromThisPage` refuses null outright — so the policy on the store's own HTML is load-bearing
// for every session-gated POST. This rail pins it at both levels: what a live response actually
// sends (object level), and a source floor so the NEXT page cannot ship with the old header
// (a hand-enumerated page list narrows in lockstep with what its author remembered; the scan
// does not).
//
// The scan is textual, not semantic: it slices each `writeHead(` call's first 800 characters and
// matches the exact prettier-stable spelling `"referrer-policy": "no-referrer"`. A header object
// assembled far from its writeHead, or a `setHeader` call, would evade all three scan tests —
// today neither exists in `src/`, and the live-response assertions above are the level that
// cannot be evaded, only narrowed.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { writeOAuthFile, type OAuthClient } from "../../src/server/oauth-file.js";
import { initHome } from "../../src/cli/config.js";

vi.setConfig({ testTimeout: 20_000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const ALLOW_ORIGIN = "https://app.example";
const REDIRECT = "https://app.example/cb";
const CLIENT_ID = "connector-fixed-0001";
const CODE_CHALLENGE = createHash("sha256")
  .update("a-verifier-of-sufficient-length")
  .digest("base64url");

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

async function doorServer(): Promise<{ base: string }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let ts = 9001;
  await gateway.append([signClaims(userClaims("myk", OPERATOR, ts++), OPERATOR_SEED)]);
  await gateway.append([signClaims(roleClaims("myk", "operator", OPERATOR, ts++), OPERATOR_SEED)]);
  const home = mkdtempSync(join(tmpdir(), "loam-referrer-"));
  homes.push(home);
  // The token door signs with <home>/operator.seed and fails closed without it — and a fallen-
  // through /oauth/token would answer from the mount layer, without the header this rail pins.
  initHome(home, OPERATOR_SEED);
  writeCredentials(home, { version: 1, users: { myk: await hashPassword(PASSWORD, CHEAP) } });
  const client: OAuthClient = {
    clientId: CLIENT_ID,
    clientName: "Example Connector",
    redirectUris: [REDIRECT],
    registeredAt: 1,
    generation: 1,
  };
  writeOAuthFile(home, { version: 1, clients: [client], grants: [], tokens: [] });
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    publicUrl: "https://store.example",
    users: { home, mount: "default" },
    connectors: { home, allowRedirectOrigins: [ALLOW_ORIGIN] },
  });
  handles.push(handle);
  return { base: handle.url };
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;
const policyOf = (res: Response): string | null => res.headers.get("referrer-policy");

async function signIn(base: string): Promise<{ session: string; formToken: string; page: string }> {
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
    body: new URLSearchParams({ form_token: token, user: "myk", password: PASSWORD }).toString(),
  });
  const page = await res.text();
  const session = valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
  return { session, formToken: /name="form_token" value="([^"]+)"/.exec(page)![1]!, page };
}

describe("criterion 1 — form-hosting pages send the policy that keeps a real Origin", () => {
  it("the login page, the signed-in answer and the signed-out answer say same-origin", async () => {
    const { base } = await doorServer();
    expect(policyOf(await fetch(`${base}/login`))).toBe("same-origin");
    const { session, formToken } = await signIn(base);
    const signedIn = await fetch(`${base}/login`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    });
    expect(policyOf(signedIn)).toBe("same-origin");
    const out = await fetch(`${base}/logout`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({ form_token: formToken }).toString(),
    });
    expect(policyOf(out)).toBe("same-origin");
  });

  it("the admin pages say same-origin, signed in or not", async () => {
    const { base } = await doorServer();
    expect(policyOf(await fetch(`${base}/admin`))).toBe("same-origin");
    const { session } = await signIn(base);
    expect(
      policyOf(
        await fetch(`${base}/admin`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } }),
      ),
    ).toBe("same-origin");
  });

  it("the consent page and its refusals say origin — the authorize URL's query is a secret its Referer must never carry", async () => {
    const { base } = await doorServer();
    const { session } = await signIn(base);
    const authorize = (query: Record<string, string>): Promise<Response> =>
      fetch(`${base}/oauth/authorize?${new URLSearchParams(query)}`, {
        headers: { cookie: `${SESSION_COOKIE}=${session}` },
        redirect: "manual",
      });
    const consent = await authorize({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state: "st-42",
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: "S256",
    });
    expect(consent.status).toBe(200);
    expect(policyOf(consent)).toBe("origin");
    // T143's second finding: Chrome enforces form-action against the POST's redirect target, so
    // the consent page must name the registered redirect ORIGIN — and only there. Two-sided: the
    // refusal page below keeps the unwidened CSP. This literal is LOAD-BEARING: the
    // implementation widens via CSP.replace, which no-ops silently if the constant is ever
    // reworded, and oauth-consent's frozen expectation computes with the same replace — this
    // hand-written string is the one assertion that goes red on that silent no-op.
    expect(consent.headers.get("content-security-policy")).toContain(
      `form-action 'self' ${ALLOW_ORIGIN}`,
    );
    const refused = await authorize({
      client_id: "connector-nope",
      redirect_uri: REDIRECT,
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: "S256",
    });
    expect(refused.status).toBe(400);
    expect(policyOf(refused)).toBe("origin");
    expect(refused.headers.get("content-security-policy")).toContain("form-action 'self';");
    // No session: the consent door renders the login form through ITS OWN html helper.
    const anon = await fetch(`${base}/oauth/authorize`, { redirect: "manual" });
    expect(policyOf(anon)).toBe("origin");
  });
});

describe("criterion 2 — the non-documents kept no-referrer (positive control: the policy did not flip everywhere)", () => {
  it("a login refusal (JSON) and a token-door refusal (JSON) still say no-referrer", async () => {
    const { base } = await doorServer();
    const crossSite = await fetch(`${base}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "user=myk",
    });
    expect(crossSite.status).toBe(403);
    expect(policyOf(crossSite)).toBe("no-referrer");
    const token = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=nonsense",
    });
    expect(token.status).toBeGreaterThanOrEqual(400);
    expect(policyOf(token)).toBe("no-referrer");
  });

  it("the authorize 302 — the one redirect toward a foreign redirect_uri — still says no-referrer", async () => {
    const { base } = await doorServer();
    const { session } = await signIn(base);
    const consent = await fetch(
      `${base}/oauth/authorize?${new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        state: "st-42",
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: "S256",
      })}`,
      { headers: { cookie: `${SESSION_COOKIE}=${session}` } },
    );
    const html = await consent.text();
    const field = (name: string): string =>
      new RegExp(`name="${name}" value="([^"]*)"`).exec(html)![1]!;
    const approved = await fetch(`${base}/oauth/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        form_token: field("form_token"),
        client_id: field("client_id"),
        redirect_uri: field("redirect_uri"),
        state: field("state"),
        code_challenge: field("code_challenge"),
        code_challenge_method: "S256",
      }).toString(),
    });
    expect(approved.status).toBe(302);
    expect(approved.headers.get("location")).toContain("code=");
    expect(policyOf(approved)).toBe("no-referrer");
  });
});

describe("criterion 3 — the source floor", () => {
  const root = join(import.meta.dirname, "..", "..");
  const sources = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...sources(path));
      else if (name.endsWith(".ts")) out.push(path);
    }
    return out;
  };
  /** The first 800 chars after each `writeHead(` — room for every header object in src/ today. */
  const headerBlocks = (content: string): string[] =>
    content
      .split("writeHead(")
      .slice(1)
      .map((chunk) => chunk.slice(0, 800));

  it("no writeHead in src/ pairs text/html with no-referrer — the T143 combination is banned outright", () => {
    for (const file of sources(join(root, "src"))) {
      for (const block of headerBlocks(readFileSync(file, "utf8"))) {
        if (block.includes("text/html") && block.includes('"referrer-policy": "no-referrer"')) {
          expect.fail(
            `${file}: a text/html writeHead sends no-referrer — a form on that page will POST Origin: null`,
          );
        }
      }
    }
  });

  it("every text/html writeHead in the three form-hosting files declares its chosen policy", () => {
    const expected: Record<string, string> = {
      "src/server/session.ts": '"referrer-policy": "same-origin"',
      "src/server/admin.ts": '"referrer-policy": "same-origin"',
      "src/server/oauth.ts": '"referrer-policy": "origin"',
    };
    for (const [rel, declaration] of Object.entries(expected)) {
      const content = readFileSync(join(root, rel), "utf8");
      const htmlBlocks = headerBlocks(content).filter((b) => b.includes("text/html"));
      expect(htmlBlocks.length, `${rel} serves HTML`).toBeGreaterThan(0);
      for (const block of htmlBlocks) {
        expect(block, `${rel}: a text/html writeHead must declare ${declaration}`).toContain(
          declaration,
        );
      }
    }
  });

  it("every remaining no-referrer DECLARATION in src/ is a named non-document — a new page copied from an old header block goes red", () => {
    // Count declarations, not prose: the fix's own comments name the banned policy by name.
    const DECLARATION = '"referrer-policy": "no-referrer"';
    const counts = new Map<string, number>();
    for (const file of sources(join(root, "src"))) {
      const n = readFileSync(file, "utf8").split(DECLARATION).length - 1;
      if (n > 0) counts.set(file.slice(root.length + 1).replaceAll("\\", "/"), n);
    }
    expect(Object.fromEntries([...counts.entries()].sort())).toEqual({
      "src/server/admin.ts": 1, // the 303 after an admin POST — a redirect, not a document
      "src/server/oauth.ts": 3, // register JSON, token JSON, and the authorize 302
      "src/server/session.ts": 1, // the JSON helper (refusals) — no form ever renders from JSON
    });
  });
});
