// §37 (T114), criteria (a) (b) (c) (d) (e): how a connector FINDS the authorization server.
//
// What these rails assert, and what they deliberately do not. They assert the two well-known
// documents and the challenge header — the discovery half of §37, which is all a caller may read
// without any credential at all. They do not assert that a token works; that is oauth-flow.
//
// The load-bearing one is (b). RFC 9728 asks a protected resource to say WHERE its authorization
// server is, and the naive place to say it is the door that refused. But the MCP door's refusal is
// the same refusal an absent mount gives, and it is the same on purpose (§12/T78): a tokenless
// caller must not be able to tell a mount that exists from one that never did. A header attached to
// one and not the other would re-open that oracle through the response's other half. So the
// challenge is a CONSTANT of the server, and these rails compare the two refusals byte for byte.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSWORD,
  bootStore,
  createUser,
  dropHome,
  makeHome,
  serveHome,
  type Served,
} from "./user-fixture.js";
import { serveOAuth, type ServedOAuth } from "./oauth-fixture.js";

vi.setConfig({ testTimeout: 20000 });

let home: string;
let served: ServedOAuth;

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
  served = await serveOAuth(home);
});
afterEach(async () => {
  await served?.close();
  dropHome(home);
});

/**
 * Every header a response carries, lower-cased, EXCEPT `date`. Date is the one header that cannot be
 * equal across two requests and carries no knowledge about the store — excluding it is what lets the
 * rest be compared whole rather than one name at a time, which is the comparison criterion (b) wants.
 */
const headersOf = (res: Response): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, value] of res.headers) {
    if (name.toLowerCase() !== "date") out[name.toLowerCase()] = value;
  }
  return out;
};

const post = (path: string, body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" }) =>
  fetch(`${served.base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("the challenge header", () => {
  it("(a) an unauthenticated POST /:mount/mcp names the protected-resource metadata URL", async () => {
    const res = await post("/default/mcp");
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate");
    expect(challenge).not.toBeNull();
    // The header must be a Bearer challenge naming the metadata URL — the exact thing RFC 9728 asks
    // for and the exact thing claude.ai reads to find the authorization server.
    expect(challenge).toMatch(/^Bearer /);
    const url = /resource_metadata="([^"]+)"/.exec(challenge!)?.[1];
    expect(url).toBe(`${served.base}/.well-known/oauth-protected-resource`);
    // And it must actually resolve: a challenge naming a 404 is a report that overclaims.
    const metadata = await fetch(url!);
    expect(metadata.status).toBe(200);
  });

  it("(b) that refusal is byte-identical, headers included, to an absent mount's", async () => {
    const real = await post("/default/mcp");
    const absent = await post("/no-such-mount-anywhere/mcp");
    expect(real.status).toBe(absent.status);
    expect(await real.text()).toBe(await absent.text());
    expect(headersOf(real)).toEqual(headersOf(absent));
  });

  it("(b) and identical for a mount that existed and was taken down", async () => {
    // The other half of the same oracle: a name whose world has LEFT must read exactly as one that
    // never arrived. A challenge computed per mount would differ here.
    const before = await post("/default/mcp");
    const absent = await post("/never-mounted/mcp");
    expect(headersOf(before)).toEqual(headersOf(absent));
    // A bad token is a third shape, and it is the same shape: presented-but-wrong never downgrades.
    const wrong = await fetch(`${served.base}/default/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer not-a-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(headersOf(wrong)).toEqual(headersOf(absent));
    expect(await wrong.text()).toBe(await absent.text());
  });

  it("(a) the challenge rides EVERY refusal, not only the MCP door's", async () => {
    // The header is a property of the server, so a caller that probed graphql first must find the
    // same signpost. A per-door header would make the signpost itself a door-existence oracle.
    for (const path of ["/default/graphql", "/default/rest/plant", "/default/subscribe?query=x"]) {
      const res = await fetch(`${served.base}${path}`);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toMatch(/resource_metadata=/);
    }
  });

  it("a store with the OAuth doors CLOSED sends no challenge at all", async () => {
    // Without this the rail above could pass on a hard-coded header. §37 is opt-in: a home serving
    // without --oauth-allow-redirect is exactly the store it was before §37.
    await served.close();
    const plain: Served = await serveHome(home);
    try {
      const res = await fetch(`${plain.base}/default/mcp`, { method: "POST", body: "{}" });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBeNull();
      expect((await fetch(`${plain.base}/.well-known/oauth-authorization-server`)).status).toBe(
        401,
      );
    } finally {
      await plain.close();
    }
  });
});

