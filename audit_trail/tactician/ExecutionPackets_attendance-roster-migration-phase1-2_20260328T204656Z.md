# Execution Packets — attendance-roster-migration — Phases 1-2

## Packet 1.1

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

---

## Packet 1.2

| Field | Value |
|-------|-------|
| **Packet ID** | 1.2 |
| **Depends On** | 1.1 |
| **Prerequisite State** | `matchAttendance` has new signature `(participants, roster, aliasMap: Map<string, number>, onAutoMatch?: ...)`. Tests currently fail. |
| **Objective** | Adapt all existing name-matcher tests to use the new `Map<string, number>` + `onAutoMatch` signature. All 14 test assertions must pass. |
| **Allowed Files** | `packages/core/tests/unit/attendance/name-matcher.test.ts` |
| **Behavioral Intent** | **Positive:** All 14 existing test scenarios produce identical results with new signature. Test (4) additionally verifies `onAutoMatch` is called with `('Jane Smth', 1)`. Tests (1), (2), (3), (10), (11), (12) verify `onAutoMatch` is NOT called (no fuzzy auto-match in those paths). **Negative:** Test (7) — aliasMap has `['jane smth', 999]` (lowercase), userId 999 not in roster, falls through to fuzzy match on userId 1. **Edge:** Map keys must all be lowercase — `ZoomNameMap` auto-lowercased on `set()`, but `Map` requires pre-lowercased keys. Test (1) key is `'jsmith_zoom'` (already lowercase). Test (7) key must be `'jane smth'` not `'Jane Smth'`. |
| **Checklist** | 1. Remove `import { ZoomNameMap }` line. 2. Replace every `new ZoomNameMap()` with `new Map<string, number>()`. 3. Replace `nameMap.set('jsmith_zoom', 1)` in test (1) with `const aliasMap = new Map([['jsmith_zoom', 1]])`. 4. Replace `nameMap.set('Jane Smth', 999)` in test (7) with `new Map([['jane smth', 999]])` (lowercase key). 5. In test (4), add `const onAutoMatch = vi.fn()` and pass as 4th arg. Assert `expect(onAutoMatch).toHaveBeenCalledWith('Jane Smth', 1)`. 6. In at least one non-fuzzy-auto-match test (e.g., test 1), pass `onAutoMatch = vi.fn()` and assert it was NOT called. 7. Update variable names from `nameMap` to `aliasMap` for clarity. |
| **Commands** | `cd /Users/mark/Repos/personal/canvas-mcp/packages/core && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/attendance/name-matcher.test.ts` |
| **Pass Condition** | All 14+ test assertions pass. No import of `ZoomNameMap` remains in test file. |
| **Commit Message** | `test(core): adapt name-matcher tests to aliasMap + onAutoMatch signature` |
| **Stop / Escalate If** | Any test logic needs to change beyond replacing the data structure (would indicate the signature change broke pipeline semantics — escalate to Tactician). |

---

## Packet 2.1

