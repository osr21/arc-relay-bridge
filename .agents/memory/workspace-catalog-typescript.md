---
name: Workspace catalog — no typescript entry
description: pnpm-workspace.yaml catalog has no typescript entry; new lib packages must use an explicit version
---

## Rule
The pnpm workspace catalog (`pnpm-workspace.yaml`) does NOT have a `typescript` catalog entry. Any `package.json` that writes `"typescript": "catalog:"` will cause `ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC` and block all installs.

**Why:** Root `package.json` has `typescript` as a direct devDependency at `~5.9.3`. The catalog only covers shared third-party deps (react, vite, tailwind, etc.) — not the TypeScript compiler itself.

**How to apply:**
- When creating a new `lib/*` package that needs TypeScript: use `"typescript": "~5.9.3"` explicitly.
- Do not add `typescript` to any package's `devDependencies` as `"catalog:"`.
