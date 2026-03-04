# Gemini CLI Hooks for canvas-mcp

Provides automatic PII blinding/unblinding when using canvas-mcp with the Gemini CLI. Student names never reach the model — only opaque `[STUDENT_NNN]` tokens do — and the model's responses are transparently unblinded in your terminal before you see them.

Three hooks are involved:

| Hook | Event | What it does |
|------|-------|--------------|
| `before_model` | `BeforeModel` | Replaces real student names in your prompt with session tokens |
| `after_model` | `AfterModel` | Replaces tokens in the model's response with real names |
| `after_tool` | `AfterTool` | Writes a one-line progress summary to the terminal for canvas-mcp tool calls |

---

## Prerequisites

- **Node.js 20+**
- **Gemini CLI v0.26.0 or later** (hooks were introduced in this release)
- **canvas-mcp** installed and configured with a valid `canvas.instanceUrl` and `canvas.apiToken`

---

## Step 1 — Enable blinding in canvas-mcp

Open your canvas-mcp config (default: `~/.config/mcp/canvas-mcp/config.json`) and add or update the `privacy` block:

```json
{
  "canvas": { "...": "..." },
  "privacy": {
    "blindingEnabled": true,
    "sidecarPath": "~/.cache/canvas-mcp/pii_session.json"
  }
}
```

`sidecarPath` can be omitted — the default shown above is used automatically. The path is where the server writes the live token↔name mapping that the hooks read.

> **Upgrading from an earlier canvas-mcp version?** If your config file already exists but has no `privacy` key, the server will automatically add `"blindingEnabled": true` on first run and write it back to disk, preserving the always-on blinding behaviour from before this feature was introduced.

---

## Step 2 — Build the hooks

From the repo root:

```bash
cd clients/gemini
npm install
npm run build
```

This compiles the TypeScript sources in `src/` to `dist/`. The three hook scripts end up at:

```
clients/gemini/dist/before_model.js
clients/gemini/dist/after_model.js
clients/gemini/dist/after_tool.js
```

---

## Step 3 — Configure Gemini CLI

Add the following to your Gemini CLI user settings at **`~/.gemini/settings.json`** (create the file if it doesn't exist). Replace `/absolute/path/to` with the actual absolute path to the repo on your machine.

```json
{
  "hooks": {
    "BeforeModel": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/canvas-mcp/clients/gemini/dist/before_model.js",
            "name": "canvas-mcp: blind student names in prompt",
            "timeout": 5000
          }
        ]
      }
    ],
    "AfterModel": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/canvas-mcp/clients/gemini/dist/after_model.js",
            "name": "canvas-mcp: unblind tokens in response",
            "timeout": 5000
          }
        ]
      }
    ],
    "AfterTool": [
      {
        "matcher": "canvas.mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/canvas-mcp/clients/gemini/dist/after_tool.js",
            "name": "canvas-mcp: progress indicator",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

The `AfterTool` matcher `canvas.mcp__.*` is a regex. Gemini CLI names MCP tools as `servername__toolname` (no `mcp__` prefix). The `.` wildcard matches both `canvas-mcp__*` and `canvas_mcp__*` depending on whether Gemini CLI preserves or normalises the hyphen. `BeforeModel` and `AfterModel` apply to every model call but return `{}` (no-op) when the sidecar doesn't exist yet.

> **Project-level override:** You can also place a `.gemini/settings.json` inside a specific project directory. Project settings take precedence over user settings.

---

## Step 4 — Verify

1. Start a Gemini CLI session with canvas-mcp connected.
2. Call any grade or submission tool, for example:
   ```
   get_grades scope=class
   ```
3. You should see a notification in the output:
   ```
   [canvas-mcp] PII sidecar updated — 32 students mapped to tokens.
   ```
4. Confirm the sidecar file was written:
   ```bash
   cat ~/.cache/canvas-mcp/pii_session.json
   ```
   It should contain a JSON object with `session_id`, `last_updated`, and a `mapping` object of `[STUDENT_NNN]` ↔ real name pairs.
5. In subsequent prompts that mention a student by name, `before_model` will replace that name with its token before the model sees it. The model's response (which contains tokens) will be unblinded by `after_model` before it reaches your terminal.

---

## Custom sidecar path

If you set a non-default `privacy.sidecarPath` in the canvas-mcp config, you need to tell the hooks where to find it via an environment variable. Add `CANVAS_MCP_SIDECAR_PATH` to the Gemini CLI environment or prepend it to each hook command:

```json
"command": "CANVAS_MCP_SIDECAR_PATH=/your/custom/path.json node /absolute/path/to/.../before_model.js"
```

---

## How the sidecar works

```
canvas-mcp server                          Gemini CLI process
─────────────────                          ──────────────────
get_grades called
  → tokenize students                      before_model hook
  → write sidecar ──────────────────────→    reads sidecar
  → return blinded JSON                      blinds names in prompt
                                           model sees only [STUDENT_NNN]
                                           after_model hook
                                             reads sidecar
                                             replaces tokens with names
                                           you see real names in output
```

The sidecar is written fresh whenever the session ID changes (i.e., every new server process), so the hooks always have the correct mapping for the current session. The file is deleted automatically when the server shuts down.

---

## Known limitations

**First-message blindspot:** `before_model` can only replace names that are already in the sidecar. The sidecar doesn't exist until the first canvas-mcp tool call completes. If you type a student's name in your very first message — before running any tool — that name will reach the model unblinded. To avoid this, run `get_grades` (or any other reporting tool) before asking questions that reference specific students. The `[canvas-mcp] PII sidecar updated` notification confirms the sidecar is ready.

**Single server instance:** Two simultaneous canvas-mcp processes will overwrite each other's sidecar. The atomic write prevents file corruption, but only the most recently started process's session will be in the file.

**Plaintext on disk:** The sidecar is unencrypted JSON, protected only by `600` file permissions. `SecureStore` holds the same data encrypted in memory. The sidecar is deleted on server shutdown. See `docs/SECURITY.md` for the full threat model.
