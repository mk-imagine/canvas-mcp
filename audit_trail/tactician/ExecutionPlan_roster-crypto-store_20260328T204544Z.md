# Execution Plan: roster-crypto-store

## Implementation Plan Header

| Field | Value |
|-------|-------|
| **Project / Module Name** | roster-crypto-store |
| **Scope Summary** | Encrypted persistent roster storage layer: key derivation (SSH agent, macOS Keychain, key file fallback chain), AES-256-GCM encryption/decryption of a students array, and typed CRUD operations on `roster.json`. All code lives in `packages/core`. |
| **Assumptions** | 1. `ssh2` npm package provides `AgentProtocol` for SSH agent communication (verified in brief supplementary analysis). 2. `child_process.execFile` is sufficient for macOS Keychain CLI interaction. 3. The `ConfigManager.getConfigDir()` method returns the directory path where roster files should be stored (confirmed from source: `dirname(this.configPath)`). 4. No existing `packages/core/src/roster/` directory exists (confirmed). |
| **Constraints & NFRs** | Atomic file writes (tmp+rename). `0600` file permissions. Config schema backward-compatible via `DEFAULT_CONFIG` deep-merge. All code in `packages/core` -- no MCP server logic. |
| **Repo Target** | `/Users/mark/Repos/personal/canvas-mcp` -- `packages/core/` |
| **Primary Interfaces** | `RosterKeyProvider` (interface), `SshAgentKeyProvider`, `KeychainKeyProvider`, `FileKeyProvider` (classes), `RosterCrypto` (class), `RosterStore` (class), `createKeyProvider()` (factory), `RosterStudent` (type), `RosterFile` (type) |
| **Definition of Done** | 1. `RosterStore` round-trips (encrypt, write, read, decrypt) using each key provider. 2. SSH agent provider derives deterministic AES-256 key from Ed25519 signature over challenge `"canvas-mcp:roster-key:v1"`. 3. SSH agent provider rejects ECDSA keys with clear error. 4. macOS Keychain provider generates random key on first use, retrieves on subsequent calls. 5. File key provider reads from `roster.key` with `0600` check. 6. `createKeyProvider()` walks fallback chain correctly. 7. Decrypt failure produces actionable error referencing `canvas-mcp roster rekey`. 8. Atomic write: roster file never left in partial state. 9. `security.rosterKeyFingerprint` config field exists with `null` default. 10. All unit tests pass; SSH agent tests use mock agent. |

---

## Phase 1: Types and Config Schema

**Milestone:** `RosterStudent`, `RosterFile`, and `RosterKeyProvider` types are defined and exported. Config schema has `security.rosterKeyFingerprint` field. The barrel export in `packages/core/src/index.ts` re-exports roster types.

**Validation Gate:**
- lint: `npx tsc -p packages/core/tsconfig.build.json --noEmit`

### Step 1.1: Define roster types

| Field | Value |
|-------|-------------|
| **Step Name** | roster-types |
| **Prerequisite State** | No `packages/core/src/roster/` directory exists. |
| **Outcome** | `RosterStudent`, `RosterFile`, and `RosterKeyProvider` types defined and exported. |
| **Scope / Touch List** | `packages/core/src/roster/types.ts` (new) |
| **Implementation Notes** | Create `packages/core/src/roster/` directory. Define `RosterStudent` interface: `{ canvasUserId: number, name: string, sortable_name: string, emails: string[], courseIds: number[], zoomAliases: string[], created: string }`. Define `RosterFile` interface: `{ version: number, last_updated: string, encrypted: string }`. Define `RosterKeyProvider` interface: `{ deriveKey(): Promise<Buffer> }`. |
| **Behavioral Intent** | **Positive:** Each type can be imported and used as a type annotation. `RosterStudent` has all 7 required fields. `RosterFile` has `version`, `last_updated`, `encrypted`. `RosterKeyProvider` has a single `deriveKey()` method returning `Promise<Buffer>`. **Negative:** N/A (pure type definitions). **Edge:** The `created` field on `RosterStudent` is a string (ISO 8601), not a Date object. |
| **Validation Gate** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Commit** | `feat(core): add RosterStudent, RosterFile, and RosterKeyProvider types` |
| **If It Fails** | Check TypeScript syntax. Verify `tsconfig.build.json` includes the new directory. |
| **Carry Forward** | Type shapes are established; all subsequent packets depend on these. |

### Step 1.2: Extend config schema with security.rosterKeyFingerprint

