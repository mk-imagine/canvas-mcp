# Tool Call Optimization Plan

## Context

Every "find then act" workflow currently forces the LLM through a **list → scan → act** pattern because Canvas API has no server-side search by name, and all existing tools require a numeric ID or exact slug. Common examples:

- **"Update the Week 1 overview page"** → `list_pages()` → `get_page(slug)` → `update_page(slug, {})` = 3–4 calls
- **"What's in the Week 2 module?"** → `list_modules()` → `get_module_summary(module_id)` = 2 calls
- **"Remove the Week 1 Reading from the Week 1 module"** → `list_modules()` → `list_module_items(module_id)` → `remove_module_item(module_id, item_id)` = 3 calls
- **"Change the due date on Midterm Exam"** → `list_assignments()` → `update_assignment(id, {})` = 2 calls

The fix is a symmetric trio of name-based tools (`find_item`, `update_item`, `delete_item`) plus `module_name` support on `get_module_summary`. These push the list+filter logic inside the tool so the LLM issues one call instead of two or three.

---

## Goals

| Workflow | Before | After |
|---|---|---|
| Read page by title | 3–4 calls | `find_item(page)` = **1 call** |
| Update page body (read-then-write) | 3–4 calls | `find_item` → `update_item` = **2 calls** |
| Update page metadata only | 3 calls | `update_item(page)` = **1 call** |
| Update assignment by name | 2 calls | `update_item(assignment)` = **1 call** |
| Module contents by name | 2 calls | `get_module_summary(module_name=...)` = **1 call** |
| Remove module item by name | 3 calls | `delete_item(module_item)` = **1 call** |
| Delete page/assignment/quiz by name | 2–3 calls | `delete_item(...)` = **1 call** |

---

## New Tools (3)

### `find_item`

Searches for a course item by name and returns the full object — including page body, assignment description, and quiz questions. The LLM gets everything it needs to reason about the item in one call.

**Behavior on multiple matches:** return first match (case-insensitive partial), add `warning` field listing how many others were found.
**Behavior on no match:** return `toolError`.

**Canvas search strategy per type:**

| Type | Strategy |
|---|---|
| `page` | Canvas native `?search_term=` (API-side filtering, efficient) |
| `assignment` | Canvas native `?search_term=` (API-side filtering, efficient) |
| `quiz` | `listQuizzes()` + client-side filter (no Canvas search API) |
| `module` | `listModules()` + client-side filter |
| `module_item` | find module via `module_name`, then `listModuleItems()` + filter |
| `discussion` | `listDiscussionTopics()` + client-side filter |
| `announcement` | `listAnnouncements()` + client-side filter |

**Return shapes (all include `matched_title` and optional `warning`):**
- `page` → `{ type, page_url, page_id, title, body, published, front_page, matched_title, warning? }`
- `assignment` → `{ type, id, name, points_possible, due_at, description, submission_types, published, matched_title, warning? }`
- `quiz` → `{ type, id, title, quiz_type, points_possible, due_at, published, questions: [...], matched_title, warning? }` (includes questions, same as `get_quiz`)
- `module` → `{ type, id, name, position, published, items_count, matched_title, warning? }`
- `module_item` → `{ type, id, module_id, title, item_type, content_id, page_url, external_url, matched_title, warning? }`
- `discussion` → `{ type, id, title, message, published, matched_title, warning? }`
- `announcement` → `{ type, id, title, message, matched_title, warning? }`

---

### `update_item`

Finds an item by name then mutates it in a single tool call. Supports page, assignment, quiz, module, and module_item types.

(Discussions/announcements excluded — no `update_discussion` tool exists yet; this is future scope.)

Returns the updated object in the same shape as the corresponding `get_*` / `update_*` tools.

---

### `delete_item`

Finds an item by name then deletes or removes it in a single tool call.

**Semantic note on `module_item`:** deleting a `module_item` *detaches* it from the module but does not delete the underlying content (page, assignment, etc.). All other types are permanent deletions. Clearly documented in the tool description.

---

## Modified Tool (1)

### `get_module_summary` — add `module_name` support

Add `module_name` as an alternative to `module_id`. Exactly one must be provided; runtime validation returns `toolError` if both are absent.

