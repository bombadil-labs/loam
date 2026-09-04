// T263 — THE FIVE CONTROLS IN WORDS (SPEC §58 position 4, criterion 4). A person meets the same
// five sentences wherever a leeway is set: on the consent page, where a container is created, and
// on that container's own page, where it changes later. The copy is part of the spec, because it
// is the promise — so this file holds the two pages to the spec's own words, not to a paraphrase.
//
// Railed at BOTH LEVELS: the MARKUP a person is served (native controls, every label bound to its
// input, every risk bound by aria-describedby, every switch off by default) and what a submitted
// form DECLARES (the container reads the leeway the person checked, and a leeway that does not fit
// the terms above it is refused with the sentence naming the ceiling).
//
// THE SPEC IS THE SOURCE. One case reads .adlc/specs/58-a-connection-is-a-peer.md and holds the
// copy module against it, whitespace apart. When the landing slice moves that section to
// spec/58-*.md, this case must be re-pointed there — a copy rail that reads nothing is a copy rail
// that passes.
//
// RAILS-RED on origin/main: the file does not COLLECT there — it imports a copy module and a form
// module that do not exist yet — which is an honest red and a useless one. Measured properly, with
// those two modules copied in beside it: 5 red, 2 green of 7. The two greens are CONTROLS and say
// so: the copy module matches the spec's words wherever it sits, and a person who submits no
// controls at all creates a container that declares nothing, which main already did. The five reds
// are the pages themselves, which is what this slice builds.
//
// REVERT PROBES, MEASURED against this file as it stands — 7 cases. Re-measure when you add one.
//   every switch renders checked                            → 2 red, 5 green
//   consent declares nothing the person chose               → 4 red, 3 green
//   a silent form seals by silence                          → 1 red, 6 green
//   the choice is written even where it matches what is     → 5 red, 2 green
//     inherited
//   the page ignores what the container would inherit       → 2 red, 5 green
//   the risk sentence is not bound to its input             → 1 red, 6 green
//   saving keeps the old leeway                             → 2 red, 5 green
//   a refused save is reported as saved                     → 1 red, 6 green
//
// NOT HERE, and said so: a POOL's page. An inbox or a channel pool is reachable from no person's
// container page — the door fences that page to the person's own subtree, which parent edges walk
// and an inboxOf edge does not join — so a pool renders no leeway form and this file cannot ask
// for one. The slice that gives a pool a page owes the question with it.
//
// NOT HERE, and said so: the browser drives these controls in test/browser/leeway-controls.test.ts,
// which is where "unfolds beneath it when on" is proven, since a CSS rule is not a string this
// file can read.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DELEGATE_CONTROL,
  ENVELOPE_CONTROL,
  LEEWAY_CONTROLS,
  SWITCH_CONTROLS,
} from "../../src/gateway/leeway-copy.js";
import { containerClaims, readContainerTable } from "../../src/gateway/container.js";
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

/** Whitespace is layout, not copy: the spec wraps its sentences, the page wraps them elsewhere. */
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();
/** What a browser shows, near enough: tags out, entities back. */
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

/** Every id a label or a description points at exists, and every input has a label. */
const wiringOf = (html: string): { labels: string[]; described: string[]; ids: string[] } => ({
  labels: [...html.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1]!),
  described: [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]!),
  ids: [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!),
});

