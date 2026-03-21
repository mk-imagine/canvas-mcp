# Module Brief: attendance-integration-test-hardening

| Field | Value |
|-------|-------|
| **Module Name** | `attendance-integration-test-hardening` |
| **Purpose** | Remediate six issues (Issues 1-5, 7) identified in post-implementation review of the attendance import integration test suite, improving test isolation, correctness, and coverage. |
| **Boundary: Owns** | (1) Adding a dedicated attendance assignment to `scripts/seed-test-data.ts` and exporting its ID as `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` in `.env.test`. (2) Resetting `lastParseResult` between tests in the integration test file to eliminate cross-test state leakage. (3) Fixing grade restoration in `afterAll` to correctly handle null/ungraded state instead of posting empty string. (4) Adding an integration test for the name-map re-parse workflow (parse with ambiguous name, write resolution to `zoom-name-map.json`, re-parse and verify `source: 'map'`). (5) Adding an integration test for `min_duration` filtering. (6) Replacing the Canvas user ID in the assertion message on line 336 with a roster index reference. (7) Updating the integration test to use `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` instead of `assignment1Id`. |
| **Boundary: Consumes** | `@canvas-mcp/core` exports: `CanvasClient`, `ConfigManager`, `SecureStore`, `SidecarManager`, `fetchStudentEnrollments`, `ZoomNameMap`, `matchAttendance`, `createAssignment`. `@modelcontextprotocol/sdk` for `McpServer`, `Client`, `InMemoryTransport`. `registerAttendanceTools` and `registerReportingTools` from `packages/teacher/src/tools/`. The existing seed script infrastructure (`scripts/seed-test-data.ts`). The module-level `lastParseResult` variable at line 31 of `packages/teacher/src/tools/attendance.ts`. |
| **Public Surface** | No new public interfaces. Changes are internal to the test suite, seed script, and `.env.test` configuration. The only cross-boundary change is one new env var (`CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID`) consumed by the test file and produced by the seed script. |
| **External Dependencies** | Canvas LMS REST API (sandbox instance at `canvas.instructure.com`). Vitest test runner. The five student test accounts provisioned in `.env.test`. |
| **Inherited Constraints** | Integration tests run sequentially (`fileParallelism: false`) because they share Canvas state. The `reset.test.ts` `afterAll` runs `npm run seed` to restore course state, so any new seed data must be idempotent under re-seeding. PII/FERPA blinding must be maintained in all test assertions and output. All `inputSchema` fields use flat `z.object()` (no discriminated unions). Zoom CSV fixture format: `Name (Original Name),User Email,Duration (Minutes),Guest,Recording Consent`. |
| **Repo Location** | Primary files: `packages/teacher/tests/integration/attendance.test.ts`, `scripts/seed-test-data.ts`, `.env.test`. Secondary (read-only context for Issue 2 fix validation): `packages/teacher/src/tools/attendance.ts`. |
| **Parallelism Hints** | **Issue 1** (seed data + env var + test file update to use new assignment ID) is a prerequisite for Issues 4 and 5 (new tests should use the dedicated attendance assignment). **Issue 2** (lastParseResult reset) is independent. **Issue 3** (grade restoration fix) is independent. **Issue 7** (PII in assertion) is independent. Issues 2, 3, and 7 can be built in parallel. Issues 4 and 5 (new test cases) can be built in parallel with each other after Issue 1 is complete. |
| **Cross-File Coupling** | `scripts/seed-test-data.ts` and `.env.test` are tightly coupled: the seed script writes IDs to `.env.test`, and the test file reads them. Changes to the seed script's `createContent()` function, the `writeSeedIds()` function, and the test file's environment variable declarations (lines 21-27) must be coordinated. The `makeConfigAndCsv` helper in the test file is shared by existing and new tests, so changes to its signature affect all callers. |
| **Execution Mode Preference** | `Tool-Integrated` -- all issues have clear, mechanical fixes with no design ambiguity. |
| **Definition of Done** | (1) `npm run seed` creates a dedicated attendance assignment (`"Attendance - Week 1"`, `points_possible: 10`, `grading_type: points`) and writes its ID to `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` in `.env.test`. (2) All existing attendance integration tests use `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` instead of `CANVAS_TEST_ASSIGNMENT_1_ID`. (3) The "submit without prior parse" test passes regardless of test execution order (verified by running it in isolation or first). (4) The `afterAll` grade restoration correctly restores null grades (not empty string). (5) A new test verifies the name-map re-parse workflow: parse with an unmatched/ambiguous name, write a mapping to `zoom-name-map.json`, re-parse, and assert the name resolves via `source: 'map'`. (6) A new test verifies `min_duration` filtering: parse with `min_duration` set high enough to exclude at least one participant and assert the filtered participant is absent from matched results. (7) Line 336's assertion message references a roster index (e.g., `roster[i]`) instead of `s.userId`. (8) `npm run test:integration` passes with all attendance tests green. |

