# Implementation Plan: attendance-roster-migration

| Field | Value |
|-------|-------|
| **Project / Module Name** | attendance-roster-migration |
| **Scope Summary** | Migrate the attendance name-matching pipeline from `ZoomNameMap` (file-backed `zoom-name-map.json`) to roster-based `zoomAliases`. Eliminate `zoom-name-map.json` as a standalone file; consolidate all per-student persistent state into the roster via `RosterStore`. |
| **Assumptions** | 1. `RosterStore` is available with `allStudents()`, `appendZoomAlias()`, `findByCanvasUserId()` per the contract in the brief. **If RosterStore is not yet implemented, Phase 1-2 can proceed against the interface contract, but Phase 3 (attendance tool wiring) will block.** 2. `RosterStudent.zoomAliases` is `string[]` (lowercase Zoom display names). 3. The `MatchResult` type and the 4-step pipeline logic (thresholds, tiebreaking, pronoun stripping) are frozen — only data source (step 1) and write target (step 3 auto-save) change. |
| **Constraints & NFRs** | `matchAttendance` must remain synchronous; the `onAutoMatch` callback is fire-and-forget. `WeakMap<McpServer, ParseState>` pattern unchanged. No new external dependencies. |
| **Repo Target** | `/Users/mark/Repos/personal/canvas-mcp` — `packages/core` and `packages/teacher` |
| **Primary Interfaces** | **Modified:** `matchAttendance(participants, roster, aliasMap: Map<string, number>, onAutoMatch?)` **New:** `migrateZoomNameMap(configDir, rosterStore)` **Removed:** `ZoomNameMap` class |
| **Definition of Done** | 1. `matchAttendance` uses `aliasMap` for step 1 lookups. 2. High-confidence fuzzy matches invoke `onAutoMatch` callback. 3. `registerAttendanceTools` builds alias map from `rosterStore.allStudents()` and passes `rosterStore.appendZoomAlias` as callback. 4. `migrateZoomNameMap` reads `zoom-name-map.json`, imports into roster, deletes file. 5. Unknown canvasUserId entries: skip + log to stderr. 6. `ZoomNameMap` class and file deleted. 7. Existing name-matcher tests pass (adapted). 8. Migration tests cover: success, missing file, unknown user. 9. `zoom-name-map.test.ts` deleted. 10. Barrel exports updated. |

---

## Phase 1: name-matcher signature migration (full detail)

Migrate `matchAttendance` from `ZoomNameMap` to `aliasMap: Map<string, number>` + `onAutoMatch` callback. This is the core change — all downstream work depends on it.

```
Milestone: matchAttendance accepts aliasMap + onAutoMatch; all existing test
           assertions pass (adapted to new signature); ZoomNameMap import removed
           from name-matcher.ts.
Validation Gate:
  lint: npm run build (core compiles with new signature)
```

### Step 1.1: Change matchAttendance signature and internal logic

| Field | Value |
|-------|-------|
| **Step Name** | matchAttendance-signature-change |
| **Prerequisite State** | `packages/core/src/attendance/name-matcher.ts` exists with current `ZoomNameMap`-based signature. |
| **Outcome** | `matchAttendance` accepts `aliasMap: Map<string, number>` and optional `onAutoMatch` callback instead of `ZoomNameMap`. |
| **Scope / Touch List** | `packages/core/src/attendance/name-matcher.ts` |
| **Implementation Notes** | 1. Replace `nameMap: ZoomNameMap` param with `aliasMap: Map<string, number>` and `onAutoMatch?: (zoomName: string, canvasUserId: number) => void`. 2. Step 1 lookup: replace `nameMap.get(participant.name)` with `aliasMap.get(participant.name.toLowerCase())`. 3. Step 3 auto-save: replace `nameMap.set(participant.name, best.canvasUserId)` with `if (onAutoMatch) onAutoMatch(participant.name, best.canvasUserId)`. 4. Remove `import type { ZoomNameMap }` from the file. 5. Update JSDoc to reflect new params. |
| **Behavioral Intent** | **Positive cases:** (a) When `aliasMap` contains a lowercase key matching `participant.name.toLowerCase()`, return that participant as `source: 'map'` with the mapped userId. (b) When a high-confidence fuzzy match is found (distance < 0.45, unique best), invoke `onAutoMatch(participantName, bestCanvasUserId)` exactly once. (c) When `onAutoMatch` is omitted (undefined), fuzzy auto-match still succeeds — callback is optional. **Negative/error cases:** (a) `aliasMap` entry points to userId not in roster — fall through to exact/fuzzy (same as current behavior). (b) Empty `aliasMap` — step 1 never matches, pipeline proceeds normally. **Edge conditions:** (a) Participant name casing differs from alias key — lookup is lowercase so "JSmith_Zoom" matches key "jsmith_zoom". (b) `onAutoMatch` callback throws — caller's responsibility; `matchAttendance` does not catch. **Example inputs/outputs:** `aliasMap = new Map([["jsmith_zoom", 1]])`, participant `{name: "jsmith_zoom", ...}` -> matched with `source: 'map'`, `canvasUserId: 1`. |
| **Validation Gate** | `npm run build` from repo root (core must compile) |
| **Commit** | `refactor(core): migrate matchAttendance from ZoomNameMap to aliasMap + onAutoMatch callback` |
| **If It Fails** | Check that `ZoomNameMap` import is fully removed. Verify `Map.get()` uses lowercase key. Confirm `onAutoMatch` is only called in the fuzzy auto-match branch (line ~143 in current code). |
| **Carry Forward** | New signature: `matchAttendance(participants: ZoomParticipant[], roster: RosterEntry[], aliasMap: Map<string, number>, onAutoMatch?: (zoomName: string, canvasUserId: number) => void): MatchResult`. |

