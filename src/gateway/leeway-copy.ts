import type { EnvelopeSize } from "./leeway.js";

export interface LeewayControl {
  readonly field: string;
  readonly label: string;
  readonly capability: string;
  readonly risk: string;
}

export type SwitchField = "receive" | "offer" | "publish";

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

export const LEEWAY_CONTROLS: readonly LeewayControl[] = [
  ...SWITCH_CONTROLS,
  DELEGATE_CONTROL,
  ENVELOPE_CONTROL,
] as const;

export const ENVELOPE_SIZES: readonly EnvelopeSize[] = ["small", "medium", "large"] as const;

export const LEEWAY_LEDE =
  "Every switch starts off — the private journal is the default. A leeway is a declaration on " +
  "this container, so changing it later is a delta the next request obeys.";