| Field | Value |
|-------|-------------|
| **Step Name** | config-schema-extension |
| **Prerequisite State** | `packages/core/src/config/schema.ts` exists with current `CanvasTeacherConfig` shape. |
| **Outcome** | `CanvasTeacherConfig` has a `security` section with `rosterKeyFingerprint: string | null`. `DEFAULT_CONFIG` includes `security: { rosterKeyFingerprint: null }`. |
| **Scope / Touch List** | `packages/core/src/config/schema.ts` |
| **Implementation Notes** | Add `security: { rosterKeyFingerprint: string | null }` to `CanvasTeacherConfig`. Add corresponding default to `DEFAULT_CONFIG`. This is backward-compatible: `deepMerge` will supply the default for existing config files that lack the `security` key. |
| **Behavioral Intent** | **Positive:** `DEFAULT_CONFIG.security.rosterKeyFingerprint` is `null`. A config file without `security` key deep-merges to include `security: { rosterKeyFingerprint: null }`. Existing config fields are unchanged. **Negative:** N/A (additive change). **Edge:** Config files that already have other unknown keys in `security` should not break -- `deepMerge` handles this. Existing unit tests for config (`packages/core/tests/unit/config/schema.test.ts`) must still pass. |
| **Validation Gate** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` and existing config tests pass |
| **Commit** | `feat(core): add security.rosterKeyFingerprint to config schema` |
| **If It Fails** | If existing tests break, the `DEFAULT_CONFIG` shape change may not align with test expectations. Review `packages/core/tests/unit/config/schema.test.ts`. |
| **Carry Forward** | Config type now includes `security` section; key providers will read `rosterKeyFingerprint`. |

### Step 1.3: Create roster barrel export and wire into core index

| Field | Value |
|-------|-------------|
| **Step Name** | roster-barrel-export |
| **Prerequisite State** | `packages/core/src/roster/types.ts` exists (Step 1.1). |
| **Outcome** | `packages/core/src/roster/index.ts` barrel exports all roster types. `packages/core/src/index.ts` re-exports from `./roster/index.js`. |
| **Scope / Touch List** | `packages/core/src/roster/index.ts` (new), `packages/core/src/index.ts` |
| **Implementation Notes** | Create barrel file exporting types. Add `export * from './roster/index.js'` to core index (follow the pattern used by `./attendance/index.js`). Initially only types are exported; later packets will add classes/functions. |
| **Behavioral Intent** | **Positive:** `import { RosterStudent, RosterFile, RosterKeyProvider } from '@canvas-mcp/core'` resolves. **Negative:** N/A. **Edge:** The barrel file will grow as more roster modules are added in later packets. |
| **Validation Gate** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Commit** | `feat(core): add roster barrel export and wire into core index` |
| **If It Fails** | Check `.js` extension in import paths (ESM requirement). |
| **Carry Forward** | Barrel export path established at `./roster/index.js`. |

---

## Phase 2: Cryptography Layer (RosterCrypto)

**Milestone:** `RosterCrypto` class encrypts and decrypts a students array using AES-256-GCM. Decrypt with wrong key produces actionable error. Round-trip verified.

**Validation Gate:**
- lint: `npx tsc -p packages/core/tsconfig.build.json --noEmit`

### Step 2.1: Implement RosterCrypto

| Field | Value |
|-------|-------------|
| **Step Name** | roster-crypto |
| **Prerequisite State** | `RosterStudent` and `RosterFile` types exist (Phase 1). |
| **Outcome** | `RosterCrypto` class with `encrypt(students: RosterStudent[]): string` (returns base64 blob) and `decrypt(encrypted: string): RosterStudent[]` (returns parsed array). Uses AES-256-GCM with random IV per encrypt call. |
| **Scope / Touch List** | `packages/core/src/roster/crypto.ts` (new), `packages/core/src/roster/index.ts` (add export) |
| **Implementation Notes** | Constructor takes a `Buffer` (32-byte key). `encrypt`: generate 12-byte random IV, encrypt JSON-serialized students array with AES-256-GCM, prepend IV + authTag to ciphertext, base64-encode the whole blob. `decrypt`: base64-decode, extract IV (first 12 bytes), authTag (next 16 bytes), ciphertext (remainder), decrypt and JSON-parse. Follow `SecureStore` pattern for cipher usage. On decrypt failure (wrong key, corrupt data), throw a descriptive error: `"Roster decryption failed. The encryption key may have changed. Run 'canvas-mcp roster rekey' to re-encrypt with the current key."` |
| **Behavioral Intent** | **Positive cases:** (1) Encrypt an array of 3 students, decrypt returns identical array. (2) Encrypt empty array `[]`, decrypt returns `[]`. (3) Encrypt with one key instance, create new `RosterCrypto` with same key bytes, decrypt succeeds (key is deterministic, not instance-bound). **Negative cases:** (1) Decrypt with wrong key (different 32-byte buffer) throws error containing `"roster rekey"`. (2) Decrypt with truncated base64 string throws error containing `"decryption failed"`. (3) Decrypt with empty string throws. **Edge conditions:** (1) Two calls to `encrypt` with the same students produce different base64 strings (random IV). (2) Students array with Unicode names (e.g., `"Jose Garcia"` with accented chars) round-trips correctly. (3) Very large array (1000 students) encrypts/decrypts without error. **Example inputs/outputs:** Input: `[{ canvasUserId: 42, name: "Alice Smith", sortable_name: "Smith, Alice", emails: ["alice@example.com"], courseIds: [101], zoomAliases: ["Alice S"], created: "2026-01-15T00:00:00.000Z" }]` -> encrypt -> base64 string -> decrypt -> identical array. |
| **Validation Gate** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Commit** | `feat(core): add RosterCrypto with AES-256-GCM encrypt/decrypt` |
| **If It Fails** | Verify IV length (12), authTag length (16), key length (32). Check that Buffer concatenation order matches extract order in decrypt. |
| **Carry Forward** | `RosterCrypto` is the encryption primitive for `RosterStore`. Blob format: `base64(IV[12] + authTag[16] + ciphertext)`. |

---

## Phase 3: Key Providers

**Milestone:** All three key providers (`FileKeyProvider`, `KeychainKeyProvider`, `SshAgentKeyProvider`) and the `createKeyProvider()` factory are implemented. Each produces a 32-byte AES key.

**Validation Gate:**
- lint: `npx tsc -p packages/core/tsconfig.build.json --noEmit`

### Step 3.1: Implement FileKeyProvider

| Field | Value |
|-------|-------------|
| **Step Name** | file-key-provider |
| **Prerequisite State** | `RosterKeyProvider` interface exists (Phase 1). |
| **Outcome** | `FileKeyProvider` reads a 32-byte hex-encoded key from `roster.key`, validates `0600` permissions. |
| **Scope / Touch List** | `packages/core/src/roster/key-providers.ts` (new), `packages/core/src/roster/index.ts` (add export) |
| **Implementation Notes** | `FileKeyProvider` constructor takes `keyPath: string`. `deriveKey()`: read file, trim whitespace, validate it is 64 hex chars (32 bytes), convert to Buffer. Check file mode via `fs.statSync` -- if not `0600` (`0o100600` on macOS), throw error: `"roster.key has insecure permissions. Expected 0600, got <actual>. Run: chmod 600 <path>"`. If file not found, throw: `"Key file not found: <path>. Generate with: openssl rand -hex 32 > <path> && chmod 600 <path>"`. |
| **Behavioral Intent** | **Positive:** (1) File contains 64 hex chars + newline, `deriveKey()` returns 32-byte Buffer. (2) File with no trailing newline works. (3) File with `0600` permissions succeeds. **Negative:** (1) File missing -> error with generation instructions. (2) File has `0644` permissions -> error mentioning `chmod 600`. (3) File contains 63 hex chars (odd length) -> error about invalid key format. (4) File contains non-hex chars -> error about invalid key format. **Edge:** (1) File with leading/trailing whitespace is trimmed before validation. (2) Uppercase hex is accepted. **Example:** File content: `"a1b2c3...64chars...\n"` -> `Buffer.from("a1b2c3...64chars...", "hex")` (32 bytes). |
| **Validation Gate** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Commit** | `feat(core): add FileKeyProvider for roster.key` |
| **If It Fails** | Check `statSync` mode bitmask. On non-macOS the full mode bits differ; mask with `0o777` for permission check. |
| **Carry Forward** | `FileKeyProvider` is the simplest provider; used as fallback in the chain. Permission check pattern: `stat.mode & 0o777`. |

### Step 3.2: Implement KeychainKeyProvider

| Field | Value |
|-------|-------------|
| **Step Name** | keychain-key-provider |
| **Prerequisite State** | `RosterKeyProvider` interface exists (Phase 1). `key-providers.ts` exists (Step 3.1). |
| **Outcome** | `KeychainKeyProvider` stores/retrieves a random 32-byte key in macOS Keychain via `security` CLI. |
| **Scope / Touch List** | `packages/core/src/roster/key-providers.ts` (append), `packages/core/src/roster/index.ts` (add export) |
| **Implementation Notes** | `deriveKey()`: (1) Try `execFile('security', ['find-generic-password', '-s', 'canvas-mcp', '-a', 'roster-key', '-w'])`. If found, hex-decode the password to get the 32-byte key. (2) If not found (non-zero exit / "could not be found" in stderr), generate `randomBytes(32)`, store with `execFile('security', ['add-generic-password', '-s', 'canvas-mcp', '-a', 'roster-key', '-w', key.toString('hex'), '-U'])`, return the key. Wrap `execFile` in a promise helper. If `security` binary is not found (ENOENT), throw: `"macOS Keychain not available (security command not found)"`. |
| **Behavioral Intent** | **Positive:** (1) First call when no keychain entry exists: generates key, stores it, returns 32-byte Buffer. (2) Second call retrieves the same key (deterministic). (3) Returned Buffer is always 32 bytes. **Negative:** (1) `security` command not found -> throws with "not available" message. (2) `security` command returns unexpected output -> throws with descriptive error. **Edge:** (1) Key is stored as hex string in Keychain, so it's 64 chars. (2) If `add-generic-password` fails (Keychain locked), the error should propagate with context. **Example:** First call -> `randomBytes(32)` -> store hex in Keychain -> return Buffer. Second call -> retrieve hex from Keychain -> `Buffer.from(hex, 'hex')` -> return Buffer. |
| **Validation Gate** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Commit** | `feat(core): add KeychainKeyProvider for macOS Keychain` |
| **If It Fails** | Test with mock `execFile`. Verify hex encoding/decoding round-trip. |
| **Carry Forward** | Keychain service name: `canvas-mcp`, account: `roster-key`. Key stored as hex. |

### Step 3.3: Implement SshAgentKeyProvider

| Field | Value |
|-------|-------------|
| **Step Name** | ssh-agent-key-provider |
| **Prerequisite State** | `RosterKeyProvider` interface exists (Phase 1). `key-providers.ts` exists (Steps 3.1-3.2). `ssh2` dependency added to `packages/core/package.json`. |
| **Outcome** | `SshAgentKeyProvider` derives a deterministic AES-256 key by signing a challenge via SSH agent. |
| **Scope / Touch List** | `packages/core/src/roster/key-providers.ts` (append), `packages/core/src/roster/index.ts` (add export), `packages/core/package.json` (add `ssh2` + `@types/ssh2`) |
| **Implementation Notes** | Constructor takes optional `fingerprint?: string` (from config `security.rosterKeyFingerprint`). `deriveKey()`: (1) Check `process.env.SSH_AUTH_SOCK` -- if unset, throw `"SSH agent not available (SSH_AUTH_SOCK not set)"`. (2) Connect to agent via `net.createConnection(SSH_AUTH_SOCK)`. (3) Use `ssh2` `AgentProtocol` to list identities (`requestIdentities`). (4) If `fingerprint` is provided, find matching key; otherwise use first Ed25519 or RSA key. (5) Reject ECDSA keys with error: `"ECDSA keys are not supported for roster encryption. Use Ed25519 or RSA."` (6) Sign challenge string `"canvas-mcp:roster-key:v1"` with selected key. (7) SHA-256 hash the raw signature bytes to produce the 32-byte AES key. (8) Clean up agent connection. |
| **Behavioral Intent** | **Positive:** (1) Agent has Ed25519 key -> signs challenge -> SHA-256 of signature -> 32-byte Buffer. (2) Agent has RSA key -> same flow works. (3) Same key signs same challenge deterministically -> same derived key every time. (4) With fingerprint filter, selects the matching key from multiple identities. **Negative:** (1) `SSH_AUTH_SOCK` unset -> error with "not available" message. (2) Agent has only ECDSA keys -> error with "not supported" message. (3) Agent has no keys at all -> error "No keys found in SSH agent". (4) Fingerprint provided but no match -> error "No SSH key matching fingerprint <fp> found". (5) Agent connection refused / socket error -> descriptive error. **Edge:** (1) Agent with multiple keys (Ed25519 + RSA): without fingerprint, prefers Ed25519. (2) Challenge string is UTF-8 encoded to Buffer before signing. (3) Agent timeout (connection hangs) should have a reasonable timeout (5s). **Example:** Challenge `"canvas-mcp:roster-key:v1"` -> SSH agent signs -> raw signature bytes -> `createHash('sha256').update(signatureBytes).digest()` -> 32-byte Buffer. |
| **Validation Gate** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Commit** | `feat(core): add SshAgentKeyProvider with Ed25519/RSA support` |
| **If It Fails** | Verify `ssh2` AgentProtocol API. Check signature format (may include algorithm prefix that needs stripping). |
| **Carry Forward** | SSH agent challenge: `"canvas-mcp:roster-key:v1"`. Signature hashing: SHA-256. Key type preference: Ed25519 > RSA. ECDSA rejected. |

### Step 3.4: Implement createKeyProvider factory

| Field | Value |
|-------|-------------|
| **Step Name** | create-key-provider-factory |
| **Prerequisite State** | All three key providers exist (Steps 3.1-3.3). `CanvasTeacherConfig` has `security.rosterKeyFingerprint`. |
| **Outcome** | `createKeyProvider(config, configDir)` walks the fallback chain: SSH agent -> macOS Keychain -> file key. Logs which provider was selected to stderr. |
| **Scope / Touch List** | `packages/core/src/roster/key-providers.ts` (append factory function), `packages/core/src/roster/index.ts` (add export) |
| **Implementation Notes** | Fallback chain: (1) If `SSH_AUTH_SOCK` is set, try `SshAgentKeyProvider(config.security.rosterKeyFingerprint)`. Call `deriveKey()` to validate. If it succeeds, log to stderr `"[roster] Using SSH agent key provider"` and return. If it throws (no compatible key, connection error), continue. (2) If `process.platform === 'darwin'`, try `KeychainKeyProvider`. Call `deriveKey()` to validate. If it succeeds, log `"[roster] Using macOS Keychain key provider"` and return. If it throws, continue. (3) Try `FileKeyProvider(join(configDir, 'roster.key'))`. Do NOT call `deriveKey()` here -- just construct and return. Log `"[roster] Using file key provider"`. (4) If chain is exhausted (should not happen since FileKeyProvider doesn't validate on construction), throw `"No key provider available"`. The function signature: `async createKeyProvider(config: CanvasTeacherConfig, configDir: string): Promise<RosterKeyProvider>`. |
| **Behavioral Intent** | **Positive:** (1) `SSH_AUTH_SOCK` set + valid Ed25519 key -> returns `SshAgentKeyProvider`. (2) `SSH_AUTH_SOCK` unset + macOS + Keychain available -> returns `KeychainKeyProvider`. (3) `SSH_AUTH_SOCK` unset + non-macOS -> returns `FileKeyProvider`. (4) Each selection logs to stderr. **Negative:** (1) SSH agent available but only ECDSA keys -> falls through to Keychain. (2) SSH agent throws connection error -> falls through gracefully. (3) Keychain `security` command fails -> falls through to file. **Edge:** (1) On macOS with `SSH_AUTH_SOCK` set but agent returning errors, falls through to Keychain before file. (2) `config.security.rosterKeyFingerprint` is `null` -> no fingerprint filter passed to SSH agent provider. (3) Stderr logging uses `process.stderr.write()` with `[roster]` prefix (consistent with `[secure-store]` pattern). **Example:** On macOS with SSH agent running and Ed25519 key loaded -> stderr gets `"[roster] Using SSH agent key provider\n"` -> returns `SshAgentKeyProvider` instance. |
| **Validation Gate** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Commit** | `feat(core): add createKeyProvider factory with fallback chain` |
| **If It Fails** | Verify async/await flow in the try/catch chain. Ensure each provider's `deriveKey()` errors are caught, not propagated. |
| **Carry Forward** | Factory signature: `createKeyProvider(config: CanvasTeacherConfig, configDir: string): Promise<RosterKeyProvider>`. Fallback order: SSH -> Keychain -> File. |

---

## Phase 4: RosterStore (CRUD + Persistence)

**Milestone:** `RosterStore` round-trips students through encrypt-write-read-decrypt. All CRUD methods work. Atomic writes via tmp+rename. `0600` permissions enforced.

**Validation Gate:**
- lint: `npx tsc -p packages/core/tsconfig.build.json --noEmit`

### Step 4.1: Implement RosterStore core (load, save)

| Field | Value |
|-------|-------------|
| **Step Name** | roster-store-load-save |
| **Prerequisite State** | `RosterCrypto` exists (Phase 2). `RosterStudent`, `RosterFile` types exist (Phase 1). |
| **Outcome** | `RosterStore` class with `load()` and `save(students)` methods. Atomic writes. `0600` permissions. |
| **Scope / Touch List** | `packages/core/src/roster/store.ts` (new), `packages/core/src/roster/index.ts` (add export) |
| **Implementation Notes** | Constructor: `(configDir: string, keyProvider: RosterKeyProvider)`. Stores `rosterPath = join(configDir, 'roster.json')`. Internally creates `RosterCrypto` by awaiting `keyProvider.deriveKey()` -- but key derivation should be lazy (on first `load`/`save`), not in constructor. Add private `ensureCrypto(): Promise<RosterCrypto>` that derives key once and caches. `load()`: if file doesn't exist, return `[]`. Otherwise read file, parse as `RosterFile`, validate `version === 1`, decrypt `encrypted` field via `RosterCrypto`. `save(students: RosterStudent[])`: encrypt via `RosterCrypto`, build `RosterFile` envelope (`version: 1`, `last_updated: new Date().toISOString()`, `encrypted: blob`), atomic write (write to `.roster.json.tmp`, then `renameSync`), `chmodSync(rosterPath, 0o600)`. Follow `SidecarManager` atomic write pattern exactly. |
| **Behavioral Intent** | **Positive:** (1) `save([student1, student2])` then `load()` returns identical array. (2) `load()` on non-existent file returns `[]`. (3) `save([])` then `load()` returns `[]`. (4) File on disk has `0600` permissions after save. (5) Envelope on disk has `version: 1` and valid `last_updated` ISO string. **Negative:** (1) Corrupt JSON in `roster.json` -> throws with descriptive error. (2) File with `version: 2` -> throws "Unsupported roster file version: 2". (3) Key mismatch (save with one key, load with another) -> error containing "roster rekey" (propagated from `RosterCrypto`). **Edge:** (1) Concurrent writes: atomic rename means no partial state, but last writer wins. (2) `configDir` doesn't exist -> `mkdirSync(configDir, { recursive: true })` before write. (3) `.roster.json.tmp` left over from crashed previous write -> overwritten by new save. **Example:** `save([{ canvasUserId: 1, name: "Alice", sortable_name: "Smith, Alice", emails: ["a@b.com"], courseIds: [101], zoomAliases: [], created: "2026-01-01T00:00:00.000Z" }])` -> file written -> `load()` -> `[{ canvasUserId: 1, ... }]`. |
| **Validation Gate** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Commit** | `feat(core): add RosterStore with load/save and atomic writes` |
| **If It Fails** | Verify tmp file path uses `join(dirname(rosterPath), '.roster.json.tmp')`. Verify `renameSync` atomicity. |
| **Carry Forward** | `RosterStore` constructor signature, `rosterPath` = `join(configDir, 'roster.json')`, lazy key derivation pattern. |

### Step 4.2: Implement RosterStore query methods

| Field | Value |
|-------|-------------|
| **Step Name** | roster-store-query-methods |
| **Prerequisite State** | `RosterStore` with `load()` exists (Step 4.1). |
| **Outcome** | `findByCanvasUserId()`, `findByEmail()`, `findByZoomAlias()`, `allStudents()` methods. |
| **Scope / Touch List** | `packages/core/src/roster/store.ts` (append methods) |
| **Implementation Notes** | All query methods call `load()` internally (always reads fresh from disk). `findByCanvasUserId(id: number): Promise<RosterStudent | null>` -- find first with matching `canvasUserId`. `findByEmail(email: string): Promise<RosterStudent | null>` -- case-insensitive search across `emails` array. `findByZoomAlias(alias: string): Promise<RosterStudent | null>` -- case-insensitive search across `zoomAliases` array. `allStudents(): Promise<RosterStudent[]>` -- returns full decrypted array. |
| **Behavioral Intent** | **Positive:** (1) `findByCanvasUserId(42)` returns the student with that ID. (2) `findByEmail("ALICE@Example.com")` finds student with `"alice@example.com"` (case-insensitive). (3) `findByZoomAlias("alice s")` finds student with alias `"Alice S"` (case-insensitive). (4) `allStudents()` returns all students in the roster. **Negative:** (1) `findByCanvasUserId(999)` when no match -> returns `null`. (2) `findByEmail("nonexistent@x.com")` -> `null`. (3) `findByZoomAlias("nobody")` -> `null`. (4) All queries on empty roster -> `null` / `[]`. **Edge:** (1) Multiple students with different IDs but email searches are not confused. (2) Student has multiple emails; `findByEmail` matches any of them. (3) Student has multiple zoom aliases; `findByZoomAlias` matches any. **Example:** Roster has `[{ canvasUserId: 1, emails: ["a@b.com", "a2@b.com"], ... }]`. `findByEmail("A2@B.COM")` returns that student. |
| **Validation Gate** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Commit** | `feat(core): add RosterStore query methods` |
| **If It Fails** | Verify case-insensitive comparison uses `.toLowerCase()` on both sides. |
| **Carry Forward** | Query methods always read fresh from disk (no in-memory cache). |

### Step 4.3: Implement RosterStore mutation methods

| Field | Value |
|-------|-------------|
| **Step Name** | roster-store-mutation-methods |
| **Prerequisite State** | `RosterStore` with `load()` and `save()` exists (Step 4.1). |
| **Outcome** | `upsertStudent()`, `removeStudentCourseId()`, `appendZoomAlias()` methods. |
| **Scope / Touch List** | `packages/core/src/roster/store.ts` (append methods) |
| **Implementation Notes** | `upsertStudent(student: RosterStudent): Promise<void>` -- load, find by `canvasUserId`, replace if exists or append if new, save. `removeStudentCourseId(canvasUserId: number, courseId: number): Promise<boolean>` -- load, find student, remove courseId from `courseIds` array. If student has no remaining courseIds, remove from roster entirely. Returns `true` if student was found and modified. `appendZoomAlias(canvasUserId: number, alias: string): Promise<boolean>` -- load, find student, add alias to `zoomAliases` if not already present (case-insensitive dedup), save. Returns `true` if student found. |
| **Behavioral Intent** | **Positive:** (1) `upsertStudent` with new student adds to roster. (2) `upsertStudent` with existing `canvasUserId` replaces entire student record. (3) `removeStudentCourseId(1, 101)` removes courseId 101 from student 1's list. (4) `removeStudentCourseId` when student has only that courseId removes student from roster entirely. (5) `appendZoomAlias(1, "Alice S")` adds alias. (6) `appendZoomAlias` with already-present alias (case-insensitive) does not duplicate. **Negative:** (1) `removeStudentCourseId(999, 101)` when student doesn't exist -> returns `false`. (2) `appendZoomAlias(999, "x")` when student doesn't exist -> returns `false`. (3) `removeStudentCourseId(1, 999)` when courseId not in list -> returns `true` (student found) but no change to courseIds. **Edge:** (1) `upsertStudent` called twice with same ID updates the record. (2) After `removeStudentCourseId` removes last courseId, `findByCanvasUserId` returns `null`. (3) `appendZoomAlias` deduplication: "alice s" and "Alice S" are considered the same. **Example:** Start with student `{ canvasUserId: 1, courseIds: [101, 102] }`. `removeStudentCourseId(1, 101)` -> student now has `courseIds: [102]`. `removeStudentCourseId(1, 102)` -> student removed from roster. |
| **Validation Gate** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Commit** | `feat(core): add RosterStore mutation methods` |
| **If It Fails** | Verify upsert replaces by `canvasUserId`, not by reference. Verify save is called after mutation. |
| **Carry Forward** | Full CRUD surface complete. |

---

## Phase 5: Final Wiring and Build Verification (outline)

**Milestone:** All roster exports are in the barrel file. `npm run build` succeeds. `npm run test:unit` passes (existing tests unbroken). `ssh2` and `@types/ssh2` are in `packages/core/package.json`.

**Estimated packets:** 1-2

**Key risks / unknowns:** (1) `ssh2` may need specific import syntax for ESM. (2) Adding `ssh2` may affect build or existing tests.

**Depends on discoveries from:** Phases 1-4 (all implementations complete).

---

## Execution Packets

### Packet 1.1

| Field | Value |
|-------|-------|
| **Packet ID** | 1.1 |
| **Depends On** | none |
| **Prerequisite State** | No `packages/core/src/roster/` directory exists. `packages/core/src/config/schema.ts` exists with `CanvasTeacherConfig` type. |
| **Objective** | Define `RosterStudent`, `RosterFile`, and `RosterKeyProvider` types in a new roster module. |
| **Allowed Files** | `packages/core/src/roster/types.ts` (new) |
| **Behavioral Intent** | **Positive:** `RosterStudent` has fields: `canvasUserId: number`, `name: string`, `sortable_name: string`, `emails: string[]`, `courseIds: number[]`, `zoomAliases: string[]`, `created: string`. `RosterFile` has fields: `version: number`, `last_updated: string`, `encrypted: string`. `RosterKeyProvider` has method: `deriveKey(): Promise<Buffer>`. All are exported interfaces. **Negative:** N/A (pure type definitions). **Edge:** `created` is ISO 8601 string, not Date. |
| **Checklist** | 1. Create directory `packages/core/src/roster/`. 2. Create `types.ts` with `RosterStudent`, `RosterFile`, `RosterKeyProvider` interfaces. 3. Export all three. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles with no errors. All three types are exported from the file. |
| **Commit Message** | `feat(core): add RosterStudent, RosterFile, and RosterKeyProvider types` |
| **Stop / Escalate If** | `tsconfig.build.json` does not include `src/roster/` in its compilation scope. |

### Packet 1.2

| Field | Value |
|-------|-------|
| **Packet ID** | 1.2 |
| **Depends On** | none (independent of 1.1) |
| **Prerequisite State** | `packages/core/src/config/schema.ts` exports `CanvasTeacherConfig` and `DEFAULT_CONFIG`. |
| **Objective** | Add `security.rosterKeyFingerprint` field to config schema with `null` default. |
| **Allowed Files** | `packages/core/src/config/schema.ts` |
| **Behavioral Intent** | **Positive:** `CanvasTeacherConfig` has `security: { rosterKeyFingerprint: string | null }`. `DEFAULT_CONFIG.security.rosterKeyFingerprint` is `null`. Existing config files without `security` key deep-merge correctly to include the new field. **Negative:** N/A (additive). **Edge:** Existing unit tests in `packages/core/tests/unit/config/schema.test.ts` must still pass unchanged. |
| **Checklist** | 1. Add `security: { rosterKeyFingerprint: string | null }` to `CanvasTeacherConfig` interface. 2. Add `security: { rosterKeyFingerprint: null }` to `DEFAULT_CONFIG`. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. Existing config tests pass (`cd packages/core && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/config/`). |
| **Commit Message** | `feat(core): add security.rosterKeyFingerprint to config schema` |
| **Stop / Escalate If** | Existing config tests fail due to the schema shape change. |

### Packet 1.3

| Field | Value |
|-------|-------|
| **Packet ID** | 1.3 |
| **Depends On** | 1.1 |
| **Prerequisite State** | `packages/core/src/roster/types.ts` exists and exports the three types. |
| **Objective** | Create roster barrel export and wire it into the core `index.ts`. |
| **Allowed Files** | `packages/core/src/roster/index.ts` (new), `packages/core/src/index.ts` |
| **Behavioral Intent** | **Positive:** `import { RosterStudent, RosterFile, RosterKeyProvider } from '@canvas-mcp/core'` resolves. Barrel re-exports all types from `./types.js`. **Negative:** N/A. **Edge:** Barrel file will grow in later packets as classes are added. |
| **Checklist** | 1. Create `packages/core/src/roster/index.ts` that re-exports all types from `./types.js`. 2. Add `export * from './roster/index.js'` to `packages/core/src/index.ts` (follow `./attendance/index.js` pattern). |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. Types are importable from `@canvas-mcp/core`. |
| **Commit Message** | `feat(core): add roster barrel export and wire into core index` |
| **Stop / Escalate If** | ESM `.js` extension import issues. |

### Packet 2.1

| Field | Value |
|-------|-------|
| **Packet ID** | 2.1 |
| **Depends On** | 1.3 |
| **Prerequisite State** | `RosterStudent` and `RosterFile` types exist in `packages/core/src/roster/types.ts`. Barrel export exists at `packages/core/src/roster/index.ts`. |
| **Objective** | Implement `RosterCrypto` with AES-256-GCM encrypt/decrypt of the students array. |
| **Allowed Files** | `packages/core/src/roster/crypto.ts` (new), `packages/core/src/roster/index.ts` (add export) |
| **Behavioral Intent** | **Positive cases:** (1) Encrypt array of 3 students, decrypt returns identical array. (2) Encrypt empty array `[]`, decrypt returns `[]`. (3) Encrypt with one `RosterCrypto` instance, decrypt with a new instance using same 32-byte key succeeds. **Negative cases:** (1) Decrypt with wrong 32-byte key throws error containing `"roster rekey"`. (2) Decrypt with truncated base64 string throws error containing `"decryption failed"`. (3) Decrypt with empty string throws. **Edge conditions:** (1) Two `encrypt()` calls with same input produce different output (random IV). (2) Unicode names in students round-trip correctly. (3) Large array (1000 students) round-trips. **Blob format:** `base64(IV[12] + authTag[16] + ciphertext)`. Constructor takes `Buffer` (32-byte key). `encrypt(students: RosterStudent[]): string`. `decrypt(encrypted: string): RosterStudent[]`. On decrypt failure throw: `"Roster decryption failed. The encryption key may have changed. Run 'canvas-mcp roster rekey' to re-encrypt with the current key."` |
| **Checklist** | 1. Create `crypto.ts`. 2. Import `createCipheriv`, `createDecipheriv`, `randomBytes` from `node:crypto`. 3. Constructor stores 32-byte key Buffer. 4. `encrypt`: generate 12-byte IV, AES-256-GCM encrypt JSON-serialized students, concat `IV + authTag + ciphertext`, base64-encode. 5. `decrypt`: base64-decode, extract IV (12), authTag (16), ciphertext (rest), decrypt, JSON-parse. Wrap in try/catch with actionable error. 6. Export from barrel. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. `RosterCrypto` is importable from `@canvas-mcp/core`. |
| **Commit Message** | `feat(core): add RosterCrypto with AES-256-GCM encrypt/decrypt` |
| **Stop / Escalate If** | Buffer concatenation order ambiguity. |

### Packet 3.1

| Field | Value |
|-------|-------|
| **Packet ID** | 3.1 |
| **Depends On** | 1.3 |
| **Prerequisite State** | `RosterKeyProvider` interface exists in `packages/core/src/roster/types.ts`. Barrel export exists. |
| **Objective** | Implement `FileKeyProvider` that reads a hex-encoded 32-byte key from `roster.key` with `0600` permission validation. |
| **Allowed Files** | `packages/core/src/roster/key-providers.ts` (new), `packages/core/src/roster/index.ts` (add export) |
| **Behavioral Intent** | **Positive:** (1) File contains 64 hex chars + newline, `deriveKey()` returns 32-byte Buffer. (2) File with no trailing newline works. (3) Uppercase hex accepted. **Negative:** (1) File missing -> error with `"Key file not found"` and generation instructions: `"openssl rand -hex 32 > <path> && chmod 600 <path>"`. (2) File has `0644` perms -> error with `"insecure permissions"` and `"chmod 600"` instruction. (3) 63 hex chars (odd length) -> error `"invalid key format"`. (4) Non-hex chars -> error. **Edge:** (1) Leading/trailing whitespace trimmed. (2) Permission check uses `stat.mode & 0o777` to get permission bits. **Constructor:** `(keyPath: string)`. |
| **Checklist** | 1. Create `key-providers.ts`. 2. `FileKeyProvider` implements `RosterKeyProvider`. Constructor stores `keyPath`. 3. `deriveKey()`: `statSync` for permission check (mask `0o777`, expect `0o600`), `readFileSync`, trim, validate 64 hex chars via regex, `Buffer.from(hex, 'hex')`. 4. Descriptive errors for each failure mode. 5. Export from barrel. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. `FileKeyProvider` is importable. |
| **Commit Message** | `feat(core): add FileKeyProvider for roster.key` |
| **Stop / Escalate If** | Permission bit behavior differs across platforms in unexpected ways. |

### Packet 3.2

| Field | Value |
|-------|-------|
| **Packet ID** | 3.2 |
| **Depends On** | 3.1 |
| **Prerequisite State** | `key-providers.ts` exists with `FileKeyProvider`. |
| **Objective** | Implement `KeychainKeyProvider` for macOS Keychain via `security` CLI. |
| **Allowed Files** | `packages/core/src/roster/key-providers.ts` (append), `packages/core/src/roster/index.ts` (add export if needed) |
| **Behavioral Intent** | **Positive:** (1) First call: no keychain entry -> generates `randomBytes(32)`, stores hex in Keychain, returns Buffer. (2) Subsequent call: retrieves hex from Keychain, returns same 32-byte Buffer. **Negative:** (1) `security` command not found (ENOENT) -> `"macOS Keychain not available"`. (2) Keychain locked / `add-generic-password` fails -> error propagates with context. **Edge:** (1) Keychain service: `canvas-mcp`, account: `roster-key`. (2) `-U` flag on `add-generic-password` updates if exists. (3) Uses `child_process.execFile` (not `exec`) for safety. **Helper:** Promisified `execFile` wrapper. |
| **Checklist** | 1. Add promisified `execFile` helper (or use `util.promisify`). 2. `KeychainKeyProvider` implements `RosterKeyProvider`. 3. `deriveKey()`: try `find-generic-password`, if not found generate + `add-generic-password`, return Buffer. 4. Handle ENOENT for missing `security` binary. 5. Export from barrel. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. `KeychainKeyProvider` is importable. |
| **Commit Message** | `feat(core): add KeychainKeyProvider for macOS Keychain` |
| **Stop / Escalate If** | `security` CLI output format is ambiguous (need to confirm find-generic-password output). |

### Packet 3.3

| Field | Value |
|-------|-------|
| **Packet ID** | 3.3 |
| **Depends On** | 3.1 |
| **Prerequisite State** | `key-providers.ts` exists. `ssh2` is NOT yet in `package.json` (this packet adds it). |
| **Objective** | Implement `SshAgentKeyProvider` that derives a deterministic AES-256 key by signing a challenge via SSH agent using `ssh2` AgentProtocol. |
| **Allowed Files** | `packages/core/src/roster/key-providers.ts` (append), `packages/core/src/roster/index.ts` (add export), `packages/core/package.json` (add `ssh2`, `@types/ssh2`) |
| **Behavioral Intent** | **Positive:** (1) Agent has Ed25519 key -> signs `"canvas-mcp:roster-key:v1"` -> SHA-256 of signature -> 32-byte Buffer. (2) RSA key works same way. (3) Deterministic: same key + same challenge = same derived key. (4) Fingerprint filter selects correct key from multiple. **Negative:** (1) `SSH_AUTH_SOCK` unset -> `"SSH agent not available (SSH_AUTH_SOCK not set)"`. (2) Only ECDSA keys -> `"ECDSA keys are not supported for roster encryption. Use Ed25519 or RSA."` (3) No keys in agent -> `"No keys found in SSH agent"`. (4) Fingerprint provided but no match -> `"No SSH key matching fingerprint <fp> found"`. (5) Socket error -> descriptive error. **Edge:** (1) Multiple keys: prefer Ed25519 over RSA when no fingerprint specified. (2) 5-second connection timeout. (3) Challenge is UTF-8 Buffer. **Constructor:** `(fingerprint?: string | null)`. |
| **Checklist** | 1. Add `ssh2` to `dependencies` and `@types/ssh2` to `devDependencies` in `packages/core/package.json`. 2. `SshAgentKeyProvider` implements `RosterKeyProvider`. Constructor stores optional fingerprint. 3. `deriveKey()`: check `SSH_AUTH_SOCK`, connect via `net.createConnection`, use `AgentProtocol` to list identities, filter/select key, sign challenge, SHA-256 hash signature, cleanup connection. 4. Key type detection and ECDSA rejection. 5. Export from barrel. |
| **Commands** | `npm install` (to install ssh2), `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. `SshAgentKeyProvider` is importable. `ssh2` in package.json. |
| **Commit Message** | `feat(core): add SshAgentKeyProvider with Ed25519/RSA support` |
| **Stop / Escalate If** | `ssh2` AgentProtocol API does not support the expected `requestIdentities`/`sign` flow. ESM import issues with `ssh2`. |

