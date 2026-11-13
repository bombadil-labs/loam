import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";

export const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

export const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();

export const valueOf = (header: string): string =>
  header.slice(header.indexOf("=") + 1, header.indexOf(";"));

export const formTokenOf = (html: string): string =>
  /name="form_token" value="([^"]+)"/.exec(html)![1]!;

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
    throw new Error(`signIn: the login door refused ${user} (${res.status})`);
  }
  return valueOf(session);
}
