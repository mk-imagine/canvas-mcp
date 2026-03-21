# Execution Plan: attendance-integration-test-hardening

## Implementation Plan Header

| Field | Value |
|-------|-------|
| **Project / Module Name** | `attendance-integration-test-hardening` |
| **Scope Summary** | Remediate six issues (1-5, 7) from post-implementation review of the attendance import integration test suite: dedicated seed assignment, cross-test state isolation, grade restoration fix, name-map re-parse test, min_duration test, PII-safe assertion messages. |
| **Assumptions** | (1) Canvas API accepts `posted_grade: null` or `submission: { posted_grade: '' }` to clear a grade -- Issue 3 includes a spike to verify empirically. (2) The five test students have names sufficiently different that a Zoom name like "ZoomAlias XYZ" will be ambiguous/unmatched, enabling the name-map test. (3) `lastParseResult` module-scoped variable is the sole source of cross-test state leakage for Issue 2. |
| **Constraints & NFRs** | Integration tests run sequentially (fileParallelism: false). Seed data must be idempotent. PII/FERPA blinding in all assertions. Flat `z.object()` schemas only. |
| **Repo Target** | `/Users/mark/Repos/personal/canvas-mcp` |
| **Primary Interfaces** | `registerAttendanceTools`, `CanvasClient`, `ConfigManager`, `SecureStore`, `SidecarManager`, `fetchStudentEnrollments`, `ZoomNameMap`, `matchAttendance`, `createAssignment`. Seed script `createContent()` / `writeSeedIds()`. Test helper `makeConfigAndCsv()`. |
| **Definition of Done** | (1) `npm run seed` creates a dedicated attendance assignment and writes `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` to `.env.test`. (2) All attendance integration tests use the dedicated assignment ID. (3) "submit without prior parse" test passes regardless of execution order. (4) `afterAll` grade restoration correctly handles null/ungraded state. (5) New test for name-map re-parse workflow passes. (6) New test for `min_duration` filtering passes. (7) Assertion message at line 336 uses roster index, not userId. (8) `npm run test:integration` passes. |

---

## Operating Mode: A (Full Plan)

7 packets across 3 phases. All packets are `Tool-Integrated`.

---

## Phase 1: Seed Infrastructure + Independent Fixes

**Milestone:** Dedicated attendance assignment exists in seed data, `.env.test` has `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID`, all existing tests reference it, and three independent fixes (Issues 2, 3, 7) are applied.

**Validation Gate:**
- lint: `npx tsc --noEmit` (seed script compiles)
- unit: N/A (no unit tests for seed script or integration test file)
- integration: `npm run test:integration` (deferred to Phase 3 full run; individual issue fixes validated by code review)

**Steps:** 1.1, 1.2, 1.3, 1.4

---

### Step 1.1: Add attendance assignment to seed script and wire env var

| Field | Value |
|-------|-------|
| **Step Name** | `seed-attendance-assignment` |
| **Prerequisite State** | `scripts/seed-test-data.ts` exists with `createContent()` returning `SeedContent` and `writeSeedIds()` writing to `.env.test`. |
| **Outcome** | Seed script creates a fourth assignment ("Attendance Seed") with `points_possible: 10`, `submission_types: ['none']`, `published: true`, and writes its ID to `.env.test` as `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID`. |
| **Scope / Touch List** | `scripts/seed-test-data.ts`, `.env.test` (via seed execution -- not manually edited) |
| **Implementation Notes** | (1) In `createContent()`, after creating `a3`, create `aAttendance` with `name: 'Attendance | Seed'`, `submission_types: ['none']`, `points_possible: 10`, `published: true`, no `due_at`. (2) Add `attendanceAssignmentId: number` to `SeedContent` interface. (3) Return `attendanceAssignmentId: aAttendance.id` from `createContent()`. (4) In `writeSeedIds()`, add `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID: String(content.attendanceAssignmentId)` to the `updates` object. (5) Do NOT add this assignment to the module or to `submitAndGrade` -- it is a grading-only target. |
| **Tests** | No automated test for this step. Verification: after `npm run seed`, `.env.test` contains `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID=<some number>`. |
| **Validation Gate** | `npx tsc --noEmit -p scripts/tsconfig.json` or equivalent TypeScript check on the seed script. If no tsconfig for scripts, verify with `npx tsx scripts/seed-test-data.ts --dry-run` (or just confirm compilation). |
| **Commit** | `feat(seed): add dedicated attendance assignment to seed data` |
| **If It Fails** | If `createAssignment` fails, check that `submission_types: ['none']` is valid for Canvas API. Fall back to `['online_url']` if needed. If `SeedContent` type error, ensure the new field is added to the interface. |
| **Carry Forward** | New env var `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` is available. `SeedContent` has `attendanceAssignmentId` field. |

