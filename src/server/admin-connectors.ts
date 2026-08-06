// T153 slice 3b — the admin door's CONNECTOR PANEL, moved out of makeAdminDoor verbatim (the
// federation seam of the audit's admin.ts split). This is the read side of the federation/
// connector door group: the connections panel composes the granted/revocable connector rows
// from the connector store's records. Two deps are injected through ConnectorOpts:
//
//   - connectors: the connector store file (options.connectors on the door, absent = no
//     connector surface at all — the panel says so, it does not crash);
//   - onFault: the door's fault reporter (connectorRecords reports an unreadable store through
//     it).
//
// Nothing here imports admin.ts: the door imports the panel. The federation ACTION door
// (postFederate) stays in admin.ts — it is the other half of the audit's seam.

import { escapeHtml } from "./session.js";
import { clientFor, readOAuthFile, type OAuthFile } from "./oauth-file.js";
import { ADMIN_REVOKE_PATH } from "./admin-pages.js";
import type { Gateway } from "../gateway/gateway.js";
import type { ContainerTable, ResolvedContainer } from "../gateway/container.js";
import { CTX_GRANTS, holdsGrant } from "../gateway/accounts.js";
import { STORE_ENTITY } from "../gateway/genesis.js";
import type { Reactor } from "@bombadil/rhizomatic";

export type ConnectorRecords =
  | { readonly kind: "none" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "read"; readonly file: OAuthFile };

export interface ConnectorJoin {
  readonly clientId: string;
  readonly clientName?: string;
  readonly generation?: number;
  readonly liveTokens: number;
}

export interface ConnectorOpts {
  connectors: { readonly home: string } | undefined;
  onFault: (message: string) => void;
  /** The page factory's link builder and act-form renderer, injected (render-time only). */
  detailHref: (name: string) => string;
  actForm: (action: string, formToken: string, name: string, label: string) => string;
}

/** All of the admin door's connector-panel renderers, in one closure (moved verbatim). */
export const adminConnectors = (opts: ConnectorOpts) => {
  const connectionKeyOf = (name: string, bound: string): string | undefined => {
    const prefix = `inbox:${bound}:`;
    return name.startsWith(prefix) && name.length > prefix.length
      ? name.slice(prefix.length)
      : undefined;
  };

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

  const connectorRecords = (): ConnectorRecords => {
    if (opts.connectors === undefined) return { kind: "none" };
    try {
      return { kind: "read", file: readOAuthFile(opts.connectors.home) };
    } catch (err) {
      opts.onFault(
        `the admin page could not read the connector records: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return { kind: "unreadable" };
    }
  };

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

  const shortKey = (key: string): string => (key.length <= 24 ? key : `${key.slice(0, 24)}…`);

  const connectionRowHtml = (
    gw: Gateway,
    records: ConnectorRecords,
    name: string,
    rec: ResolvedContainer,
    formToken: string,
  ): string => {
    const bound = rec.inboxOf!;
    const inboxLink = `<a href="${escapeHtml(opts.detailHref(name))}">its inbox</a> — drop lives there`;
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
      ? `\n${opts.actForm(ADMIN_REVOKE_PATH, formToken, name, "revoke…")}`
      : "";
    return (
      `<li><code title="${escapeHtml(key)}">${escapeHtml(shortKey(key))}</code> → ` +
      `<a href="${escapeHtml(opts.detailHref(bound))}"><code>${escapeHtml(bound)}</code></a> — ` +
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
  return {
    connectionKeyOf,
    grantStateOf,
    connectorRecords,
    joinFor,
    shortKey,
    connectionRowHtml,
    connectionsPanelHtml,
  };
};
