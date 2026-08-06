// T152 — the ONE session fixture. signIn/cookiesOf/valueOf/SAME_ORIGIN were re-implemented
// near-identical across ~15 server test files and both browser-era suites; every FUTURE server
// rail imports THIS file instead of writing a sixteenth copy. Frozen files keep their own copies
// forever — that is the freeze working (T152) — so nothing existing is refactored here.
//
// SCOPE, stated plainly: the helper unifies the LOGIN HANDSHAKE and the cookie/HTML utilities.
// The door bootstrap (gateway, credentials, serve) and the session-bound form-token extraction
// still belong to each consumer — part 2/2 of T152's consolidation, and the ticket's letter.
//
// The helper drives the REAL login door — form token, presession nonce, session cookie — the same
// flow a browser follows. A mock around it would test the mock. Every failure names its stage.

import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";

export const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

/** The raw Set-Cookie headers of a response (a session and a presession nonce both ride here). */
export const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();

/** A cookie header's value: everything before the first `;`. */
export const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));

/** The hidden form_token every session and admin form carries. */
export const formTokenOf = (html: string): string =>
  /name="form_token" value="([^"]+)"/.exec(html)![1]!;

/** The session cookie a real browser would hold after the login door accepts. */
export async function signIn(base: string, user: string, password: string): Promise<string> {
  const form = await fetch(`${base}/login`, { redirect: "manual" });
  if (form.status !== 200) {
    throw new Error(`signIn: the login form refused this door (${form.status})`);
  }
  const nonce = valueOf(cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
  const res = await fetch(`${base}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${PRESESSION_COOKIE}=${nonce}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({
      form_token: formTokenOf(await form.text()),
      user,
      password,
    }).toString(),
  });
  const session = cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (session === undefined) {
    // A refusal (wrong password, locked door) lands here without a session cookie; name it rather
    // than leaking a cookie-parse TypeError at the consumer.
    throw new Error(`signIn: the login door refused ${user} (${res.status})`);
  }
  return valueOf(session);
}
