// The admin page (SPEC §40, phases A1–A5) — the door, the read surface, the container lifecycle,
// the schema panel, the promotion/federation panels, and the connections panel. `GET /admin`
// renders the signed-in user's container subtree with the declare form, the connections panel, and
// the registered lenses; `GET /admin/container` renders one container's members with their promote
// forms, its lifecycle forms, and the federate-in form; `GET /admin/view` resolves a container's
// gather through a registered lens; and the POSTs are `create-root`, `declare`, `detach`,
// `reattach`, the two-step `drop` → `drop-confirm`, `register`, `promote`, `federate`, and the
// two-step `revoke` → `revoke-confirm`.
//
// THE CONNECTIONS PANEL reads the subtree's inbox pools from the live container table and joins
// them, when the server has a connector flow, with `oauth.json` — client name, generation, live
// tokens, phase 15's own read. Revoke is two-sided by §39.3c and it says so: the connection's NEXT
// write refuses, everything it already wrote keeps its author and stays readable, and any sibling
// connection is untouched. Where the row is a connector's, the revoke drives phase 15's
// `revokeConnector` FIRST (the generation bump is what kills a live bearer) and then strikes the
// inbox grant; a failure between the two is reported as exactly the half that happened.
//
// PROMOTION DRIVES `gw.promote` (T33's promote-outputs), never a reimplementation: the page's own
// gate is only the subtree and "is this delta in the container's gather"; every refusal about the
// delta itself — law-shapes, withdrawn outputs, dangling cites — is promote's, surfaced in its own
// words. FEDERATE-IN lands a PASTED offer (the body of `GET /federate`) and adds no authorship:
// each delta crosses by its own signature, through the container's own door — a separate
// container's pool, or the primary for a shared one, whose membership then decides the gather. The
// page is paste-only by design; the network leg of a pull belongs to `loam pull`, not to a door
// that would otherwise fetch caller-named URLs from inside the store's own host.
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
import { CACHE_NO_STORE } from "./respond.js";
import { parseUrlEncoded, readBodyLenient as readBody } from "./body.js";
import {
  authorForSeed,
  parseTerm,
  signClaims,
  type Claims,
  type Delta,
  type Reactor,
  evalTerm,
  DeltaSet,
} from "@bombadil/rhizomatic";
import { readUserSeed, userSeedPath, writeUserSeed } from "../cli/config.js";
import { parseOffer } from "../federation/offer.js";
import { CTX_GRANTS, grantClaims, holdsGrant } from "../gateway/accounts.js";
import { withBatchNegationClosure } from "../gateway/ingest.js";
import { rolesOf } from "./users.js";
import {
  containerClaims,
  detachClaims,
  survivingDeclarationIds,
  type Container,
  type ContainerTable,
  type ResolvedContainer,
} from "../gateway/container.js";
import { Gateway, type FederationReport } from "../gateway/gateway.js";
import { STORE_ENTITY } from "../gateway/genesis.js";
import { queryFieldFor } from "../gateway/gql.js";
import {
  lensOf,
  parseRegistrationInput,
  readRegistrations,
  type Registration,
  type RegistrationInput,
} from "../gateway/registration.js";
import { MemoryBackend } from "../store/memory.js";
import { clientFor, readOAuthFile, type OAuthFile } from "./oauth-file.js";
import { revokeConnector } from "./oauth.js";
import { CSP, escapeHtml, page, sameSecret, type SessionGate } from "./session.js";
import {
  ADMIN_PATH,
  ADMIN_CREATE_ROOT_PATH,
  ADMIN_CONTAINER_PATH,
  ADMIN_DECLARE_PATH,
  ADMIN_DETACH_PATH,
  ADMIN_REATTACH_PATH,
  ADMIN_DROP_PATH,
  ADMIN_DROP_CONFIRM_PATH,
  ADMIN_REGISTER_PATH,
  ADMIN_VIEW_PATH,
  ADMIN_PROMOTE_PATH,
  ADMIN_FEDERATE_PATH,
  ADMIN_REVOKE_PATH,
  ADMIN_REVOKE_CONFIRM_PATH,
  adminPages,
  type RevokePlan,
} from "./admin-pages.js";

const MAX_BODY = 8 * 1024; // tokens, a name, a membership Term; nothing here needs more
// A registration carries a hyperschema body and a resolution schema — real JSON, not a name.
const REGISTER_MAX_BODY = 64 * 1024;
// A pasted offer carries real deltas — a store's worth, potentially. Bounded, but generously.
const FEDERATE_MAX_BODY = 1024 * 1024;

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
  /**
   * The connector flow's home (`oauth.json` lives there), when the server has one. Absent, the
   * connections panel still exists — it lists the subtree's inbox pools from the container table
   * alone, and says the store has no connector flow configured.
   */
  readonly connectors?: { readonly home: string };
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
// The membership Term a SHARED container resolves right now — inline, or from its published
// address. `undefined` where it resolves none (H9: the caller must refuse, never treat that as
// "everything" or "nothing").
function membershipTermOf(
  gw: Gateway,
  rec: ResolvedContainer,
): ReturnType<typeof parseTerm> | undefined {
  let raw: unknown = rec.membership;
  if (raw === undefined && rec.membershipAt !== undefined) {
    const published = gw.reactor.get(rec.membershipAt);
    if (published === undefined) return undefined;
    const text = published.claims.pointers.find(
      (p) => p.role === "term" && p.target.kind === "primitive",
    );
    if (text === undefined || text.target.kind !== "primitive") return undefined;
    try {
      raw = JSON.parse(String(text.target.value));
    } catch {
      return undefined;
    }
  }
  if (raw === undefined) return undefined;
  try {
    return parseTerm(raw);
  } catch {
    return undefined;
  }
}

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