**Schema change:**
```typescript
// Before
module_id: z.number().int().positive().describe('Canvas module ID')

// After
module_id: z.number().int().positive().optional()
  .describe('Canvas module ID. Provide this or module_name.'),
module_name: z.string().optional()
  .describe('Module name to search for (case-insensitive partial match). Provide this or module_id.'),
```

**Internal logic addition:** if only `module_name` given → `listModules()` → filter by name → take first match → warn if multiple → use resulting `id` as `module_id`.

---

## Canvas API Layer Changes

### `src/canvas/pages.ts` — add `searchPages`
```typescript
export async function searchPages(
  client: CanvasClient,
  courseId: number,
  searchTerm: string
): Promise<CanvasPage[]> {
  return client.get<CanvasPage>(
    `/api/v1/courses/${courseId}/pages`,
    { search_term: searchTerm, per_page: '100' }
  )
}
```

### `src/canvas/assignments.ts` — add `searchAssignments`
```typescript
export async function searchAssignments(
  client: CanvasClient,
  courseId: number,
  searchTerm: string
): Promise<CanvasAssignmentFull[]> {
  return client.get<CanvasAssignmentFull>(
    `/api/v1/courses/${courseId}/assignments`,
    { search_term: searchTerm, per_page: '100' }
  )
}
```

---

## Schema Design: Discriminated Unions

All three new tools use `z.discriminatedUnion('type', [...])`. This generates a precise JSON schema with one variant per type, so the LLM knows exactly which fields are valid for which type.

Example for `update_item`:
```typescript
z.discriminatedUnion('type', [
  z.object({
    type: z.literal('page'),
    search: z.string().describe('Case-insensitive partial title match'),
    title: z.string().optional(),
    body: z.string().optional(),
    published: z.boolean().optional(),
    course_id: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('assignment'),
    search: z.string().describe('Case-insensitive partial name match'),
    name: z.string().optional(),
    points_possible: z.number().positive().optional(),
    due_at: z.string().nullable().optional(),
    submission_types: z.array(z.string()).optional(),
    assignment_group_id: z.number().int().positive().optional(),
    description: z.string().optional(),
    published: z.boolean().optional(),
    course_id: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('quiz'),
    search: z.string(),
    title: z.string().optional(),
    quiz_type: z.enum(['practice_quiz', 'assignment', 'graded_survey', 'survey']).optional(),
    points_possible: z.number().positive().optional(),
    due_at: z.string().nullable().optional(),
    time_limit: z.number().int().positive().nullable().optional(),
    allowed_attempts: z.number().int().optional(),
    published: z.boolean().optional(),
    course_id: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('module'),
    search: z.string(),
    name: z.string().optional(),
    published: z.boolean().optional(),
    unlock_at: z.string().nullable().optional(),
    prerequisite_module_ids: z.array(z.number().int().positive()).optional(),
    require_sequential_progress: z.boolean().optional(),
    course_id: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('module_item'),
    search: z.string(),
    module_name: z.string().describe('Name of the module containing the item'),
    title: z.string().optional(),
    position: z.number().int().positive().optional(),
    indent: z.number().int().nonnegative().optional(),
    completion_requirement: completionRequirementSchema,
    course_id: z.number().int().positive().optional(),
  }),
])
```

`find_item` and `delete_item` use the same discriminated pattern but with only `search` (+ `module_name` for `module_item`) and `course_id` in each variant.

---

## Internal Helper: `resolveByName`

Private to `find.ts`. Handles the "list + find first match + warn on multiple" pattern for types that lack Canvas-native search:

```typescript
function resolveByName<T>(
  items: T[],
  search: string,
  getLabel: (item: T) => string
): { match: T; warning?: string } | null {
  const lower = search.toLowerCase()
  const matches = items.filter(item => getLabel(item).toLowerCase().includes(lower))
  if (matches.length === 0) return null
  const warning = matches.length > 1
    ? `${matches.length} items matched "${search}"; using first: "${getLabel(matches[0])}".`
    : undefined
  return { match: matches[0], warning }
}
```

---

## Files Changed / Created

