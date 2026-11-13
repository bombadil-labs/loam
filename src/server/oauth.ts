import { createHash, randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { CACHE_NO_STORE, endJson, JSON_CONTENT_TYPE } from "./respond.js";
import { parseUrlEncoded, readBodyLenient } from "./body.js";
import { authorForSeed } from "@bombadil/rhizomatic";
import {
  OAuthFileBusy,
  OAuthFileUnlockable,
  clientFor,
  clientNameDefect,
  codeFor,
  grantFor,
  oauthPath,
  readOAuthFile,
  tokenFor,
  uriTextDefect,
  withOAuthFile,
  type OAuthClient,
  type OAuthCode,
  type OAuthFile,
  type OAuthGrant,
  type OAuthToken,
} from "./oauth-file.js";
import { CSP, escapeHtml, page, sameSecret, type SessionGate } from "./session.js";
import { AUTHORIZE_PATH, authorizeContinuation } from "./continuation.js";
import { cimdRedirectDefect, isCimdClientId, makeCimdFetcher, type CimdDocument } from "./cimd.js";
import type { Gateway } from "../gateway/gateway.js";
import { declareOwned, ensureUserKey, LEAF_RE } from "./provision.js";
import { bindableOf, isBindableName, subtreeOf } from "./subtree.js";
import { leewayFields, leewayFromFields } from "./leeway-form.js";
import { canonicalLeewayJson, SEALED_LEEWAY, type Leeway } from "../gateway/leeway.js";
import { governingLeeway } from "../gateway/container-law.js";

export const CONNECTOR_SCOPE = "loam.connector";

export function issuerFor(publicUrl: string): string {
  return publicUrl.replace(/\/+$/, "");
}

export function protectedResourceDocument(
  publicUrl: string,
  resourcePath = "",
): Record<string, unknown> {
  const issuer = issuerFor(publicUrl);
  return {
    resource: `${issuer}${resourcePath}`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [CONNECTOR_SCOPE],
  };
}

export function authorizationServerDocument(publicUrl: string): Record<string, unknown> {
  const issuer = issuerFor(publicUrl);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    scopes_supported: [CONNECTOR_SCOPE],
  };
}

export function challengeFor(publicUrl: string): string {
  return `Bearer resource_metadata="${issuerFor(publicUrl)}/.well-known/oauth-protected-resource"`;
}

export function publicUrlDefect(raw: string): string | undefined {
  const normalized = issuerFor(raw);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return `"${raw}" is not an absolute URL, so it names no origin`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `"${raw}" is not http or https — an OAuth issuer names an HTTP(S) origin`;
  }
  if (url.origin.toLowerCase() !== normalized.toLowerCase()) {
    return (
      `"${raw}" is not a bare origin — an origin is scheme://host[:port] and nothing else ` +
      `(this one reads as "${url.origin}")`
    );
  }
  return undefined;
}

export function canonicalPublicUrl(raw: string): string {
  return new URL(issuerFor(raw)).origin;
}

export interface ConnectorRegistration {
  readonly home: string;

  readonly allowRedirectOrigins: readonly string[];
  readonly maxClients?: number;
  readonly onFault?: (message: string) => void;

  readonly redeeming?: ReadonlyMap<string, number>;

  readonly cimdAllowPrivateOrigins?: readonly string[];
}

export interface OAuthOptions {
  readonly publicUrl: string;
  readonly registration?: ConnectorRegistration;
}

const MAX_BODY = 16 * 1024;
const MAX_URIS = 8;
const MAX_URI = 2048;
const DEFAULT_MAX_CLIENTS = 64;

export function redirectOriginDefect(origin: string): string | undefined {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return `"${origin}" is not an absolute URL, so it names no origin`;
  }
  if (url.origin !== origin) {
    return (
      `"${origin}" is not a bare origin — an origin is scheme://host[:port] and nothing else ` +
      `(this one reads as "${url.origin}")`
    );
  }
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (url.protocol !== "https:" && !loopback.has(url.hostname)) {
    return `"${origin}" is not https, and only a loopback host may be reached over http`;
  }
  return undefined;
}

function redirectUriDefect(uri: string, allowed: readonly string[]): string | undefined {
  if (allowed.length === 0) {
    return (
      `this store registers no connectors: its operator has named no permitted redirect origin. ` +
      `Serve with --oauth-allow-redirect <origin> to open §37.`
    );
  }
  if (uri.length === 0 || uri.length > MAX_URI) return `a redirect_uri is 1..${MAX_URI} characters`;
  const text = uriTextDefect(uri);
  if (text !== undefined) return `"${uri}" is not a redirect target: ${text}`;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return `"${uri}" is not an absolute URL`;
  }
  if (url.hash !== "" || uri.includes("#")) {
    return `"${uri}" carries a fragment, and a redirect target may not`;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    return `"${uri}" carries a percent-escape that does not decode`;
  }
  if (decoded !== uri) {
    return (
      `"${uri}" carries a percent-escape, and this door compares a redirect target as one exact ` +
      `string — it would be reached as "${decoded}", a spelling it was never registered under`
    );
  }
  if (!allowed.includes(url.origin)) {
    return `"${uri}" is not at an origin this store permits`;
  }
  const originDefect = redirectOriginDefect(url.origin);
  if (originDefect !== undefined) return `"${uri}" is not a permitted target: ${originDefect}`;
  return undefined;
}