### Packet 3.4

| Field | Value |
|-------|-------|
| **Packet ID** | 3.4 |
| **Depends On** | 3.1, 3.2, 3.3, 1.2 |
| **Prerequisite State** | All three key providers exist in `key-providers.ts`. `CanvasTeacherConfig` has `security.rosterKeyFingerprint`. |
| **Objective** | Implement `createKeyProvider` factory that walks the SSH -> Keychain -> File fallback chain. |
| **Allowed Files** | `packages/core/src/roster/key-providers.ts` (append), `packages/core/src/roster/index.ts` (add export) |
| **Behavioral Intent** | **Positive:** (1) `SSH_AUTH_SOCK` set + valid Ed25519 key -> returns `SshAgentKeyProvider`, logs to stderr. (2) `SSH_AUTH_SOCK` unset + macOS -> returns `KeychainKeyProvider`, logs. (3) Neither available -> returns `FileKeyProvider`, logs. **Negative:** (1) SSH agent has only ECDSA keys -> falls through to Keychain. (2) SSH agent connection error -> falls through. (3) Keychain fails -> falls through to file. **Edge:** (1) `config.security.rosterKeyFingerprint` is `null` -> no fingerprint filter. (2) Logs use `process.stderr.write("[roster] Using <provider>\n")`. (3) On non-darwin, Keychain step is skipped entirely. **Signature:** `async createKeyProvider(config: CanvasTeacherConfig, configDir: string): Promise<RosterKeyProvider>`. |
| **Checklist** | 1. Implement `createKeyProvider` function. 2. Try SSH agent (if `SSH_AUTH_SOCK` set): construct + `deriveKey()` to validate. Catch and continue on error. 3. Try Keychain (if `process.platform === 'darwin'`): construct + `deriveKey()` to validate. Catch and continue. 4. Fall through to `FileKeyProvider(join(configDir, 'roster.key'))`. 5. Log selected provider to stderr. 6. Export from barrel. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. `createKeyProvider` is importable. |
| **Commit Message** | `feat(core): add createKeyProvider factory with fallback chain` |
| **Stop / Escalate If** | Fallback logic requires testing actual SSH agent / Keychain which complicates unit tests. |

