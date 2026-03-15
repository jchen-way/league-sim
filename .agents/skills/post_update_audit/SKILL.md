---
name: Post-Update Audit
description: Run after large feature updates, refactors, migrations, or broad edits to scan the codebase for bugs, regressions, vulnerabilities, race conditions, mismatches, misalignments, dead code, unused files, and empty folders, then clean up safe removals and verify the project still passes its available checks.
---

# Post-Update Audit

Use this skill after substantial code changes. The goal is to do a skeptical cleanup pass, not a cosmetic review.

## What to inspect

Focus on high-signal risks first:

- Broken imports, exports, routes, types, interfaces, schemas, env usage, and API contracts.
- State mismatches between frontend, backend, storage, and tests.
- Race conditions, stale async flows, missing awaits, double-submits, and cleanup leaks.
- Security issues such as unchecked input paths, secrets in code, auth gaps, unsafe eval/HTML injection, weak validation, and overbroad permissions.
- Dead code such as unused helpers, components, hooks, constants, assets, folders, feature flags, and obsolete test fixtures.
- Empty directories and files left behind by refactors.

## Workflow

1. Inspect the changed area and surrounding call sites before deleting anything.
2. Search broadly with fast text tools first. Prefer `rg` and `rg --files`.
3. Run the strongest available local checks for the repo:
   - Tests
   - Lint
   - Typecheck
   - Build
   - Security or dependency audit commands if the repo already uses them
4. Fix real issues or remove code that is clearly unreferenced and unnecessary.
5. Re-run relevant validation after edits.
6. Report:
   - Findings fixed
   - Risks left unresolved
   - Checks run and their results

## Deletion rules

Only remove code or folders when at least one of these is true:

- Search shows no references and the item is not an entrypoint, config file, generated output root, or convention-based file.
- The code path is fully replaced by a new implementation in the same change.
- The folder is empty and not intentionally reserved by project tooling.

Do not remove something just because usage is non-obvious. Check for:

- Dynamic imports
- Framework file conventions
- String-based references
- CI, deployment, or tooling config references
- Documentation or scripts that are still part of the workflow

## Heuristics

- Treat unused exported code as suspicious, not automatically removable.
- If two layers disagree, prefer the source of truth closest to runtime behavior.
- When a change spans async state, storage, and UI, assume regressions until validated.
- Prefer minimal, provable removals over large speculative cleanup.
- If the repo lacks automated checks, perform manual search-based validation and state the gap clearly.

## Useful commands

Start with commands like these and adapt to the project:

```bash
rg "TODO|FIXME|HACK"
rg --files
rg "import|require|from " src test app lib
find . -type d -empty
```

Then run the repo's actual validation commands discovered from its manifests and scripts.

## Output standard

Keep the final audit summary short and concrete:

- Critical issues found or confirmed absent
- Code removed and why it was safe
- Validation performed
- Remaining uncertainty
