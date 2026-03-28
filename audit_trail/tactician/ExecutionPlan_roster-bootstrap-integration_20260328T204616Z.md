# Implementation Plan: roster-bootstrap-integration

| Field | Value |
|-------|-------|
| **Project / Module Name** | roster-bootstrap-integration |
| **Scope Summary** | Wire the roster into server startup and `set_active_course` so that: (1) `SecureStore.preload()` provides stable token ordering from roster, (2) `set_active_course` bootstraps/syncs the roster from Canvas enrollments, (3) startup uses roster-driven preloading instead of fire-and-forget enrollment pre-fetch, and (4) `CanvasEnrollment.user` gains an optional `login_id` field. |
| **Assumptions** | 1. The `roster-crypto-store` module (`RosterStore`, `RosterKeyProvider`, `createKeyProvider`) exists and is importable from `@canvas-mcp/core` before this module begins. If not, packets that depend on it will block. 2. `login_id` may or may not be returned by default on Canvas enrollment API responses; implementation must handle absence gracefully. 3. `registerContextTools` signature will be expanded to accept optional `RosterStore` and `SecureStore` parameters for the `set_active_course` sync logic. |
| **Constraints & NFRs** | `set_active_course` must not block response on roster sync failure (log warning, continue). Token assignment order must match roster insertion order. `login_id` field is optional and must not break existing code. Fire-and-forget async pattern for non-critical operations. |
| **Repo Target** | `/Users/mark/Repos/personal/canvas-mcp` |
| **Primary Interfaces** | `SecureStore.preload(students)`, `CanvasEnrollment.user.login_id`, `registerContextTools(server, client, configManager, rosterStore?, secureStore?)`, `syncRosterFromEnrollments(rosterStore, client, courseId)` in `packages/core/src/roster/sync.ts` |
| **Definition of Done** | 1. `SecureStore.preload()` registers tokens in array order; preloaded token is not duplicated when `tokenize()` is called for the same user. 2. `set_active_course` upserts each enrolled student into roster with `login_id` as first email. 3. Students no longer enrolled have course ID removed from `courseIds`. 4. Students with empty `courseIds` are retained (not deleted). 5. Startup awaits roster load and `preload()` before server connects to transport. 6. If roster unreadable at startup: log warning, fall back to existing enrollment pre-fetch, server does not crash. 7. `CanvasEnrollment.user.login_id` typed as `string | undefined`, existing code unbroken. 8. All existing `SecureStore` and `context.ts` tests pass. |

---

## Phase 1: SecureStore.preload() and CanvasEnrollment type extension

**Milestone:** `SecureStore` has a working `preload()` method that delegates to `tokenize()` in array order, and `CanvasEnrollment.user` has an optional `login_id` field. All existing tests pass; no runtime changes yet.

**Validation Gate:**
- lint: `npm run build`
- tests: `npm run test:unit` (all existing tests pass)

### Step 1.1 — SecureStore.preload() method

| Field | Value |
|-------|-------|
| **Step Name** | secure-store-preload |
| **Prerequisite State** | `packages/core/src/security/secure-store.ts` exists with `tokenize()`, `resolve()`, `listTokens()`, `destroy()` methods. |
| **Outcome** | `SecureStore` gains a `preload(students)` method that calls `tokenize()` for each student in array order. |
| **Scope / Touch List** | `packages/core/src/security/secure-store.ts` |
| **Implementation Notes** | Add a public `preload(students: Array<{ canvasUserId: number; name: string }>): void` method. Iterate `students` in order, call `this.tokenize(student.canvasUserId, student.name)` for each. Because `tokenize()` is already idempotent, `preload()` is automatically idempotent. |
| **Behavioral Intent** | **Positive cases:** (1) Given an array of 3 students `[{canvasUserId:10,name:'Alice'},{canvasUserId:20,name:'Bob'},{canvasUserId:30,name:'Charlie'}]`, calling `preload()` results in tokens `[STUDENT_001]`, `[STUDENT_002]`, `[STUDENT_003]` assigned in that order. `listTokens()` returns them in that order. `resolve('[STUDENT_001]')` returns `{canvasId:10,name:'Alice'}`. (2) Calling `preload()` with an empty array is a no-op; counter stays at 0, `listTokens()` returns `[]`. (3) Calling `preload()` twice with the same array does not duplicate tokens; counter and `listTokens()` length remain the same. (4) Calling `preload([A,B])` then `tokenize(B.canvasUserId, B.name)` returns `[STUDENT_002]` (the already-assigned token), counter stays at 2. (5) Calling `preload([A,B])` then `tokenize(C.canvasUserId, C.name)` returns `[STUDENT_003]` — new students get the next counter value after preloaded ones. **Negative/edge cases:** (1) `preload()` after `destroy()` — should still work (re-creates tokens in the destroyed store, since `tokenize()` works on an empty map). (2) Interleaved: `tokenize(X)` then `preload([X,Y])` — X already has `[STUDENT_001]`, Y gets `[STUDENT_002]`. Order in `listTokens()` is `[STUDENT_001, STUDENT_002]`. |
| **Validation Gate** | `npm run build` passes; `npm run test:unit` passes (existing + new tests) |
| **Commit** | `feat(core): add SecureStore.preload() for roster-driven token ordering` |
| **If It Fails** | Check that `preload()` delegates to `tokenize()` correctly. If counter is wrong, verify idempotency logic in `tokenize()`. |
| **Carry Forward** | `preload()` signature: `preload(students: Array<{ canvasUserId: number; name: string }>): void`. Delegates to `tokenize()`. |

