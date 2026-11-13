import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEEWAY_CONTROLS, SWITCH_CONTROLS } from "../../src/gateway/leeway-copy.js";
import { containerClaims, readContainerTable } from "../../src/gateway/container-law.js";
import { SEALED_LEEWAY } from "../../src/gateway/leeway.js";
import { signClaims } from "@bombadil/rhizomatic";
import { AUTHORIZE_PATH } from "../../src/server/oauth.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import { ADMIN_CONTAINER_PATH, ADMIN_LEEWAY_PATH } from "../../src/server/admin-pages.js";
import { signIn, formTokenOf, SAME_ORIGIN } from "../helpers/session-fixture.js";
import {
  closeAll,
  connect,
  connectionServer,
  CLIENT_ID,
  OPERATOR,
  OPERATOR_SEED,
  PASSWORD,
  pkce,
} from "../helpers/connection-fixture.js";
import { withStamp } from "../../src/gateway/stamp.js";

const flat = (s: string): string => s.replace(/\s+/g, " ").trim();
const text = (html: string): string =>
  flat(
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );

const consentPage = async (base: string, user: string): Promise<string> => {
  const session = await signIn(base, user, PASSWORD);
  const p = pkce();
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: "https://app.example/cb",
    state: "st-1",
    response_type: "code",
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  });
  const res = await fetch(`${base}${AUTHORIZE_PATH}?${query}`, {
    headers: { cookie: `${SESSION_COOKIE}=${session}` },
    redirect: "manual",
  });
  expect(res.status).toBe(200);
  return await res.text();
};

const containerPage = async (
  base: string,
  user: string,
  name: string,
): Promise<{ html: string; session: string }> => {
  const session = await signIn(base, user, PASSWORD);
  const res = await fetch(`${base}${ADMIN_CONTAINER_PATH}?name=${encodeURIComponent(name)}`, {
    headers: { cookie: `${SESSION_COOKIE}=${session}` },
  });
  expect(res.status).toBe(200);
  return { html: await res.text(), session };
};

const wiringOf = (html: string): { labels: string[]; described: string[]; ids: string[] } => ({
  labels: [...html.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1]!),
  described: [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]!),
  ids: [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!),
});