### Step 1.2: Adapt name-matcher tests to new signature

| Field | Value |
|-------|-------|
| **Step Name** | name-matcher-test-adaptation |
| **Prerequisite State** | Step 1.1 complete — `matchAttendance` has new signature. Tests currently fail because they still use `ZoomNameMap`. |
| **Outcome** | All 14 existing test assertions in `name-matcher.test.ts` pass using `Map<string, number>` instead of `ZoomNameMap`. Test (4) also verifies callback invocation. |
| **Scope / Touch List** | `packages/core/tests/unit/attendance/name-matcher.test.ts` |
| **Implementation Notes** | 1. Remove `import { ZoomNameMap }` — replace with inline `new Map<string, number>()`. 2. For test (1): replace `nameMap.set('jsmith_zoom', 1)` with `new Map([['jsmith_zoom', 1]])`. 3. For test (4): add a `vi.fn()` as `onAutoMatch`, assert it was called with `('Jane Smth', 1)`. Also verify the callback was NOT called in exact-match and map-match tests. 4. For test (7): replace `nameMap.set('Jane Smth', 999)` with `new Map([['jane smth', 999]])` (note: keys must be lowercase since the Map is pre-built lowercase). 5. For tests (2,3,5,6,6b,8,9,10,11,12,13,14): replace `new ZoomNameMap()` with `new Map<string, number>()`. |
| **Behavioral Intent** | **Positive cases:** All 14 original test scenarios produce identical match results with the new signature. Test (4) additionally verifies `onAutoMatch` is called exactly once with `(participantName, matchedUserId)`. **Negative cases:** Tests where no fuzzy auto-match occurs (exact, map, ambiguous, unmatched) confirm `onAutoMatch` is NOT called. **Edge conditions:** Test (7) — alias map key must be lowercase `'jane smth'` (not mixed case) since the implementation lowercases before lookup; the old `ZoomNameMap.set` auto-lowercased internally. |
| **Validation Gate** | `cd packages/core && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/attendance/name-matcher.test.ts` |
| **Commit** | `test(core): adapt name-matcher tests to aliasMap + onAutoMatch signature` |
| **If It Fails** | Most likely cause: Map keys not lowercase (ZoomNameMap auto-lowercased on `set`). Check that all test Map entries use lowercase keys. |
| **Carry Forward** | Test file no longer imports `ZoomNameMap`. |

---

## Phase 2: migration logic (full detail)

Implement `migrateZoomNameMap` that reads the legacy `zoom-name-map.json`, imports entries into `RosterStore`, and deletes the file.

```
Milestone: migrateZoomNameMap function implemented and tested. Handles success,
           missing file (no-op), and unknown userId (skip + stderr).
Validation Gate:
  lint: npm run build
```

### Step 2.1: Implement migrateZoomNameMap

