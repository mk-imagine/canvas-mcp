# Implementation Plan: Attendance Import

| Field | Value |
|-------|-------|
| **Project / Module Name** | `attendance-import` |
| **Scope Summary** | Parse Zoom participant CSVs, fuzzy-match names to Canvas roster, post binary attendance grades -- all PII-blind. Single MCP tool `import_attendance` with `parse` and `submit` actions. |
| **Assumptions** | 1. `ConfigManager` does not currently expose its config directory; we will add a public `getConfigDir()` method. 2. Zoom CSVs use the format described in the brief (no quoted commas in name/duration fields). 3. The `CanvasClient.put` method exists and works for grade submission. |
| **Constraints & NFRs** | FERPA PII blindness; flat Zod schemas; `z.number()` for IDs; `blindedResponse()` pattern; config deep-merge with defaults; build order core-before-teacher. |
| **Repo Target** | `packages/core/` and `packages/teacher/` |
| **Primary Interfaces** | `registerAttendanceTools(server, client, configManager, secureStore, sidecarManager)` -- MCP tool registration. Core exports: `levenshtein()`, `parseZoomCsv()`, `matchAttendance()`, `ZoomNameMap`, `writeReviewFile()`, `gradeSubmission()`. Config: `CanvasTeacherConfig.attendance`. |
| **Definition of Done** | All 12 items from the Module Brief DoD (see brief). Unit tests pass with MSW mocks. Build succeeds. Integration test passes against Canvas sandbox. |

---

## Phase 1: Core Infrastructure (Independent Building Blocks)

Milestone: All independent pure-function modules exist in `packages/core/` with unit tests. Config schema extended. `gradeSubmission` API wrapper exists.

Validation Gate:
  lint: N/A (no separate lint command documented)
  unit: `cd packages/teacher && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts`
  build: `npm run build`

### Step 1.1: Extract levenshtein to core

| Field | Value |
|-------|-------|
| **Step Name** | `extract-levenshtein` |
| **Prerequisite State** | Clean repo on working branch. `packages/core/src/matching/` directory does not yet exist (name-index.ts was noted in brief but Glob shows no files there -- it may have been removed or the path was hypothetical). |
| **Outcome** | `levenshtein()` function available as a core export. |
| **Scope / Touch List** | `packages/core/src/matching/levenshtein.ts` (new), `packages/core/src/matching/index.ts` (new barrel), `packages/core/src/index.ts` (add re-export) |
| **Implementation Notes** | Copy the `levenshtein()` function from `clients/gemini/src/before_model.ts` (lines 25-50) into `packages/core/src/matching/levenshtein.ts`. Export it. Create barrel `matching/index.ts`. Add `export * from './matching/index.js'` to core's `index.ts`. |
| **Tests** | File: `packages/core/tests/unit/matching/levenshtein.test.ts` (new). Cases: (1) identical strings => 0, (2) single char difference => 1, (3) empty vs non-empty => length of non-empty, (4) completely different strings => expected edit distance, (5) case sensitivity (levenshtein is case-sensitive -- "ABC" vs "abc" => 3). |
| **Validation Gate** | Build: `npm run build` |
| **Commit** | `feat(core): extract levenshtein function to packages/core/src/matching` |
| **If It Fails** | Check for import path issues (.js extensions in ESM). Verify barrel export chain. |
| **Carry Forward** | `levenshtein(a: string, b: string): number` signature exported from `@canvas-mcp/core`. |

### Step 1.2: Extend config schema with attendance section

| Field | Value |
|-------|-------|
| **Step Name** | `config-schema-attendance` |
| **Prerequisite State** | `packages/core/src/config/schema.ts` exists with `CanvasTeacherConfig` and `DEFAULT_CONFIG`. |
| **Outcome** | `CanvasTeacherConfig.attendance` section exists with `hostName`, `defaultPoints`, `defaultMinDuration` fields and defaults. |
| **Scope / Touch List** | `packages/core/src/config/schema.ts` |
| **Implementation Notes** | Add `attendance: { hostName: string; defaultPoints: number; defaultMinDuration: number }` to the `CanvasTeacherConfig` interface. Add corresponding defaults to `DEFAULT_CONFIG`: `{ hostName: '', defaultPoints: 10, defaultMinDuration: 0 }`. |
| **Tests** | No separate test file needed -- the config deep-merge is already tested by existing tests. Verification: build succeeds, existing config files without `attendance` key still work (deep-merge fills defaults). |
| **Validation Gate** | Build: `npm run build` |
| **Commit** | `feat(core): add attendance section to config schema` |
| **If It Fails** | Check `DeepPartial<T>` handles the new nested object correctly. |
| **Carry Forward** | `config.attendance.hostName`, `config.attendance.defaultPoints`, `config.attendance.defaultMinDuration` available from `configManager.read()`. |

### Step 1.3: Add getConfigDir to ConfigManager

| Field | Value |
|-------|-------|
| **Step Name** | `config-manager-getConfigDir` |
| **Prerequisite State** | `packages/core/src/config/manager.ts` has private `configPath`. |
| **Outcome** | `ConfigManager.getConfigDir()` returns the directory containing the config file. |
| **Scope / Touch List** | `packages/core/src/config/manager.ts` |
| **Implementation Notes** | Add a public method `getConfigDir(): string` that returns `dirname(this.configPath)`. This is needed by the attendance module to locate `zoom-name-map.json` and `attendance-review.json` in the same directory as `config.json`. |
| **Tests** | Inline verification: the method returns a directory path. Existing tests continue to pass. |
| **Validation Gate** | Build: `npm run build` |
| **Commit** | `feat(core): expose getConfigDir on ConfigManager` |
| **If It Fails** | Trivial method -- unlikely to fail. |
| **Carry Forward** | `configManager.getConfigDir()` returns the config directory path. |

