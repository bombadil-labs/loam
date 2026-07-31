// The capabilities book, as data. `page.mjs` renders it; `test/site/capabilities.test.ts` asserts
// against it. One text, two readers — the tutorial's anti-rot trick (`test/site/arc.test.ts`)
// pointed at prose instead of lessons.
//
// The contract, in three lines:
//   · chapters PARTITION `spec/` — every section belongs to exactly one, so a new landing that
//     nobody writes up turns the suite red;
//   · every claim names a TEST that fails if the claim stops being true, or states its `gap`;
//   · every `[[term]]` is glossed, and each gloss says whether the word is the code's or ours.
//
// Write for someone deciding whether Loam is for them. Say what a person can DO. The test of a
// paragraph is whether it reads aloud.

/** @type {import("./chapters.d.mts").Term[]} */
export const TERMS = [
  {
    word: "delta",
    gloss:
      "One signed claim: who said it, what it points at, and what it says. It never changes, and it depends on nothing — no order, no chain, no schema it had to match first.",
    where: {
      kind: "internal",
      at: "rhizomatic's own type; Loam addresses one with `canonicalDelta`",
    },
  },
  {
    word: "ground",
    gloss:
      "All the deltas a store holds, as one heap. Not a table and not a log — nothing in it is ordered relative to anything else, and adding to it never invalidates what was already there.",
    where: { kind: "prose" },
  },
  {
    word: "lens",
    gloss:
      "The whole reading-side assembly: a resolution program over a gather program, the composed thing that turns shared ground into a view. It is our word for the assembly, deliberately — no type carries this name, because the moment it does, one of its halves has quietly eaten the other.",
    where: { kind: "prose" },
  },
  {
    word: "HyperSchema",
    gloss:
      "The gather program: which deltas are even relevant to an object, and how they are grouped before anyone decides what they mean. Two readers who disagree about everything else can still share one of these.",
    where: {
      kind: "internal",
      at: "rhizomatic's `HyperSchema`; published at rest as `rhizomatic.hyperschema.*`",
    },
  },
  {
    word: "Schema",
    gloss:
      "The resolution program: for each property, the rule that turns a pile of claims into an answer. It is the half of a reading you change when you want a different answer from the same facts.",
    where: {
      kind: "internal",
      at: "rhizomatic's `Schema` — a map of property to Policy, plus a default",
    },
  },
  {
    word: "Policy",
    gloss:
      "One property's rule. Pick the latest, pick by who said it, keep all of them, merge them, or hand back the disagreement itself.",
    where: {
      kind: "internal",
      at: "rhizomatic's `Policy` — `pick` / `all` / `merge` / `conflicts` / `absentAs`",
    },
  },
  {
    word: "HyperView",
    gloss:
      "What a [[gather]] produces: every claim that touches an object, grouped by the property it touched, with nothing yet decided. Two applications that resolve differently can share one of these — which is why the expensive half of a read is done once.",
    where: { kind: "internal", at: "rhizomatic's `HView`" },
  },
  {
    word: "View",
    gloss:
      "The answer: one object with one value per property, resolved and hashable. This is what an application actually holds.",
    where: {
      kind: "internal",
      at: "rhizomatic's `View`; a store hands you one from `Gateway.query`",
    },
  },
  {
    word: "gather",
    gloss:
      "The step before resolution: collect the deltas that touch this object and group them by what they touched. Loam ships the idiom as a function so the same program is not retyped in seventy places.",
    where: { kind: "export", name: "entityGatherBody" },
  },
  {
    word: "strike",
    gloss:
      "To take back a claim by making another one: a delta whose subject is a delta. Nothing is edited and nothing is removed — the record simply gets more honest, and every reading recomputes.",
    where: { kind: "prose" },
  },
  {
    word: "tombstone",
    gloss:
      "The signed record that bytes were removed: who ordered it, when, and why — never what. It is append-only and it cannot itself be erased, because a store that could forget its own forgetting could not be audited.",
    where: { kind: "export", name: "isTombstone" },
  },
  {
    word: "erasure",
    gloss:
      "Actually removing the bytes, on every tier that holds them, and proving it. Distinct from a strike, which leaves the claim legible and merely uncounted.",
    where: { kind: "export", name: "eraseClaims" },
  },
  {
    word: "slate",
    gloss:
      "A named, frozen set of facts marked for removal, with the store's doors closed over them while it stands. It is what makes an impact list true: the set cannot grow after it is named, so what you were told is what gets destroyed.",
    where: { kind: "spec", section: "spec/29-slating-and-graveyards.md" },
  },
  {
    word: "graveyard",
    gloss:
      "The permanent record that one batch of forgetting happened — who asked, when, over which set — holding addresses rather than content, so it proves the event without retaining any of it.",
    where: { kind: "spec", section: "spec/29-slating-and-graveyards.md" },
  },
  {
    word: "operator",
    gloss:
      "The key that governs one store. Not an administrator account inside the system — the identity the store is defined by, whose signature is the root of every permission in it.",
    where: { kind: "export", name: "CTX_OPERATOR" },
  },
  {
    word: "standing",
    gloss:
      "Permission to write, as an artifact rather than a flag: a signed grant that chains back to the operator, auditable by an ordinary query, and revocable by one more delta.",
    where: { kind: "prose" },
  },
  {
    word: "grant",
    gloss: "One link in that chain — someone with standing conferring some of it on someone else.",
    where: { kind: "export", name: "grantClaims" },
  },
  {
    word: "registration",
    gloss:
      "The published pairing of a gather program with a resolution program under a name, which is what makes a door answer for it. Publishing one is an append; withdrawing one is a strike.",
    where: { kind: "export", name: "readRegistrations" },
  },
  {
    word: "container",
    gloss:
      "A named, addressable region of a store with its own rules about what may enter it and how far its law reaches. Tenants, sandboxes, modules and federation boundaries are all this one primitive wearing different settings.",
    where: { kind: "export", name: "containerClaims" },
  },
  {
    word: "posture",
    gloss:
      "Whether a container is its own store or a reading over ground the host already holds. It decides where the bytes live, and it cannot be changed after the fact.",
    where: { kind: "internal", at: "the `posture` field of a `loam.container` declaration" },
  },
  {
    word: "quarantine",
    gloss:
      "A container set to read your live data and keep everything it writes. You can watch a stranger's code compute against real facts and then throw the whole pool away with no trace.",
    where: { kind: "internal", at: "`Gateway.openQuarantine`, a preset over `openContainer`" },
  },
  {
    word: "promotion",
    gloss:
      "Deliberately adopting one value a quarantined program produced: you re-sign it as your own claim, citing where it came from. It is the only thing that crosses back, and it survives the pool being dropped.",
    where: { kind: "prose" },
  },
  {
    word: "module version",
    gloss:
      "A frozen set of deltas with a content address two independent stores compute identically. Shippable, verifiable, and pinned — the thing you depend on when you depend on somebody's law.",
    where: { kind: "export", name: "freezeMembers" },
  },
  {
    word: "federation",
    gloss:
      "Two stores exchanging signed facts over plain HTTP. There is no consensus step and no platform in the middle; each store keeps its own readings, so disagreement survives the trip.",
    where: { kind: "export", name: "pullFrom" },
  },
  {
    word: "roster",
    gloss:
      "The live list of authors a store admits facts from. It is data, so widening it is an append and narrowing it is a strike — and either way the next request already knows.",
    where: { kind: "export", name: "trustRosterPred" },
  },
  {
    word: "renderer",
    gloss:
      "A page pushed into the store as a signed record: a route, the fields it reads, and a bundle of real code. The store serves it immediately — no build, no deploy.",
    where: { kind: "export", name: "readRenderers" },
  },
  {
    word: "binding",
    gloss:
      "A function installed as data. Any peer that shows up later and knows how to run it will pick up the work; nothing schedules it centrally.",
    where: { kind: "export", name: "readBindingDefinitions" },
  },
  {
    word: "pen",
    gloss:
      "A separate, revocable identity a page writes under, so a form on a public route never signs with the operator's own key. Revoking it stops future writes and leaves past ones correctly attributed.",
    where: { kind: "prose" },
  },
  {
    word: "as-of",
    gloss:
      "Asking a query what an object looked like at a past moment. The answer is reconstructed from the ground rather than stored, and it says so whenever part of that past has since been lawfully forgotten.",
    where: { kind: "prose" },
  },
  {
    word: "mount",
    gloss:
      "The name a world answers at on a running server. Mounts can appear and disappear while the process stays up, and a container can never take one the operator has already claimed.",
    where: { kind: "spec", section: "spec/31-mount-table.md" },
  },
];

/** @returns {Map<string, import("./chapters.d.mts").Term>} */
export function termIndex() {
  return new Map(TERMS.map((t) => [t.word, t]));
}

