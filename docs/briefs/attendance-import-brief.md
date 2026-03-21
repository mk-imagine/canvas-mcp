# Attendance Import Feature — Scope Strategist Brief

## Mission

Add a Zoom attendance import capability to canvas-mcp that allows a teacher to parse a Zoom participant report CSV, fuzzy-match participant names to Canvas students, and post binary attendance grades to the Canvas gradebook — all while keeping the LLM completely blind to any PII.

## Context

### Existing Infrastructure

- **canvas-mcp** is an npm workspaces monorepo: `packages/core` (shared library) and `packages/teacher` (MCP server entry point).
- **NameIndex** (`packages/core/src/matching/`) provides Levenshtein-based fuzzy matching with three phases: exact case-insensitive, partial-name, and fuzzy. This was built for the Gemini CLI sidecar but the core matching logic is reusable.
- **SecureStore** (`packages/core/src/security/secure-store.ts`) tokenizes Canvas user IDs to `[STUDENT_NNN]` tokens. Real names are encrypted in-memory with AES-256-GCM per-session key.
- **Tool registration pattern**: `register*Tools(server, client, configManager)` functions that register MCP tools with Zod input schemas.
- **ConfigManager** reads/writes `~/.config/mcp/canvas-mcp/config.json` with deep-merge against defaults.
- **CanvasClient** provides `get`, `getOne`, `post`, `put`, `delete` with pagination, rate limiting, and retry logic.

### Problem

Zoom participant reports contain messy display names (partial names, nicknames, numbers appended) that rarely match Canvas roster names exactly. Matching requires seeing real names, but the LLM must remain PII-blind per FERPA requirements. The solution must perform all name resolution server-side.

## Requirements

### Functional

1. **Parse Zoom CSV**: Read a Zoom participant report CSV, extract participant names from the `Name (original name)` column and durations from `Duration (minutes)`.
2. **Filter host**: Remove the host entry (identified by exact match on a configured host name — the host has ` (Host)` appended in the CSV).
3. **Duration threshold**: Optionally filter out participants below a minimum duration (default: 0 minutes, meaning any appearance counts as present).
4. **Name matching pipeline** (in order):
   - Look up the persistent Zoom name map first (exact match on lowercased Zoom display name → Canvas user ID). If found, skip fuzzy matching for that name.
   - For unmatched names, fuzzy-match against the Canvas roster using Levenshtein distance (reuse/adapt NameIndex).
   - High-confidence fuzzy matches: auto-save to persistent map and include in results.
   - Ambiguous/unmatched: write to a local review file with real names (for human review). Do NOT send real names to the LLM.
5. **Submit grades**: Post the configured point value for each present student. Absent students receive NO grade (not 0). Supports dry-run mode.
6. **Tokenized output**: All LLM-facing output uses `[STUDENT_NNN]` tokens only. The LLM sees present/absent lists, counts, and the review file path — never real names.

### Non-Functional

- **PII blindness**: No real student names, Zoom display names, or email addresses may appear in any MCP tool response sent to the LLM.
- **Persistent map curation**: The `zoom-name-map.json` file is human-editable JSON. High-confidence matches are auto-saved; ambiguous matches require manual resolution.
- **Re-parse friendly**: Running parse again after editing the map picks up new entries immediately. Parsed state is in-memory only (no temp files).
- **Template-agnostic assignment lookup**: The tool takes an `assignment_id` directly. The LLM uses existing `find_item` to locate the assignment first (e.g., "Weekly Check-in with Instructor" or "Weekly Discussion Group").

## Tool Design

### `import_attendance`

Single MCP tool with two actions:

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `action` | `"parse" \| "submit"` | yes | |
| `csv_path` | string | for parse | absolute path to Zoom CSV |
| `assignment_id` | number | yes | target Canvas assignment |
| `points` | number | for submit | all-or-nothing score |
| `min_duration` | number | no | minimum minutes present (default: 0) |
| `dry_run` | boolean | no | for submit — preview without posting |

### Parse action

- Returns to LLM: tokenized present list, absent count, unresolved count, review file path (if ambiguities exist).

### Submit action

- Requires a prior parse in the same session (in-memory state).
- Posts `points` for each present student, skips absent students entirely.
- `dry_run: true` returns what would be posted without posting.
- Returns tokenized confirmation.

## Config Additions

```json
{
  "attendance": {
    "hostName": "Mark Ferdman",
    "defaultPoints": 10,
    "defaultMinDuration": 0
  }
}
```

Added to the existing config schema under `ConfigManager`.

## File Locations

- **Persistent Zoom name map**: `~/.config/mcp/canvas-mcp/zoom-name-map.json`
- **Review file** (ambiguous/unmatched): `~/.config/mcp/canvas-mcp/attendance-review.json`

## Workflow (LLM perspective)

```
User: "Enter attendance for this week's check-in" [provides CSV path]
LLM:  find_item("Weekly Check-in")          → assignment_id 54321
LLM:  import_attendance(parse, csv, 54321)   → "[STUDENT_001]: present, ... 18/20 matched, 2 unresolved → review file at [path]"
User: [edits zoom-name-map.json to resolve ambiguities]
User: "re-parse"
LLM:  import_attendance(parse, csv, 54321)   → "20/20 matched"
User: "submit"
LLM:  import_attendance(submit, 54321, 10)   → "20 grades posted (10/10 each)"
```

## Constraints & Boundaries

- This feature does NOT create assignments — it grades existing ones.
- This feature does NOT handle email-based check-ins (future work).
- The persistent map is per-installation, not per-course (Zoom names are student-global).
- The review file is overwritten on each parse (it's ephemeral context for the current import session).
- No new MCP tools beyond `import_attendance` — keep the tool surface area minimal.

## Existing Code to Reuse/Adapt

- `packages/core/src/matching/name-index.ts` — NameIndex builder and fuzzy matching
- `packages/core/src/security/secure-store.ts` — student tokenization
- `packages/core/src/config/` — ConfigManager, config schema, defaults
- `packages/teacher/src/tools/` — tool registration pattern
- `packages/teacher/src/tools/reporting.ts` — example of a tool that uses SecureStore for blinding