### Step 1.4: Add gradeSubmission to core canvas API

| Field | Value |
|-------|-------|
| **Step Name** | `grade-submission-api` |
| **Prerequisite State** | `packages/core/src/canvas/submissions.ts` exists with other Canvas API functions. `packages/core/src/index.ts` re-exports from `submissions.ts`. |
| **Outcome** | `gradeSubmission(client, courseId, assignmentId, userId, score)` wraps `PUT /api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id`. |
| **Scope / Touch List** | `packages/core/src/canvas/submissions.ts`, `packages/core/src/index.ts` (add to named exports) |
| **Implementation Notes** | Add function: `export async function gradeSubmission(client: CanvasClient, courseId: number, assignmentId: number, userId: number, score: number): Promise<CanvasSubmission>`. Body: `return client.put<CanvasSubmission>(\`/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}\`, { submission: { posted_grade: String(score) } })`. Add `gradeSubmission` to the explicit named exports in `core/src/index.ts`. |
| **Tests** | Tested via MSW in the attendance tool unit tests (Phase 3). |
| **Validation Gate** | Build: `npm run build` |
| **Commit** | `feat(core): add gradeSubmission Canvas API function` |
| **If It Fails** | Check the PUT body format matches Canvas API expectations. |
| **Carry Forward** | `gradeSubmission(client, courseId, assignmentId, userId, score)` exported from `@canvas-mcp/core`. |

### Step 1.5: Zoom CSV parser

| Field | Value |
|-------|-------|
| **Step Name** | `zoom-csv-parser` |
| **Prerequisite State** | `packages/core/src/attendance/` directory does not exist yet. |
| **Outcome** | `parseZoomCsv(csvContent: string)` returns structured participant data. Handles BOM, CRLF, header detection. |
| **Scope / Touch List** | `packages/core/src/attendance/zoom-csv-parser.ts` (new), `packages/core/src/attendance/types.ts` (new -- shared types), `packages/core/src/attendance/index.ts` (new barrel), `packages/core/src/index.ts` (add re-export) |
| **Implementation Notes** | 1. Define `ZoomParticipant` type: `{ name: string; originalName: string | null; duration: number }`. The `Name (original name)` column format is: `Display Name` or `Display Name (Original Name)`. Parse both. 2. `parseZoomCsv(csvContent: string): ZoomParticipant[]`. Strip BOM (`\uFEFF`), split on `\r?\n`, find header row containing `Name`, `Duration (minutes)` (case-insensitive). Parse each data row. 3. The `name` field should be the original name if present (from parentheses), otherwise the display name. This gives the best match against Canvas roster names. |
| **Tests** | File: `packages/core/tests/unit/attendance/zoom-csv-parser.test.ts` (new). Cases: (1) Happy path -- standard Zoom CSV with 3 participants, check names and durations. (2) BOM prefix -- CSV starts with `\uFEFF`, parses correctly. (3) CRLF line endings -- parses correctly. (4) `Name (original name)` column -- extracts original name from parens. (5) Empty CSV / header only -- returns empty array. (6) Missing duration column -- throws descriptive error. |
| **Validation Gate** | `cd packages/core && npx vitest run tests/unit/attendance/zoom-csv-parser.test.ts` (or build) |
| **Commit** | `feat(core): add Zoom CSV parser for attendance import` |
| **If It Fails** | Check header detection regex. Check CSV fixture format matches real Zoom exports. |
| **Carry Forward** | `parseZoomCsv(csvContent)` and `ZoomParticipant` type exported from `@canvas-mcp/core`. |

### Step 1.6: Persistent Zoom name map I/O

| Field | Value |
|-------|-------|
| **Step Name** | `zoom-name-map-io` |
| **Prerequisite State** | `packages/core/src/attendance/` directory exists from 1.5. |
| **Outcome** | `ZoomNameMap` class: `load(dir)`, `save(dir)`, `get(zoomName)`, `set(zoomName, canvasUserId)`. JSON file at `<configDir>/zoom-name-map.json`. |
| **Scope / Touch List** | `packages/core/src/attendance/zoom-name-map.ts` (new), `packages/core/src/attendance/index.ts` (update barrel) |
| **Implementation Notes** | Keys are lowercased Zoom display names. Values are Canvas user IDs (numbers). `load()` reads from `<dir>/zoom-name-map.json`, returns empty map if file doesn't exist. `save()` writes the map as pretty-printed JSON. The class is a thin wrapper around a `Map<string, number>` with JSON persistence. |
| **Tests** | File: `packages/core/tests/unit/attendance/zoom-name-map.test.ts` (new). Cases: (1) `load()` from non-existent file returns empty map. (2) `set()` + `save()` + `load()` round-trip. (3) `get()` is case-insensitive (lowercased lookup). (4) `save()` creates parent directory if missing. Use `tmpdir()` for test paths. |
| **Validation Gate** | Run the test file. |
| **Commit** | `feat(core): add persistent Zoom name map for attendance` |
| **If It Fails** | Check file path construction. Check JSON parse error handling. |
| **Carry Forward** | `ZoomNameMap` class exported from `@canvas-mcp/core`. |

### Step 1.7: Review file writer