| File | Change |
|---|---|
| `src/canvas/pages.ts` | Add `searchPages()` export |
| `src/canvas/assignments.ts` | Add `searchAssignments()` export |
| `src/tools/content.ts` | Export `completionRequirementSchema` (currently unexported) |
| `src/tools/find.ts` | **NEW** — `registerFindTools()` with `find_item`, `update_item`, `delete_item` |
| `src/tools/reporting.ts` | Extend `get_module_summary` inputSchema + logic for `module_name` |
| `src/index.ts` | Import `registerFindTools` and call it |
| `tests/unit/tools/find.test.ts` | **NEW** — MSW-based unit tests for all 3 new tools |
| `tests/integration/find.test.ts` | **NEW** — real Canvas API integration tests |

`content.ts` receives only the `completionRequirementSchema` export. New tools go in `find.ts` to avoid bloating the already-1,450-line file.

---

## Behavioral Constraints

- `delete_item(type="page")` must respect the front-page guard — same as existing `delete_page`
- `delete_item(type="assignment")` uses existing `deleteAssignment()` which pre-deletes associated rubrics — no extra logic needed
- `delete_item(type="module_item")` removes item from module only; underlying content survives
- `update_item(type="module_item")` requires `module_name` to locate the correct module

---

## Test Plan

### Unit tests (`tests/unit/tools/find.test.ts`)

Follow existing pattern: MSW handlers, `InMemoryTransport`, `registerFindTools()`, `parseResult()`.

**`find_item`:**
- returns page with body on single match (`type=page`)
- returns `warning` when multiple pages match
- returns `toolError` when no match found
- returns assignment with description (`type=assignment`)
- returns quiz with questions array (`type=quiz`)
- returns module metadata (`type=module`)
- returns module_item with `module_id` (`type=module_item`)
- returns discussion (`type=discussion`)
- returns announcement (`type=announcement`)

**`update_item`:**
- updates page fields, returns updated object
- updates assignment fields, returns updated object
- updates quiz fields, returns updated object
- updates module fields, returns updated object
- updates module_item position, returns updated item
- returns `toolError` when item not found

**`delete_item`:**
- deletes page → `{ deleted: true, matched_title }`
- deletes assignment → `{ deleted: true, matched_title }`
- deletes quiz → `{ deleted: true, matched_title }`
- deletes module → `{ deleted: true, matched_title }`
- removes module_item → `{ removed: true, matched_title }` (distinct from `deleted`)
- deletes discussion → `{ deleted: true, matched_title }`
- deletes announcement → `{ deleted: true, matched_title }`

**`get_module_summary` additions:**
- returns module summary when only `module_name` provided
- returns `toolError` when neither `module_id` nor `module_name` provided
- returns `warning` in result when multiple modules match

### Integration tests (`tests/integration/find.test.ts`)

- Create page → `find_item(type=page, search=...)` returns it with body
- Create assignment → `update_item(type=assignment, search=..., due_at=...)` → verify change
- Create page → `delete_item(type=page, search=...)` → verify gone
- `get_module_summary(module_name=...)` using existing test module → returns items
- Create page + add to module → `delete_item(type=module_item, search=..., module_name=...)` → verify item gone, page still exists

---

## Implementation Notes

### Discriminated union compatibility
`z.discriminatedUnion` generates `oneOf` in JSON Schema via `zod-to-json-schema`, which the MCP SDK uses internally. Supported in `@modelcontextprotocol/sdk ^1.27`. Fallback if needed: flat schema with runtime validation.

### Shared schema: `completionRequirementSchema`
Currently non-exported in `src/tools/content.ts`. Export it; import in `find.ts` for the `module_item` variant of `update_item`.

---

## Verification

```bash
npm test                   # unit tests (target: existing 202 + ~35 new)
npm run test:integration   # integration tests (needs .env.test)
npm run build              # TypeScript compile check
```

Manual smoke test:
1. `find_item(type="page", search="overview")` — returns first matching page with body
2. `update_item(type="assignment", search="Week 1", published=true)` — publishes in one call
3. `get_module_summary(module_name="Week 1")` — returns items without prior `list_modules`

---

## Out of Scope (future)

- `update_item` for `discussion`/`announcement` (no existing update_discussion tool; Canvas API supports it)
- `find_item` for files/rubrics (low-priority workflows)
- Tightening existing tool descriptions to reduce token overhead (separate pass)
- Read-modify-write helper (auto-fetch body before patching) — LLM chains `find_item` → `update_item`
