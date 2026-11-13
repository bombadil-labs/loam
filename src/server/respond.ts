import type { ServerResponse } from "node:http";

export const JSON_CONTENT_TYPE = "application/json";
export const CACHE_NO_STORE = "no-store";

export function endJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { ...headers, "content-type": JSON_CONTENT_TYPE });
  res.end(JSON.stringify(body));
}
