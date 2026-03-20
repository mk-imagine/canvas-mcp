# Implementation Plan — Module 3.2: Server-Start Roster Pre-Fetch

**Prepared by:** SoftwareTactician
**Date:** 2026-03-20
**Module:** 3.2 of canvas-mcp Roadmap
**Source brief:** `audit_trail/strategist/2026-03-20_module-brief_module-3-2-roster-prefetch.md`

---

## Ground-Truth Verification

File read: `packages/teacher/src/index.ts` (63 lines total).

| Claim in Brief | Actual in File | Status |
|---|---|---|
| Line 3 import | `import { ConfigManager, CanvasClient, SecureStore, SidecarManager, registerContextTools } from '@canvas-mcp/core'` | Confirmed |
| Line 28 | `const { activeCourseId, courseCache } = config.program` | Confirmed |
| "Line 30" insertion target | Actual line 29: `let instructions: string` | **Off-by-one — brief is wrong; insertion is between L28 and L29** |
| `fetchStudentEnrollments` exported from `@canvas-mcp/core` | `packages/core/src/index.ts` L23 | Confirmed |
| `enrollment.user_id: number` | `CanvasEnrollment.user_id: number` L29 | Confirmed |
| `enrollment.user.name: string` | `CanvasEnrollment.user.name: string` L32 | Confirmed |

---

## Execution Packet EP-3.2.1 — Add Roster Pre-Fetch to `packages/teacher/src/index.ts`

**Depends on:** None
**Objective:** Add a fire-and-forget roster pre-fetch on server startup that populates SecureStore before any tool call, eliminating the first-message blindspot for student PII.
**Execution mode:** Tool-Integrated

### Pre-conditions

1. `packages/teacher/src/index.ts` is at the current state (63 lines, as verified above)
2. `packages/core` builds cleanly — no pending core changes that would break the import
3. Module 3.1 has NOT yet landed — the `sidecarManager.sync()` call inside the pre-fetch block is intentional and correct for the current state

### Step 1 — Edit the import on line 3

**Find (exact current text):**
```typescript
import { ConfigManager, CanvasClient, SecureStore, SidecarManager, registerContextTools } from '@canvas-mcp/core'
```

**Replace with:**
```typescript
import { ConfigManager, CanvasClient, SecureStore, SidecarManager, registerContextTools, fetchStudentEnrollments } from '@canvas-mcp/core'
```

The only change is appending `, fetchStudentEnrollments` before the closing `}`.

### Step 2 — Insert the pre-fetch block between lines 28 and 29

**Surrounding context (unambiguous location):**

Line 28 (unchanged, above insertion):
```typescript
  const { activeCourseId, courseCache } = config.program
```

Line 29 (unchanged, below insertion — becomes line 42 after insert):
```typescript
  let instructions: string
```

**Insert the following 13 lines between them:**

```typescript
  // 3.2 — Server-start roster pre-fetch
  // Fire-and-forget: populate SecureStore before any tool call to eliminate
  // the first-message blindspot (PII_ARCHITECTURE.md §5.2).
  if (config.privacy.blindingEnabled && activeCourseId !== null) {
    void (async () => {
      try {
        const enrollments = await fetchStudentEnrollments(client, activeCourseId)
        for (const enrollment of enrollments) {
          secureStore.tokenize(enrollment.user_id, enrollment.user.name)
        }
        const synced = sidecarManager.sync(secureStore)
        if (synced) {
          process.stderr.write(
            `[canvas-mcp] Pre-fetched ${enrollments.length} students into SecureStore.\n`
          )
        }
      } catch (err) {
        process.stderr.write(
          `[canvas-mcp] Roster pre-fetch failed (non-fatal): ${(err as Error).message}\n`
        )
      }
    })()
  }
```

### Complete resulting file (76 lines)

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ConfigManager, CanvasClient, SecureStore, SidecarManager, registerContextTools, fetchStudentEnrollments } from '@canvas-mcp/core'
import { registerReportingTools } from './tools/reporting.js'
import { registerContentTools } from './tools/content.js'
import { registerModuleTools } from './tools/modules.js'
import { registerResetTools } from './tools/reset.js'
import { registerFindTools } from './tools/find.js'