| Field | Value |
|-------|-------|
| **Step Name** | `review-file-writer` |
| **Prerequisite State** | `packages/core/src/attendance/` directory exists from 1.5. |
| **Outcome** | `writeReviewFile(dir, entries)` writes `attendance-review.json` containing ambiguous/unmatched names with real names for human review. |
| **Scope / Touch List** | `packages/core/src/attendance/review-file.ts` (new), `packages/core/src/attendance/index.ts` (update barrel) |
| **Implementation Notes** | `writeReviewFile(dir: string, entries: ReviewEntry[]): string` where `ReviewEntry = { zoomName: string; status: 'ambiguous' | 'unmatched'; candidates?: Array<{ canvasName: string; canvasUserId: number; distance: number }> }`. Returns the full path to the written file. Overwrites on each call (ephemeral per-session). |
| **Tests** | File: `packages/core/tests/unit/attendance/review-file.test.ts` (new). Cases: (1) Writes valid JSON to the expected path. (2) Overwrites existing file. (3) Contains the expected entries. Use `tmpdir()`. |
| **Validation Gate** | Run the test file. |
| **Commit** | `feat(core): add attendance review file writer` |
| **If It Fails** | Check JSON serialization and directory creation. |
| **Carry Forward** | `writeReviewFile(dir, entries)` and `ReviewEntry` type exported from `@canvas-mcp/core`. |

---

## Phase 2: Name Matching Pipeline

Milestone: `matchAttendance()` function correctly matches Zoom participants to Canvas roster using persistent map + exact + fuzzy matching.

Validation Gate:
  unit: Run matching test file.
  build: `npm run build`

### Step 2.1: Name matcher implementation

| Field | Value |
|-------|-------|
| **Step Name** | `name-matcher` |
| **Prerequisite State** | `levenshtein()` exists in `packages/core/src/matching/levenshtein.ts` (from 1.1). `ZoomNameMap` exists (from 1.6). `ZoomParticipant` type exists (from 1.5). |
| **Outcome** | `matchAttendance()` implements the 4-step pipeline: persistent map lookup, exact case-insensitive, fuzzy Levenshtein, unmatched. Returns structured result with `matched`, `ambiguous`, `unmatched` arrays. |
| **Scope / Touch List** | `packages/core/src/attendance/name-matcher.ts` (new), `packages/core/src/attendance/types.ts` (update with result types), `packages/core/src/attendance/index.ts` (update barrel) |
| **Implementation Notes** | Types: `RosterEntry = { userId: number; name: string; sortableName: string }`. `MatchResult = { matched: Array<{ zoomName: string; canvasUserId: number; canvasName: string; duration: number; source: 'map' \| 'exact' \| 'fuzzy' }>; ambiguous: Array<{ zoomName: string; duration: number; candidates: Array<{ canvasName: string; canvasUserId: number; distance: number }> }>; unmatched: Array<{ zoomName: string; duration: number }> }`. Function signature: `matchAttendance(participants: ZoomParticipant[], roster: RosterEntry[], nameMap: ZoomNameMap): MatchResult`. Pipeline: (1) Check `nameMap.get(participant.name)` -- if found and user ID is in roster, add to matched with source='map'. (2) Case-insensitive exact match against `roster[].name` and `roster[].sortableName`. (3) Compute normalized Levenshtein distance for each roster entry. If best distance < 0.25, auto-match (source='fuzzy'). If between 0.25 and 0.5, mark ambiguous with candidates. (4) Otherwise unmatched. |
| **Tests** | File: `packages/core/tests/unit/attendance/name-matcher.test.ts` (new). Cases: (1) Persistent map hit -- participant with known mapping is matched immediately. (2) Exact case-insensitive match -- "jane smith" matches "Jane Smith". (3) Exact match on sortable_name -- "Smith, Jane" matches "Smith, Jane" in roster. (4) High-confidence fuzzy match -- "Jane Smth" (distance ~0.1) auto-matches "Jane Smith". (5) Ambiguous fuzzy match -- "J. Smith" could match "Jane Smith" or "John Smith" (distance between 0.25-0.5). (6) Unmatched name -- "xyz123" has no close match. (7) Persistent map entry for user not in roster -- skips to fuzzy matching. (8) Empty participants list -- returns empty result. (9) Empty roster -- all participants unmatched. |
| **Validation Gate** | Run the test file. Build succeeds. |
| **Commit** | `feat(core): add attendance name matching pipeline` |
| **If It Fails** | Verify normalized distance calculation: `editDistance / Math.max(a.length, b.length)`. Check threshold values. |
| **Carry Forward** | `matchAttendance()`, `MatchResult`, `RosterEntry` types exported from `@canvas-mcp/core`. |

---

## Phase 3: MCP Tool Registration & Unit Tests

Milestone: `import_attendance` tool registered, both `parse` and `submit` actions work, unit tests pass with MSW mocks. No real names in any MCP response.

Validation Gate:
  unit: `cd packages/teacher && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/tools/attendance.test.ts`
  build: `npm run build`

### Step 3.1: Register attendance tool (parse action)

