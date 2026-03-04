# Implementation Plan: MCP Privacy Preservation (Gemini CLI Add-on)

## 1. Objective
To implement an opt-in privacy layer that allows users (e.g., "Jake") to analyze student data without exposing PII to the LLM. The server produces fixed-length opaque tokens; a sidecar mapping file enables client-side hooks to perform silent, automated unblinding in supported CLI environments.

---

## 2. Core Principles
1.  **Opt-In Blinding:** Disabled by default. Enabled via `config.json` (`privacy.blindingEnabled: true`) or `CANVAS_PII_BLINDING=true` environment variable.
2.  **Fixed-Length Tokens:** Tokens use the existing `[STUDENT_NNN]` format. Length-matching is unnecessary because Gemini CLI (and other target clients) use a Markdown parser that handles uneven column widths automatically.
3.  **Absolute Sidecar Path:** The mapping file is stored at a stable absolute path: `~/.cache/canvas-mcp/pii_session.json`.
4.  **Client-Agnostic Server:** The server does not detect the client type. It produces tokens and a sidecar; client-side hooks handle all UI preferences.
5.  **Lazy Sidecar Sync:** The sidecar is not written at startup. It is created or refreshed on every blinded tool call, gated by a session ID check. This ensures the file is always consistent with live session state without requiring any startup ordering.

---

## 3. Technical Architecture

### A. `SecureStore` (`packages/core/src/security/secure-store.ts`)
Minimal changes to the existing implementation:
- Add a `sessionId` property: a UUID generated once in the constructor.
- Token format (`[STUDENT_NNN]`) is **unchanged**.

### B. `SidecarManager` (new: `packages/core/src/security/sidecar-manager.ts`)
A new utility class responsible for all sidecar I/O:

- **`sync(store: SecureStore): boolean`**
  1. If `blindingEnabled` is `false`, no-op.
  2. Read the existing sidecar (if present) and compare its `session_id` field to `store.sessionId`.
  3. If the session ID matches, no-op — return `false`.
  4. Otherwise, write the full current token↔name mapping from `SecureStore` to disk atomically (write to `.tmp`, then `rename`). Set file permissions to `600`. Return `true`.

- **`purge()`:** Deletes the sidecar file. Called on all exit paths.

- **Sidecar format:**
  ```json
  {
    "session_id": "uuid-v4",
    "last_updated": "2026-03-03T12:00:00.000Z",
    "mapping": {
      "[STUDENT_001]": "Jane Doe",
      "Jane Doe": "[STUDENT_001]"
    }
  }
  ```

### C. Configuration (`packages/core/src/config/schema.ts`)
Add a `privacy` block to `CanvasTeacherConfig`:
```typescript
privacy: {
  blindingEnabled: boolean   // default: false
  sidecarPath: string        // default: "~/.cache/canvas-mcp/pii_session.json"
}
```

### D. Server Lifecycle (`packages/teacher/src/index.ts`)
- **Startup:** `SidecarManager` is instantiated alongside `SecureStore`. No file is written at this point.
- **Shutdown:** `SidecarManager.purge()` is added to the existing `SIGINT`, `SIGTERM`, `SIGHUP`, and `uncaughtException` handlers.

### E. Tool Call Lifecycle (per blinded tool invocation)
When `blindingEnabled` is `true`, every reporting tool that tokenizes PII follows this sequence:

1. Tokenize students via `SecureStore` (existing behavior — no change).
2. Call `SidecarManager.sync(store)`.
3. If `sync()` returned `true` (file was written or refreshed), append a notification content block to the tool response with `audience: ['user']`:
   > `[canvas-mcp] PII sidecar updated — N students mapped to tokens.`
4. Return the blinded result as normal.

After the first blinded tool call of a session, the sidecar is guaranteed to exist before any Gemini CLI hook needs to read it.

---

## 4. Gemini CLI Hooks (`clients/gemini/`)
All three scripts live in `clients/gemini/src/` and are compiled to `clients/gemini/dist/`. They read from the **same absolute sidecar path** (`~/.cache/canvas-mcp/pii_session.json` by default, or the path in config):

