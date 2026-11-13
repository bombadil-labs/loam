import { refusedIds } from "../gateway/erase-law.js";
import { type IncomingMessage, type ServerResponse } from "node:http";
import {
  evalTermRaw,
  parseTerm,
  DeltaSet,
  type Claims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { readUserSeed } from "../cli/config.js";
import { parseOffer } from "../federation/offer.js";
import { CTX_GRANTS, holdsGrant, struckAt } from "../gateway/accounts.js";
import { delegationStatesFor } from "../gateway/principal.js";
import { withBatchNegationClosure } from "../gateway/ingest.js";
import { type Container } from "../gateway/container.js";
import {
  type ContainerTable,
  type ResolvedContainer,
  grantRoots,
} from "../gateway/container-law.js";
import { Gateway, type FederationReport } from "../gateway/gateway.js";
import { STORE_ENTITY } from "../gateway/genesis.js";
import { clientFor, readOAuthFile, type OAuthFile } from "./oauth-file.js";
import { subtreeOf } from "./subtree.js";
import { revokeConnector } from "./oauth.js";
import { escapeHtml, page } from "./session.js";
import { ADMIN_PATH, ADMIN_REVOKE_PATH, adminPages, type RevokePlan } from "./admin-pages.js";
import { withStamp } from "../gateway/stamp.js";
import { negatedAt } from "../gateway/negation.js";
import { governedProgram } from "../gateway/governed-trust.js";
import { userGroundOf } from "../gateway/user-root.js";
import { lowerMembershipJson } from "../gateway/member-of.js";
import type { Ground } from "../gateway/ground.js";

const FEDERATE_MAX_BODY = 1024 * 1024;

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
    return parseTerm(
      lowerMembershipJson(
        raw,
        gw.reactor,
        gw.validityNow(),
        gw.operatorAuthor,
        refusedIds(gw.reactor, gw.operatorAuthor),
      ),
    );
  } catch {
    return undefined;
  }
}

export interface AdminFederationCtx {
  readonly connectors?: { readonly home: string };
  readonly home: string;
  readonly ground: () => Gateway | undefined;
  readonly onFault: (message: string) => void;
  readonly htmlOut: (res: ServerResponse, status: number, body: string, cookie?: string) => void;
  readonly refuse: (res: ServerResponse, status: number, message: string) => void;
  readonly postGate: (
    req: IncomingMessage,
    res: ServerResponse,
    maxBody?: number,
  ) => Promise<{ fields: Map<string, string>; user: string; formToken: string } | undefined>;
  readonly signerGround: (res: ServerResponse) => Gateway | undefined;
  readonly targetOf: (
    gw: Gateway,
    user: string,
    fields: Map<string, string>,
    res: ServerResponse,
  ) => { table: ContainerTable; name: string; rec: ResolvedContainer } | undefined;
  readonly mintConfirm: (
    store: Map<string, { user: string; name: string }>,
    user: string,
    name: string,
  ) => string;
  readonly negationOf: (targetId: string, author: string, timestamp: number) => Claims;
  readonly pages: ReturnType<typeof adminPages>;
}

export function unnegatedOperatorGrantIds(
  reactor: Ground,
  now: number,
  operator: string,
  subject: string,
): string[] {
  const struck = negatedAt(reactor, now, operator);
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
    if (!named || struck(id)) continue;
    out.push(id);
  }
  return out;
}

export type ConnectionGrantState = "active" | "revoked" | "not yet valid" | "expired" | "ungranted";

