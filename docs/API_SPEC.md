# Canvas API Specification

## Official Documentation
The `canvas-teacher-mcp` server utilizes the official Canvas LMS REST API.
- **Link:** [Official Canvas API Documentation](https://canvas.instructure.com/doc/api/index.html)

## Authentication and Headers
All requests to the Canvas API are authenticated using a **Bearer Token** generated in your Canvas user settings.

### Required Headers
- **Authorization:** `Bearer <YOUR_API_TOKEN>`
- **Content-Type:** `application/json`

### Rate Limiting and Pagination
The server automatically handles Canvas's rate limiting and pagination headers:
- **X-Rate-Limit-Remaining:** Monitored to prevent overwhelming the API.
- **Link Header:** Followed for paginated results (e.g., fetching large lists of students or assignments).
- **Pagination:** Most listing endpoints use `per_page=100` by default. The Smart Search endpoint uses `per_page=50`.

---

## Endpoint Definitions

### Courses
- `GET /api/v1/courses?enrollment_type=teacher&include[]=term` - List courses where the user is a teacher, including term details.
- `GET /api/v1/courses/:id` - Get details of a specific course.
- `GET /api/v1/courses/:id?include[]=syllabus_body` - Get course with syllabus body included (`get_syllabus` tool).
- `PUT /api/v1/courses/:id` - Update course settings (e.g., `course[syllabus_body]`).

### Assignments & Groups
- `GET /api/v1/courses/:id/assignments` - List all assignments in a course.
- `GET /api/v1/courses/:id/assignments/:assignment_id` - Get details of a specific assignment.
- `POST /api/v1/courses/:id/assignments` - Create a new assignment (params wrapped in `assignment`).
- `PUT /api/v1/courses/:id/assignments/:assignment_id` - Update an assignment (params wrapped in `assignment`).
- `DELETE /api/v1/courses/:id/assignments/:assignment_id` - Delete an assignment.
- `GET /api/v1/courses/:id/assignment_groups` - List assignment groups with weights and rules.
- `DELETE /api/v1/courses/:id/assignment_groups/:group_id` - Delete an assignment group.

### Submissions & Enrollments
- `GET /api/v1/courses/:id/enrollments?type[]=StudentEnrollment` - List student enrollments with current grades.
- `GET /api/v1/courses/:id/students/submissions?student_ids[]=all&include[]=assignment&include[]=user` - Bulk fetch submissions for all students.
- `GET /api/v1/courses/:id/students/submissions?student_ids[]=:student_id&include[]=assignment` - Fetch submissions for a specific student.
- `GET /api/v1/courses/:id/assignments/:assignment_id/submissions?include[]=user` - List submissions for a specific assignment.

### Modules & Items
- `GET /api/v1/courses/:id/modules` - List all modules.
- `GET /api/v1/courses/:id/modules/:module_id` - Get module details.
- `POST /api/v1/courses/:id/modules` - Create a module (params wrapped in `module`).
- `PUT /api/v1/courses/:id/modules/:module_id` - Update a module (params wrapped in `module`).
- `DELETE /api/v1/courses/:id/modules/:module_id` - Delete a module.
- `GET /api/v1/courses/:id/modules/:module_id/items?include[]=content_details` - List module items with due dates and points.
- `POST /api/v1/courses/:id/modules/:module_id/items` - Add an item (params wrapped in `module_item`).
- `PUT /api/v1/courses/:id/modules/:module_id/items/:item_id` - Update an item (params wrapped in `module_item`).
- `DELETE /api/v1/courses/:id/modules/:module_id/items/:item_id` - Remove a module item.

### Quizzes
- `GET /api/v1/courses/:id/quizzes` - List quizzes.
- `GET /api/v1/courses/:id/quizzes/:quiz_id` - Get quiz details.
- `POST /api/v1/courses/:id/quizzes` - Create a quiz (params wrapped in `quiz`).
- `PUT /api/v1/courses/:id/quizzes/:quiz_id` - Update a quiz (params wrapped in `quiz`).
- `DELETE /api/v1/courses/:id/quizzes/:quiz_id` - Delete a quiz.
- `GET /api/v1/courses/:id/quizzes/:quiz_id/questions` - List quiz questions.
- `POST /api/v1/courses/:id/quizzes/:quiz_id/questions` - Create a quiz question (params wrapped in `question`).

### Pages
- `GET /api/v1/courses/:id/pages` - List wiki pages.
- `GET /api/v1/courses/:id/pages/:url` - Get a specific page by URL slug.
- `POST /api/v1/courses/:id/pages` - Create a page (params wrapped in `wiki_page`).
- `PUT /api/v1/courses/:id/pages/:url` - Update a page (params wrapped in `wiki_page`).
- `DELETE /api/v1/courses/:id/pages/:url` - Delete a page.

### Discussions & Announcements
- `GET /api/v1/courses/:id/discussion_topics` - List discussion topics.
- `GET /api/v1/courses/:id/discussion_topics?only_announcements=true` - List announcements.
- `POST /api/v1/courses/:id/discussion_topics` - Create a topic (params at root).
- `DELETE /api/v1/courses/:id/discussion_topics/:topic_id` - Delete a topic.

### Files
- `GET /api/v1/courses/:id/files` - List files in a course.
- `POST /api/v1/courses/:id/files` - Initialize file upload (3-step process).
- `DELETE /api/v1/files/:file_id` - Delete a file.

### Rubrics
- `GET /api/v1/courses/:id/rubrics` - List rubrics in a course.
- `POST /api/v1/courses/:id/rubrics` - Create a rubric and associate it (params wrapped in `rubric` and `rubric_association`).
- `POST /api/v1/courses/:id/rubric_associations` - Associate an existing rubric (params wrapped in `rubric_association`).
- `DELETE /api/v1/courses/:id/rubrics/:rubric_id` - Delete a rubric.

### Smart Search (Beta)
- `GET /api/v1/courses/:id/smartsearch` — AI-powered semantic search across course content. Query params:
  - `q` (required): Natural language search query.
  - `filter[]` (optional): Limit by content type — `pages`, `assignments`, `announcements`, `discussion_topics`.
  - `include[]` (optional): Additional data to include — `status` (adds `published`/`due_at`), `modules`.
  - `per_page` (optional): Results per page (server uses `50`).
  - Response: array of `{ content_id, content_type, title, body, html_url, distance }` — lower `distance` = closer semantic match.
  - **Status: beta, limited availability.** Returns 404 or error JSON if not enabled on the Canvas instance.

---

## PII Blinding (Tokenization)
Several endpoints return student-related data that is automatically blinded by the server before being passed to the AI assistant.

### Affected Data Types:
- **Enrollments:** Student names and IDs are replaced.
- **Submissions:** `user_id` and student name fields are tokenized.
- **Grades:** Grade reports are associated only with session tokens (e.g., `[STUDENT_001]`).

### Blinding Process:
1.  **Intercept:** The server receives raw JSON from Canvas.
2.  **Identify:** PII fields (`user_id`, `name`, `sortable_name`) are located.
3.  **Replace:** Real values are exchanged for session tokens managed by the `SecureStore`.
4.  **Forward:** The AI receives the blinded JSON.

---

## Best Practices
- **Pagination:** Always request `per_page=100` for efficiency when listing large collections.
- **Rate Limits:** Respect the `X-Rate-Limit-Remaining` header to avoid 429 errors.
- **Idempotency:** The MCP server ensures that multiple calls for the same student within a session return the same token.