export interface OAuthDoors {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): void;
  readonly challenge: string;
}

const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

const WELL_KNOWN_PATHS = new Set([
  RESOURCE_METADATA_PATH,
  "/.well-known/oauth-authorization-server",
]);

const mcpResourcePathOf = (pathname: string): string | undefined => {
  if (!pathname.startsWith(`${RESOURCE_METADATA_PATH}/`)) return undefined;
  const segments = pathname.slice(RESOURCE_METADATA_PATH.length + 1).split("/");
  if (segments.length !== 2 || segments[1] !== "mcp") return undefined;
  const mount = segments[0] ?? "";
  if (mount === "") return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(mount);
  } catch {
    return undefined;
  }
  if (encodeURIComponent(decoded) !== mount) return undefined;
  return `/${mount}/mcp`;
};

const REGISTER_PATH = "/oauth/register";

const OAUTH_PREFIX = "/oauth";

const doorAt = (documented: string): ((pathname: string) => boolean) => {
  if (!documented.startsWith(`${OAUTH_PREFIX}/`)) {
    throw new Error(
      `a connector door is named "${OAUTH_PREFIX}/<door>", and "${documented}" is not — ` +
        `its bare alias cannot be derived by dropping "${OAUTH_PREFIX}"`,
    );
  }
  const bare = documented.slice(OAUTH_PREFIX.length);
  return (pathname) => pathname === documented || pathname === bare;
};

const atRegisterPath = doorAt(REGISTER_PATH);

const readBody = (req: IncomingMessage): Promise<string | undefined> =>
  readBodyLenient(req, MAX_BODY);