| Field | Value |
|-------|-------|
| **Step Name** | `attendance-tool-parse` |
| **Prerequisite State** | All Phase 1 and Phase 2 modules exist and are exported from `@canvas-mcp/core`. `packages/teacher/src/index.ts` exists with other tool registrations. |
| **Outcome** | `registerAttendanceTools()` exists with `import_attendance` tool. `parse` action reads CSV from disk, fetches roster, runs name matcher, returns tokenized result via `blindedResponse()`, writes review file for unresolved names. |
| **Scope / Touch List** | `packages/teacher/src/tools/attendance.ts` (new), `packages/teacher/src/index.ts` (add import + registration call) |
| **Implementation Notes** | 1. Follow the `registerReportingTools` pattern exactly -- same function signature with `secureStore` and `sidecarManager`. 2. Module-scoped `let lastParseResult: ParseState \| null = null` for session state between parse and submit. 3. Parse action flow: (a) Read CSV file from `args.csv_path` using `fs.readFileSync`. (b) `parseZoomCsv(csvContent)`. (c) Filter host: remove entries matching `config.attendance.hostName` (compare against name with ` (Host)` suffix stripped, case-insensitive). (d) Filter by min_duration (from args or `config.attendance.defaultMinDuration`). (e) Fetch roster via `fetchStudentEnrollments(client, courseId)`. (f) Load `ZoomNameMap` from `configManager.getConfigDir()`. (g) Run `matchAttendance()`. (h) Auto-save high-confidence fuzzy matches to nameMap. (i) Write review file for ambiguous + unmatched. (j) Tokenize matched students via `secureStore.tokenize()`. (k) Store parse result in module-scoped variable. (l) Return `blindedResponse()` with tokenized present list, absent count, etc. 4. `resolveCourseId` helper (same as in reporting.ts). 5. `toolError` and `blindedResponse` helpers (can import from a shared location or duplicate per convention). |
| **Tests** | File: `packages/teacher/tests/unit/tools/attendance.test.ts` (new). MSW mocks for `/api/v1/courses/:id/enrollments`. Test CSV fixtures as string constants. Cases: (1) **Parse happy path** -- CSV with 3 students, all exact-match roster, returns tokenized present list with 3 entries, no unresolved. (2) **Parse with ambiguous names** -- CSV with 1 exact + 1 ambiguous + 1 unmatched, returns correct counts and review_file path. (3) **Host filtering** -- host entry in CSV is excluded from results. (4) **Duration threshold** -- participant below min_duration is excluded. (5) **Persistent map lookup** -- pre-populated map resolves a name that wouldn't fuzzy-match. (6) **Config defaults** -- no points/min_duration args, uses config defaults. (7) **PII assertion** -- scan entire response text for real names from fixtures; assert none present (only `[STUDENT_NNN]` tokens). (8) **Missing CSV file** -- returns toolError. (9) **No active course** -- returns toolError. |
| **Validation Gate** | Run `attendance.test.ts`. Build succeeds. |
| **Commit** | `feat(teacher): add import_attendance tool with parse action` |
| **If It Fails** | Check MSW handler setup for enrollments endpoint. Verify `blindedResponse` import/duplication. Check fs mock strategy (use real tmpdir files for CSV, MSW for HTTP). |
| **Carry Forward** | `registerAttendanceTools` function signature. Module-scoped `lastParseResult` state shape. |

### Step 3.2: Submit action + unit tests

| Field | Value |
|-------|-------|
| **Step Name** | `attendance-tool-submit` |
| **Prerequisite State** | `packages/teacher/src/tools/attendance.ts` exists with parse action (from 3.1). `gradeSubmission` exported from core (from 1.4). |
| **Outcome** | `submit` action reads from in-memory parse state, posts grades via `gradeSubmission()`, returns tokenized confirmation. Dry-run mode previews without posting. |
| **Scope / Touch List** | `packages/teacher/src/tools/attendance.ts` (modify -- add submit logic), `packages/teacher/tests/unit/tools/attendance.test.ts` (add submit tests) |
| **Implementation Notes** | 1. Submit action flow: (a) Check `lastParseResult` is not null -- if null, return toolError("No attendance data parsed. Run parse first."). (b) Resolve courseId. (c) For each matched student: if `dry_run`, just record; else call `gradeSubmission(client, courseId, args.assignment_id, userId, points)`. Use `args.points ?? config.attendance.defaultPoints`. (d) Tokenize results. (e) Clear `lastParseResult` after successful (non-dry-run) submission. (f) Return `blindedResponse()` with grades_posted count, per-student status. 2. Error handling: individual grade submission failures should be caught and reported as status="error" per student, not abort the whole batch. |
| **Tests** | Add to `attendance.test.ts`. MSW mocks for `PUT /api/v1/courses/:id/assignments/:id/submissions/:user_id`. Cases: (1) **Submit happy path** -- parse then submit, 3 grades posted, verify PUT requests made. (2) **Submit dry-run** -- parse then submit with dry_run=true, no PUT requests made, response shows what would happen. (3) **Submit without prior parse** -- returns toolError. (4) **Submit clears state** -- after successful submit, second submit returns "no data parsed" error. (5) **Partial failure** -- one grade POST returns 500, others succeed, response shows per-student status with "error" for failed one. (6) **PII assertion on submit response** -- no real names in output. |
| **Validation Gate** | Run `attendance.test.ts` (all tests including parse + submit). Build succeeds. |
| **Commit** | `feat(teacher): add submit action to import_attendance tool` |
| **If It Fails** | Check MSW PUT handler matching. Verify error handling per student vs batch. |
| **Carry Forward** | Full `import_attendance` tool with both actions complete. |

---

## Phase 4: Integration Test

Milestone: End-to-end test passes against real Canvas sandbox -- parse a real CSV, submit grades, verify via `get_grades`.

Validation Gate:
  integration: `node --no-warnings node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/integration/attendance.test.ts`

### Step 4.1: Integration test

| Field | Value |
|-------|-------|
| **Step Name** | `integration-test` |
| **Prerequisite State** | All unit tests pass (Phase 3). `.env.test` has Canvas credentials. Test course has at least one assignment for grading. |
| **Outcome** | Integration test verifies end-to-end flow: parse CSV, submit grades, verify grades were posted. |
| **Scope / Touch List** | `tests/integration/attendance.test.ts` (new) |
| **Implementation Notes** | 1. Create a test CSV file in tmpdir with names matching students in the test sandbox course. 2. Test flow: (a) Call `import_attendance(action="parse", csv_path=..., assignment_id=...)`. (b) Verify response has tokenized present list. (c) Call `import_attendance(action="submit", assignment_id=..., points=10, dry_run=true)`. (d) Verify dry-run response. (e) Call `import_attendance(action="submit", assignment_id=..., points=10)`. (f) Verify grades_posted count. (g) Use `get_grades(scope="assignment", assignment_id=...)` to verify grades were posted. 3. `afterAll`: clean up by resetting grades (or rely on `reset.test.ts` / seed script). |
| **Tests** | This IS the test. |
| **Validation Gate** | Integration test passes. |
| **Commit** | `test: add integration test for attendance import` |
| **If It Fails** | Check Canvas sandbox state. Verify assignment_id exists. Check CSV student names match sandbox roster. |
| **Carry Forward** | None -- this is the final validation step. |

