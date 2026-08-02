// The admin page (SPEC §40, phase A1) — the door and the read surface. `GET /admin` renders the
// signed-in user's container subtree; `GET /admin/container` renders one container's members; and
// `POST /admin/create-root` declares the root container for a user who has none. Read-only except
// that one create — lifecycle forms, schemas, promotion and connections are later phases, each a
// new exact path in `owns`.
//
// THE SUBTREE IS THE WHOLE CONTRACT. A user's world is the container named exactly after them,
// plus every descendant by `parent` edge, plus each reachable container's inbox pools (§39). The
// walk runs at the door, on the LIVE table, for every request — scope is enforced here, never
// merely drawn on the page — and a name outside the subtree gets ONE uniform refusal whether the
// container is another user's or nobody's: existence is confirmed neither way.
//
// Same defence posture as consent (§37.4): the session is read with `peek` on GETs (refused
// traffic never slides a window), the POST sits behind the phase-6 provenance + form-token pair,
// the no-script CSP rides every response, every echoed name is escaped, no refusal writes a
// `Location`, and no body names a home path, a seed filename, or a flag — local detail goes to
// `onFault`, the operator's own channel.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { readUserSeed, userSeedPath } from "../cli/config.js";
import {
  containerClaims,
  type ContainerTable,
  type ResolvedContainer,
} from "../gateway/container.js";
import { type Gateway } from "../gateway/gateway.js";
import { CSP, escapeHtml, page, sameSecret, type SessionGate } from "./session.js";

export const ADMIN_PATH = "/admin";
export const ADMIN_CREATE_ROOT_PATH = "/admin/create-root";
export const ADMIN_CONTAINER_PATH = "/admin/container";

const MAX_BODY = 8 * 1024; // one form token; nothing here needs more

export interface AdminDoorOptions {
  /** The session machinery this page sits behind — the login doors' own, reused whole. */
  readonly gate: SessionGate;
  /** The home the users' signing seeds live in — the login doors' own. */
  readonly home: string;
  /** The users mount's live gateway, re-asked per request: erase re-seats it, a mount can vanish. */
  readonly ground: () => Gateway | undefined;
  /** Where a local fault goes. The CALLER never sees it — it may name the home's path. */
  readonly onFault?: (message: string) => void;
}

export interface AdminDoor {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void>;
}

/**
 * The containers `root` may see: the root itself, every descendant by `parent` edge, and every
 * inbox pool (`inboxOf`, §39) hanging off a reachable container. A fixpoint rather than one pass,
 * because an edge can hang off an inbox pool and the table's iteration order guarantees nothing.
 */
export function subtreeOf(table: ContainerTable, root: string): ReadonlySet<string> {
  const reach = new Set<string>();
  if (!table.containers.has(root)) return reach;
  reach.add(root);
  for (;;) {
    let grew = false;
    for (const [name, rec] of table.containers) {
      if (reach.has(name)) continue;
      const under =
        (rec.parent !== undefined && reach.has(rec.parent)) ||
        (rec.inboxOf !== undefined && reach.has(rec.inboxOf));
      if (under) {
        reach.add(name);
        grew = true;
      }
    }
    if (!grew) return reach;
  }
}

/** The root container's membership: what its owner authored. The same Term shape §39's inboxes use. */
const authoredBy = (publicKey: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: publicKey } },
  in: "input",
});

const readBody = (req: IncomingMessage): Promise<string | undefined> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        over = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? undefined : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
  });