describe("§58 — the five controls, in words", () => {
  it("the copy module IS the spec's five bullets, word for word", () => {
    const spec = readFileSync(".adlc/specs/58-a-connection-is-a-peer.md", "utf8");
    const block = spec.slice(
      spec.indexOf("   - **Receive**"),
      spec.indexOf("The five are native controls"),
    );
    expect(block.length, "the spec's own five are where this rail looks for them").toBeGreaterThan(
      500,
    );
    const bullets = block
      .split(/\n {3}- /)
      .map((b) => flat(b.replace(/\*/g, "")).replace(/^- /, ""))
      .filter((b) => b.length > 0);
    expect(bullets, "five bullets, no more and no fewer").toHaveLength(5);
    expect(LEEWAY_CONTROLS, "and five controls to match them").toHaveLength(5);
    LEEWAY_CONTROLS.forEach((c, i) => {
      expect(flat(`${c.label} — ${c.capability} ${c.risk}`), `${c.label}, word for word`).toBe(
        bullets[i],
      );
    });
  });

  it("the consent page renders all five, unchecked, with every label and description bound", async () => {
    const { base } = await connectionServer();
    const html = await consentPage(base, "ada");
    const shown = text(html);
    for (const c of LEEWAY_CONTROLS) {
      expect(shown, `${c.label}: capability`).toContain(flat(c.capability));
      expect(shown, `${c.label}: risk`).toContain(flat(c.risk));
    }
    for (const c of SWITCH_CONTROLS) {
      expect(html).toMatch(new RegExp(`<input type="checkbox" id="leeway_${c.field}"`));
      expect(html, `${c.label} is off by default`).not.toMatch(
        new RegExp(`id="leeway_${c.field}"[^>]*checked`),
      );
    }
    expect(html, "delegate is off by default").not.toMatch(/id="leeway_delegate"[^>]*checked/);
    expect(html, "the envelope starts small").toMatch(/<option value="small" selected>/);
    expect(html, "delegate's terms are there to unfold").toContain('id="delegate_terms"');
    const wiring = wiringOf(html);
    for (const id of [...wiring.labels, ...wiring.described]) {
      expect(wiring.ids, `${id} is a real element`).toContain(id);
    }
    for (const c of LEEWAY_CONTROLS) {
      expect(wiring.labels, `${c.label} has a label`).toContain(`leeway_${c.field}`);
      expect(wiring.described, `${c.label} has its risk bound`).toContain(`leeway_${c.field}_risk`);
      const para = html.match(
        new RegExp(`<p class="risk" id="leeway_${c.field}_risk">([^<]*)</p>`),
      );
      expect(para, `${c.label} has a risk paragraph`).not.toBeNull();
      expect(text(para![1]!), `${c.label}'s paragraph carries ${c.label}'s risk`).toBe(
        flat(c.risk),
      );
    }
    await closeAll();
  });

  it("what the person checks on the consent page is what the container declares", async () => {
    const { base, gateway } = await connectionServer();
    const session = await signIn(base, "ada", PASSWORD);
    const p = pkce();
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: "https://app.example/cb",
      state: "st-1",
      response_type: "code",
      code_challenge: p.challenge,
      code_challenge_method: "S256",
    });
    const page = await fetch(`${base}${AUTHORIZE_PATH}?${query}`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      redirect: "manual",
    });
    const res = await fetch(`${base}${AUTHORIZE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        form_token: formTokenOf(await page.text()),
        client_id: CLIENT_ID,
        redirect_uri: "https://app.example/cb",
        state: "st-1",
        response_type: "code",
        code_challenge: p.challenge,
        code_challenge_method: "S256",
        bind_new: "journal",
        leeway_receive: "on",
        leeway_envelope: "medium",
        leeway_delegate: "on",
        terms_receive: "on",
        terms_envelope: "small",
      }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const rec = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    ).containers.get("ada:journal");
    expect(rec?.leewayDeclared, "the person spoke, so the container did").toBe(true);
    expect(rec?.leeway).toEqual({
      receive: true,
      offer: false,
      publish: false,
      envelope: "medium",
      delegate: { receive: true, offer: false, publish: false, envelope: "small", delegate: "off" },
    });
    await closeAll();
  });

  it("a person who checks nothing creates the private journal", async () => {
    const { base, gateway } = await connectionServer();
    const session = await signIn(base, "bea", PASSWORD);
    const p = pkce();
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: "https://app.example/cb",
      state: "st-1",
      response_type: "code",
      code_challenge: p.challenge,
      code_challenge_method: "S256",
    });
    const page = await fetch(`${base}${AUTHORIZE_PATH}?${query}`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      redirect: "manual",
    });
    const res = await fetch(`${base}${AUTHORIZE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        form_token: formTokenOf(await page.text()),
        client_id: CLIENT_ID,
        redirect_uri: "https://app.example/cb",
        state: "st-1",
        response_type: "code",
        code_challenge: p.challenge,
        code_challenge_method: "S256",
        bind_new: "notes",
      }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const rec = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    ).containers.get("bea:notes");
    expect(rec, "the container stands").toBeDefined();
    expect(rec?.leewayDeclared, "and it declared nothing, so it inherits").toBe(false);
    await closeAll();
  });

  it("a person who leaves them off where the room above is wider declares the seal", async () => {
    const { base, gateway } = await connectionServer();
    await connect(base, "ada", "elsewhere");
    const home = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    ).containers.get("ada")!;
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(OPERATOR), (t) =>
          containerClaims(
            {
              container: "ada",
              trust: home.trust,
              posture: home.posture,
              ...(home.membership === undefined ? {} : { membership: home.membership }),
              leeway: { ...SEALED_LEEWAY, receive: true },
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const session = await signIn(base, "ada", PASSWORD);
    const p = pkce();
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: "https://app.example/cb",
      state: "st-1",
      response_type: "code",
      code_challenge: p.challenge,
      code_challenge_method: "S256",
    });
    const page = await fetch(`${base}${AUTHORIZE_PATH}?${query}`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      redirect: "manual",
    });
    const html = await page.text();
    expect(html, "receive reads back on, because the room above allows it").toMatch(
      /id="leeway_receive"[^>]*checked/,
    );
    const res = await fetch(`${base}${AUTHORIZE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        form_token: formTokenOf(html),
        client_id: CLIENT_ID,
        redirect_uri: "https://app.example/cb",
        state: "st-1",
        response_type: "code",
        code_challenge: p.challenge,
        code_challenge_method: "S256",
        bind_new: "journal",
        leeway_envelope: "small",
        terms_envelope: "small",
      }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const rec = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    ).containers.get("ada:journal");
    expect(rec?.leewayDeclared, "the answer is written down").toBe(true);
    expect(rec?.leeway.receive, "and it is the seal they chose").toBe(false);
    await closeAll();
  });

  it("the container's own page shows the same five, reading what it declared, and saves them", async () => {
    const { base, gateway } = await connectionServer();
    const session = await signIn(base, "ada", PASSWORD);
    const p = pkce();
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: "https://app.example/cb",
      state: "st-1",
      response_type: "code",
      code_challenge: p.challenge,
      code_challenge_method: "S256",
    });
    const page = await fetch(`${base}${AUTHORIZE_PATH}?${query}`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      redirect: "manual",
    });
    await fetch(`${base}${AUTHORIZE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        form_token: formTokenOf(await page.text()),
        client_id: CLIENT_ID,
        redirect_uri: "https://app.example/cb",
        state: "st-1",
        response_type: "code",
        code_challenge: p.challenge,
        code_challenge_method: "S256",
        bind_new: "journal",
        leeway_envelope: "small",
        leeway_receive: "on",
      }).toString(),
      redirect: "manual",
    });
    const shown = await containerPage(base, "ada", "ada:journal");
    for (const c of LEEWAY_CONTROLS) {
      expect(text(shown.html), `${c.label}: capability`).toContain(flat(c.capability));
      expect(text(shown.html), `${c.label}: risk`).toContain(flat(c.risk));
    }
    expect(shown.html, "receive reads back on").toMatch(/id="leeway_receive"[^>]*checked/);
    expect(shown.html, "offer reads back off").not.toMatch(/id="leeway_offer"[^>]*checked/);
    const saved = await fetch(`${base}${ADMIN_LEEWAY_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${shown.session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        form_token: formTokenOf(shown.html),
        name: "ada:journal",
        leeway_publish: "on",
        leeway_envelope: "large",
      }).toString(),
      redirect: "manual",
    });
    expect(saved.status).toBe(303);
    const rec = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    ).containers.get("ada:journal");
    expect(rec?.leeway).toEqual({
      receive: false,
      offer: false,
      publish: true,
      envelope: "large",
      delegate: "off",
    });
    await closeAll();
  });

  it("a pool is not shaped here: its page names its host, and the save door refuses it", async () => {
    const { base, gateway } = await connectionServer();
    await connect(base, "ada", "journal");
    const inbox = [...gateway.connectionInboxes.keys()][0]!;
    const before = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    ).containers.get(inbox)!;
    expect(before.inboxOf, "premise: it is a pool of ada:journal").toBe("ada:journal");
    const shown = await containerPage(base, "ada", inbox);
    expect(shown.html, "the page reaches it").toContain(inbox);
    expect(text(shown.html), "and names where its leeway comes from").toContain(
      "takes its leeway from",
    );
    expect(shown.html, "and offers no form").not.toContain('action="/admin/leeway"');
    const refused = await fetch(`${base}${ADMIN_LEEWAY_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${shown.session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        form_token: formTokenOf(shown.html),
        name: inbox,
        leeway_receive: "on",
        leeway_envelope: "small",
      }).toString(),
      redirect: "manual",
    });
    expect(refused.status).toBe(409);
    const after = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    ).containers.get(inbox)!;
    expect(after.inboxOf, "the pool keeps its host").toBe("ada:journal");
    expect(after.leewayDeclared, "and declares nothing of its own").toBe(false);
    await closeAll();
  });

  it("saving a leeway carries the container's record whole", async () => {
    const { base, gateway } = await connectionServer();
    const session = await signIn(base, "ada", PASSWORD);
    const p = pkce();
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: "https://app.example/cb",
      state: "st-1",
      response_type: "code",
      code_challenge: p.challenge,
      code_challenge_method: "S256",
    });
    const page = await fetch(`${base}${AUTHORIZE_PATH}?${query}`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      redirect: "manual",
    });
    await fetch(`${base}${AUTHORIZE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        form_token: formTokenOf(await page.text()),
        client_id: CLIENT_ID,
        redirect_uri: "https://app.example/cb",
        state: "st-1",
        response_type: "code",
        code_challenge: p.challenge,
        code_challenge_method: "S256",
        bind_new: "journal",
        leeway_envelope: "small",
      }).toString(),
      redirect: "manual",
    });
    const before = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    ).containers.get("ada:journal")!;
    expect(before.parent, "premise: it is a child of the home").toBe("ada");
    expect(before.membership, "premise: it is a shared container with a membership").toBeDefined();
    const shown = await containerPage(base, "ada", "ada:journal");
    const saved = await fetch(`${base}${ADMIN_LEEWAY_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${shown.session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        form_token: formTokenOf(shown.html),
        name: "ada:journal",
        leeway_receive: "on",
        leeway_envelope: "small",
      }).toString(),
      redirect: "manual",
    });
    expect(saved.status).toBe(303);
    const after = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    ).containers.get("ada:journal")!;
    expect(after.leeway.receive, "the leeway is what changed").toBe(true);
    expect(after.parent, "and the parent rode along").toBe("ada");
    expect(after.membership, "and so did the membership").toEqual(before.membership);
    expect(after.trust).toBe(before.trust);
    expect(after.posture).toBe(before.posture);
    expect(after.version, "and the version").toBe(before.version);
    await closeAll();
  });

  it("a leeway the terms above it refuse is refused here, in the sentence that names the ceiling", async () => {
    const { base, gateway } = await connectionServer();
    const session = await signIn(base, "ada", PASSWORD);
    const p = pkce();
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: "https://app.example/cb",
      state: "st-1",
      response_type: "code",
      code_challenge: p.challenge,
      code_challenge_method: "S256",
    });
    const page = await fetch(`${base}${AUTHORIZE_PATH}?${query}`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      redirect: "manual",
    });
    await fetch(`${base}${AUTHORIZE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        form_token: formTokenOf(await page.text()),
        client_id: CLIENT_ID,
        redirect_uri: "https://app.example/cb",
        state: "st-1",
        response_type: "code",
        code_challenge: p.challenge,
        code_challenge_method: "S256",
        bind_new: "journal",
        leeway_envelope: "small",
        leeway_receive: "on",
      }).toString(),
      redirect: "manual",
    });
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(OPERATOR), (t) =>
          containerClaims(
            {
              container: "ada:journal:annex",
              trust: "curated",
              posture: "separate",
              parent: "ada:journal",
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const annex = await containerPage(base, "ada", "ada:journal:annex");
    const refused = await fetch(`${base}${ADMIN_LEEWAY_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${SESSION_COOKIE}=${annex.session}`,
        ...SAME_ORIGIN,
      },
      body: new URLSearchParams({
        form_token: formTokenOf(annex.html),
        name: "ada:journal:annex",
        leeway_receive: "on",
      }).toString(),
      redirect: "manual",
    });
    expect(refused.status).toBe(409);
    const why = text(await refused.text());
    expect(why, "the sentence names the ceiling").toContain("delegates nothing");
    expect(why).toContain("Nothing was changed");
    const rec = readContainerTable(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    ).containers.get("ada:journal:annex");
    expect(rec?.leewayDeclared, "and nothing was declared").toBe(false);
    await closeAll();
  });
});