async function main() {
  const secureStore = new SecureStore()

  const configFlagIndex = process.argv.indexOf('--config')
  const configPath = configFlagIndex !== -1 ? process.argv[configFlagIndex + 1] : undefined
  const configManager = new ConfigManager(configPath)
  const config = configManager.read()

  const sidecarManager = new SidecarManager(config.privacy.sidecarPath, config.privacy.blindingEnabled)

  const cleanup = () => { sidecarManager.purge(); secureStore.destroy(); process.exit(0) }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)
  process.on('uncaughtException', () => { cleanup() })

  const client = new CanvasClient(config.canvas)

  const { activeCourseId, courseCache } = config.program

  // 3.2 — Server-start roster pre-fetch
  // Fire-and-forget: populate SecureStore before any tool call to eliminate
  // the first-message blindspot (PII_ARCHITECTURE.md §5.2).
  if (config.privacy.blindingEnabled && activeCourseId !== null) {
    void (async () => {
      try {
        const enrollments = await fetchStudentEnrollments(client, activeCourseId)
        for (const enrollment of enrollments) {
          secureStore.tokenize(enrollment.user_id, enrollment.user.name)
        }
        const synced = sidecarManager.sync(secureStore)
        if (synced) {
          process.stderr.write(
            `[canvas-mcp] Pre-fetched ${enrollments.length} students into SecureStore.\n`
          )
        }
      } catch (err) {
        process.stderr.write(
          `[canvas-mcp] Roster pre-fetch failed (non-fatal): ${(err as Error).message}\n`
        )
      }
    })()
  }

  let instructions: string
  if (activeCourseId !== null) {
    const cached = courseCache[String(activeCourseId)]
    const label = cached
      ? `${cached.name} (${cached.code})${cached.term ? `, ${cached.term}` : ''}`
      : `Canvas ID ${activeCourseId}`
    instructions = [
      `Active course: ${label}, Canvas ID: ${activeCourseId}.`,
      `Do NOT call get_active_course — the active course is already known from the information above.`,
      `Do NOT call set_active_course unless the user explicitly asks to switch to a different course.`,
      `All course-specific tools default to this course when no course_id argument is provided.`,
      `IMPORTANT — student privacy blinding: get_grades and get_submission_status return student names as [STUDENT_NNN] tokens instead of real names (FERPA compliance).`,
      `This is intentional. Do NOT call these tools again trying to obtain real names — the token-to-name mapping is handled automatically by the client after you respond.`,
      `When answering questions about students, reference them by their [STUDENT_NNN] token and include the relevant numeric data (scores, counts).`,
      `The user will see real names in your response — you do not need to resolve or explain the tokens.`,
    ].join(' ')
  } else {
    instructions = `No active course is set. Call set_active_course before using any course-specific tools.`
  }

  const server = new McpServer({ name: 'canvas-mcp', version: '0.1.0' }, { instructions })
  registerContextTools(server, client, configManager)
  registerReportingTools(server, client, configManager, secureStore, sidecarManager)
  registerContentTools(server, client, configManager)
  registerModuleTools(server, client, configManager)
  registerResetTools(server, client, configManager)
  registerFindTools(server, client, configManager)
  await server.connect(new StdioServerTransport())
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`)
  process.exit(1)
})
```

### Acceptance Test

**Build verification:**
```bash
npm run build
```
Must succeed with no TypeScript errors.

**Smoke test — blinding enabled, activeCourseId set:**
```bash
node packages/teacher/dist/index.js 2>&1 | head -5
```
Expected output within a few seconds of startup:
```
[canvas-mcp] Pre-fetched N students into SecureStore.
```

**Smoke test — blinding disabled or no active course:**
No `[canvas-mcp] Pre-fetched` line appears on stderr.

**Non-fatal failure test:**
Temporarily set an invalid `apiToken`. Server must still start; stderr must show:
```
[canvas-mcp] Roster pre-fetch failed (non-fatal): ...
```

**No startup delay:**
MCP server becomes ready on stdio immediately without waiting for the Canvas HTTP round-trip. The IIFE is fired and execution continues synchronously to `server.connect`.

### Rollback

```bash
git checkout packages/teacher/src/index.ts
npm run build
```

Restores the original 63-line file. No other files were modified.

---

## Risks and Notes

**Brief line-number off-by-one (resolved):** The brief states insertion is between "line 28 and line 30." In the actual file, `let instructions: string` is on line 29 (no blank line between L28 and L29). Insertion is between L28 and L29. The complete resulting file above is ground-truth.

**Module 3.1 interaction:** When Module 3.1 lands, remove the `sidecarManager.sync(secureStore)` call and its `if (synced) { ... }` block from inside the pre-fetch IIFE. The `fetchStudentEnrollments` loop and error handling remain unchanged.

**`activeCourseId` type narrowing:** Inside the guard `activeCourseId !== null`, TypeScript narrows to `number`. The `fetchStudentEnrollments(client, activeCourseId)` call is type-safe without a non-null assertion.

**Floating promise lint:** The `void` keyword before the IIFE satisfies `@typescript-eslint/no-floating-promises`. No lint suppression comment needed.

---

## Execution Packet Summary

| Packet | Depends on | Objective | Mode |
|---|---|---|---|
| EP-3.2.1 | None | Add roster pre-fetch to server startup | Tool-Integrated |

**1 of 1 packets are Tool-Integrated (100%).** Suitable for automated dispatch.

---

## Critical Files for Implementation

| File | Role |
|---|---|
| `packages/teacher/src/index.ts` | The only file modified; import on L3, block inserted between L28 and L29 |
| `packages/core/src/canvas/submissions.ts` | Defines `fetchStudentEnrollments` and `CanvasEnrollment`; confirms call signature |
| `packages/core/src/index.ts` | Confirms `fetchStudentEnrollments` is exported from `@canvas-mcp/core` (L23) |