| Field | Value |
|-------|-------|
| **Packet ID** | 2.1 |
| **Depends On** | 1.1 |
| **Prerequisite State** | `matchAttendance` new signature is committed. `RosterStore` contract is defined per brief (interface with `findByCanvasUserId`, `appendZoomAlias`). `packages/core/src/attendance/migration.ts` does not exist. |
| **Objective** | Implement `migrateZoomNameMap` function that reads legacy `zoom-name-map.json`, imports aliases into `RosterStore`, and deletes the file. |
| **Allowed Files** | `packages/core/src/attendance/migration.ts` (new) |
| **Behavioral Intent** | **Positive:** (a) File with `{"alice": 1, "bob": 2}`, both in roster -> `appendZoomAlias` called twice, file deleted, returns `{migrated: 2, deleted: true}`. (b) Empty file `{}` -> `{migrated: 0, deleted: true}`, file deleted. **Negative:** (a) No file -> `{migrated: 0, deleted: false}`, no roster calls. (b) `{"alice": 1, "unknown": 999}`, 999 not in roster -> `appendZoomAlias` called once, stderr warning for 999, returns `{migrated: 1, deleted: true}`. (c) Invalid JSON -> error propagates. **Edge:** (a) All entries unknown -> `{migrated: 0, deleted: true}` (file still removed). (b) Keys are preserved as-is from JSON (already lowercase per ZoomNameMap convention). |
| **Checklist** | 1. Create `packages/core/src/attendance/migration.ts`. 2. Import `fs/promises` (readFile, unlink), `path` (join). 3. Define a minimal `RosterStore` interface locally matching the contract: `{ findByCanvasUserId(id: number): Promise<{ canvasUserId: number } | undefined>; appendZoomAlias(canvasUserId: number, alias: string): Promise<void> }`. Add `// TODO: import from roster-crypto-store once available` comment. 4. Implement: read file, parse JSON as `Record<string, number>`, iterate entries, call `findByCanvasUserId`, conditionally `appendZoomAlias`, count successes, log skips to stderr with `[canvas-mcp] Migration skip: zoom alias "${key}" -> userId ${value} (not in roster)`, delete file with `unlink`, return `{ migrated, deleted: true }`. 5. Handle ENOENT on readFile -> return `{ migrated: 0, deleted: false }`. 6. Export `migrateZoomNameMap` as named export. |
| **Commands** | `cd /Users/mark/Repos/personal/canvas-mcp && npm run build` |
| **Pass Condition** | Core compiles. `migration.ts` exports `migrateZoomNameMap`. |
| **Commit Message** | `feat(core): add migrateZoomNameMap for zoom-name-map.json to roster migration` |
| **Stop / Escalate If** | `RosterStore` type is not importable and a local interface definition feels wrong (escalate to Tactician to confirm approach). |

---

## Packet 2.2

| Field | Value |
|-------|-------|
| **Packet ID** | 2.2 |
| **Depends On** | 2.1 |
| **Prerequisite State** | `migrateZoomNameMap` is implemented and exported from `packages/core/src/attendance/migration.ts`. |
| **Objective** | Add unit tests for `migrateZoomNameMap` covering successful migration, missing file, and unknown user scenarios. |
| **Allowed Files** | `packages/core/tests/unit/attendance/migration.test.ts` (new) |
| **Behavioral Intent** | **Test 1 — successful migration:** Write `{"alice_zoom": 1, "bob_zoom": 2}` to a temp dir as `zoom-name-map.json`. Mock `RosterStore` where `findByCanvasUserId(1)` and `findByCanvasUserId(2)` return student objects. Call `migrateZoomNameMap(tempDir, mockStore)`. Assert: `appendZoomAlias` called with `(1, "alice_zoom")` and `(2, "bob_zoom")`, `zoom-name-map.json` no longer exists in tempDir, result is `{migrated: 2, deleted: true}`. **Test 2 — missing file:** Empty temp dir, no `zoom-name-map.json`. Call `migrateZoomNameMap(tempDir, mockStore)`. Assert: result `{migrated: 0, deleted: false}`, `findByCanvasUserId` never called, `appendZoomAlias` never called. **Test 3 — unknown userId:** Write `{"alice_zoom": 1, "unknown_zoom": 999}`. Mock `findByCanvasUserId(1)` returns student, `findByCanvasUserId(999)` returns undefined. Assert: `appendZoomAlias` called once with `(1, "alice_zoom")`, stderr contains `"999"` and `"unknown_zoom"`, file deleted, result `{migrated: 1, deleted: true}`. |
| **Checklist** | 1. Create `packages/core/tests/unit/attendance/migration.test.ts`. 2. Import `migrateZoomNameMap` from source. 3. Use `fs.mkdtemp` + `os.tmpdir()` for isolated temp dirs. 4. Build mock `RosterStore` as plain object with `vi.fn()` for `findByCanvasUserId` and `appendZoomAlias`. 5. For stderr capture, `vi.spyOn(process.stderr, 'write')`. 6. Three `it()` blocks per behavioral intent. 7. Clean up temp dirs in `afterEach`. |
| **Commands** | `cd /Users/mark/Repos/personal/canvas-mcp/packages/core && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/attendance/migration.test.ts` |
| **Pass Condition** | All 3 tests pass. |
| **Commit Message** | `test(core): add migration tests for migrateZoomNameMap` |
| **Stop / Escalate If** | `migrateZoomNameMap` import path does not resolve — check vitest alias config and export from `migration.ts`. |