1.  **`before_model.ts`** — Input blinding. Reads the sidecar; replaces real student names in the user's prompt with their tokens. If the sidecar does not yet exist (no tool call has been made this session), passes the prompt through unchanged.
2.  **`after_model.ts`** — Output unblinding. Reads the sidecar; performs a simple regex replace of `[STUDENT_NNN]` tokens with real names in the LLM response. No table reformatting required — the Markdown renderer handles column widths.
3.  **`after_tool.ts`** — Visual cleanup. Suppresses raw JSON tool result blocks from the terminal and displays a minimalist progress indicator instead (e.g., `[canvas-mcp] Fetching data for 40 students…`).

This directory is intentionally separate from `packages/` — these scripts run inside the Gemini CLI process, not the MCP server. Future client integrations (e.g., `clients/claude-code/`, `clients/cursor/`) would follow the same pattern.

---

## 5. Roadmap

### Phase 1: Foundation & Lifecycle
- [x] **Step 1:** Implement `SidecarManager` (`sync()`, `purge()`, atomic write, `600` permissions, directory creation).
- [x] **Step 2:** Add `sessionId` to `SecureStore`.
- [x] **Step 3:** Integrate `SidecarManager` into `index.ts`; verify `purge()` is called on all exit paths.
- [x] **Step 4:** Update `schema.ts` and `ConfigManager` for `privacy.blindingEnabled` and `privacy.sidecarPath`.

### Phase 2: Blinding Integration
- [x] **Step 5:** Update reporting tools to gate blinding on `blindingEnabled`, call `sync()` after tokenizing, and append the user-facing sidecar notification.

### Phase 3: Client Extensions
- [x] **Step 6:** Create `clients/gemini/` with its own `package.json` and `tsconfig.json`; implement `before_model`, `after_model`, and `after_tool`.
- [ ] **Step 7:** End-to-end validation: verify token blinding in Claude Code and automated unblinding in Gemini CLI.

---

## 6. Known Tradeoffs & Caveats

### 6.1 Sidecar is Plaintext on Disk
`SecureStore` holds PII encrypted in memory (AES-256-GCM). The sidecar is a plaintext copy of the same data. This is an intentional tradeoff for PoC usability: `600` permissions protect against other OS users but not root, forensic disk analysis, or backup tools.

`SidecarManager` is fully isolated — removing the sidecar in a future version requires deleting one class and the `sync()` call in reporting tools, with no changes to `SecureStore` or the blinding logic.

### 6.2 First-Message Blindspot
`before_model.js` can only blind names that are in the sidecar. The sidecar does not exist until the first blinded tool call completes. If a user types a student's name in their very first message (before any Canvas tool has run), that name reaches the LLM unblinded.

**Mitigation:** Document in setup instructions that users should run a data-fetching tool (e.g., `get_grades`) before asking questions that reference specific students. The `[canvas-mcp] PII sidecar updated` notification (§3.E) confirms readiness.

### 6.3 Opt-In Default Removes Existing Phase 6 Protection on Upgrade
Phase 6 shipped always-on blinding. This plan makes blinding conditional on `privacy.blindingEnabled`. An existing user who upgrades will have the new `privacy` block deep-merged at its default (`false`), silently disabling their existing protection.

**Mitigation:** In the `ConfigManager` migration step (Step 4), detect whether a `privacy` key is absent from the user's on-disk config. If absent, infer the user was on always-on blinding and write `blindingEnabled: true` on first run. Include a CHANGELOG notice.

### 6.4 Concurrent Server Instances
Two simultaneous `canvas-mcp` processes will clobber each other's sidecar. The atomic write prevents file corruption but not session ID collisions.

---

## 7. Future Implementation Notes

- **Server-start roster pre-fetch:** On startup (if `blindingEnabled`), silently fetch the course enrollment list to populate `SecureStore` and write the initial sidecar. Eliminates the first-message blindspot (§6.2) entirely.
- **Per-session sidecar files:** Scope the sidecar filename to the session ID (e.g., `pii_<uuid>.json`) and pass the path to hooks via an environment variable. Resolves concurrent instance clobbering (§6.4).
- **Encrypted sidecar:** Replace plaintext JSON with an AES-256-GCM envelope, with the key stored in the OS keychain or derived from a user passphrase. Resolves the plaintext-on-disk risk (§6.1).
- **Default-on migration:** Once client-side hook support is widespread, flip `blindingEnabled` to `true` by default and remove the migration shim from §6.3.
