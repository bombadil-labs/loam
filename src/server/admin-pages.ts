// T153 slice 3a — the admin door's PAGE RENDERERS, moved out of the 2217-line makeAdminDoor
// closure verbatim. The seam: these functions build the admin HTML; the three things they cannot
// do from their arguments are injected through AdminPagesOpts:
//
//   - home: the user-seed file path (membershipSuggestion reads it for the declare form hint);
//   - onFault: the door's fault reporter (detailPage reports page-read failures through it);
//   - connectionsPanel: the connectors panel renderer, which stays in admin.ts because it reads
//     the connector store through the closure (the federation seam is slice 3b).
//
// The ADMIN_* routes and the RevokePlan type live here too, beside their only consumers. Nothing
// in this module imports admin.ts, so there is no cycle: the door imports the pages.

import { escapeHtml, page } from "./session.js";
import { readUserSeed } from "../cli/config.js";
import { authorForSeed, type Delta } from "@bombadil/rhizomatic";
import { lensOf, readRegistrations } from "../gateway/registration.js";
import type { Container, ContainerTable, ResolvedContainer } from "../gateway/container.js";
import type { ChannelStatus } from "../federation/channel.js";
import type { ContestedNameReport } from "../gateway/lifecycle.js";
import type { Gateway } from "../gateway/gateway.js";
import type { ContainerAttention } from "../gateway/attention.js";

/** What the door computed for the attention panel: the summary plus the quiet set. */
export interface AttentionView {
  readonly summary: ReadonlyMap<string, ContainerAttention>;
  readonly quiet: ReadonlySet<string>;
}

export const ADMIN_PATH = "/admin";
export const ADMIN_CREATE_ROOT_PATH = "/admin/create-root";
export const ADMIN_CONTAINER_PATH = "/admin/container";
export const ADMIN_DECLARE_PATH = "/admin/declare";
export const ADMIN_DETACH_PATH = "/admin/detach";
export const ADMIN_REATTACH_PATH = "/admin/reattach";
export const ADMIN_DROP_PATH = "/admin/drop";
export const ADMIN_DROP_CONFIRM_PATH = "/admin/drop-confirm";
export const ADMIN_REGISTER_PATH = "/admin/register";
export const ADMIN_VIEW_PATH = "/admin/view";
export const ADMIN_PROMOTE_PATH = "/admin/promote";
export const ADMIN_FEDERATE_PATH = "/admin/federate";
export const ADMIN_REVOKE_PATH = "/admin/revoke";
export const ADMIN_REVOKE_CONFIRM_PATH = "/admin/revoke-confirm";
export const ADMIN_LOOKED_PATH = "/admin/looked";
export const ADMIN_QUIET_PATH = "/admin/quiet";

export type RevokePlan =
  | {
      readonly act: "revoke";
      readonly key: string;
      readonly bound: string;
      readonly inbox?: Container;
      readonly ownerSeed?: string;
      readonly client?: {
        readonly clientId: string;
        readonly clientName?: string;
        readonly generation?: number;
      };
    }
  | { readonly act: "refuse"; readonly status: number; readonly message: string };

const authoredBy = (publicKey: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: publicKey } },
  in: "input",
});

export interface AdminPagesOpts {
  home: string;
  onFault: (message: string) => void;
  connectionsPanel: (
    gw: Gateway,
    table: ContainerTable,
    reach: ReadonlySet<string>,
    formToken: string,
  ) => string;
}