### Packet 4.1

| Field | Value |
|-------|-------|
| **Packet ID** | 4.1 |
| **Depends On** | 2.1, 1.3 |
| **Prerequisite State** | `RosterCrypto` exists. `RosterStudent`, `RosterFile`, `RosterKeyProvider` types exist. Barrel export exists. |
| **Objective** | Implement `RosterStore` with `load()` and `save()` methods using atomic writes and lazy key derivation. |
| **Allowed Files** | `packages/core/src/roster/store.ts` (new), `packages/core/src/roster/index.ts` (add export) |
| **Behavioral Intent** | **Positive:** (1) `save([s1, s2])` then `load()` returns identical array. (2) `load()` on non-existent file returns `[]`. (3) `save([])` then `load()` returns `[]`. (4) File has `0600` permissions after save. (5) Envelope on disk: `{ version: 1, last_updated: "<ISO>", encrypted: "<base64>" }`. **Negative:** (1) Corrupt JSON on disk -> descriptive error. (2) `version: 2` on disk -> `"Unsupported roster file version: 2"`. (3) Key mismatch -> error containing `"roster rekey"`. **Edge:** (1) Atomic write via `.roster.json.tmp` + `renameSync`. (2) `configDir` auto-created. (3) Stale `.roster.json.tmp` overwritten. (4) Key derivation is lazy (only on first `load`/`save`). **Constructor:** `(configDir: string, keyProvider: RosterKeyProvider)`. Inherited constraint: follow `SidecarManager` atomic write pattern. |
| **Checklist** | 1. Create `store.ts`. 2. Constructor stores `rosterPath`, `keyProvider`. 3. Private `ensureCrypto()` derives key once, caches `RosterCrypto`. 4. `load()`: if no file return `[]`, else read + parse + validate version + decrypt. 5. `save()`: encrypt + build envelope + atomic write (tmp + rename + chmod). 6. `mkdirSync(dir, { recursive: true })` before write. 7. Export from barrel. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. `RosterStore` is importable. |
| **Commit Message** | `feat(core): add RosterStore with load/save and atomic writes` |
| **Stop / Escalate If** | Unclear whether `renameSync` is atomic on the target filesystem. |

