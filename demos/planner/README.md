# PLANNER — the second real Loam app

Things go in my planner. A plan can carry a guest list. My plans federate. That's the whole app —
banal on purpose, like [Larder](../larder/README.md), because the platform should disappear.

What quietly happened while you weren't thinking about it:

- **An RSVP is the guest's own signed claim.** Sam answers "yes" *in Sam's store*, and the answer
  arrives in yours with his cryptographic authorship attached — rendered by a §22 resolver that
  reads the claim bucket's provenance. Nobody can RSVP for anyone else. Nobody wrote an auth
  system.
- **Being invited is being federated.** No invite email, no shared calendar server: the invitee
  pulls your store and the plan appears in *their* planner; answers flow back the same way. Every
  participant keeps their own ground; the plan is a reading over the union.
- **The agenda is served from the store** — a renderer, public because the operator declared it,
  with a pen-signed RSVP button for anyone holding just the link.
- **The BBQ finally asks about beer.** With Larder in the same store, the proof answers "do we
  have enough for Saturday?" by reading the plan's guest list beside Larder's Pantry lens — two
  apps, one ground, **zero integration code**. This was promised in Larder's README as a sequel;
  it shipped as a check label.

## Run the proof

```sh
npm run build
node demos/planner/planner.mjs   # Priya hosts, Sam RSVPs from his own store — 7 checks
```

`homes/` is disposable and untracked.

## Sequels

- **Google Calendar** — an MCP-side bridge: a Claude holding both connectors mirrors
  `when`-bearing plans across, reading lenses and writing templates. No app code changes.
- **Recurring plans, reminders** — more claims, same ground.
- **Pachyderm** — the third act. Different app entirely, same trick.
