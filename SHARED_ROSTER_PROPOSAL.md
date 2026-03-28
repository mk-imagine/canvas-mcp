# Shared Student Roster — Design Proposal

## Context

This proposal is driven by the development of **email-mcp**, a companion MCP server that
reads an email inbox to identify student office hours check-ins. email-mcp is designed to
compose with canvas-mcp: email-mcp resolves check-ins → canvas-mcp submits grades.

Both MCPs handle the same set of students. Today they have no shared state, which creates
two problems:

1. **Token inconsistency** — canvas-mcp assigns `[STUDENT_001]` to Alice Smith; email-mcp
   assigns its own `[STUDENT_001]` independently. These may refer to different people.
2. **Missing email addresses** — canvas-mcp knows names and Canvas IDs (from the Canvas API)
   but not email addresses. email-mcp needs email addresses to match incoming mail to students,
   but has no authoritative source for names or Canvas IDs.

A shared persistent roster solves both problems. It also absorbs `zoom-name-map.json`,
consolidating all persistent per-student state into one file.

---

## Decisions (resolved)

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Bootstrap trigger | **Option A** — automatic on `set_active_course`; `canvas-mcp roster sync` as a manual re-sync fallback |
| 2 | Populate emails from Canvas `login_id`? | **Yes** — Canvas enrollment objects include `login_id` (institutional email); populate on bootstrap |
| 3 | Global vs. course-scoped roster | **Global** — single `roster.json`; `courseIds` array handles multi-course |
| 4 | File location | **`~/.config/mcp/canvas-mcp/roster.json`** — consistent with `zoom-name-map.json` and `config.json`; persistent, not reconstructable → config not cache |
| 5 | Token assignment strategy | **Stable by roster insertion order** — `SecureStore` gains a `preload(students[])` method called at startup before any tool handles requests |
| 6 | ROADMAP §3.1 interaction | **Coexist, do not defer** — roster and socket-based PII server address different concerns; build now |
| 7 | courseId reconciliation | **canvas-mcp reconciles removals** on every `set_active_course` bootstrap: students no longer enrolled have the course's ID removed from `courseIds`; records with empty `courseIds` are retained (orphaned) until a future cleanup pass |
| 8 | Roster cleanup | **Deferred** — retention/purge of orphaned records is a future feature |
| 9 | Zoom name map | **Absorbed** — `zoom-name-map.json` is eliminated; Zoom display name aliases move to `zoomAliases[]` on each student record (see schema). Migration: import existing map on first boot, then delete the file. |

---

## Schema

**Location:** `~/.config/mcp/canvas-mcp/roster.json`

The students array is encrypted at rest (see §Encryption). The file on disk:

```json
{
  "version": 1,
  "last_updated": "2026-03-28T00:00:00.000Z",
  "encrypted": "<base64 AES-256-GCM ciphertext of students array>"
}
```

Decrypted `students` array:

```json
[
  {
    "canvasUserId": 12345678,
    "name": "John Smith",
    "sortable_name": "Smith, John",
    "emails": ["jsmith@sfsu.edu", "john.smith@gmail.com"],
    "courseIds": [98765],
    "zoomAliases": ["john smith", "j. smith (he/him)"],
    "created": "2026-03-28T00:00:00.000Z"
  }
]
```

### Field notes

| Field | Owner | Notes |
|-------|-------|-------|
| `canvasUserId` | canvas-mcp | Authoritative from Canvas API |
| `name` | canvas-mcp | Display name from Canvas API |
| `sortable_name` | canvas-mcp | Last, First — used for fuzzy matching |
| `emails` | canvas-mcp + email-mcp CLI | canvas-mcp populates `login_id` on bootstrap; personal addresses added via `email-mcp roster add` |
| `courseIds` | canvas-mcp | Courses this student is currently enrolled in; reconciled on each `set_active_course` |
| `zoomAliases` | canvas-mcp (attendance pipeline) | Zoom display names auto-saved by name-matcher on high-confidence fuzzy match; replaces `zoom-name-map.json` |
| `created` | canvas-mcp | ISO 8601 timestamp of first insertion; never updated |

---

## Encryption

