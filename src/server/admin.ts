// The admin page (SPEC §40, phases A1 + A2) — the door, the read surface, and the container
// lifecycle. `GET /admin` renders the signed-in user's container subtree with the declare form;
// `GET /admin/container` renders one container's members and its lifecycle forms; and the POSTs
// are `create-root`, `declare`, `detach`, `reattach`, and the two-step `drop` → `drop-confirm`.
// Schemas, promotion and connections are later phases, each a new exact path in `owns`.
//
// THE LIFECYCLE ACTS ONLY WHERE IT CAN TELL THE TRUTH. A shared container is all at-rest law, so
// every act on it is a delta: detach lands the record, reattach negates it, drop strikes the
// declaration (the deltas it gathered remain — the confirm page says so). A separate container's
// bytes live in its own store, and this door holds a byte-verified handle ONLY for connection
// inboxes (`gw.connectionInboxes`); everywhere else it refuses rather than pretends — a detached
// pool cannot drop (its bytes are not here to verify), a browser form cannot hand back a pool's
// own backend to reattach it, and a pool attached by the embedding program is that program's to
// close. Drop is TWO steps: the first POST renders a confirm page naming exactly what is and is
// not forgotten, minting a single-use confirm token; only the token's return performs it.
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

import { randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { authorForSeed, parseTerm, signClaims, type Claims } from "@bombadil/rhizomatic";
import { readUserSeed, userSeedPath } from "../cli/config.js";
import {
  containerClaims,
  detachClaims,
  survivingDeclarationIds,
  type Container,
  type ContainerTable,
  type ResolvedContainer,
} from "../gateway/container.js";
import { type Gateway } from "../gateway/gateway.js";
import { CSP, escapeHtml, page, sameSecret, type SessionGate } from "./session.js";

export const ADMIN_PATH = "/admin";
export const ADMIN_CREATE_ROOT_PATH = "/admin/create-root";
export const ADMIN_CONTAINER_PATH = "/admin/container";
export const ADMIN_DECLARE_PATH = "/admin/declare";
export const ADMIN_DETACH_PATH = "/admin/detach";
export const ADMIN_REATTACH_PATH = "/admin/reattach";
export const ADMIN_DROP_PATH = "/admin/drop";
export const ADMIN_DROP_CONFIRM_PATH = "/admin/drop-confirm";

const MAX_BODY = 8 * 1024; // tokens, a name, a membership Term; nothing here needs more

/** How many pending drop confirmations this door remembers. Oldest-out; each is single-use. */
const CONFIRM_CAP = 64;

// A negation of one delta — the strike a reattach or a shared drop appends. Existing vocabulary
// (the same shape container.ts's retractionOf builds), never a new delta shape.
const negationOf = (targetId: string, author: string, timestamp: number): Claims => ({
  timestamp,
  author,
  pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
});

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

  // The author-select Term prefilled as the declare form's suggestion — the same shape the root's
  // membership takes. A user with no usable signing key gets an empty textarea, never a Term that
  // names somebody else.
  const membershipSuggestion = (user: string): string => {
    const seed = readUserSeed(options.home, user);
    if (seed.kind !== "present" || !/^[0-9a-f]{64}$/.test(seed.seed)) return "";
    return JSON.stringify(authoredBy(authorForSeed(seed.seed)));
  };

  const declareFormHtml = (user: string, reach: ReadonlySet<string>, formToken: string): string => {
    const parents = [...reach]
      .sort()
      .map(
        (name) =>
          `<option value="${escapeHtml(name)}"${name === user ? " selected" : ""}>` +
          `${escapeHtml(name)}</option>`,
      )
      .join("\n");
    return `<h2>Declare a child.</h2>
<p>A child container lives inside your subtree and bears your name — <code>${escapeHtml(user)}:notes</code>.
A shared child is a reading over ground this store already holds; give it a membership Term.
A separate child keeps its own store, attached later from the command line.</p>
<form method="post" action="${ADMIN_DECLARE_PATH}">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<p><label>name <input name="name" placeholder="${escapeHtml(user)}:notes"></label></p>
<p><label>inside <select name="parent">
${parents}
</select></label></p>
<p><label>posture <select name="posture">
<option value="shared">shared</option>
<option value="separate">separate</option>
</select></label></p>
<p><label>membership Term <textarea name="membership" rows="4" cols="72">${escapeHtml(membershipSuggestion(user))}</textarea></label></p>
<button type="submit">declare</button>
</form>`;
  };

  const dashboardPage = (
    user: string,
    table: ContainerTable,
    reach: ReadonlySet<string>,
    formToken: string,
  ): string =>
    page(
      "your containers",
      `<h1>Your containers.</h1>
<p>You are <code>${escapeHtml(user)}</code>. Below is your subtree: the container that bears your
name, and everything declared inside it. Each name opens its own page.</p>
${treeHtml(table, reach, user)}
${declareFormHtml(user, reach, formToken)}`,
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
    htmlOut(res, 200, dashboardPage(session.user, table, reach, session.formToken));
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

  // A hidden pair every lifecycle form carries: the session's token and the target's name. The
  // form is an OFFER, never the gate — every POST re-derives the subtree and the state before it acts.
  const hiddenPair = (formToken: string, name: string): string =>
    `<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">\n` +
    `<input type="hidden" name="name" value="${escapeHtml(name)}">`;

  const actForm = (action: string, formToken: string, name: string, label: string): string =>
    `<form method="post" action="${action}">
${hiddenPair(formToken, name)}
<button type="submit">${label}</button>
</form>`;

  // The lifecycle a container's page offers, by its state. Where an act cannot be truthful from
  // a browser, the page says so instead of rendering a form that would lie.
  const lifecycleForms = (
    table: ContainerTable,
    name: string,
    rec: ResolvedContainer,
    formToken: string,
  ): string => {
    if (table.detached.has(name)) {
      if (rec.posture === "separate") {
        return `<p>Reattaching needs this container's own store, which a page cannot hand back —
reattach it from the command line on the machine that holds it. Its bytes are not here, so a drop
cannot be proven here either.</p>`;
      }
      return (
        actForm(ADMIN_REATTACH_PATH, formToken, name, "reattach — back into the gather") +
        "\n" +
        actForm(ADMIN_DROP_PATH, formToken, name, "drop…")
      );
    }
    const detach =
      rec.inboxOf !== undefined
        ? `<p>An inbox is durable: it does not detach. Revoke its connection to refuse further
writes, or drop it to forget it whole.</p>`
        : actForm(ADMIN_DETACH_PATH, formToken, name, "detach — keep it, out of the gather");
    return detach + "\n" + actForm(ADMIN_DROP_PATH, formToken, name, "drop…");
  };

  const detailPage = (
    gw: Gateway,
    table: ContainerTable,
    name: string,
    rec: ResolvedContainer,
    formToken: string,
  ): string => {
    const head =
      `<h1><code>${escapeHtml(name)}</code>.</h1>\n<p>${escapeHtml(stateOf(table, name, rec))}` +
      (rec.parent === undefined && rec.inboxOf === undefined
        ? " — your root."
        : ` — inside <code>${escapeHtml(rec.inboxOf ?? rec.parent!)}</code>.`) +
      "</p>";
    const back = `<p><a href="${ADMIN_PATH}">Back to your containers.</a></p>`;
    const forms = lifecycleForms(table, name, rec, formToken);

    if (table.detached.has(name)) {
      return page(
        name,
        `${head}
<p>This container is detached: kept, deliberately, and out of the gather. Its bytes are held, and
no read composes them until it is reattached.</p>
${forms}
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
${forms}
${back}`,
        );
      }
      onFault(`the admin page could not read container "${name}": ${detail}`);
      return page(
        name,
        `${head}
<p>This container's contents cannot be read right now. The store says no rather than why.</p>
${forms}
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
    return page(name, `${head}\n${listing}\n${forms}\n${back}`);
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
    htmlOut(res, 200, detailPage(gw, table, name, table.containers.get(name)!, session.formToken));
  };

  // --- the lifecycle POSTs (phase A2) ------------------------------------------------------------

  // The phase-6 provenance + form-token pair, shared by every POST on this door. Returns the
  // parsed fields and the session, or undefined after writing the refusal. Order is load-bearing:
  // provenance first (draining the body so a refusal leaves no bytes on a keep-alive socket),
  // then the session, then the token.
  const postGate = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ fields: Map<string, string>; user: string; formToken: string } | undefined> => {
    if (!gate.fromThisPage(req)) {
      await readBody(req);
      refuse(res, 403, "This request did not come from this store's own page.");
      return undefined;
    }
    const fields = new Map<string, string>();
    for (const [k, v] of new URLSearchParams((await readBody(req)) ?? "")) fields.set(k, v);
    const session = gate.peek(req);
    if (session === undefined) {
      refuse(res, 401, "No live session is presented here.");
      return undefined;
    }
    if (!sameSecret(fields.get("form_token") ?? "", session.formToken)) {
      refuse(res, 403, "This request did not come from this store's own page.");
      return undefined;
    }
    return { fields, user: session.user, formToken: session.formToken };
  };

  // The ground, provably able to sign: every lifecycle act is operator law over the live gateway.
  const signerGround = (res: ServerResponse): Gateway | undefined => {
    const gw = options.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so nothing was done.");
      return undefined;
    }
    if (gw.options.seed === undefined || gw.operatorAuthor === undefined) {
      refuse(res, 503, "This store cannot sign a declaration right now, so nothing was done.");
      return undefined;
    }
    return gw;
  };

  // The subtree gate on a write path: the target must lie inside the session user's own subtree,
  // re-derived from the live table. Outside — foreign or absent alike — is one uniform refusal.
  const targetOf = (
    gw: Gateway,
    user: string,
    fields: Map<string, string>,
    res: ServerResponse,
  ): { table: ContainerTable; name: string; rec: ResolvedContainer } | undefined => {
    const name = fields.get("name") ?? "";
    const table = gw.containers();
    if (!subtreeOf(table, user).has(name)) {
      notYours(res);
      return undefined;
    }
    return { table, name, rec: table.containers.get(name)! };
  };

  // The one redirect shape this door writes, always at its own path — never off-origin.
  const seeOther = (res: ServerResponse): void => {
    res.writeHead(303, {
      location: ADMIN_PATH,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end();
  };

  const postDeclare = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const table = gw.containers();
    const reach = subtreeOf(table, gated.user);
    const parent = gated.fields.get("parent") ?? "";
    if (!reach.has(parent)) {
      notYours(res);
      return;
    }
    // The child's name is subtree-shaped by construction: namespaced under the session user, so
    // it can never shadow another user's name or a system name. The typed name is never echoed.
    const name = (gated.fields.get("name") ?? "").trim();
    if (!name.startsWith(`${gated.user}:`) || name.length <= gated.user.length + 1) {
      refuse(
        res,
        400,
        `A child bears your own name and a colon — <code>${escapeHtml(gated.user)}:notes</code> — ` +
          "so it can never shadow another name. The name you gave does not, and nothing was declared.",
      );
      return;
    }
    if (table.containers.has(name)) {
      refuse(res, 409, "A container already bears that name. Nothing was declared.");
      return;
    }
    const posture = gated.fields.get("posture") ?? "";
    if (posture !== "shared" && posture !== "separate") {
      refuse(res, 400, "A child takes one posture, shared or separate. Nothing was declared.");
      return;
    }
    const membershipRaw = (gated.fields.get("membership") ?? "").trim();
    if (posture === "shared" && membershipRaw.length === 0) {
      refuse(
        res,
        400,
        "A shared container IS its membership — give the membership Term, or declare it " +
          "separate. Nothing was declared.",
      );
      return;
    }
    // The defect is named; the defective bytes are never echoed back into the DOM.
    let membership: unknown;
    if (membershipRaw.length > 0) {
      try {
        membership = JSON.parse(membershipRaw);
      } catch {
        refuse(res, 400, "The membership is not valid JSON, so nothing was declared.");
        return;
      }
      try {
        parseTerm(membership);
      } catch {
        refuse(
          res,
          400,
          "The membership parses as JSON but is not a valid Term, so nothing was declared.",
        );
        return;
      }
    }
    try {
      await gw.append([
        signClaims(
          containerClaims(
            {
              container: name,
              trust: "curated",
              posture,
              parent,
              ...(membership === undefined ? {} : { membership }),
            },
            gw.operatorAuthor!,
            gw.nextTimestamp(),
          ),
          gw.options.seed!,
        ),
      ]);
    } catch (err) {
      onFault(
        `the admin page could not declare "${name}" for ${gated.user}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(
        res,
        400,
        "The store refused this declaration, and it says no rather than why. Nothing was declared.",
      );
      return;
    }
    seeOther(res);
  };

  const postDetach = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const { table, name, rec } = target;
    if (table.detached.has(name)) {
      refuse(res, 409, "This container is already detached. Nothing changed.");
      return;
    }
    if (rec.inboxOf !== undefined) {
      refuse(
        res,
        409,
        "An inbox is durable: it does not detach. Revoke its connection to refuse further " +
          "writes, or drop it to forget it whole. Nothing changed.",
      );
      return;
    }
    if (rec.posture === "separate") {
      const pool = gw.attachedContainers.get(name);
      if (pool !== undefined && gw.quarantinePools.has(pool)) {
        // The program that attached this pool holds its only handle; closing its store from here
        // would strand that handle open over vanished bytes.
        refuse(
          res,
          409,
          "This container's store is held open by the program that attached it, and only that " +
            "program can close it. Detach it where it was opened. Nothing changed.",
        );
        return;
      }
      // Unattached and active: the at-rest record is the whole act — it covers the store the
      // erasure guard would otherwise name as a fault.
    }
    try {
      await gw.append([
        signClaims(
          detachClaims(name, undefined, gw.operatorAuthor!, gw.nextTimestamp()),
          gw.options.seed!,
        ),
      ]);
    } catch (err) {
      onFault(
        `the admin page could not land the detach record for "${name}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(res, 503, "The detach record could not land, so nothing changed.");
      return;
    }
    seeOther(res);
  };

  const postReattach = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const { table, name, rec } = target;
    const records = table.detached.get(name);
    if (records === undefined) {
      refuse(res, 409, "This container is not detached. Nothing changed.");
      return;
    }
    if (rec.posture === "separate") {
      // Honest scope: reattaching a separate pool needs its own backend, which a browser form
      // cannot supply. The page says so and points at the machine that holds the store.
      refuse(
        res,
        409,
        "This container keeps its own store, and a form cannot hand that store back. Reattach " +
          "it from the command line on the machine that holds it. Nothing changed.",
      );
      return;
    }
    // ONE batch: the listing never half-clears (H4) — every surviving record negates together.
    try {
      await gw.append(
        records.map((r) =>
          signClaims(negationOf(r.id, gw.operatorAuthor!, gw.nextTimestamp()), gw.options.seed!),
        ),
      );
    } catch (err) {
      onFault(
        `the admin page could not clear the detach record(s) for "${name}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(res, 503, "The detach record could not be cleared, so nothing changed.");
      return;
    }
    seeOther(res);
  };

  // What a drop of this container would truthfully be — resolved fresh at BOTH steps, because the
  // state can move between the confirm page and its return.
  type DropPlan =
    | { readonly act: "strike" }
    | { readonly act: "inbox"; readonly handle: Container }
    | { readonly act: "refuse"; readonly status: number; readonly message: string };

  const planDrop = (
    gw: Gateway,
    table: ContainerTable,
    name: string,
    rec: ResolvedContainer,
  ): DropPlan => {
    if (rec.posture === "shared") return { act: "strike" };
    if (table.detached.has(name)) {
      return {
        act: "refuse",
        status: 409,
        message:
          "This container is detached: its bytes are not attached here, and a drop this page " +
          "cannot prove at the bytes would be a lie. Nothing was forgotten.",
      };
    }
    const pool = gw.attachedContainers.get(name);
    if (pool === undefined || !gw.quarantinePools.has(pool)) {
      return {
        act: "refuse",
        status: 409,
        message:
          "This container's store is not attached, so nothing here can prove its bytes gone. " +
          "Nothing was forgotten.",
      };
    }
    const handle = gw.connectionInboxes.get(name);
    if (handle === undefined) {
      return {
        act: "refuse",
        status: 409,
        message:
          "This container's store is held open by the program that attached it, and only that " +
          "program's handle can run the byte-verified drop. Drop it where it was opened. " +
          "Nothing was forgotten.",
      };
    }
    return { act: "inbox", handle };
  };

  // Pending drop confirmations: single-use, bound to (user, name), oldest-out at the cap. A drop
  // performs only when the token this door minted comes back from its own confirm page.
  const confirmTokens = new Map<string, { user: string; name: string }>();
  const mintConfirm = (user: string, name: string): string => {
    if (confirmTokens.size >= CONFIRM_CAP) {
      confirmTokens.delete(confirmTokens.keys().next().value!);
    }
    const token = randomBytes(18).toString("base64url");
    confirmTokens.set(token, { user, name });
    return token;
  };

  const confirmPage = (
    name: string,
    rec: ResolvedContainer,
    count: number | undefined,
    formToken: string,
    confirmToken: string,
  ): string => {
    const held =
      count === undefined
        ? "What it gathers could not be counted just now."
        : `It holds ${count} delta${count === 1 ? "" : "s"}.`;
    const consequence =
      rec.posture === "shared"
        ? `<p>Dropping it strikes the declaration: the container forgets its shape, and the name
stops resolving. The deltas it gathered remain in the store — none of them is forgotten.</p>`
        : `<p>This is the inbox pool of one connection writing into
<code>${escapeHtml(rec.inboxOf ?? "")}</code>. Dropping it ends that connection whole: its pool
is purged at the bytes and verified gone, and its declaration is struck. Everything outside the
pool remains.</p>`;
    return page(
      "confirm the drop",
      `<h1>Drop <code>${escapeHtml(name)}</code>?</h1>
<p>${held}</p>
${consequence}
<p>This cannot be undone.</p>
<form method="post" action="${ADMIN_DROP_CONFIRM_PATH}">
${hiddenPair(formToken, name)}
<input type="hidden" name="confirm_token" value="${escapeHtml(confirmToken)}">
<button type="submit">yes — drop it</button>
</form>
<p><a href="${ADMIN_PATH}">No — keep it.</a></p>`,
    );
  };

  const postDrop = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const { table, name, rec } = target;
    const plan = planDrop(gw, table, name, rec);
    if (plan.act === "refuse") {
      refuse(res, plan.status, plan.message);
      return;
    }
    // What will be forgotten, counted where a read can truthfully count it.
    let count: number | undefined;
    try {
      count =
        plan.act === "inbox"
          ? plan.handle.members().length
          : gw.containerScope({ containers: [name] }).length;
    } catch {
      count = undefined;
    }
    htmlOut(
      res,
      200,
      confirmPage(name, rec, count, gated.formToken, mintConfirm(gated.user, name)),
    );
  };

  const postDropConfirm = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const { table, name, rec } = target;
    const presented = gated.fields.get("confirm_token") ?? "";
    const held = confirmTokens.get(presented);
    if (held === undefined || held.user !== gated.user || held.name !== name) {
      refuse(res, 403, "This drop was not confirmed from its own page, so nothing was forgotten.");
      return;
    }
    confirmTokens.delete(presented); // single-use, consumed before the act
    const plan = planDrop(gw, table, name, rec);
    if (plan.act === "refuse") {
      refuse(res, plan.status, plan.message);
      return;
    }
    if (plan.act === "inbox") {
      try {
        await plan.handle.drop();
      } catch (err) {
        onFault(
          `the admin page's drop of "${name}" refused: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        refuse(
          res,
          503,
          "The drop could not be proven at the bytes, so the pool remains attached and nothing " +
            "was reported forgotten.",
        );
        return;
      }
      seeOther(res);
      return;
    }
    // Shared: the drop is striking every surviving declaration — the deltas it gathered remain.
    try {
      const ids = survivingDeclarationIds(gw.reactor, gw.operatorAuthor!, name);
      await gw.append(
        ids.map((id) =>
          signClaims(negationOf(id, gw.operatorAuthor!, gw.nextTimestamp()), gw.options.seed!),
        ),
      );
    } catch (err) {
      onFault(
        `the admin page could not strike the declaration of "${name}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(res, 503, "The declaration could not be struck, so nothing was forgotten.");
      return;
    }
    seeOther(res);
  };

  const postCreateRoot = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const user = gated.user;
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
    seeOther(res);
  };

  const OWNED = new Set([
    ADMIN_PATH,
    ADMIN_CREATE_ROOT_PATH,
    ADMIN_CONTAINER_PATH,
    ADMIN_DECLARE_PATH,
    ADMIN_DETACH_PATH,
    ADMIN_REATTACH_PATH,
    ADMIN_DROP_PATH,
    ADMIN_DROP_CONFIRM_PATH,
  ]);

  const POSTS = new Map([
    [ADMIN_CREATE_ROOT_PATH, postCreateRoot],
    [ADMIN_DECLARE_PATH, postDeclare],
    [ADMIN_DETACH_PATH, postDetach],
    [ADMIN_REATTACH_PATH, postReattach],
    [ADMIN_DROP_PATH, postDrop],
    [ADMIN_DROP_CONFIRM_PATH, postDropConfirm],
  ]);

  return {
    owns: (pathname) => OWNED.has(pathname),
    async handle(pathname, req, res) {
      try {
        const poster = POSTS.get(pathname);
        if (poster !== undefined) {
          if (req.method === "POST") {
            await poster(req, res);
            return;
          }
          refuse(res, 405, `${pathname} answers POST.`);
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
