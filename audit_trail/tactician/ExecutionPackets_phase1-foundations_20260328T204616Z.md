# Execution Packets — Phase 1: SecureStore.preload() and CanvasEnrollment type extension

Module: roster-bootstrap-integration
Dispatched: 2026-03-28T20:46:16Z

---

## Packet 1.1

| Field | Value |
|-------|-------|
| **Packet ID** | 1.1 |
| **Depends On** | none |
| **Prerequisite State** | `packages/core/src/security/secure-store.ts` exists with class `SecureStore` containing `tokenize(canvasUserId: number, name: string): string`, `resolve(token: string)`, `listTokens(): string[]`, `destroy(): void`. Test file at `packages/core/tests/unit/security/secure-store.test.ts` has existing passing tests. |
| **Objective** | Add `preload(students: Array<{ canvasUserId: number; name: string }>): void` method to `SecureStore`. |
| **Allowed Files** | `packages/core/src/security/secure-store.ts`, `packages/core/tests/unit/security/secure-store.test.ts` |
| **Behavioral Intent** | **Positive cases:** (1) `preload([{canvasUserId:10,name:'Alice'},{canvasUserId:20,name:'Bob'},{canvasUserId:30,name:'Charlie'}])` assigns tokens `[STUDENT_001]`, `[STUDENT_002]`, `[STUDENT_003]` in that order. `listTokens()` returns them in order. `resolve('[STUDENT_001]')` returns `{canvasId:10,name:'Alice'}`. (2) `preload([])` is a no-op — `listTokens()` returns `[]`, counter stays 0. (3) `preload([A,B])` called twice — second call is no-op; `listTokens()` still has length 2. (4) `preload([A,B])` then `tokenize(B.canvasUserId, B.name)` returns `[STUDENT_002]` (already assigned), counter stays 2. (5) `preload([A,B])` then `tokenize(C.canvasUserId, C.name)` returns `[STUDENT_003]` — next counter value. **Negative/edge:** (1) `tokenize(X)` then `preload([X,Y])` — X keeps `[STUDENT_001]`, Y gets `[STUDENT_002]`. `listTokens()` order: `[STUDENT_001, STUDENT_002]`. (2) `preload()` after `destroy()` — tokens re-created starting from counter 0 (store is empty after destroy, so preload re-populates from scratch). |
| **Checklist** | 1. Add `preload(students: Array<{ canvasUserId: number; name: string }>): void` method to `SecureStore` class. 2. Implementation: iterate `students` in order, call `this.tokenize(student.canvasUserId, student.name)` for each. 3. No changes to existing methods. |
| **Commands** | `npm run build && npm run test:unit` |
| **Pass Condition** | Build succeeds. All existing SecureStore tests pass. New preload tests pass. |
| **Commit Message** | `feat(core): add SecureStore.preload() for roster-driven token ordering` |
| **Stop / Escalate If** | `tokenize()` behavior has changed since the brief was written (e.g., no longer idempotent). |
| **CF Context** | — |
| **Resolves** | — |

---

## Packet 1.2

| Field | Value |
|-------|-------|
| **Packet ID** | 1.2 |
| **Depends On** | none (independent of 1.1) |
| **Prerequisite State** | `packages/core/src/canvas/submissions.ts` exports `CanvasEnrollment` interface with `user: { id: number; name: string; sortable_name: string }`. Exported via explicit named export in `packages/core/src/index.ts`. |
| **Objective** | Add optional `login_id?: string` to `CanvasEnrollment.user` type. |
| **Allowed Files** | `packages/core/src/canvas/submissions.ts` |
| **Behavioral Intent** | **Positive cases:** (1) `enrollment.user.login_id` compiles and is `string | undefined`. (2) All existing code accessing `enrollment.user.id`, `.name`, `.sortable_name` continues to compile without changes. **Negative/edge:** (1) Canvas API responses that omit `login_id` — field is `undefined` at runtime, no error. (2) Existing tests that construct `CanvasEnrollment` objects without `login_id` property — still compile and pass because the field is optional. |
| **Checklist** | 1. Add `login_id?: string` to the `user` property of the `CanvasEnrollment` interface in `packages/core/src/canvas/submissions.ts`. |
| **Commands** | `npm run build && npm run test:unit` |
| **Pass Condition** | Build succeeds. All existing tests pass unchanged. |
| **Commit Message** | `feat(core): add optional login_id to CanvasEnrollment.user type` |
| **Stop / Escalate If** | `CanvasEnrollment` is re-exported in a way that causes a type conflict, or the `user` property is defined elsewhere. |
| **CF Context** | — |
| **Resolves** | — |
