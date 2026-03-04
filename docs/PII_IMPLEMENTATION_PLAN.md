# Implementation Plan: Client-Aware MCP Privacy Preservation

## 1. Objective
To implement a robust, opt-in privacy layer that allows users (e.g., "Jake") to analyze student performance data without exposing PII (Personally Identifiable Information) to the LLM. The system must be **client-aware**, ensuring seamless unblinding for supported clients (Gemini CLI) while maintaining standard behavior for others.

---

## 2. Core Principles
1.  **Default-Off:** PII blinding is disabled by default to ensure maximum compatibility for new users.
2.  **Opt-In:** Users must explicitly enable blinding via `config.json` or the `CANVAS_PII_BLINDING=true` environment variable.
3.  **Client-Awareness:** The server adjusts its blinding strategy based on the `clientInfo.name` provided during the MCP `initialize` phase.
4.  **Visual Integrity:** Tokens used in LLM-generated tables must match the character length of the original names to prevent layout breakage.

---

## 3. Blinding Strategies

### Strategy A: `GEMINI_HOOKS` (Target: `gemini-cli`)
*   **Token Format:** Character-length matched (Minimum 6 characters).
    *   *Example:* "Bo" (2) → `[S:a4f2]` (6) | "Jane Doe" (8) → `[S:a4f2b3c4]` (8).
*   **Sidecar Mapping:** Enabled. Writes `Token <-> Name` mapping to a local JSON file for CLI hooks to read.
*   **Workflow:** Uses `BeforeModel`, `AfterTool`, and `AfterModel` hooks for silent, bi-directional unblinding.

### Strategy B: `STANDARD_BLINDING` (Target: `claude-code`, others)
*   **Token Format:** Stable counter-based tokens (e.g., `[STUDENT_001]`).
*   **Sidecar Mapping:** Disabled (No disk I/O).
*   **Workflow:** Relies on the standard `student_pii` resolve tool and dual-audience tool results (`audience: ["user"]`).

---

## 4. Technical Architecture

### A. Server Enhancements (`packages/core`)
1.  **`SecureStore` Refactor:**
    *   Implement `setStrategy(strategyName: string)` to switch token generation logic.
    *   Implement `lengthMatchedTokenize(name: string)`:
        *   Prefix: `[S:`
        *   Suffix: `]`
        *   Entropy: Random hash to fill the remaining length.
        *   Floor: 6 characters.
2.  **`SidecarManager`:**
    *   Handles atomic writes to `.gemini/tmp/canvas-mcp/pii_session.json`.
    *   Sets file permissions to `600` (User-only).
    *   Implements a `cleanup()` method to delete the file on process exit (`SIGINT`/`SIGTERM`).

### B. Configuration & Detection (`packages/teacher`)
1.  **`ConfigManager`:**
    *   Add `privacy.blindingEnabled` (boolean, default `false`).
2.  **MCP `initialize` Interception:**
    *   Capture `clientInfo.name` from the initial handshake.
    *   If `blindingEnabled` is `true`, map the client name to a strategy:
        *   `"gemini-cli"` → `GEMINI_HOOKS`
        *   Everything else → `STANDARD_BLINDING`

### C. Reporting Tools (`packages/teacher/src/tools/reporting.ts`)
1.  **`blindedResponse` Update:**
    *   Logic check: If `!config.privacy.blindingEnabled`, bypass all blinding and return real names in a single text block.
    *   If enabled, call the current strategy's `tokenize` method.

---

## 5. Gemini CLI Hook Implementation (`packages/gemini-hooks`)
A new internal package will contain the scripts for the Gemini CLI:
1.  **`before_model.js`**: Scans user input for names found in the sidecar mapping and replaces them with tokens.
2.  **`after_model.js`**: Scans the LLM response stream for tokens and replaces them with names.
3.  **`after_tool.js`**: Intercepts raw JSON result blocks, suppresses them, and prints a minimalist progress bar/status message.

---

## 6. Roadmap
- [ ] **Step 1:** Update `schema.ts` and `ConfigManager` to support opt-in privacy settings.
- [ ] **Step 2:** Refactor `SecureStore` for strategies and length-matched tokens.
- [ ] **Step 3:** Implement `SidecarManager` and lifecycle cleanup.
- [ ] **Step 4:** Modify `index.ts` to detect client type and initialize the correct strategy.
- [ ] **Step 5:** Create the `gemini-hooks` package with basic regex-swapping scripts.
- [ ] **Step 6:** End-to-end validation (verify alignment in Markdown tables).
