# Quick Start

From nothing to a store Claude can reach, in four movements: install, init, funnel, connect.
Every `loam` command here is transcribed from the shipped code. The tailscale commands are the
standard recipe — your platform's install and login screens are your own.

## 1. Install

You need Node 24 or newer. Then:

```bash
npm i -g @bombadil/loam
```

That is the whole install. `better-sqlite3` ships prebuilt binaries for common platforms; if your
platform is uncommon, it compiles during install and wants a C toolchain.

## 2. A store of your own

Pick a directory and run, in a terminal:

```bash
loam init --home ~/loam
```

On a terminal, init is guided: it mints your store's operator identity, asks who you are (a
username), asks for a password twice with echo off, stocks the shelf — six ready schemas:
`person`, `org`, `event`, `note`, `post`, and the shallow person reading they nest — and prints
your next step. Scripting it instead? Every question has a flag:

```bash
loam init --home ~/loam --user ada --password-file ./secret --stock all
```

Skips are explicit and priced: `--no-user` leaves `/login` dark until `loam user create`;
`--no-stock` leaves the surface empty; `--stock person,event` selects (dependencies ride along).
A flagless `loam init` in a pipe stays the bare two-file init it always was.

## 3. Serve it

```bash
loam serve --http --home ~/loam --token <pick-a-secret>
```

The token is required — an unlockable door is a wall. Pick a long random string and keep it; it
is the operator's bearer key for the HTTP doors. The store serves on `127.0.0.1:4321` by default
(`--port` to choose); sign in at `http://127.0.0.1:4321/login` with the user you created.

Generate a good token in one line:

```bash
openssl rand -hex 16
```

## 4. Reach it from the world — tailscale funnel

claude.ai must reach your store over public HTTPS. Tailscale Funnel is the shortest honest path:
your machine gets a stable `https://<machine>.<tailnet>.ts.net` name, TLS included, no ports
forwarded, no reverse proxy to run.

With [tailscale](https://tailscale.com/download) installed and logged in (`tailscale up`):

```bash
tailscale funnel --bg 4321
```

The first run may print a link to enable HTTPS certificates and Funnel for your tailnet in the
admin console — follow it once. `tailscale funnel status` shows the public URL; it forwards
`https://<machine>.<tailnet>.ts.net` to your local port. Two cautions worth their sentences:
Funnel exposes that port to the whole internet — which is why the store's every door wants the
token or a login — and the funnel serves whatever runs on the port, so stop it
(`tailscale funnel --bg off` or reset) when the store is down.

## 5. Serve for the connector

Restart `loam serve` with two more flags, so OAuth knows its own public name and trusts
claude.ai's return path:

```bash
loam serve --http --home ~/loam --token <your-secret> --port 4321 \
  --public-url https://<machine>.<tailnet>.ts.net \
  --oauth-allow-redirect https://claude.ai
```

Check the door from anywhere:

```bash
curl https://<machine>.<tailnet>.ts.net/.well-known/oauth-authorization-server
```

A JSON answer naming your store as `issuer` means the world can find you.

## 6. Connect Claude

In claude.ai: **Settings → Connectors → Add custom connector.**

- **Name**: whatever you like.
- **URL**: `https://<machine>.<tailnet>.ts.net/default/mcp`
- **Authentication**: *Always required* (the dialog usually detects this).
- **OAuth client**: *Use Anthropic's hosted client metadata* — the recommended option; your store
  supports it, and it means reconnects reuse one client identity instead of minting orphans.

Press **Add**, sign in as your user when the store's login page appears, and consent. The consent
screen asks **where the connection lives**: pick a container under your name, or create one (a
first consent creates your home). That choice is the whole of the connection's reach — everything
Claude writes lands in that container's inbox, signed as Claude's own key, and everything Claude
reads is that container. Consent again to move it. That's the connection.

If a view answers suspiciously empty, ask for `loam_whoami` first — it says who the store thinks
the caller is, where the connection is bound, and its anonymous answer says in words that reads
are masked: an empty view for an unrecognized caller is not an empty store. If the connector shows
"no tools" outright, delete the connector entry entirely and add it fresh — a cached credential
from a previous store answers 401 until it is replaced. A connector that consented before
version 0.7 holds an older, store-wide grant that no door honors any more: delete it, add it
fresh, and consent again.

## 7. First conversation

Ask Claude to look around. Useful first moves:

- `loam_whoami` — who the door thinks the caller is, and what standing the ground grants. Call
  it first whenever a view answers empty; it tells "nothing here" apart from "not signed in."
- `loam_query` with `{ person(entity: "person:me") { name } }` — reading resolves through the
  store's schemas.
- Writing a person, then linking: `person(entity:, name:)` writes a field;
  `linkperson_follows(entity:, target:)` asserts a typed edge — references are edges, never
  strings.
- `loam_docs(topic: "first-steps")` — what makes this store different and six ways to use it
  today; `loam_docs(topic: "register-grammar")` is the full schema-definition manual, and
  `loam_docs()` lists everything the store can teach.

## When something refuses

Loam's refusals are written to be read — the sentence usually names the fix. The three most
common on day one: the serve token missing (the wall line above), a schema question answered by
`loam_docs`, and a CLI write against a running server, which prints a warning that the server
answers from the memory it booted with — restart the server and the write is seen.