### Packet 4.2

| Field | Value |
|-------|-------|
| **Packet ID** | 4.2 |
| **Depends On** | 4.1 |
| **Prerequisite State** | `RosterStore` exists with `load()` and `save()`. |
| **Objective** | Add query methods: `findByCanvasUserId`, `findByEmail`, `findByZoomAlias`, `allStudents`. |
| **Allowed Files** | `packages/core/src/roster/store.ts` (append) |
| **Behavioral Intent** | **Positive:** (1) `findByCanvasUserId(42)` returns matching student. (2) `findByEmail("ALICE@Example.com")` case-insensitive match. (3) `findByZoomAlias("alice s")` case-insensitive match. (4) `allStudents()` returns full array. **Negative:** (1) Non-existent ID -> `null`. (2) Non-existent email -> `null`. (3) Non-existent alias -> `null`. (4) Queries on empty roster -> `null` / `[]`. **Edge:** (1) Student with multiple emails, any matches. (2) Student with multiple aliases, any matches. (3) All queries call `load()` (read from disk each time). |
| **Checklist** | 1. `findByCanvasUserId(id: number): Promise<RosterStudent | null>`. 2. `findByEmail(email: string): Promise<RosterStudent | null>` -- lowercase compare. 3. `findByZoomAlias(alias: string): Promise<RosterStudent | null>` -- lowercase compare. 4. `allStudents(): Promise<RosterStudent[]>`. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. All four methods exist on `RosterStore`. |
| **Commit Message** | `feat(core): add RosterStore query methods` |
| **Stop / Escalate If** | N/A |

