# Execution Packets: Phase 4 — RosterStore (CRUD + Persistence)

## Packet 4.1

| Field | Value |
|-------|-------|
| **Packet ID** | 4.1 |
| **Depends On** | 2.1, 1.3 |
| **Prerequisite State** | `RosterCrypto` exists in `packages/core/src/roster/crypto.ts` and is exported via barrel. `RosterStudent`, `RosterFile`, `RosterKeyProvider` types exist. |
| **Objective** | Implement `RosterStore` with `load()` and `save()` methods using atomic writes and lazy key derivation. |
| **Allowed Files** | `packages/core/src/roster/store.ts` (new), `packages/core/src/roster/index.ts` (add export) |
| **Behavioral Intent** | **Positive:** (1) `save([student1, student2])` then `load()` returns an identical array (encrypt-write-read-decrypt round-trip). (2) `load()` when `roster.json` does not exist returns `[]`. (3) `save([])` then `load()` returns `[]`. (4) After `save()`, file on disk has `0600` permissions (verify via `statSync`). (5) File on disk is valid JSON with shape `{ version: 1, last_updated: "<ISO 8601>", encrypted: "<base64>" }`. **Negative:** (1) `roster.json` contains corrupt/non-JSON content -> throws descriptive error. (2) `roster.json` has `version: 2` -> throws `"Unsupported roster file version: 2"`. (3) File was saved with a different encryption key, then loaded with current key -> error message contains `"roster rekey"` (propagated from `RosterCrypto.decrypt`). **Edge:** (1) Atomic write: writes to `.roster.json.tmp` first, then `renameSync` to `roster.json` -- file is never left in a partial state. (2) If `configDir` does not exist, `mkdirSync(configDir, { recursive: true })` before writing. (3) Stale `.roster.json.tmp` from a previous crashed write is safely overwritten. (4) Key derivation is lazy: `deriveKey()` is called on first `load()` or `save()`, not in the constructor. The derived `RosterCrypto` instance is cached for subsequent calls. **Constructor:** `(configDir: string, keyProvider: RosterKeyProvider)`. Internal: `rosterPath = join(configDir, 'roster.json')`. **Inherited constraint:** Follow `SidecarManager` (`packages/core/src/security/sidecar-manager.ts`) atomic write pattern: `writeFileSync(tmpPath, content, { mode: 0o600 })`, `renameSync(tmpPath, finalPath)`, `chmodSync(finalPath, 0o600)`. |
| **Checklist** | 1. Create `packages/core/src/roster/store.ts`. 2. Import `readFileSync`, `writeFileSync`, `mkdirSync`, `renameSync`, `chmodSync`, `existsSync`, `statSync` from `node:fs`. Import `dirname`, `join` from `node:path`. Import `RosterCrypto` from `./crypto.js`. Import types from `./types.js`. 3. Export class `RosterStore`. Constructor takes `(configDir: string, keyProvider: RosterKeyProvider)`, stores `rosterPath = join(configDir, 'roster.json')` and `keyProvider`. 4. Private field `crypto: RosterCrypto | null = null`. Private async method `ensureCrypto(): Promise<RosterCrypto>` that calls `keyProvider.deriveKey()` once, constructs `RosterCrypto`, caches it. 5. `async load(): Promise<RosterStudent[]>`: if file doesn't exist return `[]`. Read file, `JSON.parse`, validate `version === 1` (throw if not), call `crypto.decrypt(parsed.encrypted)`. 6. `async save(students: RosterStudent[]): Promise<void>`: `ensureCrypto()`, encrypt, build `RosterFile` envelope, `mkdirSync(dirname(rosterPath), { recursive: true })`, write to tmp, rename, chmod. 7. Add `export { RosterStore } from './store.js'` to barrel. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. `RosterStore` is importable from `@canvas-mcp/core`. |
| **Commit Message** | `feat(core): add RosterStore with load/save and atomic writes` |
| **Stop / Escalate If** | Unclear whether `renameSync` provides atomicity guarantees on the target filesystem (it does on POSIX/macOS/Linux for same-filesystem renames). |

## Packet 4.2

