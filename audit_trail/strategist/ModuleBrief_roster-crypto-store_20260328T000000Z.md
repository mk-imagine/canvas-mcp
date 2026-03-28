# Module Brief: roster-crypto-store

| Field | Value |
|-------|-------|
| **Module Name** | roster-crypto-store |
| **Purpose** | Provide the encrypted persistent roster storage layer: key derivation (SSH agent, macOS Keychain, key file fallback chain), AES-256-GCM encryption/decryption of the students array, and CRUD operations on `roster.json`. This is the foundational data layer that all other roster modules depend on. |
| **Boundary: Owns** | 1. `RosterKeyProvider` interface and three implementations: `SshAgentKeyProvider` (Ed25519/RSA via SSH agent), `KeychainKeyProvider` (macOS `security` CLI), `FileKeyProvider` (`roster.key` with `0600`). 2. `RosterCrypto` — encrypts/decrypts the students array blob using AES-256-GCM with a key from the provider chain. 3. `RosterStore` — reads, writes, and merges `roster.json` (atomic write via tmp+rename, `0600` permissions). Exposes typed CRUD: `load()`, `save()`, `upsertStudent()`, `removeStudentCourseId()`, `findByCanvasUserId()`, `findByEmail()`, `findByZoomAlias()`, `allStudents()`. 4. `RosterStudent` type definition (the decrypted record schema from the proposal). 5. `RosterFile` type definition (the on-disk envelope: `version`, `last_updated`, `encrypted`). 6. Config schema extension: `security.rosterKeyFingerprint` field added to `CanvasTeacherConfig`. 7. Key rotation error detection: clear error message when decrypt fails due to key mismatch. |
| **Boundary: Consumes** | `ConfigManager.getConfigDir()` for roster file path resolution. `CanvasTeacherConfig` type from `packages/core/src/config/schema.ts`. Node.js `crypto` module for AES-256-GCM. |
| **Public Surface** | **Types:** `RosterStudent` — `{ canvasUserId: number, name: string, sortable_name: string, emails: string[], courseIds: number[], zoomAliases: string[], created: string }`. `RosterFile` — `{ version: number, last_updated: string, encrypted: string }`. `RosterKeyProvider` — `{ deriveKey(): Promise<Buffer> }`. **Classes:** `RosterStore` — constructor takes `(configDir: string, keyProvider: RosterKeyProvider)`. Methods: `load(): Promise<RosterStudent[]>`, `save(students: RosterStudent[]): Promise<void>`, `upsertStudent(student: Omit<RosterStudent, 'created'>): Promise<void>`, `removeStudentCourseId(canvasUserId: number, courseId: number): Promise<void>`, `findByCanvasUserId(id: number): Promise<RosterStudent \| undefined>`, `findByZoomAlias(alias: string): Promise<RosterStudent \| undefined>`, `allStudents(): Promise<RosterStudent[]>`, `appendZoomAlias(canvasUserId: number, alias: string): Promise<void>`. **Factory:** `createKeyProvider(config: CanvasTeacherConfig): Promise<RosterKeyProvider>` — walks the fallback chain and returns the first viable provider. |
| **External Dependencies** | **`ssh2`** (npm) — for SSH agent protocol communication via `SSH_AUTH_SOCK`. Used only by `SshAgentKeyProvider`. Lands in `packages/core/package.json` dependencies. **No native bindings for macOS Keychain** — `KeychainKeyProvider` uses `child_process.execFile('security', ...)` to call the macOS `security` CLI (`find-generic-password` / `add-generic-password`). Zero additional npm deps for this path. |
| **Inherited Constraints** | Atomic file writes (tmp+rename pattern) consistent with `SidecarManager`. `0600` file permissions consistent with sidecar. Config schema changes must preserve backward compatibility via `DEFAULT_CONFIG` deep-merge (existing pattern in `ConfigManager`). All new code in `packages/core` — no MCP server logic. |
| **Repo Location** | `packages/core/src/roster/key-providers.ts` — `RosterKeyProvider` interface + three implementations. `packages/core/src/roster/crypto.ts` — `RosterCrypto` (encrypt/decrypt blob). `packages/core/src/roster/store.ts` — `RosterStore` class. `packages/core/src/roster/types.ts` — `RosterStudent`, `RosterFile` types. `packages/core/src/roster/index.ts` — barrel export. `packages/core/src/config/schema.ts` — add `security.rosterKeyFingerprint` to config type + default. `packages/core/src/index.ts` — re-export roster public surface. **Tests:** `packages/core/tests/unit/roster/crypto.test.ts`, `packages/core/tests/unit/roster/store.test.ts`, `packages/core/tests/unit/roster/key-providers.test.ts`. |
| **Parallelism Hints** | `key-providers.ts`, `crypto.ts`, and `types.ts` can be built in parallel. `store.ts` depends on `crypto.ts` and `types.ts`. Config schema change is independent. Tests can be written in parallel with implementation if interfaces are defined first. |
| **Cross-File Coupling** | `crypto.ts` and `store.ts` are tightly coupled — `RosterStore` is the sole consumer of `RosterCrypto`. `key-providers.ts` and `crypto.ts` are coupled via `RosterKeyProvider` interface. These three files should be modified together. `config/schema.ts` change is a leaf dependency (adding a field + default). |
| **Execution Mode Preference** | `Guided Execution` — The SSH agent protocol interaction and keychain CLI integration involve design decisions around error handling, key algorithm validation (reject ECDSA), and fallback chain ordering that benefit from user review. |
| **Definition of Done** | 1. `RosterStore` can round-trip (encrypt, write, read, decrypt) a students array using each of the three key providers. 2. SSH agent provider correctly derives a deterministic AES-256 key from an Ed25519 signature over the challenge string `"canvas-mcp:roster-key:v1"`. 3. SSH agent provider rejects ECDSA keys with a clear error. 4. macOS Keychain provider generates a random key on first use and retrieves it on subsequent calls. 5. File key provider reads from `roster.key` with `0600` check. 6. `createKeyProvider()` walks the fallback chain correctly: SSH agent -> Keychain (macOS only) -> file. 7. Decrypt failure (wrong key) produces an actionable error message referencing `canvas-mcp roster rekey`. 8. Atomic write: roster file is never left in a partial state. 9. `security.rosterKeyFingerprint` config field exists with `null` default; existing configs load without error. 10. All unit tests pass; SSH agent tests use a mock agent (not real `SSH_AUTH_SOCK`). |

