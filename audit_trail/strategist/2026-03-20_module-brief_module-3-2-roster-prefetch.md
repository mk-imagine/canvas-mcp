# Module Brief — Module 3.2: Server-Start Roster Pre-Fetch

**Brief type:** Module Brief
**Prepared by:** SoftwareScopeStrategist
**Date:** 2026-03-20
**Module:** 3.2 of canvas-mcp Roadmap
**Specification:** `ROADMAP.md` §3.2, `docs/PII_ARCHITECTURE.md` §5.2, §6
**Status:** Ready for Tactician
**Scope type:** Single-task, single-file change

---

## 1. Context Verification

All referenced interfaces confirmed against current source:

| Item | Location | Status |
|---|---|---|
| `fetchStudentEnrollments(client, courseId)` | `packages/core/src/canvas/submissions.ts` L61–68 | Confirmed exported via `packages/core/src/index.ts` L23 |
| `SecureStore.tokenize(canvasUserId, name)` | `packages/core/src/security/secure-store.ts` L56 | Confirmed — idempotent, takes `(number, string)`, returns `string` |
| `SidecarManager.sync(store)` | `packages/core/src/security/sidecar-manager.ts` L25 | Confirmed — takes `SecureStore`, returns `boolean` |
| `CanvasEnrollment` shape | `packages/core/src/canvas/submissions.ts` L27–43 | `enrollment.user_id: number`, `enrollment.user.name: string`; API filter `'type[]': 'StudentEnrollment'` applied at HTTP level |
| Startup sequence | `packages/teacher/src/index.ts` L1–62 | Full file read — see §2 below |

---

## 2. Current Startup Sequence (Annotated)

```
L11   new SecureStore()
L13   parse --config flag
L15   new ConfigManager(configPath)
L16   config = configManager.read()         ← config.privacy.blindingEnabled available here
L18   new SidecarManager(...)
L20   register signal handlers (SIGINT, SIGTERM, SIGHUP, uncaughtException)
L26   new CanvasClient(config.canvas)       ← client available here
L28   destructure activeCourseId, courseCache from config.program
L30   let instructions: string              ← INSERT PRE-FETCH BLOCK BETWEEN L28 AND L30
...
L56   await server.connect(new StdioServerTransport())
```

The pre-fetch fires after L28 (all dependencies available) and before L56 (server.connect). It is fire-and-forget so it does not delay `server.connect`.

---

## 3. Task 3.2.1 — Add Roster Pre-Fetch to `packages/teacher/src/index.ts`

**Single task. No subtasks. Only one file changes.**

### Import addition

`fetchStudentEnrollments` is re-exported from `@canvas-mcp/core`. Add it to the existing import on line 3:

**Current:**
```typescript
import { ConfigManager, CanvasClient, SecureStore, SidecarManager, registerContextTools } from '@canvas-mcp/core'
```

**Updated:**
```typescript
import { ConfigManager, CanvasClient, SecureStore, SidecarManager, registerContextTools, fetchStudentEnrollments } from '@canvas-mcp/core'
```

### Code block to insert

Insert immediately after line 28 (`const { activeCourseId, courseCache } = config.program`) and before line 30 (`let instructions: string`):

```typescript
  // 3.2 — Server-start roster pre-fetch
  // Fire-and-forget: populate SecureStore before any tool call to eliminate
  // the first-message blindspot (PII_ARCHITECTURE.md §5.2).
  if (config.privacy.blindingEnabled && activeCourseId !== null) {
    void (async () => {
      try {
        const enrollments = await fetchStudentEnrollments(client, activeCourseId)
        for (const enrollment of enrollments) {
          secureStore.tokenize(enrollment.user_id, enrollment.user.name)
        }
        const synced = sidecarManager.sync(secureStore)
        if (synced) {
          process.stderr.write(
            `[canvas-mcp] Pre-fetched ${enrollments.length} students into SecureStore.\n`
          )
        }
      } catch (err) {
        process.stderr.write(
          `[canvas-mcp] Roster pre-fetch failed (non-fatal): ${(err as Error).message}\n`
        )
      }
    })()
  }
```

### Precise insertion point

```typescript
  const { activeCourseId, courseCache } = config.program   // line 28 — ABOVE
  // <<< INSERT BLOCK HERE >>>
  let instructions: string                                  // line 30 — BELOW
```

### Why this location is correct

- `client` — constructed at L26 ✓
- `activeCourseId` — destructured at L28 ✓
- `secureStore` — constructed at L11 ✓
- `sidecarManager` — constructed at L18 ✓
- `config.privacy.blindingEnabled` — available at L16 ✓
- The async IIFE is void-called; execution continues synchronously to `server.connect` on L56 — no startup delay ✓