---

## Phase 5: Build Verification & Cleanup

Milestone: Full build succeeds, all unit tests pass, all exports correct.

Validation Gate:
  build: `npm run build`
  unit: `npm run test:unit`

### Step 5.1: Final build and test verification

| Field | Value |
|-------|-------|
| **Step Name** | `final-verification` |
| **Prerequisite State** | All previous phases complete. |
| **Outcome** | Clean build, all unit tests pass, core barrel exports verified. |
| **Scope / Touch List** | No new files. Potential minor fixes to imports/exports if build reveals issues. |
| **Implementation Notes** | Run `npm run build` and `npm run test:unit`. Fix any issues. |
| **Tests** | All existing + new tests pass. |
| **Validation Gate** | `npm run build && npm run test:unit` |
| **Commit** | `chore: fix any build/export issues from attendance import` (only if needed) |
| **If It Fails** | Check `.js` extension in ESM imports. Check barrel export completeness. |
| **Carry Forward** | None. |

---

# Execution Packets

## Packet 1.1

| Field | Value |
|-------|-------|
| **Packet ID** | `1.1` |
| **Depends On** | none |
| **Prerequisite State** | Clean repo. `clients/gemini/src/before_model.ts` contains `levenshtein()` at lines 25-50. `packages/core/src/index.ts` exists. No `packages/core/src/matching/` directory. |
| **Objective** | Copy `levenshtein()` function to `packages/core/src/matching/levenshtein.ts` and export from core barrel. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `packages/core/src/matching/levenshtein.ts` (new), `packages/core/src/matching/index.ts` (new), `packages/core/src/index.ts` (modify) |
| **Tests** | Create `packages/core/tests/unit/matching/levenshtein.test.ts`. Import `levenshtein` from source. Cases: `levenshtein('', '') === 0`, `levenshtein('abc', 'abc') === 0`, `levenshtein('abc', 'abd') === 1`, `levenshtein('', 'abc') === 3`, `levenshtein('kitten', 'sitting') === 3`, `levenshtein('ABC', 'abc') === 3` (case-sensitive). |
| **Checklist** | 1. Create `packages/core/src/matching/levenshtein.ts` with the `levenshtein` function copied from `clients/gemini/src/before_model.ts` lines 25-50. 2. Create `packages/core/src/matching/index.ts` barrel: `export { levenshtein } from './levenshtein.js'`. 3. Add `export * from './matching/index.js'` to `packages/core/src/index.ts`. 4. Create test file and write all test cases. 5. Run tests. |
| **Commands** | `npm run build`, `cd packages/core && npx vitest run tests/unit/matching/levenshtein.test.ts` |
| **Pass Condition** | All 6 test cases pass. Build succeeds. `levenshtein` is importable from `@canvas-mcp/core`. |
| **Commit Message** | `feat(core): extract levenshtein function to packages/core/src/matching` |
| **Stop / Escalate If** | `packages/core/tests/` directory structure doesn't exist -- create it. If vitest config for core doesn't exist, run tests from teacher package with the alias. |

## Packet 1.2

| Field | Value |
|-------|-------|
| **Packet ID** | `1.2` |
| **Depends On** | none |
| **Prerequisite State** | `packages/core/src/config/schema.ts` exists with `CanvasTeacherConfig` interface and `DEFAULT_CONFIG` constant. |
| **Objective** | Add `attendance` section to config schema with defaults. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `packages/core/src/config/schema.ts` |
| **Tests** | No new test file. Verification: build succeeds, existing unit tests pass (config deep-merge fills defaults for existing configs without `attendance`). |
| **Checklist** | 1. Add `attendance: { hostName: string; defaultPoints: number; defaultMinDuration: number }` to `CanvasTeacherConfig` interface. 2. Add `attendance: { hostName: '', defaultPoints: 10, defaultMinDuration: 0 }` to `DEFAULT_CONFIG`. |
| **Commands** | `npm run build` |
| **Pass Condition** | Build succeeds. TypeScript compiles without errors. |
| **Commit Message** | `feat(core): add attendance section to config schema` |
| **Stop / Escalate If** | Type errors cascade to other files expecting the old config shape -- should not happen since `attendance` is a new key. |

## Packet 1.3

| Field | Value |
|-------|-------|
| **Packet ID** | `1.3` |
| **Depends On** | none |
| **Prerequisite State** | `packages/core/src/config/manager.ts` has `ConfigManager` with private `configPath` and a `write()` method that uses `dirname(this.configPath)`. |
| **Objective** | Add `getConfigDir()` public method to `ConfigManager`. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `packages/core/src/config/manager.ts` |
| **Tests** | No separate test file. Method is trivial (`dirname(this.configPath)`). Verified by build and by downstream usage in Phase 3. |
| **Checklist** | 1. Add public method `getConfigDir(): string { return dirname(this.configPath) }` to the `ConfigManager` class. `dirname` is already imported. |
| **Commands** | `npm run build` |
| **Pass Condition** | Build succeeds. |
| **Commit Message** | `feat(core): expose getConfigDir on ConfigManager` |
| **Stop / Escalate If** | Nothing expected. |

## Packet 1.4