### Step 1.2 — CanvasEnrollment type extension (login_id)

| Field | Value |
|-------|-------|
| **Step Name** | enrollment-login-id-type |
| **Prerequisite State** | `packages/core/src/canvas/submissions.ts` exports `CanvasEnrollment` with `user: { id, name, sortable_name }`. |
| **Outcome** | `CanvasEnrollment.user` gains optional `login_id?: string` field. Existing code continues to compile. |
| **Scope / Touch List** | `packages/core/src/canvas/submissions.ts` |
| **Implementation Notes** | Add `login_id?: string` to the `user` object in the `CanvasEnrollment` interface. This is a non-breaking additive change. |
| **Behavioral Intent** | **Positive cases:** (1) Code that accesses `enrollment.user.login_id` compiles and returns `string | undefined`. (2) All existing code that accesses `enrollment.user.id`, `enrollment.user.name`, `enrollment.user.sortable_name` continues to compile without changes. **Negative/edge cases:** (1) Enrollment objects from Canvas API that lack `login_id` property — the field is `undefined`, no runtime error. |
| **Validation Gate** | `npm run build` passes |
| **Commit** | `feat(core): add optional login_id to CanvasEnrollment.user type` |
| **If It Fails** | Check that `login_id` is marked optional (`?:`). Ensure the re-export in `packages/core/src/index.ts` is unaffected. |
| **Carry Forward** | `CanvasEnrollment.user.login_id` is `string | undefined`. |

---

## Phase 2: Roster sync logic (detail)

**Milestone:** A pure `syncRosterFromEnrollments()` function exists in `packages/core/src/roster/sync.ts` that takes a `RosterStore`, `CanvasClient`, and `courseId`, fetches enrollments, upserts students, and reconciles removals. Fully tested in isolation.

**Validation Gate:**
- lint: `npm run build`
- tests: `npm run test:unit`

### Step 2.1 — syncRosterFromEnrollments core logic