export function connectionGrantState(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  key: string,
): ConnectionGrantState {
  if (holdsGrant(reactor, now, STORE_ENTITY, key, "write", operator)) return "active";
  const seen = new Set<ConnectionGrantState>();
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
    if (subject !== key || verb !== "write") continue;
    const { validFrom, validUntil } = delta.claims;
    if (now < validFrom) seen.add("not yet valid");
    else if (validUntil !== undefined && now >= validUntil) seen.add("expired");
    else if (struckAt(reactor, now, id, operator)) seen.add("revoked");
  }
  for (const state of delegationStatesFor(
    reactor,
    now,
    grantRoots(reactor, now, operator),
    key,
    operator,
  )) {
    if (state !== "standing") seen.add(state);
  }
  for (const state of ["revoked", "not yet valid", "expired"] as const)
    if (seen.has(state)) return state;
  return "ungranted";
}

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

  const connectionKeyOf = (name: string, bound: string): string | undefined => {
    const prefix = `inbox:${bound}:`;
    return name.startsWith(prefix) && name.length > prefix.length
      ? name.slice(prefix.length)
      : undefined;
  };

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
              t.user === grant.user,
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
      pool === undefined
        ? undefined
        : connectionGrantState(pool.reactor, pool.validityNow(), pool.operatorAuthor, key);
    const stateWords =
      state === undefined
        ? "its inbox pool is not attached here, so its grant cannot be read from this page"
        : state === "active"
          ? "active — its writes land"
          : state === "revoked"
            ? "revoked — its next write refuses; everything it wrote is kept, author intact"
            : state === "expired"
              ? "expired — its write grant has ended, so its next write refuses; everything it " +
                "wrote is kept, author intact"
              : state === "not yet valid"
                ? "not yet valid — its write grant has not started, so its next write refuses"
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
        report = await pool.federate(deltas);
        door = "its own store";
      } else {
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
        const offer = DeltaSet.from(deltas);
        const program = governedProgram(
          term,
          undefined,
          offer,
          { raw: true },
          userGroundOf(gw.reactor),
        );
        const result = evalTermRaw(program.term, offer);
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
    let gathered: number | undefined;
    try {
      const ids = new Set(gw.containerScope({ containers: [name] }).map((d) => d.id));
      gathered = deltas.reduce((n, d) => (ids.has(d.id) ? n + 1 : n), 0);
    } catch {
      gathered = undefined;
    }
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
      const grant = file.grants.find((g) => g.actor === key);
      if (grant !== undefined && grant.user !== undefined && grant.user !== user) {
        othersPair = true;
      } else if (grant !== undefined) {
        const c = clientFor(file, grant.clientId);
        client = {
          clientId: grant.clientId,
          ...(c === undefined ? {} : { clientName: c.clientName, generation: c.generation }),
          ...(grant.user === undefined ? {} : { user: grant.user }),
        };
      }
    }
    const pool = gw.attachedContainers.get(name);
    const standing =
      pool !== undefined &&
      holdsGrant(pool.reactor, pool.validityNow(), STORE_ENTITY, key, "write", pool.operatorAuthor);
    const reach = subtreeOf(gw.containers(), user);
    const siblings = [...gw.connectionInboxes]
      .filter(
        ([sibling, handle]) =>
          sibling !== name &&
          sibling.endsWith(`:${key}`) &&
          reach.has(sibling) &&
          handle.gateway !== undefined &&
          gw.attachedContainers.get(sibling) === handle.gateway &&
          holdsGrant(
            handle.gateway.reactor,
            handle.gateway.validityNow(),
            STORE_ENTITY,
            key,
            "write",
            handle.gateway.operatorAuthor,
          ),
      )
      .map(([sibling]) => sibling)
      .sort();
    if (pool === undefined && siblings.length > 0) {
      return {
        act: "refuse",
        status: 409,
        message:
          "This connection's inbox pool is not attached here, so its grant cannot be negated from " +
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
            "server, so this page cannot negate its grant. Bind it again, then revoke. " +
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
    const gw = signerGround(res);
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
    revokeTokens.delete(presented);
    const plan = planRevoke(gw, gated.user, name, rec);
    if (plan.act === "refuse") {
      refuse(res, plan.status, plan.message);
      return;
    }
    if (plan.client !== undefined) {
      const clientId = plan.client.clientId;
      const strike = async (grant: { actor: string }): Promise<void> => {
        const ids = unnegatedOperatorGrantIds(
          gw.reactor,
          gw.validityNow(),
          gw.operatorAuthor!,
          grant.actor,
        );
        if (ids.length === 0) return;
        await gw.append(
          ids.map((id) =>
            gw.signer!.sign(withStamp(gw.stamp(), (t) => negationOf(id, gw.operatorAuthor!, t))),
          ),
        );
      };
      const outcome = await revokeConnector(ctx.connectors!.home, clientId, strike, onFault, {
        kind: "pair",
        user: plan.client.user,
      });
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
    if (plan.inbox !== undefined) {
      try {
        await gw.revokeConnection({
          inbox: plan.inbox,
          connectionKey: plan.key,
          ownerSeed: plan.ownerSeed!,
        });
      } catch (err) {
        onFault(
          `the admin revoke could not negate the inbox grant of "${name}": ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        refuse(
          res,
          503,
          /whose root cannot be read now/.test(err instanceof Error ? err.message : "")
            ? (plan.client !== undefined
                ? "The connector's tokens are retired, but its inbox "
                : "Its inbox ") +
                "still lets it write: the owner grant there names a user whose record cannot be " +
                "read now (it may be struck or erased), so the revoke could not find everything " +
                "to strike. If that person is gone for good, drop the inbox instead."
            : plan.client !== undefined
              ? "The connector's tokens are retired, but the write standing in its inbox could " +
                "not be struck in your voice — this revoke is incomplete. If your key changed " +
                "since the connection was made, the store's operator can finish it with " +
                "`loam grant revoke`."
              : "The revocation could not land in your voice, so nothing was revoked. If your key " +
                "changed since the connection was made, the store's operator can revoke it.",
        );
        return;
      }
    }
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
        if (
          !holdsGrant(
            pool.reactor,
            pool.validityNow(),
            STORE_ENTITY,
            plan.key,
            "write",
            pool.operatorAuthor,
          )
        )
          continue;
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
            `the admin revoke negated "${name}" but could not negate the same key's sibling inbox ` +
              `"${sibling}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    if (failedSiblings.length > 0) {
      refuse(
        res,
        503,
        `This inbox's grant is negated, but the same key's ${failedSiblings.join(", ")} could not be — the ` +
          "key still writes there. This revoke is incomplete; retry it from that row. If that " +
          "inbox's owner grant names a user whose record cannot be read now, drop that inbox " +
          "instead.",
      );
      return;
    }
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
            .join(", ")}; that inbox's grant is negated with this one.`;
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