| Field | Value |
|-------|-------|
| **Packet ID** | 4.2 |
| **Depends On** | 4.1 |
| **Prerequisite State** | `RosterStore` exists in `packages/core/src/roster/store.ts` with `load()` and `save()` methods. |
| **Objective** | Add query methods: `findByCanvasUserId`, `findByEmail`, `findByZoomAlias`, `allStudents`. |
| **Allowed Files** | `packages/core/src/roster/store.ts` (append methods) |
| **Behavioral Intent** | **Positive:** (1) `findByCanvasUserId(42)` returns the student with `canvasUserId === 42`. (2) `findByEmail("ALICE@Example.com")` finds student whose `emails` array contains `"alice@example.com"` (case-insensitive). (3) `findByZoomAlias("alice s")` finds student whose `zoomAliases` array contains `"Alice S"` (case-insensitive). (4) `allStudents()` returns the full decrypted array (same as `load()`). **Negative:** (1) `findByCanvasUserId(999)` when no student has that ID -> returns `null`. (2) `findByEmail("nonexistent@x.com")` -> returns `null`. (3) `findByZoomAlias("nobody")` -> returns `null`. (4) All queries on an empty roster (no file or empty array) return `null` / `[]` respectively. **Edge:** (1) Student has multiple emails `["a@b.com", "a2@b.com"]`: `findByEmail("A2@B.COM")` matches. (2) Student has multiple aliases: `findByZoomAlias` matches any. (3) All queries call `load()` internally, reading fresh from disk each time (no stale cache). |
| **Checklist** | 1. Add `async findByCanvasUserId(id: number): Promise<RosterStudent | null>` -- `load()`, find first where `canvasUserId === id`, return or null. 2. Add `async findByEmail(email: string): Promise<RosterStudent | null>` -- `load()`, find first where `emails.some(e => e.toLowerCase() === email.toLowerCase())`. 3. Add `async findByZoomAlias(alias: string): Promise<RosterStudent | null>` -- `load()`, find first where `zoomAliases.some(a => a.toLowerCase() === alias.toLowerCase())`. 4. Add `async allStudents(): Promise<RosterStudent[]>` -- return `load()`. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. All four methods exist on `RosterStore`. |
| **Commit Message** | `feat(core): add RosterStore query methods` |
| **Stop / Escalate If** | N/A |

## Packet 4.3

| Field | Value |
|-------|-------|
| **Packet ID** | 4.3 |
| **Depends On** | 4.1 |
| **Prerequisite State** | `RosterStore` exists with `load()` and `save()` methods. |
| **Objective** | Add mutation methods: `upsertStudent`, `removeStudentCourseId`, `appendZoomAlias`. |
| **Allowed Files** | `packages/core/src/roster/store.ts` (append methods) |
| **Behavioral Intent** | **Positive:** (1) `upsertStudent(newStudent)` where `newStudent.canvasUserId` is not in roster -> student is appended. (2) `upsertStudent(updatedStudent)` where `canvasUserId` already exists -> entire record is replaced. (3) `removeStudentCourseId(1, 101)` where student 1 has `courseIds: [101, 102]` -> `courseIds` becomes `[102]`, returns `true`. (4) `removeStudentCourseId(1, 102)` when `courseIds` was `[102]` (last one) -> student is removed from roster entirely, returns `true`. (5) `appendZoomAlias(1, "Alice S")` adds `"Alice S"` to student 1's `zoomAliases`, returns `true`. (6) `appendZoomAlias(1, "alice s")` when `"Alice S"` already in aliases -> no duplicate added (case-insensitive dedup), still returns `true`. **Negative:** (1) `removeStudentCourseId(999, 101)` when student 999 doesn't exist -> returns `false`, roster unchanged. (2) `appendZoomAlias(999, "x")` when student 999 doesn't exist -> returns `false`, roster unchanged. **Edge:** (1) After `upsertStudent` with existing ID, the old record is fully replaced (not merged). (2) After `removeStudentCourseId` removes the last courseId, `findByCanvasUserId` for that student returns `null`. (3) `removeStudentCourseId(1, 999)` where courseId 999 is not in student's list -> returns `true` (student was found) but courseIds unchanged. (4) Each mutation loads from disk, modifies in memory, then saves back to disk. |
| **Checklist** | 1. Add `async upsertStudent(student: RosterStudent): Promise<void>` -- `load()`, find index by `canvasUserId`, replace if found or push if not, `save()`. 2. Add `async removeStudentCourseId(canvasUserId: number, courseId: number): Promise<boolean>` -- `load()`, find student, if not found return `false`. Filter `courseIds` to remove `courseId`. If `courseIds` now empty, remove student from array. `save()`, return `true`. 3. Add `async appendZoomAlias(canvasUserId: number, alias: string): Promise<boolean>` -- `load()`, find student, if not found return `false`. Check if alias already exists (case-insensitive). If not, push. `save()`, return `true`. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. All three mutation methods exist on `RosterStore`. |
| **Commit Message** | `feat(core): add RosterStore mutation methods` |
| **Stop / Escalate If** | N/A |
