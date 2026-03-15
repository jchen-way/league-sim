---
name: Dead Code Cleanup
description: Use after refactors, feature removals, migrations, directory reorganizations, or requests to simplify the codebase to find and remove unreferenced, unused, obsolete, duplicated, or empty files, folders, exports, helpers, assets, and test artifacts without breaking real entrypoints or convention-based files.
---

# Dead Code Cleanup

Use this skill when the main goal is to remove stale code and reduce maintenance surface safely.

## Focus areas

- Unused components, hooks, utilities, modules, exports, constants, styles, and assets.
- Files and folders left behind after moves, renames, feature removals, or experiments.
- Duplicate implementations where one path clearly supersedes another.
- Empty directories and obsolete test data.

## Workflow

1. Search for references before proposing any removal. Prefer `rg` and `rg --files`.
2. Check whether each candidate is referenced dynamically, by framework convention, or by tooling config.
3. Remove only code that is provably unused or explicitly replaced.
4. Run available validation after cleanup: tests, lint, typecheck, and build.
5. Report what was removed and what remained ambiguous.

## Safety rules

- Do not delete entrypoints, generated roots, migrations, config files, or convention-based files without proof they are obsolete.
- Treat exported symbols as potentially public until references and package boundaries are checked.
- Leave code in place when the only evidence is "I could not find a reference" but dynamic resolution is plausible.
- Prefer small batches of removals with verification between them.

## Useful commands

```bash
rg --files
rg "from ['\\\"]|require\\("
rg "export "
find . -type d -empty
find . -type f -empty
```

Then run the repo's actual validation commands discovered from manifests and scripts.

## Output standard

- Files or folders removed and why they were safe to delete
- Validation performed
- Remaining ambiguous items that were intentionally kept
