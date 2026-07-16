## 2026-07-10 — v0.0.1: the first release, tokenless (PRs #24–#28)

The publish button was pressed. The bootstrap rode npm's own chicken-and-egg: a trusted
publisher can only be configured on a package that exists, so `0.0.0` was published locally by
Myk (its only job: to exist), the trusted publisher was configured, and `npm run release --
patch` minted v0.0.1 through the workflow — **no token anywhere**: OIDC verifies the repo and
workflow identity, and the registry holds a SLSA provenance attestation for the tarball. The
NPM_TOKEN secret is deleted; the granular token revoked.

Getting there took four plumbing fixes in one evening, each its own lesson:

- **npm 12 became `latest` mid-release** and made dependency install scripts opt-in — the
  workflow's `npm install -g npm@latest` walked straight into it (better-sqlite3's prebuild
  blocked; no native binding; sqlite tests red). The durable answer is npm 12's own posture:
  an `allowScripts` allowlist in package.json, version-pinned to our two native deps.
- **`npm pack --json` changed shape in npm 12** — an object keyed by package name, not a
  one-element array. First fix guessed the shape and the runner disproved it; the second fix
  read npm's source (`output.buffer({ [key]: tarball })`). Validate against the executor —
  the repo already knew this lesson; now it has paid for it twice.
- **npm must never upgrade itself in place**: `npm install -g npm@12` into the toolcache left
  a mangled tree that died at publish on a missing `sigstore`. Node 24's BUNDLED npm (11.16)
  speaks OIDC natively; the global-npm step is deleted. The bundled npm is the one npm that
  is never half-installed.
- **npm's trusted publisher form has a required "Allowed actions" checkbox** (newer than its
  own docs): without "Allow npm publish" ticked, the connection never saves, and the failure
  surfaces as a bare ENEEDAUTH at the token exchange. npm warns that it validates nothing at
  save; believe it.

Also this evening: an `npm install` aimed at the scratchpad walked up the directory tree into
the user's HOME package.json (the claude install lives there) and modified it. Caught by the
"where did node_modules actually land" check, reverted cleanly. A `cd` into a bare directory
is not a project boundary; npm hunts upward.