export function makeAdminDoor(options: AdminDoorOptions): AdminDoor {
  const gate = options.gate;
  const onFault = options.onFault ?? ((message: string): void => void message);

  const htmlOut = (res: ServerResponse, status: number, body: string, cookie?: string): void => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": CSP,
      "cache-control": CACHE_NO_STORE,
      // Never no-referrer on a form-hosting page — it nulls the form POST's Origin and
      // fromThisPage refuses null (T143). same-origin sends nothing cross-origin.
      "referrer-policy": "same-origin",
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

  // --- the connections panel (phase A5) ----------------------------------------------------------

  // The connection key from the inbox's deterministic name (`inbox:<container>:<key>`,
  // container.ts's inboxName). A container name may itself carry colons, so the parse anchors on
  // the row's own `inboxOf` instead of splitting on ":". A hand-declared inbox whose name does not
  // follow the shape yields no key, and the panel says so rather than guessing.
  const connectionKeyOf = (name: string, bound: string): string | undefined => {
    const prefix = `inbox:${bound}:`;
    return name.startsWith(prefix) && name.length > prefix.length
      ? name.slice(prefix.length)
      : undefined;
  };

  // What the inbox pool's own grant deltas say about the key. "Revoked" is claimed only where a
  // struck write grant proves a connection once stood — the state is read from the deltas on every
  // request, never remembered by this door.
  const grantStateOf = (
    reactor: Reactor,
    operator: string | undefined,
    key: string,
  ): "active" | "revoked" | "ungranted" => {
    if (holdsGrant(reactor, STORE_ENTITY, key, "write", operator)) return "active";
    for (const id of reactor.byTarget(STORE_ENTITY)) {
      const delta = reactor.get(id);
      if (delta === undefined) continue;
      const ptrs = delta.claims.pointers;
      const atGrants = ptrs.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.id === STORE_ENTITY &&
          p.target.entity.context === CTX_GRANTS,
      );
      if (!atGrants) continue;
      let subject: string | undefined;
      let verb: string | undefined;
      for (const p of ptrs) {
        if (p.target.kind !== "primitive") continue;
        if (p.role === "subject" && typeof p.target.value === "string") subject = p.target.value;
        if (p.role === "verb" && typeof p.target.value === "string") verb = p.target.value;
      }
      if (subject === key && verb === "write") return "revoked";
    }
    return "ungranted";
  };

  // The connector records, read fresh per render. Unreadable is its own state: "cannot determine
  // what is registered" is never "nothing is" (oauth-file.ts's rule), so the panel says the records
  // cannot be read rather than rendering rows as bare.
  type ConnectorRecords =
    | { readonly kind: "none" }
    | { readonly kind: "unreadable" }
    | { readonly kind: "read"; readonly file: OAuthFile };
  const connectorRecords = (): ConnectorRecords => {
    if (options.connectors === undefined) return { kind: "none" };
    try {
      return { kind: "read", file: readOAuthFile(options.connectors.home) };
    } catch (err) {
      onFault(
        `the admin page could not read the connector records: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return { kind: "unreadable" };
    }
  };

  // The oauth half of a row: the client whose granted actor IS this connection key. Live tokens
  // are counted the way the door counts them — a token whose generation no longer matches its
  // client's is dead already, so it is not a "live" anything.
  interface ConnectorJoin {
    readonly clientId: string;
    readonly clientName?: string;
    readonly generation?: number;
    readonly liveTokens: number;
  }
  const joinFor = (records: ConnectorRecords, key: string): ConnectorJoin | undefined => {
    if (records.kind !== "read") return undefined;
    const grant = records.file.grants.find((g) => g.actor === key);
    if (grant === undefined) return undefined;
    const client = clientFor(records.file, grant.clientId);
    const liveTokens =
      client === undefined
        ? 0
        : records.file.tokens.filter(
            (t) => t.clientId === grant.clientId && t.generation === client.generation,
          ).length;
    return {
      clientId: grant.clientId,
      ...(client === undefined
        ? {}
        : { clientName: client.clientName, generation: client.generation }),
      liveTokens,
    };
  };

  // A key, shortened for the row. The full key rides in the title attribute, so hovering (and any
  // exact search) still has the whole of it; the inbox's own page carries it in full too.
  const shortKey = (key: string): string => (key.length <= 24 ? key : `${key.slice(0, 24)}…`);

  const connectionRowHtml = (
    gw: Gateway,
    records: ConnectorRecords,
    name: string,
    rec: ResolvedContainer,
    formToken: string,
  ): string => {
    const bound = rec.inboxOf!;
    const inboxLink = `<a href="${escapeHtml(pages.detailHref(name))}">its inbox</a> — drop lives there`;
    const key = connectionKeyOf(name, bound);
    if (key === undefined) {
      return (
        `<li><code>${escapeHtml(name)}</code> — an inbox of <code>${escapeHtml(bound)}</code> ` +
        `whose name does not carry its connection key, so this panel can neither read nor revoke ` +
        `it. ${inboxLink}.</li>`
      );
    }
    const pool = gw.attachedContainers.get(name);
    const state =
      pool === undefined ? undefined : grantStateOf(pool.reactor, gw.operatorAuthor, key);
    const stateWords =
      state === undefined
        ? "its inbox pool is not attached here, so its grant cannot be read from this page"
        : state === "active"
          ? "active — its writes land"
          : state === "revoked"
            ? "revoked — its next write refuses; everything it wrote is kept, author intact"
            : "holds no write grant — its next write refuses";
    const join = joinFor(records, key);
    const via =
      join === undefined
        ? ""
        : ` · via <code>${escapeHtml(join.clientName ?? join.clientId)}</code>` +
          (join.generation === undefined ? "" : `, generation ${join.generation}`) +
          `, ${join.liveTokens} live token${join.liveTokens === 1 ? "" : "s"}`;
    // The form is an OFFER (revoke re-derives everything): shown where something stands to revoke —
    // a standing inbox grant, or a connector grant the records still hold.
    const revocable = state === "active" || join !== undefined;
    const form = revocable
      ? `\n${pages.actForm(ADMIN_REVOKE_PATH, formToken, name, "revoke…")}`
      : "";
    return (
      `<li><code title="${escapeHtml(key)}">${escapeHtml(shortKey(key))}</code> → ` +
      `<a href="${escapeHtml(pages.detailHref(bound))}"><code>${escapeHtml(bound)}</code></a> — ` +
      `${stateWords}${via} · ${inboxLink}.${form}</li>`
    );
  };

  const connectionsPanelHtml = (
    gw: Gateway,
    table: ContainerTable,
    reach: ReadonlySet<string>,
    formToken: string,
  ): string => {
    const records = connectorRecords();
    const names = [...reach].filter((n) => table.containers.get(n)!.inboxOf !== undefined).sort();
    const listing =
      names.length === 0
        ? "<p>No connection is bound in your subtree.</p>"
        : `<ul>\n${names
            .map((n) => connectionRowHtml(gw, records, n, table.containers.get(n)!, formToken))
            .join("\n")}\n</ul>`;
    const flowNote =
      records.kind === "none"
        ? `<p>This store has no connector flow configured — a connection here is a bare bound one,
with no client name or token to show.</p>`
        : records.kind === "unreadable"
          ? `<p>This store's connector records cannot be read right now, so no client names or
token counts are shown.</p>`
          : "";
    return `<h2>Connections.</h2>
<p>A connection is an outside writer — an MCP client, a connector — bound to one container of
yours. Its writes land in an inbox of their own. Revoking a connection refuses its next write;
everything it already wrote is kept, author intact.</p>
${listing}
${flowNote}`;
  };

  // T153 slice 3a: the pure page renderers now live in admin-pages.ts. The connectors panel
  // stays here (it reads the connector store through the closure) and is injected as the factory's
  // `connectionsPanel`; home and onFault ride in with it.
  const pages = adminPages({ home: options.home, onFault, connectionsPanel: connectionsPanelHtml });
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
      htmlOut(res, 200, pages.createOfferPage(session.user, session.formToken));
      return;
    }
    htmlOut(res, 200, pages.dashboardPage(gw, session.user, table, reach, session.formToken));
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
    htmlOut(
      res,
      200,
      pages.detailPage(gw, table, name, table.containers.get(name)!, session.formToken),
    );
  };

  // --- the resolved view (phase A3) --------------------------------------------------------------

  // Resolve one entity of one lens over exactly a container's gather: federate the gather into a
  // scratch store, register the lens there, and ask GraphQL — the same read any door serves,
  // scoped to this one container. The scratch is CLOSED on every path. "Reads nothing" is measured
  // at the EVIDENCE, not the value: the resolved node's hyperview hash is compared against the
  // same lens over an empty ground, so a schema whose defaults synthesize values (absentAs) cannot
  // make an unread container look read.
  const resolveThrough = async (
    regs: readonly Registration[],
    reg: Registration,
    members: readonly Delta[],
    entity: string,
  ): Promise<{ view: Record<string, unknown>; empty: boolean }> => {
    const dest = await Gateway.open(new MemoryBackend(), {});
    try {
      // Install every registered lens in fixpoint rounds (a lens's expand may read a sibling),
      // exactly as replay installs them: the chosen lens takes the entity as its root; the rest
      // bind rootless, present only so references resolve. One that never binds is left out.
      let pending = regs.map((r) => ({ r, roots: r === reg ? [entity] : [] }));
      for (;;) {
        const next: typeof pending = [];
        for (const p of pending) {
          try {
            dest.register(p.r.hyperschema, p.r.schema, p.roots, undefined, p.r.writable);
          } catch {
            next.push(p);
          }
        }
        if (next.length === pending.length) break;
        pending = next;
      }
      if (pending.some((p) => p.r === reg)) {
        throw new Error(`the lens "${lensOf(reg)}" did not bind in the scratch store`);
      }
      const field = queryFieldFor(lensOf(reg));
      const q = `query($e: ID!) { ${field}(entity: $e) { _hviewHex _view } }`;
      // The baseline FIRST, before any evidence lands: what this lens gathers of nothing.
      const blank = await dest.query(q, { e: entity });
      await dest.federate(members, { admit: () => true });
      const read = await dest.query(q, { e: entity });
      if (read.errors !== undefined) throw new Error(read.errors.join(", "));
      type Node = { _hviewHex?: string; _view?: unknown } | null;
      const nodeOf = (data: Record<string, unknown> | null | undefined): Node => {
        const v = data?.[field] ?? null;
        return typeof v === "object" ? v : null;
      };
      const node = nodeOf(read.data);
      const blankNode = nodeOf(blank.data);
      if (node === null) return { view: {}, empty: true };
      const view = (node._view ?? {}) as Record<string, unknown>;
      return { view, empty: node._hviewHex === blankNode?._hviewHex };
    } finally {
      await dest.close();
    }
  };

  const getView = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const session = loginOrUndefined(req, res);
    if (session === undefined) return;
    const gw = options.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so this page cannot load.");
      return;
    }
    const url = new URL(req.url ?? "", "http://loam.invalid");
    const container = url.searchParams.get("container") ?? "";
    const lens = url.searchParams.get("lens") ?? "";
    const entity = url.searchParams.get("entity") ?? "";
    const table = gw.containers();
    // The door's gate, on the CONTAINER the read would gather: outside the subtree — foreign or
    // absent alike — is one uniform refusal.
    if (!subtreeOf(table, session.user).has(container)) {
      notYours(res);
      return;
    }
    const back =
      `<p><a href="${escapeHtml(pages.detailHref(container))}">Back to ` +
      `<code>${escapeHtml(container)}</code>.</a></p>`;
    let members: readonly Delta[];
    try {
      members = gw.containerScope({ containers: [container] });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (detail.includes("is not attached")) {
        htmlOut(
          res,
          200,
          page(
            "nothing to read",
            `<h1>Nothing to read.</h1>
<p><code>${escapeHtml(container)}</code> is declared, not attached — its bytes are not readable
from here, so no lens can be resolved over it.</p>
${back}`,
          ),
        );
        return;
      }
      onFault(`the admin view page could not read container "${container}": ${detail}`);
      refuse(res, 503, "This container's contents cannot be read right now.");
      return;
    }
    const regs = readRegistrations(gw.reactor, gw.operatorAuthor);
    if (lens === "") {
      // The lens picker: honestly cheap — every registered lens, as a link into this same page.
      const choices =
        regs.length === 0
          ? `<p>No lens is registered on this store yet, so there is nothing to read through.
Register one <a href="${ADMIN_PATH}">from your page</a>.</p>`
          : `<ul>\n${regs
              .map(
                (r) =>
                  `<li><a href="${escapeHtml(pages.viewHref(container, entity === "" ? undefined : entity, lensOf(r)))}">` +
                  `<code>${escapeHtml(lensOf(r))}</code></a></li>`,
              )
              .join("\n")}\n</ul>`;
      htmlOut(
        res,
        200,
        page(
          "choose a lens",
          `<h1>Choose a lens.</h1>
<p>A view is a reading: a container's gather, resolved through one registered lens.</p>
${choices}
${back}`,
        ),
      );
      return;
    }
    const reg = regs.find((r) => lensOf(r) === lens);
    if (reg === undefined) {
      refuse(res, 404, "No registered lens bears that name, so there is nothing to read through.");
      return;
    }
    if (entity === "") {
      htmlOut(
        res,
        200,
        page(
          "name an entity",
          `<h1>Name an entity.</h1>
<p>A view resolves at one entity. The members of
<a href="${escapeHtml(pages.detailHref(container))}"><code>${escapeHtml(container)}</code></a> link
each entity they point at straight to this page.</p>`,
        ),
      );
      return;
    }
    let resolved: { view: Record<string, unknown>; empty: boolean };
    try {
      resolved = await resolveThrough(regs, reg, members, entity);
    } catch (err) {
      onFault(
        `the admin view page could not resolve "${entity}" through "${lens}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(res, 503, "This view could not be resolved right now.");
      return;
    }
    const count = members.length;
    const head =
      `<h1>Reading <code>${escapeHtml(entity)}</code> through <code>${escapeHtml(lens)}</code>.</h1>\n` +
      `<p>Over the gather of <code>${escapeHtml(container)}</code> — ` +
      `${count} raw member${count === 1 ? "" : "s"} beside this resolved view.</p>`;
    const bodyHtml = resolved.empty
      ? `<p>This lens reads nothing here. No claim in this container's gather is evidence for this
entity under this lens — not an empty record, but the absence of one. The container may hold data
this lens does not gather; the lens may read ground this container does not hold.</p>`
      : pages.viewFieldsHtml(resolved.view);
    htmlOut(res, 200, page("a resolved view", `${head}\n${bodyHtml}\n${back}`));
  };

  // --- the lifecycle POSTs (phase A2) ------------------------------------------------------------

  // The phase-6 provenance + form-token pair, shared by every POST on this door. Returns the
  // parsed fields and the session, or undefined after writing the refusal. Order is load-bearing:
  // provenance first (draining the body so a refusal leaves no bytes on a keep-alive socket),
  // then the session, then the token.
  const postGate = async (
    req: IncomingMessage,
    res: ServerResponse,
    maxBody = MAX_BODY,
  ): Promise<{ fields: Map<string, string>; user: string; formToken: string } | undefined> => {
    if (!gate.fromThisPage(req)) {
      await readBody(req, maxBody);
      refuse(res, 403, "This request did not come from this store's own page.");
      return undefined;
    }
    const fields = parseUrlEncoded((await readBody(req, maxBody)) ?? "");
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

  // Pending confirmations: single-use, bound to (user, name), oldest-out at the cap. An act
  // performs only when the token this door minted comes back from its own confirm page. Drop and
  // revoke keep SEPARATE stores, so a token minted to confirm one act can never authorize the other.
  const mintConfirm = (
    store: Map<string, { user: string; name: string }>,
    user: string,
    name: string,
  ): string => {
    if (store.size >= CONFIRM_CAP) {
      store.delete(store.keys().next().value!);
    }
    const token = randomBytes(18).toString("base64url");
    store.set(token, { user, name });
    return token;
  };
  const confirmTokens = new Map<string, { user: string; name: string }>();
  const revokeTokens = new Map<string, { user: string; name: string }>();

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
      pages.confirmPage(
        name,
        rec,
        count,
        gated.formToken,
        mintConfirm(confirmTokens, gated.user, name),
      ),
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
    // public key. An ACTOR created at the CLI has none (`user create` mints keys only with
    // --operator — T124's pinned design), and no command provisions one later — so a tenant who
    // can already log in would dead-end here. The door PROVISIONS instead (Myk, 2026-08-02: tenant
    // actor users act through their own containers): mint the key, write it 0600 beside the
    // others, and trust it with a WRITE grant, all before the declaration. A seed file that
    // EXISTS but cannot be used still fails closed — overwriting a key file because it read
    // wrong would destroy a credential this door cannot prove dead.
    if (gw.options.seed === undefined || gw.operatorAuthor === undefined) {
      refuse(res, 503, "This store cannot sign a declaration right now, so nothing was made.");
      return;
    }
    const seed = readUserSeed(options.home, user);
    let userKey: string;
    if (seed.kind === "present" && /^[0-9a-f]{64}$/.test(seed.seed)) {
      userKey = seed.seed;
    } else if (seed.kind === "absent") {
      const minted = randomBytes(32).toString("hex");
      try {
        writeUserSeed(options.home, user, minted);
        await gw.append([
          signClaims(
            grantClaims(
              STORE_ENTITY,
              authorForSeed(minted),
              "write",
              gw.operatorAuthor,
              gw.nextTimestamp(),
            ),
            gw.options.seed,
          ),
        ]);
      } catch (err) {
        onFault(
          `the admin page could not provision a signing key for ${user}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        refuse(
          res,
          503,
          "Your signing key could not be provisioned, so no container was made. Nothing partial " +
            "was kept.",
        );
        return;
      }
      userKey = minted;
    } else {
      onFault(
        `the admin page cannot use ${userSeedPath(options.home, user)}: ` +
          (seed.kind === "unreadable"
            ? seed.detail
            : "it is present but is not a 64-character hex signing key"),
      );
      refuse(
        res,
        409,
        "This user's signing key exists on this store but cannot be used, so no container was " +
          "made. Ask the store's operator to repair it.",
      );
      return;
    }
    // Operator law: the declaration is signed by the store, once the door has proven the target
    // is the session user's own name — which it is by construction here.
    const spec = {
      container: user,
      trust: "curated" as const,
      posture: "shared" as const,
      membership: authoredBy(authorForSeed(userKey)),
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

  // Register a lens through the browser (§40 criterion 8): the SAME body `loam register` and
  // `POST /:mount/register` take, parsed by the same parser, landed by the same publish.
  //
  // REGISTRATION IS CONSTITUTIONAL AND STORE-WIDE, so this door asks for the OPERATOR role — the
  // one operation here that is not bounded by a subtree. A lens is not per-user: publishing under
  // a live name EVOLVES it for every reader and every mount, so a tenant session reaching this
  // would hold store-wide power the sibling doors already refuse it (`POST /:mount/register` and
  // the `loam_register` tool both require an operator). The role is read from the GROUND, which is
  // where roles live — a session carries a name, never a privilege.
  const postRegister = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res, REGISTER_MAX_BODY);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    if (!rolesOf(gw.reactor, gw.operatorAuthor, gated.user).has("operator")) {
      refuse(
        res,
        403,
        "Registering a schema is store-wide law, so it asks for the operator role. Your own " +
          "containers are yours; this one names what every reader sees.",
      );
      return;
    }
    const raw = (gated.fields.get("registration") ?? "").trim();
    // The defect is named; the defective bytes are never echoed back into the DOM.
    if (raw.length === 0) {
      refuse(res, 400, "The registration is empty, so nothing was registered.");
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      refuse(res, 400, "The registration is not valid JSON, so nothing was registered.");
      return;
    }
    let input: RegistrationInput;
    try {
      input = parseRegistrationInput(body);
    } catch (err) {
      // The parser names the defective FIELD in plain English, and its message can quote a name
      // the caller typed — so it is escaped before it rides into the DOM. No path, no flag.
      const detail = err instanceof Error ? err.message : String(err);
      refuse(res, 400, `${escapeHtml(detail)} — so nothing was registered.`);
      return;
    }
    try {
      await gw.publishRegistration(
        input.hyperschema,
        input.schema,
        input.roots,
        undefined,
        input.entity,
        input.mutations,
        input.writable,
        input.resolvers,
      );
    } catch (err) {
      onFault(
        `the admin page could not register "${input.hyperschema.name}": ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(
        res,
        400,
        "The store refused this registration, and it says no rather than why. Nothing was registered.",
      );
      return;
    }
    seeOther(res);
  };

  // Promote a container's output into the primary ground (§40 criterion 10) — the page drives
  // `gw.promote` (T33's promote-outputs) and never re-decides its law. The page's own gate is
  // narrow: the subtree, then "is this delta in the container's gather" — asked of the gather so a
  // delta id outside it is refused without confirming whether it exists anywhere else. The source
  // handed to promote is the attached store that actually HOLDS the output: the container's own
  // pool, or an inbox pool composing into its gather (§39).
  const postPromote = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res); // an adoption is the operator's own claim — the store must sign
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const { table, name } = target;
    let gather: readonly Delta[];
    try {
      gather = gw.containerScope({ containers: [name] });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (detail.includes("is not attached")) {
        refuse(
          res,
          409,
          "This container's bytes are not attached here, so its gather cannot be read and " +
            "nothing was promoted.",
        );
        return;
      }
      onFault(`the admin promote could not read the gather of "${name}": ${detail}`);
      refuse(
        res,
        503,
        "This container's gather cannot be read right now, so nothing was promoted.",
      );
      return;
    }
    // The typed id is never echoed: only an id proven to be IN the gather rides back into the DOM.
    const deltaId = gated.fields.get("delta") ?? "";
    if (!gather.some((d) => d.id === deltaId)) {
      refuse(
        res,
        404,
        "That delta is not in this container's gather, so there is nothing to promote from " +
          "here — and whether it exists anywhere else, this page does not say.",
      );
      return;
    }
    if (gw.reactor.get(deltaId) !== undefined) {
      refuse(
        res,
        409,
        "This delta already lives in the primary ground — promotion moves a container's own " +
          "output into the primary, and there is nothing left to move.",
      );
      return;
    }
    // In the gather, not in the primary: it is held by an attached store — the container's own
    // pool, or an inbox pool bound to it.
    let source: Gateway | undefined;
    let from = name;
    const holders = [
      name,
      ...[...table.containers]
        .filter(([, rec]) => rec.inboxOf === name)
        .map(([inbox]) => inbox)
        .sort(),
    ];
    for (const holder of holders) {
      const pool = gw.attachedContainers.get(holder);
      if (
        pool !== undefined &&
        gw.quarantinePools.has(pool) &&
        pool.reactor.get(deltaId) !== undefined
      ) {
        source = pool;
        from = holder;
        break;
      }
    }
    if (source === undefined) {
      onFault(
        `the admin promote found ${deltaId} in the gather of "${name}" but in no attached store`,
      );
      refuse(
        res,
        503,
        "The store holding this delta cannot be reached right now, so nothing was promoted.",
      );
      return;
    }
    let promoted: string;
    try {
      promoted = (await gw.promote(source, deltaId, { from })).promoted;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Promote's own refusals are the product — its words, escaped, ride to the caller. Anything
      // else is a fault this page does not explain.
      if (/^(promotion refused:|promotion would dangle:|nothing to promote:)/.test(detail)) {
        refuse(res, 409, `${escapeHtml(detail)} Nothing was promoted.`);
        return;
      }
      onFault(`the admin promote of ${deltaId} from "${from}" failed: ${detail}`);
      refuse(
        res,
        503,
        "The store refused this promotion, and it says no rather than why. Nothing was promoted.",
      );
      return;
    }
    // Promote's own terms: a re-spoken claim in the primary, and a provenance record beside it.
    htmlOut(
      res,
      200,
      page(
        "promoted",
        `<h1>Promoted.</h1>
<p>The store re-spoke the output as its own claim in the primary ground —
<code>${escapeHtml(promoted)}</code> — and a provenance record beside it names where it came from:
<code>${escapeHtml(from)}</code>, delta <code>${escapeHtml(deltaId)}</code>. The trail is kept
forever; the value now survives even if its container is dropped.</p>
<p><a href="${escapeHtml(pages.detailHref(name))}">Back to <code>${escapeHtml(name)}</code>.</a></p>`,
      ),
    );
  };

  // Land a pasted offer in one subtree container (§40 criterion 11). The page adds no authorship —
  // each delta crosses by its own signature, verified where every federated delta is verified. A
  // SEPARATE container takes the offer through its pool's own door (its own admission); a SHARED
  // one through the primary's door, and its membership then decides what the container gathers.
  // The result page tells both numbers, because both are true and they differ.
  const postFederate = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res, FEDERATE_MAX_BODY);
    if (gated === undefined) return;
    const gw = options.ground();
    if (gw === undefined) {
      refuse(res, 503, "This store's ground is not reachable, so nothing landed.");
      return;
    }
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const { table, name, rec } = target;
    if (table.detached.has(name)) {
      refuse(
        res,
        409,
        "This container is detached, deliberately out of the gather — reattach it before " +
          "landing anything into its world. Nothing landed.",
      );
      return;
    }
    const raw = (gated.fields.get("offer") ?? "").trim();
    if (raw.length === 0) {
      refuse(res, 400, "The offer is empty, so nothing landed.");
      return;
    }
    // parseOffer refuses the WHOLE paste on the first bad delta — a corrupt offer is reported
    // whole, never quietly landed in part. Its message can quote a forged id, so it is escaped.
    let deltas: Delta[];
    try {
      deltas = parseOffer(raw);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      refuse(res, 400, `${escapeHtml(detail)} — nothing landed.`);
      return;
    }
    let report: FederationReport;
    let door: string;
    try {
      if (rec.posture === "separate") {
        const pool = gw.attachedContainers.get(name);
        if (pool === undefined || !gw.quarantinePools.has(pool)) {
          refuse(
            res,
            409,
            "This container keeps its own store, and that store is not attached here — an " +
              "offer lands through the container's own door or not at all. Attach it first. " +
              "Nothing landed.",
          );
          return;
        }
        report = await pool.federate(deltas); // no override: the pool's own admission decides
        door = "its own store";
      } else {
        // A SHARED container has no store of its own: its deltas live in the primary ground, which
        // every other user's containers also cut. So the write is BOUNDED TO WHAT THIS CONTAINER
        // GATHERS — the subtree gate authorizes landing bytes in ada's world, not in the store at
        // large, and an unbounded `federate` here would let any tenant seed the primary with
        // deltas another user's membership Term happens to select. The bound is the container's
        // own membership, evaluated over the OFFER, plus the offer-local negation closure (H1: a
        // subset that drops an admitted delta's strike revives it).
        const term = membershipTermOf(gw, rec);
        if (term === undefined) {
          refuse(
            res,
            409,
            "This container resolves no membership just now, so there is nothing to land into. " +
              "Nothing landed.",
          );
          return;
        }
        const result = evalTerm(term, DeltaSet.from(deltas));
        if (result.sort !== "dset") {
          refuse(
            res,
            409,
            "This container's membership does not select a delta set, so there is nothing to " +
              "land into. Nothing landed.",
          );
          return;
        }
        const admitted = new Set(
          withBatchNegationClosure(deltas, [...result.set]).map((d) => d.id),
        );
        report = await gw.federate(deltas, { admit: (d) => admitted.has(d.id) });
        door = "the primary ground, bounded to this container's membership";
      }
    } catch (err) {
      onFault(
        `the admin federate into "${name}" failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      refuse(res, 503, "The store could not land this offer, and it says no rather than why.");
      return;
    }
    // The second number: of the offered deltas, how many the container's gather now holds. Landing
    // and gathering are different doors, and the page must not let one count impersonate the other.
    let gathered: number | undefined;
    try {
      const ids = new Set(gw.containerScope({ containers: [name] }).map((d) => d.id));
      gathered = deltas.reduce((n, d) => (ids.has(d.id) ? n + 1 : n), 0);
    } catch {
      gathered = undefined;
    }
    // Held and repeats are different dimensions, and neither is inferred: the door reports held as
    // a UNIQUE-id fact (a refused delta offered twice counts twice in `rejected` and once in the
    // complement of `held`), and repeats are the paste's own extra copies. Held-by-the-store is
    // not the same fact as repeated-in-your-paste, and the page never subtracts one from the other.
    const inPasteDuplicates = deltas.length - new Set(deltas.map((d) => d.id)).size;
    const held = report.held;
    const gatherLine =
      gathered === undefined
        ? "What this container now gathers could not be counted just now."
        : `This container now gathers ${gathered} of the ${report.offered} offered` +
          (rec.posture === "separate"
            ? "."
            : " — its membership decides the gather, so a landed delta its membership does not " +
              "select never enters this container's world.");
    htmlOut(
      res,
      200,
      page(
        "federated",
        `<h1>Federated.</h1>
<p>Of ${report.offered} offered delta${report.offered === 1 ? "" : "s"}` +
          `${inPasteDuplicates > 0 ? ` (${inPasteDuplicates} of them repeats in the paste)` : ""}: ` +
          `${report.accepted} landed newly in ${door}, ` +
          `${report.rejected} ${report.rejected === 1 ? "was" : "were"} refused at the door` +
          `${held > 0 ? `, and ${held} ${held === 1 ? "was" : "were"} already held` : ""}. ` +
          `Each crossed by its own signature — this page added no authorship.</p>
<p>${gatherLine}</p>
<p><a href="${escapeHtml(pages.detailHref(name))}">Back to <code>${escapeHtml(name)}</code>.</a></p>`,
      ),
    );
  };

  // --- revoke a connection (phase A5) ------------------------------------------------------------

  // Every SURVIVING operator-authored grant delta at the store entity naming `subject` — what the
  // connector revoke strikes in the ground, the same derivation `loam grant revoke` runs.
  const survivingOperatorGrantIds = (
    reactor: Reactor,
    operator: string,
    subject: string,
  ): string[] => {
    const out: string[] = [];
    for (const id of reactor.byTarget(STORE_ENTITY)) {
      const delta = reactor.get(id);
      if (delta === undefined || delta.claims.author !== operator) continue;
      const ptrs = delta.claims.pointers;
      const atGrants = ptrs.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.id === STORE_ENTITY &&
          p.target.entity.context === CTX_GRANTS,
      );
      if (!atGrants) continue;
      const named = ptrs.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === subject,
      );
      if (!named) continue;
      if (reactor.negationsOf(id).some((n) => reactor.get(n) !== undefined)) continue;
      out.push(id);
    }
    return out;
  };

  // What a revoke of this connection would truthfully be — resolved fresh at BOTH steps, exactly
  // as a drop's plan is. It can have two halves, and either may stand alone: the §39.3c strike of
  // the write grant in the inbox pool (owner-authored, in the session user's voice), and phase 15's
  // connector revoke (generation bump + records strike + ground strike) when the key is a
  // connector's granted actor.

  const planRevoke = (
    gw: Gateway,
    user: string,
    name: string,
    rec: ResolvedContainer,
  ): RevokePlan => {
    const bound = rec.inboxOf;
    if (bound === undefined) {
      return {
        act: "refuse",
        status: 409,
        message:
          "This container is not a connection inbox, so there is no connection to revoke. " +
          "Nothing changed.",
      };
    }
    const key = connectionKeyOf(name, bound);
    if (key === undefined) {
      return {
        act: "refuse",
        status: 409,
        message:
          "This inbox's name does not carry its connection key, so this page cannot revoke it. " +
          "Nothing changed.",
      };
    }
    // The connector half. An unreadable records file refuses the WHOLE act: "cannot determine what
    // is registered" is never a licence to revoke only the half this page can see.
    let client: { clientId: string; clientName?: string; generation?: number } | undefined;
    if (options.connectors !== undefined) {
      let file: OAuthFile;
      try {
        file = readOAuthFile(options.connectors.home);
      } catch (err) {
        onFault(
          `the admin revoke could not read the connector records: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        return {
          act: "refuse",
          status: 503,
          message:
            "This store's connector records cannot be read right now, so nothing was revoked.",
        };
      }
      const grant = file.grants.find((g) => g.actor === key);
      if (grant !== undefined) {
        const c = clientFor(file, grant.clientId);
        client = {
          clientId: grant.clientId,
          ...(c === undefined ? {} : { clientName: c.clientName, generation: c.generation }),
        };
      }
    }
    // The §39 half: a standing write grant in the attached inbox pool, struck in the OWNER's
    // voice — the session user's own seed, never the operator's.
    const pool = gw.attachedContainers.get(name);
    const standing =
      pool !== undefined && holdsGrant(pool.reactor, STORE_ENTITY, key, "write", gw.operatorAuthor);
    let inboxLeg: { inbox: Container; ownerSeed: string } | undefined;
    if (standing) {
      const handle = gw.connectionInboxes.get(name);
      if (handle === undefined) {
        return {
          act: "refuse",
          status: 409,
          message:
            "This connection's inbox is attached but not bound as a live connection on this " +
            "server, so this page cannot strike its grant. Bind it again, then revoke. " +
            "Nothing was revoked.",
        };
      }
      const seed = readUserSeed(options.home, user);
      if (seed.kind !== "present" || !/^[0-9a-f]{64}$/.test(seed.seed)) {
        return {
          act: "refuse",
          status: 409,
          message:
            "You have no signing key on this store, so a revocation cannot be authored in your " +
            "name. Ask the store's operator to provision your key. Nothing was revoked.",
        };
      }
      inboxLeg = { inbox: handle, ownerSeed: seed.seed };
    }
    if (inboxLeg === undefined && client === undefined) {
      return pool !== undefined
        ? {
            act: "refuse",
            status: 409,
            message:
              "This connection holds no standing write grant — its next write already refuses. " +
              "There is nothing left to revoke.",
          }
        : {
            act: "refuse",
            status: 409,
            message:
              "This connection's inbox pool is not attached here, and no connector record names " +
              "its key — this page has nothing it can revoke.",
          };
    }
    return {
      act: "revoke",
      key,
      bound,
      ...(inboxLeg ?? {}),
      ...(client === undefined ? {} : { client }),
    };
  };

  const postRevoke = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res); // both halves author deltas under the store's law
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const plan = planRevoke(gw, gated.user, target.name, target.rec);
    if (plan.act === "refuse") {
      refuse(res, plan.status, plan.message);
      return;
    }
    htmlOut(
      res,
      200,
      pages.revokeConfirmPage(
        target.name,
        plan,
        gated.formToken,
        mintConfirm(revokeTokens, gated.user, target.name),
      ),
    );
  };

  const postRevokeConfirm = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res);
    if (gated === undefined) return;
    const gw = signerGround(res);
    if (gw === undefined) return;
    const target = targetOf(gw, gated.user, gated.fields, res);
    if (target === undefined) return;
    const { name, rec } = target;
    const presented = gated.fields.get("confirm_token") ?? "";
    const held = revokeTokens.get(presented);
    if (held === undefined || held.user !== gated.user || held.name !== name) {
      refuse(res, 403, "This revoke was not confirmed from its own page, so nothing was revoked.");
      return;
    }
    revokeTokens.delete(presented); // single-use, consumed before the act
    const plan = planRevoke(gw, gated.user, name, rec);
    if (plan.act === "refuse") {
      refuse(res, plan.status, plan.message);
      return;
    }
    // The connector half runs FIRST: the generation bump is what kills a live bearer, and a panel
    // that said "revoked" while a token still worked would be the exact lie this page must not
    // tell. If it fails, nothing has happened yet and the refusal can honestly say so.
    if (plan.client !== undefined) {
      const clientId = plan.client.clientId;
      const strike = async (grant: { actor: string }): Promise<void> => {
        const ids = survivingOperatorGrantIds(gw.reactor, gw.operatorAuthor!, grant.actor);
        if (ids.length === 0) return;
        await gw.append(
          ids.map((id) =>
            signClaims(negationOf(id, gw.operatorAuthor!, gw.nextTimestamp()), gw.options.seed!),
          ),
        );
      };
      const outcome = await revokeConnector(options.connectors!.home, clientId, strike, onFault);
      if (outcome.kind === "no-such-client") {
        refuse(
          res,
          409,
          "This connector left the records between the confirm page and now, so nothing was " +
            "revoked. Its row will say what still stands.",
        );
        return;
      }
      if (outcome.kind === "locked") {
        refuse(
          res,
          503,
          "This store's connector records are locked by another process, so nothing was revoked. " +
            "Retry once it is idle.",
        );
        return;
      }
      if (outcome.kind === "unreadable") {
        refuse(
          res,
          503,
          "This store's connector records cannot be read right now, so nothing was revoked.",
        );
        return;
      }
    }
    // The §39 half: strike the write grant in the inbox pool, in the owner's own voice. If it
    // fails AFTER the connector half succeeded, the page says exactly which half happened —
    // a half-done revoke reported whole is the H7 shape.
    if (plan.inbox !== undefined) {
      try {
        await gw.revokeConnection({
          inbox: plan.inbox,
          connectionKey: plan.key,
          ownerSeed: plan.ownerSeed!,
        });
      } catch (err) {
        onFault(
          `the admin revoke could not strike the inbox grant of "${name}": ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        refuse(
          res,
          503,
          plan.client !== undefined
            ? "The connector's tokens are retired, but the write grant in its inbox could not " +
                "be struck — this revoke is incomplete. Retry it."
            : "The revocation could not land, so nothing was revoked.",
        );
        return;
      }
    }
    const clientDone =
      plan.client === undefined
        ? ""
        : ` The connector <code>${escapeHtml(plan.client.clientName ?? plan.client.clientId)}</code>
holds no working token now — each is refused on its next request.`;
    htmlOut(
      res,
      200,
      page(
        "revoked",
        `<h1>Revoked.</h1>
<p><code>${escapeHtml(plan.key)}</code> no longer writes into
<code>${escapeHtml(plan.bound)}</code>: its next write is refused at the door.${clientDone}
Everything it already wrote remains, author intact, and every other connection is untouched.</p>
<p><a href="${escapeHtml(pages.detailHref(name))}">Its inbox</a> keeps the record — drop it there to
forget it whole.</p>
<p><a href="${ADMIN_PATH}">Back to your containers.</a></p>`,
      ),
    );
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
    ADMIN_REGISTER_PATH,
    ADMIN_VIEW_PATH,
    ADMIN_PROMOTE_PATH,
    ADMIN_FEDERATE_PATH,
    ADMIN_REVOKE_PATH,
    ADMIN_REVOKE_CONFIRM_PATH,
  ]);

  const POSTS = new Map([
    [ADMIN_CREATE_ROOT_PATH, postCreateRoot],
    [ADMIN_DECLARE_PATH, postDeclare],
    [ADMIN_DETACH_PATH, postDetach],
    [ADMIN_REATTACH_PATH, postReattach],
    [ADMIN_DROP_PATH, postDrop],
    [ADMIN_DROP_CONFIRM_PATH, postDropConfirm],
    [ADMIN_REGISTER_PATH, postRegister],
    [ADMIN_PROMOTE_PATH, postPromote],
    [ADMIN_FEDERATE_PATH, postFederate],
    [ADMIN_REVOKE_PATH, postRevoke],
    [ADMIN_REVOKE_CONFIRM_PATH, postRevokeConfirm],
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
        if (pathname === ADMIN_VIEW_PATH) {
          await getView(req, res);
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
