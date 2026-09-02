// T153 slice 3b — the admin door's FEDERATION/CONNECTOR group, moved out of makeAdminDoor
// verbatim: the connections panel (phase A5), the federate-in POST, and the two-step
// revoke → revoke-confirm pair. The seam: these read the connector records (`oauth.json`) and
// drive `revokeConnector` / `gw.federate`; the door helpers they share with the lifecycle POSTs —
// the POST gate, the signer ground, the subtree target gate, the response writers, the confirm-token
// mint, and the page renderers — are injected through AdminFederationCtx.
//
// Nothing in this module imports admin.ts, so there is no cycle: the door imports this group and
// wires its `connectionsPanelHtml` into the page factory.

import { type IncomingMessage, type ServerResponse } from "node:http";
import {
  evalTerm,
  parseTerm,
  signClaims,
  DeltaSet,
  type Claims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { readUserSeed } from "../cli/config.js";
import { parseOffer } from "../federation/offer.js";
import { CTX_GRANTS, holdsGrant } from "../gateway/accounts.js";
import { withBatchNegationClosure } from "../gateway/ingest.js";
import {
  type Container,
  type ContainerTable,
  type ResolvedContainer,
} from "../gateway/container.js";
import { Gateway, type FederationReport } from "../gateway/gateway.js";
import { STORE_ENTITY } from "../gateway/genesis.js";
import { clientFor, readOAuthFile, type OAuthFile } from "./oauth-file.js";
import { subtreeOf } from "./subtree.js";
import { revokeConnector } from "./oauth.js";
import { escapeHtml, page } from "./session.js";
import { ADMIN_PATH, ADMIN_REVOKE_PATH, adminPages, type RevokePlan } from "./admin-pages.js";

// A pasted offer carries real deltas — a store's worth, potentially. Bounded, but generously.
const FEDERATE_MAX_BODY = 1024 * 1024;

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

export interface AdminFederationCtx {
  /** The connector flow's home, when the server has one — makeAdminDoor's own option, passed whole. */
  readonly connectors?: { readonly home: string };
  /** The home the users' signing seeds live in. */
  readonly home: string;
  /** The users mount's live gateway, re-asked per request. */
  readonly ground: () => Gateway | undefined;
  readonly onFault: (message: string) => void;
  /** The door's HTML writer — headers are its policy, spelled once in admin.ts. */
  readonly htmlOut: (res: ServerResponse, status: number, body: string, cookie?: string) => void;
  readonly refuse: (res: ServerResponse, status: number, message: string) => void;
  /** The phase-6 provenance + form-token pair, shared by every POST on this door. */
  readonly postGate: (
    req: IncomingMessage,
    res: ServerResponse,
    maxBody?: number,
  ) => Promise<{ fields: Map<string, string>; user: string; formToken: string } | undefined>;
  /** The ground, provably able to sign — or the refusal, already written. */
  readonly signerGround: (res: ServerResponse) => Gateway | undefined;
  /** The subtree gate on a write path. */
  readonly targetOf: (
    gw: Gateway,
    user: string,
    fields: Map<string, string>,
    res: ServerResponse,
  ) => { table: ContainerTable; name: string; rec: ResolvedContainer } | undefined;
  /** The single-use confirm-token mint; this module keeps its own store, separate from drop's. */
  readonly mintConfirm: (
    store: Map<string, { user: string; name: string }>,
    user: string,
    name: string,
  ) => string;
  /** The negation-of-one-delta shape the door strikes with. */
  readonly negationOf: (targetId: string, author: string, timestamp: number) => Claims;
  /** The page renderers (admin-pages.ts) — detailHref, actForm, revokeConfirmPage. */
  readonly pages: ReturnType<typeof adminPages>;
}

/** The federation/connector door group, in one closure (moved verbatim from admin.ts). */
export const adminFederation = (ctx: AdminFederationCtx) => {
  const {
    onFault,
    htmlOut,
    refuse,
    postGate,
    signerGround,
    targetOf,
    mintConfirm,
    negationOf,
    pages,
  } = ctx;

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
    if (ctx.connectors === undefined) return { kind: "none" };
    try {
      return { kind: "read", file: readOAuthFile(ctx.connectors.home) };
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
  // A pair that is ANOTHER person's (§58: a key bound into this reach through the library door)
  // joins as nothing but the fact — no client, no generation, no count — the same withholding
  // the revoke pages keep.
  type ConnectorJoin =
    | {
        readonly kind: "own";
        readonly clientId: string;
        readonly clientName?: string;
        readonly generation?: number;
        readonly liveTokens: number;
      }
    | { readonly kind: "others" };
  const joinFor = (
    records: ConnectorRecords,
    key: string,
    user: string,
  ): ConnectorJoin | undefined => {
    if (records.kind !== "read") return undefined;
    const grant = records.file.grants.find((g) => g.actor === key);
    if (grant === undefined) return undefined;
    if (grant.user !== undefined && grant.user !== user) return { kind: "others" };
    const client = clientFor(records.file, grant.clientId);
    const liveTokens =
      client === undefined
        ? 0
        : records.file.tokens.filter(
            (t) =>
              t.clientId === grant.clientId &&
              t.generation === client.generation &&
              t.user === grant.user, // the pair's tokens, not the connector's (§58)
          ).length;
    return {
      kind: "own",
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
    user: string,
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
    const join = joinFor(records, key, user);
    const via =
      join === undefined
        ? ""
        : join.kind === "others"
          ? " · bound as another person's connector"
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
    user: string,
  ): string => {
    const records = connectorRecords();
    const names = [...reach].filter((n) => table.containers.get(n)!.inboxOf !== undefined).sort();
    const listing =
      names.length === 0
        ? "<p>No connection is bound in your subtree.</p>"
        : `<ul>\n${names
            .map((n) =>
              connectionRowHtml(gw, records, n, table.containers.get(n)!, formToken, user),
            )
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

  // Land a pasted offer in one subtree container (§40 criterion 11). The page adds no authorship —
  // each delta crosses by its own signature, verified where every federated delta is verified. A
  // SEPARATE container takes the offer through its pool's own door (its own admission); a SHARED
  // one through the primary's door, and its membership then decides what the container gathers.
  // The result page tells both numbers, because both are true and they differ.
  const postFederate = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const gated = await postGate(req, res, FEDERATE_MAX_BODY);
    if (gated === undefined) return;
    const gw = ctx.ground();
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
    let client:
      { clientId: string; clientName?: string; generation?: number; user?: string } | undefined;
    let othersPair = false;
    if (ctx.connectors !== undefined) {
      let file: OAuthFile;
      try {
        file = readOAuthFile(ctx.connectors.home);
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
      // The connector half is fenced the way the pool half is: only THIS person's pair (or the
      // pre-§58 key that names no person) is retired from this page. A key bound into this
      // person's reach through the library door may be another person's connector pair; that
      // pair stands, and the page says so without naming them.
      const grant = file.grants.find((g) => g.actor === key);
      if (grant !== undefined && grant.user !== undefined && grant.user !== user) {
        othersPair = true;
      } else if (grant !== undefined) {
        const c = clientFor(file, grant.clientId);
        // Whose binding this inbox is (§58): the revoke below is that person's alone, never the
        // connector's every key.
        client = {
          clientId: grant.clientId,
          ...(c === undefined ? {} : { clientName: c.clientName, generation: c.generation }),
          ...(grant.user === undefined ? {} : { user: grant.user }),
        };
      }
    }
    // The §39 half: a standing write grant in the attached inbox pool, struck in the OWNER's
    // voice — the session user's own seed, never the operator's.
    const pool = gw.attachedContainers.get(name);
    const standing =
      pool !== undefined && holdsGrant(pool.reactor, STORE_ENTITY, key, "write", gw.operatorAuthor);
    // §58: a key may hold a sibling pool — a re-consent into another container spawns a second
    // inbox and the first stands — and a revoke is the KEY's, so every pool of this key that still
    // holds the grant is struck with the row's. Named on the confirm page before anything happens.
    // Fenced to the person's own reach, like every row this page shows: a pool of the same key
    // under someone else (reachable only through the library door) is neither named nor touched.
    const reach = subtreeOf(gw.containers(), user);
    const siblings = [...gw.connectionInboxes]
      .filter(
        ([sibling, handle]) =>
          sibling !== name &&
          sibling.endsWith(`:${key}`) &&
          reach.has(sibling) &&
          handle.gateway !== undefined &&
          gw.attachedContainers.get(sibling) === handle.gateway && // not mid-drop
          holdsGrant(handle.gateway.reactor, STORE_ENTITY, key, "write", gw.operatorAuthor),
      )
      .map(([sibling]) => sibling)
      .sort();
    // A row whose own pool is not attached here cannot have its grant struck from this row, and a
    // page that struck the siblings while saying this one "no longer writes" would be lying about
    // the one pool a person came here for. Refuse, and name where the act can be done instead.
    if (pool === undefined && siblings.length > 0) {
      return {
        act: "refuse",
        status: 409,
        message:
          "This connection's inbox pool is not attached here, so its grant cannot be struck from " +
          `this row. The same key also writes into ${siblings.join(", ")}; revoke from one of ` +
          "those rows, or re-attach this inbox and revoke again. Nothing was revoked.",
      };
    }
    let inboxLeg: { inbox: Container; ownerSeed: string } | undefined;
    let ownerSeed: string | undefined;
    if (standing || siblings.length > 0) {
      const seed = readUserSeed(ctx.home, user);
      if (seed.kind !== "present" || !/^[0-9a-f]{64}$/.test(seed.seed)) {
        return {
          act: "refuse",
          status: 409,
          message:
            "You have no signing key on this store, so a revocation cannot be authored in your " +
            "name. Ask the store's operator to provision your key. Nothing was revoked.",
        };
      }
      ownerSeed = seed.seed;
    }
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
      inboxLeg = { inbox: handle, ownerSeed: ownerSeed! };
    }
    if (inboxLeg === undefined && siblings.length === 0 && client === undefined) {
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
      siblings,
      ...(inboxLeg ?? {}),
      ...(ownerSeed === undefined ? {} : { ownerSeed }),
      ...(client === undefined ? {} : { client }),
      ...(othersPair ? { othersPair: true as const } : {}),
    };
  };

  const revokeTokens = new Map<string, { user: string; name: string }>();

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
      const outcome = await revokeConnector(
        ctx.connectors!.home,
        clientId,
        strike,
        onFault,
        // Always the pair's — including the pre-§58 pair that names no user; the whole-client
        // revoke is the CLI's explicit act, never this page's.
        { kind: "pair", user: plan.client.user },
      );
      if (outcome.kind === "no-such-client") {
        refuse(
          res,
          409,
          "This connector left the records between the confirm page and now, so nothing was " +
            "revoked. Its row will say what still stands.",
        );
        return;
      }
      if (outcome.kind === "no-such-pair") {
        refuse(
          res,
          409,
          "This connector holds no key for this inbox's person any more, so nothing was revoked. " +
            "Its row will say what still stands.",
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
    // The key's sibling pools, named on the confirm page, are struck here in the owner's voice.
    // A sibling that could not be struck is a fault the operator hears AND a refusal the person
    // sees: the row's own inbox is struck by now, and a page headed "Revoked." over a pool the key
    // still writes into would be the H7 shape. So the answer names what stands and says incomplete.
    const struckSiblings: string[] = [];
    const failedSiblings: string[] = [];
    if (plan.ownerSeed !== undefined) {
      for (const sibling of plan.siblings) {
        const handle = gw.connectionInboxes.get(sibling);
        const pool = handle?.gateway;
        if (
          handle === undefined ||
          pool === undefined ||
          gw.attachedContainers.get(sibling) !== pool
        ) {
          failedSiblings.push(sibling);
          continue;
        }
        if (!holdsGrant(pool.reactor, STORE_ENTITY, plan.key, "write", gw.operatorAuthor)) continue;
        try {
          await gw.revokeConnection({
            inbox: handle,
            connectionKey: plan.key,
            ownerSeed: plan.ownerSeed,
          });
          struckSiblings.push(sibling);
        } catch (err) {
          failedSiblings.push(sibling);
          onFault(
            `the admin revoke struck "${name}" but could not strike the same key's sibling inbox ` +
              `"${sibling}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    if (failedSiblings.length > 0) {
      refuse(
        res,
        503,
        `This inbox is struck, but the same key's ${failedSiblings.join(", ")} could not be — the ` +
          "key still writes there. This revoke is incomplete; retry it from that row.",
      );
      return;
    }
    // §58: the act is the key's, never the whole connector's — whose other keys stand.
    const clientDone =
      plan.client === undefined
        ? ""
        : plan.client.user === undefined
          ? ` The connector <code>${escapeHtml(plan.client.clientName ?? plan.client.clientId)}</code>
holds no working token for this key now — a key from before §58 — and every other key of it stands.`
          : ` The connector <code>${escapeHtml(plan.client.clientName ?? plan.client.clientId)}</code>
holds no working token for <code>${escapeHtml(plan.client.user)}</code> now — each is refused on its
next request. Other people's bindings of this connector stand.`;
    const siblingsDone =
      struckSiblings.length === 0
        ? ""
        : ` This key also wrote into ${struckSiblings
            .map((s) => `<code>${escapeHtml(s)}</code>`)
            .join(", ")}; that inbox is struck with this one.`;
    const othersDone =
      plan.othersPair === true
        ? " This key's connector binding is another person's, and it stands."
        : "";
    htmlOut(
      res,
      200,
      page(
        "revoked",
        `<h1>Revoked.</h1>
<p><code>${escapeHtml(plan.key)}</code> no longer writes into
<code>${escapeHtml(plan.bound)}</code>: its next write is refused at the door.${clientDone}${siblingsDone}${othersDone}
Everything it already wrote remains, author intact, and every other key's connection is untouched.</p>
<p><a href="${escapeHtml(pages.detailHref(name))}">Its inbox</a> keeps the record — drop it there to
forget it whole.</p>
<p><a href="${ADMIN_PATH}">Back to your containers.</a></p>`,
      ),
    );
  };

  return { connectionsPanelHtml, postFederate, postRevoke, postRevokeConfirm };
};