describe("the two well-known documents", () => {
  const wellKnown = async (name: string): Promise<Record<string, unknown>> => {
    const res = await fetch(`${served.base}/.well-known/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    return (await res.json()) as Record<string, unknown>;
  };

  it("(c) the resource document names this resource and its authorization server", async () => {
    const doc = await wellKnown("oauth-protected-resource");
    expect(doc["resource"]).toBe(served.base);
    expect(doc["authorization_servers"]).toEqual([served.base]);
    expect(doc["bearer_methods_supported"]).toEqual(["header"]);
  });

  it("(c) the AS document names all three endpoints and requires PKCE S256", async () => {
    const doc = await wellKnown("oauth-authorization-server");
    expect(doc["authorization_endpoint"]).toBe(`${served.base}/oauth/authorize`);
    expect(doc["token_endpoint"]).toBe(`${served.base}/oauth/token`);
    expect(doc["registration_endpoint"]).toBe(`${served.base}/oauth/register`);
    expect(doc["response_types_supported"]).toEqual(["code"]);
    expect(doc["grant_types_supported"]).toEqual(["authorization_code"]);
    // S256 and ONLY S256. `plain` in this list would let a caller skip PKCE entirely while the
    // document still said the word "PKCE".
    expect(doc["code_challenge_methods_supported"]).toEqual(["S256"]);
    // A public client: no secret to leak, which is why the redirect allowlist carries the weight.
    expect(doc["token_endpoint_auth_methods_supported"]).toEqual(["none"]);
  });

  it("(c) the two documents AGREE: the resource's server is the document's issuer", async () => {
    const resource = await wellKnown("oauth-protected-resource");
    const as = await wellKnown("oauth-authorization-server");
    expect(resource["authorization_servers"]).toEqual([as["issuer"]]);
  });

  it("(c) every advertised endpoint actually answers", async () => {
    // A document is a promise about what exists. Three URLs that 404 would be the report overclaiming
    // — and this rail is what stops a later rename from leaving the document behind.
    const as = await wellKnown("oauth-authorization-server");
    for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
      const res = await fetch(as[key] as string, { method: "POST", body: "" });
      expect(res.status, `${key} answered nothing`).not.toBe(404);
    }
  });

  it("(d) every URL comes from the configured public URL, not the request", async () => {
    await served.close();
    const configured = "https://nemo.example.test:8443";
    served = await serveOAuth(home, { users: { publicUrl: configured } });
    const doc = (await (
      await fetch(`${served.base}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>;
    expect(doc["issuer"]).toBe(configured);
    expect(doc["authorization_endpoint"]).toBe(`${configured}/oauth/authorize`);
    expect(doc["token_endpoint"]).toBe(`${configured}/oauth/token`);
    expect(doc["registration_endpoint"]).toBe(`${configured}/oauth/register`);
    // and the challenge header rides the same source
    const refused = await fetch(`${served.base}/default/mcp`, { method: "POST", body: "{}" });
    expect(refused.headers.get("www-authenticate")).toContain(
      `${configured}/.well-known/oauth-protected-resource`,
    );
  });

  it("(d) a foreign Host and X-Forwarded-* change nothing, byte for byte", async () => {
    // The whole attack this closes: a caller who can set Host can otherwise make the store advertise
    // an authorization server the caller runs, and the browser will go there to sign in.
    const honest = await fetch(`${served.base}/.well-known/oauth-authorization-server`);
    const lying = await fetch(`${served.base}/.well-known/oauth-authorization-server`, {
      headers: {
        host: "attacker.example",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
        "x-forwarded-port": "443",
        forwarded: "host=attacker.example;proto=https",
      },
    });
    expect(await lying.text()).toBe(await honest.text());

    const honestResource = await fetch(`${served.base}/.well-known/oauth-protected-resource`);
    const lyingResource = await fetch(`${served.base}/.well-known/oauth-protected-resource`, {
      headers: { host: "attacker.example", "x-forwarded-host": "attacker.example" },
    });
    expect(await lyingResource.text()).toBe(await honestResource.text());
    // and the same for the challenge, which is the one a client reads FIRST
    const refused = await fetch(`${served.base}/default/mcp`, {
      method: "POST",
      body: "{}",
      headers: { host: "attacker.example", "x-forwarded-host": "attacker.example" },
    });
    expect(refused.headers.get("www-authenticate")).not.toContain("attacker.example");
  });

  it("(e) the issuer the AS document advertises is the one the token endpoint validates", async () => {
    // ONE SOURCE. A `resource` indicator (RFC 8707) that matches the advertised issuer is accepted; a
    // foreign one is refused. Two sources would let the document say one thing and the door check
    // another, and a connector configured from the document would be refused by the door.
    const doc = (await (
      await fetch(`${served.base}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>;
    const issuer = doc["issuer"] as string;

    const mine = await fetch(`${served.base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "not-a-real-code",
        resource: issuer,
      }).toString(),
    });
    const foreign = await fetch(`${served.base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "not-a-real-code",
        resource: "https://attacker.example",
      }).toString(),
    });
    // Both refuse — there is no such code — but for DIFFERENT named reasons, which is what proves the
    // resource check ran and read the advertised issuer.
    const mineBody = (await mine.json()) as { error?: string };
    const foreignBody = (await foreign.json()) as { error?: string };
    expect(foreignBody.error).toBe("invalid_target");
    expect(mineBody.error).toBe("invalid_grant");
  });
});
