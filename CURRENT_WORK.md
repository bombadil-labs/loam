# Current work — overhaul Loam against rhizomatic 0.3.0 (Option B vocabulary)

_Branch `rhizomatic-0.3.0-vocab`. rhizomatic 0.3.0 shipped the L5 vocabulary rename (issue #3),
**Option B** (full realignment, incl. L3 wire vocabulary → content addresses move). This is a
wide, mostly-mechanical churn; keep the existing behavior, just re-vocabularize + re-address._

## The rename (confirmed from the 0.3.0 export surface)

| old (0.2.0) | new (0.3.0) |
| --- | --- |
| `Policy` (the `{props, default}` map) | `Schema` |
| `PropPolicy` (per-field rule) | `Policy` |
| `parsePolicy` | `parseSchema` |
| `policyToJson` | `schemaToJson` |
| `SCHEMA_SCHEMA` | `HYPER_SCHEMA_SCHEMA` |
| L3 wire roles `rhizomatic.schema.*` | `rhizomatic.hyperschema.*` (TBC — confirm from PR) |
| `MaskPolicy`, the `mask` term's `"policy"` field | **UNCHANGED — do not touch** |

## Plan (staged, per Myk)

1. [x] Update the dep to `@bombadil/rhizomatic@0.3.0`; map the blast radius (54 typecheck errors +
       the wire-vocab ripple in `instruments.mjs`, packets, spike tests).
2. [ ] **Read the rhizomatic 0.3.0 PR** — confirm the exact new wire role strings, the
       `HYPER_SCHEMA_SCHEMA` name, and any behavior/JSON-shape changes beyond the pure rename.
3. [ ] **Plan the Loam edits** from what the PR says (finalize this checklist).
4. [ ] **Code changes + loop to green:**
   - Type/API sweep: `Policy`→`Schema`, `PropPolicy`→`Policy`, `parsePolicy`→`parseSchema`,
     `policyToJson`→`schemaToJson` across `src/` and `test/`. Avoid `MaskPolicy` / mask `policy`.
   - Wire-vocab: `SCHEMA_SCHEMA`→`HYPER_SCHEMA_SCHEMA`; update hardcoded L3 role strings in
     `demos/tutorial/instruments.mjs`, `test/site/instruments.test.ts`, and any Loam site that
     builds/reads them (check `src/gateway/registration.ts` — does it use rhizomatic's
     `publishSchemaClaims`, or hardcode roles?).
   - Regenerate committed fixtures: `scripts/gen-packets.mjs` (packets get new ids); fix any
     hardcoded `_hex`/id in tests. `demos/village/homes/**` is untracked — regenerated on run.
   - `npm run check` until green (read the counts).
5. [ ] **Demos functional:** run the tutorial site build + the village end-to-end; regenerate
       their disposable stores; verify live (tutorial in the browser).
6. [ ] **Docs everywhere:** SPEC.md prose (Policy/HyperSchema vocabulary), CLAUDE.md's
       "Match rhizomatic's vocabulary" standing rule (new names), README's model section, the
       tutorial/demos READMEs. Then PR → review → merge.

## Left off here

Dep bumped, surface mapped, branch open. **NEXT: read the rhizomatic 0.3.0 PR** (Myk to point at
it, or locate via `gh pr list --repo bombadil-labs/rhizomatic --state merged`) before touching code
— the new wire role strings must come from the PR, not a guess.