---

### Step 1.2: Update test file to use dedicated attendance assignment (Issue 1 + Issue 7)

| Field | Value |
|-------|-------|
| **Step Name** | `use-attendance-assignment-id` |
| **Prerequisite State** | Step 1.1 complete. `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` is defined in `.env.test`. |
| **Outcome** | All `import_attendance` test calls use `attendanceAssignmentId` instead of `assignment1Id`. The PII-leaking assertion message on line 336 uses roster index. The `hasSeedIds` guard includes the new env var. Grade restoration targets the attendance assignment. |
| **Scope / Touch List** | `packages/teacher/tests/integration/attendance.test.ts` |
| **Implementation Notes** | (1) Add `const attendanceAssignmentId = parseInt(process.env.CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID ?? '0')` after line 24. (2) Update `hasSeedIds` to also check `attendanceAssignmentId > 0`. (3) Replace all `assignment_id: assignment1Id` with `assignment_id: attendanceAssignmentId` in the test file. (4) Update grade restoration `afterAll` to use `attendanceAssignmentId` instead of `assignment1Id`. (5) On line 336, change `Expected score 10 for user ${s.userId}` to `Expected score 10 for roster[${roster.indexOf(s)}]` (or `roster student #${i}` using the loop index if available). The loop at line 332 is `for (const s of roster)` -- refactor to `roster.forEach((s, i) => ...)` or `for (let i = 0; i < roster.length; i++)` to have an index. |
| **Tests** | No new tests; existing tests will exercise the new assignment ID. |
| **Validation Gate** | TypeScript compilation check on the test file. |
| **Commit** | `fix(test): use dedicated attendance assignment and remove PII from assertion` |
| **If It Fails** | If `attendanceAssignmentId` is 0 (env var missing), the `hasSeedIds` guard will skip tests -- this is correct behavior. |
| **Carry Forward** | `assignment1Id` is no longer used in attendance tests. `attendanceAssignmentId` is the canonical target. |

---

### Step 1.3: Fix cross-test state leakage (Issue 2)

