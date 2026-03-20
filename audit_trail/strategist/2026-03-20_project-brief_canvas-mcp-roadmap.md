# Project Brief: canvas-mcp Roadmap — Sections 1–3.2

**Brief type:** Project Brief
**Prepared by:** SoftwareScopeStrategist
**Date:** 2026-03-20
**Repo root:** `/Users/mark/Repos/personal/canvas-mcp`

**Scope window:** Sections 1 (Test Suite Restructuring), 2 (Template System Generalization), 3.1 (Eliminate Disk Sidecar), 3.2 (Server-Start Roster Pre-Fetch)
**Out of scope:** Sections 3.3, 4, 5

---

## Executive Summary

This project covers four workstreams across the canvas-mcp monorepo. Two are internal housekeeping (test structure and PII transport); two add user-facing capability (configurable template system and roster pre-fetch). All four are bounded and can be executed independently with one ordering constraint: Section 3.2 depends on the infrastructure established in 3.1 (or proceeds in parallel with a clearly-understood temporary interface if 3.1 is deferred).

---

## Module 1 — Test Suite Restructuring

**Specification document:** `TESTING.md`

### Description

Four independent, non-breaking reorganization tasks that correct the test suite's structural misalignments. No source logic changes; all changes are file moves, renames, and config updates.

### Boundaries

**In scope:**
- Add `packages/core/tests/unit/` with a `vitest.config.ts` and four test files: `secure-store.test.ts`, `sidecar-manager.test.ts`, `config-manager.test.ts`, `templates.test.ts`
- Move `packages/teacher/tests/unit/tools/context.test.ts` to `packages/core/tests/unit/tools/context.test.ts`
- Move all files under `tests/integration/` into `packages/teacher/tests/integration/`; rename `connectivity.test.ts` to `environment.test.ts`; consolidate the two vitest configs into `packages/teacher/vitest.integration.config.ts`; delete the root `tests/` directory
- Update root `package.json` `test:integration` script to point to `packages/teacher/vitest.integration.config.ts`
- Update the `describe` label in the renamed environment test

**Out of scope:**
- Changes to any source files under `src/`
- Adding tests beyond those specified in `TESTING.md`
- Changing the content of existing passing tests

### Interfaces

