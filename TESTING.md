# Testing Strategy: Monorepo Test Organization

This document describes the test suite structure for the `canvas-mcp` monorepo and records the issues that were addressed to reach it.

**Status legend:** `[x]` complete

## 1. Overview

The test suite covers both `packages/core` (shared library) and `packages/teacher` (MCP server) with unit and integration tests.

### Issues Addressed

1. **`[x]` `packages/core` had no tests** — added `packages/core/tests/unit/` covering config, templates, attendance matching, CSV parsing, Levenshtein, context tools, and submissions (10 test files). `SecureStore` and `SidecarManager` do not yet have dedicated tests.
2. **`[x]` Integration tests lived at the repo root** — moved `tests/integration/` into `packages/teacher/tests/integration/` and consolidated vitest configs.
3. **`[x]` `context.test.ts` tested a core-package function** but lived in teacher's unit tree — moved to `packages/core/tests/unit/tools/`.
4. **`[x]` `connectivity.test.ts` was a one-off environment check** with a misleading name — renamed to `environment.test.ts`.

---

## 2. Current Test Structure

```
packages/
  core/
    tests/
      fixtures/
        zoom-report-sample.csv
      unit/
        attendance/
          name-matcher.test.ts      # matchAttendance, stripPronouns, bestDistance
          review-file.test.ts       # attendance review file generation
          zoom-csv-parser.test.ts   # Zoom CSV parsing, pronoun handling, host filtering
          zoom-name-map.test.ts     # persistent Zoom→Canvas name mapping
        canvas/
          submissions.test.ts       # submission data helpers
        config/
          manager.test.ts           # ConfigManager deep merge, validation, migration
          schema.test.ts            # config schema validation
        matching/
          levenshtein.test.ts       # Levenshtein distance function
        templates/
          service.test.ts           # TemplateService directory scanning, rendering
        tools/
          context.test.ts           # registerContextTools (core export, tested via MCP protocol)
    vitest.config.ts
  teacher/
    tests/
      setup/
        msw-server.ts              # MSW mock server (unit tests)
        integration-env.ts         # integration test environment setup
      unit/
        tools/
          attendance.test.ts       # import_attendance tool (parse/submit actions)
          content.test.ts          # content management tools
          find.test.ts             # find_item tool
          modules.test.ts          # build_module tool
          reporting.test.ts        # get_grades, get_submission_status
          reset.test.ts            # reset_course tool
      integration/
        attendance.test.ts         # attendance import end-to-end (dedicated seed assignment)
        content.test.ts            # content CRUD
        context.test.ts            # context tools
        environment.test.ts        # Canvas API connectivity and permissions check
        find.test.ts               # find_item
        modules.test.ts            # module building
        reporting.test.ts          # grades and submissions
        reset.test.ts              # course reset (runs seed in afterAll)
    vitest.config.ts               # unit tests
    vitest.integration.config.ts   # integration tests
```

---

## 3. Running Tests

```bash
# All unit tests (no credentials required)
npm run test:unit

# All integration tests (requires .env.test)
npm run test:integration

# Single unit test file
cd packages/teacher && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/tools/find.test.ts

# Single integration test file
cd packages/teacher && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/attendance.test.ts
```

---

## 4. Unit Tests

### `packages/core` (10 test files)

No HTTP mocking needed — all units are pure functions or use `tmpdir()` for filesystem isolation.

- **`attendance/name-matcher.test.ts`** — Tests the 4-step matching pipeline (persistent map → exact → fuzzy → unmatched), pronoun stripping, part-to-part Levenshtein with full-string tiebreaker, ambiguous tie detection, and candidate generation for unmatched entries.
- **`attendance/zoom-csv-parser.test.ts`** — Standard CSV parsing, BOM/CRLF handling, original name extraction, host filtering (case-insensitive, rejoin rows), pronoun detection (`he/him`, `she/her/ella`, `they/them`), and a real Zoom fixture test for duplicate column resolution.
- **`attendance/review-file.test.ts`** — Review file JSON generation from match results.
- **`attendance/zoom-name-map.test.ts`** — Persistent Zoom→Canvas name map read/write/lookup.
- **`canvas/submissions.test.ts`** — Submission data helpers.
- **`config/manager.test.ts`** — Deep merge with `DEFAULT_CONFIG`, `~` expansion, credential validation errors, privacy migration, `write()` and `update()` roundtrips.
- **`config/schema.test.ts`** — Config schema validation.
- **`matching/levenshtein.test.ts`** — Levenshtein edit distance: identical strings, insertions, deletions, substitutions, case sensitivity, empty strings, Unicode.
- **`templates/service.test.ts`** — Template directory scanning, manifest parsing, Handlebars rendering.
- **`tools/context.test.ts`** — `registerContextTools` tested via `McpServer` + `InMemoryTransport` + `Client` stack.

### `packages/teacher` (6 unit test files)

All HTTP is mocked via MSW (`msw-server.ts` with `onUnhandledRequest: 'error'`). Each file corresponds to a source file in `packages/teacher/src/tools/`.

- **`attendance.test.ts`** — `import_attendance` parse and submit actions, blinded output, `WeakMap`-scoped parse state.
- **`content.test.ts`** — Content management tools.
- **`find.test.ts`** — `find_item` tool.
- **`modules.test.ts`** — `build_module` tool.
- **`reporting.test.ts`** — `get_grades`, `get_submission_status` with PII blinding.
- **`reset.test.ts`** — `reset_course` dry-run and confirmation flow.

---

## 5. Integration Tests

Integration tests require a `.env.test` file at the project root with:

```
CANVAS_INSTANCE_URL=https://your-instance.instructure.com
CANVAS_API_TOKEN=your-api-token
CANVAS_TEST_COURSE_ID=12345
CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID=67890
```

Use a free Canvas sandbox (`canvas.instructure.com`). The attendance assignment ID is created by `npm run seed` and written to `.env.test`.

Tests run **sequentially** (`fileParallelism: false`) because they share Canvas state. `reset.test.ts` runs `npm run seed` in `afterAll` to restore the course after destructive operations.

### Attendance integration tests

`attendance.test.ts` uses a dedicated seed assignment (`CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID`) separate from other tests to avoid grade conflicts. Key behaviors tested:

- Parse action with roster matching and blinded output
- Submit action with grade posting and dry-run support
- Grade restoration in `afterAll` (skips PUT for null grades)
- PII blinding — no real student names in assertion messages
- Name-map re-parse workflow (parse → save map → re-parse → verify `source: 'map'`)
- `min_duration` filtering (participants below threshold excluded from matches)

### Vitest config note

`vitest.integration.config.ts` sets `root: fileURLToPath(new URL('.', import.meta.url))` so that `include` paths resolve relative to `packages/teacher/`, not the repo root. Without this, `npm run test:integration` from the repo root fails to discover test files.

---

## 6. Remaining Test Gaps

- **`SecureStore`** — AES-256-GCM encryption, token issuance, counter stability, zeroing on destroy. No HTTP calls; testable with pure unit tests.
- **`SidecarManager`** — Atomic file writes, skip-if-unchanged, purge, `enabled=false` short-circuit. Testable with `tmpdir()`.