| Field | Value |
|-------|-------|
| **Packet ID** | `1.4` |
| **Depends On** | none |
| **Prerequisite State** | `packages/core/src/canvas/submissions.ts` exports other Canvas API functions. `packages/core/src/index.ts` has explicit named exports from `submissions.ts`. |
| **Objective** | Add `gradeSubmission()` function to core Canvas API layer. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `packages/core/src/canvas/submissions.ts`, `packages/core/src/index.ts` |
| **Tests** | Tested via MSW in Phase 3 unit tests. No separate test needed here. |
| **Checklist** | 1. Add to `packages/core/src/canvas/submissions.ts`: `export async function gradeSubmission(client: CanvasClient, courseId: number, assignmentId: number, userId: number, score: number): Promise<CanvasSubmission> { return client.put<CanvasSubmission>(\`/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}\`, { submission: { posted_grade: String(score) } }) }`. 2. Add `gradeSubmission` to the named export list in `packages/core/src/index.ts`. |
| **Commands** | `npm run build` |
| **Pass Condition** | Build succeeds. `gradeSubmission` is importable from `@canvas-mcp/core`. |
| **Commit Message** | `feat(core): add gradeSubmission Canvas API function` |
| **Stop / Escalate If** | If `CanvasClient.put` has a different return type than expected, check its signature in `client.ts`. |

## Packet 1.5

| Field | Value |
|-------|-------|
| **Packet ID** | `1.5` |
| **Depends On** | none |
| **Prerequisite State** | `packages/core/src/attendance/` does not exist. `packages/core/src/index.ts` exists for barrel exports. |
| **Objective** | Create Zoom CSV parser with types, barrel export, and unit tests. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `packages/core/src/attendance/zoom-csv-parser.ts` (new), `packages/core/src/attendance/types.ts` (new), `packages/core/src/attendance/index.ts` (new), `packages/core/src/index.ts` (modify), `packages/core/tests/unit/attendance/zoom-csv-parser.test.ts` (new) |
| **Tests** | Create `packages/core/tests/unit/attendance/zoom-csv-parser.test.ts`. Import `parseZoomCsv` from source. Test fixtures as string constants simulating Zoom CSV format. Cases: (1) Standard CSV with 3 participants -- correct names and durations. (2) BOM prefix (`\uFEFF`) -- stripped and parsed. (3) CRLF endings -- parsed correctly. (4) `Name (original name)` format -- extracts original name from parentheses as the primary name. (5) Header-only CSV -- returns empty array. (6) Missing `Duration` column -- throws error. |
| **Checklist** | 1. Create `packages/core/src/attendance/types.ts` with `ZoomParticipant` interface: `{ name: string; originalName: string \| null; duration: number }`. 2. Create `packages/core/src/attendance/zoom-csv-parser.ts` with `parseZoomCsv(csvContent: string): ZoomParticipant[]`. Implementation: strip BOM, split lines, find header row by detecting `Name` and `Duration` columns (case-insensitive substring), parse data rows, extract original name from parens if present. 3. Create `packages/core/src/attendance/index.ts` barrel. 4. Add `export * from './attendance/index.js'` to `packages/core/src/index.ts`. 5. Create test file with all 6 cases. 6. Run tests. |
| **Commands** | `npm run build`, run test file |
| **Pass Condition** | All 6 test cases pass. Build succeeds. |
| **Commit Message** | `feat(core): add Zoom CSV parser for attendance import` |
| **Stop / Escalate If** | If real Zoom CSV format differs from expectations, escalate to user for a sample CSV. The test fixtures should closely match the Zoom export format: header line `Name,User Email,Duration (minutes),...` with `Name (original name)` in the name column values. |

## Packet 1.6

| Field | Value |
|-------|-------|
| **Packet ID** | `1.6` |
| **Depends On** | `1.5` (attendance directory and barrel exist) |
| **Prerequisite State** | `packages/core/src/attendance/index.ts` barrel exists. |
| **Objective** | Create persistent Zoom name map with file I/O and unit tests. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `packages/core/src/attendance/zoom-name-map.ts` (new), `packages/core/src/attendance/index.ts` (update barrel), `packages/core/tests/unit/attendance/zoom-name-map.test.ts` (new) |
| **Tests** | Create test file. Use `tmpdir()` for file paths. Cases: (1) `load()` from non-existent file returns empty map. (2) `set('Zoom Name', 1001)` then `save()` then `load()` round-trips correctly. (3) `get('zoom name')` is case-insensitive (lookup lowercases the key). (4) `save()` creates parent directory if missing. |
| **Checklist** | 1. Create `packages/core/src/attendance/zoom-name-map.ts`. Class `ZoomNameMap` with: private `entries: Map<string, number>`, `load(dir: string)` reads `<dir>/zoom-name-map.json` (creates empty map if not found), `save(dir: string)` writes JSON, `get(zoomName: string): number \| undefined` (lowercases key), `set(zoomName: string, canvasUserId: number)` (lowercases key), `getAll(): Record<string, number>` for serialization. 2. Update barrel. 3. Write tests. |
| **Commands** | Run test file, `npm run build` |
| **Pass Condition** | All 4 test cases pass. Build succeeds. |
| **Commit Message** | `feat(core): add persistent Zoom name map for attendance` |
| **Stop / Escalate If** | File permission issues in tmpdir -- unlikely. |

## Packet 1.7