| Field | Value |
|-------|-------|
| **Step Name** | migration-logic |
| **Prerequisite State** | `RosterStore` contract available (per brief). `packages/core/src/attendance/migration.ts` does not exist yet. |
| **Outcome** | New file `migration.ts` exports `migrateZoomNameMap(configDir, rosterStore)` that reads `zoom-name-map.json`, imports aliases, deletes file. |
| **Scope / Touch List** | `packages/core/src/attendance/migration.ts` (new) |
| **Implementation Notes** | 1. Create `packages/core/src/attendance/migration.ts`. 2. Import `fs/promises` and `path`. 3. Import `RosterStore` type (from the `roster-crypto-store` module — use interface-only import). 4. Read `zoom-name-map.json` from `configDir`. If ENOENT, return `{ migrated: 0, deleted: false }`. 5. Parse JSON as `Record<string, number>` (keys are lowercase zoom names, values are Canvas user IDs). 6. For each entry: call `rosterStore.findByCanvasUserId(userId)`. If found, call `rosterStore.appendZoomAlias(userId, zoomName)`. If not found, log to stderr: `[canvas-mcp] Migration skip: zoom alias "${zoomName}" -> userId ${userId} (not in roster)`. 7. After all entries processed, delete `zoom-name-map.json`. 8. Return `{ migrated: successCount, deleted: true }`. |
| **Behavioral Intent** | **Positive cases:** (a) File exists with 3 entries, all userIds in roster -> `{ migrated: 3, deleted: true }`, file deleted, `appendZoomAlias` called 3 times. (b) File exists with 0 entries (empty object) -> `{ migrated: 0, deleted: true }`, file deleted. **Negative/error cases:** (a) File does not exist -> `{ migrated: 0, deleted: false }`, no roster calls. (b) File exists but some userIds not in roster -> those entries skipped with stderr warning, rest migrated, file still deleted. (c) File contains invalid JSON -> error propagates (not caught). **Edge conditions:** (a) All entries have unknown userIds -> `{ migrated: 0, deleted: true }` (file still deleted — migration is complete even if nothing transferred). (b) `appendZoomAlias` is called with the original lowercase key from the JSON (preserving existing casing convention). **Example:** `zoom-name-map.json = {"jsmith_zoom": 1, "unknown": 999}`, roster has userId 1 but not 999 -> `appendZoomAlias(1, "jsmith_zoom")` called, stderr warns about 999, returns `{ migrated: 1, deleted: true }`. |
| **Validation Gate** | `npm run build` |
| **Commit** | `feat(core): add migrateZoomNameMap for zoom-name-map.json to roster migration` |
| **If It Fails** | Verify `RosterStore` interface import compiles. If the concrete `RosterStore` class is not yet available, use a typed interface import or declare a local interface matching the contract. |
| **Carry Forward** | `migrateZoomNameMap` signature: `(configDir: string, rosterStore: RosterStore) => Promise<{ migrated: number; deleted: boolean }>`. Depends on `RosterStore.findByCanvasUserId` and `RosterStore.appendZoomAlias`. |

### Step 2.2: Add migration tests

| Field | Value |
|-------|-------|
| **Step Name** | migration-tests |
| **Prerequisite State** | Step 2.1 complete. |
| **Outcome** | `packages/core/tests/unit/attendance/migration.test.ts` exists with tests for success, missing file, and unknown user. |
| **Scope / Touch List** | `packages/core/tests/unit/attendance/migration.test.ts` (new) |
| **Implementation Notes** | 1. Create test file. 2. Mock `RosterStore` with stubs for `findByCanvasUserId` and `appendZoomAlias`. 3. Use `fs/promises` to write temp `zoom-name-map.json` in a temp dir for each test. 4. Three test scenarios per behavioral intent below. |
| **Behavioral Intent** | **Positive:** (a) Successful migration — write a `zoom-name-map.json` with `{"alice_zoom": 1, "bob_zoom": 2}`, mock `findByCanvasUserId` to return a student for both, assert `appendZoomAlias` called twice, file deleted, returns `{ migrated: 2, deleted: true }`. (b) Missing file — no `zoom-name-map.json` in dir, returns `{ migrated: 0, deleted: false }`, no roster calls. **Negative:** (c) Unknown userId — write `{"alice_zoom": 1, "unknown_zoom": 999}`, mock returns student for userId 1 but undefined for 999, assert `appendZoomAlias` called once (for alice), stderr contains skip warning for 999, returns `{ migrated: 1, deleted: true }`. |
| **Validation Gate** | `cd packages/core && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/attendance/migration.test.ts` |
| **Commit** | `test(core): add migration tests for migrateZoomNameMap` |
| **If It Fails** | Ensure temp directory cleanup in `afterEach`. Check that mocked `RosterStore` matches the contract interface shape. |
| **Carry Forward** | None. |

