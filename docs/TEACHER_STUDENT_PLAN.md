# Planning: Dual-Mode Canvas MCP (Teacher & Student)

## Objective
To expand the Canvas MCP capabilities to support student-facing workflows while maintaining the high security and FERPA-compliant standards of the teacher-facing implementation.

---

## Architectural Approach: Path A (Shared Core)

The "Shared Core" approach involves extracting the heavy lifting (API communication, rate limiting, pagination, and shared types) into a central engine, while exposing distinct toolsets for each persona.

### 1. Core Extraction (`src/core`)
Move the following to a shared core to avoid logic drift:
- **`CanvasClient`**: All logic for `fetchWithRetry`, link-header pagination, and auth headers.
- **Shared Types**: Basic interfaces for `Course`, `Assignment`, `Submission`, etc.
- **Config Manager**: Logic for reading `config.json` and managing API tokens.

### 2. Persona-Specific Toolsets
- **Teacher Tools (`src/tools/teacher`)**:
    - Focus: Content scaffolding, batch reporting, PII Blinding (`SecureStore`).
    - Requirement: High-privilege API token.
- **Student Tools (`src/tools/student`)**:
    - Focus: Assignment details, rubric parsing, submission status, grades.
    - Requirement: Student-level API token.
    - Note: No PII blinding needed (students see their own data).

### 3. Distinct Entry Points
Instead of a runtime switch, use separate entry points to ensure the LLM never sees irrelevant tools:
- `npm run start:teacher` -> Loads only teacher tools.
- `npm run start:student` -> Loads only student tools.

---

## Mono-repo vs. Separate Repositories

### Option 1: Monorepo (Shared Source)
**Structure:**
```text
/src
  /core         (Client, Auth, Base Types)
  /teacher      (PII Blinding, Scaffolding, Reports)
  /student      (Submission helpers, Grade tracking)
  index-teacher.ts
  index-student.ts
```
- **Pros:** Bug fixes in the `CanvasClient` benefit both modes instantly. Consistent developer experience.
- **Cons:** Accidental cross-contamination of logic. If a teacher tool is accidentally imported into the student entry point, it could be exposed.

### Option 2: Separate Repositories (Shared Package)
**Structure:**
- `canvas-client-core`: A private or public NPM package containing the API client.
- `canvas-mcp`: Consumes the core; implements teacher tools.
- `canvas-student-mcp`: Consumes the core; implements student tools.
- **Pros:** Maximum security isolation. Clear boundaries. Different release cycles (e.g., a teacher-mode bug doesn't require a student-mode update).
- **Cons:** Overhead of managing multiple repositories and publishing/linking the shared package during development.

---

## Security Considerations

| Feature | Teacher Mode | Student Mode |
| :--- | :--- | :--- |
| **PII Blinding** | **Required** (FERPA compliance) | **Disabled** (Self-view only) |
| **Token Privilege** | High (Admin/Teacher) | Low (Student) |
| **Mutation Risk** | High (Can delete/reset) | Low (Can only submit) |
| **Secure Heap** | Recommended | Optional |

---

## Next Steps for Decision
1. **Determine the "Student" Scope**: Is the student MCP meant to be as feature-rich as the teacher one (e.g., parsing assignment files, managing study schedules)?
2. **Evaluate Maintenance Bandwidth**: Can you maintain two separate CI/CD pipelines and repos, or is a single-repo "Shared Core" easier to manage?
3. **Draft Student-Specific Tools**: List 5-10 key tools a student needs that a teacher does not.