### Packet 4.3

| Field | Value |
|-------|-------|
| **Packet ID** | 4.3 |
| **Depends On** | 4.1 |
| **Prerequisite State** | `RosterStore` exists with `load()` and `save()`. |
| **Objective** | Add mutation methods: `upsertStudent`, `removeStudentCourseId`, `appendZoomAlias`. |
| **Allowed Files** | `packages/core/src/roster/store.ts` (append) |
| **Behavioral Intent** | **Positive:** (1) `upsertStudent` with new student adds to roster. (2) `upsertStudent` with existing ID replaces record. (3) `removeStudentCourseId(1, 101)` removes that courseId. (4) Remove last courseId removes student entirely. (5) `appendZoomAlias(1, "Alice S")` adds alias. (6) Duplicate alias (case-insensitive) not added. **Negative:** (1) `removeStudentCourseId(999, 101)` -> `false`. (2) `appendZoomAlias(999, "x")` -> `false`. **Edge:** (1) After removing last courseId, `findByCanvasUserId` returns `null`. (2) Alias dedup: `"alice s"` == `"Alice S"`. (3) Each mutation calls `load()` then `save()`. |
| **Checklist** | 1. `upsertStudent(student: RosterStudent): Promise<void>` -- load, find/replace by `canvasUserId`, save. 2. `removeStudentCourseId(canvasUserId: number, courseId: number): Promise<boolean>` -- load, find, filter courseIds, remove student if empty, save. 3. `appendZoomAlias(canvasUserId: number, alias: string): Promise<boolean>` -- load, find, case-insensitive dedup, push if new, save. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. All three mutation methods exist. |
| **Commit Message** | `feat(core): add RosterStore mutation methods` |
| **Stop / Escalate If** | N/A |