export function makeOAuthDoors(options: OAuthOptions): OAuthDoors {
  const publicUrl = options.publicUrl;
  const registration = options.registration;

  const DISCOVERY_HEADERS = {
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  } as const;

  const documentFor = (pathname: string): Record<string, unknown> => {
    const resourcePath = mcpResourcePathOf(pathname);
    if (resourcePath !== undefined) return protectedResourceDocument(publicUrl, resourcePath);
    return pathname === RESOURCE_METADATA_PATH
      ? protectedResourceDocument(publicUrl)
      : authorizationServerDocument(publicUrl);
  };

  const wellKnown = (pathname: string, req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      endJson(
        res,
        405,
        { error: "this document answers GET" },
        {
          allow: "GET, HEAD",
          ...DISCOVERY_HEADERS,
        },
      );
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, { ...DISCOVERY_HEADERS, "content-type": JSON_CONTENT_TYPE });
      res.end();
      return;
    }
    endJson(res, 200, documentFor(pathname), DISCOVERY_HEADERS);
  };

  const home = registration?.home ?? "";
  const allowed = registration === undefined ? [] : [...registration.allowRedirectOrigins];
  const maxClients = registration?.maxClients ?? DEFAULT_MAX_CLIENTS;
  const onFault = registration?.onFault ?? ((message: string): void => void message);
  const redeeming = registration?.redeeming;

  const jsonOut = (res: ServerResponse, status: number, body: unknown): void =>
    endJson(res, status, body, {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "access-control-allow-origin": "*",
    });
  const refuse = (res: ServerResponse, status: number, error: string, description: string): void =>
    jsonOut(res, status, { error, error_description: description });

  const postRegister = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse((await readBody(req)) ?? "");
    } catch {
      refuse(res, 400, "invalid_client_metadata", "the body must be a JSON object");
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      refuse(res, 400, "invalid_client_metadata", "the body must be a JSON object");
      return;
    }
    const body = parsed as Record<string, unknown>;
    const name = body["client_name"];
    if (typeof name !== "string") {
      refuse(res, 400, "invalid_client_metadata", "client_name is a string");
      return;
    }
    const nameDefect = clientNameDefect(name);
    if (nameDefect !== undefined) {
      refuse(res, 400, "invalid_client_metadata", nameDefect);
      return;
    }
    const uris = body["redirect_uris"];
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_URIS) {
      refuse(
        res,
        400,
        "invalid_redirect_uri",
        `redirect_uris is an array of 1..${MAX_URIS} absolute URLs`,
      );
      return;
    }
    const checked: string[] = [];
    for (const uri of uris) {
      if (typeof uri !== "string") {
        refuse(res, 400, "invalid_redirect_uri", "every redirect_uri is a string");
        return;
      }
      const defect = redirectUriDefect(uri, allowed);
      if (defect !== undefined) {
        refuse(res, 400, "invalid_redirect_uri", defect);
        return;
      }
      checked.push(uri);
    }

    type Registered =
      | { kind: "ok"; client: OAuthClient }
      | { kind: "full" }
      | { kind: "unreadable" }
      | { kind: "locked" };

    let outcome: Registered;
    try {
      outcome = withOAuthFile<Registered>(home, (file) => {
        const pinned = new Set<string>([
          ...file.grants.map((g) => g.clientId),
          ...(file.codes ?? []).map((c) => c.clientId),
          ...(redeeming === undefined
            ? []
            : [...redeeming].filter(([, n]) => n > 0).map(([clientId]) => clientId)),
        ]);
        let clients = [...file.clients];
        while (clients.length >= maxClients) {
          const oldest = clients
            .filter((c) => !pinned.has(c.clientId))
            .sort((a, b) => a.registeredAt - b.registeredAt)[0];
          if (oldest === undefined) return { result: { kind: "full" as const } };
          clients = clients.filter((c) => c.clientId !== oldest.clientId);
        }
        const client: OAuthClient = {
          clientId: `connector-${randomBytes(16).toString("hex")}`,
          clientName: name,
          redirectUris: checked,
          registeredAt: Date.now(),
          generation: 1,
        };
        return {
          next: { ...file, clients: [...clients, client] },
          result: { kind: "ok" as const, client },
        };
      });
    } catch (err) {
      onFault(
        `the connector doors could not register a connector in ${oauthPath(home)}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      outcome =
        err instanceof OAuthFileBusy || err instanceof OAuthFileUnlockable
          ? { kind: "locked" }
          : { kind: "unreadable" };
    }

    if (outcome.kind === "locked") {
      refuse(
        res,
        503,
        "temporarily_unavailable",
        "this store cannot take the lock on its connector records, so it registers nothing",
      );
      return;
    }
    if (outcome.kind === "unreadable") {
      refuse(
        res,
        503,
        "temporarily_unavailable",
        "this store cannot read its connector records, so it registers nothing",
      );
      return;
    }
    if (outcome.kind === "full") {
      refuse(
        res,
        400,
        "invalid_client_metadata",
        `this store already holds ${maxClients} connectors it will not displace — each one is ` +
          `approved. \`loam grant list\` names them.`,
      );
      return;
    }
    jsonOut(res, 201, {
      client_id: outcome.client.clientId,
      client_name: outcome.client.clientName,
      redirect_uris: outcome.client.redirectUris,
      client_id_issued_at: Math.floor(outcome.client.registeredAt / 1000),
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: CONNECTOR_SCOPE,
    });
  };

  const handleRegister = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      refuse(res, 405, "invalid_request", "registration answers POST");
      return;
    }
    try {
      await postRegister(req, res);
    } catch (err) {
      onFault(
        `a connector door failed answering ${REGISTER_PATH}: ` +
          `${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      if (!res.headersSent) {
        refuse(
          res,
          503,
          "temporarily_unavailable",
          "this store could not answer, and it says no rather than why",
        );
      } else {
        res.end();
      }
    }
  };

  const registers = (pathname: string): boolean =>
    registration !== undefined && atRegisterPath(pathname);

  return {
    owns: (pathname) =>
      WELL_KNOWN_PATHS.has(pathname) ||
      mcpResourcePathOf(pathname) !== undefined ||
      registers(pathname),
    challenge: challengeFor(publicUrl),
    handle(pathname, req, res) {
      if (registers(pathname)) {
        void handleRegister(req, res);
        return;
      }
      wellKnown(pathname, req, res);
    },
  };
}

export { AUTHORIZE_PATH } from "./continuation.js";

const atAuthorizePath = doorAt(AUTHORIZE_PATH);

export const CODE_TTL_MS = 60_000;

const MAX_STATE = 2048;

const PKCE_SHAPE = /^[A-Za-z0-9._~-]{43,128}$/;

function pkceChallengeDefect(challenge: string): string | undefined {
  if (challenge === "") return undefined;
  if (!PKCE_SHAPE.test(challenge)) {
    return "The PKCE code_challenge must be 43–128 characters of A–Z, a–z, 0–9, dot, dash, underscore or tilde.";
  }
  return undefined;
}

export function authorizeRequestDefect(
  responseType: string,
  codeChallengeMethod: string,
  codeChallenge = "",
): string | undefined {
  if (responseType !== "" && responseType !== "code") {
    return 'This store issues authorization codes and nothing else: response_type, when sent, must be "code".';
  }
  if (codeChallengeMethod !== "" && codeChallengeMethod !== "S256") {
    return 'This store verifies PKCE one way only: code_challenge_method, when sent, must be "S256".';
  }
  if (codeChallenge !== "" && codeChallengeMethod === "") {
    return 'RFC 7636 reads an omitted code_challenge_method as "plain", and this store verifies S256 only: send code_challenge_method="S256".';
  }
  return undefined;
}

function pkceVerifies(verifier: string, challenge: string): boolean {
  if (!PKCE_SHAPE.test(verifier) || challenge === "") return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return sameSecret(computed, challenge);
}

export interface ConsentOptions {
  readonly gate: SessionGate;
  readonly home: string;

  readonly now?: () => number;
  readonly cimdAllowPrivateOrigins?: readonly string[];

  readonly users?: {
    readonly ground: () => Gateway | undefined;
    readonly home: string;
  };
  readonly onFault?: (message: string) => void;
}

export interface ConsentDoor {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void>;
}

const STRIKER_WARNING =
  "A granted connector signs under its own name. As a lawful negating author it can retract claims the " +
  "operator wrote — a negation it signs suppresses them for any reader.";

export function makeConsentDoor(options: ConsentOptions): ConsentDoor {
  const gate = options.gate;
  const home = options.home;
  const now = options.now ?? ((): number => performance.now());
  const digestOf = (secret: string): string => createHash("sha256").update(secret).digest("hex");
  const cimd = makeCimdFetcher({
    now,
    ...(options.cimdAllowPrivateOrigins === undefined
      ? {}
      : { allowPrivateOrigins: options.cimdAllowPrivateOrigins }),
  });

  const htmlOut = (
    res: ServerResponse,
    status: number,
    body: string,
    cookie?: string,
    csp: string = CSP,
  ): void => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "cache-control": CACHE_NO_STORE,
      "referrer-policy": "origin",
      ...(cookie === undefined ? {} : { "set-cookie": cookie }),
    });
    res.end(body);
  };

  const refuse = (res: ServerResponse, status: number, message: string): void =>
    htmlOut(res, status, page("this request was refused", `<h1>Refused.</h1>\n<p>${message}</p>`));

  const bindingFields = (
    user: string,
    bindable: readonly string[],
    inherited: Leeway | undefined,
  ): string =>
    `<fieldset>
<legend>Bind this connection to</legend>
<p>A connection lives in one container under your name, and never above it. That container is
where this connection lives.</p>
<label for="bind">an existing container</label>
<select id="bind" name="bind">
<option value="">—</option>
${bindable.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("\n")}
</select>
<label for="bind_new">or create one under <code>${escapeHtml(user)}:</code></label>
<input id="bind_new" name="bind_new" placeholder="journal" maxlength="63">
</fieldset>
${leewayFields(
  inherited,
  "These apply to a container you create here, and start from what the container above it " +
    "allows. A container that already stands keeps the leeway it has — change it on that " +
    "container's own page.",
)}`;

  const consentPage = (
    client: Pick<OAuthClient, "clientId" | "clientName">,
    registeredUri: string,
    state: string,
    codeChallenge: string,
    codeChallengeMethod: string,
    formToken: string,
    user: string,
    bindable: readonly string[],
    inherited: Leeway | undefined,
  ): string =>
    page(
      "approve a connector",
      `<h1>Approve a connector?</h1>
<p><code>${escapeHtml(client.clientName)}</code> asks to act in this store under its own name.</p>
${
  isCimdClientId(client.clientId)
    ? `<p>Its identity is its own address: <code>${escapeHtml(client.clientId)}</code>, whose document vouches for the redirect below.</p>\n`
    : ""
}<p>If you approve, this store will send it back to <code>${escapeHtml(registeredUri)}</code>.</p>
<p><strong>${escapeHtml(STRIKER_WARNING)}</strong></p>
<form method="post" action="${AUTHORIZE_PATH}">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<input type="hidden" name="client_id" value="${escapeHtml(client.clientId)}">
<input type="hidden" name="redirect_uri" value="${escapeHtml(registeredUri)}">
<input type="hidden" name="state" value="${escapeHtml(state)}">
<input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
<input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}">
${bindingFields(user, bindable, inherited)}
<button type="submit">approve</button>
</form>`,
    );

  type Binding =
    | { readonly kind: "existing"; readonly container: string }
    | { readonly kind: "create"; readonly leaf: string; readonly container: string }
    | { readonly kind: "refuse"; readonly status: number; readonly message: string };
  const notYours: Binding = {
    kind: "refuse",
    status: 404,
    message: "Nothing under your name answers to that, so nothing was approved.",
  };
  const neverAPool: Binding = {
    kind: "refuse",
    status: 400,
    message:
      "That is a pool — a connection's or a channel's — and a pool is never bound. Choose a " +
      "container under your name, or create one.",
  };
  const bindingOf = (gw: Gateway, user: string, bind: string, bindNew: string): Binding => {
    if (bindNew !== "") {
      if (!LEAF_RE.test(bindNew)) {
        return {
          kind: "refuse",
          status: 400,
          message:
            "A container name here is letters, digits, dashes, and underscores, up to 63 of " +
            "them — one level below your name.",
        };
      }
      const container = `${user}:${bindNew}`;
      const table = gw.containers();
      if (table.containers.has(container)) {
        if (!subtreeOf(table, user).has(container)) return notYours;
        return table.containers.get(container)?.inboxOf === undefined
          ? { kind: "existing", container }
          : neverAPool;
      }
      return { kind: "create", leaf: bindNew, container };
    }
    if (bind !== "" && !isBindableName(bind)) {
      return {
        kind: "refuse",
        status: 400,
        message: "That name carries a character no binding can, so it cannot be bound.",
      };
    }
    if (bind === "") {
      return {
        kind: "refuse",
        status: 400,
        message:
          "A connection is never bound to the store or to your home. Choose a container under " +
          "your name, or create one.",
      };
    }
    if (bind === user) {
      return {
        kind: "refuse",
        status: 400,
        message:
          "Your home container is never bound. Choose a container under your name, or create " +
          "one.",
      };
    }
    const table = gw.containers();
    if (!subtreeOf(table, user).has(bind)) return notYours;
    if (table.containers.get(bind)?.inboxOf !== undefined) return neverAPool;
    return { kind: "existing", container: bind };
  };

  const exactMatch = (clientId: string, uri: string): OAuthClient | undefined => {
    const client = clientFor(readOAuthFile(home), clientId);
    if (client === undefined) return undefined;
    return client.redirectUris.includes(uri) ? client : undefined;
  };

  const cimdMatch = async (
    clientId: string,
    uri: string,
  ): Promise<{ kind: "ok"; document: CimdDocument } | { kind: "refused"; reason: string }> => {
    const outcome = await cimd.fetch(clientId);
    if (outcome.kind === "refused") return outcome;
    if (!outcome.document.redirectUris.includes(uri)) {
      return { kind: "refused", reason: "its document does not vouch for that redirect address" };
    }
    const defect = cimdRedirectDefect(uri);
    if (defect !== undefined) return { kind: "refused", reason: defect };
    return { kind: "ok", document: outcome.document };
  };

  const readBodyFields = (req: IncomingMessage): Promise<Map<string, string>> =>
    readBody(req).then((body) => parseUrlEncoded(body ?? ""));

  const handleGet = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "", "http://loam.invalid");
    const session = gate.peek(req);
    if (session === undefined) {
      const form = gate.loginForm(req, authorizeContinuation(url.search));
      htmlOut(res, 200, form.body, form.cookie);
      return;
    }
    const params = url.searchParams;
    const clientId = params.get("client_id") ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";
    const state = params.get("state") ?? "";
    const codeChallenge = params.get("code_challenge") ?? "";
    if (state.length > MAX_STATE) {
      refuse(res, 400, "The state value is too long.");
      return;
    }
    const requestDefect = authorizeRequestDefect(
      params.get("response_type") ?? "",
      params.get("code_challenge_method") ?? "",
      codeChallenge,
    );
    if (requestDefect !== undefined) {
      refuse(res, 400, requestDefect);
      return;
    }
    const challengeDefect = pkceChallengeDefect(codeChallenge);
    if (challengeDefect !== undefined) {
      refuse(res, 400, challengeDefect);
      return;
    }
    let client: Pick<OAuthClient, "clientId" | "clientName">;
    if (isCimdClientId(clientId)) {
      const found = await cimdMatch(clientId, redirectUri);
      if (found.kind === "refused") {
        refuse(res, 400, `This request was not accepted: ${found.reason}.`);
        return;
      }
      client = { clientId, clientName: found.document.clientName };
    } else {
      const registered = exactMatch(clientId, redirectUri);
      if (registered === undefined) {
        refuse(res, 400, "This store holds no connector that may be reached at that address.");
        return;
      }
      client = registered;
    }
    const consentCsp = CSP.replace(
      "form-action 'self'",
      `form-action 'self' ${new URL(redirectUri).origin}`,
    );
    const gw = options.users?.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so no connection can be bound.");
      return;
    }
    htmlOut(
      res,
      200,
      consentPage(
        client,
        redirectUri,
        state,
        codeChallenge,
        params.get("code_challenge_method") ?? "",
        session.formToken,
        session.user,
        bindableOf(gw.containers(), session.user),
        governingLeeway(gw.containers(), session.user)?.leeway,
      ),
      undefined,
      consentCsp,
    );
  };

  const handlePost = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!gate.fromThisPage(req)) {
      await readBody(req);
      refuse(res, 403, "This request did not come from this store's own page.");
      return;
    }
    const fields = await readBodyFields(req);
    const session = gate.peek(req);
    if (session === undefined) {
      refuse(res, 401, "No live session is presented here.");
      return;
    }
    if (!sameSecret(fields.get("form_token") ?? "", session.formToken)) {
      refuse(res, 403, "This request did not come from this store's own page.");
      return;
    }
    const clientId = fields.get("client_id") ?? "";
    const redirectUri = fields.get("redirect_uri") ?? "";
    const state = fields.get("state") ?? "";
    const codeChallenge = fields.get("code_challenge") ?? "";
    if (state.length > MAX_STATE) {
      refuse(res, 400, "The state value is too long.");
      return;
    }
    const requestDefect = authorizeRequestDefect(
      fields.get("response_type") ?? "",
      fields.get("code_challenge_method") ?? "",
      codeChallenge,
    );
    if (requestDefect !== undefined) {
      refuse(res, 400, requestDefect);
      return;
    }
    const challengeDefect = pkceChallengeDefect(codeChallenge);
    if (challengeDefect !== undefined) {
      refuse(res, 400, challengeDefect);
      return;
    }
    const user = session.user;
    const bindingOffered = fields.has("bind") || fields.has("bind_new");
    let container: string | undefined;
    if (bindingOffered) {
      const users = options.users;
      const gw = users?.ground();
      if (users === undefined || gw === undefined) {
        refuse(res, 503, "This store's ground is not reachable, so it approved nothing.");
        return;
      }
      const binding = bindingOf(
        gw,
        user,
        fields.get("bind") ?? "",
        (fields.get("bind_new") ?? "").trim(),
      );
      if (binding.kind === "refuse") {
        refuse(res, binding.status, binding.message);
        return;
      }
      const fault = options.onFault ?? ((): void => undefined);
      const usersHome = users.home;
      const table = gw.containers();
      if (binding.kind === "create" || !table.containers.has(user)) {
        const key = await ensureUserKey(gw, usersHome, user, (m) => fault(`the consent page ${m}`));
        if ("refusal" in key) {
          refuse(res, key.refusal.status, key.refusal.message);
          return;
        }
        if (!table.containers.has(user)) {
          const declined = await declareOwned(
            gw,
            user,
            { user, seed: key.userSeed },
            undefined,
            (m) => fault(`the consent page ${m}`),
          );
          if (declined !== undefined) {
            refuse(res, declined.status, declined.message);
            return;
          }
        }
        if (binding.kind === "create") {
          const chosen = leewayFromFields(fields);
          const inherited = governingLeeway(gw.containers(), user)?.leeway ?? SEALED_LEEWAY;
          const answered = fields.get("leeway_envelope") !== undefined;
          const differs = canonicalLeewayJson(chosen) !== canonicalLeewayJson(inherited);
          const declined = await declareOwned(
            gw,
            binding.container,
            { user, seed: key.userSeed },
            user,
            (m) => fault(`the consent page ${m}`),
            answered && differs ? chosen : undefined,
          );
          if (declined !== undefined) {
            refuse(res, declined.status, declined.message);
            return;
          }
        }
      }
      container = binding.container;
    }
    const secret = randomBytes(32).toString("base64url");
    const codeRecord = (generation: number): OAuthCode => ({
      digest: digestOf(secret),
      clientId,
      redirectUri,
      expiresAt: now() + CODE_TTL_MS,
      issuedAt: Date.now(),
      codeChallenge,
      generation,
      user,
      ...(container === undefined ? {} : { container }),
    });
    let mint: (file: OAuthFile) => OAuthFile;
    if (isCimdClientId(clientId)) {
      const found = await cimdMatch(clientId, redirectUri);
      if (found.kind === "refused") {
        refuse(res, 400, `This request was not accepted: ${found.reason}.`);
        return;
      }
      const document = found.document;
      mint = (file) => {
        const existing = clientFor(file, clientId);
        const row: OAuthClient =
          existing === undefined
            ? {
                clientId,
                clientName: document.clientName,
                redirectUris: [...document.redirectUris],
                registeredAt: Date.now(),
                generation: 1,
              }
            : {
                ...existing,
                clientName: document.clientName,
                redirectUris: [...document.redirectUris],
              };
        return {
          ...file,
          clients:
            existing === undefined
              ? [...file.clients, row]
              : file.clients.map((c) => (c.clientId === clientId ? row : c)),
          tokens:
            existing === undefined
              ? file.tokens.filter((t) => t.clientId !== clientId)
              : file.tokens,
          codes: [...(file.codes ?? []), codeRecord(row.generation)],
        };
      };
    } else {
      const client = exactMatch(clientId, redirectUri);
      if (client === undefined) {
        refuse(res, 400, "This store holds no connector that may be reached at that address.");
        return;
      }
      const record = codeRecord(client.generation);
      mint = (file) => ({ ...file, codes: [...(file.codes ?? []), record] });
    }
    try {
      withOAuthFile<void>(home, (file) => ({
        next: mint(file),
        result: undefined,
      }));
    } catch (err) {
      const temporary = err instanceof OAuthFileBusy || err instanceof OAuthFileUnlockable;
      refuse(
        res,
        503,
        temporary
          ? "This store cannot take the lock on its connector records, so it approved nothing."
          : "This store cannot read its connector records, so it approved nothing.",
      );
      return;
    }
    const sep = redirectUri.includes("?") ? "&" : "?";
    const stateParam = state === "" ? "" : `&state=${encodeURIComponent(state)}`;
    const location = `${redirectUri}${sep}code=${encodeURIComponent(secret)}${stateParam}`;
    res.writeHead(302, {
      location,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end();
  };

  return {
    owns: atAuthorizePath,
    async handle(pathname, req, res) {
      try {
        if (req.method === "GET") {
          await handleGet(req, res);
          return;
        }
        if (req.method === "POST") {
          await handlePost(req, res);
          return;
        }
        htmlOut(
          res,
          405,
          page(
            "method not allowed",
            `<h1>Refused.</h1>\n<p>${AUTHORIZE_PATH} answers GET and POST.</p>`,
          ),
        );
      } catch {
        if (!res.headersSent) {
          refuse(res, 503, "This store could not answer, and it says no rather than why.");
        } else {
          res.end();
        }
      }
    },
  };
}

const TOKEN_PATH = "/oauth/token";

const atTokenPath = doorAt(TOKEN_PATH);

export interface ConnectorIdentity {
  readonly actor: string;
  readonly binding?: {
    readonly user: string;
    readonly container: string;
    readonly inbox: string;
  };
}

export interface TokenDoorOptions {
  readonly home: string;

  readonly now?: () => number;

  readonly redeeming: Map<string, number>;

  readonly bind: (binding: {
    readonly user: string;
    readonly container: string;
    readonly actor: string;
  }) => Promise<string>;
  readonly onFault?: (message: string) => void;

  readonly readFile?: (home: string) => OAuthFile;
}

export interface TokenDoor {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void>;

  resolve(digestHex: string): ConnectorIdentity | undefined;
  describe(digestHex: string): { clientId: string; actor: string } | undefined;
}

const digestHex = (secret: string): string => createHash("sha256").update(secret).digest("hex");

const MAX_TOKEN_BODY_FIELD = 4096;

export function makeTokenDoor(options: TokenDoorOptions): TokenDoor {
  const home = options.home;
  const now = options.now ?? ((): number => performance.now());
  const redeeming = options.redeeming;
  const onFault = options.onFault ?? ((message: string): void => void message);
  const readFile = options.readFile ?? readOAuthFile;

  const known = new Set<string>();
  try {
    for (const token of readFile(home).tokens) known.add(token.digest);
  } catch (err) {
    onFault(
      `the token door could not read ${oauthPath(home)} at startup, so no connector token ` +
        `authenticates yet: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const inc = (clientId: string): void => {
    redeeming.set(clientId, (redeeming.get(clientId) ?? 0) + 1);
  };
  const TOKEN_DOOR_HEADERS = {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "access-control-allow-origin": "*",
  } as const;

  const dec = (clientId: string): void => {
    const n = (redeeming.get(clientId) ?? 0) - 1;
    if (n <= 0) redeeming.delete(clientId);
    else redeeming.set(clientId, n);
  };

  const jsonOut = (res: ServerResponse, status: number, body: unknown): void =>
    endJson(res, status, body, TOKEN_DOOR_HEADERS);
  const refuse = (res: ServerResponse, status: number, error: string, description: string): void =>
    jsonOut(res, status, { error, error_description: description });

  const field = (fields: Map<string, string>, name: string): string => {
    const value = fields.get(name) ?? "";
    return value.length > MAX_TOKEN_BODY_FIELD ? "" : value;
  };

  const resolve = (digest: string): ConnectorIdentity | undefined => {
    if (!known.has(digest)) return undefined;
    let file: OAuthFile;
    try {
      file = readFile(home);
    } catch {
      return undefined;
    }
    const token = tokenFor(file, digest);
    if (token === undefined) {
      known.delete(digest);
      return undefined;
    }
    const client = clientFor(file, token.clientId);
    if (client === undefined || token.generation !== client.generation) return undefined;
    if (token.user === undefined) return undefined;
    const grant = grantFor(file, token.clientId, token.user);
    if (
      grant === undefined ||
      !grant.standing ||
      grant.container === undefined ||
      grant.inbox === undefined
    ) {
      return undefined;
    }
    return {
      actor: grant.actorSeed,
      binding: { user: token.user, container: grant.container, inbox: grant.inbox },
    };
  };

  const describe = (digest: string): { clientId: string; actor: string } | undefined => {
    let file: OAuthFile;
    try {
      file = readOAuthFile(home);
    } catch {
      return undefined;
    }
    const token = tokenFor(file, digest);
    if (token === undefined) return undefined;
    const client = clientFor(file, token.clientId);
    if (client === undefined || token.generation !== client.generation) return undefined;
    if (token.user === undefined) return undefined;
    const grant = grantFor(file, token.clientId, token.user);
    if (grant === undefined || !grant.standing) return undefined;
    return { clientId: token.clientId, actor: grant.actor };
  };

  const redeem = async (fields: Map<string, string>, res: ServerResponse): Promise<void> => {
    if (field(fields, "grant_type") !== "authorization_code") {
      refuse(res, 400, "unsupported_grant_type", "this token endpoint answers authorization_code");
      return;
    }
    const codeSecret = field(fields, "code");
    const clientId = field(fields, "client_id");
    const redirectUri = field(fields, "redirect_uri");
    const verifier = field(fields, "code_verifier");
    if (codeSecret === "" || clientId === "" || redirectUri === "" || verifier === "") {
      refuse(
        res,
        400,
        "invalid_request",
        "a redemption needs code, client_id, redirect_uri and code_verifier",
      );
      return;
    }
    const codeDigest = digestHex(codeSecret);

    let burnt: OAuthCode | undefined;
    try {
      burnt = withOAuthFile<OAuthCode | undefined>(home, (file) => {
        const code = codeFor(file, codeDigest);
        if (code === undefined) return { result: undefined };
        return {
          next: { ...file, codes: (file.codes ?? []).filter((c) => c.digest !== codeDigest) },
          result: code,
        };
      });
    } catch (err) {
      lockFaultOrRethrow(res, err, "redeemed nothing");
      return;
    }
    if (burnt === undefined) {
      refuse(res, 400, "invalid_grant", "this code is unknown, already redeemed, or expired");
      return;
    }
    const code = burnt;

    inc(code.clientId);
    try {
      if (!sameSecret(clientId, code.clientId) || !sameSecret(redirectUri, code.redirectUri)) {
        refuse(res, 400, "invalid_grant", "this code was not issued to that client or address");
        return;
      }
      if (code.expiresAt <= now()) {
        refuse(res, 400, "invalid_grant", "this code has expired");
        return;
      }
      if (code.codeChallenge === undefined || code.codeChallenge === "") {
        refuse(
          res,
          400,
          "invalid_grant",
          "this code was issued without PKCE and cannot be redeemed",
        );
        return;
      }
      if (!pkceVerifies(verifier, code.codeChallenge)) {
        refuse(res, 400, "invalid_grant", "the PKCE code_verifier does not match the challenge");
        return;
      }

      const file = readFile(home);
      const client = clientFor(file, code.clientId);
      if (client === undefined) {
        refuse(res, 400, "invalid_grant", "the connector this code named is no longer registered");
        return;
      }
      if (code.generation !== client.generation) {
        refuse(res, 400, "invalid_grant", "this code was issued before the connector was revoked");
        return;
      }

      if (code.user === undefined || code.container === undefined) {
        refuse(
          res,
          400,
          "invalid_grant",
          "this code carries no container, and a connection is never bound nowhere — consent " +
            "again and choose one",
        );
        return;
      }
      const user = code.user;
      const container = code.container;
      const samePair = (g: OAuthGrant): boolean => g.clientId === code.clientId && g.user === user;

      const existing = grantFor(file, code.clientId, user);
      let grant: OAuthGrant;
      if (existing !== undefined) {
        grant = existing;
      } else {
        const actorSeed = randomBytes(32).toString("hex");
        grant = {
          clientId: code.clientId,
          user,
          container,
          actorSeed,
          actor: authorForSeed(actorSeed),
          grantedAt: Date.now(),
          standing: false,
        };
        withOAuthFile<void>(home, (f) => ({
          next:
            grantFor(f, code.clientId, user) === undefined
              ? { ...f, grants: [...f.grants, grant] }
              : f,
          result: undefined,
        }));
      }

      const inbox = await options.bind({ user, container, actor: grant.actor });
      if (!grant.standing || grant.inbox !== inbox || grant.container !== container) {
        withOAuthFile<void>(home, (f) => ({
          next: {
            ...f,
            grants: f.grants.map((g) =>
              samePair(g) ? { ...g, standing: true, container, inbox } : g,
            ),
          },
          result: undefined,
        }));
      }

      const tokenSecret = randomBytes(32).toString("base64url");
      const digest = digestHex(tokenSecret);
      const record: OAuthToken = {
        digest,
        clientId: code.clientId,
        issuedAt: Date.now(),
        generation: client.generation,
        user,
      };
      withOAuthFile<void>(home, (f) => ({
        next: { ...f, tokens: [...f.tokens, record] },
        result: undefined,
      }));
      known.add(digest);

      jsonOut(res, 200, {
        access_token: tokenSecret,
        token_type: "Bearer",
        scope: CONNECTOR_SCOPE,
      });
    } catch (err) {
      lockFaultOrRethrow(res, err, "granted nothing");
    } finally {
      dec(code.clientId);
    }
  };

  function lockFaultOrRethrow(res: ServerResponse, err: unknown, what: string): void {
    if (err instanceof OAuthFileBusy || err instanceof OAuthFileUnlockable) {
      onFault(`the token door could not take the lock on ${oauthPath(home)}: ${err.message}`);
      refuse(
        res,
        503,
        "temporarily_unavailable",
        `this store cannot take the lock on its connector records, so it ${what}`,
      );
      return;
    }
    throw err;
  }

  const readBodyFields = (req: IncomingMessage): Promise<Map<string, string>> =>
    readBody(req).then((body) => parseUrlEncoded(body ?? ""));

  return {
    owns: atTokenPath,
    resolve,
    describe,
    async handle(pathname, req, res) {
      if (req.method !== "POST") {
        refuse(res, 405, "invalid_request", "the token endpoint answers POST");
        return;
      }
      try {
        await redeem(await readBodyFields(req), res);
      } catch (err) {
        onFault(
          `a connector door failed answering ${TOKEN_PATH}: ` +
            `${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
        if (!res.headersSent) {
          refuse(
            res,
            503,
            "temporarily_unavailable",
            "this store could not answer, and it says no rather than why",
          );
        } else {
          res.end();
        }
      }
    },
  };
}

export type RevokeScope =
  { readonly kind: "client" } | { readonly kind: "pair"; readonly user: string | undefined };

export type RevokeOutcome =
  | { readonly kind: "revoked"; readonly clientId: string; readonly generation: number }
  | { readonly kind: "no-such-client" }
  | { readonly kind: "no-such-pair" }
  | { readonly kind: "locked" }
  | { readonly kind: "unreadable" };

export async function revokeConnector(
  home: string,
  clientId: string,
  strikeStanding: (grant: OAuthGrant) => Promise<void>,
  onFault: (message: string) => void = () => {},
  scope: RevokeScope = { kind: "client" },
): Promise<RevokeOutcome> {
  let struckGrants: OAuthGrant[] = [];
  let outcome: RevokeOutcome;
  try {
    outcome = withOAuthFile<RevokeOutcome>(home, (file) => {
      const client = clientFor(file, clientId);
      if (client === undefined) return { result: { kind: "no-such-client" } };
      const ofPair = (r: { readonly clientId: string; readonly user?: string }): boolean =>
        r.clientId === clientId && (scope.kind === "client" || r.user === scope.user);
      struckGrants = file.grants.filter(ofPair);
      if (scope.kind === "pair" && struckGrants.length === 0) {
        return { result: { kind: "no-such-pair" } };
      }
      const going = struckGrants;
      const goingActors = new Set(going.map((g) => g.actor));
      const generation = scope.kind === "client" ? client.generation + 1 : client.generation;
      return {
        next: {
          ...file,
          clients: file.clients.map((c) => (c.clientId === clientId ? { ...c, generation } : c)),
          grants: file.grants.filter((g) => !ofPair(g)),
          ...(scope.kind === "client"
            ? {}
            : {
                tokens: file.tokens.filter((t) => !ofPair(t)),
                ...(file.codes === undefined
                  ? {}
                  : { codes: file.codes.filter((c) => !ofPair(c)) }),
              }),
          ...(going.length === 0
            ? {}
            : {
                revoked: [
                  ...(file.revoked ?? []).filter((r) => !goingActors.has(r.actor)),
                  ...going.map((g) => ({ clientId, actor: g.actor, revokedAt: Date.now() })),
                ],
              }),
        },
        result: { kind: "revoked", clientId, generation },
      };
    });
  } catch (err) {
    if (err instanceof OAuthFileBusy || err instanceof OAuthFileUnlockable) {
      return { kind: "locked" };
    }
    return { kind: "unreadable" };
  }
  if (outcome.kind === "revoked") {
    for (const struck of struckGrants) {
      try {
        await strikeStanding(struck);
      } catch (err) {
        onFault(
          `revoked ${clientId} in ${oauthPath(home)} (that key's tokens are dead) but could not ` +
            `negate the ground write grant of ${struck.actor}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  return outcome;
}
