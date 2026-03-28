# Module Brief: attendance-roster-migration

| Field | Value |
|-------|-------|
| **Module Name** | attendance-roster-migration |
| **Purpose** | Migrate the attendance name-matching pipeline from `ZoomNameMap` (file-backed `zoom-name-map.json`) to roster-based `zoomAliases`. Eliminates `zoom-name-map.json` as a standalone file and consolidates all per-student persistent state into the roster. |
| **Boundary: Owns** | 1. Rewrite of name-matcher step 1 (persistent map lookup): build `Map<lowercaseAlias, canvasUserId>` from roster `zoomAliases` instead of `ZoomNameMap`. 2. Rewrite of name-matcher auto-save (step 3): append Zoom display name to matched student's `zoomAliases` via `RosterStore.appendZoomAlias()` instead of `ZoomNameMap.set()`. 3. Migration logic: on first parse after upgrade, if `zoom-name-map.json` exists in configDir, import each `(alias, canvasUserId)` entry into the corresponding roster entry's `zoomAliases`, then delete the file. 4. Update `registerAttendanceTools` in `packages/teacher/src/tools/attendance.ts` to use `RosterStore` instead of `ZoomNameMap`. 5. Removal of `ZoomNameMap` class and `zoom-name-map.ts` file after migration is complete. |
| **Boundary: Consumes** | `RosterStore` from `roster-crypto-store` module — specifically `load()`, `allStudents()`, `appendZoomAlias()`, `findByCanvasUserId()`. `matchAttendance()` function signature will change: the `nameMap: ZoomNameMap` parameter is replaced by a roster-derived alias map and a write-back callback. |
| **Public Surface** | **Modified function signature:** `matchAttendance(participants, roster, aliasMap, onAutoMatch?)` where `aliasMap: Map<string, number>` (lowercase zoom alias -> canvasUserId) and `onAutoMatch?: (zoomName: string, canvasUserId: number) => void` (callback for auto-save). The callback pattern decouples the matcher from RosterStore, keeping it a pure function with side-effect injection. **New function:** `migrateZoomNameMap(configDir: string, rosterStore: RosterStore): Promise<{ migrated: number; deleted: boolean }>` — one-time migration. **Removed exports:** `ZoomNameMap` class removed from `packages/core/src/attendance/index.ts` and `packages/core/src/index.ts`. |
| **External Dependencies** | None. |
| **Inherited Constraints** | The 4-step matching pipeline logic (thresholds, tiebreaking, pronoun stripping) must not change — only the data source for step 1 and the write target for auto-save change. `matchAttendance` must remain a synchronous function (current contract); the auto-save callback is fire-and-forget. The attendance tool's `WeakMap<McpServer, ParseState>` pattern is unchanged. Existing name-matcher unit tests must be adapted but their behavioral assertions preserved. |
| **Repo Location** | `packages/core/src/attendance/name-matcher.ts` — change `nameMap` param to `aliasMap` + `onAutoMatch` callback. `packages/core/src/attendance/zoom-name-map.ts` — deleted after migration function is extracted. `packages/core/src/attendance/migration.ts` — new file for `migrateZoomNameMap()`. `packages/core/src/attendance/index.ts` — update exports (remove `ZoomNameMap`, add `migrateZoomNameMap`). `packages/core/src/index.ts` — update re-exports. `packages/teacher/src/tools/attendance.ts` — replace `ZoomNameMap` usage with roster-derived alias map + write-back via `RosterStore`. **Tests:** `packages/core/tests/unit/attendance/name-matcher.test.ts` — update to use new signature. `packages/core/tests/unit/attendance/migration.test.ts` — new tests for zoom-name-map migration. `packages/core/tests/unit/attendance/zoom-name-map.test.ts` — deleted (class removed). |
| **Parallelism Hints** | `migration.ts` (new file) can be built independently of the name-matcher signature change. The name-matcher signature change and the attendance tool update are sequentially coupled (tool depends on new signature). Test updates for name-matcher can proceed in parallel with migration tests. |
| **Cross-File Coupling** | `name-matcher.ts` and `attendance.ts` (teacher) are tightly coupled for this change — the function signature change in the matcher directly affects how the tool calls it. `attendance/index.ts` and `core/src/index.ts` barrel exports must be updated together with the file deletions/additions. |
| **Execution Mode Preference** | `Tool-Integrated` — The changes are mechanical: replacing one data source with another while preserving all matching logic. The callback pattern for auto-save is straightforward. |
| **Definition of Done** | 1. `matchAttendance` uses `aliasMap: Map<string, number>` instead of `ZoomNameMap` for step 1 lookups. 2. High-confidence fuzzy matches invoke the `onAutoMatch` callback (if provided) instead of calling `nameMap.set()`. 3. `registerAttendanceTools` builds the alias map from `rosterStore.allStudents()` zoomAliases and passes a callback that calls `rosterStore.appendZoomAlias()`. 4. `migrateZoomNameMap` reads `zoom-name-map.json`, imports aliases into roster entries, and deletes the file. Returns count of migrated entries. 5. If a zoom-name-map alias references a `canvasUserId` not in the roster, it is skipped (logged to stderr). 6. `ZoomNameMap` class and `zoom-name-map.ts` file are deleted. 7. All existing name-matcher test assertions pass (adapted to new signature). 8. New migration tests cover: successful migration, missing file (no-op), alias pointing to unknown user (skip). 9. `zoom-name-map.test.ts` is deleted. 10. `packages/core/src/attendance/index.ts` and `packages/core/src/index.ts` no longer export `ZoomNameMap`. |

---

## Supplementary Analysis

### Name-Matcher Signature Change

Current:
```typescript
export function matchAttendance(
  participants: ZoomParticipant[],
  roster: RosterEntry[],
  nameMap: ZoomNameMap
): MatchResult
```

Proposed:
```typescript
export function matchAttendance(
  participants: ZoomParticipant[],
  roster: RosterEntry[],
  aliasMap: Map<string, number>,
  onAutoMatch?: (zoomName: string, canvasUserId: number) => void
): MatchResult
```

The `RosterEntry` type used in the matcher is the lightweight `{ userId, name, sortableName }` type from `attendance/types.ts` — it is NOT the `RosterStudent` type from the roster module. The attendance tool builds `RosterEntry[]` from enrollments today (line 134 of `attendance.ts`). After this migration, it can still build `RosterEntry[]` from enrollments (the roster is only used for alias lookup and write-back, not as the roster source for matching).

### Attendance Tool Changes

Current flow in `attendance.ts` parse action:
1. Fetch enrollments -> build `RosterEntry[]`
2. Load `ZoomNameMap` from configDir
3. Call `matchAttendance(filtered, roster, nameMap)`
4. Save `nameMap` to configDir

Proposed flow:
1. Fetch enrollments -> build `RosterEntry[]` (unchanged)
2. Load roster via `rosterStore.allStudents()` -> build `aliasMap` from `zoomAliases`
3. Call `matchAttendance(filtered, roster, aliasMap, (name, id) => rosterStore.appendZoomAlias(id, name))`
4. (No separate save — `appendZoomAlias` handles persistence)

Note: The `rosterStore` instance must be passed to `registerAttendanceTools`. This changes the function signature — it gains a `RosterStore` parameter. This is consistent with how `SecureStore` and `SidecarManager` are already passed.

### Migration Timing

`migrateZoomNameMap` should be called once during server startup (in `packages/teacher/src/index.ts`), after the roster is loaded but before any attendance tool call. It is idempotent — if `zoom-name-map.json` does not exist, it is a no-op.
