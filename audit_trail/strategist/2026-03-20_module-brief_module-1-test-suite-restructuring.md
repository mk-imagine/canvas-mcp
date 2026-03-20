# Module Brief: Module 1 — Test Suite Restructuring

**Brief type:** Module Brief
**Prepared by:** SoftwareScopeStrategist
**Date:** 2026-03-20
**Module:** 1 of canvas-mcp Roadmap
**Specification:** `TESTING.md`
**Status:** Ready for Tactician

---

## Preamble: Codebase Verification Findings

All files specified in the Project Brief were read. The following observations update or confirm the brief's risk notes:

**Confirmed accurate:**
- Seven integration test files exist in `tests/integration/`: `connectivity.test.ts`, `content.test.ts`, `context.test.ts`, `find.test.ts`, `modules.test.ts`, `reporting.test.ts`, `reset.test.ts`
- `packages/core/package.json` test script is exactly `"echo 'No unit tests in core yet'"`
- `integration-env.ts` uses `process.cwd()` — safe after move since root-invoked `npm run test:integration` keeps cwd at repo root
- `context.test.ts` import line 10: `import { server as mswServer } from '../../setup/msw-server.js'` — relative path that breaks after the move to `packages/core/tests/unit/tools/`

**New finding — critical:** `msw` is a devDependency of `packages/teacher` but is absent from `packages/core/package.json`. The new `packages/core/tests/setup/msw-server.ts` and the moved `context.test.ts` both require `msw`. It must be added to `packages/core`'s devDependencies. This was not called out in the Project Brief.

**New finding — alias path:** The teacher `vitest.config.ts` alias is `'../core/src/index.ts'` (relative to `packages/teacher/`). Core's self-referential alias will be `'./src/index.ts'` (relative to `packages/core/`).

**New finding — `context.test.ts` MSW import path after move:** After moving to `packages/core/tests/unit/tools/context.test.ts`, the relative import `../../setup/msw-server.js` resolves to `packages/core/tests/setup/msw-server.ts` — which is exactly the new core-local setup file. The import path does not need to change. Option (b) from the Project Brief (create a separate core-local msw-server.ts) is confirmed correct and the import path happens to already be right.

---

## Task Breakdown

### Task 1.1 — Create `packages/core` Test Infrastructure

**What changes:**
- New file: `packages/core/vitest.config.ts`
- New file: `packages/core/tests/setup/msw-server.ts`
- Modified: `packages/core/package.json` — two changes: (a) update `"test"` script; (b) add `"msw": "^2.0.0"` to devDependencies
- New directory structure created: `packages/core/tests/unit/tools/` and `packages/core/tests/setup/`

**Details:**

`packages/core/vitest.config.ts` — modeled on `packages/teacher/vitest.config.ts` with these differences:
- `resolve.alias` value: `fileURLToPath(new URL('./src/index.ts', import.meta.url))` (self-referential, not `../core/...`)
- `test.include`: `['tests/unit/**/*.test.ts']`
- `test.setupFiles`: `['tests/setup/msw-server.ts']`
- `coverage.exclude`: replace `'packages/core/**'` with `'packages/teacher/**'` (the inverse exclusion)
- Coverage `reportsDirectory`: `'./coverage/unit'`

