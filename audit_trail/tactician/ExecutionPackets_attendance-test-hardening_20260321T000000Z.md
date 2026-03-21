# Execution Packets: attendance-integration-test-hardening

## Packet 1.1

| Field | Value |
|-------|-------|
| **Packet ID** | `1.1` |
| **Depends On** | none |
| **Prerequisite State** | `scripts/seed-test-data.ts` exists with `createContent()` returning `SeedContent { assignmentIds: [number, number, number]; exitCardId: number; moduleId: number }` and `writeSeedIds()` writing IDs to `.env.test`. `createAssignment` is imported from `@canvas-mcp/core`. |
| **Objective** | Add a dedicated attendance assignment to the seed script and write its ID to `.env.test`. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | `scripts/seed-test-data.ts` |
| **Tests** | No automated test. Verify TypeScript compiles. |
| **Checklist** | 1. Add `attendanceAssignmentId: number` to the `SeedContent` interface (line 199). 2. In `createContent()`, after `a3` creation (line 233), add: `const aAttendance = await createAssignment(teacherClient, COURSE_ID, { ...assignmentBase, name: 'Attendance \| Seed', submission_types: ['none'] })` and a `console.log`. 3. Return `attendanceAssignmentId: aAttendance.id` in the return object (line 270). 4. In `writeSeedIds()` updates object (line 379), add `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID: String(content.attendanceAssignmentId)`. |
| **Commands** | Verify compilation: `npx tsx --no-warnings scripts/seed-test-data.ts --help 2>&1 \|\| true` (just parse check) |
| **Pass Condition** | `SeedContent` has `attendanceAssignmentId`. `writeSeedIds` writes `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID`. File compiles. |
| **Commit Message** | `feat(seed): add dedicated attendance assignment to seed data` |
| **Stop / Escalate If** | `createAssignment` with `submission_types: ['none']` might not be valid -- use `['online_url']` as fallback. |

---

## Packet 1.2

| Field | Value |
|-------|-------|
| **Packet ID** | `1.2` |
| **Depends On** | `1.1` |
| **Prerequisite State** | Seed script writes `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` to `.env.test`. Test file uses `assignment1Id` for all attendance calls. |
| **Objective** | Update integration tests to use `attendanceAssignmentId`, fix PII assertion (Issue 7), update `hasSeedIds` guard. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | `packages/teacher/tests/integration/attendance.test.ts` |
| **Tests** | No new tests. |
| **Checklist** | 1. Add `const attendanceAssignmentId = parseInt(process.env.CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID ?? '0')` after line 24. 2. Update `hasSeedIds` to also check `attendanceAssignmentId > 0`. 3. Replace all `assignment1Id` references in attendance tool calls and grade-check GET paths with `attendanceAssignmentId` (lines 162, 203, 230, 238, 244, 249, 260, 291, 308, 334). 4. In afterAll block (line 64), replace `assignment1Id` with `attendanceAssignmentId`. Same for console.log at line 71. 5. Fix line 336: refactor `for (const s of roster)` to `for (let i = 0; i < roster.length; i++)` and change assertion message from `Expected score 10 for user ${s.userId}` to `Expected score 10 for roster[${i}]`. Use `roster[i]` instead of `s`. |
| **Commands** | TypeScript compilation check |
| **Pass Condition** | No `assignment1Id` references in attendance test tool calls. Line 336 uses roster index. `hasSeedIds` checks `attendanceAssignmentId`. |
| **Commit Message** | `fix(test): use dedicated attendance assignment and remove PII from assertion` |
| **Stop / Escalate If** | N/A |

---

## Packet 1.3

| Field | Value |
|-------|-------|
| **Packet ID** | `1.3` |
| **Depends On** | none |
| **Prerequisite State** | `packages/teacher/src/tools/attendance.ts` has module-scoped `let lastParseResult: ParseState \| null = null` at line 31. `registerAttendanceTools` receives `server: McpServer` as first parameter. |
| **Objective** | Scope parse state per `McpServer` instance via `WeakMap` to fix cross-test state leakage. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | `packages/teacher/src/tools/attendance.ts` |
| **Tests** | Existing unit tests must pass. "submit without prior parse" integration test is the primary beneficiary. |
| **Checklist** | 1. Replace line 31 `let lastParseResult: ParseState \| null = null` with `const parseStateByServer = new WeakMap<McpServer, ParseState>()`. 2. Line 172: replace `lastParseResult = { ... }` with `parseStateByServer.set(server, { ... })`. 3. Line 215: replace `if (lastParseResult === null)` with `const lastParseResult = parseStateByServer.get(server) ?? null; if (lastParseResult === null)`. 4. Line 264: replace `lastParseResult = null` with `parseStateByServer.delete(server)`. |
| **Commands** | `npm run build && npm run test:unit` |
| **Pass Condition** | Build succeeds. Unit tests pass. `lastParseResult` no longer module-scoped. |
| **Commit Message** | `fix(attendance): scope parse state per McpServer to prevent cross-instance leakage` |
| **Stop / Escalate If** | If `McpServer` type import causes WeakMap issues, switch to value import. |

---

## Packet 1.4