/** @type {import("./chapters.d.mts").Chapter[]} */
export const CHAPTERS = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 1,
    slug: "the-ground",
    title: "The ground, and what a fact is",
    thesis:
      "Everything in Loam is a [[delta]] — one signed claim that never changes — and every guarantee in the rest of this book is a consequence of that one decision.",
    covers: ["spec/01-three-layers.md", "spec/09-constraints-invariants.md"],
    body: [
      {
        kind: "prose",
        text: "Start with the smallest true picture. Somebody says something, signs it, and that is a record. It names what it is about, it names what it says, and it carries the key that vouched for it. It is not a row that will later be updated. There is no version of it that is more current.",
      },
      { kind: "figure", figure: "claim", caption: "One [[delta]]. Hover the small dots." },
      {
        kind: "prose",
        text: "Because a claim never changes, its bytes can name it: run the bytes through a hash and you have an address that is the same everywhere, forever, computed by anyone with the same bytes and no need to ask you. Two stores that have both seen this claim agree on its name without coordinating, which is why merging two stores is a set union rather than a negotiation. Nothing has to be reconciled because nothing can conflict — two claims that disagree are simply two claims.",
      },
      {
        kind: "prose",
        text: "The whole heap of them is the [[ground]]. It grows and it never shrinks by accident. That is a strong statement, so it comes with an equally strong exception, which gets its own chapter: an [[operator]] can order bytes genuinely removed, and the removal is itself recorded.",
      },
      {
        kind: "prose",
        text: "The second decision is that no part of the system has ambient authority. There is no superuser flag, no `isAdmin` column, no code path that works because the caller happened to be local. In a store that has an [[operator]], a write is admitted when the writer's [[standing]] chains back to that operator and refused otherwise — and refused is the default, not the fallback. A store with no operator governs nothing and takes any verified claim, which is the right behavior for a scratch store and worth knowing before you assume a store is guarded.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "Facts merge as an order-blind, idempotent union: two piles combined in either order give the same set with the same digest, nothing lost and nothing overwritten. (That two whole STORES converge is the same law one level up, and chapter 9 is where it is proved of stores.)",
            spec: "spec/09-constraints-invariants.md",
            proof: "test/smoke.test.ts",
            door: "canonicalDelta",
          },
          {
            says: "An author with no granted [[standing]] is refused, and nothing they sent is persisted — permission is an artifact you can point at, never a default.",
            spec: "spec/09-constraints-invariants.md",
            proof: "test/gateway/auth.test.ts",
            door: "authorize",
          },
          {
            says: "The layers only ever talk through the store: a function installed as data computes nothing until something that knows how to run it shows up, and needs no code-level connection to whatever installed it.",
            spec: "spec/01-three-layers.md",
            proof: "test/runner/runner.test.ts",
            door: "Runner",
          },
        ],
      },
      {
        kind: "notYet",
        items: [
          "Importing an existing conventional database (rows and columns) into a Loam store is described as a future opt-in transform and does not exist. The migration machinery in the tree moves Loam's own facts between Loam's own formats, which is a different job.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 2,
    slug: "objects-nobody-creates",
    title: "Objects nobody creates",
    thesis:
      "There is no `CREATE TABLE` and no `INSERT`. An object exists because claims point at the same name, and it is the intersection of everything anyone ever said about that name.",
    covers: ["spec/04-object-model.md"],
    body: [
      {
        kind: "prose",
        text: "This is the part that reliably surprises people, so here it is plainly: nobody creates an object. An id is a string. The first claim to use one brings the object into being, and any later claim that uses the same string is talking about the same thing — including a claim by somebody who has never heard of the first one.",
      },
      {
        kind: "figure",
        figure: "meeting",
        caption:
          "Two people, two [[delta|deltas]], one id. Neither of them made `olive-oil`; they found it by using it.",
      },
      {
        kind: "prose",
        text: "Nothing in that picture is oriented. If you want an object's point of view, you pin the object and let everything else hang from it — and what you get is a tree, even though what is on disk is a mesh. Pin a different node and you get a different tree over the same facts. Every object is the root of its own.",
      },
      { kind: "figure", figure: "lifted", caption: "The same two claims, lifted from the object." },
      {
        kind: "prose",
        text: "Practically, that means a read is two steps and both are yours to choose. First [[gather]]: which claims are even relevant to this object, grouped by what they touched. Then resolve: what does each property actually say. The first step is a program called a [[HyperSchema]] and the second is a program called a [[Schema]], and the interesting consequence is that two applications can share the first and disagree completely about the second.",
      },
      {
        kind: "prose",
        text: "A read comes in two flavours. A `query` hands you a [[View]] — a frozen answer with a content address, so you can hold it, compare it, and prove later that it is the same answer. A `subscribe` hands you the answer and then keeps it current, and it is deliberately quiet: a write that does not change what you are looking at produces no event at all.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "A `query` answers with the resolved [[View]] and a hash of it; appending a fact that this reading does not care about moves neither the view nor the hash.",
            spec: "spec/04-object-model.md",
            proof: "test/gateway/read.test.ts",
            door: "Gateway",
          },
          {
            says: "A `subscribe` sends an opening snapshot and thereafter only when the resolved answer actually changes — a mutation that leaves the view identical is silence, not an empty update.",
            spec: "spec/04-object-model.md",
            proof: "test/gateway/subscribe.test.ts",
            door: "Gateway",
          },
          {
            says: "One gathered structure backs several independently published readings at once, side by side, each answering under its own name.",
            spec: "spec/04-object-model.md",
            proof: "test/gateway/read.test.ts",
            door: "Gateway",
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 3,
    slug: "reading",
    title: "Reading: the disagreement is yours to resolve",
    thesis:
      "When two people's facts contradict each other, you choose what that means — latest wins, a trusted voice wins, keep both, or show the argument — and two applications over one store may each choose differently.",
    covers: ["spec/02-foundation.md", "spec/21-schema-identity.md", "spec/22-resolvers.md"],
    body: [
      {
        kind: "prose",
        text: "Last-write-wins is not a law of nature. It is a compromise every database made on your behalf, at the moment it decided that storing two values for one field was inconvenient. Loam stores both, and asks you what to do about it at read time.",
      },
      {
        kind: "prose",
        text: "The rule for one property is a [[Policy]]. Pick the most recent claim. Pick the one from whoever you trust most, even if it is older. Keep every value. Merge them. Or hand back the disagreement itself, so the interface can show two numbers and let a human decide. That last one is worth pausing on: a conflict is a first-class value here, not an error state.",
      },
      {
        kind: "figure",
        figure: "twoReadings",
        caption:
          "One contested property, two readings, two honest answers. Nothing was resolved on disk.",
      },
      {
        kind: "figure",
        figure: "folded",
        caption:
          "And the answer, once a reading has decided: the [[HyperView]] is folded away and each property points straight at its value.",
      },
      {
        kind: "prose",
        text: "A whole reading — the [[lens]] — is a [[Schema]] over a [[HyperSchema]], and it is itself published into the store as ordinary facts. That has a pleasant consequence: readings are versioned the way everything else is. Publishing a second reading over data you already serve does not evict the first, and evolving a reading mints a new version rather than overwriting the old one, so anything pinned to last month's shape keeps answering.",
      },
      {
        kind: "prose",
        text: "Sometimes a property is not any of the claims about it — it is a count of them, or a histogram, or a name looked up from a related object. For that, a field can name a small program you supply. It runs over the gathered claims for that one property and returns the displayed value. Two guardrails come with it: the returned value must match its declared type or the door falls back to the ordinary answer, and if a fact the computed value was derived from is erased, the cached result goes with it. You cannot read back a number computed from bytes that no longer exist.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "A reading can rank authors instead of timestamps, so a trusted voice's older claim beats an untrusted voice's newer one.",
            spec: "spec/02-foundation.md",
            proof: "test/spike/resolve.test.ts",
            door: null,
            gap: "Reached by registering a [[Schema]] through the gateway; the resolution primitives themselves are rhizomatic's and are not re-exported from Loam's package surface.",
          },
          {
            says: "A reading can surface a property only when values genuinely contend, so agreement resolves to silence and disagreement resolves to the disagreement.",
            spec: "spec/02-foundation.md",
            proof: "test/spike/resolve.test.ts",
            door: null,
            gap: "Same as above — a `conflicts` [[Policy]] is configured in a published [[Schema]], not called directly.",
          },
          {
            says: "Two readings of the same facts, resolved in any arrival order and in any process, produce identical content-addressed snapshots.",
            spec: "spec/02-foundation.md",
            proof: "test/gateway/read.test.ts",
            door: "Gateway",
          },
          {
            says: "Publishing a second, differently named reading over data you already serve leaves the first one answering — readings do not evict each other.",
            spec: "spec/21-schema-identity.md",
            proof: "test/gateway/coexistence.test.ts",
            door: "Gateway",
          },
          {
            says: "Evolving a reading mints a new version and the old version keeps answering, so a client pinned to it is never broken by someone else's improvement.",
            spec: "spec/21-schema-identity.md",
            proof: "test/gateway/schema-entity.test.ts",
            door: "schemaEntityFor",
          },
          {
            says: "A field can be computed by a program you supply — a count rather than the latest value, say — without changing which claims are considered.",
            spec: "spec/22-resolvers.md",
            proof: "test/gateway/resolvers.test.ts",
            door: "parseResolvers",
          },
          {
            says: "A computed value whose underlying fact is later erased disappears with it; there is no cache that can serve a number derived from removed bytes.",
            spec: "spec/22-resolvers.md",
            proof: "test/gateway/resolvers.test.ts",
            door: "Gateway",
          },
          {
            says: "A computed value that does not match its declared type is treated exactly like a program that threw: the door serves the ordinary resolved value instead of leaking a wrong shape.",
            spec: "spec/22-resolvers.md",
            proof: "test/gateway/resolver-typing.test.ts",
            door: "Gateway",
          },
        ],
      },
      {
        kind: "notYet",
        items: [
          "Computed fields are limited to the honest case: a pure function of one property's own claims. Programs that want to see the whole gathered object, query the store, or have side effects are refused at publication with a reason rather than half-supported.",
          "A field that exists only in the reading — with no claims under it at all — is designed and refused for now, on the same rail.",
          "Freezing the [[gather]] half of a reading by content address, so a page can pin the entire program and not just the resolution rules, is drawn in pencil and waits for a renderer that needs it.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 4,
    slug: "saying-less",
    title: "Saying less",
    thesis:
      "You can take back what you said — a whole field, one value, one relationship — and the result is honest absence rather than a null, and it can never be used to silence somebody else.",
    covers: ["spec/14-write-semantics.md"],
    body: [
      {
        kind: "prose",
        text: "If nothing is ever edited, how do you change your mind? You say something else. A [[strike]] is a claim whose subject is another claim: *disregard that*. The struck claim stays exactly where it was, still signed, still legible in the record — and stops counting toward every reading, immediately.",
      },
      {
        kind: "figure",
        figure: "struck",
        caption: "Taking it back is appending, not deleting. The crossed circle is still there.",
      },
      {
        kind: "prose",
        text: "That makes writing the mirror image of reading. Reading takes many claims and produces one answer; writing takes an intended answer and produces the claims that would resolve to it. Clearing a field means striking the claims that put a value there — and here is the load-bearing detail: only *your* claims. You cannot clear away somebody else's contribution to a shared field, and the guarantee holds all the way down to a single value, not just to the field as a whole.",
      },
      {
        kind: "prose",
        text: 'The result of clearing everything is absence, and absence is a real answer rather than a `null` standing in for one. A reading decides what absence means for that property — empty, zero, hidden, or the string "unknown" — because only the application knows.',
      },
      {
        kind: "prose",
        text: "Which fields are writable at all is declared, and silence means no. A [[registration]] that lists nothing writable accepts no writes through its doors; the generated interface does not even offer the argument. Immutable by default is the safer direction to be wrong in.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "Clearing a field strikes only the caller's own claims; another author's claim to the same field is untouched and still resolves.",
            spec: "spec/14-write-semantics.md",
            proof: "test/gateway/clear.test.ts",
            door: "buildGqlSchema",
          },
          {
            says: "Removing one specific value you did not author is a no-op — take-back-your-own holds at the level of a single value, not just a whole field.",
            spec: "spec/14-write-semantics.md",
            proof: "test/gateway/clear.test.ts",
            door: "buildGqlSchema",
          },
          {
            says: "A [[registration]] with no declared writable fields accepts no write through any door, and the refusal names the field rather than failing vaguely.",
            spec: "spec/14-write-semantics.md",
            proof: "test/gateway/immutable-default.test.ts",
            door: "parseRegistrationInput",
          },
          {
            says: "Relationships are written and taken back the same way as values, and a property that holds a plain value offers no relationship write at all — the interface simply does not have one.",
            spec: "spec/14-write-semantics.md",
            proof: "test/gateway/link.test.ts",
            door: "buildGqlSchema",
          },
        ],
      },
      {
        kind: "notYet",
        items: [
          "A field that is read-only *because it is computed* — refused a write by construction rather than by declaration — arrives with the computed-field work and is not built.",
          'A stored `null` that means "explicitly nothing" as distinct from "nobody said" would need a change in the substrate underneath Loam, which is frozen. Absence is the only honest answer today, and a reading can name what it means.',
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 5,
    slug: "one-surface",
    title: "One surface, many doors",
    thesis:
      "Publish a reading and you get a GraphQL API, a documented REST API, and a live subscription feed — generated from the same facts, and guaranteed to never disagree with each other.",
    covers: ["spec/03-scope.md", "spec/05-gateway.md", "spec/17-surfaces.md"],
    body: [
      {
        kind: "prose",
        text: "A store's only surface is a gateway, and the gateway is generated. You publish a [[registration]] — a [[HyperSchema]] and a [[Schema]] under a name — and the query language, the mutations, the subscription channel, and an OpenAPI document all follow from it. Nothing is hand-wired per type, which is why two doors cannot drift apart.",
      },
      {
        kind: "prose",
        text: "That is a promise worth testing rather than asserting, so it is tested at the strongest available level: the same reading fetched over REST and over GraphQL answers with the same content address, and every refusal one door makes — no standing, no token, forgotten, malformed — the other makes too.",
      },
      { kind: "heading", text: "Writing through a shape somebody else declared" },
      {
        kind: "prose",
        text: "A [[registration]] can also declare a claim template: a named shape for a write, so a single call emits one signed [[delta]] that touches several objects at once, in exactly the declared form. That is how an application hands out a write without handing out the freedom to write anything.",
      },
      {
        kind: "prose",
        text: "And if you would rather the server never hold your key, it does not have to. You can sign a claim yourself and hand over the finished bytes; it lands under your name regardless of which token carried it. The token authenticates the connection. It never authors anything.",
      },
      { kind: "heading", text: "Changing your mind in public" },
      {
        kind: "prose",
        text: "A published reading evolves by republishing at the same name, and the running store rebinds without a restart. Old versions do not vanish: they keep answering at their own address, so somebody's client from last quarter is not collateral damage. Withdrawing a version is a [[strike]] on its [[registration]] — the door stops serving it and the record remembers it existed, which is the difference between retiring an API and pretending it never shipped.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "The whole read interface — query, mutate, subscribe, schema introspection — is derived from a published reading rather than written per type.",
            spec: "spec/03-scope.md",
            proof: "test/gateway/read.test.ts",
            door: "buildGqlSchema",
          },
          {
            says: "Where the bytes live is a choice: the same store contract is honored in memory, in SQLite, in a browser's local storage, in an archive and in a mirror, and a store closed and reopened has lost nothing.",
            spec: "spec/03-scope.md",
            proof: "test/store/contract.test.ts",
            door: "SqliteBackend",
          },
          {
            says: "The store is servable over HTTP with token auth and over MCP as tools, from one gateway — an assistant and an application read the same governed truth.",
            spec: "spec/03-scope.md",
            proof: "test/server/http.test.ts",
            door: "serve",
          },
          {
            says: "A declared claim template turns one call into one signed [[delta]] of exactly the declared shape, touching several objects at once, signed by whoever made the call.",
            spec: "spec/05-gateway.md",
            proof: "test/gateway/claims.test.ts",
            door: "parseClaimTemplates",
          },
          {
            says: "A caller can append a claim they signed themselves, and it lands under their own authorship whatever token delivered it.",
            spec: "spec/05-gateway.md",
            proof: "test/server/http.test.ts",
            door: "Gateway",
          },
          {
            says: "Republishing a reading at the same name reshapes the running store with no restart.",
            spec: "spec/05-gateway.md",
            proof: "test/gateway/genesis.test.ts",
            door: "readRegistrations",
          },
          {
            says: "REST and GraphQL answer the same reading with the same content address, refusal for refusal.",
            spec: "spec/17-surfaces.md",
            proof: "test/surface/rest.test.ts",
            door: "graphqlSurface",
          },
          {
            says: 'Withdrawing a version answers "gone" rather than "never existed", and the earlier version stays answerable at its own path until it is withdrawn too.',
            spec: "spec/17-surfaces.md",
            proof: "test/surface/rest.test.ts",
            door: "serve",
          },
          {
            says: "A stranger probing for readings learns nothing: held, withdrawn and imaginary addresses all answer alike, so the door is not an existence oracle.",
            spec: "spec/17-surfaces.md",
            proof: "test/surface/rest.test.ts",
            door: "readPublicSchemas",
          },
        ],
      },
      {
        kind: "notYet",
        items: [
          "Generating a typed client from a published reading is designed and not queued. You write your own client today.",
          "Only the REST door is versioned by path; asking GraphQL for a specific past generation is additive and queued, not silently present.",
          "A hosted, replicated storage driver is a one-file addition when a deployment needs one, and is not vendored here.",
          "When two published definitions collide on a name, the winner is decided by a fixed rule rather than by a [[Policy]] you can configure — the one place in the system where resolution is not yours to choose. It has a ticket and no design yet (T89).",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 6,
    slug: "standing",
    title: "Standing, and the door with none",
    thesis:
      "Permission is a signed, auditable, revocable artifact rather than a flag — and separately, you can open a door that needs no permission at all, revocable with one claim.",
    covers: ["spec/07-capabilities-accounts.md", "spec/12-open-door.md"],
    body: [
      {
        kind: "prose",
        text: "Every write in a Loam store traces back to the [[operator]]. Not through a role table — through a chain of [[grant|grants]], each one a signed claim saying *this key may do this here*. You can query the chain. You can show a user exactly who let them in.",
      },
      {
        kind: "prose",
        text: "Revoking is a [[strike]] on a [[grant]], and it is transitive: revoke an administrator and every [[grant]] they minted falls with them, on the next check, with nothing to invalidate and no cache to wait for.",
      },
      {
        kind: "figure",
        figure: "standing",
        caption: "One struck [[grant]], and everything standing on it goes quiet.",
      },
      {
        kind: "prose",
        text: "There is a subtler thing available here, and it is the reason [[standing]] and reading are in the same chapter — but it is opt-in, and the default is the other way, so read this paragraph carefully. A store admits facts from strangers all the time; that is what [[federation]] is. An ordinary reading counts *every* [[strike]] it can see, which means a stranger can veto a value you rely on simply by contradicting it. A reading registered as GOVERNED counts strikes only from voices holding [[standing]], and then the trusted set is a live view rather than a list copied at startup: revoke a contributor and their strikes stop shaping what you see on the next read. If you want the heckler ignored, you have to say so.",
      },
      { kind: "heading", text: "The door with no permission at all" },
      {
        kind: "prose",
        text: "Publishing to the world is a signed declaration naming exactly which readings are public. A stranger with no account and no token can then query them and subscribe to them, straight from a browser. Two properties make this safe rather than merely convenient: the anonymous interface has no mutation type at all — a tokenless write is structurally impossible, not policed — and revocation is one [[strike]] that the very next request already honors.",
      },
      {
        kind: "prose",
        text: "The same page can also write without the server ever holding a key. The browser mints its own keys, signs locally, and hands over finished claims; the token authenticates the transport and never the authority.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "A store signs and persists only for authors whose [[standing]] chains back to its [[operator]]; anyone else is refused and nothing is written.",
            spec: "spec/07-capabilities-accounts.md",
            proof: "test/gateway/auth.test.ts",
            door: "authorize",
          },
          {
            says: "Revocation is a [[strike]], it is transitive, and the door closes on the next check — revoking an administrator fells every [[grant]] they minted.",
            spec: "spec/07-capabilities-accounts.md",
            proof: "test/gateway/auth.test.ts",
            door: "holdsGrant",
          },
          {
            says: "A stranger's [[strike]] cannot reshape a governed reading, while the strike of somebody the [[operator]] granted directly does — and stops the instant the operator revokes that [[grant]], because the trusted set is resolved live rather than copied at startup.",
            spec: "spec/07-capabilities-accounts.md",
            proof: "test/gateway/lenses.test.ts",
            door: "governedGatherBody",
            gap: "Scoped to the first link on purpose. Standing minted one link further down — an administrator granting somebody — binds the DOOR immediately and does not yet enter the trusted set a reading resolves through, so an administrator's revocation shuts the door while the revoked author's strikes still shape the reading. That divergence is §7's known residual, and `test/gateway/auth.test.ts` pins it rather than papering over it.",
          },
          {
            says: "Who currently holds permission is answerable by an ordinary query, so an audit needs no special tooling.",
            spec: "spec/07-capabilities-accounts.md",
            proof: "test/gateway/auth.test.ts",
            door: "tenantSchemaFor",
          },
          {
            says: "An operator-signed declaration opens exactly the named readings to anonymous reads; a stranger declaring the same thing binds nothing.",
            spec: "spec/12-open-door.md",
            proof: "test/gateway/public.test.ts",
            door: "publicClaims",
          },
          {
            says: "The anonymous interface offers no mutation type whatsoever, so a tokenless write is impossible by construction rather than by a check.",
            spec: "spec/12-open-door.md",
            proof: "test/gateway/public.test.ts",
            door: "NothingPublic",
          },
          {
            says: "Closing the public door is one [[strike]], and the next request over the wire already refuses.",
            spec: "spec/12-open-door.md",
            proof: "test/server/public-http.test.ts",
            door: "publicDefect",
          },
          {
            says: "A browser page can mint its own keys and write under its own name; the server never holds the signing key.",
            spec: "spec/12-open-door.md",
            proof: "test/client/client.test.ts",
            door: null,
            gap: "The signing client ships as its own entry point (`@bombadil/loam/client`) rather than from the package root, deliberately — the root barrel carries server drivers a browser has no use for.",
          },
        ],
      },
      {
        kind: "notYet",
        items: [
          'Anchoring a store\'s frontier to an outside timestamping service — so "this existed by Tuesday" is checkable by someone who distrusts you entirely — is named as cheap and optional, and nothing implements it.',
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 7,
    slug: "containers",
    title: "Ground with its own rules",
    thesis:
      "A [[container]] is a named region of a store with its own admission rules and its own reach — and tenants, sandboxes, shippable modules and [[federation]] boundaries all turn out to be that one primitive with different settings.",
    covers: [
      "spec/24-quarantine.md",
      "spec/27-containers.md",
      "spec/28-container-trust.md",
      "spec/31-mount-table.md",
    ],
    body: [
      {
        kind: "prose",
        text: "Four features that look unrelated — a tenant, a sandbox for a stranger's code, a package you can depend on, a boundary you federate across — are the same shape underneath. Each is a region with an answer to two questions: whose facts may enter, and how far does law declared inside reach. Loam builds them all from one primitive so those two answers are enforced in one place rather than four.",
      },
      { kind: "heading", text: "Running somebody else's code over your real data" },
      {
        kind: "prose",
        text: "A [[quarantine]] reads your live [[ground]] — not a copy, not a snapshot, the actual growing thing — and keeps everything written inside it. So you can hand a stranger's schema, computed field, or page your genuine facts, watch precisely what it produces, and then drop the pool. Nothing crossed. Nothing to clean up.",
      },
      {
        kind: "figure",
        figure: "oneWayGlass",
        caption: "One-way glass, and the one deliberate way back.",
      },
      {
        kind: "prose",
        text: "If you like what it computed, you can keep exactly that: [[promotion]] takes one value and re-asserts it as your own signed claim, citing where it came from and who computed it. It survives the pool being dropped, because it crossed by your signature rather than by copying. And in the other direction, the boundary does not weaken your control: when you erase a fact, it is forgotten inside every attached pool too, and if a pool cannot be made to forget, the whole erase fails rather than reporting a success it did not achieve.",
      },
      { kind: "heading", text: "Freezing a region so somebody else can depend on it" },
      {
        kind: "prose",
        text: "Describe a region by a rule — this author, this window, this explicit set, or a boolean combination — and you can either watch it live or freeze it. A frozen region is a [[module version]]: a content address that any other store computes identically from the same members, with no coordination and no registry. That address is what a dependency actually is here, and it does not drift as your store keeps growing.",
      },
      {
        kind: "prose",
        text: "A frozen module carries a manifest of what it offers — a reading, a page, a computed field — and you adopt them one at a time or all at once, under your own authorship. Adopting is not installing: nothing binds in your store because a stranger said it should.",
      },
      { heading: "", kind: "heading", text: "The rules that keep this safe" },
      {
        kind: "prose",
        text: "Two of them are enforced at the door rather than left to good intentions. A [[container]] you have marked untrusted must be its own store, because only separate bytes can be discarded without a trace — its [[posture]] is checked, and the refusal names why. And the containment tree can never close a cycle; an edge that would make one is refused, and a cycle that arrives from outside is resolved back to a forest rather than hanging a read forever.",
      },
      {
        kind: "prose",
        text: "Containers can also appear and disappear on a running server. Attach one and it is live at its own [[mount]] immediately; drop it and the route goes with it — no process still answering for a world that no longer exists. Your own names always win: a container can never take a [[mount]] you already claimed, and to a caller with no token, a live mount, a removed one, and one that never existed are the same refusal.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "A [[quarantine]] follows the primary store's live facts, and nothing written inside it ever reaches the primary — dropping it leaves the primary untouched.",
            spec: "spec/24-quarantine.md",
            proof: "test/gateway/quarantine.test.ts",
            door: "Gateway",
          },
          {
            says: "Erasing a fact in the primary forgets it inside every attached [[quarantine]] too, byte for byte, with no path back in.",
            spec: "spec/24-quarantine.md",
            proof: "test/gateway/quarantine.test.ts",
            door: "Gateway",
          },
          {
            says: "A value a quarantined program computed can be adopted as your own signed claim, with its provenance recorded, and it survives dropping the pool.",
            spec: "spec/24-quarantine.md",
            proof: "test/gateway/promotion.test.ts",
            door: "Gateway",
          },
          {
            says: "If a pool genuinely cannot be made to forget, the erase call fails — it never reports a completeness it did not verify.",
            spec: "spec/24-quarantine.md",
            proof: "test/gateway/erasure-fanout.test.ts",
            door: "Gateway",
          },
          {
            says: "A region can be described by a rule and either watched live as the [[ground]] grows or evaluated once as a queryable set.",
            spec: "spec/27-containers.md",
            proof: "test/gateway/membership.test.ts",
            door: "membershipClaims",
          },
          {
            says: "Two independent stores holding the same members freeze them to the same address, with no coordination, and the address does not drift as either store grows.",
            spec: "spec/27-containers.md",
            proof: "test/gateway/container-identity.test.ts",
            door: "freezeMembers",
          },
          {
            says: "A module's manifest lets you adopt its offerings one at a time or all at once, under your own authorship, and what you did not adopt does not bind.",
            spec: "spec/27-containers.md",
            proof: "test/gateway/adopt-law.test.ts",
            door: "readLawAdoptions",
          },
          {
            says: "An untrusted [[container]] must be its own store; declaring one over shared ground is refused at the door with the reason named.",
            spec: "spec/28-container-trust.md",
            proof: "test/gateway/container-wall.test.ts",
            door: "containerDefect",
          },
          {
            says: "A container may admit facts from sources you have never vetted without that choice obligating your own store to admit them — admission and reach are separate axes.",
            spec: "spec/28-container-trust.md",
            proof: "test/gateway/container-trust-subject.test.ts",
            door: "readContainerTable",
          },
          {
            says: "The containment tree can never be made to close a cycle, and a cycle arriving from outside resolves back to a forest instead of hanging a read.",
            spec: "spec/28-container-trust.md",
            proof: "test/gateway/container-tree.test.ts",
            door: "readContainerTable",
          },
          {
            says: "A container attached to a running server is live at its [[mount]] with no restart, and dropping it takes the route down with it.",
            spec: "spec/31-mount-table.md",
            proof: "test/server/dynamic-mounts.test.ts",
            door: "serve",
          },
          {
            says: "A container can never shadow a [[mount]] the operator already named — a colliding one is simply unreachable rather than a hijack.",
            spec: "spec/31-mount-table.md",
            proof: "test/server/dynamic-mounts.test.ts",
            door: "serve",
          },
          {
            says: "To a caller with no token, a live mount, a removed mount and a mount that never existed are indistinguishable, so the server cannot be enumerated.",
            spec: "spec/31-mount-table.md",
            proof: "test/server/dynamic-mounts.test.ts",
            door: "serve",
          },
        ],
      },
      {
        kind: "notYet",
        items: [
          "A resource envelope for a container — its own time, memory and outbound budget, so a child region cannot starve the doors that host it — is named as load-bearing rather than a nicety, and is not built (T34). Until it is, a quarantine bounds crashes and hangs but not appetite.",
          "Confining a quarantined program from the filesystem and the network is the deeper half of the sandbox and is unbuilt (T35); today the code is bounded but trusted not to reach.",
          "A quarantine sees all the facts it was seeded with — narrowing what it may read is a future design, not a knob.",
          "Sharing only what a peer does not already hold, by chunking a frozen region into a verifiable tree, is designed and deferred (T76); a frozen address today is a flat hash over the whole member set.",
          "Depending on modules that depend on modules — version ranges, a solver, a resolved graph — is named and deferred. A single minimum floor is what exists.",
          "Narrowing what a host publishes does not yet immediately narrow what an attached container serves anonymously; it takes effect at its next reseed. Found by a review, and open (T88).",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 8,
    slug: "forgetting",
    title: "Forgetting, and proving it",
    thesis:
      "An [[operator]] can have a fact genuinely removed — the bytes gone from every tier that held them — while the store keeps a permanent signed record that it forgot, and never a record of what. And because removing something can break what other people were relying on, it happens in two steps, with the impact list true before anything goes.",
    covers: ["spec/11-erasure.md", "spec/29-slating-and-graveyards.md"],
    body: [
      {
        kind: "prose",
        text: "An append-only store has an obvious problem, and dodging it is not an option: sometimes a fact must actually go. A person asks. A law requires it. Something was published that should never have been.",
      },
      {
        kind: "prose",
        text: "So Loam separates two things most systems conflate. A [[strike]] means *this is no longer true* — the claim stays legible and stops counting. [[erasure]] means *these bytes are gone* — and it is a different operation, with a different authority, a different cost, and a different proof.",
      },
      {
        kind: "figure",
        figure: "forgotten",
        caption:
          "What remains: a [[tombstone]] naming who ordered the forgetting and when, and an empty place.",
      },
      {
        kind: "prose",
        text: "The order to forget is itself appended, signed by the [[operator]] and nobody else — not even the claim's own author can order it, because the store's own governance is the only thing that can be held responsible for a deletion. Then the bytes go, and every tier that could be holding them is asked, individually, whether it still does. Not a count of rows deleted: a question, per tier, about presence.",
      },
      {
        kind: "prose",
        text: 'That distinction is the whole discipline, and it is worth stating in the negative. The failure mode of an erasure system is not failing to delete. It is *reporting a completeness it did not verify*. So a tier that cannot be reached is treated as still holding the data — never as clean — and the answer a caller gets distinguishes proven-gone from could-not-be-proven. The right question to ask of any erasure claim in this system is not "did it remove the bytes" but "could this report be false".',
      },
      {
        kind: "prose",
        text: "A [[tombstone]] cannot itself be erased: a store that could forget its own forgetting would be unauditable. It can, however, be struck — which is forgiveness, and lets an id return. And erasing here never compels anyone else: a peer's [[operator]] decides for themselves whether to honor a foreign order, so a forged tombstone cannot cascade a deletion across a network.",
      },
      {
        kind: "heading",
        text: "Two steps, because deleting affects other people",
      },
      {
        kind: "prose",
        text: "One store serves many tenants and many views, so removing a fact can invalidate something somebody else was relying on — and the obvious courtesy, a dry run that reports the impact before you commit, does not work. A dry run is a *look* at a world that keeps moving: between the look and the act, someone appends, and the list you were shown quietly under-reports. Caching it makes that worse rather than better.",
      },
      {
        kind: "prose",
        text: "So forgetting is one operation in two steps. First you IDENTIFY, which creates a [[slate]]: a frozen set of ids, named and addressable, with some of the store's doors CLOSED over them. Then you CUT. The list is not true because somebody looked carefully — it is true because while the [[slate]] stands the set cannot grow, and the doors that could have grown it are shut. Which doors is your choice, and it is a legal choice rather than a technical one: closing only the outward ones is a grace period, closing reads too is very nearly the deletion already, and closing none is an honest announcement.",
      },
      {
        kind: "prose",
        text: "The window is where the two-step shape earns its keep, because it can show you things a single act never could. If forgetting one fact would bring another back to life — because the fact you are removing was the retraction of something else — you are told which ones, before you destroy anything. If a copy was made under a different id before you started, you are told where the links are, and told plainly that links are all a content-addressed store can find. And a deadline is part of the [[slate]], because a compliance clock starts when somebody asks: let it lapse and reads close on their own, which is the safe direction rather than the convenient one.",
      },
      {
        kind: "prose",
        text: "What survives the cut is a [[graveyard]]: one small record that this batch of forgetting happened, holding addresses rather than content. It is deliberately not a second copy of the per-fact law — the [[tombstone]]s stay the single answer to *is this id refused* — so what the [[graveyard]] buys is arithmetic. Every id in the frozen set has a surviving [[tombstone]] that points back at this event, and that sentence is checkable years later from the store alone, with no memory of the cut and nothing to probe. That is the difference between a narrative and a proof.",
      },
      {
        kind: "prose",
        text: "A receipt is then DERIVED rather than stored, and re-issuable at any time — which matters more than it sounds. A byte verdict is a claim about the world at a moment, not a fact about the store, so a document that reprinted last month's verdict as today's would be the dry run all over again, wearing a letterhead. Every re-issue asks the tiers again. And it reports three things per fact rather than one, because \"forgiven\" alone is the wrong sentence: whether the order still stands, whether the bytes are gone now, and whether the id has come BACK — which it can, lawfully, once forgiveness lets it.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "Only the [[operator]]'s own signature can order a fact removed — even its author cannot — and an order signed by anyone else is refused before it is stored.",
            spec: "spec/11-erasure.md",
            proof: "test/gateway/erase.test.ts",
            door: "eraseDefect",
          },
          {
            says: "Completeness is established by asking every tier whether it still holds the bytes, and a tier that cannot answer is counted as still holding them rather than as clean.",
            spec: "spec/11-erasure.md",
            proof: "test/gateway/erase-tier-completeness.test.ts",
            door: "Gateway",
          },
          {
            says: "Removal is durable at rest: a reopened store leaves no legible plaintext behind, and it still knows what it owes even if the process died mid-purge.",
            spec: "spec/11-erasure.md",
            proof: "test/store/erasure-at-rest.test.ts",
            door: "SqliteBackend",
          },
          {
            says: "A [[tombstone]] can never itself be erased; striking one is forgiveness, and the id may then return.",
            spec: "spec/11-erasure.md",
            proof: "test/gateway/erase.test.ts",
            door: "eraseClaims",
          },
          {
            says: "One store's erasure never compels a peer — each store's [[operator]] decides whether to honor a foreign order, so a forged order cannot cascade.",
            spec: "spec/11-erasure.md",
            proof: "test/gateway/erase.test.ts",
            door: "readTombstones",
          },
          {
            says: "What was identified is what gets destroyed: a [[slate]]'s set is fixed by content address the moment it is named, and re-pointing it afterwards binds nothing — so the impact list cannot quietly widen between the warning and the deletion.",
            spec: "spec/29-slating-and-graveyards.md",
            proof: "test/gateway/slate.test.ts",
            door: "slateClaims",
          },
          {
            says: "While a [[slate]] stands the set cannot grow: the store declines to hand those facts to a peer, declines new claims that depend on them, and — if you asked for it — declines to serve them at all.",
            spec: "spec/29-slating-and-graveyards.md",
            proof: "test/gateway/slate-doors.test.ts",
            door: "readSlates",
          },
          {
            says: "If forgetting one fact would bring another back to life, you are shown which ones BEFORE the deletion — and a cut that cannot finish leaves the [[slate]] standing rather than half-done, so it can be repaired and resumed.",
            spec: "spec/29-slating-and-graveyards.md",
            proof: "test/gateway/slate-cut.test.ts",
            door: "Gateway",
          },
          {
            says: "A compliance receipt re-asks every tier each time it is issued, so it reports what is true now rather than reprinting an old answer — and it says whether a forgiven fact has come back.",
            spec: "spec/29-slating-and-graveyards.md",
            proof: "test/gateway/slate-receipt.test.ts",
            door: "Gateway",
          },
        ],
      },
      {
        kind: "notYet",
        items: [
          'Two of the four described degrees of forgetting — reasserting a fact anonymously, and redacting one pointer out of a claim — are compositions an operator performs by hand out of an erase and an ordinary signed append. There is no single call for either, so a claim that Loam can "anonymize a fact" has to say how.',
          "Which downstream materializations must also be redone after an erasure is computed and reported, but acting on it is left to the operator as policy rather than cascaded automatically.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 9,
    slug: "federation",
    title: "Two grounds, one wire",
    thesis:
      "Two stores swap signed facts over plain HTTP, each keeps its own readings, and you decide live — by appending a claim, not by restarting — whose facts and whose vocabulary you accept.",
    covers: ["spec/08-persistence-federation.md"],
    body: [
      {
        kind: "prose",
        text: "There is no consensus step, no leader, and nothing in the middle. One store asks another for the facts it does not have, and gets signed claims whose addresses it can check itself. Since merging is union and addresses are content, there is nothing to reconcile; the only real question is what you are willing to admit.",
      },
      {
        kind: "figure",
        figure: "twoGrounds",
        caption: "The same bytes in two stores — and a [[strike]] that stops at the [[roster]].",
      },
      {
        kind: "prose",
        text: "That question is answered by a [[roster]], and the [[roster]] is data. Widening it is an append; narrowing it is a [[strike]]; either way the very next pull behaves differently, with no restart and no deploy. This is also where the subtlety lives: admitting somebody's facts is not the same as letting them shape your readings. A stranger's [[strike]] against a claim you rely on travels no further than your own [[roster]] lets it.",
      },
      {
        kind: "prose",
        text: "Peers do not have to share your vocabulary either. A translation renders a foreign dialect into your own as *more* claims, citing the originals — which stay exactly as they arrived, untouched, beside their normalizations. You never have to overwrite somebody else's words to be able to read them.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "Appending one claim to the [[roster]] changes what the very next pull admits — no restart.",
            spec: "spec/08-persistence-federation.md",
            proof: "test/federation/trust.test.ts",
            door: "readTrustPolicy",
          },
          {
            says: "A peer's foreign vocabulary is rendered into yours as additional cited claims, and their originals persist untouched beside them.",
            spec: "spec/08-persistence-federation.md",
            proof: "test/federation/normalize.test.ts",
            door: "translate",
          },
          {
            says: "Asking a peer for what you do not have returns exactly the complement of what you already hold, so syncing is incremental rather than a re-download.",
            spec: "spec/08-persistence-federation.md",
            proof: "test/store/contract.test.ts",
            door: "pullFrom",
          },
          {
            says: "A stranger's [[strike]] is refused at the door of a store that never admitted them, before any reading has to compensate for it.",
            spec: "spec/08-persistence-federation.md",
            proof: "test/federation/trust.test.ts",
            door: "trustClaims",
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 10,
    slug: "apps-are-deltas",
    title: "Apps are deltas",
    thesis:
      "A page and a background function are records in the store like any other — push them and the store serves them, with no build step, no deploy, and no key handed to the code.",
    covers: ["spec/06-functions-runner.md", "spec/23-renderers.md", "spec/34-the-board.md"],
    body: [
      {
        kind: "prose",
        text: "If a reading is data and a computed field is data, there is no reason a page should not be. A [[renderer]] is a signed record naming a route, the fields it reads, and a bundle of real code — and the store serves it immediately, rendered from live facts, updating when the facts change.",
      },
      {
        kind: "prose",
        text: "The code is handed capabilities rather than credentials: resolve this, watch that, write through this narrow door. It holds no keys. When a page needs to accept a write, it signs under a [[pen]] — a separate revocable identity — so revoking the page's ability to write does not revoke anything else, and the writes it already made stay correctly attributed to it.",
      },
      {
        kind: "prose",
        text: "The same idea one layer down gives you background work. A [[binding]] is a function installed as data. Nothing schedules it: it sits inert until something that knows how to run it attaches, and then it computes. Re-publishing a definition supersedes the old one, latest per name, so improving a function is an append like everything else.",
      },
      {
        kind: "prose",
        text: "Running somebody's code is a risk, and the honest summary is that Loam bounds the accidents and not yet the malice. A bundle that hangs, throws, or eats memory becomes a clean failure that leaks nothing of its internals, and it cannot wedge the server. A bundle that deliberately reaches for the filesystem or the network is not yet stopped — which is exactly why the [[quarantine]] exists, and why this is stated here rather than buried.",
      },
      {
        kind: "prose",
        text: "And it is not hypothetical: the team's own status board is a Loam app (§34) — one boot script over an empty home lands the vocabulary, the grants, the [[renderer]], and the tokenless-read declaration in a single run, and from then on every board event is one signed claim from whoever reported it. The claude.ai artifact people read on their phones is generated from the store's own view, so it cannot disagree with the board.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "A [[binding]] installed while nothing is attached to run it computes nothing, and the same fact arriving after a runner attaches fires it.",
            spec: "spec/06-functions-runner.md",
            proof: "test/runner/runner.test.ts",
            door: "Runner",
          },
          {
            says: "Re-publishing a function definition supersedes the previous one — latest per name wins, and a fresh attach installs it once.",
            spec: "spec/06-functions-runner.md",
            proof: "test/runner/runner.test.ts",
            door: "readBindingDefinitions",
          },
          {
            says: "Publishing a [[renderer]] makes a route servable at once, rendered from live facts, and a new fact changes what it renders.",
            spec: "spec/23-renderers.md",
            proof: "test/gateway/renderers.test.ts",
            door: "readRenderers",
          },
          {
            says: "A page's bundle that hangs, throws, or consumes too much memory becomes a clean failure that leaks nothing of its internals and cannot take the server with it.",
            spec: "spec/23-renderers.md",
            proof: "test/gateway/render-sandbox.test.ts",
            door: "Gateway",
          },
          {
            says: "A page can accept writes under a revocable [[pen]] rather than the operator's key; revoking it refuses future writes while past ones stay attributed to it.",
            spec: "spec/23-renderers.md",
            proof: "test/gateway/write-renderers.test.ts",
            door: "rendererBindingClaims",
          },
          {
            says: "Fetching a page's binary asset requires already being able to resolve the view that references it, so a stranger cannot guess an address and pull an unrelated file.",
            spec: "spec/23-renderers.md",
            proof: "test/server/byte-door-http.test.ts",
            door: "serve",
          },
          {
            says: "One run of a boot script over an empty home stands a whole application up — vocabulary, a granted writer, the page, the open door — and a re-run re-expresses law that differs instead of deferring to it.",
            spec: "spec/34-the-board.md",
            proof: "test/board/board-boot.test.ts",
            door: "Gateway",
          },
          {
            says: "A retracted claim vanishes from the app's public page and its collection view — striking one item's status or membership never touches a live neighbor.",
            spec: "spec/34-the-board.md",
            proof: "test/board/board-render.test.ts",
            door: "publicClaims",
          },
        ],
      },
      {
        kind: "notYet",
        items: [
          "Confining a bundle from the filesystem and the network — the real sandbox, rather than the timeout and memory bound that exist — is unbuilt and named as such.",
          "The live browser host for a [[renderer]] (client-side hydration and a subscription over the wire) is designed and deferred; today a route is server-rendered.",
          "Letting a visitor sign a page's write with their own key, rather than the page's [[pen]], waits on that browser host.",
          "A function's lifetime budget is parsed and carried onto the binding, and then read by nothing else in the source — carried, not yet consumed — and no test drives one to exhaustion and watches it stop. Treat it as designed rather than as a guarantee.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 11,
    slug: "running-one",
    title: "Running one",
    thesis:
      "A store can live in a browser tab, move onto a laptop as the same store, survive a corrupted row, carry old facts into new formats, and answer what it looked like last Tuesday.",
    covers: [
      "spec/15-browser-peer.md",
      "spec/16-tutorial.md",
      "spec/19-tutorial-v2.md",
      "spec/20-migration.md",
      "spec/25-hardening.md",
      "spec/26-as-of-reads.md",
    ],
    body: [
      {
        kind: "prose",
        text: "A full Loam store runs in a browser tab. Not a client talking to a server — the store: its own [[operator]] key, its own [[ground]], its own generated doors, persisted in the page's local storage. That is what makes the tutorial possible, and the tutorial is worth mentioning here because it is a capability rather than documentation: a stranger boots a real governed store, grows it by doing real things, and every lesson's green check is a real read of their own facts rather than a quiz answer.",
      },
      {
        kind: "prose",
        text: "And it does not have to stay there. Export the tab's store, initialize a store on your laptop from the same seed, pull — and you have the same store, matching address for address. Not a copy that looks similar. The same content, by name.",
      },
      { kind: "heading", text: "When something is wrong with the bytes" },
      {
        kind: "prose",
        text: "One unreadable row should never brick a database. A torn sync, a browser devtools scribble, a stray key another application wrote to the same origin — the store sets it aside, reports it, and boots. Everything else resolves. The one loud exception is the store's constitutional core: if the marker naming who governs this store is unreadable, boot refuses rather than quietly opening a store that does not know whose it is.",
      },
      {
        kind: "prose",
        text: "What was set aside is not swept under a rug. A repair command lists every quarantined row with its reason and a safe preview, and lets you discard it, re-admit it, or leave it alone. It never edits bytes into validity — a store that can forge a fact to make a boot succeed is worse than a store that refuses.",
      },
      { kind: "heading", text: "When the format changes underneath old facts" },
      {
        kind: "prose",
        text: "Formats change. When one does, migration carries old facts forward without ever rewriting one: it re-signs the content into the new form at the original timestamp and strikes the old claim with a pointer to its replacement and a stated reason. So the history of the retirement is legible, and re-running the migration on an already-current store does nothing at all. It is also not a signing oracle: it can only re-sign what the running key itself authored, and a claim it cannot verify is left exactly as it is.",
      },
      { kind: "heading", text: "What did this look like on Tuesday" },
      {
        kind: "prose",
        text: "Because nothing is overwritten, the past is not gone — it is just unasked-for. An [[as-of]] read resolves the same reading against the [[ground]] as it stood at a moment you name. Two honesty properties come with it: a fact that was lawfully erased never reappears, no matter how far back you point, and when a reconstruction spans a moment where something was forgotten, the answer says so — without saying what.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "A browser store keeps each fact under its own key, so appending costs the size of the batch rather than the size of the store, and removing one is genuinely removing one.",
            spec: "spec/15-browser-peer.md",
            proof: "test/store/local-storage.test.ts",
            door: "LocalStorageBackend",
          },
          {
            says: "Running out of storage space mid-batch removes that batch's own writes and rejects the whole batch — never a half-written fact.",
            spec: "spec/15-browser-peer.md",
            proof: "test/store/local-storage.test.ts",
            door: "LocalStorageBackend",
          },
          {
            says: "A store born in a tab moves onto a machine as the same store: export, initialize from the same seed, pull, and the addresses match one for one.",
            spec: "spec/16-tutorial.md",
            proof: "test/site/arc.test.ts",
            door: "pullFrom",
          },
          {
            says: "Every lesson in the tutorial is checked by a real read of the learner's own store rather than a quiz answer; every lesson after the first is false before that lesson runs; and no lesson can un-green an earlier one, since all of them are re-proved from the ground on every boot.",
            spec: "spec/19-tutorial-v2.md",
            proof: "test/site/arc.test.ts",
            door: null,
            gap: "The arc lives in the tutorial site rather than the library, so there is no package export to name; the headless suite drives the exact functions the page calls.",
          },
          {
            says: "A store holding a corrupted fact still boots, and every good fact still resolves.",
            spec: "spec/25-hardening.md",
            proof: "test/gateway/boot-resilience.test.ts",
            door: "Gateway",
          },
          {
            says: "If the marker naming the store's [[operator]] is unreadable, boot refuses loudly rather than opening a store that does not know who governs it.",
            spec: "spec/25-hardening.md",
            proof: "test/gateway/boot-resilience.test.ts",
            door: "Gateway",
          },
          {
            says: "A repair command names every set-aside row, its reason, and a safe preview, and never fabricates bytes into validity.",
            spec: "spec/25-hardening.md",
            proof: "test/cli/repair.test.ts",
            door: "run",
          },
          {
            says: "A per-author write budget can be set and raised by appending a claim, live, with no restart.",
            spec: "spec/25-hardening.md",
            proof: "test/gateway/budget.test.ts",
            door: "Gateway",
          },
          {
            says: "Migration re-signs each changed fact at its original timestamp and strikes the old one with a pointer to its replacement and a reason — never a silent rewrite.",
            spec: "spec/20-migration.md",
            proof: "test/migrate/migrate.test.ts",
            door: "migrate",
          },
          {
            says: "Re-running a migration against an already-current store adds nothing and supersedes nothing.",
            spec: "spec/20-migration.md",
            proof: "test/migrate/migrate.test.ts",
            door: "MIGRATIONS",
          },
          {
            says: "Migration is not a signing oracle: a fact it cannot verify is never re-signed under someone else's name.",
            spec: "spec/20-migration.md",
            proof: "test/migrate/migrate.test.ts",
            door: "migrate",
          },
          {
            says: "A query can name a past moment and get the reading resolved against the [[ground]] as it stood then, while an ordinary query still reads the present.",
            spec: "spec/26-as-of-reads.md",
            proof: "test/gateway/asof.test.ts",
            door: "Gateway",
          },
          {
            says: "A fact that was erased never reappears in an [[as-of]] read, at any moment you can name.",
            spec: "spec/26-as-of-reads.md",
            proof: "test/gateway/asof.test.ts",
            door: "Gateway",
          },
          {
            says: "When a reconstruction spans a moment where something was lawfully forgotten, the answer confesses it — without revealing what was forgotten.",
            spec: "spec/26-as-of-reads.md",
            proof: "test/gateway/asof.test.ts",
            door: "Gateway",
          },
        ],
      },
      {
        kind: "notYet",
        items: [
          "A browser store can pull and push, but nothing can pull *from* a tab — a browser store is always a leaf or an aggregator, never something others sync against.",
          "A second tab sees the first tab's writes at its next boot, not live. Cross-tab liveness is [[federation]]'s job and is not improvised in the storage driver.",
          "IndexedDB is named as a drop-in behind the same seam and is not written; local storage is what exists.",
          "A subscription that starts in the past and streams forward is out of scope; [[as-of]] answers one moment, not a replay.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 12,
    slug: "refusals",
    title: "What Loam refuses to be",
    thesis:
      "The most useful thing a system can tell you is what it will not do, stated plainly enough that you can plan around it instead of discovering it.",
    covers: [
      "spec/10-reference-inventory.md",
      "spec/13-boundaries-posture.md",
      "spec/18-glossary.md",
    ],
    body: [
      {
        kind: "prose",
        text: "Some of what follows is a limitation and some of it is a decision. The distinction matters, so: these are decisions. They could be revisited, and none of them is waiting on an engineer.",
      },
      {
        kind: "prose",
        text: '**There is no scarcity primitive.** Loam will not tell you who owns the last one of something. No double-spend answer, no built-in "exactly one" invariant — those need a global order, and there is no global order here by construction. Where ordering genuinely matters, a store can act as the ordering authority for its own narrow context and sign sequence claims, and its peers can decide whether to believe it. That is a pattern, not a feature, and it is not built.',
      },
      {
        kind: "prose",
        text: "**Forgetting does not travel.** When you erase a fact, peers who already hold it are not compelled to forget it. Each store's [[operator]] decides. This is not a gap in the implementation; a system where a signed message can force deletions on strangers is a weapon, and the alternative is asking.",
      },
      {
        kind: "prose",
        text: "**There is no platform.** No registry, no central schema authority, no service that has to be up. The consequence is that discovery is your problem, and coordination between two parties who have never met is also your problem. The compensation is that a [[module version]]'s address is computable by anyone, so you can depend on somebody's law without depending on somebody's server.",
      },
      {
        kind: "prose",
        text: "**The words are borrowed on purpose.** [[HyperSchema]], [[HyperView]], [[Schema]], [[Policy]], [[View]] — these are the substrate's own vocabulary, and Loam does not invent near-synonyms for them, because a second word for one concept is how a system's documentation starts disagreeing with its code. Where this book uses a word the code does not — [[ground]], [[lens]], [[standing]], [[promotion]] — the hover card says so, and a rail checks that it stayed true.",
      },
      {
        kind: "prose",
        text: "One last piece of lineage. Loam's design was read out of a working application built the hard way first, and that application stays a reference rather than a dependency — read for its plumbing, never linked. The code here is written clean, against its own tests.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "Erasure never propagates across [[federation]]: a peer's own [[operator]] decides whether to honor a foreign order to forget.",
            spec: "spec/13-boundaries-posture.md",
            proof: "test/gateway/erase.test.ts",
            door: "readTombstones",
          },
          {
            says: "There is no scarcity primitive and no global order — a store may sign sequence claims for its own narrow context, and peers may believe it or not.",
            spec: "spec/13-boundaries-posture.md",
            proof: null,
            gap: "An absence cannot be railed: no test can fail because scarcity is missing, and the ordering-authority pattern is described rather than implemented. Believe this one because the code has no such primitive to find, not because a test says so.",
          },
          {
            says: "Retiring a whole generation of a store — seeding a fresh one from the old one's own signed facts, ids and signatures intact — is offered as a pattern rather than a command.",
            spec: "spec/13-boundaries-posture.md",
            proof: null,
            gap: "Composed by hand out of export and pull, both of which are built and proved elsewhere in this book; there is no named operation and no test for the composition.",
          },
          {
            says: "Every word this book presents as the code's own really is exported under that name, and every word it presents as ours is not — checked, not asserted.",
            spec: "spec/18-glossary.md",
            proof: "test/site/capabilities.test.ts",
            door: null,
            gap: "The proof is this book's own rail, which is the honest citation: the guarantee is about the book's vocabulary, so the thing that can go red is the book's own suite.",
          },
          {
            says: "The application Loam's design was read out of stays a reference and never a dependency — read for its plumbing, never linked.",
            spec: "spec/10-reference-inventory.md",
            proof: null,
            gap: "A process rule rather than a behavior. Nothing in the build could fail if it were violated; the package manifest naming no such dependency is the whole evidence.",
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    n: 13,
    slug: "users-and-sessions",
    title: "Users and sessions",
    thesis:
      "A password never enters the ground the store replicates — it lives in one plain file, checked whole, refusing to authenticate against itself the moment it cannot be fully trusted.",
    covers: ["spec/36-users-and-sessions.md"],
    body: [
      {
        kind: "prose",
        text: "Everything else Loam holds is a signed claim, and a signed claim can travel: federation copies it, an offer file can carry it off the box. A password hash must never take that path, so it is the one part of a user that is not a [[delta]]. It lives in a plain file beside the store's own signing seed, at a permission mode that refuses every other account on the box.",
      },
      {
        kind: "prose",
        text: "The interesting property is not the format — a version number, a salt, a hash, the cost the hash was derived at — it is the refusal. A file this code cannot fully verify is a file it will not authenticate against, and the refusal covers the WHOLE file rather than the one damaged entry: a shape nobody can vouch for is not a shape to trust anyone against, including the users whose own entries are intact.",
      },
      {
        kind: "prose",
        text: "This is the first of ten phases building toward a full login story — a session table, a login door, cross-site defence, per-operator signing keys, and a delay that slows a guesser without ever locking a real user out. Each phase is a small pull request landing on its own; this one delivers the credential file every later phase writes to or reads from, and nothing yet does either.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "The same password hashed twice produces two different results, and each verifies only against its own salt — a hash checked against the wrong salt never matches.",
            spec: "spec/36-users-and-sessions.md",
            proof: "test/server/credentials.test.ts",
            door: null,
          },
          {
            says: "Every shape of damage to the credential file — truncated, not JSON, a wrong version, an empty or non-hex hash or salt, a hash whose length disagrees with its own parameters, an unknown entry kind — refuses rather than resolving to a match, and one damaged entry refuses the whole file.",
            spec: "spec/36-users-and-sessions.md",
            proof: "test/server/credentials.test.ts",
            door: null,
          },
          {
            says: "The file writes through a temp-then-rename, lands at an owner-only file mode even when an older copy sat looser, and a fault partway through the write leaves no temporary file behind.",
            spec: "spec/36-users-and-sessions.md",
            proof: "test/server/credentials.test.ts",
            door: null,
          },
          {
            says: "A user holds a SET of roles, not a single latest value — granting operator and actor both resolves, and revoking one leaves the other.",
            spec: "spec/36-users-and-sessions.md",
            proof: "test/server/users-ground.test.ts",
            door: null,
          },
          {
            says: "Removing a role strikes EVERY surviving claim of it, not just the latest one — a role granted twice, once through the CLI and once by a hand-appended claim standing in for a federated pull, still comes off in one `remove-role` call. For the operator role, the same call strikes the signing grant it minted, and a fresh delta signed by that user's old key stops resolving for a governed reader while a different operator's key still does.",
            spec: "spec/36-users-and-sessions.md",
            proof: "test/cli/user-roles.test.ts",
            door: null,
          },
          {
            says: "A signed-in session lives only in server memory, past its idle window it refuses rather than resurrecting, and a wall clock stepped backward cannot extend it — the table reads a clock that only ever moves forward.",
            spec: "spec/36-users-and-sessions.md",
            proof: "test/server/session-table.test.ts",
            door: null,
          },
          {
            says: "A minted bearer token is held as a digest with its own expiry, never the plaintext and never borrowing its session's longer idle window — and dropping a session revokes every token it minted.",
            spec: "spec/36-users-and-sessions.md",
            proof: "test/server/session-table.test.ts",
            door: null,
          },
          {
            says: "The login door refuses one way — a wrong password, an unknown name, and a role-less user answer the same status and byte-identical bodies, with a decoy hash making an absent name cost what a miss costs — and a session cookie opens no data door: attached to graphql, append or mcp it earns exactly the bytes a credential-less request earns.",
            spec: "spec/36-users-and-sessions.md",
            proof: "test/server/login-door.test.ts",
            door: null,
          },
          {
            says: "A POST the store's own page did not make is refused before anything else happens: a foreign or null Origin, a missing same-origin signal, or a wrong form token answers 403 having read no password, spent no hash, and slid no session's idle window — and the refusal names its cure.",
            spec: "spec/36-users-and-sessions.md",
            proof: "test/server/login-csrf.test.ts",
            door: null,
          },
          {
            says: "A browser crosses to the data doors by trading its session for a short-lived bearer token, never by its cookie — and the token dies with its window, dies with its session on every path that ends one, and is not minted at all while a world the role binding never named is answering beside it.",
            spec: "spec/36-users-and-sessions.md",
            proof: "test/server/session-token.test.ts",
            door: null,
          },
          {
            says: "Two operators writing through their own sessions leave two different names in the ground — each write carries that user's own signing key, and a user holding the role with no key on this box is refused rather than quietly signing as the store.",
            spec: "spec/36-users-and-sessions.md",
            proof: "test/server/session-authorship.test.ts",
            door: null,
          },
        ],
      },
      {
        kind: "notYet",
        items: [
          "The constitutional writes — registering a schema, the renderer's pen — still sign as the store rather than as the person, because publishing law refuses any author but the store's own.",
          "The failed-login delay (phase 9) is not built: a wrong password costs a hash and fills no counter. `loam user unlock` is deferred to that phase, which owns the file it would clear.",
          "Erasure honesty for `credentials.json` (phase 10): the health report and compliance receipt do not yet name the credential file as a surface erasure does not sweep.",
        ],
      },
    ],
  },
  {
    n: 14,
    slug: "connectors",
    title: "Connectors — letting an outside party in",
    thesis:
      "An outside party — claude.ai, or any MCP client — reaches a store over OAuth rather than as the operator at a keyboard, built in small phases that each land and merge alone.",
    covers: ["spec/37-connectors.md"],
    body: [
      {
        kind: "prose",
        text: "A connector needs somewhere durable to keep what it knows before any door exists for it to use: which clients are registered, which one owns which signing seed, which tokens are still live. That record lives in the home, mode 0600, beside the operator's own seed — never in the ground, because the ground replicates under [[federation]] and a peer receiving it would receive a connector's signing key.",
      },
      {
        kind: "prose",
        text: "Two processes touch this record from outside each other's view — a revoke command and the running server — so a plain read-modify-write would let whichever writes second silently discard the other's change. A cross-process lock closes that, and the guarantee it makes is about the WRITE rather than about a caller's own work: breaking a lock left behind by a crashed process cannot be made fully race-free without a primitive the filesystem does not offer, so the design narrows the exposed gap to the syscall between one file read and the rename that publishes it, rather than pretending the gap is closed.",
      },
      {
        kind: "claims",
        claims: [
          {
            says: "A file this reader cannot fully parse refuses outright rather than reading as empty — a truncated file, a wrong version, a grant whose actor disagrees with its own signing seed, or a duplicate client id all throw, because treating damage as absence would let a later door mint a second seed for a connector that already has one.",
            spec: "spec/37-connectors.md",
            proof: "test/server/oauth-file.test.ts",
            door: null,
          },
          {
            says: "A connector finds the store through two RFC well-known documents and a WWW-Authenticate header on the MCP door's 401, every URL built from one configured --public-url and blind to a foreign Host or X-Forwarded-Host — and the same header is byte-identical whether the mount it names exists, has nothing public, or never existed at all, so it answers who to ask without becoming a second oracle.",
            spec: "spec/37-connectors.md",
            proof: "test/server/oauth-discovery.test.ts",
            door: null,
          },
        ],
      },
    ],
  },
];
