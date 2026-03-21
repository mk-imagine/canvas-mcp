# Attendance Integration Test Review — Scope Strategist Brief

## Context

The attendance import feature (Packets 1.1–5.1) has been implemented and merged. An integration test was written in Packet 4.1 at `packages/teacher/tests/integration/attendance.test.ts`. This brief summarizes the findings from a post-implementation review of that integration test and the tool implementation, identifying issues that need scoping for remediation.

## Issues Identified

### Issue 1: No attendance-specific seed data (Severity: Medium)

**Finding:** The integration test reuses `assignment1Id` from the existing seed data rather than having a dedicated attendance assignment. The seed script (`scripts/seed-test-data.ts`) does not provision any attendance-related assignments.

**Impact:**
- No isolation from other tests that also use assignment 1 — changes to the seed or other test suites could break attendance tests
- The reused assignment's `points_possible` may not match attendance semantics (binary all-or-nothing grading)
- The test implicitly depends on seed structure it doesn't own

**Recommendation:** Add an attendance assignment to the seed script (e.g., "Attendance - Week 1" with `points_possible: 10`, grading_type: `points`). Export its ID as `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` in `.env.test`. Update the integration test to use this dedicated assignment.

---

### Issue 2: Module-scoped singleton `lastParseResult` (Severity: Medium)

**Finding:** `lastParseResult` in `packages/teacher/src/tools/attendance.ts` (line 31) is a module-level variable. All MCP server instances created within the same process share it. In the integration test, each test creates a fresh `McpServer` via `makeAttendanceClient()`, but they all share the same `lastParseResult`.

**Impact:**
- Test ordering matters: the "submit without prior parse" test only passes because a prior test's submit cleared the state. Reordering tests could cause false passes or failures.
- In production with a single server instance this is fine, but it's a testing fragility.

**Recommendation:** Either (a) scope `lastParseResult` per-server-instance by storing it in a closure or `Map` keyed by server, or (b) add explicit `lastParseResult = null` reset in a `beforeEach` within the test file. Option (b) is simpler and sufficient.

---

### Issue 3: Grade restoration uses empty string for null grades (Severity: Low)

**Finding:** The `afterAll` grade restoration (line 66) uses `posted_grade: grade ?? ''` when the original grade was null. Posting an empty string to Canvas may behave differently from "no grade" (Canvas could interpret it as clearing the grade to 0, or it could reject it).

**Impact:** Test cleanup might not properly restore the original state, potentially affecting subsequent test runs.

**Recommendation:** Verify Canvas API behavior for `posted_grade: ''` vs omitting the field. If empty string doesn't restore to "ungraded," use the Canvas `DELETE /submissions/:id` endpoint or post `posted_grade: null`.

---

### Issue 4: Missing test coverage — re-parse after editing name map (Severity: Medium)

**Finding:** The designed workflow includes a critical path: user edits `zoom-name-map.json` to resolve ambiguities, then re-parses. No integration test covers this flow.

**Impact:** The persistent map → re-parse cycle is a core user workflow. Without test coverage, regressions in map loading or re-parse behavior would go undetected.

**Recommendation:** Add an integration test that: (1) parses with an ambiguous name, (2) writes a resolution to `zoom-name-map.json`, (3) re-parses and verifies the previously-ambiguous name is now matched via `source: 'map'`.

---

### Issue 5: Missing test coverage — `min_duration` filtering (Severity: Low)

**Finding:** No integration test verifies that the `min_duration` parameter filters out participants with short attendance durations. The fixture CSV includes participants with 15-minute and 2-minute durations that are ideal for testing this.

**Impact:** Duration filtering is especially important for TA discussion sessions (per the original requirements). Without test coverage, a regression could silently mark brief drop-ins as present.

**Recommendation:** Add a test that parses with `min_duration: 20` and verifies that the 15-minute and 2-minute participants are excluded from the matched results.

---

### Issue 6: CSV fixture header casing mismatch (Severity: Resolved)

**Finding:** The test's inline CSV fixtures used different header casing than real Zoom exports. The parser was also using `findIndex` which matched meeting-level columns instead of per-participant columns in the real Zoom CSV format.

**Impact:** This was a real bug — every student would have been parsed as the host name with the meeting duration.

**Resolution:** Already fixed. Parser now prefers exact `name (original name)` header and uses `lastIndexOf` for `duration (minutes)`. Six fixture-based tests added using a real Zoom export sample. See commit `05f7cf7`.

---

### Issue 7: PII in test failure output (Severity: Low)

**Finding:** Line 337 of the integration test logs Canvas user IDs in assertion failure messages: `` `Expected score 10 for user ${s.userId}` ``. While this is test code (not production), it's inconsistent with the FERPA-blind ethos.

**Impact:** Minimal — only visible in CI/test failure logs, and Canvas user IDs alone aren't directly PII. But could be tightened for consistency.

**Recommendation:** Replace with a roster index or token reference in the assertion message.

## Summary

| # | Issue | Severity | Status | Effort |
|---|-------|----------|--------|--------|
| 1 | No attendance seed data | Medium | Open | Small — seed script + env var |
| 2 | Singleton `lastParseResult` | Medium | Open | Small — beforeEach reset or closure |
| 3 | Grade restoration empty string | Low | Open | Tiny — verify Canvas behavior |
| 4 | Missing test: re-parse after map edit | Medium | Open | Small — one new test case |
| 5 | Missing test: min_duration filtering | Low | Open | Tiny — one new test case |
| 6 | CSV duplicate column bug | Resolved | Fixed | — |
| 7 | PII in test failure messages | Low | Open | Tiny — string change |

## Recommended Scope

Issues 1, 2, 4, and 5 should be addressed as a single "attendance test hardening" unit of work. Issues 3 and 7 can be folded in or deferred. Issue 6 is already resolved.
