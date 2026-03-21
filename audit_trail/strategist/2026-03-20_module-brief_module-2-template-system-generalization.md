# Module Brief: Module 2 — Template System Generalization

**Brief type:** Module Brief
**Prepared by:** SoftwareScopeStrategist
**Date:** 2026-03-20
**Module:** 2 of canvas-mcp Roadmap
**Specification:** `docs/TEMPLATE_SYSTEM_ROADMAP.md`
**Status:** Ready for Tactician

---

## Preamble: Codebase Verification Findings

All seven files specified in the Project Brief were read. The following observations update or confirm the brief's risk notes:

**Confirmed accurate:**
- `handlebars` is a dependency of `packages/core` (version `^4.7.8`). No new package install needed.
- `packages/core/src/templates/index.ts` contains: `renderTemplate`, `validateItems`, `validateItemFields`, `renderLaterItem`, `TemplateItemInput`, `QuizQuestionInput`, `RenderableItem`, and the `ACCEPTED_TYPES` map. All currently exported via `export * from './templates/index.js'` in `packages/core/src/index.ts`.
- `list_items` and `create_item` both live in `packages/teacher/src/tools/find.ts` — not in `content.ts`. The `find.ts` file contains `registerFindTools` which registers `find_item`, `update_item`, `delete_item`, `create_item`, `list_items`, and `search_course`.
- `content.ts` contains only `registerContentTools`, which registers `delete_file`, `upload_file`, and `create_rubric`. It exports `completionRequirementSchema` (used by `find.ts`).
- `ConfigManager` does not expose a `configDir` or `templatesDir` getter. `TemplateService` must receive its directory path at construction time, derived at entry point from the known config path string.
- The current `build_module` tool in `modules.ts` has three `template` discriminants: `lesson`, `solution`, and `clone`. The `solution` and `clone` paths are substantial (~50–80 lines of handler logic each).

**New findings:**
- `TemplateItemInput`, `QuizQuestionInput`, `RenderableItem`, and `validateItems` are currently exported from `@canvas-mcp/core` via `export * from './templates/index.js'`. Post-migration, `index.ts` re-exports from `service.ts` instead. The public surface must preserve `RenderableItem` and `QuizQuestionInput`; `TemplateItemInput` and `validateItems` are removed.
- `modules.ts` imports `renderTemplate` directly from `@canvas-mcp/core`. This import is removed when the `lesson` path is replaced by `blueprint` mode.
- The `listItemsSchema` in `find.ts` uses a hardcoded `z.enum([...])` with 9 values. Adding `'templates'` requires updating that enum. The `templates` case must short-circuit before the `resolveCourseId` call since templates are local, not course-scoped.
- `createItemSchema` in `find.ts` uses `body: z.string().optional()` for pages. Adding `template_name` and `template_data` is additive and non-breaking.

---

## Risk Resolutions

### Risk 1: `solution` and `clone` modes

**Resolution: Carry forward as additional `mode` values.**

The `solution` and `clone` handler code is substantial and fully functional. Extracting into separate tools is out of scope. The new schema replaces:
```
template: z.enum(['lesson', 'solution', 'clone'])
```
with:
```
mode: z.enum(['blueprint', 'manual', 'solution', 'clone'])
```

`blueprint` replaces `lesson`. `manual` is the new freeform mode. `solution` and `clone` carry forward with their existing field sets unchanged. This is a breaking rename of `template` → `mode` and `lesson` → `blueprint`, but is contained and well-defined.

### Risk 2: Seeding strategy

**Resolution:** Check `!existsSync(templatesDir) || readdirSync(templatesDir).length === 0`. Seeding runs once at `TemplateService` construction. Copy all files from `src/templates/defaults/` (bundled with the package) to the user config templates dir. After seeding, `TemplateService` loads from the config dir (never from defaults).

### Risk 3: `TemplateService` location

**Resolution: `packages/core/src/templates/service.ts`.** Keeps all template concern co-located.

### Risk 4: `list_items` location

**Confirmed:** `packages/teacher/src/tools/find.ts`, inside `registerFindTools`.

### Risk 5: Handlebars compilation caching

**Resolution:** `TemplateService` constructor scans the templates dir, reads all `.hbs` files, and calls `Handlebars.compile()` on each, storing compiled template functions in a `Map<templateName, Map<bodyFile, TemplateDelegate>>`. No disk reads on each `render()` call.

### Risk 6: `dry_run` for `blueprint` mode

**Resolution confirmed:** `TemplateService.render(templateName, variables)` returns `RenderableItem[]`. The existing `dry_run` guard in the `build_module` handler remains structurally identical to the current `lesson` branch.

---