---

## Supplementary Analysis

### Issue-to-Change Map

| Issue | Severity | Files Modified | Nature |
|-------|----------|----------------|--------|
| 1 (seed data) | Medium | `scripts/seed-test-data.ts`, `.env.test`, `attendance.test.ts` (lines 24, 27, and all `assignment1Id` references) | New seed assignment + env var + reference update |
| 2 (lastParseResult) | Medium | `attendance.test.ts` | Add `beforeEach` or import + reset of `lastParseResult`. Since `lastParseResult` is not exported, the simplest approach is to ensure each test that needs a clean state creates a fresh `McpServer` via `makeAttendanceClient()` (which it already does). The real fix is that the "submit without prior parse" test at line 343 already creates a fresh server -- but `lastParseResult` is module-scoped and shared across all server instances. The Tactician should evaluate: (a) exposing a `resetParseState()` test helper exported from `attendance.ts`, or (b) moving `lastParseResult` into a `WeakMap<McpServer, ParseState>` keyed by server instance, or (c) adding a `beforeEach` that calls a reset. Option (b) is the cleanest for production correctness but touches production code. Option (a) is test-only. |
| 3 (grade restoration) | Low | `attendance.test.ts` (line 65) | Change `posted_grade: grade ?? ''` to either `posted_grade: 'none'` or use `client.delete()` for null grades. Requires verifying Canvas API behavior. |
| 4 (re-parse test) | Medium | `attendance.test.ts` | New `describe`/`it` block. Needs a CSV with a name that won't match any roster student (to trigger ambiguous/unmatched), then write to `zoom-name-map.json` in the temp config dir, then re-parse. |
| 5 (min_duration test) | Low | `attendance.test.ts` | New `it` block. Use `makeConfigAndCsv` with custom `durations` array (some below threshold). Parse with `min_duration` and assert filtered count. |
| 7 (PII in assertion) | Low | `attendance.test.ts` (line 336) | Replace `` `Expected score 10 for user ${s.userId}` `` with `` `Expected score 10 for roster student index ${i}` `` or similar. |

### Execution Order

```
Issue 1 (seed + env var + assignment reference update)
   |
   +---> Issue 4 (re-parse test)     -- parallel -->  Issue 5 (min_duration test)
   |
   +---> Issue 2 (lastParseResult)   -- parallel -->  Issue 3 (grade restore)  -- parallel --> Issue 7 (PII)
```

Issues 2, 3, and 7 have no dependency on Issue 1 (they don't require the new assignment ID to be implemented), but logically all test-file changes should be coordinated to avoid merge conflicts in `attendance.test.ts`. The Tactician may choose to serialize all changes to this file.

### Risk Notes

- **Issue 2 design choice**: The `lastParseResult` singleton is a production-code concern, not just a test concern. If two MCP clients connected to the same process, they would share parse state. The review brief suggests option (b) (test-only `beforeEach` reset) as "simpler and sufficient," but the Tactician should note that option (a) (`WeakMap` keyed by server instance) fixes the production bug too. The Strategist's position: the production fix (scoping per-server) is in-scope for this module since it directly causes the test-ordering dependency. If the Tactician deems it too invasive, the `beforeEach` reset is acceptable as a test-only mitigation, but a follow-up should be noted.

- **Issue 3 Canvas API verification**: The correct way to clear a grade on Canvas needs empirical verification. The Tactician should include a spike step or the Implementer should test `posted_grade: null` vs `DELETE` vs `posted_grade: ''` against the sandbox before committing the fix.
