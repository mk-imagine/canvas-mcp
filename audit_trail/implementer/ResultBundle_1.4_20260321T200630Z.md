### Result: 1.4
Status: complete
Objective: Add `gradeSubmission` Canvas API wrapper that PUTs a grade for a student on an assignment.
Files changed:
- `packages/core/src/canvas/submissions.ts`
- `packages/core/src/index.ts`
- `packages/core/tests/unit/canvas/submissions.test.ts` (new)

Changes:
- Added `gradeSubmission(client, courseId, assignmentId, userId, score)` function to `submissions.ts` that calls `client.put` with `{ submission: { posted_grade: String(score) } }`
- Added `gradeSubmission` to the explicit named exports in `core/src/index.ts`

Deviations from packet:
- Packet stated "Tested via MSW in the attendance tool unit tests (Phase 3)" but user requested tests-first approach. Added a dedicated unit test file `packages/core/tests/unit/canvas/submissions.test.ts` with 3 MSW-backed test cases.

Tests added/updated:
- `packages/core/tests/unit/canvas/submissions.test.ts`
  - sends PUT with correct path and posted_grade body
  - sends score as string in posted_grade (verifies fractional scores like 7.5)
  - throws on non-OK response (404 case)

Validation:
- Ran: `vitest run tests/unit/canvas/submissions.test.ts` -> 3 passed
- Ran: `npm run test:unit` -> 144 passed (all 5 test files)
- Ran: `npm run build` -> ok (no errors)

Commit:
- Message: feat(core): add gradeSubmission Canvas API function
- Hash: 1cb3699
- Files: packages/core/src/canvas/submissions.ts, packages/core/src/index.ts, packages/core/tests/unit/canvas/submissions.test.ts

Retry attempted: N/A

Carry-forward context:
- `gradeSubmission(client: CanvasClient, courseId: number, assignmentId: number, userId: number, score: number): Promise<CanvasSubmission>` exported from `@canvas-mcp/core`
- Score is stringified via `String(score)` and sent as `posted_grade` in the submission body
- Function uses `client.put<CanvasSubmission>` which throws `CanvasApiError` on non-OK responses