| Field | Value |
|-------|-------|
| **Step Name** | roster-sync-function |
| **Prerequisite State** | `RosterStore` is importable from `packages/core/src/roster/store.ts` (from the `roster-crypto-store` module). `CanvasEnrollment` has `login_id` field (Step 1.2). `fetchStudentEnrollments` exists in `packages/core/src/canvas/submissions.ts`. |
| **Outcome** | `syncRosterFromEnrollments(rosterStore, client, courseId)` function created in `packages/core/src/roster/sync.ts`. Returns the list of `RosterStudent[]` after sync. |
| **Scope / Touch List** | `packages/core/src/roster/sync.ts` (new file), `packages/core/src/index.ts` (export) |
| **Implementation Notes** | 1. Fetch enrollments via `fetchStudentEnrollments(client, courseId)`. 2. Load existing roster via `rosterStore.load()`. 3. For each enrollment: call `rosterStore.upsertStudent({ canvasUserId, name, sortable_name, emails: [login_id].filter(Boolean), courseIds: [courseId], zoomAliases: [] })`. The `upsertStudent` contract handles merging with existing entries (adds courseId if missing, adds email if not present, updates name). 4. For each existing student that has `courseId` in their `courseIds` but whose `canvasUserId` is NOT in the current enrollment set: call `rosterStore.removeStudentCourseId(canvasUserId, courseId)`. 5. Return `rosterStore.allStudents()`. |
| **Behavioral Intent** | **Positive cases:** (1) Given 3 enrollments for course 101 (Alice id=10 login_id='alice@uni.edu', Bob id=20 login_id='bob@uni.edu', Charlie id=30 login_id=undefined), sync creates 3 roster entries. Alice has `emails:['alice@uni.edu']`, Charlie has `emails:[]`. All have `courseIds:[101]`. (2) Calling sync again with same enrollments is idempotent — no duplicate courseIds or emails. (3) If Bob is removed from enrollments (only Alice and Charlie returned), Bob's courseId 101 is removed from his `courseIds`. Bob's entry remains in roster (retained with empty or other courseIds). (4) If a student already has courseId 200 and now appears in course 101 enrollments, their `courseIds` becomes `[200, 101]`. (5) `login_id` from enrollment becomes first email in `emails` array. **Negative/edge cases:** (1) Empty enrollment list — all existing students with this courseId have it removed, no new students added. (2) `fetchStudentEnrollments` throws — error propagates (caller is responsible for catching). (3) `login_id` is undefined for some enrollments — emails array for those students is `[]`. (4) Student name changed on Canvas — `upsertStudent` updates the name field. **Expected inputs/outputs:** Input: rosterStore (mock), client (mock returning enrollment fixtures), courseId=101. Output: RosterStudent[] reflecting the upserted state. |
| **Validation Gate** | `npm run build` passes; `npm run test:unit` passes |
| **Commit** | `feat(core): add syncRosterFromEnrollments for roster bootstrap` |
| **If It Fails** | Verify `RosterStore` is available. Check that `upsertStudent` and `removeStudentCourseId` are called with correct arguments. Verify enrollment set difference logic for removals. |
| **Carry Forward** | `syncRosterFromEnrollments(rosterStore: RosterStore, client: CanvasClient, courseId: number): Promise<RosterStudent[]>` exported from `packages/core/src/roster/sync.ts`. |

---

## Phase 3: set_active_course roster integration (outline)

**Milestone:** `set_active_course` calls `syncRosterFromEnrollments` after setting the active course, in a fire-and-forget pattern that logs warnings on failure. `registerContextTools` signature expanded to accept optional `RosterStore` and `SecureStore`.

**Estimated packets:** 2 (signature change + sync wiring, then tests verifying non-blocking behavior)

**Key risks / unknowns:**
- `registerContextTools` signature change must not break existing callers (teacher/src/index.ts, tests). Optional parameters keep backward compatibility.
- Fire-and-forget pattern means the sync promise is not awaited inside the tool handler response, but we need to test that failures are caught and logged.

**Depends on discoveries from:** Phase 2 (syncRosterFromEnrollments signature and error modes).

---

## Phase 4: Startup rewrite (outline)

**Milestone:** `packages/teacher/src/index.ts` startup sequence creates `RosterStore`, calls `rosterStore.load()` and `secureStore.preload()` awaited before `server.connect()`. Fallback to existing enrollment pre-fetch if roster is unreadable. Existing fire-and-forget block removed.

**Estimated packets:** 2 (startup rewrite, fallback behavior)

**Key risks / unknowns:**
- `createKeyProvider(config)` must be available from `roster-crypto-store` module. If not yet implemented, this phase blocks.
- Startup must not crash if roster file doesn't exist or is corrupted — fallback to enrollment pre-fetch.
- `configDir` derivation already exists in index.ts (line 33); reuse it for `RosterStore` constructor.

**Depends on discoveries from:** Phase 1 (preload signature), Phase 2 (sync function), Phase 3 (registerContextTools signature).

---

## Execution Packets — Phase 1

### Packet 1.1