---

## Phase 5: Final Wiring and Build Verification (outline)

**Milestone:** All roster exports finalized in barrel. `npm run build` succeeds. `npm run test:unit` passes (existing tests unbroken). Dependencies (`ssh2`, `@types/ssh2`) confirmed in lockfile.

**Estimated packets:** 1

**Key risks / unknowns:** (1) `ssh2` ESM compatibility. (2) Barrel export completeness.

**Depends on discoveries from:** Phases 1-4.

---

## Dispatch Notes

**Parallelism opportunities:**
- Packets 1.1 and 1.2 are independent -- can be dispatched in parallel.
- Packets 3.1, 3.2, and 3.3 all depend on 1.3 but are independent of each other -- can be dispatched in parallel once 1.3 completes.
- Packets 4.2 and 4.3 both depend on 4.1 but are independent of each other -- can be dispatched in parallel.

**Dependency graph:**
```
1.1 ──┐
      ├──> 1.3 ──┬──> 2.1 ──> 4.1 ──┬──> 4.2
1.2 ──┘          │                    └──> 4.3
                 ├──> 3.1 ──┬──> 3.2
                 │          └──────┐
                 ├──> 3.3 ──┐     │
                 │          ├──> 3.4
                 └──────────┘
```

**Phase 5** depends on all of Phases 1-4 completing.