---

## Phase 3: attendance tool wiring + cleanup (outline)

```
Milestone: registerAttendanceTools uses RosterStore; barrel exports updated;
           ZoomNameMap class and file deleted; zoom-name-map.test.ts deleted;
           migrateZoomNameMap called at server startup; full test suite passes.
Estimated packets: 3-4
Key risks / unknowns:
  - RosterStore must be implemented and importable from @canvas-mcp/core or a
    sibling package by this phase. If not, this phase blocks.
  - Teacher index.ts startup sequence needs RosterStore instantiation before
    migration call — may require coordinating with roster-crypto-store module.
  - Removing ZoomNameMap may break integration tests if they reference it.
Depends on discoveries from: Phase 1 (signature stable), Phase 2 (migration tested)
```

**Anticipated steps:**

1. **3.1 — Wire attendance tool to RosterStore:** Update `registerAttendanceTools` signature to accept `RosterStore`. Replace `ZoomNameMap` load/save with alias map built from `rosterStore.allStudents()`. Pass `onAutoMatch` callback wrapping `rosterStore.appendZoomAlias`. Update `packages/teacher/src/tools/attendance.ts`.

2. **3.2 — Call migrateZoomNameMap at startup:** Add migration call in `packages/teacher/src/index.ts` after `RosterStore` is loaded, before server starts. Idempotent — no-op if file missing.

3. **3.3 — Delete ZoomNameMap + update barrel exports:** Remove `packages/core/src/attendance/zoom-name-map.ts`. Remove `ZoomNameMap` export from `packages/core/src/attendance/index.ts` and `packages/core/src/index.ts`. Add `migrateZoomNameMap` export. Delete `packages/core/tests/unit/attendance/zoom-name-map.test.ts`.

4. **3.4 — Final validation:** Full `npm run build` and `npm run test:unit`. Verify no remaining references to `ZoomNameMap` or `zoom-name-map.ts`.

---

## Execution Packets — Phase 1

### Packet 1.1

| Field | Value |
|-------|-------|
| **Packet ID** | 1.1 |
| **Depends On** | none |
| **Prerequisite State** | `packages/core/src/attendance/name-matcher.ts` exists with `matchAttendance(participants, roster, nameMap: ZoomNameMap)` signature. |
| **Objective** | Change `matchAttendance` to accept `aliasMap: Map<string, number>` and optional `onAutoMatch` callback, removing `ZoomNameMap` dependency. |
| **Allowed Files** | `packages/core/src/attendance/name-matcher.ts` |
| **Behavioral Intent** | **Positive cases:** (a) When `aliasMap` contains a lowercase key matching `participant.name.toLowerCase()`, return that participant as `source: 'map'` with the mapped userId. (b) When a high-confidence fuzzy match is found (distance < 0.45, unique best), invoke `onAutoMatch(participantName, bestCanvasUserId)` exactly once. (c) When `onAutoMatch` is undefined, fuzzy auto-match still succeeds — callback is optional. **Negative cases:** (a) `aliasMap` entry maps to userId not in roster — fall through to exact/fuzzy. (b) Empty aliasMap — step 1 never matches. **Edge conditions:** (a) Name casing: lookup uses `participant.name.toLowerCase()` so "JSmith" matches key "jsmith". (b) `onAutoMatch` receives the original `participant.name` (not lowercased) and the `canvasUserId`. (c) Callback throw propagates to caller — no try/catch around it. **Example:** `aliasMap = new Map([["jsmith_zoom", 1]])`, participant `"jsmith_zoom"` -> matched `source: 'map'`, userId 1. |
| **Checklist** | 1. Replace `nameMap: ZoomNameMap` param with `aliasMap: Map<string, number>, onAutoMatch?: (zoomName: string, canvasUserId: number) => void`. 2. Step 1: `const mappedUserId = aliasMap.get(participant.name.toLowerCase())`. 3. Step 3 auto-save: replace `nameMap.set(participant.name, best.canvasUserId)` with `if (onAutoMatch) onAutoMatch(participant.name, best.canvasUserId)`. 4. Remove `import type { ZoomNameMap } from './zoom-name-map.js'`. 5. Update JSDoc comment block for new params. |
| **Commands** | `cd /Users/mark/Repos/personal/canvas-mcp && npm run build` |
| **Pass Condition** | Core package compiles without errors. `name-matcher.ts` has no import of `ZoomNameMap`. |
| **Commit Message** | `refactor(core): migrate matchAttendance from ZoomNameMap to aliasMap + onAutoMatch callback` |
| **Stop / Escalate If** | `MatchResult` type needs changes (it should not). Any other file imports `matchAttendance` with the old signature and fails to compile — that is expected for `attendance.ts` in teacher package; do not fix it in this packet. |