| Field | Value |
|-------|-------|
| **Packet ID** | 1.1 |
| **Depends On** | none |
| **Prerequisite State** | `packages/core/src/security/secure-store.ts` exists with class `SecureStore` containing `tokenize(canvasUserId: number, name: string): string`, `resolve(token: string)`, `listTokens(): string[]`, `destroy(): void`. Test file at `packages/core/tests/unit/security/secure-store.test.ts` has existing passing tests. |
| **Objective** | Add `preload(students: Array<{ canvasUserId: number; name: string }>): void` method to `SecureStore`. |
| **Allowed Files** | `packages/core/src/security/secure-store.ts`, `packages/core/tests/unit/security/secure-store.test.ts` |
| **Behavioral Intent** | **Positive cases:** (1) `preload([{canvasUserId:10,name:'Alice'},{canvasUserId:20,name:'Bob'},{canvasUserId:30,name:'Charlie'}])` assigns tokens `[STUDENT_001]`, `[STUDENT_002]`, `[STUDENT_003]` in that order. `listTokens()` returns them in order. `resolve('[STUDENT_001]')` returns `{canvasId:10,name:'Alice'}`. (2) `preload([])` is a no-op — `listTokens()` returns `[]`, counter stays 0. (3) `preload([A,B])` called twice — second call is no-op; `listTokens()` still has length 2. (4) `preload([A,B])` then `tokenize(B.canvasUserId, B.name)` returns `[STUDENT_002]` (already assigned), counter stays 2. (5) `preload([A,B])` then `tokenize(C.canvasUserId, C.name)` returns `[STUDENT_003]` — next counter value. **Negative/edge:** (1) `tokenize(X)` then `preload([X,Y])` — X keeps `[STUDENT_001]`, Y gets `[STUDENT_002]`. `listTokens()` order: `[STUDENT_001, STUDENT_002]`. (2) `preload()` after `destroy()` — tokens re-created starting from counter 0 (store is empty). |
| **Checklist** | 1. Add `preload(students: Array<{ canvasUserId: number; name: string }>): void` method to `SecureStore` class. 2. Implementation: iterate `students` in order, call `this.tokenize(student.canvasUserId, student.name)` for each. 3. No changes to existing methods. |
| **Commands** | `npm run build && npm run test:unit` |
| **Pass Condition** | Build succeeds. All existing SecureStore tests pass. New preload tests pass. |
| **Commit Message** | `feat(core): add SecureStore.preload() for roster-driven token ordering` |
| **Stop / Escalate If** | `tokenize()` behavior has changed since the brief was written (e.g., no longer idempotent). |

### Packet 1.2

| Field | Value |
|-------|-------|
| **Packet ID** | 1.2 |
| **Depends On** | none (independent of 1.1) |
| **Prerequisite State** | `packages/core/src/canvas/submissions.ts` exports `CanvasEnrollment` interface with `user: { id: number; name: string; sortable_name: string }`. |
| **Objective** | Add optional `login_id?: string` to `CanvasEnrollment.user` type. |
| **Allowed Files** | `packages/core/src/canvas/submissions.ts` |
| **Behavioral Intent** | **Positive cases:** (1) `enrollment.user.login_id` compiles and is `string | undefined`. (2) All existing code accessing `enrollment.user.id`, `.name`, `.sortable_name` continues to compile. **Negative/edge:** (1) Canvas API responses that omit `login_id` — field is `undefined` at runtime, no error. (2) Existing tests that construct `CanvasEnrollment` objects without `login_id` — still compile and pass. |
| **Checklist** | 1. Add `login_id?: string` to the `user` property of the `CanvasEnrollment` interface. |
| **Commands** | `npm run build` |
| **Pass Condition** | Build succeeds. All existing tests pass (no test changes needed for a type-only addition). |
| **Commit Message** | `feat(core): add optional login_id to CanvasEnrollment.user type` |
| **Stop / Escalate If** | `CanvasEnrollment` is exported from multiple files or the re-export in `index.ts` causes a conflict. |

---

## Execution Packets — Phase 2

### Packet 2.1