- **Exposes:** `packages/core/tests/unit/` as a new independently runnable test suite; `packages/teacher/vitest.integration.config.ts` as the new integration config entry point
- **Depends on:** `packages/core/src/security/secure-store.ts`, `packages/core/src/security/sidecar-manager.ts`, `packages/core/src/config/manager.ts`, `packages/core/src/templates/index.ts`, `packages/core/src/tools/context.ts` — all must be importable in a Vitest node environment without an MCP server
- **Shared infrastructure:** The existing `packages/teacher/tests/setup/msw-server.ts` pattern should be reused in the core vitest config. The `context.test.ts` file already imports and uses `McpServer` + `InMemoryTransport` — those packages are available as dependencies of `@canvas-mcp/core` and will be resolvable in the new location without change
- **Config alias:** `packages/core/vitest.config.ts` needs `resolve.alias` pointing `@canvas-mcp/core` at `packages/core/src/index.ts` (same pattern as teacher's config, just self-referential)

### Key Risks and Unknowns

1. **`integration-env.ts` uses `process.cwd()`** to resolve `.env.test`. After the move, `cwd` at test run time must still be the repo root (which it is when run from root via `npm run test:integration`). The path resolution will be correct. No change needed in the setup file itself.
2. **`sidecar-manager.test.ts` writes to a temp dir.** The spec is clear that `tmpdir()` is used to avoid touching the real sidecar path. This is correct behavior; no external state leaks.
3. **`context.test.ts` MSW dependency.** The test imports `msw-server` from the teacher's setup directory. After the move to core, either: (a) the test is updated to import from a relative path that will be at `../../setup/msw-server.ts` in the new core location (requiring the msw-server setup file to also be copied or shared), or (b) a separate `packages/core/tests/setup/msw-server.ts` is created. Option (b) is cleaner — core's test setup should be self-contained. This is a dependency that must be resolved during implementation.
4. **`packages/core/package.json` test script** currently reads `"test": "echo 'No unit tests in core yet'"`. It must be updated to `vitest run --config vitest.config.ts` matching the teacher pattern.

### Suggested Target Locations

```
packages/core/
  tests/
    unit/
      secure-store.test.ts          (new)
      sidecar-manager.test.ts       (new)
      config-manager.test.ts        (new)
      templates.test.ts             (new)
      tools/
        context.test.ts             (moved from packages/teacher/tests/unit/tools/)
    setup/
      msw-server.ts                 (new — copy of teacher's setup, core-local)
  vitest.config.ts                  (new)

packages/teacher/
  tests/
    setup/
      integration-env.ts            (moved from tests/setup/)
    integration/
      environment.test.ts           (moved + renamed from tests/integration/connectivity.test.ts)
      content.test.ts               (moved)
      context.test.ts               (moved)
      find.test.ts                  (moved)
      modules.test.ts               (moved)
      reporting.test.ts             (moved)
      reset.test.ts                 (moved)
  vitest.integration.config.ts      (new — replaces tests/vitest.config.ts)
```

Root `tests/` directory is deleted after all files are moved.

### Ordering Dependencies within Module 1

Tasks 1.1 and 1.3 have a hard dependency: `packages/core/tests/` must exist before `context.test.ts` can be moved there. Tasks 1.2 and 1.4 are parallel with 1.1/1.3 since they work in the `packages/teacher/` tree. All four can be done in one commit or sequenced as: (1.1 → 1.3), then (1.2 + 1.4).

---

## Module 2 — Template System Generalization

**Specification document:** `docs/TEMPLATE_SYSTEM_ROADMAP.md`

### Description

Replace the four hardcoded `renderTemplate` templates in `packages/core/src/templates/index.ts` with a user-editable file-based system. Introduces a `TemplateService` class, a JSON manifest format, Handlebars `.hbs` file rendering, and a `blueprint` / `manual` dual-mode `build_module` interface.

### Boundaries

**In scope:**
- New class `TemplateService` in `packages/core/src/templates/service.ts`: directory scanning, manifest parsing, version validation, Handlebars rendering with `for_each` support
- New directory `packages/core/src/templates/defaults/` containing JSON manifests and `.hbs` files for the four current templates (`later-standard`, `later-review`, `earlier-standard`, `earlier-review`)
- Seeding logic: on first run, copy defaults from `src/templates/defaults/` to `~/.config/mcp/canvas-mcp/templates/` if the directory does not already contain files
- Update `build_module` in `packages/teacher/src/tools/modules.ts`: replace `template` discriminant with `mode: 'blueprint' | 'manual'`
- Update `create_item`: add optional `template_name` / `template_data` fields
- Add `type: 'templates'` case to `list_items`
- Remove hardcoded scaffolding logic from `packages/core/src/templates/index.ts`
- Export `TemplateService` and relevant types from `packages/core/src/index.ts`

**Out of scope:**
- Nested `for_each` in v1 manifests (explicitly excluded in the spec)
- Loopback HTTP transport for templates
- Changes to `solution` and `clone` variants beyond what is specified (see Risks)

### Interfaces

- **Exposes:** `TemplateService` (class, exported from `@canvas-mcp/core`); updated `build_module`, `create_item`, `list_items` tool schemas; default template files on disk at `~/.config/mcp/canvas-mcp/templates/`
- **Depends on:** `handlebars` (already a dependency of `packages/core`); `ConfigManager` (for resolving the templates config path)
- **Breaking change:** The `build_module` schema change from `template: 'lesson' | 'solution' | 'clone'` to `mode: 'blueprint' | 'manual'` is a breaking MCP API change. Any existing tool call sequences using `template="lesson"` will stop working.

### Key Risks and Unknowns

1. **`solution` and `clone` modes.** The current `build_module` has three discriminants: `lesson`, `solution`, `clone`. The spec only defines `blueprint` and `manual` replacements for `lesson`. It does not address `solution` (unlock-gated modules) or `clone` (cross-course copy). Decision needed: (a) carry forward as additional `mode` values, (b) extract into separate tools, or (c) leave unchanged. Option (c) is safest for avoiding scope creep.
2. **Seeding strategy.** "Copy defaults on first run, never overwrite user-customized files." The check is `!existsSync(templatesDir) || readdirSync(templatesDir).length === 0`.
3. **`TemplateService` location.** `src/templates/service.ts` keeps the templates concern co-located; `src/config/templates.ts` follows the spec suggestion. Either is defensible.
4. **`list_items` tool location.** Appears to live in `packages/teacher/src/tools/find.ts` — verify before implementation.
5. **Handlebars compilation caching.** `TemplateService` should compile `.hbs` files once at construction and cache the result to avoid re-reading disk on every `build_module` call.
6. **`dry_run` mode for `blueprint`.** `TemplateService.render()` must return `RenderableItem[]` so the existing `dry_run` guard in the tool handler continues to work unchanged.

### Suggested Target Locations

```
packages/core/
  src/
    templates/
      index.ts                  (gutted — remove hardcoded logic, re-export TemplateService)
      service.ts                (new — TemplateService class)
      defaults/
        later-standard/
          manifest.json
          assignment.hbs
          overview.hbs
        later-review/           (similar structure)
        earlier-standard/       (similar structure)
        earlier-review/         (similar structure)

packages/teacher/
  src/
    tools/
      modules.ts                (updated — build_module schema + blueprint/manual handler)
      content.ts                (updated — create_item template fields)
      find.ts                   (updated — list_items type='templates' case)
```

### Ordering Dependencies within Module 2

2.1 → 2.2 → (2.3, 2.4, 2.5 in parallel) → 2.6. Task 2.6 is last because it removes the existing implementation that `build_module` still depends on until 2.3 lands.

---

## Module 3.1 — Eliminate the Disk Sidecar (Volatile Memory Only)

**Specification document:** `docs/PII_ARCHITECTURE.md` §5–6 and `ROADMAP.md` §3.1

### Description

Replace `SidecarManager` (which writes a plaintext `pii_session.json` to disk) with a `PiiServer` class that exposes the live token→name mapping over a Unix domain socket. Gemini CLI hooks authenticate with a per-session bearer token stored in a non-PII coordination file. No PII ever touches disk.

### Boundaries

**In scope:**
- New class `PiiServer` in `packages/core/src/security/pii-server.ts` — creates a Unix domain socket at `~/.cache/canvas-mcp/pii-<sessionId>.sock`, implements a simple JSON request/response protocol, handles token auth, removes socket file on process exit
- Coordination file writer: writes `~/.cache/canvas-mcp/session.json` with `{ socketPath, token }` (no PII) on startup
- Update `packages/teacher/src/index.ts` — replace `SidecarManager` with `PiiServer`; update the `cleanup` handler
- Update `packages/core/src/index.ts` — export `PiiServer`, deprecate/remove `SidecarManager` export
- Update config schema — replace `privacy.sidecarPath` with a socket-path config field (or derive from cache dir + session ID)
- Update `clients/gemini/src/before_model.ts` and `after_model.ts` — replace file-read of `pii_session.json` with socket request
- Update `packages/teacher/src/tools/reporting.ts` — `sidecarManager?.sync(store)` becomes `piiServer?.notify(store)` or is removed
- Graceful no-op fallback in hooks: if socket unavailable (timeout 2s), return `{}` as today when sidecar file is absent

**Out of scope:**
- `SecureStore` changes (explicitly unchanged per spec)
- Changes to the blinding logic in `registerReportingTools`
- TCP/loopback HTTP (explicitly rejected)

### Interfaces

- **Exposes:** `PiiServer` class (exported from `@canvas-mcp/core`); `~/.cache/canvas-mcp/session.json` coordination file; Unix domain socket at path in `session.json`
- **Depends on:** `node:net` (built-in) for Unix socket server; `SecureStore.listTokens()` and `SecureStore.resolve()` on each request; `node:crypto` for UUID bearer token generation
- **IPC protocol:** Hooks send `{ token: "uuid" }`; server responds with `{ mapping: { "[STUDENT_001]": "Jane Doe", ... } }`. 2-second timeout in hooks.
- **Breaking change for hooks:** Hook scripts must be recompiled after this change.

### Key Risks and Unknowns

1. **Multiple concurrent instances.** `session.json` at a fixed path will still be overwritten by the most recent instance — same limitation as the current sidecar. Hooks connect to whichever server wrote last. Acceptable per spec.
2. **Hook timeout handling.** `node:net` is async-first; use `Promise.race()` with a timeout. The hook `main()` is already `async` so this is manageable.
3. **Socket cleanup on abnormal exit.** The existing `SIGINT`/`SIGTERM`/`SIGHUP`/`uncaughtException` cleanup handler must call `piiServer.close()` instead of `sidecarManager.purge()`. Both the socket file and `session.json` must be removed.
4. **`pii_buffer.txt` in `after_model.ts`.** Buffer file for tokens split across streaming chunks — not PII, not changed by this module.
5. **Config schema migration.** `privacy.sidecarPath` in `DEFAULT_CONFIG` can be deprecated and removed. Existing user configs with this key will silently ignore it via deep merge.
6. **`reporting.ts` `blindedResponse` helper.** `sidecarManager?.sync(store)` call goes away because `PiiServer` serves live data on demand. The stderr notification should be retained or adapted.

### Suggested Target Locations

```
packages/core/
  src/
    security/
      pii-server.ts             (new — PiiServer class)
      sidecar-manager.ts        (deprecated or removed)

packages/teacher/
  src/
    index.ts                    (updated — PiiServer replaces SidecarManager)
    tools/
      reporting.ts              (updated — sidecarManager param removed or replaced)

clients/gemini/
  src/
    before_model.ts             (updated — socket read instead of file read)
    after_model.ts              (updated — socket read instead of file read)
```

---

## Module 3.2 — Server-Start Roster Pre-Fetch

**Specification document:** `ROADMAP.md` §3.2, `docs/PII_ARCHITECTURE.md` §5.2, §6

### Description

On startup, when `blindingEnabled` is true and an `activeCourseId` is set, silently fetch the course enrollment list and populate `SecureStore`. Eliminates the first-message blindspot where a user types a student name before any Canvas tool has run.

### Boundaries

**In scope:**
- In `packages/teacher/src/index.ts`, after `SecureStore` and `CanvasClient` are initialized and `config` is read: if `config.privacy.blindingEnabled && config.program.activeCourseId !== null`, call `fetchStudentEnrollments(client, activeCourseId)` and tokenize each result via `secureStore.tokenize(enrollment.user_id, enrollment.user.name)`
- If pre-3.1: after tokenization, call `sidecarManager.sync(secureStore)`. If post-3.1: no explicit action needed.
- Non-blocking: fire-and-forget (`void rosterPrefetch().catch(...)`) to avoid delaying `McpServer.connect()`
- Stderr log on completion: `[canvas-mcp] Pre-fetched N students into SecureStore.`
- Graceful failure: log error to stderr and continue — this is best-effort

**Out of scope:**
- Periodic re-fetch during server lifetime
- Pre-fetching when no active course is set

### Interfaces

- **Depends on:** `fetchStudentEnrollments` from `packages/core/src/canvas/submissions.ts` (already exported); `SecureStore.tokenize()` (unchanged); `SidecarManager.sync()` (pre-3.1) or `PiiServer` (post-3.1)
- **No new exports required** — implementation change inside `packages/teacher/src/index.ts` only

### Key Risks and Unknowns

1. **Ordering with 3.1.** If implemented before 3.1, the pre-fetch calls `sidecarManager.sync(secureStore)`. When 3.1 lands, this sync call must be removed. Minor coordination point, not a blocker.
2. **Fire-and-forget vs. await.** `fetchStudentEnrollments` follows pagination and can involve multiple HTTP requests for large courses. Fire-and-forget is preferred per the spec's "silently" framing, with the narrow window at startup being acceptable.
3. **`fetchStudentEnrollments` pagination.** `CanvasClient.get<T>()` auto-paginates. For large courses, this can take several seconds — acceptable for background fetch.

### Suggested Target Locations

```
packages/teacher/
  src/
    index.ts                    (updated — add pre-fetch logic after config read)
```

No other files change for 3.2.

---

## Cross-Module Ordering Dependencies

```
1.x — No dependencies on any other module. Execute first (or in parallel with others).
2.x — No dependencies on 1.x, 3.x. Can be executed in parallel with 1.x.
3.1 — No dependencies on 1.x or 2.x. Substantial standalone engineering effort.
3.2 — Soft dependency on 3.1. Safe to implement before 3.1 using the sidecar interface;
       update the sync call when 3.1 lands.
```

**Recommended sequencing for a solo developer:**
1. **1.x** — Low risk, no functional changes, improves feedback for subsequent modules
2. **2.x** — High-value user-facing feature; independent of PII work
3. **3.2** — Small, well-bounded; can be done before or after 3.1
4. **3.1** — Most complex; best tackled last with a complete test suite in place

---

## Summary Table

| Section | Module Name | Complexity | Files Changed | Dependencies |
|---------|-------------|------------|---------------|--------------|
| 1.1–1.4 | Test Suite Restructuring | Low | ~10 file moves/creates | None |
| 2.1–2.6 | Template System Generalization | High | ~15 new + 3 modified | None |
| 3.1 | Eliminate Disk Sidecar | High | ~6 modified + 1 new | None (3.2 adapts to 3.1) |
| 3.2 | Server-Start Roster Pre-Fetch | Low | 1 modified | Soft dep on 3.1 |

---

## Critical Files for Implementation

- `packages/teacher/src/index.ts` — Server startup entrypoint; all PII modules (3.1, 3.2) and tool wiring for Section 2 changes flow through here
- `packages/core/src/security/sidecar-manager.ts` — The class being replaced by Section 3.1; its interface defines the `PiiServer` drop-in shape
- `packages/teacher/src/tools/modules.ts` — Core target for Section 2's `build_module` schema change; largest single-file change in the project
- `packages/core/src/templates/index.ts` — The hardcoded template logic to be extracted and generalized in Section 2; defines `RenderableItem` types that `TemplateService` must continue to produce
- `tests/vitest.config.ts` — The integration test config that must be migrated to `packages/teacher/vitest.integration.config.ts` in Section 1.2