| Field | Value |
|-------|-------|
| **Step Name** | `isolate-parse-state` |
| **Prerequisite State** | `packages/teacher/src/tools/attendance.ts` has module-scoped `let lastParseResult: ParseState | null = null` at line 31. The "submit without prior parse" test at line 343 creates a fresh `McpServer` via `makeAttendanceClient` but shares the module-scoped `lastParseResult` with previous tests. |
| **Outcome** | Each `McpServer` instance has its own parse state, so the "submit without prior parse" test passes regardless of execution order. |
| **Scope / Touch List** | `packages/teacher/src/tools/attendance.ts` |
| **Implementation Notes** | Replace the module-scoped `lastParseResult` with a `WeakMap<McpServer, ParseState>` keyed by the server instance. (1) Replace `let lastParseResult: ParseState | null = null` with `const parseStateByServer = new WeakMap<McpServer, ParseState>()`. (2) In the `parse` handler (line 172), replace `lastParseResult = { ... }` with `parseStateByServer.set(server, { ... })` where `server` is the `McpServer` instance from the enclosing `registerAttendanceTools` function parameter. (3) In the `submit` handler (line 215), replace `if (lastParseResult === null)` with `const lastParseResult = parseStateByServer.get(server) ?? null; if (lastParseResult === null)`. (4) At line 264 (`lastParseResult = null`), replace with `parseStateByServer.delete(server)`. The `server` parameter is already in scope via the closure from `registerAttendanceTools`. |
| **Tests** | Existing "submit without prior parse" test (line 343) validates this fix. It should now pass even if run after a test that calls `parse`. No new test needed. |
| **Validation Gate** | `npm run build` (must compile), `npm run test:unit` (no regressions) |
| **Commit** | `fix(attendance): scope parse state per McpServer to prevent cross-instance leakage` |
| **If It Fails** | If `McpServer` is not importable as a type for the WeakMap key, use the `server` parameter type directly (it's already typed as `McpServer` in the function signature). If WeakMap doesn't work because `McpServer` instances aren't garbage-collectable in tests, a regular `Map` is acceptable but note the memory implication. |
| **Carry Forward** | `lastParseResult` no longer exists as a module-scoped variable. Parse state is per-server. |

---

### Step 1.4: Fix grade restoration for null grades (Issue 3)

| Field | Value |
|-------|-------|
| **Step Name** | `fix-grade-restoration` |
| **Prerequisite State** | `afterAll` at line 58 restores grades with `posted_grade: grade ?? ''`. When `grade` is `null` (ungraded submission), posting `''` may not correctly clear the grade. |
| **Outcome** | `afterAll` correctly restores null/ungraded state by skipping the grade restoration for null grades or using the Canvas-appropriate API call. |
| **Scope / Touch List** | `packages/teacher/tests/integration/attendance.test.ts` (the `afterAll` block, lines 58-72) |
| **Implementation Notes** | The Canvas API behavior for clearing grades: `posted_grade: ''` posts a grade of empty string, which Canvas may interpret as 0 or leave as-is depending on the assignment type. For truly ungraded submissions (grade was `null` before the test), the safest approach is to skip restoration entirely -- the seed script will re-create the assignment from scratch on the next `npm run seed` anyway, and since we are now using a dedicated attendance assignment (Step 1.2) that starts with no grades, restoration is only needed to avoid polluting the assignment between test runs within the same seed cycle. For null grades, simply skip the PUT call. Change the loop body: `if (grade === null) continue` before the `client.put` call. Update the log to reflect skipped restorations. |
| **Tests** | No new test. The `afterAll` behavior is verified by the absence of errors in the test output and by subsequent test runs passing. |
| **Validation Gate** | TypeScript compilation. |
| **Commit** | `fix(test): skip grade restoration for null (ungraded) submissions` |
| **If It Fails** | If Canvas needs explicit grade clearing (not just skipping), try `posted_grade: null` or `DELETE` on the submission. The Implementer should test empirically if the skip approach causes issues on re-runs. |
| **Carry Forward** | Grade restoration now correctly handles null grades by skipping them. |

---

## Phase 2: New Test Coverage

**Milestone:** Two new integration tests pass: (1) name-map re-parse workflow verifying `source: 'map'`, (2) `min_duration` filtering.

**Validation Gate:**
- lint: N/A
- unit: N/A
- integration: The two new tests pass when run individually

**Steps:** 2.1, 2.2

---

### Step 2.1: Add name-map re-parse integration test (Issue 4)

| Field | Value |
|-------|-------|
| **Step Name** | `test-namemap-reparse` |
| **Prerequisite State** | Steps 1.1-1.2 complete (dedicated attendance assignment available). `makeConfigAndCsv` helper exists. `ZoomNameMap` is importable from `@canvas-mcp/core`. The name-matcher pipeline (Step 1 in matcher: persistent map lookup) returns `source: 'map'` when a name is found in the zoom-name-map. |
| **Outcome** | A new test block verifies: (a) parse with a deliberately ambiguous/unmatched Zoom name, (b) manually write a `zoom-name-map.json` into the config dir mapping that name to a known student, (c) re-parse and verify the match has `source: 'map'`. |
| **Scope / Touch List** | `packages/teacher/tests/integration/attendance.test.ts` |
| **Implementation Notes** | (1) Add `import { writeFileSync as writeFileSyncFs } from 'node:fs'` if not already imported (it is -- `writeFileSync` is imported at line 4). (2) Add a new `describe('Integration: import_attendance -- name-map re-parse')` block. (3) Inside, write a single test: create a config dir, pick `roster[0]` as the target student, construct a CSV with a completely different name (e.g., `"ZoomAlias TestUser"` -- a name that will NOT match any roster entry). (4) First parse: call `import_attendance` with `action: 'parse'`. Expect `matched_count` to be 0 for that name (it should be unmatched or ambiguous). (5) Write `zoom-name-map.json` to the config dir: `{ "zoomalias testuser": <roster[0].userId> }` (lowercase key, per ZoomNameMap convention). (6) Create a NEW `McpServer`/client pair (to get fresh parse state per Step 1.3) with the same `configPath`. (7) Second parse with the same CSV. Expect `matched_count >= 1`. (8) Verify the matched entry has a `source` field. Since the response is blinded (tokenized), check `data.matched[0].source === 'map'`. (9) PII assertion: no real names in response text. |
| **Tests** | Test name: `'re-parse with zoom-name-map resolves previously unmatched name via map lookup'`. Positive case: matched via map. Assertions: `data.matched_count >= 1`, matched entry with `source: 'map'`, no real names in text. |
| **Validation Gate** | Run the single test file: `cd packages/teacher && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/integration/attendance.test.ts` |
| **Commit** | `test(attendance): add integration test for name-map re-parse workflow` |
| **If It Fails** | If the alias name accidentally fuzzy-matches a roster entry (distance < 0.25), use a more distinct alias like `"ZZQQ Nonexistent Person"`. If `source` is not in the blinded response, check `blindedMatched` construction in `attendance.ts` -- it includes `source: m.source` at line 186-187. |
| **Carry Forward** | Name-map re-parse workflow is integration-tested. |

---

### Step 2.2: Add min_duration filtering integration test (Issue 5)

| Field | Value |
|-------|-------|
| **Step Name** | `test-min-duration` |
| **Prerequisite State** | Steps 1.1-1.2 complete (dedicated attendance assignment available). `makeConfigAndCsv` helper supports `durations` option. |
| **Outcome** | A new test verifies that participants below `min_duration` are excluded from matches. |
| **Scope / Touch List** | `packages/teacher/tests/integration/attendance.test.ts` |
| **Implementation Notes** | (1) Add a new `describe('Integration: import_attendance -- min_duration filtering')` block. (2) Use 3 roster students. Set durations to `[45, 5, 60]` via the `makeConfigAndCsv` `durations` option. (3) Call `import_attendance` with `action: 'parse'`, `min_duration: 30`, `assignment_id: attendanceAssignmentId`. (4) Expect `matched_count` to be 2 (students with durations 45 and 60). The student with duration 5 should be absent (filtered out before matching). (5) Verify `absent_count` is `roster.length - 2`. (6) PII assertion: no real names. |
| **Tests** | Test name: `'min_duration filters out participants below threshold'`. Positive: 2 of 3 matched. Edge: the 5-minute participant is NOT in matched list. Assertions: `data.matched_count === 2`, `data.absent_count === roster.length - 2`. |
| **Validation Gate** | Run the single test file. |
| **Commit** | `test(attendance): add integration test for min_duration filtering` |
| **If It Fails** | If `matched_count` is 3, verify that `min_duration` parameter is being passed through to the tool handler. Check that `defaultMinDuration` in the config is 0 (set in `makeConfigAndCsv`), so the explicit `min_duration: 30` should override. |
| **Carry Forward** | min_duration filtering is integration-tested. |

---

## Phase 3: Full Validation

**Milestone:** All integration tests pass end-to-end. Seed script works idempotently.

**Validation Gate:**
- lint: `npm run build`
- unit: `npm run test:unit`
- integration: `npm run test:integration`

**Steps:** 3.1

---

### Step 3.1: Full integration validation

| Field | Value |
|-------|-------|
| **Step Name** | `full-validation` |
| **Prerequisite State** | All previous steps complete. |
| **Outcome** | `npm run seed` succeeds, `npm run test:integration` passes all tests, `npm run test:unit` has no regressions. |
| **Scope / Touch List** | No file changes. Validation only. |
| **Implementation Notes** | (1) Run `npm run seed` and verify `.env.test` contains `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID`. (2) Run `npm run build` to verify compilation. (3) Run `npm run test:unit` to verify no regressions from the WeakMap change in Step 1.3. (4) Run `npm run test:integration` to verify all attendance tests pass. (5) If any test fails, diagnose and fix in-place (do not create a new packet). |
| **Tests** | All existing + new tests. |
| **Validation Gate** | `npm run seed && npm run build && npm run test:unit && npm run test:integration` |
| **Commit** | No commit unless fixes are needed. If fixes are made: `fix(test): resolve integration test issues found during validation` |
| **If It Fails** | Diagnose failures. Common issues: (a) seed script didn't create attendance assignment -- check `createContent()`. (b) WeakMap state isolation broke existing tests -- check closure over `server` param. (c) Name-map test alias accidentally matches -- use a more distinct alias. (d) min_duration test count off -- verify `durations` array alignment with student names. |
| **Carry Forward** | Module complete if all gates pass. |

---

## Execution Packets

---

### Packet 1.1

| Field | Value |
|-------|-------|
| **Packet ID** | `1.1` |
| **Depends On** | none |
| **Prerequisite State** | `scripts/seed-test-data.ts` exists with `createContent()` returning `SeedContent { assignmentIds: [number, number, number]; exitCardId: number; moduleId: number }` and `writeSeedIds()` that writes IDs to `.env.test`. The `createAssignment` function is imported from `@canvas-mcp/core`. |
| **Objective** | Add a dedicated attendance assignment to the seed script and write its ID to `.env.test`. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | `scripts/seed-test-data.ts` |
| **Tests** | No automated test. Verify: TypeScript compiles without errors. |
| **Checklist** | 1. In `SeedContent` interface (line 199), add `attendanceAssignmentId: number`. 2. In `createContent()`, after the `a3` creation (line 231-233), add: `const aAttendance = await createAssignment(teacherClient, COURSE_ID, { ...assignmentBase, name: 'Attendance | Seed', submission_types: ['none'] })`. Remove `due_at` from the spread if `assignmentBase` includes it (it does -- override with `due_at: undefined` or omit). Actually, `assignmentBase` has `due_at` indirectly through the spread on a1/a2/a3 -- but `assignmentBase` itself does not have `due_at`. So just spread `assignmentBase` and override `name` and `submission_types`. 3. Add a console.log for the new assignment. 4. Return `attendanceAssignmentId: aAttendance.id` in the return object. 5. In `writeSeedIds()` (line 379-386), add `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID: String(content.attendanceAssignmentId)` to the `updates` object. |
| **Commands** | `npx tsc --noEmit --esModuleInterop --module nodenext --moduleResolution nodenext scripts/seed-test-data.ts` or `npx tsx --no-warnings scripts/seed-test-data.ts` (dry verification that it parses). If the script has no tsconfig, just verify no syntax errors by importing/parsing. |
| **Pass Condition** | `scripts/seed-test-data.ts` compiles. `SeedContent` includes `attendanceAssignmentId`. `writeSeedIds` writes `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID`. |
| **Commit Message** | `feat(seed): add dedicated attendance assignment to seed data` |
| **Stop / Escalate If** | `createAssignment` with `submission_types: ['none']` is rejected by the Canvas API (unlikely but possible). If so, use `['online_url']` instead. |

---

### Packet 1.2

| Field | Value |
|-------|-------|
| **Packet ID** | `1.2` |
| **Depends On** | `1.1` |
| **Prerequisite State** | `scripts/seed-test-data.ts` writes `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` to `.env.test`. The test file at `packages/teacher/tests/integration/attendance.test.ts` currently uses `assignment1Id` for all attendance tool calls. |
| **Objective** | Update the integration test file to read and use `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID`, fix the PII-leaking assertion (Issue 7), and update the `hasSeedIds` guard. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | `packages/teacher/tests/integration/attendance.test.ts` |
| **Tests** | No new tests. Existing tests exercise the change. |
| **Checklist** | 1. After line 24 (`const assignment1Id = ...`), add: `const attendanceAssignmentId = parseInt(process.env.CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID ?? '0')`. 2. Update `hasSeedIds` (line 27) to: `const hasSeedIds = assignment1Id > 0 && attendanceAssignmentId > 0 && studentIds.length === 5`. 3. In the `afterAll` block (lines 58-72), replace `assignment1Id` with `attendanceAssignmentId` in the PUT path (line 64) and the console.log (line 71). 4. Replace every `assignment_id: assignment1Id` with `assignment_id: attendanceAssignmentId` in the test body -- there are 6 occurrences (lines 162, 203, 238, 244, 249, 308). Also replace `assignment1Id` in the grade-check GET paths at lines 230, 260, 291, 334. 5. Fix line 336 (PII assertion): change `for (const s of roster)` loop (line 332) to `for (let i = 0; i < roster.length; i++)` and use `roster[i]` instead of `s`. Change assertion message from `Expected score 10 for user ${s.userId}` to `Expected score 10 for roster[${i}]`. |
| **Commands** | `npx tsc --noEmit` (or just verify the test file has no syntax errors) |
| **Pass Condition** | No references to `assignment1Id` remain in attendance test tool calls or grade verification. Line 336 assertion uses roster index, not userId. `hasSeedIds` checks `attendanceAssignmentId > 0`. |
| **Commit Message** | `fix(test): use dedicated attendance assignment and remove PII from assertion` |
| **Stop / Escalate If** | If `assignment1Id` is used elsewhere in the file for non-attendance purposes (it is not -- all uses are attendance-related). |

---

### Packet 1.3

| Field | Value |
|-------|-------|
| **Packet ID** | `1.3` |
| **Depends On** | none |
| **Prerequisite State** | `packages/teacher/src/tools/attendance.ts` has `let lastParseResult: ParseState | null = null` at line 31, shared across all `McpServer` instances. `registerAttendanceTools` receives `server: McpServer` as first parameter. |
| **Objective** | Scope parse state per `McpServer` instance using a `WeakMap` to eliminate cross-test state leakage. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | `packages/teacher/src/tools/attendance.ts` |
| **Tests** | Existing unit tests must still pass. The "submit without prior parse" integration test (line 343) is the primary beneficiary -- it creates a fresh server that should have no parse state. |
| **Checklist** | 1. Replace line 31 (`let lastParseResult: ParseState | null = null`) with `const parseStateByServer = new WeakMap<McpServer, ParseState>()`. 2. At line 172 (`lastParseResult = { matchResult, courseId, assignmentId: args.assignment_id ?? 0, points, roster }`), replace with `parseStateByServer.set(server, { matchResult, courseId, assignmentId: args.assignment_id ?? 0, points, roster })`. The `server` variable is the first parameter of `registerAttendanceTools` and is in scope via closure. 3. At line 215 (`if (lastParseResult === null)`), replace with: `const lastParseResult = parseStateByServer.get(server) ?? null; if (lastParseResult === null)`. 4. At line 264 (`lastParseResult = null`), replace with `parseStateByServer.delete(server)`. 5. Verify that the `McpServer` import at line 3 is a type-only import -- if so, it works for WeakMap key typing. Actually, `McpServer` needs to be a runtime value for `WeakMap` to work at the type level, but WeakMap only needs the type annotation -- the actual key is the runtime `server` object. The type import is sufficient. |
| **Commands** | `npm run build && npm run test:unit` |
| **Pass Condition** | Build succeeds. All existing unit tests pass. `lastParseResult` no longer exists as a module-scoped variable. |
| **Commit Message** | `fix(attendance): scope parse state per McpServer to prevent cross-instance leakage` |
| **Stop / Escalate If** | If unit tests reference `lastParseResult` directly (unlikely -- it's not exported). If the `type` import of `McpServer` causes issues with WeakMap, switch to `import { McpServer }` (value import). |

---

### Packet 1.4

| Field | Value |
|-------|-------|
| **Packet ID** | `1.4` |
| **Depends On** | `1.2` (uses `attendanceAssignmentId` in the afterAll block) |
| **Prerequisite State** | The `afterAll` block in `attendance.test.ts` restores grades with `posted_grade: grade ?? ''` at line 65. After Packet 1.2, this block targets `attendanceAssignmentId`. |
| **Objective** | Fix grade restoration to correctly handle null (ungraded) submissions by skipping the PUT call. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | `packages/teacher/tests/integration/attendance.test.ts` |
| **Tests** | No new test. Verified by absence of errors in `afterAll` output. |
| **Checklist** | 1. In the `afterAll` `for` loop (line 61), after `const [userId, grade] of originalGrades`, add: `if (grade === null) { console.log(\`  Skipping grade restoration for user (was ungraded)\`); continue }`. Note: do NOT log the userId (PII concern per Issue 7 spirit). 2. Change `posted_grade: grade ?? ''` to just `posted_grade: grade` (the null case is now handled by the `continue`). Actually, since `grade` is `string | null` and we skip null, at this point `grade` is `string`. So `posted_grade: grade` is correct. 3. Update the console.log at line 71 to note skipped entries if desired, or leave as-is. |
| **Commands** | TypeScript compilation check. |
| **Pass Condition** | `afterAll` skips `client.put` for entries where the original grade was `null`. No PII in log messages. |
| **Commit Message** | `fix(test): skip grade restoration for null (ungraded) submissions` |
| **Stop / Escalate If** | N/A -- this is a straightforward conditional skip. |

---

### Packet 2.1

| Field | Value |
|-------|-------|
| **Packet ID** | `2.1` |
| **Depends On** | `1.2`, `1.3` |
| **Prerequisite State** | `attendanceAssignmentId` is available in the test file. Parse state is per-server (Packet 1.3), so creating a new server for the re-parse gives clean state. `makeConfigAndCsv` and `makeAttendanceClient` helpers exist. `ZoomNameMap` stores mappings as `{ "lowercase name": canvasUserId }` in `zoom-name-map.json`. The `matchAttendance` pipeline checks the name map first (source: 'map'). The blinded response includes `source` field per matched entry. |
| **Objective** | Add an integration test that verifies the name-map re-parse workflow: an unmatched Zoom name is resolved after writing a `zoom-name-map.json` entry. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | `packages/teacher/tests/integration/attendance.test.ts` |
| **Tests** | Test: `'re-parse with zoom-name-map resolves previously unmatched name via map lookup'`. Assertions: (1) First parse: the alias name is unmatched (`matched_count` does not include it). (2) After writing name-map and re-parsing: `matched_count >= 1`, at least one matched entry has `source: 'map'`. (3) No real names in response text. |
| **Checklist** | 1. Add a new `describe('Integration: import_attendance -- name-map re-parse', () => { ... })` block after the existing describe blocks. 2. Inside, add one test with `it.skipIf(!hasSeedIds)(...)`. 3. Create a config dir with `makeTmpConfigDir()`. 4. Pick `roster[0]` as the target student. Use an alias name that will NOT match any roster entry, e.g., `"ZZQQ Nonexistent Person"`. 5. Build CSV with `makeConfigAndCsv(configDir, ["ZZQQ Nonexistent Person"])`. 6. Create server+client with `makeAttendanceClient(configPath, store)`. 7. First parse: `import_attendance` with `action: 'parse'`, `csv_path`, `assignment_id: attendanceAssignmentId`. Assert `data.matched_count === 0` and `(data.unmatched_count === 1 \|\| data.ambiguous_count === 1)`. 8. Write `zoom-name-map.json` to `configDir`: `writeFileSync(join(configDir, 'zoom-name-map.json'), JSON.stringify({ "zzqq nonexistent person": roster[0].userId }))`. Note lowercase key. 9. Create a NEW server+client pair with `makeAttendanceClient(configPath, store2)` (new SecureStore too, since tokens are per-store). 10. Second parse with the same CSV path. Assert `data.matched_count === 1`. Assert `data.matched[0].source === 'map'`. 11. PII assertions on both responses. 12. Destroy both stores. |
| **Commands** | Run the test file: `cd packages/teacher && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/integration/attendance.test.ts` |
| **Pass Condition** | Test passes. Re-parsed entry has `source: 'map'`. No PII in output. |
| **Commit Message** | `test(attendance): add integration test for name-map re-parse workflow` |
| **Stop / Escalate If** | If `source` field is not present in the blinded response, check `blindedMatched` construction in `attendance.ts` lines 181-188 -- it should include `source: m.source`. If it doesn't, this is a bug to fix (in-scope per brief). |

---

### Packet 2.2

| Field | Value |
|-------|-------|
| **Packet ID** | `2.2` |
| **Depends On** | `1.2` |
| **Prerequisite State** | `attendanceAssignmentId` is available. `makeConfigAndCsv` supports `durations` option array. The `min_duration` parameter in the tool handler filters participants before matching (attendance.ts line 127-130). |
| **Objective** | Add an integration test verifying that `min_duration` filtering excludes short-duration participants. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | `packages/teacher/tests/integration/attendance.test.ts` |
| **Tests** | Test: `'min_duration filters out participants below threshold'`. Assertions: (1) With `min_duration: 30` and durations `[45, 5, 60]`, `matched_count === 2`. (2) `absent_count === roster.length - 2`. (3) No real names in response. |
| **Checklist** | 1. Add a new `describe('Integration: import_attendance -- min_duration filtering', () => { ... })` block. 2. Add one test with `it.skipIf(!hasSeedIds)(...)`. 3. Use `roster.slice(0, 3)` for 3 students. 4. `makeConfigAndCsv(configDir, names, { durations: [45, 5, 60] })`. 5. Parse with `min_duration: 30`. 6. Assert `data.matched_count === 2`. 7. Assert `data.absent_count === roster.length - 2` (the 5-minute student is filtered out before matching, so they don't appear as matched OR as a participant -- they just aren't passed to the matcher. The absent list is roster minus matched, so the filtered student counts as absent). 8. PII assertion. 9. Destroy store. |
| **Commands** | Run the test file. |
| **Pass Condition** | Test passes. 2 of 3 CSV participants are matched. The short-duration one is excluded. |
| **Commit Message** | `test(attendance): add integration test for min_duration filtering` |
| **Stop / Escalate If** | If `matched_count` is 3, the `min_duration` parameter is not being passed to the tool. Verify the tool schema accepts `min_duration` (it does -- line 96-97 of attendance.ts). |

---

### Packet 3.1

| Field | Value |
|-------|-------|
| **Packet ID** | `3.1` |
| **Depends On** | `1.1`, `1.2`, `1.3`, `1.4`, `2.1`, `2.2` |
| **Prerequisite State** | All previous packets complete. |
| **Objective** | Run full validation: seed, build, unit tests, integration tests. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | Any file (for fixes if needed) |
| **Tests** | All existing + new tests. |
| **Checklist** | 1. Run `npm run seed` -- verify `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` appears in `.env.test`. 2. Run `npm run build` -- verify no compilation errors. 3. Run `npm run test:unit` -- verify no regressions. 4. Run `npm run test:integration` -- verify all tests pass. 5. If any failures, diagnose and fix. |
| **Commands** | `npm run seed && npm run build && npm run test:unit && npm run test:integration` |
| **Pass Condition** | All commands exit 0. All tests pass. |
| **Commit Message** | (No commit unless fixes needed. If fixes: `fix(test): resolve integration test issues found during validation`) |
| **Stop / Escalate If** | If seed fails due to Canvas API issues (rate limiting, sandbox down), retry after a delay. If a test fails due to a design issue not covered in the brief, escalate to Strategist. |

---

## Conversation Reset Map

| Field | Value |
|-------|-------|
| **Module Brief Reference** | `attendance-integration-test-hardening` in `canvas-mcp` repo. Goal: remediate 6 issues in attendance integration tests. DoD: seed creates attendance assignment, all tests use it, state isolation, grade restoration, name-map test, min_duration test, PII-safe assertions, all integration tests pass. |
| **Packets Completed** | (none yet) |
| **Next Packet ID** | `1.1` (and `1.3` can run in parallel) |
| **Current Phase** | Phase 1: Seed Infrastructure + Independent Fixes |
| **Signatures & Interfaces** | `SeedContent { assignmentIds: [number, number, number]; exitCardId: number; moduleId: number }` -- will gain `attendanceAssignmentId: number`. `registerAttendanceTools(server: McpServer, client: CanvasClient, configManager: ConfigManager, secureStore: SecureStore, sidecarManager: SidecarManager): void`. Module-scoped `let lastParseResult: ParseState | null` at line 31 of `attendance.ts` -- will become `WeakMap<McpServer, ParseState>`. |
| **Key Invariants** | Integration tests run sequentially. Seed data must be idempotent. PII must never appear in test assertions or log output. `makeConfigAndCsv` sets `defaultMinDuration: 0` in config. Each `McpServer` instance in tests gets its own transport pair via `InMemoryTransport.createLinkedPair()`. |
| **Dependencies & Locations** | `scripts/seed-test-data.ts` (seed script), `packages/teacher/tests/integration/attendance.test.ts` (test file), `packages/teacher/src/tools/attendance.ts` (production code -- Issue 2 fix), `.env.test` (env vars). Core exports from `packages/core/src/index.ts`. |
| **Repo / Tooling Context** | Branch: `feat/roadmap-modules-1-2-3.2`. Test runner: vitest. Build: `npm run build` (core then teacher). Unit: `npm run test:unit`. Integration: `npm run test:integration`. Seed: `npm run seed`. |
| **Open Risks / Assumptions** | (1) `submission_types: ['none']` may not be accepted by Canvas API for the attendance assignment -- fallback to `['online_url']`. (2) The alias name `"ZZQQ Nonexistent Person"` for the name-map test must not fuzzy-match any real student name (very unlikely given the extreme difference). (3) Grade restoration skip for null grades assumes the seed script re-creates assignments fresh, so no stale grades persist. |

---

## Dependency Graph

```
1.1 (seed assignment) ──> 1.2 (use in tests) ──> 1.4 (grade restoration fix)
                                              ──> 2.1 (name-map test)
                                              ──> 2.2 (min_duration test)
1.3 (WeakMap state isolation) ─────────────────> 2.1 (name-map test needs clean state)

All ──> 3.1 (full validation)
```

Packets `1.1` and `1.3` are independent and can execute in parallel.
Packets `2.1` and `2.2` are independent and can execute in parallel (both depend on `1.2`; `2.1` also depends on `1.3`).
Packet `1.4` depends only on `1.2`.
