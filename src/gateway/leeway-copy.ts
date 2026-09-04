// THE FIVE CONTROLS, IN WORDS (SPEC §58 position 4). The copy is part of the spec, because it is
// the promise: every switch carries, on the page and in plain words, what it gives and what it
// risks, and the reader should have no question about either.
//
// ONE SOURCE, TWO PAGES. The consent page sets these when a container is created; the container's
// admin page changes them later, with the same five lines. A person meets the same sentences in
// both places or the second place is a different promise — so both render from here, and a rail
// compares this file against the spec's own words.
//
// The sentences are the spec's, whitespace apart. Nothing here is shortened for a narrow screen:
// a risk that does not fit is still the risk.

import type { EnvelopeSize } from "./leeway.js";

/** One control: the name a person reads, what it gives, and what it costs them. */
export interface LeewayControl {
  /** The form field, and the id its label and description hang off. */
  readonly field: string;
  /** The name on the page. */
  readonly label: string;
  /** What turning it on gives. */
  readonly capability: string;
  /** What turning it on risks, in the same breath. */
  readonly risk: string;
}

/** The three switches a leeway carries as plain booleans. */
export type SwitchField = "receive" | "offer" | "publish";

/** The three switches, in the order the spec writes them. */
export const SWITCH_CONTROLS: readonly (LeewayControl & { readonly field: SwitchField })[] = [
  {
    field: "receive",
    label: "Receive",
    capability: "Let this container follow other stores.",
    risk:
      "What arrives is kept in a pool of its own, signed by whoever sent it, under a name you " +
      "assign; you can freeze or drop it later. The risk: a store you follow can fill this pool " +
      "with anything it publishes, and its schemas can bind here under your prefix — nothing " +
      "arriving can reach outside this container, and nothing binds that you did not allow.",
  },
  {
    field: "offer",
    label: "Offer",
    capability: "Let other Loam stores follow this container.",
    risk:
      "You mint a token per follower; they receive a signed copy of what is here, under a name " +
      "they choose. The risk: whoever holds an offer token can copy this container's own " +
      "contents and keep that copy after you stop offering. An offer never includes what you " +
      "follow from others.",
  },
  {
    field: "publish",
    label: "Publish",
    capability: "Let anyone on the internet read what you mark public here.",
    risk:
      "No login, no token: a web address. The risk: a public lens is readable by strangers and " +
      "search engines until you unmark it. Nothing anonymous can ever write. Mark nothing public " +
      "you would not print.",
  },
] as const;

/** Delegate is not a switch but the terms below; its own control still reads like one. */
export const DELEGATE_CONTROL: LeewayControl = {
  field: "delegate",
  label: "Delegate",
  capability: "Let what exists under this container differ from it, on the terms you set here.",
  risk:
    "Turn it on and its terms unfold beneath: the same switches, an envelope ceiling, and may " +
    "delegate further. An agent here may then declare sub-containers with their own leeway " +
    "inside those terms, and hand out keys to helpers that live in them. The risk: anything you " +
    "allow below, the agent here can reach through its subtree — an annex that receives is a " +
    "room it can read. Helpers write under their own names, can never reach outside this " +
    "container, and are revoked when the agent is — but until then, what they write is real.",
};

/** The envelope is a ceiling, chosen by size rather than switched on. */
export const ENVELOPE_CONTROL: LeewayControl = {
  field: "envelope",
  label: "Envelope",
  capability:
    "How much compute an agent here may spend running things behind glass: small, medium, or " +
    "large.",
  risk:
    "The risk: a larger envelope lets a misbehaving app run longer and use more memory before " +
    "the store stops it. It never grants reach.",
};

/** All five, in the order a person meets them. */
export const LEEWAY_CONTROLS: readonly LeewayControl[] = [
  ...SWITCH_CONTROLS,
  DELEGATE_CONTROL,
  ENVELOPE_CONTROL,
] as const;

export const ENVELOPE_SIZES: readonly EnvelopeSize[] = ["small", "medium", "large"] as const;

/**
 * The sentence above the five, wherever they are shown. A leeway is a declaration on the
 * container, so this page is where it changes, and the change is a delta the next request obeys.
 */
export const LEEWAY_LEDE =
  "Every switch starts off — the private journal is the default. A leeway is a declaration on " +
  "this container, so changing it later is a delta the next request obeys.";
