# Conversation Reset Map: attendance-integration-test-hardening (v0)

| Field | Value |
|-------|-------|
| **Module Brief Reference** | `attendance-integration-test-hardening` in `canvas-mcp`. Remediate 6 issues (1-5, 7) in attendance integration tests. DoD: dedicated seed assignment with env var, all tests use it, state isolation via WeakMap, grade restoration handles nulls, new name-map re-parse test, new min_duration test, PII-safe assertions, all integration tests pass. |
| **Packets Completed** | (none) |
| **Next Packet ID** | `1.1` and `1.3` (parallel) |
| **Current Phase** | Phase 1: Seed Infrastructure + Independent Fixes |

## Signatures & Interfaces

- `SeedContent { assignmentIds: [number, number, number]; exitCardId: number; moduleId: number }` at `scripts/seed-test-data.ts:199` -- will gain `attendanceAssignmentId: number`
- `registerAttendanceTools(server: McpServer, client: CanvasClient, configManager: ConfigManager, secureStore: SecureStore, sidecarManager: SidecarManager): void` at `packages/teacher/src/tools/attendance.ts:71`
- Module-scoped `let lastParseResult: ParseState | null = null` at `attendance.ts:31` -- will become `const parseStateByServer = new WeakMap<McpServer, ParseState>()`
- `writeSeedIds(content: SeedContent, studentIds: number[]): void` at `scripts/seed-test-data.ts:375` -- will add `CANVAS_TEST_ATTENDANCE_ASSIGNMENT_ID` to updates
- `makeConfigAndCsv(configDir, studentNames, options?: { hostName?, durations? })` at test file line 83
- `makeAttendanceClient(configPath, store?)` at test file line 116

## Key Invariants

- Integration tests run sequentially (`fileParallelism: false`)
- Seed data must be idempotent under re-seeding (`resetCourse()` deletes all assignments before re-creating)
- PII must never appear in test assertions or log output
- `makeConfigAndCsv` sets `defaultMinDuration: 0` in config
- Each test `McpServer` gets its own `InMemoryTransport` pair
- `ZoomNameMap` keys are always lowercase
- Blinded response includes `source` field per matched entry (`'map' | 'exact' | 'fuzzy'`)

## Dependencies & Locations

| File | Role |
|------|------|
| `scripts/seed-test-data.ts` | Seed script (Packets 1.1) |
| `packages/teacher/tests/integration/attendance.test.ts` | Test file (Packets 1.2, 1.4, 2.1, 2.2) |
| `packages/teacher/src/tools/attendance.ts` | Production code (Packet 1.3) |
| `.env.test` | Env vars (written by seed, read by tests) |
| `packages/core/src/attendance/zoom-name-map.ts` | `ZoomNameMap` class (context for 2.1) |
| `packages/core/src/attendance/name-matcher.ts` | `matchAttendance` function (context for 2.1) |

## Repo / Tooling Context

- Branch: `feat/roadmap-modules-1-2-3.2`
- Build: `npm run build` (core then teacher)
- Unit tests: `npm run test:unit`
- Integration tests: `npm run test:integration`
- Seed: `npm run seed`
- Single test file: `cd packages/teacher && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/integration/attendance.test.ts`

## Open Risks / Assumptions

1. `submission_types: ['none']` may not be accepted by Canvas API -- fallback: `['online_url']`
2. Alias name `"ZZQQ Nonexistent Person"` for name-map test must not fuzzy-match any real student (very unlikely)
3. Grade restoration skip for null grades assumes seed re-creates assignments fresh (confirmed: `resetCourse()` deletes all assignments)