| Field | Value |
|-------|-------|
| **Packet ID** | `1.7` |
| **Depends On** | `1.5` (attendance directory and barrel exist) |
| **Prerequisite State** | `packages/core/src/attendance/index.ts` barrel exists. `packages/core/src/attendance/types.ts` exists with shared types. |
| **Objective** | Create review file writer and unit tests. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `packages/core/src/attendance/review-file.ts` (new), `packages/core/src/attendance/types.ts` (add `ReviewEntry` type), `packages/core/src/attendance/index.ts` (update barrel), `packages/core/tests/unit/attendance/review-file.test.ts` (new) |
| **Tests** | Create test file. Use `tmpdir()`. Cases: (1) Writes valid JSON with expected entries to `<dir>/attendance-review.json`. (2) Overwrites existing file on second call. (3) Returns the full file path. |
| **Checklist** | 1. Add `ReviewEntry` type to `types.ts`: `{ zoomName: string; status: 'ambiguous' \| 'unmatched'; candidates?: Array<{ canvasName: string; canvasUserId: number; distance: number }> }`. 2. Create `review-file.ts` with `writeReviewFile(dir: string, entries: ReviewEntry[]): string`. Writes `attendance-review.json` as pretty-printed JSON. Returns full path. Creates dir if needed. 3. Update barrel. 4. Write tests. |
| **Commands** | Run test file, `npm run build` |
| **Pass Condition** | All 3 test cases pass. Build succeeds. |
| **Commit Message** | `feat(core): add attendance review file writer` |
| **Stop / Escalate If** | Nothing expected. |

## Packet 2.1

| Field | Value |
|-------|-------|
| **Packet ID** | `2.1` |
| **Depends On** | `1.1`, `1.5`, `1.6` |
| **Prerequisite State** | `levenshtein()` exported from `@canvas-mcp/core`. `ZoomParticipant` type, `ZoomNameMap` class, and attendance barrel all exist. |
| **Objective** | Implement the 4-step name matching pipeline and unit tests. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `packages/core/src/attendance/name-matcher.ts` (new), `packages/core/src/attendance/types.ts` (add `RosterEntry`, `MatchResult`), `packages/core/src/attendance/index.ts` (update barrel), `packages/core/tests/unit/attendance/name-matcher.test.ts` (new) |
| **Tests** | Create test file. Cases: (1) Persistent map hit -- known mapping matches immediately (source='map'). (2) Exact case-insensitive match on `name` field. (3) Exact match on `sortableName` field (e.g., "Smith, Jane"). (4) High-confidence fuzzy match -- "Jane Smth" auto-matches "Jane Smith" (distance < 0.25). (5) Ambiguous fuzzy -- "J. Smith" with multiple candidates between 0.25-0.5 distance. (6) Unmatched -- "xyz123" has no close match. (7) Map entry for user not in roster -- falls through to fuzzy. (8) Empty participants -- empty result. (9) Empty roster -- all unmatched. |
| **Checklist** | 1. Add `RosterEntry` and `MatchResult` types to `types.ts`. 2. Create `name-matcher.ts` with `matchAttendance(participants, roster, nameMap): MatchResult`. Implement 4-step pipeline per brief: map lookup, exact case-insensitive (check both `name` and `sortableName`), fuzzy Levenshtein (normalized distance thresholds 0.25 auto-accept, 0.25-0.5 ambiguous), unmatched. 3. For fuzzy: compare lowercased participant name against lowercased roster name/sortableName, take best match. 4. Update barrel. 5. Write all 9 test cases. |
| **Commands** | Run test file, `npm run build` |
| **Pass Condition** | All 9 test cases pass. Build succeeds. |
| **Commit Message** | `feat(core): add attendance name matching pipeline` |
| **Stop / Escalate If** | If the normalized distance thresholds (0.25/0.5) produce unexpected results in tests, adjust and document. |

## Packet 3.1

| Field | Value |
|-------|-------|
| **Packet ID** | `3.1` |
| **Depends On** | `1.2`, `1.3`, `1.4`, `1.5`, `1.6`, `1.7`, `2.1` |
| **Prerequisite State** | All core modules exist and are exported: `parseZoomCsv`, `matchAttendance`, `ZoomNameMap`, `writeReviewFile`, `gradeSubmission`, `levenshtein`. Config has `attendance` section. `ConfigManager` has `getConfigDir()`. `SecureStore` and `SidecarManager` patterns established in `reporting.ts`. `fetchStudentEnrollments` already exported from core. |
| **Objective** | Create `registerAttendanceTools()` with `parse` action, wire into teacher index, and write unit tests for parse. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `packages/teacher/src/tools/attendance.ts` (new), `packages/teacher/src/index.ts` (modify), `packages/teacher/tests/unit/tools/attendance.test.ts` (new) |
| **Tests** | Create `packages/teacher/tests/unit/tools/attendance.test.ts`. Follow `reporting.test.ts` pattern exactly: MSW mocks, `McpServer` + `InMemoryTransport`, `Client.callTool()`. Mock `/api/v1/courses/:id/enrollments` returning roster fixtures. Test CSV fixtures as string constants written to tmpdir. Mock `zoom-name-map.json` reads via tmpdir config directory. Cases: (1) Parse happy path -- 3 students in CSV all exact-match roster, returns tokenized present list with `[STUDENT_001]` etc., no unresolved. (2) Parse with ambiguous -- 1 matched + 1 ambiguous + 1 unmatched, correct counts, `review_file` path present. (3) Host filtering -- CSV includes host name matching config, host excluded from results. (4) Duration threshold -- `min_duration: 30`, participant with 10 min excluded. (5) Persistent map lookup -- pre-write a map file, name resolves via map. (6) Config defaults used when args not provided. (7) **PII assertion** -- for every test, assert response text does NOT contain any real name from fixtures (scan for "Jane Smith", "Bob Adams", etc.), only `[STUDENT_NNN]` tokens. (8) CSV file not found -- returns error. (9) No active course -- returns error. |
| **Checklist** | 1. Create `packages/teacher/src/tools/attendance.ts`. Define `registerAttendanceTools(server, client, configManager, secureStore, sidecarManager)`. Define module-scoped `lastParseResult` variable. Define local helpers: `resolveCourseId`, `toolError`, `blindedResponse` (same as reporting.ts). Register `import_attendance` tool with Zod schema per brief (flat `z.object` with `z.enum(['parse', 'submit'])`). Implement parse action. 2. In `packages/teacher/src/index.ts`: import `registerAttendanceTools`, call it after `registerFindTools` with `(server, client, configManager, secureStore, sidecarManager)`. 3. Create test file with all 9 cases. 4. Run tests. |
| **Commands** | `cd packages/teacher && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/tools/attendance.test.ts`, `npm run build` |
| **Pass Condition** | All 9 test cases pass. Build succeeds. `import_attendance` tool is listed when connecting to the MCP server. |
| **Commit Message** | `feat(teacher): add import_attendance tool with parse action` |
| **Stop / Escalate If** | If the test harness pattern from `reporting.test.ts` doesn't work for fs operations (CSV read, map read/write), use tmpdir for all file I/O in tests and pass config path pointing to tmpdir. If `blindedResponse` or `SidecarManager` imports cause issues, check the import path. |

