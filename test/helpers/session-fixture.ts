// T152 — the ONE session fixture. signIn/cookiesOf/valueOf/SAME_ORIGIN were re-implemented
// near-identically across ~15 server test files and both browser-era suites; every FUTURE server
// rail imports THIS file instead of writing a sixteenth copy. Frozen files keep their own copies
// forever — that is the freeze working (T152) — so nothing existing is refactored here.
//
// The helper drives the REAL login door — form token, presession nonce, session cookie — the same
// flow a browser follows. A mock around it would test the mock.

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
  const nonce = valueOf(cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
  const res = await fetch(`${base}/login`, {
    method: "POST",
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
  return valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
}