/** All of the admin door's page renderers, in one closure (moved verbatim from admin.ts). */
export const adminPages = (opts: AdminPagesOpts) => {
  const detailHref = (name: string): string =>
    `${ADMIN_CONTAINER_PATH}?name=${encodeURIComponent(name)}`;

  // The view page's address: a container, optionally a lens, optionally an entity. The page asks
  // for whichever part is missing.
  const viewHref = (container: string, entity?: string, lens?: string): string =>
    `${ADMIN_VIEW_PATH}?container=${encodeURIComponent(container)}` +
    (lens === undefined ? "" : `&lens=${encodeURIComponent(lens)}`) +
    (entity === undefined ? "" : `&entity=${encodeURIComponent(entity)}`);

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
    const seed = readUserSeed(opts.home, user);
    if (seed.kind !== "present" || !/^[0-9a-f]{64}$/.test(seed.seed)) return "";
    return JSON.stringify(authoredBy(authorForSeed(seed.seed)));
  };

  // T146: every admin page carries the way out. The logout door checks the SESSION's own form
  // token under the phase-6 preamble, and these pages hold exactly that token — so the form here
  // is the same one the signed-in page offers, not a second mechanism.
  const signOutFormHtml = (formToken: string): string => `<form method="post" action="/logout">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<button type="submit">sign out</button>
</form>`;

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
<p><label>name <input name="name" value="${escapeHtml(user)}:"></label></p>
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

  // The schema panel (§40 phase A3): the registered lenses, read live under the store's law, and
  // the register form. Registration is deliberately STORE-WIDE — a lens is how this store reads,
  // for every reader — so the panel is the same for every user and takes no subtree gate.
  const schemaPanelHtml = (gw: Gateway, formToken: string): string => {
    const regs = readRegistrations(gw.reactor, gw.operatorAuthor);
    const listing =
      regs.length === 0
        ? "<p>No lens is registered on this store yet.</p>"
        : `<ul>\n${regs
            .map(
              (r) =>
                `<li><code>${escapeHtml(lensOf(r))}</code> — roots: ` +
                (r.roots.length === 0
                  ? "none"
                  : r.roots.map((root) => `<code>${escapeHtml(root)}</code>`).join(", ")) +
                `</li>`,
            )
            .join("\n")}\n</ul>`;
    return `<h2>Schemas.</h2>
<p>A registered lens is how this store reads: a hyperschema that gathers, a schema that resolves.
Registration is store law — every reader here reads through the same lenses. The body below is the
same JSON <code>loam register</code> takes.</p>
${listing}
<form method="post" action="${ADMIN_REGISTER_PATH}">
<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">
<p><label>registration <textarea name="registration" rows="12" cols="72"></textarea></label></p>
<button type="submit">register</button>
</form>`;
  };

  // A moment, in words a person can read — and NEVER `Invalid Date`. A binding delta carries its
  // stamp as a number, so this guard is unreachable through the publish path; `toISOString` throws
  // on a non-finite value, and one such row would take the whole dashboard down with it.
  const momentOf = (ms: number): string =>
    Number.isFinite(ms) ? new Date(ms).toISOString() : "an unreadable time";

  // The registrations this store is WITHHOLDING (§47.1). Under a declared `conflicts` policy a
  // contested name is refused rather than decided, and without this block a person meets a lens
  // that is simply not there — the 404-shaped hole §47.1 promises not to dig. The reading is the
  // gateway's, over every ground it serves law from; this panel renders it and derives nothing of
  // its own.
  //
  // The REFUSAL is store-wide, like the schema panel above and for the same reason: a lens is how
  // this store reads, for every reader, so a withheld name is not one subtree's business. The block
  // is absent when nothing is contested — a panel that is always there says nothing.
  //
  // A ROW'S ORIGIN IS A CONTAINER NAME, and container names on this page are reader-scoped: the
  // channels panel above renders only what `reach` holds, deliberately. So a pool outside the
  // reader's subtree is named by its kind rather than by its name — and the prose says what that
  // costs, because a row with no ground named cannot carry the panel's own closing instruction.
  // The refusal itself loses nothing: the lens, every contender, its signer and its binding stay.
  //
  // The prose never says the declaration is the ROOT's: a pool reads its own binding policy, so a
  // contest can be governed a ground down from anything the operator declared here.
  //
  // A SERVED NAME IS STILL LISTED. Its serving row is marked, or the heading names what answers
  // from outside the contest; either way every withheld contender stays visible.
  //
  // Delta ids are TEXT. No delta-addressed view exists to link to, and the members list already
  // renders ids this way; a link to nothing would be worse than a name a person can paste.
  const contestedPanelHtml = (gw: Gateway, reach: ReadonlySet<string>): string => {
    const originHtml = (origin: string): string =>
      origin === "root" || reach.has(origin)
        ? `<code>${escapeHtml(origin)}</code>`
        : "a channel pool your subtree does not reach";
    const names = [...gw.contestedNames()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (names.length === 0) return "";
    const headOf = (lens: string, report: ContestedNameReport): string => {
      const rows = report.contenders;
      const served = rows.find((r) => r.served);
      const answer =
        served !== undefined
          ? `, and ${originHtml(served.origin)} serves it — the marked row below`
          : report.servedByOther !== undefined
            ? `, and ${originHtml(report.servedByOther.origin)} serves it from ` +
              `<code>${escapeHtml(report.servedByOther.entity)}</code>, which is not among them`
            : `, and none of them serves`;
      return (
        `<strong>${escapeHtml(lens)}</strong> — ${rows.length} registration` +
        `${rows.length === 1 ? "" : "s"} want this name${answer}.`
      );
    };
    const listing = names
      .map(
        ([lens, report]) =>
          `<li>${headOf(lens, report)}\n` +
          `<ul>\n${report.contenders
            .map(
              (r) =>
                `<li><code>${escapeHtml(r.entity)}</code>, from ` +
                `${originHtml(r.origin)}, signed by ` +
                `<code>${escapeHtml(r.author)}</code> at ` +
                `${escapeHtml(momentOf(r.timestamp))} — binding ` +
                `<code>${escapeHtml(r.deltaId)}</code>; ` +
                (r.served ? `<strong>this one serves the name</strong>` : `withheld`) +
                `</li>`,
            )
            .join("\n")}\n</ul></li>`,
      )
      .join("\n");
    return `<section class="contested">
<h2>Contested names.</h2>
<p>A <code>conflicts</code> binding policy is in force over each name below, so two or more
registrations want it and the policy withholds every contender it can. Each contender names its
definition, the ground it was bound in (<code>root</code>, or a channel's pool), the key that signed
the binding, and the moment. A pool declares its own policy, so act in the ground the row names:
withdraw one of its bindings, or declare there a policy that picks. A row that names no ground sits
in a channel pool your subtree does not reach, and two such pools read alike here.</p>
<ul>
${listing}
</ul>
</section>`;
  };

  // The row's opening half: which peer, under which local name, feeding which container.
  const channelHeadHtml = (c: ChannelStatus): string =>
    `<a href="${escapeHtml(detailHref(c.name))}"><code>${escapeHtml(c.name)}</code></a> — ` +
    `the peer you call <code>${escapeHtml(c.prefix)}</code>, into ` +
    `<a href="${escapeHtml(detailHref(c.into))}"><code>${escapeHtml(c.into)}</code></a>. `;

  // One channel's health, from the record deltas §46.4 already writes — and ONLY where this store
  // can still stand behind the reading. Three shapes, because three different things are true:
  //
  //   - UNREADABLE: the record does not carry the fields `c.unreadable` names in the shape a
  //     channel record is written in. The verdict is the READER's, not this page's: coercion
  //     defaults toward health, so an absent `lastSyncedAt` arrives here as a perfectly finite 0
  //     and a page sniffing the numbers itself would draw "never synced" over it. Rendering the
  //     coerced values would also put `Invalid Date` in front of a person, and `toISOString` throws
  //     on a NaN — one bad record used to take the whole page down with it.
  //   - NOT RESUMED: the record stands but this store rebuilt no channel for it at boot (no
  //     address, or no credential — gateway.ts's resumeChannels). Nothing polls it, so its failure
  //     count CANNOT move: reporting "0 failures" would be a health claim about a peer this store
  //     stopped calling, which is exactly the H9 shape these fields exist to defeat.
  //   - LIVE: the toggles, the last sync, and the count, all of them currently meaningful.
  //
  // `lastSyncedAt === 0` is NEVER SYNCED in every shape that shows it, and renders as words: a zero
  // drawn as a time reads as "synced a while ago". Same convention as `loam_federate_status`.
  const channelRowHtml = (c: ChannelStatus, resumed: boolean): string => {
    const head = channelHeadHtml(c);
    if (c.unreadable.length > 0) {
      // WITHOUT THE HEAD. `channelHeadHtml` draws the prefix and the receiving container from the
      // record's own coerced primitives, and those are exactly what may be condemned here — an
      // absent `into` renders as a link to no container at all. The channel's NAME comes from the
      // marker's entity id rather than a primitive, so it is the one identity that is always
      // legible, and it is the one a person needs to act on the row.
      return (
        `<li><a href="${escapeHtml(detailHref(c.name))}"><code>${escapeHtml(c.name)}</code></a> — ` +
        `<strong>unreadable — this channel's record does not carry ` +
        `${escapeHtml(c.unreadable.join(", "))} in the shape a channel record is written in, so ` +
        `this page will not guess at its health</strong></li>`
      );
    }
    const when =
      c.lastSyncedAt === 0
        ? "never synced"
        : `last recorded sync ${new Date(c.lastSyncedAt).toISOString()}`;
    if (!resumed) {
      return (
        `<li>${head}<strong>not resumed — this store is not polling this peer</strong> · ` +
        `${when}</li>`
      );
    }
    const fails =
      `${c.consecutiveFailures} consecutive failure` + (c.consecutiveFailures === 1 ? "" : "s");
    return (
      `<li>${head}${c.receiving ? "receiving" : "not receiving"} · ` +
      `${c.blessing ? "blessing" : "not blessing"} · ${when} · ` +
      // The marker is structural rather than a colour, so it survives a stylesheet-less read.
      (c.consecutiveFailures === 0 ? fails : `<strong>${fails}</strong>`) +
      `</li>`
    );
  };

  // The channels panel, in one shape wherever it appears: the dashboard, a container's own page,
  // and the drop-confirm page. `keep` is the caller's SCOPE — every caller has already proven its
  // containers are in the session user's subtree, and this panel widens nothing. A page about one
  // container renders nothing when no channel touches it; the dashboard passes `empty` because
  // there "no channels" is an answer a person asked for. `note` is what the PAGE knows and the
  // panel does not — on a confirm page, what the act about to happen will and will not do.
  const channelsPanelHtml = (
    gw: Gateway,
    keep: (c: ChannelStatus) => boolean,
    opts: { empty?: string; note?: string } = {},
  ): string => {
    const rows = gw
      .channelStatus()
      .filter(keep)
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    if (rows.length === 0 && opts.empty === undefined) return "";
    const listing =
      rows.length === 0
        ? `<p>${opts.empty}</p>`
        : `<ul>\n${rows
            .map((c) => channelRowHtml(c, gw.federationChannels.has(c.name)))
            .join("\n")}\n</ul>` + (opts.note === undefined ? "" : `\n<p>${opts.note}</p>`);
    return `<h2>Channels.</h2>
<p>A channel is a peer this store reads from. Its deltas land in a pool of its own, and the law it
carries binds under the name you gave the peer. Read the last two together: a peer with no failures
and an old reading is quiet, and a peer with failures is one this store could not reach. A channel
marked <strong>not resumed</strong> is neither: this store rebuilt no channel for it at its last
restart, so nothing polls that peer and its failure count can never move.</p>
${listing}`;
  };

  /** The channels a page about `name` is answerable for: its own, and the ones receiving into it. */
  const channelsTouching = (gw: Gateway, name: string): string =>
    channelsPanelHtml(gw, (c) => c.name === name || c.into === name);

  // The ORPHANED channels: those whose `into` container no longer resolves in the table (T218).
  // Striking a receiving container leaves its pools' `inboxOf` edges dangling, so no subtree reaches
  // them and no reach-scoped panel shows them — yet `channelStatus` still lists them receiving, and a
  // resumed sync keeps writing peer bytes to disk. This block is the ONLY place they are visible, and
  // it is rendered ONLY for an operator: the orphans are outside every subtree by construction, so a
  // non-operator's page has nothing to say about them, and a store-wide read is the operator's remit.
  // The health reading is the same channel-row renderer every other panel uses; the trailer names the
  // two verbs that release the pool. Absent when nothing is orphaned — a panel always there says
  // nothing.
  const orphanedChannelsPanelHtml = (gw: Gateway, table: ContainerTable): string => {
    const orphans = gw
      .channelStatus()
      .filter((c) => !table.containers.has(c.into))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    if (orphans.length === 0) return "";
    const listing = orphans
      .map((c) => {
        const release =
          ` · release it: <code>loam federate drop --channel ${escapeHtml(c.name)} --yes</code>, ` +
          `or freeze the pull with <code>loam federate set --channel ${escapeHtml(c.name)} ` +
          `--receiving false</code>`;
        // The row is a complete `<li>…</li>`; the release verbs ride inside it, before its close.
        return channelRowHtml(c, gw.federationChannels.has(c.name)).replace(
          /<\/li>$/,
          `${release}</li>`,
        );
      })
      .join("\n");
    return `<h2>Orphaned channels.</h2>
<p>Each channel below feeds a container that no longer exists. The container was struck, so its pool
sits outside every subtree and no other panel shows it — yet the channel still receives, and a
resumed sync still writes the peer's bytes to disk. Release each one: drop it to forget its pool
whole, or set it to stop receiving.</p>
<ul>
${listing}
</ul>`;
  };

  // §49 position 3: the dashboard LEADS with what changed — the summary before the tree,
  // quiet containers collapsed to one line, trust and erasure loud. Counts only; each name's
  // own page holds the claims. The panel always renders: a quiet week saying so in three lines
  // is the calm this surface exists to make legible.
  const attentionPanelHtml = (
    attention: AttentionView,
    reach: ReadonlySet<string>,
    formToken: string,
    isOperator: boolean,
  ): string => {
    const rows: string[] = [];
    for (const name of [...reach].sort()) {
      if (attention.quiet.has(name)) {
        const wake = isOperator
          ? `\n<form method="post" action="${ADMIN_QUIET_PATH}">
${hiddenPair(formToken, name)}
<input type="hidden" name="value" value="false">
<button type="submit">unquiet</button>
</form>`
          : "";
        rows.push(
          `<li data-quiet="${escapeHtml(name)}"><code>${escapeHtml(name)}</code> — quiet${wake}</li>`,
        );
        continue;
      }
      const a = attention.summary.get(name);
      if (a === undefined) continue;
      if (a.unreadable !== undefined) {
        rows.push(
          `<li data-attention-unreadable="${escapeHtml(name)}"><code>${escapeHtml(name)}</code> — ` +
            `cannot be read from here: ${escapeHtml(a.unreadable)}</li>`,
        );
        continue;
      }
      const authors = a.byAuthor.size;
      const loud =
        a.byClass.trust > 0 || a.byClass.erasure > 0
          ? ` <strong class="attention-loud">trust ${a.byClass.trust} · erasure ${a.byClass.erasure}</strong>`
          : "";
      const still = isOperator
        ? `\n<form method="post" action="${ADMIN_QUIET_PATH}">
${hiddenPair(formToken, name)}
<input type="hidden" name="value" value="true">
<button type="submit">quiet</button>
</form>`
        : "";
      rows.push(
        `<li data-attention-container="${escapeHtml(name)}" data-attention-total="${a.total}">` +
          `<code>${escapeHtml(name)}</code> — ${a.total} new by ${authors} author${authors === 1 ? "" : "s"}: ` +
          `data ${a.byClass.data} · law ${a.byClass.law}${loud}` +
          `${actForm(ADMIN_LOOKED_PATH, formToken, name, "mark read")}${still}</li>`,
      );
    }
    return `<h2>What changed.</h2>
<p>Since you last looked, per container — counted, never listed. Each name's own page holds the
claims themselves.</p>
<ul>
${rows.join("\n")}
</ul>`;
  };

  const dashboardPage = (
    gw: Gateway,
    user: string,
    table: ContainerTable,
    reach: ReadonlySet<string>,
    formToken: string,
    isOperator: boolean,
    attention: AttentionView,
  ): string =>
    page(
      "your containers",
      `${attentionPanelHtml(attention, reach, formToken, isOperator)}
<h1>Your containers.</h1>
<p>You are <code>${escapeHtml(user)}</code>. Below is your subtree: the container that bears your
name, and everything declared inside it. Each name opens its own page.</p>
${treeHtml(table, reach, user)}
${opts.connectionsPanel(gw, table, reach, formToken)}
${channelsPanelHtml(gw, (c) => reach.has(c.name), {
  // Scoped, not absolute: this store may be receiving on a dozen channels, and the true statement
  // is only that none of them lands anywhere THIS reader can see.
  empty: "No channel receives into a container your subtree reaches.",
})}
${isOperator ? orphanedChannelsPanelHtml(gw, table) : ""}
${declareFormHtml(user, reach, formToken)}
${contestedPanelHtml(gw, reach)}
${schemaPanelHtml(gw, formToken)}
${signOutFormHtml(formToken)}`,
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
</form>
${signOutFormHtml(formToken)}`,
    );

  // A hidden pair every lifecycle form carries: the session's token and the target's name. The
  // form is an OFFER, never the gate — every POST re-derives the subtree and the state before it acts.
  const hiddenPair = (formToken: string, name: string): string =>
    `<input type="hidden" name="form_token" value="${escapeHtml(formToken)}">\n` +
    `<input type="hidden" name="name" value="${escapeHtml(name)}">`;

  // One member, rendered: the id, the author, the moment, and each pointer's role (with its
  // context where the pointer names an entity). Each entity target links into the view page, so
  // the members list is the entity picker — a reader walks from a raw pointer to a resolved read.
  // A member held ONLY in a container's own attached store — not in the primary — offers its
  // promote form: there is something to move, so the form is truthful (§40 criterion 10). One the
  // primary already holds offers none; promotion would have nothing to move.
  const memberHtml = (gw: Gateway, container: string, delta: Delta, formToken: string): string => {
    const claims = delta.claims;
    const roles = claims.pointers
      .map((p) =>
        p.target.kind === "entity"
          ? `${escapeHtml(p.role)} @ ${escapeHtml(p.target.entity.context ?? "")} → ` +
            `<a href="${escapeHtml(viewHref(container, p.target.entity.id))}">` +
            `<code>${escapeHtml(p.target.entity.id)}</code></a>`
          : escapeHtml(p.role),
      )
      .join(" · ");
    const promoteForm =
      gw.reactor.get(delta.id) === undefined
        ? `\n<form method="post" action="${ADMIN_PROMOTE_PATH}">
${hiddenPair(formToken, container)}
<input type="hidden" name="delta" value="${escapeHtml(delta.id)}">
<button type="submit">promote — into the primary ground</button>
</form>`
        : "";
    return (
      `<li><code>${escapeHtml(delta.id)}</code><br>` +
      `by <code>${escapeHtml(claims.author)}</code> at ` +
      `${escapeHtml(new Date(claims.timestamp).toISOString())}<br>` +
      `${roles}${promoteForm}</li>`
    );
  };

  // The federate-in form (§40 criterion 11): a pasted offer — the JSON body of a peer's
  // `GET /federate`, or a store's export. Paste-only: the network leg of a pull stays with
  // `loam pull`; this door never fetches a caller-named URL from inside the store's own host.
  const federateFormHtml = (name: string, rec: ResolvedContainer, formToken: string): string => {
    const door =
      rec.posture === "separate"
        ? `They land through this container's own store's door, under its own admission.`
        : `They land through the primary's door; this container's membership then decides what
it gathers — landing and gathering are two different questions.`;
    return `<h2>Federate in.</h2>
<p>Paste an offer — the JSON body of a peer's <code>GET /federate</code>, or a store's export.
Each delta crosses by its own signature; this page adds no authorship. ${door}</p>
<form method="post" action="${ADMIN_FEDERATE_PATH}">
${hiddenPair(formToken, name)}
<p><label>offer <textarea name="offer" rows="8" cols="72"></textarea></label></p>
<button type="submit">federate in</button>
</form>`;
  };

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
      // Above every branch's lifecycle forms, drop included: this page is where a channel is
      // severed, so it is where a person must be able to see what they are severing.
      `</p>\n${channelsTouching(gw, name)}`;
    const back = `<p><a href="${ADMIN_PATH}">Back to your containers.</a></p>`;
    const forms = lifecycleForms(table, name, rec, formToken);

    if (table.detached.has(name)) {
      return page(
        name,
        `${head}
<p>This container is detached: kept, deliberately, and out of the gather. Its bytes are held, and
no read composes them until it is reattached.</p>
${forms}
${back}
${signOutFormHtml(formToken)}`,
      );
    }

    let members: readonly Delta[];
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
${back}
${signOutFormHtml(formToken)}`,
        );
      }
      opts.onFault(`the admin page could not read container "${name}": ${detail}`);
      return page(
        name,
        `${head}
<p>This container's contents cannot be read right now. The store says no rather than why.</p>
${forms}
${back}
${signOutFormHtml(formToken)}`,
      );
    }
    const listing =
      members.length === 0
        ? "<p>Nothing has gathered here yet.</p>"
        : `<p>${members.length} member${members.length === 1 ? "" : "s"}.</p>
<ul>
${members.map((m) => memberHtml(gw, name, m, formToken)).join("\n")}
</ul>`;
    return page(
      name,
      `${head}\n${listing}\n${federateFormHtml(name, rec, formToken)}\n${forms}\n${back}\n${signOutFormHtml(formToken)}`,
    );
  };

  const viewFieldsHtml = (view: Record<string, unknown>): string => {
    const entries = Object.entries(view);
    if (entries.length === 0) return "<p>The view resolved, and every field of it is absent.</p>";
    return `<dl>\n${entries
      .map(
        ([k, v]) =>
          `<dt><code>${escapeHtml(k)}</code></dt>` +
          `<dd><code>${escapeHtml(JSON.stringify(v) ?? "")}</code></dd>`,
      )
      .join("\n")}\n</dl>`;
  };

  const confirmPage = (
    gw: Gateway,
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
${channelsPanelHtml(
  gw,
  // The channels receiving INTO this container — which is to say, the ones this drop does NOT
  // touch. A pool is its own separate store and its sync is its own standing instruction; striking
  // the declaration above them ends neither. A health list over a confirm button, with no such
  // sentence, reads as the list of things about to be severed.
  (c) => c.into === name,
  {
    note:
      "This drop does not sever these channels. Each keeps its own pool, and each goes on " +
      "receiving — sever one from its own page.",
  },
)}
<p>This cannot be undone.</p>
<form method="post" action="${ADMIN_DROP_CONFIRM_PATH}">
${hiddenPair(formToken, name)}
<input type="hidden" name="confirm_token" value="${escapeHtml(confirmToken)}">
<button type="submit">yes — drop it</button>
</form>
<p><a href="${ADMIN_PATH}">No — keep it.</a></p>`,
    );
  };

  const revokeConfirmPage = (
    name: string,
    plan: Extract<RevokePlan, { act: "revoke" }>,
    formToken: string,
    confirmToken: string,
  ): string => {
    const clientLine =
      plan.client === undefined
        ? ""
        : `<p>It is the connector <code>${escapeHtml(plan.client.clientName ?? plan.client.clientId)}</code>` +
          (plan.client.generation === undefined ? "" : ` (generation ${plan.client.generation})`) +
          `. Revoking retires every token it holds — each is refused on its next request.</p>\n`;
    return page(
      "confirm the revoke",
      `<h1>Revoke <code>${escapeHtml(plan.key)}</code>?</h1>
<p>It writes into <code>${escapeHtml(plan.bound)}</code>. Revoking refuses its next write.</p>
${clientLine}<p>Everything it already wrote is kept, author intact — a revocation closes the door and does not
rewrite history. Every other connection is untouched. To forget its inbox whole, drop it from
<a href="${escapeHtml(detailHref(name))}">its own page</a>.</p>
<form method="post" action="${ADMIN_REVOKE_CONFIRM_PATH}">
${hiddenPair(formToken, name)}
<input type="hidden" name="confirm_token" value="${escapeHtml(confirmToken)}">
<button type="submit">yes — revoke it</button>
</form>
<p><a href="${ADMIN_PATH}">No — keep it writing.</a></p>`,
    );
  };
  return {
    detailHref,
    viewHref,
    stateOf,
    treeHtml,
    membershipSuggestion,
    declareFormHtml,
    schemaPanelHtml,
    hiddenPair,
    memberHtml,
    federateFormHtml,
    actForm,
    lifecycleForms,
    detailPage,
    viewFieldsHtml,
    dashboardPage,
    createOfferPage,
    confirmPage,
    revokeConfirmPage,
  };
};