## Packet 3.2

| Field | Value |
|-------|-------|
| **Packet ID** | `3.2` |
| **Depends On** | `3.1` |
| **Prerequisite State** | `packages/teacher/src/tools/attendance.ts` exists with parse action working. `gradeSubmission` exported from core. Module-scoped `lastParseResult` holds parse state. Test file exists with parse tests passing. |
| **Objective** | Add `submit` action to `import_attendance` tool with unit tests. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | `packages/teacher/src/tools/attendance.ts` (modify), `packages/teacher/tests/unit/tools/attendance.test.ts` (modify) |
| **Tests** | Add to existing test file. MSW mocks for `PUT /api/v1/courses/:id/assignments/:id/submissions/:user_id`. Cases: (1) Submit happy path -- parse then submit, verify correct number of PUT requests, tokenized response with grades_posted count. (2) Submit dry-run -- parse then submit with `dry_run: true`, no PUT requests made, response includes per-student preview. (3) Submit without parse -- returns toolError("No attendance data parsed"). (4) Submit clears state -- after successful submit, second submit returns error. (5) Partial failure -- one PUT returns 500, others 200; response shows per-student status including "error". (6) PII assertion on submit response -- no real names. |
| **Checklist** | 1. Add submit action logic to the `import_attendance` handler in `attendance.ts`. If `action === 'submit'`: check `lastParseResult` not null, resolve courseId, determine points (`args.points ?? config.attendance.defaultPoints`), iterate matched students: if dry_run just record, else call `gradeSubmission()` wrapped in try/catch for per-student error handling. Clear state after non-dry-run success. Return `blindedResponse()`. 2. Add all 6 test cases. 3. Run full test suite. |
| **Commands** | `cd packages/teacher && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/tools/attendance.test.ts`, `npm run build` |
| **Pass Condition** | All tests pass (9 parse + 6 submit = 15 total). Build succeeds. |
| **Commit Message** | `feat(teacher): add submit action to import_attendance tool` |
| **Stop / Escalate If** | If MSW has trouble matching PUT requests with dynamic user IDs, use a URL pattern matcher. |

## Packet 4.1

| Field | Value |
|-------|-------|
| **Packet ID** | `4.1` |
| **Depends On** | `3.2` |
| **Prerequisite State** | All unit tests pass. `.env.test` has Canvas credentials. Test course accessible. |
| **Objective** | Write integration test for end-to-end attendance import flow. |
| **Execution Mode** | Guided Execution |
| **Allowed Files** | `tests/integration/attendance.test.ts` (new) |
| **Tests** | This IS the test. Follow existing integration test patterns (e.g., `tests/integration/` directory). Use real Canvas API. Create test CSV in tmpdir with names matching sandbox students. Flow: parse CSV -> verify tokenized response -> submit dry-run -> verify no grades posted -> submit for real -> verify grades posted via `get_grades`. |
| **Checklist** | 1. Create `tests/integration/attendance.test.ts`. 2. Setup: create CSV fixture in tmpdir with known student names. 3. Test parse action returns expected structure. 4. Test submit dry-run returns preview. 5. Test submit posts grades. 6. Verify via get_grades or direct API call. 7. Clean up: use afterAll to reset grades if needed. |
| **Commands** | `node --no-warnings node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/integration/attendance.test.ts` |
| **Pass Condition** | Integration test passes. |
| **Commit Message** | `test: add integration test for attendance import` |
| **Stop / Escalate If** | If sandbox course doesn't have suitable students/assignments, need user to create them or provide fixture data. This is Guided Execution because integration tests depend on sandbox state that may need user verification. |

## Packet 5.1

| Field | Value |
|-------|-------|
| **Packet ID** | `5.1` |
| **Depends On** | `3.2` (unit tests), optionally `4.1` |
| **Prerequisite State** | All code written. |
| **Objective** | Full build and test suite verification. |
| **Execution Mode** | Tool-Integrated |
| **Allowed Files** | Any file (minor fixes only) |
| **Tests** | All existing + new tests. |
| **Checklist** | 1. Run `npm run build`. 2. Run `npm run test:unit`. 3. Fix any failures (import paths, missing exports, type errors). |
| **Commands** | `npm run build && npm run test:unit` |
| **Pass Condition** | Build succeeds. All unit tests pass. |
| **Commit Message** | `chore: fix build/export issues from attendance import` (only if fixes needed) |
| **Stop / Escalate If** | Unexpected test failures in existing tools -- investigate before fixing. |