The `students` array contains PII (names, emails). It is encrypted as a single AES-256-GCM
ciphertext blob. The encryption key is never stored on disk.

### Key derivation — SSH agent signing

The preferred key source is the SSH agent (e.g. KeePassXC with SSH agent integration):

1. Connect to `SSH_AUTH_SOCK`.
2. Request a signature over a fixed, domain-separated challenge string:
   `"canvas-mcp:roster-key:v1"` using the configured key.
3. Derive the AES-256 key: `key = SHA-256(signature)`.

This is deterministic only for Ed25519 (RFC 8032 — always deterministic) and RSA-PKCS1v15.
**ECDSA must not be used** (non-deterministic k in many implementations → different key each
call). KeePassXC generates Ed25519 keys by default.

The key fingerprint to use is configured in `config.json` under
`security.rosterKeyFingerprint`. If unset and the agent exposes exactly one key, that key
is used with a logged warning to set the fingerprint explicitly.

**Lock semantics:** closing KeePassXC withdraws the key from the agent → the roster becomes
unreadable until KeePassXC is unlocked again. No key material ever touches disk.

### Key source fallback chain

| Priority | Method | Condition |
|----------|--------|-----------|
| 1 | SSH agent (Ed25519/RSA) | `SSH_AUTH_SOCK` set and configured key available |
| 2 | macOS Keychain | macOS, no SSH agent configured; random key generated on first boot and stored in Keychain under service `canvas-mcp`, account `roster-key` |
| 3 | Key file | `~/.config/mcp/canvas-mcp/roster.key`, `0600` permissions; logged warning that this is the weakest option |

### Key rotation

If the SSH key is rotated, the derived AES key changes and the roster becomes unreadable.
The server must surface a clear error on decrypt failure:

> Roster key mismatch. If you rotated your SSH key, run:
> `canvas-mcp roster rekey --old-key <fingerprint>`

`rekey` decrypts with the old key (resolved from agent or provided explicitly) and
re-encrypts with the new one.

### Implementation note

SSH agent communication uses the `SSH_AUTH_SOCK` Unix domain socket directly via a
lightweight npm library (e.g. `ssh2`'s agent support, or `ssh-agent-js`). No shelling out
to `ssh-add`.

---

## Attendance pipeline changes

`zoom-name-map.json` is eliminated. The name-matcher's persistent-map lookup (step 1 of
the 4-step pipeline) is rewritten to:

- **Read:** build a `Map<lowercaseAlias, canvasUserId>` at parse-time by iterating roster
  entries' `zoomAliases` arrays.
- **Write:** on a high-confidence auto-match, append the Zoom display name to the matched
  student's `zoomAliases` array and re-encrypt the roster.

**Migration:** on first boot after this change, if `zoom-name-map.json` exists, import each
alias into the corresponding roster entry's `zoomAliases`, then delete the file.

---

## Token stability

`SecureStore` gains a `preload(students: RosterStudent[])` method. At MCP server startup,
after reading the roster, `preload` registers tokens in roster insertion order before any
tool call triggers encounter-based tokenization. This guarantees `[STUDENT_001]` refers to
the same person across restarts and across both MCPs.

---

## Sidecar relationship

The `pii_session.json` sidecar remains unchanged: ephemeral, per-session, purged on exit.
The roster is not a replacement. The sidecar continues to hold the runtime token↔name
mapping for the current session; the roster is the persistent, cross-session, cross-MCP
source of truth.

---

## ROADMAP §3.1 note

ROADMAP §3.1 plans a Unix domain socket PII server (no plaintext PII on disk). That work
affects the sidecar, not the roster. If §3.1 is implemented, the roster's encrypted blob
becomes the only persistent PII store. The `0600` permissions, atomic write pattern, and
SSH-agent-derived key are already consistent with that future state.

---

## Non-goals

- Does not change the sidecar format or gemini-cli hook implementation.
- Does not add a `sync_roster` MCP tool — roster management stays in CLI commands.
- email-mcp's `clients/gemini/` hooks reuse the same `after_model` unblinding pattern,
  reading from `pii_session.json`.
- Roster cleanup/retention policy is deferred.