## Ordering Dependencies

```
2.1 (TemplateService + defaults)
  └── 2.2 (seeding + server-startup wiring)
        ├── 2.3 (update build_module: blueprint + manual modes)
        ├── 2.4 (update create_item: template_name/template_data)
        └── 2.5 (update list_items: type='templates')
              └── 2.6 (remove hardcoded renderTemplate; update core exports)
```

Tasks 2.3, 2.4, and 2.5 are parallel once 2.2 is complete. Task 2.6 is last because `modules.ts` depends on `renderTemplate` until 2.3 replaces it.

---

## Task Breakdown

### Task 2.1 — Create `TemplateService` and Default Template Files

**Files changed:**
- New: `packages/core/src/templates/service.ts`
- New: `packages/core/src/templates/defaults/later-standard/manifest.json`
- New: `packages/core/src/templates/defaults/later-standard/overview.hbs`
- New: `packages/core/src/templates/defaults/later-standard/assignment.hbs`
- New: `packages/core/src/templates/defaults/later-review/manifest.json`
- New: `packages/core/src/templates/defaults/later-review/overview.hbs`
- New: `packages/core/src/templates/defaults/later-review/assignment.hbs`
- New: `packages/core/src/templates/defaults/earlier-standard/manifest.json`
- New: `packages/core/src/templates/defaults/earlier-standard/overview.hbs`
- New: `packages/core/src/templates/defaults/earlier-standard/assignment.hbs`
- New: `packages/core/src/templates/defaults/earlier-review/manifest.json`
- New: `packages/core/src/templates/defaults/earlier-review/overview.hbs`
- New: `packages/core/src/templates/defaults/earlier-review/assignment.hbs`

**Key interfaces:**

```typescript
export interface ManifestStructureItem {
  type: 'SubHeader' | 'Page' | 'Assignment' | 'Quiz' | 'ExternalUrl'
  title?: string          // may contain {{week}}, {{item.field}}
  body_file?: string      // relative path within template dir (e.g. "overview.hbs")
  for_each?: string       // key in variables whose value is an array
  points?: string | number
  quiz_type?: string
  time_limit?: number
  allowed_attempts?: number
  questions?: Array<{ question_text: string }>
}

export interface TemplateManifest {
  version: 1
  name: string
  description: string
  variables_schema?: Record<string, { type: string; required?: boolean }>
  structure: ManifestStructureItem[]
}

export interface TemplateDescriptor {
  template_name: string
  name: string
  description: string
  variables_schema?: Record<string, { type: string; required?: boolean }>
}

export class TemplateService {
  constructor(templatesDir: string) { ... }
  list(): TemplateDescriptor[] { ... }
  render(templateName: string, variables: Record<string, unknown>): RenderableItem[] { ... }
  renderFile(templateName: string, bodyFile: string, variables: Record<string, unknown>): string { ... }
}
```

**Implementation constraints:**
- Constructor: scan `templatesDir` for subdirectories, parse each `manifest.json`, skip with warning if `version !== 1` or JSON invalid. Compile all referenced `.hbs` files via `Handlebars.compile()`. Cache.
- `render()`: for each structure item: (a) if `for_each` present, look up `variables[item.for_each]` — must be array, throw if not; render one `RenderableItem` per element; (b) if `body_file` present, render the cached compiled template; (c) expand `title` using `Handlebars.compile(item.title)(context)`.
- `renderFile()`: look up a specific cached compiled template by `templateName` + `bodyFile`, render with variables, return string.
- Preflight errors (before any Canvas calls) throw with descriptive messages.
- The `exit_card_quiz` `RenderableItem` variant is not produced by `TemplateService` — default templates use an explicit `Quiz` type item.

**Default templates:** Convert the four existing hardcoded templates from `index.ts` into JSON manifests. Title patterns must use Handlebars expressions (e.g. `"Week {{week}} | Coding Assignment | {{item.title}} ({{item.hours}} Hours)"`).

**Acceptance criteria:**
- `TemplateService.list()` returns one entry per valid template directory.
- `render('later-standard', { week: 2, items: [...], due_date: '...', config: {...} })` returns `RenderableItem[]` matching the output of the current `renderTemplate('later-standard', ...)` for equivalent inputs.
- Invalid manifest or missing `body_file` throws a pre-flight error.
- `.hbs` files read from disk once at construction only.
- `for_each` with an empty array produces zero items for that block.

---

### Task 2.2 — Seeding and Server-Startup Wiring

**Files changed:**
- New: `packages/core/src/templates/seed.ts`
- Modified: `packages/teacher/src/index.ts`

**`seed.ts` exports:**
```typescript
export function seedDefaultTemplates(templatesDir: string): void
```