describe("§58 — the five controls, in words", () => {
  it("the copy module carries the spec's own sentences", () => {
    // The spec italicises its capability lines and one phrase inside Delegate's risk; the copy
    // module carries the words, not the emphasis.
    const spec = flat(
      readFileSync(".adlc/specs/58-a-connection-is-a-peer.md", "utf8").replace(/\*/g, ""),
    );
    expect(spec, "the working spec is where this copy comes from").toContain(
      "Every switch starts off",
    );
    for (const c of LEEWAY_CONTROLS) {
      expect(spec, `${c.label}: capability`).toContain(flat(c.capability));
      // The spec italicises "The risk:" and the module writes it plain; compare the halves.
      for (const half of flat(c.risk).split(/The risk:/)) {
        if (half.trim().length > 0) expect(spec, `${c.label}: risk`).toContain(half.trim());
      }
    }
  });

  it("the consent page renders all five, unchecked, with every label and description bound", async () => {
    const { base } = await connectionServer();
    const html = await consentPage(base, "ada");
    const shown = text(html);
    for (const c of LEEWAY_CONTROLS) {
      expect(shown, `${c.label}: capability`).toContain(flat(c.capability));
      expect(shown, `${c.label}: risk`).toContain(flat(c.risk));
    }
    // Native controls, and every switch off: the private journal is what a person gets by
    // clicking through without reading.
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
    const rec = readContainerTable(gateway.reactor, gateway.operatorAuthor).containers.get(
      "ada:journal",
    );
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
    const rec = readContainerTable(gateway.reactor, gateway.operatorAuthor).containers.get(
      "bea:notes",
    );
    expect(rec, "the container stands").toBeDefined();
    expect(rec?.leewayDeclared, "and it declared nothing, so it inherits").toBe(false);
    await closeAll();
  });

  it("a person who leaves them off where the room above is wider declares the seal", async () => {
    // The page shows what this container will have, which before they touch anything is what the
    // room above allows. Leaving that alone declares nothing and inherits. Turning it OFF is an
    // answer, and an answer is written down — or the page would show a switch off and hand them a
    // room that receives.
    const { base, gateway } = await connectionServer();
    // The home is made the way a person makes it, then given a leeway the way its own page would:
    // its record carried forward whole, with the leeway written over it.
    await connect(base, "ada", "elsewhere");
    const home = readContainerTable(gateway.reactor, gateway.operatorAuthor).containers.get("ada")!;
    await gateway.append([
      signClaims(
        containerClaims(
          {
            container: "ada",
            trust: home.trust,
            posture: home.posture,
            ...(home.membership === undefined ? {} : { membership: home.membership }),
            leeway: { ...SEALED_LEEWAY, receive: true },
          },
          OPERATOR,
          gateway.nextTimestamp(),
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
    // The page shows the inherited state, not a blank one.
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
        // Every box unchecked, and the select the browser always sends.
        leeway_envelope: "small",
        terms_envelope: "small",
      }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const rec = readContainerTable(gateway.reactor, gateway.operatorAuthor).containers.get(
      "ada:journal",
    );
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
    // The same words, and the container's own answer inside them.
    for (const c of LEEWAY_CONTROLS) {
      expect(text(shown.html), `${c.label}: capability`).toContain(flat(c.capability));
      expect(text(shown.html), `${c.label}: risk`).toContain(flat(c.risk));
    }
    expect(shown.html, "receive reads back on").toMatch(/id="leeway_receive"[^>]*checked/);
    expect(shown.html, "offer reads back off").not.toMatch(/id="leeway_offer"[^>]*checked/);
    // Saving is a re-declaration, and the next read obeys it.
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
    const rec = readContainerTable(gateway.reactor, gateway.operatorAuthor).containers.get(
      "ada:journal",
    );
    expect(rec?.leeway).toEqual({
      receive: false,
      offer: false,
      publish: true,
      envelope: "large",
      delegate: "off",
    });
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
    // A room that delegates nothing, and a child inside it.
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
        containerClaims(
          {
            container: "ada:journal:annex",
            trust: "curated",
            posture: "separate",
            parent: "ada:journal",
          },
          OPERATOR,
          gateway.nextTimestamp(),
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
    const rec = readContainerTable(gateway.reactor, gateway.operatorAuthor).containers.get(
      "ada:journal:annex",
    );
    expect(rec?.leewayDeclared, "and nothing was declared").toBe(false);
    await closeAll();
  });
});