---

## 4. Risks Resolved

### Risk 1: Ordering with 3.1 (SidecarManager vs PiiServer)

3.1 has not landed. The codebase still uses `SidecarManager` throughout `index.ts`. The pre-fetch block correctly calls `sidecarManager.sync(secureStore)` for the current state.

**Migration note for 3.1:** When 3.1 replaces `SidecarManager` with `PiiServer`, remove the `sidecarManager.sync(secureStore)` call from inside the pre-fetch block (the log line remains unchanged). Two-line change at 3.1 integration time. Not a blocker now.

### Risk 2: Fire-and-forget vs. await

The `void (async () => { ... })()` IIFE pattern is correct and idiomatic. The `void` operator satisfies `@typescript-eslint/no-floating-promises` if active. `server.connect` on L56 proceeds immediately — fetch runs concurrently in the Node.js event loop.

### Risk 3: `fetchStudentEnrollments` pagination

`CanvasClient.get<T>()` auto-paginates via `Link: rel="next"` headers. For any realistic classroom size (20–200 students) the fetch completes in one or two pages, well within the first LLM turn's processing time.

### Risk 4: `enrollment_state` filtering

The Canvas API endpoint with `type[]=StudentEnrollment` returns all enrollment states by default (active, inactive, invited, completed). Pre-fetching all states is the safe, inclusive default — ensures any student name the teacher might mention is already tokenized. If active-only is needed in future, add `'state[]': 'active'` to `fetchStudentEnrollments` parameters.

### Risk 5: Import availability

`fetchStudentEnrollments` is explicitly re-exported from `@canvas-mcp/core` at `packages/core/src/index.ts` L23. No changes to core's public API are required.

### Risk 6: Stderr log condition

Log message is inside `if (synced)`. Because the outer guard (`config.privacy.blindingEnabled && activeCourseId !== null`) prevents reaching the sync call when blinding is disabled, `synced` will be `true` on success for any reachable code path. Correct behavior.

---

## 5. Acceptance Criteria

- [ ] When `blindingEnabled: true` and `activeCourseId` is set, server startup triggers a background fetch of all student enrollments for the active course
- [ ] Each enrollment is tokenized via `secureStore.tokenize(enrollment.user_id, enrollment.user.name)`
- [ ] `sidecarManager.sync(secureStore)` is called after the tokenization loop completes
- [ ] Stderr receives: `[canvas-mcp] Pre-fetched N students into SecureStore.` where N is the count returned
- [ ] `server.connect` is not delayed — pre-fetch is fire-and-forget
- [ ] If the fetch throws, a non-fatal error is written to stderr and the server starts normally
- [ ] When `blindingEnabled: false`, no pre-fetch runs and no log is emitted
- [ ] When `activeCourseId` is null, no pre-fetch runs and no log is emitted
- [ ] After pre-fetch completes, a `before_model` hook reading the sidecar finds all enrolled student names already mapped to tokens

---

## 6. Dependency Graph

```
Module 3.2 has no upstream dependencies.

Module 3.2 is a soft upstream of Module 3.1:
  When 3.1 lands, remove sidecarManager.sync() from the pre-fetch block.
  Minor integration edit at 3.1 time — not a blocker.
```

---

## 7. Ready for Tactician Checklist

- [x] Single file changes: `packages/teacher/src/index.ts` only
- [x] Exact insertion point identified by surrounding source lines
- [x] Import addition specified (before/after)
- [x] All referenced functions confirmed exported and signatures verified
- [x] Fire-and-forget pattern specified (void IIFE)
- [x] Graceful failure path specified (try/catch, stderr log)
- [x] Stderr log format specified exactly
- [x] 3.1 ordering risk resolved with explicit migration note
- [x] No new files required
- [x] No new exports required
- [x] No changes to `packages/core`
- [x] TypeScript pattern handles floating promise lint rules

---

## Critical Files for Implementation

| File | Role |
|---|---|
| `packages/teacher/src/index.ts` | Only file that changes; import on L3, block inserts after L28 |
| `packages/core/src/canvas/submissions.ts` | Source of `fetchStudentEnrollments`; signature: `(client: CanvasClient, courseId: number) => Promise<CanvasEnrollment[]>` |
| `packages/core/src/security/secure-store.ts` | `tokenize(canvasUserId: number, name: string): string` — idempotent, safe to call in bulk |
| `packages/core/src/security/sidecar-manager.ts` | `sync(store: SecureStore): boolean` — call after tokenization loop; returns `true` when file is written |
