# Execution Packets: Phase 1 — Types and Config Schema

## Packet 1.1

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

## Packet 1.2

| Field | Value |
|-------|-------|
| **Packet ID** | 1.2 |
| **Depends On** | none |
| **Prerequisite State** | `packages/core/src/config/schema.ts` exports `CanvasTeacherConfig` and `DEFAULT_CONFIG`. Current `CanvasTeacherConfig` has sections: `canvas`, `program`, `privacy`, `smartSearch`, `attendance`. |
| **Objective** | Add `security.rosterKeyFingerprint` field to config schema with `null` default. |
| **Allowed Files** | `packages/core/src/config/schema.ts` |
| **Behavioral Intent** | **Positive:** `CanvasTeacherConfig` has `security: { rosterKeyFingerprint: string | null }`. `DEFAULT_CONFIG.security.rosterKeyFingerprint` is `null`. Existing config files without `security` key deep-merge correctly to include the new field. **Negative:** N/A (additive). **Edge:** Existing unit tests in `packages/core/tests/unit/config/schema.test.ts` and `packages/core/tests/unit/config/manager.test.ts` must still pass unchanged. |
| **Checklist** | 1. Add `security: { rosterKeyFingerprint: string | null }` to `CanvasTeacherConfig` interface. 2. Add `security: { rosterKeyFingerprint: null }` to `DEFAULT_CONFIG`. |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. Existing config tests pass: `cd packages/core && node --no-warnings ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/config/`. |
| **Commit Message** | `feat(core): add security.rosterKeyFingerprint to config schema` |
| **Stop / Escalate If** | Existing config tests fail due to the schema shape change. |

## Packet 1.3

| Field | Value |
|-------|-------|
| **Packet ID** | 1.3 |
| **Depends On** | 1.1 |
| **Prerequisite State** | `packages/core/src/roster/types.ts` exists and exports `RosterStudent`, `RosterFile`, `RosterKeyProvider`. |
| **Objective** | Create roster barrel export and wire it into the core `index.ts`. |
| **Allowed Files** | `packages/core/src/roster/index.ts` (new), `packages/core/src/index.ts` |
| **Behavioral Intent** | **Positive:** `import { RosterStudent, RosterFile, RosterKeyProvider } from '@canvas-mcp/core'` resolves via the barrel. Barrel re-exports all types from `./types.js`. **Negative:** N/A. **Edge:** Barrel file will grow in later packets as classes/functions are added. Use `.js` extensions in import paths (ESM requirement). Follow existing pattern from `packages/core/src/attendance/index.ts`. |
| **Checklist** | 1. Create `packages/core/src/roster/index.ts` that re-exports all types from `./types.js`. 2. Add `export * from './roster/index.js'` to `packages/core/src/index.ts` (after the attendance export line). |
| **Commands** | `npx tsc -p packages/core/tsconfig.build.json --noEmit` |
| **Pass Condition** | TypeScript compiles. Types are importable from `@canvas-mcp/core`. |
| **Commit Message** | `feat(core): add roster barrel export and wire into core index` |
| **Stop / Escalate If** | ESM `.js` extension import resolution issues. |
