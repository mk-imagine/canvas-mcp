# GEMINI.md - Canvas Teacher MCP Server

## Project Overview
`canvas-teacher-mcp` is a teacher-facing **Model Context Protocol (MCP)** server that wraps the Canvas LMS REST API. It is designed to empower instructors using AI assistants (like Claude or Gemini) to manage courses, create content, and generate reports while maintaining FERPA compliance through automated PII (Personally Identifiable Information) blinding.

### Key Technologies
- **Runtime:** Node.js (>=20.0.0)
- **Language:** TypeScript (Strict Mode)
- **MCP Framework:** `@modelcontextprotocol/sdk`
- **Testing:** Vitest (Unit & Integration)
- **Mocking:** `msw` (Mock Service Worker) for API simulation in unit tests
- **Templates:** Handlebars for HTML description templates
- **Schema/Validation:** Zod
- **Security:** `posix-node` for memory locking (`mlock`) to protect PII blinding keys in RAM

### Architecture
The project follows a modular architecture:
- **`src/index.ts`**: Entry point; initializes the MCP server, secure store, and registers tool groups.
- **`src/canvas/`**: Core Canvas API client and service-specific logic (assignments, courses, modules, search, etc.). Includes `search.ts` for the Canvas Smart Search API. Handles pagination, rate limiting, and retries.
- **`src/tools/`**: MCP tool definitions, grouped by functional area:
    - `context`: Course switching and active course management.
    - `reporting`: Student grade/submission reports (with PII blinding).
    - `content`: Low-level CRUD operations for assignments, quizzes, pages, etc.
    - `modules`: High-level module scaffolding and cloning.
    - `reset`: Destructive course reset operations with safety gates.
    - `find`: Smart find/mutate tools (`find_item`, `update_item`, `delete_item`) and Canvas Smart Search (`search_course`, `set_smart_search_threshold`).
- **`src/security/`**: `SecureStore` handles in-memory tokenization of student identities to ensure no PII leaves the local environment.
- **`src/config/`**: Manages the local configuration file located at `~/.canvas-teacher-mcp/config.json`.

---

## Building and Running

### Key Commands
- **Install Dependencies:** `npm install`
- **Build Project:** `npm run build` (Compiles TS to `dist/`)
- **Start Server:** `npm start` (Runs `dist/index.js`)
- **Unit Tests:** `npm test` (Uses `msw` for mocking)
- **Integration Tests:** `npm run test:integration` (Requires `.env.test` with real Canvas credentials)
- **Seed Test Data:** `npm run seed` (Used for integration test setup)

### Configuration
The server requires a configuration file at `~/.canvas-teacher-mcp/config.json`.
```json
{
  "canvas": {
    "instanceUrl": "https://yourschool.instructure.com",
    "apiToken": "YOUR_API_TOKEN"
  },
  "program": {
    "courseCodes": ["CS101", "CS102"]
  },
  "smartSearch": {
    "distanceThreshold": 0.5
  }
}
```

The `smartSearch.distanceThreshold` field (default: `0.5`) controls the default minimum distance score for `search_course` results — lower scores indicate closer semantic matches, and results above the threshold are filtered out. This field is managed at runtime by the `set_smart_search_threshold` tool.

---

## Development Conventions

### Coding Style
- **Strict TypeScript:** Always use explicit types; avoid `any`.
- **Modular Tools:** Register new tools in their respective `src/tools/` file and export a registration function.
- **Canvas Client:** Use the shared `CanvasClient` in `src/canvas/client.ts` for all API calls to benefit from automatic pagination and rate-limit handling.

### Testing Practices
- **Unit Tests:** Mandatory for new features. Mock all external API calls using `msw` in `tests/unit/`.
- **Integration Tests:** Use for validating complex Canvas API interactions. Run against a dedicated sandbox course.
- **PII Safety:** When adding new reporting tools, ensure student data passes through `SecureStore.blind()` before being returned to the AI.

### Contribution Guidelines
- Do not commit `.env.test` or any files containing real API tokens.
- Update `PLANNING.md` when introducing significant architectural changes or new tool categories.
- Ensure `npm run build` passes before submitting changes.

---

## Key Features by Phase

- **Phase 7 — Content retrieval (9 tools):** Read-only access to existing course content — `get_page`, `list_assignments`, `get_assignment`, `list_quizzes`, `get_quiz`, `list_discussions`, `list_announcements`, `list_rubrics`, `get_syllabus`.
- **Phase 8 — Smart find/mutate:** Name-based lookup with a single call to find, update, or delete any of 7 content types — `find_item`, `update_item`, `delete_item`. `get_module_summary` extended with an optional `module_name` filter param.
- **Phase 9 — Canvas Smart Search:** AI-powered semantic search across course content — `search_course` (queries `GET /api/v1/courses/:id/smartsearch`, filters by configurable distance threshold, supports content-type filter, result limit, and body inclusion), `set_smart_search_threshold` (persists threshold to config). Beta feature; availability depends on the Canvas instance.
