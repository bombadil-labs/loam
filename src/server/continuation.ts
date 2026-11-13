export const AUTHORIZE_PATH = "/oauth/authorize";

export const CONTINUE_FIELD = "continue";

const AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource",
] as const;

const MAX_CONTINUATION = 8192;

export function authorizeContinuation(query: string): string | undefined {
  if (query.length > MAX_CONTINUATION) return undefined;
  const presented = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const kept = new URLSearchParams();
  for (const name of AUTHORIZE_PARAMS) {
    const value = presented.get(name);
    if (value !== null) kept.set(name, value);
  }
  const carried = kept.toString();
  return carried === "" ? undefined : carried;
}

export function resumeTarget(carried: string): string | undefined {
  const query = authorizeContinuation(carried);
  return query === undefined ? undefined : `${AUTHORIZE_PATH}?${query}`;
}