| Field | Value |
|-------|-------|
| **Packet ID** | `1.4` |
| **Depends On** | `1.2` |
| **Prerequisite State** | `afterAll` block targets `attendanceAssignmentId` (from Packet 1.2). Currently restores grades with `posted_grade: grade ?? ''`. |
| **Objective** | Fix grade restoration to skip null (ungraded) submissions instead of posting empty string. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | `packages/teacher/tests/integration/attendance.test.ts` |
| **Tests** | No new test. |
| **Checklist** | 1. In the `afterAll` for-loop, after destructuring `[userId, grade]`, add: `if (grade === null) continue`. 2. Change `posted_grade: grade ?? ''` to `posted_grade: grade` (null case handled by continue). 3. Optionally update the restoration count log to note skipped entries. |
| **Commands** | TypeScript compilation check |
| **Pass Condition** | `afterAll` skips PUT for null grades. No `grade ?? ''` pattern remains. |
| **Commit Message** | `fix(test): skip grade restoration for null (ungraded) submissions` |
| **Stop / Escalate If** | N/A |

---

## Packet 2.1

| Field | Value |
|-------|-------|
| **Packet ID** | `2.1` |
| **Depends On** | `1.2`, `1.3` |
| **Prerequisite State** | `attendanceAssignmentId` available. Parse state is per-server (WeakMap). `makeConfigAndCsv` and `makeAttendanceClient` exist. `ZoomNameMap` stores `{ "lowercase name": canvasUserId }` in `zoom-name-map.json`. Blinded response includes `source` field. |
| **Objective** | Add integration test for name-map re-parse workflow. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | `packages/teacher/tests/integration/attendance.test.ts` |
| **Tests** | `'re-parse with zoom-name-map resolves previously unmatched name via map lookup'`: (1) First parse with alias name -> unmatched. (2) Write zoom-name-map.json mapping alias to roster[0].userId. (3) New server, re-parse -> matched with `source: 'map'`. (4) No real names in response. |
| **Checklist** | 1. Add `describe('Integration: import_attendance -- name-map re-parse', () => { ... })` after existing blocks. 2. Single test with `it.skipIf(!hasSeedIds)`. 3. Create configDir, pick `roster[0]`. CSV has one entry: `"ZZQQ Nonexistent Person"`. 4. First parse: assert `data.matched_count === 0`, `data.unmatched_count + data.ambiguous_count >= 1`. 5. Write `zoom-name-map.json` to configDir: `{ "zzqq nonexistent person": roster[0].userId }`. 6. Create NEW SecureStore + server/client pair (same configPath). 7. Second parse with same CSV. Assert `data.matched_count === 1`, `data.matched[0].source === 'map'`. 8. PII assertions on both responses. 9. Destroy both stores. |
| **Commands** | `cd packages/teacher && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/integration/attendance.test.ts` |
| **Pass Condition** | Test passes. Re-parsed entry has `source: 'map'`. |
| **Commit Message** | `test(attendance): add integration test for name-map re-parse workflow` |
| **Stop / Escalate If** | If `source` field missing from blinded response, check `attendance.ts` lines 181-188. If alias fuzzy-matches a student, use more distinct name. |

---

## Packet 2.2

| Field | Value |
|-------|-------|
| **Packet ID** | `2.2` |
| **Depends On** | `1.2` |
| **Prerequisite State** | `attendanceAssignmentId` available. `makeConfigAndCsv` supports `durations` option. `min_duration` filtering in attendance.ts lines 127-130. |
| **Objective** | Add integration test for `min_duration` filtering. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | `packages/teacher/tests/integration/attendance.test.ts` |
| **Tests** | `'min_duration filters out participants below threshold'`: 3 students, durations [45, 5, 60], `min_duration: 30` -> `matched_count === 2`, `absent_count === roster.length - 2`. |
| **Checklist** | 1. Add `describe('Integration: import_attendance -- min_duration filtering', () => { ... })`. 2. `it.skipIf(!hasSeedIds)`. 3. Use `roster.slice(0, 3)`, durations `[45, 5, 60]`. 4. `makeConfigAndCsv(configDir, names, { durations: [45, 5, 60] })`. 5. Parse with `min_duration: 30`, `assignment_id: attendanceAssignmentId`. 6. Assert `data.matched_count === 2`, `data.absent_count === roster.length - 2`. 7. PII assertion. 8. Destroy store. |
| **Commands** | Run the test file |
| **Pass Condition** | Test passes. 2 matched, short-duration excluded. |
| **Commit Message** | `test(attendance): add integration test for min_duration filtering` |
| **Stop / Escalate If** | If `matched_count === 3`, verify `min_duration` param is passed through. |

---

## Packet 3.1

| Field | Value |
|-------|-------|
| **Packet ID** | `3.1` |
| **Depends On** | `1.1`, `1.2`, `1.3`, `1.4`, `2.1`, `2.2` |
| **Prerequisite State** | All previous packets complete. |
| **Objective** | Full end-to-end validation: seed, build, unit tests, integration tests. |
| **Execution Mode** | `Tool-Integrated` |
| **Allowed Files** | Any (for fixes if needed) |
| **Tests** | All existing + new tests. |
| **Checklist** | 1. `npm run seed` -- verify `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` in `.env.test`. 2. `npm run build`. 3. `npm run test:unit`. 4. `npm run test:integration`. 5. Fix any failures in-place. |
| **Commands** | `npm run seed && npm run build && npm run test:unit && npm run test:integration` |
| **Pass Condition** | All commands exit 0. |
| **Commit Message** | (none unless fixes needed) |
| **Stop / Escalate If** | Canvas sandbox down or rate-limited -- retry. Design issue not in brief -- escalate to Strategist. |
