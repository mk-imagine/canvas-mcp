# Dual-Mode Scaffolding Plan: Templates vs. Freeform

## Objective
Generalize the MCP server by moving program-specific scaffolding logic out of the source code and into a user-definable template system. This allows the server to support any school or curriculum while providing a "Dual-Mode" interface for the AI: **Blueprint Mode** (consistent, template-driven) and **Manual Mode** (freeform, one-off).

---

## 1. Template Storage
Templates reside in the user's configuration directory to ensure they survive server updates and contain no secrets.

**Path:** `~/.config/mcp/canvas-mcp/templates/`

### Folder Structure
Each template is a self-contained directory:
```text
templates/
└── standard-week/           # Template Name (matches template_name argument)
    ├── manifest.json        # Blueprint: structure, logic, variable schema
    ├── overview.hbs         # Handlebars HTML for the overview page
    └── assignment.hbs       # Handlebars HTML for assignments
```

### Bundled Default Templates
The current hardcoded `lesson`, `solution`, and `clone` logic will be converted into default blueprints (JSON/HBS files) bundled in the server's source under `src/templates/defaults/`. On first run, the server copies these defaults to the user's config directory if they don't already exist. This means:
- Teachers can edit the defaults to suit their school without touching source code.
- Server updates ship new defaults but never overwrite user-customized files.
- The `lesson`, `solution`, and `clone` discriminants in `build_module` are deprecated and removed.

---

## 2. The Module Blueprint (`manifest.json`)

The manifest defines the sequence of items in a module, how to render them, and what variables the LLM must supply.

### Required Fields
| Field | Type | Description |
|---|---|---|
| `version` | `1` | Schema version. Required. Manifests with unsupported versions are rejected immediately. |
| `name` | `string` | Human-readable template name. |
| `description` | `string` | Shown by `list_items(type='templates')`. |
| `structure` | `array` | Ordered list of renderable items. |

### Optional Fields
| Field | Type | Description |
|---|---|---|
| `variables_schema` | `object` | Declares expected variables so the LLM can introspect the contract. See below. |

### `for_each` Semantics
A structure item may include `"for_each": "<key>"` where `<key>` must be a key in the `variables` object whose value is an array. The template engine renders one instance of that item per element. Each element is accessible as `{{item.*}}` within the block. If the array is empty, the block is silently skipped. Nesting `for_each` within another `for_each` is not supported in v1.

### Full Example

```json
{
  "version": 1,
  "name": "Standard Learning Week",
  "description": "A module with an overview, assignments, and a wrap-up quiz.",
  "variables_schema": {
    "week": { "type": "number", "required": true },
    "topic": { "type": "string", "required": true },
    "assignments": { "type": "array", "required": false }
  },
  "structure": [
    {
      "type": "SubHeader",
      "title": "OVERVIEW"
    },
    {
      "type": "Page",
      "title": "Week {{week}} | Overview",
      "body_file": "overview.hbs"
    },
    {
      "type": "SubHeader",
      "title": "ASSIGNMENTS"
    },
    {
      "for_each": "assignments",
      "type": "Assignment",
      "title": "Week {{week}} | {{item.title}}",
      "body_file": "assignment.hbs",
      "points": "{{item.points}}"
    },
    {
      "type": "SubHeader",
      "title": "WRAP-UP"
    },
    {
      "type": "Quiz",
      "title": "Week {{week}} | Exit Card",
      "quiz_type": "graded_survey",
      "time_limit": 5,
      "questions": [
        { "question_text": "What was the most important thing you learned this week?" },
        { "question_text": "What questions do you still have?" }
      ]
    }
  ]
}
```

---

## 3. Dual-Mode Tool Implementation

### A. `create_item` (Individual Items)

`template_name` and `body` are **mutually exclusive**:
- If `template_name` is provided: load `templates/<template_name>/<item_type>.hbs` and render with `template_data`. File names are lowercase, matching the `type` field (e.g., `page.hbs`, `assignment.hbs`, `quiz.hbs`).
- If `body` is provided: use the raw HTML string directly.
- If neither is provided: the item is created with an empty body (valid for many Canvas types).

### B. `build_module` (Entire Modules)

Schema uses a discriminated union on `mode`:

**`mode: 'blueprint'`**
- `template_name: string` — name of the template directory in the config folder.
- `variables: object` — key/value pairs matching the template's `variables_schema`.
- `dry_run?: boolean` (default `false`) — if `true`, renders all items and returns the resolved list (titles, bodies, types) without making any Canvas API calls.
- `course_id?: number`

**`mode: 'manual'`**
- `module_name: string` — name for the new Canvas module.
- `items: array` — ordered list of items to create (each with `type`, `title`, `body?`, `points?`, etc.).
- `course_id?: number`

---

## 4. Error Model

### Pre-flight Errors (before any Canvas API calls)
The following conditions result in an immediate `toolError` with no Canvas state changes:
- `manifest.json` is missing or contains invalid JSON.
- `manifest.json` has an unsupported `version` value.
- A `body_file` referenced in the manifest does not exist in the template directory.
- A `for_each` key does not exist in the supplied `variables`.

### Execution Errors (mid-module)
If a Canvas API call fails after some items have already been created, `build_module` returns a **partial result** (the same pattern as `executeRenderables`), listing:
- `created`: items successfully created, with their Canvas IDs.
- `failed`: the item that failed, with the error message.

The LLM can retry or report the partial result to the instructor.

---

## 5. Template Discovery

`list_items(type='templates')` returns all templates available in the user's config directory. Each entry includes `name`, `description`, and `variables_schema` (if present) parsed from `manifest.json`. This gives the LLM full introspection before calling `build_module`.

---

## 6. Migration Strategy

1. **Template Service:** Create `src/config/templates.ts` — handles directory scanning, manifest parsing, version validation, and Handlebars rendering.
2. **Bundle Defaults:** Convert current `lesson`, `solution`, and `clone` logic from `src/templates/index.ts` into JSON/HBS files under `src/templates/defaults/`. Seed into user config dir on first run.
3. **Update Tool Schemas:**
   - Update `build_module` to `z.discriminatedUnion('mode', ['blueprint', 'manual'])`. Remove `lesson`/`solution`/`clone` variants.
   - Update `create_item` with optional, mutually exclusive `template_name`/`template_data` fields.
   - Add `type: 'templates'` to `list_items`.
4. **Cleanup:** Remove hardcoded scaffolding logic from `src/templates/index.ts` once defaults are migrated.

---

## 7. Benefits
- **Zero-Code Customization:** Teachers edit HTML files in their config folder — no source changes needed.
- **Reduced Token Usage:** The AI sends only data (titles, links, variable values); the server generates all HTML.
- **School Agnostic:** The server is a pure Canvas engine; "personality" lives entirely in template files.
- **Safe by Default:** `dry_run=true` lets instructors preview a full module creation before any API calls.