---

## Supplementary Analysis

### SSH Agent Library Decision

**Recommendation: `ssh2`** (npm package, v1.x)

Rationale:
- Mature, widely-used (40M+ weekly downloads), maintained by mscdex.
- Includes `AgentProtocol` class for direct agent communication without establishing an SSH connection.
- TypeScript types available via `@types/ssh2`.
- The agent client can list keys (`requestIdentities`) and request signatures (`sign`) — exactly the two operations needed.
- Alternative `ssh-agent-js` is unmaintained and has fewer downloads.

Usage pattern:
1. Connect to `SSH_AUTH_SOCK` via `net.createConnection()`.
2. Use `ssh2`'s agent protocol to send `SSH2_AGENTC_REQUEST_IDENTITIES` and `SSH2_AGENTC_SIGN_REQUEST`.
3. SHA-256 hash the signature bytes to derive the AES-256 key.

### macOS Keychain Strategy

**Recommendation: `security` CLI via `child_process.execFile`**

Rationale:
- `keytar` is archived (deprecated by the Atom/GitHub team).
- Native Node.js bindings (`node-keytar`, `keychain-access`) require node-gyp and are fragile across Node versions.
- The macOS `security` CLI is stable, ships with every macOS version, and requires no additional dependencies.
- `execFile` (not `exec`) prevents shell injection.

Commands:
- Store: `security add-generic-password -s canvas-mcp -a roster-key -w <hex-key> -U`
- Retrieve: `security find-generic-password -s canvas-mcp -a roster-key -w`
- The `-U` flag updates if exists, preventing duplicates.

### Dependency Placement

| Dependency | Package | Rationale |
|-----------|---------|-----------|
| `ssh2` | `packages/core` | Key provider is core infrastructure, not server-specific |
| `@types/ssh2` | `packages/core` (devDependencies) | Type support |

No new dependencies needed for macOS Keychain (uses built-in `child_process`) or file key provider (uses built-in `fs`).

### Risk: SSH Agent Availability in MCP Context

MCP servers are launched by clients (Claude Desktop, Gemini CLI) which may not inherit `SSH_AUTH_SOCK`. The fallback chain handles this gracefully — if the SSH agent is unavailable, it falls to Keychain or file. However, this should be documented clearly. The `createKeyProvider` factory should log which provider was selected to stderr for debuggability.
