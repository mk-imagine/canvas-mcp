# Module Brief: roster-bootstrap-integration

| Field | Value |
|-------|-------|
| **Module Name** | roster-bootstrap-integration |
| **Purpose** | Wire the roster into server startup and the `set_active_course` tool so that: (1) `SecureStore` tokens are stable across restarts via a new `preload()` method, (2) `set_active_course` bootstraps/syncs the roster from Canvas enrollments, and (3) the existing enrollment pre-fetch at startup is replaced by roster-driven preloading. |
| **Boundary: Owns** | 1. `SecureStore.preload(students: RosterStudent[])` method — registers tokens in roster insertion order before any tool call. 2. Roster bootstrap logic in `set_active_course`: fetch enrollments, upsert each student into roster (with `login_id` as email, `courseIds` update), reconcile removals (students no longer enrolled have the course ID removed from `courseIds`). 3. Startup roster load in `packages/teacher/src/index.ts`: initialize `RosterStore`, call `SecureStore.preload()` with roster contents, replace the existing fire-and-forget enrollment pre-fetch. 4. `CanvasEnrollment` type extension: add `user.login_id?: string` field. 5. `fetchStudentEnrollments` update: request `login_id` in the enrollment API include params if not already present. |
| **Boundary: Consumes** | `RosterStore` and `RosterKeyProvider` from `roster-crypto-store` module. `ConfigManager` for config reads/writes. `CanvasClient` and `fetchStudentEnrollments` for Canvas API calls. `SecureStore` (existing class, modified in-place). `SidecarManager` (existing, unchanged — sidecar sync still happens after preload). |
| **Public Surface** | **Modified class:** `SecureStore` gains `preload(students: Array<{ canvasUserId: number; name: string }>): void` — idempotent, calls `tokenize()` for each student in array order. Must be called before any tool handler runs. **Modified function:** `registerContextTools` — `set_active_course` handler gains roster bootstrap/sync logic after setting the active course ID. **Modified type:** `CanvasEnrollment.user` gains optional `login_id: string` field. |
| **External Dependencies** | None beyond what `roster-crypto-store` provides. |
| **Inherited Constraints** | `set_active_course` must remain a fast, user-facing tool — roster sync should not block the response if it fails (log warning to stderr, still set the active course). The existing pattern of fire-and-forget async in `index.ts` (lines 52-71) is the model for non-blocking startup work. Token assignment order must match roster insertion order (proposal Decision #5). `CanvasEnrollment` type change must not break existing consumers — `login_id` is optional. |
| **Repo Location** | `packages/core/src/security/secure-store.ts` — add `preload()` method. `packages/core/src/canvas/submissions.ts` — extend `CanvasEnrollment` type with `login_id`. `packages/core/src/tools/context.ts` — add roster bootstrap/sync to `set_active_course`. `packages/teacher/src/index.ts` — replace enrollment pre-fetch with roster-driven preload. **Tests:** `packages/core/tests/unit/security/secure-store.test.ts` — add `preload()` tests. `packages/core/tests/unit/tools/context.test.ts` — add roster sync tests (mock `RosterStore`). `packages/teacher/tests/unit/startup.test.ts` — verify preload wiring (if feasible; may be integration-level). |
| **Parallelism Hints** | `SecureStore.preload()` implementation + tests can proceed independently of `set_active_course` changes. `CanvasEnrollment` type extension is a leaf change. `set_active_course` roster sync and `index.ts` startup changes are sequentially coupled (startup depends on the sync logic existing). |
| **Cross-File Coupling** | `context.ts` (set_active_course) and `index.ts` (startup) both instantiate/use `RosterStore` — changes to `RosterStore`'s constructor signature affect both. `secure-store.ts` preload method is consumed by `index.ts` startup code. These three files form a coupled set for this module. |
| **Execution Mode Preference** | `Guided Execution` — The interaction between roster sync, enrollment pre-fetch replacement, and error handling (what happens when roster is unreadable at startup?) involves decisions that benefit from user review. |
| **Definition of Done** | 1. `SecureStore.preload()` registers tokens in array order; calling `preload()` then `tokenize()` for the same user returns the preloaded token (no duplicate). 2. `set_active_course` fetches enrollments, upserts each student into the roster with `login_id` as the first email entry, and writes the updated roster. 3. Students no longer enrolled in the course have that course's ID removed from their `courseIds` array during `set_active_course`. 4. Students with empty `courseIds` are retained (not deleted) per Decision #8. 5. Server startup loads the roster and calls `preload()` before the MCP server connects to transport. 6. If the roster is unreadable (key unavailable, corrupt file), startup logs a warning and falls back to the existing enrollment-based pre-fetch behavior — the server does not crash. 7. `CanvasEnrollment.user.login_id` is typed as `string \| undefined` and does not break existing code. 8. Existing unit tests for `SecureStore`, `context.ts` continue to pass. New tests cover preload idempotency, roster sync upsert/removal logic. |

---

## Supplementary Analysis

### Startup Sequence (revised)

Current startup:
1. `new SecureStore()`
2. `ConfigManager.read()`
3. `new SidecarManager(...)`
4. Fire-and-forget: `fetchStudentEnrollments` -> `secureStore.tokenize` for each
5. `server.connect()`

Proposed startup:
1. `new SecureStore()`
2. `ConfigManager.read()`
3. `createKeyProvider(config)` -> `new RosterStore(configDir, keyProvider)`
4. `rosterStore.load()` -> `secureStore.preload(students)` (synchronous token registration)
5. `new SidecarManager(...)` -> `sidecarManager.sync(secureStore)` (write preloaded tokens to sidecar)
6. `server.connect()`

The fire-and-forget enrollment fetch is removed. Roster load is awaited before server connect to guarantee token stability. If roster load fails, fall back to the current fire-and-forget pattern.

### `login_id` Availability

The Canvas Enrollments API returns `user.login_id` when the caller has admin or teacher permissions. The existing `fetchStudentEnrollments` call does not include any `include[]` params. `login_id` is a top-level field on the user object and is returned by default for teachers — no additional include param should be needed. However, this should be validated during implementation; if `login_id` is not present by default, add `include[]=email` to the enrollment API call.

### set_active_course Roster Sync Flow

```
1. Fetch enrollments for the new active course
2. Load existing roster (may be empty on first run)
3. For each enrollment:
   a. Find existing roster entry by canvasUserId
   b. If found: update name, sortable_name; add courseId if not present; update login_id email if not in emails[]
   c. If not found: create new entry with canvasUserId, name, sortable_name, emails=[login_id], courseIds=[courseId], zoomAliases=[], created=now
4. For each existing roster entry with this courseId:
   a. If canvasUserId not in current enrollments: remove this courseId from courseIds[]
5. Save roster
```

This logic is owned by this module but may be extracted into a helper function in `packages/core/src/roster/sync.ts` for testability.