### Packet 1.2

| Field | Value |
|-------|-------|
| **Packet ID** | 1.2 |
| **Depends On** | 1.1 |
| **Prerequisite State** | `matchAttendance` has new signature `(participants, roster, aliasMap, onAutoMatch?)`. Tests currently fail. |
| **Objective** | Adapt all existing name-matcher tests to use the new `Map<string, number>` + `onAutoMatch` signature. All 14 test assertions must pass. |
| **Allowed Files** | `packages/core/tests/unit/attendance/name-matcher.test.ts` |
| **Behavioral Intent** | **Positive:** All 14 existing test scenarios produce identical results with new signature. Test (4) additionally verifies `onAutoMatch` is called with `('Jane Smth', 1)`. Tests (1), (2), (3), (10), (11), (12) verify `onAutoMatch` is NOT called (no fuzzy auto-match in those paths). **Negative:** Test (7) — aliasMap has `['jane smth', 999]` (lowercase), userId 999 not in roster, falls through to fuzzy match on userId 1. **Edge:** Map keys must all be lowercase — `ZoomNameMap` auto-lowercased on `set()`, but `Map` requires pre-lowercased keys. Test (1) key is `'jsmith_zoom'` (already lowercase). Test (7) key must be `'jane smth'` not `'Jane Smth'`. |
| **Checklist** | 1. Remove `import { ZoomNameMap }` line. 2. Replace every `new ZoomNameMap()` with `new Map<string, number>()`. 3. Replace `nameMap.set('jsmith_zoom', 1)` in test (1) with `const aliasMap = new Map([['jsmith_zoom', 1]])`. 4. Replace `nameMap.set('Jane Smth', 999)` in test (7) with `new Map([['jane smth', 999]])` (lowercase key). 5. In test (4), add `const onAutoMatch = vi.fn()` and pass as 4th arg. Assert `expect(onAutoMatch).toHaveBeenCalledWith('Jane Smth', 1)`. 6. In at least one non-fuzzy-auto-match test (e.g., test 1), pass `onAutoMatch = vi.fn()` and assert it was NOT called. 7. Update variable names from `nameMap` to `aliasMap` for clarity. |
| **Commands** | `cd /Users/mark/Repos/personal/canvas-mcp/packages/core && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/attendance/name-matcher.test.ts` |
| **Pass Condition** | All 14+ test assertions pass. No import of `ZoomNameMap` remains in test file. |
| **Commit Message** | `test(core): adapt name-matcher tests to aliasMap + onAutoMatch signature` |
| **Stop / Escalate If** | Any test logic needs to change beyond replacing the data structure (would indicate the signature change broke pipeline semantics — escalate to Tactician). |

---

## Execution Packets — Phase 2

### Packet 2.1

