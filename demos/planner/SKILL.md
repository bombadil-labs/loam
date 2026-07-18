---
name: planner
description: Set up and drive PLANNER — plans with guest lists and signed RSVPs, living in the user's own Loam store and federated with the people they invite. Use when the user wants to plan something, check their agenda, invite people, RSVP, or share plans.
---

# Planner — plans that live in your store

Like Larder, this app is **made of data**: land the bundle, speak the templates. No server, no
invites-by-email, no company calendar. An RSVP is the guest's **own signed claim** — you cannot
answer for someone else, and neither can anyone.

## Install ("set up my planner")

1. Register `bundle/plan.json` then `bundle/planner-book.json` through the register door (each
   file verbatim — note `plan.json` carries a §22 resolver that renders RSVPs with their signer).
2. Publish `renderer-agenda.json` and `renderer-plan.json`.
3. Declare `Planner` and `Plan` public (the agenda link needs no token).
4. Optional pen for tokenless RSVP buttons: provision `planner-pen` in serve config and grant it
   write standing (`grant loam:store <pen-author> write`). Skip if you are the only write path.

The agenda lives at `<store URL>/app/planner/planner:mine`; each plan at `/app/plan/plan:<slug>`.

## Daily verbs

Plans are `plan:<slug>`. Creating one is a link plus its facts:

```graphql
mutation { linkPlanner(entity: "planner:mine", field: "plan", target: "plan:bbq") { plan } }
mutation { planIt(plan: "plan:bbq", title: "Saturday BBQ") { delta } }
mutation { scheduleIt(plan: "plan:bbq", when: <ms timestamp>) { delta } }
mutation { whereAt(plan: "plan:bbq", where: "the back garden") { delta } }
```

- **invite someone** → `mutation { invite(plan: "plan:bbq", person: "person:sam") { delta } }`
- **RSVP** (as the store's own person) → `mutation { rsvp(plan: "plan:bbq", answer: "yes") { delta } }`
- **a note** → `mutation { noteOn(plan: "plan:bbq", text: "bring a jumper") { delta } }`
- **"what's coming up?"** → `{ planner(entity: "planner:mine") { plan } }` — sort children by
  `when`, read the soonest few aloud, dim the past.
- **"who's coming?"** → `{ plan(entity: "plan:bbq") { guest rsvp } }` — `rsvp` entries arrive as
  `<signer-suffix>: <answer>`, attributed by the resolver from cryptographic authorship.

## Sharing plans

The invitee pulls your store (a token you issue) and your plans appear in **their** planner; they
RSVP **in their own store** and you pull the answer back. Everyone keeps their own ground; the
plan converges because it is a reading over the union. To share plans but not, say, groceries,
scope what your store offers with an offered lens — the privacy dial lives on your store, not in
this app.

## Cross-app tricks (zero integration code)

With Larder installed in the same store: "do we have enough beer for the BBQ?" = the plan's guest
count read beside `{ pantry(entity: "item:beer") { have } }`. Two apps, one ground. A Google
Calendar bridge is a future of the same shape: a Claude holding both this MCP and a calendar
connector mirrors `when`-bearing plans across — reading lenses, writing templates, touching no
app code.