Logic: if `!existsSync(templatesDir) || readdirSync(templatesDir).length === 0`, copy the entire `defaults/` directory (resolved relative to `seed.ts`'s `import.meta.url`) into `templatesDir`. Uses `cpSync` with `recursive: true`. Never overwrites existing files.

**`index.ts` changes** — after constructing `ConfigManager`:
1. Derive `templatesDir`: `join(dirname(configPath ?? defaultConfigPath), 'templates')`
2. Call `seedDefaultTemplates(templatesDir)`
3. Construct `const templateService = new TemplateService(templatesDir)`
4. Pass `templateService` to `registerModuleTools` and `registerFindTools`

**Acceptance criteria:**
- On first start with empty templates dir, four default template directories are copied there.
- On subsequent starts, existing template files are not overwritten.
- `TemplateService` constructed once at startup and shared across all tool handlers.

---

### Task 2.3 — Update `build_module`: `blueprint` and `manual` Modes

**Files changed:**
- Modified: `packages/teacher/src/tools/modules.ts`

**Signature change:**
```typescript
export function registerModuleTools(
  server: McpServer,
  client: CanvasClient,
  configManager: ConfigManager,
  templateService: TemplateService
): void
```

**Schema changes:**
- Remove: `template: z.enum(['lesson', 'solution', 'clone'])`
- Add: `mode: z.enum(['blueprint', 'manual', 'solution', 'clone'])`
- Remove: `lesson_template` field, old `items` array (lesson-specific)
- Add: `template_name: z.string().optional()` — for `blueprint`
- Add: `variables: z.record(z.unknown()).optional()` — for `blueprint`
- Add: `items: z.array(manualItemSchema).optional()` — for `manual`
- Add: `module_name: z.string().optional()` — for `manual`
- Retain: all `solution`/`clone`-specific fields unchanged
- Retain: shared fields (`week`, `due_date`, `title`, `assignment_group_id`, `publish`, `dry_run`, `course_id`)

**Handler logic:**
- `blueprint`: call `templateService.render(template_name, variables)` → `RenderableItem[]` → dry_run guard → `executeRenderables`
- `manual`: use `args.items` directly as `RenderableItem[]` → dry_run guard → `executeRenderables`
- `solution`, `clone`: verbatim from existing branches, substituting `args.mode` for `args.template`

Remove imports of `renderTemplate` and `TemplateItemInput` from `@canvas-mcp/core`. Add import of `TemplateService`.

**Acceptance criteria:**
- `mode='blueprint'` with valid template produces same Canvas objects as old `template='lesson'`.
- `mode='manual'` creates module from freeform items array.
- `mode='solution'` and `mode='clone'` behave identically to old equivalents.
- `dry_run=true` returns preview without Canvas API calls.
- Unknown `template_name` returns `toolError`.
- Missing `for_each` key in variables returns `toolError`.

---

### Task 2.4 — Update `create_item`: `template_name` / `template_data` Fields

**Files changed:**
- Modified: `packages/teacher/src/tools/find.ts`

`registerFindTools` gains `templateService: TemplateService` parameter.

`createItemSchema` gains two new optional fields:
```typescript
template_name: z.string().optional()
  .describe('For type="page": template to render. Mutually exclusive with body.'),
template_data: z.record(z.unknown()).optional()
  .describe('For type="page" with template_name: variables for the template renderer.'),
```

In the `type='page'` handler:
- If `args.template_name` and `args.body` both provided: return `toolError` (mutually exclusive).
- If `args.template_name` provided without `body`: call `templateService.renderFile(template_name, '<item_type>.hbs', template_data ?? {})` to produce `body`.
- If neither provided: create page with empty body (existing behavior).

**Acceptance criteria:**
- `create_item(type='page', template_name='later-standard', template_data={week:2})` renders `overview.hbs` and creates page.
- Both `template_name` and `body` provided → `toolError`.
- Unknown template name or missing `.hbs` file → `toolError`.
- All other `create_item` behavior unchanged.

---

### Task 2.5 — Update `list_items`: `type='templates'`

**Files changed:**
- Modified: `packages/teacher/src/tools/find.ts`

Extend `listItemsSchema` type enum to include `'templates'`:
```typescript
type: z.enum([
  'modules', 'assignments', 'quizzes', 'pages', 'discussions',
  'announcements', 'rubrics', 'assignment_groups', 'module_items', 'templates'
])
```

Add `templates` branch **before** `resolveCourseId` call in the handler:
```typescript
if (args.type === 'templates') {
  return toJson(templateService.list())
}
```

Update tool description string to mention `templates` as the 10th supported type.

**Acceptance criteria:**
- `list_items(type='templates')` returns JSON array of `TemplateDescriptor` objects.
- Works without an active course set.
- All other `list_items` behavior unchanged.
- `templates` case appears before any `resolveCourseId` call.

---

### Task 2.6 — Remove Hardcoded Logic from `index.ts`, Update Core Exports

**Files changed:**
- Modified: `packages/core/src/templates/index.ts`
- Modified: `packages/core/src/index.ts` (likely no change needed; `export *` continues to work)

`packages/core/src/templates/index.ts` is gutted — remove:
- `ACCEPTED_TYPES`, `validateItemFields`, `validateItems`, `renderLaterItem`, `renderTemplate`, `TemplateItemInput`

Replace with re-exports from `service.ts`:
```typescript
export type { RenderableItem, QuizQuestionInput } from './service.js'
export { TemplateService } from './service.js'
export type { TemplateManifest, TemplateDescriptor, ManifestStructureItem } from './service.js'
```

**Acceptance criteria:**
- `@canvas-mcp/core` still exports `RenderableItem`, `QuizQuestionInput`, `TemplateService`, `TemplateDescriptor`.
- `renderTemplate`, `TemplateItemInput`, `validateItems` are no longer exported — TypeScript compile error if any consumer imports them.
- `npm run build` passes without errors after all tasks complete.

---

## Unit Tests

**New:** `packages/core/tests/unit/templates/service.test.ts`
- `TemplateService.list()` with mock manifests in temp dir
- `TemplateService.render()` for `later-standard` with sample variables
- Preflight error for missing `body_file`
- `for_each` expansion with 0, 1, and 3 items
- Preflight error for `for_each` key not in variables

**Modified:** `packages/teacher/tests/unit/tools/modules.test.ts`
- Replace `template='lesson'` tests with `mode='blueprint'` equivalents
- Add `mode='manual'` test
- Retain `mode='solution'` and `mode='clone'` tests (renamed from `template=`)
- Pass mock `TemplateService` to `registerModuleTools` in `makeTestClient`

**Modified:** `packages/teacher/tests/unit/tools/find.test.ts`
- Add `list_items(type='templates')` test with mock `TemplateService`
- Add `create_item(type='page', template_name=..., template_data=...)` test
- Pass mock `TemplateService` to `registerFindTools` in test client

---

## Ready for Tactician Checklist

- [x] All unknown file locations verified (`list_items` and `create_item` confirmed in `find.ts`)
- [x] `handlebars` confirmed as existing dependency — no npm install required
- [x] `solution` and `clone` mode handling decided (carry forward as `mode` values)
- [x] `TemplateService` location decided (`packages/core/src/templates/service.ts`)
- [x] Seeding strategy specified (`seed.ts`, `cpSync`, one-time check)
- [x] `ConfigManager` config path exposure confirmed — `templatesDir` derived at entry point from known config path string
- [x] Handlebars compilation caching strategy specified (constructor-time `Map<templateName, Map<bodyFile, TemplateDelegate>>`)
- [x] `dry_run` guard compatibility confirmed
- [x] `exit_card_quiz` special case noted — default templates use explicit `Quiz` type
- [x] Breaking change scoped: `template` → `mode` rename, `lesson` → `blueprint` rename
- [x] `list_items(type='templates')` must short-circuit before `resolveCourseId`
- [x] Public API surface post-migration specified
- [x] Task ordering confirmed (2.1 → 2.2 → [2.3, 2.4, 2.5 parallel] → 2.6)
- [x] `registerModuleTools` and `registerFindTools` signature changes identified
- [x] `TemplateService.renderFile()` method identified for `create_item` page template rendering
- [x] New `manualItemSchema` needed in `modules.ts` for `mode='manual'` items array
- [x] Unit test strategy outlined for all affected test files

---

## Critical Files for Implementation

| File | Role |
|---|---|
| `packages/core/src/templates/index.ts` | Core logic to replace; currently exports all hardcoded template types |
| `packages/teacher/src/tools/modules.ts` | Primary tool to update; `build_module` schema and `lesson` handler replaced by `blueprint`/`manual` |
| `packages/teacher/src/tools/find.ts` | Contains both `list_items` and `create_item`; both require updates for template awareness |
| `packages/core/src/index.ts` | Public API surface; must export `TemplateService` and preserve `RenderableItem`/`QuizQuestionInput` |
| `packages/teacher/src/index.ts` | Server entry point; wires `templatesDir` derivation, seeding, and `TemplateService` construction |
| `docs/TEMPLATE_SYSTEM_ROADMAP.md` | Authoritative spec for manifest format, seeding behavior, and `blueprint`/`manual` semantics |