| Field | Value |
|-------|-------|
| **Packet ID** | 2.1 |
| **Depends On** | 1.1 |
| **Prerequisite State** | `matchAttendance` new signature is committed. `RosterStore` contract is defined per brief (interface with `findByCanvasUserId`, `appendZoomAlias`). `packages/core/src/attendance/migration.ts` does not exist. |
| **Objective** | Implement `migrateZoomNameMap` function that reads legacy `zoom-name-map.json`, imports aliases into `RosterStore`, and deletes the file. |
| **Allowed Files** | `packages/core/src/attendance/migration.ts` (new) |
| **Behavioral Intent** | **Positive:** (a) File with `{"alice": 1, "bob": 2}`, both in roster -> `appendZoomAlias` called twice, file deleted, returns `{migrated: 2, deleted: true}`. (b) Empty file `{}` -> `{migrated: 0, deleted: true}`, file deleted. **Negative:** (a) No file -> `{migrated: 0, deleted: false}`, no roster calls. (b) `{"alice": 1, "unknown": 999}`, 999 not in roster -> `appendZoomAlias` called once, stderr warning for 999, returns `{migrated: 1, deleted: true}`. (c) Invalid JSON -> error propagates. **Edge:** (a) All entries unknown -> `{migrated: 0, deleted: true}` (file still removed). (b) Keys are preserved as-is from JSON (they are already lowercase per ZoomNameMap convention). |
| **Checklist** | 1. Create `packages/core/src/attendance/migration.ts`. 2. Import `fs/promises` (readFile, unlink), `path` (join). 3. Define `RosterStore` interface locally or import from roster-crypto-store module (use whatever compiles). 4. Implement: read file, parse JSON, iterate entries, call `findByCanvasUserId`, conditionally `appendZoomAlias`, count, log skips to stderr, delete file, return result. 5. Handle ENOENT on read -> return `{migrated: 0, deleted: false}`. |
| **Commands** | `cd /Users/mark/Repos/personal/canvas-mcp && npm run build` |
| **Pass Condition** | Core compiles. `migration.ts` exports `migrateZoomNameMap`. |
| **Commit Message** | `feat(core): add migrateZoomNameMap for zoom-name-map.json to roster migration` |
| **Stop / Escalate If** | `RosterStore` type is not importable and a local interface definition feels wrong (escalate to Tactician to confirm approach). If `RosterStore` module does not exist yet, define a minimal interface matching the contract from the brief and add a `// TODO: import from roster-crypto-store once available` comment. |

### Packet 2.2

| Field | Value |
|-------|-------|
| **Packet ID** | 2.2 |
| **Depends On** | 2.1 |
| **Prerequisite State** | `migrateZoomNameMap` is implemented in `migration.ts`. |
| **Objective** | Add unit tests for `migrateZoomNameMap` covering successful migration, missing file, and unknown user scenarios. |
| **Allowed Files** | `packages/core/tests/unit/attendance/migration.test.ts` (new) |
| **Behavioral Intent** | **Test 1 — successful migration:** Write `{"alice_zoom": 1, "bob_zoom": 2}` to a temp dir as `zoom-name-map.json`. Mock `RosterStore` where `findByCanvasUserId(1)` and `findByCanvasUserId(2)` return students. Call `migrateZoomNameMap`. Assert: `appendZoomAlias` called with `(1, "alice_zoom")` and `(2, "bob_zoom")`, file no longer exists, result is `{migrated: 2, deleted: true}`. **Test 2 — missing file:** Empty temp dir, no `zoom-name-map.json`. Call `migrateZoomNameMap`. Assert: result `{migrated: 0, deleted: false}`, no roster calls. **Test 3 — unknown userId:** Write `{"alice_zoom": 1, "unknown_zoom": 999}`. Mock returns student for 1, undefined for 999. Assert: `appendZoomAlias` called once (for alice), stderr contains warning about 999, file deleted, result `{migrated: 1, deleted: true}`. |
| **Checklist** | 1. Create test file with `describe('migrateZoomNameMap', ...)`. 2. Use `mkdtemp` for temp dirs; clean up in `afterEach`. 3. Mock `RosterStore` as a plain object with `vi.fn()` methods. 4. For stderr capture, spy on `process.stderr.write`. 5. Three test cases per behavioral intent. |
| **Commands** | `cd /Users/mark/Repos/personal/canvas-mcp/packages/core && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/attendance/migration.test.ts` |
| **Pass Condition** | All 3 tests pass. |
| **Commit Message** | `test(core): add migration tests for migrateZoomNameMap` |
| **Stop / Escalate If** | `migrateZoomNameMap` import fails — check that `migration.ts` is properly exporting. |

---

## Dispatch Summary

| Phase | Packets | Status |
|-------|---------|--------|
| Phase 1: name-matcher signature migration | 1.1, 1.2 | Ready for dispatch (sequential) |
| Phase 2: migration logic | 2.1, 2.2 | Ready for dispatch after 1.1 (2.1 depends on 1.1; 2.2 depends on 2.1) |
| Phase 3: attendance tool wiring + cleanup | 3.1-3.4 | Outlined — promote after Phase 1-2 Result Bundles |

**Dependency graph:**
```
1.1 --> 1.2
1.1 --> 2.1 --> 2.2
[1.2, 2.2] --> Phase 3 (3.1 --> 3.2 --> 3.3 --> 3.4)
```

Note: Packets 1.2 and 2.1 can execute in parallel (both depend only on 1.1).
