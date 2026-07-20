---
name: larder
description: Set up and drive LARDER — a shared household grocery, pantry & recipe app that lives entirely in a Loam store. Use when the user wants to install Larder, add/check off groceries, check the pantry, write down a recipe, ask what a dish needs, ask what they can cook with what they have, or add a household member.
---

# Larder — a household commons in a Loam store

You are driving an app that is **made of data**: its schemas, its UI, and its facts are all signed
deltas in the user's own Loam store. There is no Larder server. Installing the app means landing
its bundle; using it means speaking its claim templates. Everything below goes through the user's
**loam MCP connection** (their own store's doors).

## Install ("set up our larder")

1. **Register the five lenses**, in this order, by passing each JSON file in `bundle/` verbatim to
   the register door: `item.json` (the Item lens + the app's claim templates), `pantry.json` (the
   Pantry lens — same gather, different reading), `grocery-list.json` (the list, which expands item
   edges), `recipe.json` (a dish, which expands its ingredients into their Item views), and
   `cookbook.json` (the shelf, which expands recipes). Pass each file's `resolvers` block through
   too — that is what makes a recipe line read the pantry.
2. **Publish the two renderers** the same way: `renderer-list.json` (the list UI) and
   `renderer-tick.json` (the check-off page; it names the pen `larder-pen`).
3. **Declare the read surface public** so a fridge tablet needs no token: declare `Groceries`,
   `Item` and `Cookbook` public.
4. **The pen** (only if the household wants tokenless check-off taps): the store's operator must
   (a) provision the pen seed in the store's serve config (`pens: { "larder-pen": <seed> }` — this
   is custody, config-side, never on the ground) and (b) grant it write standing:
   `grant loam:store <pen-author> write`. Skip this step for a Claude-only household; you are the
   write path.
5. **Seed a starter list** if the user likes: use the daily verbs below.

Tell the user where their list lives: `<their store URL>/app/list/list:groceries`.

## Daily verbs (GraphQL through the query door)

Items are entities named `item:<slug>` (slug = lowercase, hyphenated). **Adding an item is three
small claims** — the edge, the name, the need:

```graphql
mutation { linkGroceries(entity: "list:groceries", field: "item", target: "item:milk") { item } }
mutation { called(item: "item:milk", name: "milk") { delta } }
mutation { needIt(item: "item:milk", at: <Date.now()>) { delta } }
```

- **"add milk"** → the three claims above (reuse the entity if it already exists — then `needIt`
  alone puts it back on the list).
- **"we got the milk" / checking off** → `mutation { gotIt(item: "item:milk", at: <Date.now()>) { delta } }`
  — note this works on ANYONE's item: a later `got` outweighs an earlier `need` in the lens. You
  never retract another person's claim; you outsay it.
- **"we have six beers" / pantry** → `mutation { stocked(item: "item:beer", qty: 6) { delta } }`
- **a note** → `mutation { noteFor(item: "item:milk", text: "the oat kind") { delta } }`
- **"what do we need?"** → `{ groceries(entity: "list:groceries") { item } }` — an item is needed
  when its `need` timestamp exceeds its `got`; read the children out loud, nicely.
- **"what's in the pantry?"** → query the `pantry` lens per item: `{ pantry(entity: "item:beer") { have } }`.

## Recipes, and the question that runs both ways

A recipe is an entity named `recipe:<slug>`. Writing one down is a title plus one line per
ingredient — and each line names a REAL item entity, which is what lets the pantry answer for it:

```graphql
mutation { recipeCalled(recipe: "recipe:pasta", title: "fresh pasta") { delta } }
mutation { needsIngredient(recipe: "recipe:pasta", item: "item:flour", qty: 2) { delta } }
mutation { needsIngredient(recipe: "recipe:pasta", item: "item:egg", qty: 3) { delta } }
mutation { linkCookbook(entity: "book:recipes", field: "recipe", target: "recipe:pasta") { recipe } }
```

Reuse the same `item:<slug>` entities the grocery list uses — that is the whole trick. One item, one
stock level, read from whichever side you ask.

- **"what does the pasta need?"** → `{ recipe(entity: "recipe:pasta") { title ingredient } }`. Each
  ingredient line is COMPUTED against the pantry — `eggs: have 0, need 3 — short 3` — not typed in.
- **"what can I make?"** → `{ cookbook(entity: "book:recipes") { recipe } }`. Every recipe on the
  shelf, weighed against what is actually in the pantry right now: `flatbread — MAKEABLE`,
  `fresh pasta — need 3 eggs`. Read them out warmly; lead with what they CAN cook.
- **"I want to make pasta this week"** → ask the cookbook, then put whatever it says they are short
  of straight onto the grocery list with the daily verbs above. That is the loop: the shortfall
  becomes the list, the list becomes the shopping, the shopping changes the answer.

**These answers are never stale.** They are computed at read time from the pantry as it stands — buy
the eggs and the very next read says MAKEABLE. Nothing is remembered, so nothing can be wrong.

## Adding a household member

Their store, their sovereignty: they install this same bundle into THEIR store (steps above), then
federate — pull from each partner's store URL with a token the partner issued. Re-pull whenever
they want the latest; the lists converge because the ground is a union and the lens resolves it.
There is no primary copy and no account to share.

## What never to do

Never negate another author's deltas to "fix" the list — outsay them (`gotIt`, a fresh `needIt`).
Never put the pen seed on the ground — it lives in serve config only.