`packages/core/tests/setup/msw-server.ts` — exact copy of `packages/teacher/tests/setup/msw-server.ts` (4 lines, identical content):
```typescript
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll } from 'vitest'
export const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

`packages/core/package.json` script update: `"test": "node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts"` — mirrors the teacher pattern exactly.

`packages/core/package.json` devDependency addition: `"msw": "^2.0.0"` — required by the new msw-server.ts setup file and by context.test.ts. Since this is a workspace monorepo with a flat `node_modules`, the package is already installed (teacher depends on it); the addition to `package.json` makes the dependency explicit for tooling and future installs.

**Acceptance criteria:**
- `packages/core/vitest.config.ts` exists and is syntactically valid TypeScript
- `packages/core/tests/setup/msw-server.ts` exists
- `packages/core/package.json` `"test"` script invokes vitest (not the echo stub)
- `packages/core/package.json` lists `"msw"` under devDependencies
- Running `npm run test -w packages/core` with no test files present exits 0 (vitest exits 0 when no files match)

**Depends on:** Nothing. This task is the prerequisite for 1.3.

---

### Task 1.2 — Move Integration Tests into `packages/teacher`

**What changes:**
- New file: `packages/teacher/vitest.integration.config.ts` (replaces `tests/vitest.config.ts`)
- Moved: `tests/setup/integration-env.ts` → `packages/teacher/tests/setup/integration-env.ts`
- Moved + renamed: `tests/integration/connectivity.test.ts` → `packages/teacher/tests/integration/environment.test.ts`
- Moved (no rename): `tests/integration/content.test.ts` → `packages/teacher/tests/integration/content.test.ts`
- Moved (no rename): `tests/integration/context.test.ts` → `packages/teacher/tests/integration/context.test.ts`
- Moved (no rename): `tests/integration/find.test.ts` → `packages/teacher/tests/integration/find.test.ts`
- Moved (no rename): `tests/integration/modules.test.ts` → `packages/teacher/tests/integration/modules.test.ts`
- Moved (no rename): `tests/integration/reporting.test.ts` → `packages/teacher/tests/integration/reporting.test.ts`
- Moved (no rename): `tests/integration/reset.test.ts` → `packages/teacher/tests/integration/reset.test.ts`
- Deleted: root `tests/` directory (after all contents moved)
- Modified: root `package.json` — `test:integration` and `test:integration:coverage` scripts updated

**Details:**

`packages/teacher/vitest.integration.config.ts` — derived from `tests/vitest.config.ts` with these path updates:
- `resolve.alias` value: `fileURLToPath(new URL('../core/src/index.ts', import.meta.url))` — same relative path as the teacher unit config since the file is at the same directory level (`packages/teacher/`)
- `test.include`: `['tests/integration/**/*.test.ts']` — unchanged (path is relative to the config file's location, which is now `packages/teacher/`, so this resolves to `packages/teacher/tests/integration/**`)
- `test.setupFiles`: `['tests/setup/integration-env.ts']` — unchanged (same relative logic)
- `coverage.reportsDirectory`: keep `'./coverage/integration'`; coverage output lands in `packages/teacher/coverage/integration/`

Root `package.json` script changes:
- `"test:integration"`: change `--config tests/vitest.config.ts` to `--config packages/teacher/vitest.integration.config.ts`
- `"test:integration:coverage"`: same path update

`integration-env.ts` content is unchanged. The `process.cwd()` call resolves from whichever directory the process was started in — when invoked via `npm run test:integration` from the repo root, cwd is the repo root, so `.env.test` resolution is correct. No content edits required.

**Acceptance criteria:**
- `packages/teacher/tests/integration/` contains exactly 7 files: `environment.test.ts`, `content.test.ts`, `context.test.ts`, `find.test.ts`, `modules.test.ts`, `reporting.test.ts`, `reset.test.ts`
- `packages/teacher/tests/setup/integration-env.ts` exists
- `packages/teacher/vitest.integration.config.ts` exists
- Root `tests/` directory does not exist
- Root `package.json` `test:integration` script references `packages/teacher/vitest.integration.config.ts`
- `npm run test:integration` from repo root runs integration tests (with valid `.env.test`)

**Depends on:** Nothing. Parallel with 1.1 and 1.4.

---

### Task 1.3 — Move `context.test.ts` from Teacher to Core

**What changes:**
- Moved: `packages/teacher/tests/unit/tools/context.test.ts` → `packages/core/tests/unit/tools/context.test.ts`
- File content is unchanged.

**Details:**

No content edits are needed in the test file itself. The MSW import `../../setup/msw-server.js` resolves correctly in the new location:
- From `packages/core/tests/unit/tools/context.test.ts`, the path `../../setup/msw-server.js` navigates up two directories to `packages/core/tests/` and then into `setup/msw-server.ts` — correct.
- All imports (`@modelcontextprotocol/sdk`, `@canvas-mcp/core`, `vitest`, `msw`, `node:*`) are resolvable from core's devDependencies and dependencies.
- `McpServer`, `Client`, `InMemoryTransport` are in `@modelcontextprotocol/sdk` which is a production dependency of core — available.

**Acceptance criteria:**
- `packages/core/tests/unit/tools/context.test.ts` exists (content byte-for-byte identical to the source)
- `packages/teacher/tests/unit/tools/context.test.ts` does not exist
- `npm run test -w packages/core` runs the context test and it passes
- `npm run test -w packages/teacher` no longer includes the context test

**Depends on:** Task 1.1 (the `packages/core/tests/` directory and vitest config must exist first).

---

### Task 1.4 — Update Describe Label in `environment.test.ts`

**What changes:**
- One content edit within `packages/teacher/tests/integration/environment.test.ts` (after the move in Task 1.2)

**Details:**

Current line:
```typescript
describe('Pre-Phase B: Canvas API connectivity', () => {
```

Updated line:
```typescript
describe('Test environment: Canvas API connectivity and permissions', () => {
```

The block comment at the top of the file is left unchanged (Project Brief specifies only the `describe` label).

**Acceptance criteria:**
- `packages/teacher/tests/integration/environment.test.ts` describe block reads `'Test environment: Canvas API connectivity and permissions'`
- No other content in the file is changed
- The test passes when run against a valid Canvas sandbox

**Depends on:** Task 1.2 (the file must be moved/renamed first). In practice this is a sub-step of 1.2 — do the rename and label update in a single operation.

---

## Ordering and Dependency Graph

```
1.1 (core infrastructure)
  |
  v
1.3 (move context.test.ts to core)

1.2 (move integration tests) ──── 1.4 (rename + update describe label)
                                   [1.4 is a sub-step of 1.2, not separate]
```

**Sequential constraint:** 1.3 must follow 1.1. All other tasks are independent.

**Recommended commit sequence (two commits):**
- Commit A: 1.1 + 1.3 — creates core test infrastructure and immediately populates it with the moved test
- Commit B: 1.2 + 1.4 — moves integration tests, renames connectivity test, updates describe label, updates root package.json scripts, deletes root `tests/` directory

---

## Risks: Resolved Status

| Risk from Project Brief | Status | Resolution |
|---|---|---|
| `integration-env.ts` uses `process.cwd()` | Confirmed safe | Verified: `config({ path: resolve(process.cwd(), '.env.test') })`. cwd remains repo root when invoked via `npm run test:integration`. No change needed. |
| `sidecar-manager.test.ts` writes to temp dir | Non-issue | TESTING.md specifies `tmpdir()` explicitly. Correct behavior by spec. |
| `context.test.ts` MSW dependency | Resolved via option (b) | The existing relative import `../../setup/msw-server.js` resolves to `packages/core/tests/setup/msw-server.ts` in the new location. A new core-local `msw-server.ts` satisfies this without any import path change. |
| `packages/core/package.json` test script | Confirmed needs update | Current value is exactly `"echo 'No unit tests in core yet'"`. Replaced in Task 1.1. |

**New risk (not in Project Brief):**

`msw` is absent from `packages/core/package.json` devDependencies. The new `msw-server.ts` and moved `context.test.ts` both import from `msw/node`. In a hoisted workspace `node_modules` this works at runtime today, but the missing declaration is a correctness issue for isolated installs or CI. Added to `packages/core/package.json` devDependencies as part of Task 1.1.

---

## New Test Files: Spec Reference

The four new test files (`secure-store.test.ts`, `sidecar-manager.test.ts`, `config-manager.test.ts`, `templates.test.ts`) are written from scratch per the TESTING.md specifications. TESTING.md sections 2.1–2.4 are the complete and authoritative spec — no decisions deferred.

---

## Ready for Tactician Checklist

- [x] All files to be created are specified with exact paths and content requirements
- [x] All files to be moved are enumerated (7 integration files, 1 unit file, 1 setup file)
- [x] All files to be deleted are identified (root `tests/` directory and contents)
- [x] All content edits are identified and quoted (describe label in `environment.test.ts`; test scripts in root `package.json` and `packages/core/package.json`)
- [x] MSW dependency gap in `packages/core/package.json` identified and resolution specified (Task 1.1)
- [x] `context.test.ts` import path verified correct after move (no edit needed)
- [x] `integration-env.ts` path resolution verified safe (no edit needed)
- [x] `packages/core/vitest.config.ts` alias path specified (`'./src/index.ts'`, self-referential)
- [x] Ordering constraint between 1.1 and 1.3 documented
- [x] All acceptance criteria are observable and testable
- [x] No source files under `src/` are touched
- [x] No new test logic beyond TESTING.md specification is introduced

---

## Critical Files for Implementation

| File | Role |
|---|---|
| `packages/core/package.json` | Add `msw` devDependency + update test script (Task 1.1) |
| `packages/teacher/vitest.config.ts` | Reference pattern for new `packages/core/vitest.config.ts` |
| `tests/vitest.config.ts` | Source config migrated into `packages/teacher/vitest.integration.config.ts` (then deleted) |
| `packages/teacher/tests/unit/tools/context.test.ts` | Moved to core; import on line 10 resolves correctly without edits |
| `package.json` (root) | `test:integration` + `test:integration:coverage` scripts updated (Task 1.2) |
| `packages/teacher/tests/setup/msw-server.ts` | Copied verbatim to `packages/core/tests/setup/msw-server.ts` (Task 1.1) |