| Field | Value |
|-------|-------|
| **Packet ID** | 2.1 |
| **Depends On** | 1.2 |
| **Prerequisite State** | `CanvasEnrollment.user.login_id` exists as `string | undefined` (Packet 1.2). `RosterStore` class exists at `packages/core/src/roster/store.ts` with methods: `load(): Promise<RosterStudent[]>`, `save(students): Promise<void>`, `upsertStudent(student): Promise<void>`, `removeStudentCourseId(canvasUserId, courseId): Promise<void>`, `allStudents(): Promise<RosterStudent[]>`. `RosterStudent` type exists at `packages/core/src/roster/types.ts`. `fetchStudentEnrollments` exists in `packages/core/src/canvas/submissions.ts`. |
| **Objective** | Create `syncRosterFromEnrollments(rosterStore, client, courseId)` function that fetches enrollments, upserts each student into the roster, and reconciles removals. |
| **Allowed Files** | `packages/core/src/roster/sync.ts` (new), `packages/core/src/roster/index.ts` (if barrel exists, add export), `packages/core/src/index.ts` (add export), `packages/core/tests/unit/roster/sync.test.ts` (new) |
| **Behavioral Intent** | **Positive cases:** (1) 3 enrollments for course 101: Alice (id=10, login_id='alice@uni.edu'), Bob (id=20, login_id='bob@uni.edu'), Charlie (id=30, login_id=undefined). After sync: 3 students in roster. Alice has `emails:['alice@uni.edu']`, `courseIds:[101]`. Charlie has `emails:[]`. (2) Second sync with same enrollments — idempotent, no duplicate courseIds or emails. (3) Sync with Bob removed — Bob's courseId 101 removed. Bob's entry retained in roster. (4) Student with existing courseId 200 appears in course 101 — `courseIds` becomes `[200, 101]`. (5) Returns full `RosterStudent[]` after sync. **Negative/edge:** (1) Empty enrollment list — existing students with this courseId have it removed. (2) `fetchStudentEnrollments` throws — error propagates to caller. (3) `login_id` undefined for some — those students get `emails:[]`. (4) Student name changed on Canvas — upsertStudent updates name. **Inputs/Outputs:** Mock `RosterStore` with jest/vitest spies. Mock `CanvasClient` or `fetchStudentEnrollments` to return enrollment fixtures. Input: courseId=101. Output: `RosterStudent[]`. Verify `upsertStudent` called with correct args per enrollment; `removeStudentCourseId` called for removed students. |
| **Checklist** | 1. Create `packages/core/src/roster/sync.ts`. 2. Import `RosterStore`, `RosterStudent`, `CanvasClient`, `fetchStudentEnrollments`, `CanvasEnrollment`. 3. Export `async function syncRosterFromEnrollments(rosterStore: RosterStore, client: CanvasClient, courseId: number): Promise<RosterStudent[]>`. 4. Fetch enrollments via `fetchStudentEnrollments(client, courseId)`. 5. Load existing roster via `rosterStore.load()`. 6. Build a `Set<number>` of enrolled canvas user IDs. 7. For each enrollment: call `rosterStore.upsertStudent({ canvasUserId: e.user_id, name: e.user.name, sortable_name: e.user.sortable_name, emails: e.user.login_id ? [e.user.login_id] : [], courseIds: [courseId], zoomAliases: [] })`. 8. For each existing student whose `courseIds` includes `courseId` but whose `canvasUserId` is NOT in the enrolled set: call `rosterStore.removeStudentCourseId(student.canvasUserId, courseId)`. 9. Return `rosterStore.allStudents()`. 10. Add export to `packages/core/src/index.ts`. |
| **Commands** | `npm run build && npm run test:unit` |
| **Pass Condition** | Build succeeds. New sync tests pass. All existing tests pass. |
| **Commit Message** | `feat(core): add syncRosterFromEnrollments for roster bootstrap` |
| **Stop / Escalate If** | `RosterStore` is not yet available (roster-crypto-store module not implemented). `upsertStudent` contract differs from what's described in the brief (e.g., doesn't handle merging courseIds). |

---

## Phase 3 and 4 packets will be promoted to full detail after Phase 2 Result Bundles are integrated.

Phase 3 will cover:
- Packet 3.1: Expand `registerContextTools` signature to accept optional `RosterStore` and `SecureStore`; wire `set_active_course` to call `syncRosterFromEnrollments` + `secureStore.preload()` in fire-and-forget pattern after setting active course. Existing callers unbroken (parameters optional).
- Packet 3.2: Tests for the fire-and-forget sync behavior — verify sync failure logs warning but tool still returns success; verify sync calls `syncRosterFromEnrollments` then `preload()` with correct students.

Phase 4 will cover:
- Packet 4.1: Rewrite startup in `packages/teacher/src/index.ts` — create `RosterStore`, await `load()` + `preload()`, pass `rosterStore` and `secureStore` to `registerContextTools`. Remove existing fire-and-forget enrollment pre-fetch.
- Packet 4.2: Startup fallback — if `rosterStore.load()` throws, log warning, fall back to existing enrollment pre-fetch pattern. Server must not crash.