export function makeAdminDoor(options: AdminDoorOptions): AdminDoor {
  const gate = options.gate;
  const onFault = options.onFault ?? ((message: string): void => void message);

  const htmlOut = (res: ServerResponse, status: number, body: string, cookie?: string): void => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": CSP,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      ...(cookie === undefined ? {} : { "set-cookie": cookie }),
    });
    res.end(body);
  };

  // Every refusal is a page with no `Location`, and none reflects caller text — a name the caller
  // typed never rides back into the DOM; only names read from the table are rendered, escaped.
  const refuse = (res: ServerResponse, status: number, message: string): void =>
    htmlOut(res, status, page("this request was refused", `<h1>Refused.</h1>\n<p>${message}</p>`));

  // ONE body for a foreign name and an absent one: a 403 that varied would confirm which
  // containers exist to a user who may not see them.
  const notYours = (res: ServerResponse): void =>
    refuse(res, 403, "That container is not yours to see.");

  const loginOrUndefined = (
    req: IncomingMessage,
    res: ServerResponse,
  ): { user: string; formToken: string } | undefined => {
    // READ, don't slide: rendering a page for a GET that may be a cross-site top-level nav must
    // not extend the session's idle window — the same choice the consent page makes.
    const session = gate.peek(req);
    if (session !== undefined) return session;
    const form = gate.loginForm(req);
    htmlOut(res, 200, form.body, form.cookie);
    return undefined;
  };

  const detailHref = (name: string): string =>
    `${ADMIN_CONTAINER_PATH}?name=${encodeURIComponent(name)}`;

  const stateOf = (table: ContainerTable, name: string, rec: ResolvedContainer): string =>
    [
      rec.trust,
      rec.posture,
      table.detached.has(name) ? "detached" : "active",
      ...(rec.inboxOf === undefined ? [] : ["inbox"]),
    ].join(" · ");

  // The subtree as nested lists, rooted at the user's own container. Every name in `reach` except
  // the root has an edge into `reach` (subtreeOf guarantees it), so the walk from the root covers
  // the whole set.
  const treeHtml = (table: ContainerTable, reach: ReadonlySet<string>, root: string): string => {
    const item = (name: string): string => {
      const rec = table.containers.get(name)!;
      const kids = [...reach]
        .filter((child) => {
          const c = table.containers.get(child)!;
          return c.parent === name || c.inboxOf === name;
        })
        .sort();
      const line =
        `<a href="${escapeHtml(detailHref(name))}"><code>${escapeHtml(name)}</code></a> — ` +
        escapeHtml(stateOf(table, name, rec));
      return kids.length === 0
        ? `<li>${line}</li>`
        : `<li>${line}\n<ul>\n${kids.map(item).join("\n")}\n</ul></li>`;
    };
    return `<ul>\n${item(root)}\n</ul>`;
  };

  const dashboardPage = (user: string, table: ContainerTable, reach: ReadonlySet<string>): string =>
    page(
      "your containers",
      `<h1>Your containers.</h1>
<p>You are <code>${escapeHtml(user)}</code>. Below is your subtree: the container that bears your
name, and everything declared inside it. Each name opens its own page.</p>
${treeHtml(table, reach, user)}`,
    );

  const createOfferPage = (user: string, formToken: string): string =>
    page(
      "create your container",
      `<h1>No container bears your name yet.</h1>
<p>You are <code>${escapeHtml(user)}</code>. Your root container is where this store gathers what
you author — one container, named after you; everything you later make will live inside it.</p>
<form method="post" action="${ADMIN_CREATE_ROOT_PATH}">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<button type="submit">create your container</button>
</form>`,
    );

  const getDashboard = (req: IncomingMessage, res: ServerResponse): void => {
    const session = loginOrUndefined(req, res);
    if (session === undefined) return;
    const gw = options.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so this page cannot load.");
      return;
    }
    const table = gw.containers();
    const reach = subtreeOf(table, session.user);
    if (reach.size === 0) {
      htmlOut(res, 200, createOfferPage(session.user, session.formToken));
      return;
    }
    htmlOut(res, 200, dashboardPage(session.user, table, reach));
  };

  // One member, rendered: the id, the author, the moment, and each pointer's role (with its
  // context where the pointer names an entity).
  const memberHtml = (gw: Gateway, id: string): string => {
    const delta = gw.reactor.get(id);
    if (delta === undefined) return "";
    const claims = delta.claims;
    const roles = claims.pointers
      .map((p) => (p.target.kind === "entity" ? `${p.role} @ ${p.target.entity.context}` : p.role))
      .join(" · ");
    return (
      `<li><code>${escapeHtml(delta.id)}</code><br>` +
      `by <code>${escapeHtml(claims.author)}</code> at ` +
      `${escapeHtml(new Date(claims.timestamp).toISOString())}<br>` +
      `${escapeHtml(roles)}</li>`
    );
  };

  const detailPage = (
    gw: Gateway,
    table: ContainerTable,
    name: string,
    rec: ResolvedContainer,
  ): string => {
    const head =
      `<h1><code>${escapeHtml(name)}</code>.</h1>\n<p>${escapeHtml(stateOf(table, name, rec))}` +
      (rec.parent === undefined && rec.inboxOf === undefined
        ? " — your root."
        : ` — inside <code>${escapeHtml(rec.inboxOf ?? rec.parent!)}</code>.`) +
      "</p>";
    const back = `<p><a href="${ADMIN_PATH}">Back to your containers.</a></p>`;

    if (table.detached.has(name)) {
      return page(
        name,
        `${head}
<p>This container is detached: kept, deliberately, and out of the gather. Its bytes are held, and
no read composes them until it is reattached.</p>
${back}`,
      );
    }

    let members: readonly { id: string }[];
    try {
      members = gw.containerScope({ containers: [name] });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // The H9 refusal, surfaced as the truth it is: a declared separate container whose bytes
      // are not here must say so — an empty member list would be exactly the lie the refusal
      // exists to prevent.
      if (detail.includes("is not attached")) {
        return page(
          name,
          `${head}
<p>Declared, not attached — its bytes are not readable from here. This page will not pretend the
container is empty; attach it, and its contents appear.</p>
${back}`,
        );
      }
      onFault(`the admin page could not read container "${name}": ${detail}`);
      return page(
        name,
        `${head}
<p>This container's contents cannot be read right now. The store says no rather than why.</p>
${back}`,
      );
    }
    const listing =
      members.length === 0
        ? "<p>Nothing has gathered here yet.</p>"
        : `<p>${members.length} member${members.length === 1 ? "" : "s"}.</p>
<ul>
${members.map((m) => memberHtml(gw, m.id)).join("\n")}
</ul>`;
    return page(name, `${head}\n${listing}\n${back}`);
  };

  const getContainer = (req: IncomingMessage, res: ServerResponse): void => {
    const session = loginOrUndefined(req, res);
    if (session === undefined) return;
    const gw = options.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so this page cannot load.");
      return;
    }
    const name = new URL(req.url ?? "", "http://loam.invalid").searchParams.get("name") ?? "";
    const table = gw.containers();
    // The door's gate: re-derived from the live table, every request. Outside — foreign or
    // absent alike — is one uniform refusal.
    if (!subtreeOf(table, session.user).has(name)) {
      notYours(res);
      return;
    }
    htmlOut(res, 200, detailPage(gw, table, name, table.containers.get(name)!));
  };

  const postCreateRoot = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Phase-6 provenance FIRST, before any session read — and drain the body so a refusal leaves
    // no bytes on a keep-alive socket.
    if (!gate.fromThisPage(req)) {
      await readBody(req);
      refuse(res, 403, "This request did not come from this store's own page.");
      return;
    }
    const fields = new Map<string, string>();
    for (const [k, v] of new URLSearchParams((await readBody(req)) ?? "")) fields.set(k, v);
    const session = gate.peek(req);
    if (session === undefined) {
      refuse(res, 401, "No live session is presented here.");
      return;
    }
    if (!sameSecret(fields.get("form_token") ?? "", session.formToken)) {
      refuse(res, 403, "This request did not come from this store's own page.");
      return;
    }
    const user = session.user;
    const gw = options.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so nothing was made.");
      return;
    }
    if (gw.containers().containers.has(user)) {
      refuse(
        res,
        409,
        `A container already bears your name. <a href="${ADMIN_PATH}">It is on your page.</a>`,
      );
      return;
    }
    // The root gathers what its owner AUTHORED, so the membership Term needs the user's own
    // public key — and that key comes from their signing seed, or from nowhere. FAILING CLOSED IS
    // THE POINT: an operator-authored fallback Term would be a root that silently gathers under
    // the wrong name, a lie no later reader could detect.
    const seed = readUserSeed(options.home, user);
    const usable = seed.kind === "present" && /^[0-9a-f]{64}$/.test(seed.seed);
    if (!usable) {
      if (seed.kind !== "absent") {
        onFault(
          `the admin page cannot use ${userSeedPath(options.home, user)}: ` +
            (seed.kind === "unreadable"
              ? seed.detail
              : "it is present but is not a 64-character hex signing key"),
        );
      }
      refuse(
        res,
        409,
        "This user has no signing key on this store, so no container was made — a root gathers " +
          "what you author, and this store cannot yet name you as an author. Ask the store's " +
          "operator to provision your key.",
      );
      return;
    }
    // Operator law: the declaration is signed by the store, once the door has proven the target
    // is the session user's own name — which it is by construction here.
    if (gw.options.seed === undefined || gw.operatorAuthor === undefined) {
      refuse(res, 503, "This store cannot sign a declaration right now, so nothing was made.");
      return;
    }
    const spec = {
      container: user,
      trust: "curated" as const,
      posture: "shared" as const,
      membership: authoredBy(authorForSeed(seed.seed)),
    };
    try {
      await gw.append([
        signClaims(containerClaims(spec, gw.operatorAuthor, gw.nextTimestamp()), gw.options.seed),
      ]);
    } catch (err) {
      onFault(
        `the admin page could not declare the root container for ${user}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(res, 503, "This store could not land the declaration, so nothing was made.");
      return;
    }
    // The one redirect this door writes, and it points at this door's own path — never off-origin.
    res.writeHead(303, {
      location: ADMIN_PATH,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end();
  };

  const OWNED = new Set([ADMIN_PATH, ADMIN_CREATE_ROOT_PATH, ADMIN_CONTAINER_PATH]);

  return {
    owns: (pathname) => OWNED.has(pathname),
    async handle(pathname, req, res) {
      try {
        if (pathname === ADMIN_CREATE_ROOT_PATH) {
          if (req.method === "POST") {
            await postCreateRoot(req, res);
            return;
          }
          refuse(res, 405, `${ADMIN_CREATE_ROOT_PATH} answers POST.`);
          return;
        }
        if (req.method !== "GET") {
          refuse(res, 405, `${pathname} answers GET.`);
          return;
        }
        if (pathname === ADMIN_CONTAINER_PATH) {
          getContainer(req, res);
          return;
        }
        getDashboard(req, res);
      } catch (err) {
        // A fault nobody anticipated must not escape to the server's generic 500, whose message
        // can carry the home's absolute path. It says no rather than why, and writes no Location.
        onFault(
          `the admin page failed answering ${pathname}: ` +
            `${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
        if (!res.headersSent) {
          refuse(res, 503, "This store could not answer, and it says no rather than why.");
        } else {
          res.end();
        }
      }
    },
  };
}
