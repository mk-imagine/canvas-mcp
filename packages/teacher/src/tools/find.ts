import { z } from 'zod'
import Handlebars from 'handlebars'
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type CanvasClient,
  type ConfigManager,
  type CanvasTeacherConfig,
  searchPages,
  getPage,
  updatePage,
  deletePage,
  createPage,
  listPages,
  searchAssignments,
  updateAssignment,
  deleteAssignment,
  createAssignment,
  listAssignments,
  listQuizzes,
  updateQuiz,
  deleteQuiz,
  listQuizQuestions,
  createQuiz,
  createQuizQuestion,
  listModules,
  updateModule,
  deleteModule,
  listModuleItems,
  updateModuleItem,
  deleteModuleItem,
  createModule,
  createModuleItem,
  listDiscussionTopics,
  listAnnouncements,
  deleteDiscussionTopic,
  createDiscussionTopic,
  listRubrics,
  fetchAssignmentGroups,
  getSyllabus,
  updateCourse,
  smartSearch,
  type TemplateService,
} from '@canvas-mcp/core'
import { completionRequirementSchema } from './content.js'

function resolveCourseId(config: CanvasTeacherConfig, override?: number): number {
  const id = override ?? config.program.activeCourseId
  if (id === null) {
    throw new Error('No active course set. Call set_active_course first.')
  }
  return id
}

function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }] }
}

function toJson(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return Handlebars.compile(template)(vars)
}

/**
 * Finds the first item whose label case-insensitively contains the search string.
 * Returns null if no items match.
 * Includes a warning if multiple items match.
 */
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

// ── Schemas ──────────────────────────────────────────────────────────────────

const findItemSchema = z.object({
  type: z.enum(['page', 'assignment', 'quiz', 'module', 'module_item', 'discussion', 'announcement', 'syllabus'])
    .describe('Item type to find'),
  search: z.string().optional()
    .describe('Case-insensitive partial title/name match. Required for all types except "syllabus".'),
  module_name: z.string().optional()
    .describe('For type="module_item": module name (case-insensitive partial match, required).'),
  course_id: z.number().optional()
    .describe('Canvas course ID. Defaults to active course.'),
})

const updateItemSchema = z.object({
  type: z.enum(['page', 'assignment', 'quiz', 'module', 'module_item', 'syllabus'])
    .describe('Item type to update'),
  search: z.string().optional()
    .describe('Case-insensitive partial title/name match. Required for all types except "syllabus".'),
  // page
  body: z.string().optional()
    .describe('For type="page": new page body HTML. For type="syllabus": new syllabus HTML, required (pass empty string to clear).'),
  // assignment
  name: z.string().optional()
    .describe('For type="assignment" or "module": new name/title.'),
  points_possible: z.number().positive().optional()
    .describe('For type="assignment" or "quiz": points possible.'),
  due_at: z.string().nullable().optional()
    .describe('For type="assignment" or "quiz": due date as ISO 8601, or null to clear.'),
  submission_types: z.array(z.string()).optional()
    .describe('For type="assignment": submission types.'),
  assignment_group_id: z.number().optional()
    .describe('For type="assignment": assignment group ID.'),
  description: z.string().optional()
    .describe('For type="assignment": assignment description HTML.'),
  // page + quiz + module_item
  title: z.string().optional()
    .describe('For type="page", "quiz", "module_item": new title.'),
  // quiz
  quiz_type: z.enum(['practice_quiz', 'assignment', 'graded_survey', 'survey']).optional()
    .describe('For type="quiz": quiz type.'),
  time_limit: z.number().int().positive().nullable().optional()
    .describe('For type="quiz": time limit in minutes, or null to clear.'),
  allowed_attempts: z.number().int().optional()
    .describe('For type="quiz": number of allowed attempts.'),
  // module
  unlock_at: z.string().nullable().optional()
    .describe('For type="module": unlock date as ISO 8601, or null to clear.'),
  prerequisite_module_ids: z.array(z.number()).optional()
    .describe('For type="module": prerequisite module IDs.'),
  require_sequential_progress: z.boolean().optional()
    .describe('For type="module": require sequential progress.'),
  // module_item
  module_name: z.string().optional()
    .describe('For type="module_item": module name (case-insensitive partial match, required).'),
  position: z.number().int().positive().optional()
    .describe('For type="module_item": new position in module.'),
  indent: z.number().int().nonnegative().optional()
    .describe('For type="module_item": indent level (0–5).'),
  completion_requirement: completionRequirementSchema,
  // shared
  published: z.boolean().optional()
    .describe('Published state.'),
  course_id: z.number().optional()
    .describe('Canvas course ID. Defaults to active course.'),
})

const deleteItemSchema = z.object({
  type: z.enum(['page', 'assignment', 'quiz', 'module', 'module_item', 'discussion', 'announcement'])
    .describe('Item type to delete'),
  search: z.string().optional()
    .describe('Case-insensitive partial title/name match (required).'),
  module_name: z.string().optional()
    .describe('For type="module_item": module name (case-insensitive partial match, required).'),
  course_id: z.number().optional()
    .describe('Canvas course ID. Defaults to active course.'),
})

const createItemSchema = z.object({
  type: z.enum(['page', 'assignment', 'quiz', 'discussion', 'announcement', 'module', 'module_item'])
    .describe('Item type to create'),
  // page
  title: z.string().optional()
    .describe('For type="page" or "module_item": title (required). For type="quiz": optional (or use use_exit_card_template).'),
  body: z.string().optional()
    .describe('For type="page": page body HTML. For type="discussion" or "announcement": body HTML (use message for these).'),
  template_name: z.string().optional()
    .describe('For type="page": name of a template in the config templates directory. Mutually exclusive with body. The template must contain a "page.hbs" file.'),
  template_data: z.record(z.string(), z.unknown()).optional()
    .describe('For type="page" with template_name: variables to pass to the template renderer.'),
  // assignment
  name: z.string().optional()
    .describe('For type="assignment": assignment title (required).'),
  points_possible: z.number().positive().optional()
    .describe('For type="assignment" or "quiz": points possible.'),
  due_at: z.string().optional()
    .describe('For type="assignment" or "quiz": due date as ISO 8601 string.'),
  submission_types: z.array(z.string()).optional()
    .describe('For type="assignment": submission types.'),
  assignment_group_id: z.number().optional()
    .describe('For type="assignment" or "quiz": assignment group ID.'),
  description: z.string().optional()
    .describe('For type="assignment": raw HTML description. If omitted with notebook_url, rendered from template.'),
  notebook_url: z.string().optional()
    .describe('For type="assignment": Google Colab notebook URL for description template rendering.'),
  notebook_title: z.string().optional()
    .describe('For type="assignment": link text for notebook URL in rendered description.'),
  instructions: z.string().optional()
    .describe('For type="assignment": instructional text for rendered description.'),
  // quiz
  quiz_type: z.enum(['practice_quiz', 'assignment', 'graded_survey', 'survey']).optional()
    .describe('For type="quiz": quiz type.'),
  time_limit: z.number().int().positive().optional()
    .describe('For type="quiz": time limit in minutes.'),
  allowed_attempts: z.number().int().optional()
    .describe('For type="quiz": number of allowed attempts.'),
  use_exit_card_template: z.boolean().optional()
    .describe('For type="quiz": populate title and questions from config exitCardTemplate.'),
  week: z.number().int().positive().optional()
    .describe('For type="quiz" with use_exit_card_template: week number for title template.'),
  questions: z.array(z.object({
    question_name: z.string(),
    question_text: z.string(),
    question_type: z.string(),
    points_possible: z.number().optional(),
  })).optional()
    .describe('For type="quiz": custom questions. Ignored when use_exit_card_template=true.'),
  // discussion + announcement
  message: z.string().optional()
    .describe('For type="discussion" or "announcement": body HTML.'),
  // module
  position: z.number().int().positive().optional()
    .describe('For type="module": position in module list. For type="module_item": position in module.'),
  // module_item
  module_name: z.string().optional()
    .describe('For type="module_item": module name to add item to (case-insensitive partial match, required).'),
  item_type: z.enum(['SubHeader', 'Page', 'Assignment', 'Quiz', 'ExternalUrl']).optional()
    .describe('For type="module_item": type of module item (required).'),
  content_id: z.number().optional()
    .describe('For type="module_item": Canvas content ID (for Assignment, Quiz types).'),
  page_url: z.string().optional()
    .describe('For type="module_item": page URL slug (for Page type).'),
  external_url: z.string().optional()
    .describe('For type="module_item": external URL (for ExternalUrl type).'),
  indent: z.number().int().nonnegative().optional()
    .describe('For type="module_item": indent level (0–5).'),
  new_tab: z.boolean().optional()
    .describe('For type="module_item": open in new tab (for ExternalUrl).'),
  completion_requirement: completionRequirementSchema,
  // shared
  published: z.boolean().optional()
    .describe('Publish immediately. Default false.'),
  dry_run: z.boolean().default(false)
    .describe('Preview without calling Canvas.'),
  course_id: z.number().optional()
    .describe('Canvas course ID. Defaults to active course.'),
})

const listItemsSchema = z.object({
  type: z.enum(['modules', 'assignments', 'quizzes', 'pages', 'discussions', 'announcements', 'rubrics', 'assignment_groups', 'module_items', 'templates'])
    .describe('Content type to list. "templates" returns local template descriptors (no active course required).'),
  module_name: z.string().optional()
    .describe('For type="module_items": module name (case-insensitive partial match, required).'),
  course_id: z.number().optional()
    .describe('Canvas course ID. Defaults to active course.'),
})

export function registerFindTools(
  server: McpServer,
  client: CanvasClient,
  configManager: ConfigManager,
  templateService: TemplateService
): void {
  // ── find_item ──────────────────────────────────────────────────────────────

  server.registerTool(
    'find_item',
    {
      description: [
        'Find a course item by name and return its full details in one call.',
        'Supports: page (with body), assignment (with description), quiz (with questions),',
        'module, module_item, discussion, announcement, syllabus.',
        'Returns the first case-insensitive partial match with a warning if multiple items matched.',
      ].join(' '),
      inputSchema: findItemSchema,
    },
    async (args) => {
      const config = configManager.read()
      let courseId: number
      try {
        courseId = resolveCourseId(config, args.course_id)
      } catch (err) {
        return toolError((err as Error).message)
      }

      if (args.type === 'page') {
        const pages = await searchPages(client, courseId, args.search!)
        const found = resolveByName(pages, args.search!, p => p.title)
        if (!found) return toolError(`No page found matching "${args.search}"`)
        const page = await getPage(client, courseId, found.match.url)
        return toJson({
          type: 'page',
          page_url: page.url,
          page_id: page.page_id,
          title: page.title,
          body: page.body,
          published: page.published,
          front_page: page.front_page,
          matched_title: found.match.title,
          ...(found.warning != null ? { warning: found.warning } : {}),
        })
      }

      if (args.type === 'assignment') {
        const assignments = await searchAssignments(client, courseId, args.search!)
        const found = resolveByName(assignments, args.search!, a => a.name)
        if (!found) return toolError(`No assignment found matching "${args.search}"`)
        const a = found.match
        return toJson({
          type: 'assignment',
          id: a.id,
          name: a.name,
          points_possible: a.points_possible,
          due_at: a.due_at,
          description: a.description,
          submission_types: a.submission_types,
          published: a.published,
          matched_title: a.name,
          ...(found.warning != null ? { warning: found.warning } : {}),
        })
      }

      if (args.type === 'quiz') {
        const quizzes = await listQuizzes(client, courseId)
        const found = resolveByName(quizzes, args.search!, q => q.title)
        if (!found) return toolError(`No quiz found matching "${args.search}"`)
        const q = found.match
        const questions = await listQuizQuestions(client, courseId, q.id)
        return toJson({
          type: 'quiz',
          id: q.id,
          title: q.title,
          quiz_type: q.quiz_type,
          points_possible: q.points_possible,
          due_at: q.due_at,
          published: q.published,
          questions,
          matched_title: q.title,
          ...(found.warning != null ? { warning: found.warning } : {}),
        })
      }

      if (args.type === 'module') {
        const modules = await listModules(client, courseId)
        const found = resolveByName(modules, args.search!, m => m.name)
        if (!found) return toolError(`No module found matching "${args.search}"`)
        const m = found.match
        return toJson({
          type: 'module',
          id: m.id,
          name: m.name,
          position: m.position,
          published: m.published,
          items_count: m.items_count,
          matched_title: m.name,
          ...(found.warning != null ? { warning: found.warning } : {}),
        })
      }

      if (args.type === 'module_item') {
        const modules = await listModules(client, courseId)
        const foundModule = resolveByName(modules, args.module_name!, m => m.name)
        if (!foundModule) return toolError(`No module found matching "${args.module_name}"`)
        const items = await listModuleItems(client, courseId, foundModule.match.id)
        const found = resolveByName(items, args.search!, i => i.title)
        if (!found) return toolError(`No module item found matching "${args.search}" in module "${foundModule.match.name}"`)
        const item = found.match
        return toJson({
          type: 'module_item',
          id: item.id,
          module_id: item.module_id,
          title: item.title,
          item_type: item.type,
          content_id: item.content_id,
          page_url: item.page_url,
          external_url: item.external_url,
          matched_title: item.title,
          ...(found.warning != null ? { warning: found.warning } : {}),
        })
      }

      if (args.type === 'discussion') {
        const topics = await listDiscussionTopics(client, courseId)
        const discussions = topics.filter(t => !t.is_announcement)
        const found = resolveByName(discussions, args.search!, d => d.title)
        if (!found) return toolError(`No discussion found matching "${args.search}"`)
        const d = found.match
        return toJson({
          type: 'discussion',
          id: d.id,
          title: d.title,
          message: d.message,
          published: d.published,
          matched_title: d.title,
          ...(found.warning != null ? { warning: found.warning } : {}),
        })
      }

      if (args.type === 'announcement') {
        const announcements = await listAnnouncements(client, courseId)
        const found = resolveByName(announcements, args.search!, a => a.title)
        if (!found) return toolError(`No announcement found matching "${args.search}"`)
        const a = found.match
        return toJson({
          type: 'announcement',
          id: a.id,
          title: a.title,
          message: a.message,
          matched_title: a.title,
          ...(found.warning != null ? { warning: found.warning } : {}),
        })
      }

      if (args.type === 'syllabus') {
        const syllabusBody = await getSyllabus(client, courseId)
        return toJson({ type: 'syllabus', syllabus_body: syllabusBody })
      }

      return toolError('Unknown item type')
    }
  )

  // ── update_item ──────────────────────────────────────────────────────────────

  server.registerTool(
    'update_item',
    {
      description: [
        'Find a course item by name then update it in a single call.',
        'Supports: page, assignment, quiz, module, module_item, syllabus.',
        'Provide only the fields you want to change; omit fields to leave them unchanged.',
      ].join(' '),
      inputSchema: updateItemSchema,
    },
    async (args) => {
      const config = configManager.read()
      let courseId: number
      try {
        courseId = resolveCourseId(config, args.course_id)
      } catch (err) {
        return toolError((err as Error).message)
      }

      if (args.type === 'page') {
        const pages = await searchPages(client, courseId, args.search!)
        const found = resolveByName(pages, args.search!, p => p.title)
        if (!found) return toolError(`No page found matching "${args.search}"`)
        const params: { title?: string; body?: string; published?: boolean } = {}
        if (args.title !== undefined) params.title = args.title
        if (args.body !== undefined) params.body = args.body
        if (args.published !== undefined) params.published = args.published
        const updated = await updatePage(client, courseId, found.match.url, params)
        return toJson({
          page_id: updated.page_id,
          url: updated.url,
          title: updated.title,
          body: updated.body,
          published: updated.published,
          front_page: updated.front_page,
          matched_title: found.match.title,
        })
      }

      if (args.type === 'assignment') {
        const assignments = await searchAssignments(client, courseId, args.search!)
        const found = resolveByName(assignments, args.search!, a => a.name)
        if (!found) return toolError(`No assignment found matching "${args.search}"`)
        const params: {
          name?: string; points_possible?: number; due_at?: string | null;
          submission_types?: string[]; assignment_group_id?: number;
          description?: string; published?: boolean
        } = {}
        if (args.name !== undefined) params.name = args.name
        if (args.points_possible !== undefined) params.points_possible = args.points_possible
        if (args.due_at !== undefined) params.due_at = args.due_at
        if (args.submission_types !== undefined) params.submission_types = args.submission_types
        if (args.assignment_group_id !== undefined) params.assignment_group_id = args.assignment_group_id
        if (args.description !== undefined) params.description = args.description
        if (args.published !== undefined) params.published = args.published
        const updated = await updateAssignment(client, courseId, found.match.id, params)
        return toJson({ ...updated, matched_title: found.match.name })
      }

      if (args.type === 'quiz') {
        const quizzes = await listQuizzes(client, courseId)
        const found = resolveByName(quizzes, args.search!, q => q.title)
        if (!found) return toolError(`No quiz found matching "${args.search}"`)
        const params: {
          title?: string; quiz_type?: 'practice_quiz' | 'assignment' | 'graded_survey' | 'survey';
          points_possible?: number; due_at?: string | null; time_limit?: number | null;
          allowed_attempts?: number; published?: boolean
        } = {}
        if (args.title !== undefined) params.title = args.title
        if (args.quiz_type !== undefined) params.quiz_type = args.quiz_type
        if (args.points_possible !== undefined) params.points_possible = args.points_possible
        if (args.due_at !== undefined) params.due_at = args.due_at
        if (args.time_limit !== undefined) params.time_limit = args.time_limit
        if (args.allowed_attempts !== undefined) params.allowed_attempts = args.allowed_attempts
        if (args.published !== undefined) params.published = args.published
        const updated = await updateQuiz(client, courseId, found.match.id, params)
        return toJson({ ...updated, matched_title: found.match.title })
      }

      if (args.type === 'module') {
        const modules = await listModules(client, courseId)
        const found = resolveByName(modules, args.search!, m => m.name)
        if (!found) return toolError(`No module found matching "${args.search}"`)
        const params: {
          name?: string; published?: boolean; unlock_at?: string | null;
          prerequisite_module_ids?: number[]; require_sequential_progress?: boolean
        } = {}
        if (args.name !== undefined) params.name = args.name
        if (args.published !== undefined) params.published = args.published
        if (args.unlock_at !== undefined) params.unlock_at = args.unlock_at
        if (args.prerequisite_module_ids !== undefined) params.prerequisite_module_ids = args.prerequisite_module_ids
        if (args.require_sequential_progress !== undefined) params.require_sequential_progress = args.require_sequential_progress
        const updated = await updateModule(client, courseId, found.match.id, params)
        return toJson({ ...updated, matched_title: found.match.name })
      }

      if (args.type === 'module_item') {
        const modules = await listModules(client, courseId)
        const foundModule = resolveByName(modules, args.module_name!, m => m.name)
        if (!foundModule) return toolError(`No module found matching "${args.module_name}"`)
        const items = await listModuleItems(client, courseId, foundModule.match.id)
        const found = resolveByName(items, args.search!, i => i.title)
        if (!found) return toolError(`No module item found matching "${args.search}" in module "${foundModule.match.name}"`)
        const params: {
          title?: string; position?: number; indent?: number;
          completion_requirement?: { type: 'min_score' | 'must_submit' | 'must_view'; min_score?: number } | null
        } = {}
        if (args.title !== undefined) params.title = args.title
        if (args.position !== undefined) params.position = args.position
        if (args.indent !== undefined) params.indent = args.indent
        if (args.completion_requirement !== undefined) params.completion_requirement = args.completion_requirement
        const updated = await updateModuleItem(client, courseId, foundModule.match.id, found.match.id, params)
        return toJson({ ...updated, matched_title: found.match.title })
      }

      if (args.type === 'syllabus') {
        await updateCourse(client, courseId, { syllabus_body: args.body! })
        return toJson({ type: 'syllabus', updated: true })
      }

      return toolError('Unknown item type')
    }
  )

  // ── delete_item ──────────────────────────────────────────────────────────────

  server.registerTool(
    'delete_item',
    {
      description: [
        'Find a course item by name then delete or remove it in a single call.',
        'Supports: page, assignment, quiz, module, module_item, discussion, announcement.',
        'NOTE: deleting a module_item only removes it from the module — the underlying content',
        '(page, assignment, etc.) is NOT deleted. All other types are permanently deleted.',
        'Pages designated as the course front page cannot be deleted.',
      ].join(' '),
      inputSchema: deleteItemSchema,
    },
    async (args) => {
      const config = configManager.read()
      let courseId: number
      try {
        courseId = resolveCourseId(config, args.course_id)
      } catch (err) {
        return toolError((err as Error).message)
      }

      if (args.type === 'page') {
        const pages = await searchPages(client, courseId, args.search!)
        const found = resolveByName(pages, args.search!, p => p.title)
        if (!found) return toolError(`No page found matching "${args.search}"`)
        if (found.match.front_page) {
          return toolError(
            `Cannot delete "${found.match.title}" because it is the course front page. ` +
            `Assign a different front page in Canvas first, then retry.`
          )
        }
        await deletePage(client, courseId, found.match.url)
        return toJson({ deleted: true, matched_title: found.match.title })
      }

      if (args.type === 'assignment') {
        const assignments = await searchAssignments(client, courseId, args.search!)
        const found = resolveByName(assignments, args.search!, a => a.name)
        if (!found) return toolError(`No assignment found matching "${args.search}"`)
        await deleteAssignment(client, courseId, found.match.id)
        return toJson({ deleted: true, matched_title: found.match.name })
      }

      if (args.type === 'quiz') {
        const quizzes = await listQuizzes(client, courseId)
        const found = resolveByName(quizzes, args.search!, q => q.title)
        if (!found) return toolError(`No quiz found matching "${args.search}"`)
        await deleteQuiz(client, courseId, found.match.id)
        return toJson({ deleted: true, matched_title: found.match.title })
      }

      if (args.type === 'module') {
        const modules = await listModules(client, courseId)
        const found = resolveByName(modules, args.search!, m => m.name)
        if (!found) return toolError(`No module found matching "${args.search}"`)
        await deleteModule(client, courseId, found.match.id)
        return toJson({ deleted: true, matched_title: found.match.name })
      }

      if (args.type === 'module_item') {
        const modules = await listModules(client, courseId)
        const foundModule = resolveByName(modules, args.module_name!, m => m.name)
        if (!foundModule) return toolError(`No module found matching "${args.module_name}"`)
        const items = await listModuleItems(client, courseId, foundModule.match.id)
        const found = resolveByName(items, args.search!, i => i.title)
        if (!found) return toolError(`No module item found matching "${args.search}" in module "${foundModule.match.name}"`)
        await deleteModuleItem(client, courseId, foundModule.match.id, found.match.id)
        return toJson({ removed: true, matched_title: found.match.title })
      }

      if (args.type === 'discussion') {
        const topics = await listDiscussionTopics(client, courseId)
        const discussions = topics.filter(t => !t.is_announcement)
        const found = resolveByName(discussions, args.search!, d => d.title)
        if (!found) return toolError(`No discussion found matching "${args.search}"`)
        await deleteDiscussionTopic(client, courseId, found.match.id)
        return toJson({ deleted: true, matched_title: found.match.title })
      }

      if (args.type === 'announcement') {
        const announcements = await listAnnouncements(client, courseId)
        const found = resolveByName(announcements, args.search!, a => a.title)
        if (!found) return toolError(`No announcement found matching "${args.search}"`)
        await deleteDiscussionTopic(client, courseId, found.match.id)
        return toJson({ deleted: true, matched_title: found.match.title })
      }

      return toolError('Unknown item type')
    }
  )

  // ── create_item ───────────────────────────────────────────────────────────────

  server.registerTool(
    'create_item',
    {
      description: [
        'Create a new course item. Supports 7 types: page, assignment, quiz, discussion, announcement, module, module_item.',
        'Use dry_run=true to preview the resolved input without calling Canvas.',
        'For assignment: renders HTML description from config template if notebook_url provided and description omitted.',
        'For quiz: use use_exit_card_template=true to populate from config exitCardTemplate.',
        'For module_item: resolves module by name using case-insensitive partial match.',
      ].join(' '),
      inputSchema: createItemSchema,
    },
    async (args) => {
      const config = configManager.read()
      let courseId: number
      try {
        courseId = resolveCourseId(config, args.course_id)
      } catch (err) {
        return toolError((err as Error).message)
      }

      if (args.type === 'page') {
        if (args.template_name != null && args.body != null) {
          return toolError('template_name and body are mutually exclusive for type="page". Provide one or the other.')
        }

        let pageBody: string | undefined = args.body
        if (args.template_name != null) {
          try {
            pageBody = templateService.renderFile(args.template_name, 'page.hbs', args.template_data ?? {})
          } catch (err) {
            return toolError(`Template render error: ${String(err)}`)
          }
        }

        if (args.dry_run) {
          return toJson({ dry_run: true, type: 'page', preview: { title: args.title!, body: pageBody, published: args.published ?? false } })
        }
        const page = await createPage(client, courseId, {
          title: args.title!,
          body: pageBody,
          published: args.published ?? false,
        })
        return toJson({ id: page.page_id, url: page.url, title: page.title, published: page.published })
      }

      if (args.type === 'assignment') {
        let description = args.description
        if (description == null && args.notebook_url != null) {
          description = renderTemplate(config.assignmentDescriptionTemplate.default, {
            notebook_url: args.notebook_url,
            notebook_title: args.notebook_title ?? args.name,
            instructions: args.instructions ?? '',
          })
        }
        if (args.dry_run) {
          return toJson({
            dry_run: true, type: 'assignment',
            preview: {
              name: args.name!,
              points_possible: args.points_possible ?? config.defaults.pointsPossible,
              due_at: args.due_at,
              submission_types: args.submission_types ?? [config.defaults.submissionType],
              assignment_group_id: args.assignment_group_id,
              description,
              published: args.published ?? false,
            },
          })
        }
        const assignment = await createAssignment(client, courseId, {
          name: args.name!,
          points_possible: args.points_possible ?? config.defaults.pointsPossible,
          due_at: args.due_at,
          submission_types: args.submission_types ?? [config.defaults.submissionType],
          assignment_group_id: args.assignment_group_id,
          description,
          published: args.published ?? false,
        })
        return toJson({
          id: assignment.id,
          name: assignment.name,
          points_possible: assignment.points_possible,
          due_at: assignment.due_at,
          published: assignment.published,
          html_url: assignment.html_url,
        })
      }

      if (args.type === 'quiz') {
        const useTemplate = args.use_exit_card_template ?? false
        const title = useTemplate
          ? renderTemplate(config.exitCardTemplate.title, {
              week: args.week != null ? String(args.week) : '?',
            })
          : args.title
        if (!title) {
          return toolError('title is required when use_exit_card_template is not set.')
        }
        const quizType = useTemplate ? config.exitCardTemplate.quizType : (args.quiz_type ?? 'assignment')
        const pointsPossible = useTemplate ? config.defaults.exitCardPoints : args.points_possible

        if (args.dry_run) {
          return toJson({
            dry_run: true, type: 'quiz',
            preview: {
              title,
              quiz_type: quizType,
              points_possible: pointsPossible,
              due_at: args.due_at,
              time_limit: args.time_limit,
              allowed_attempts: args.allowed_attempts,
              assignment_group_id: args.assignment_group_id,
              published: args.published ?? false,
            },
          })
        }

        const quiz = await createQuiz(client, courseId, {
          title,
          quiz_type: quizType,
          points_possible: pointsPossible,
          due_at: args.due_at,
          time_limit: args.time_limit,
          allowed_attempts: args.allowed_attempts,
          assignment_group_id: args.assignment_group_id,
          published: args.published ?? false,
        })
        const questions = useTemplate ? config.exitCardTemplate.questions : (args.questions ?? [])
        const createdQuestions = await Promise.all(
          questions.map((q) =>
            createQuizQuestion(client, courseId, quiz.id, {
              question_name: q.question_name,
              question_text: q.question_text,
              question_type: q.question_type,
              points_possible: q.points_possible ?? 0,
            })
          )
        )
        return toJson({
          id: quiz.id,
          title: quiz.title,
          quiz_type: quiz.quiz_type,
          points_possible: quiz.points_possible,
          due_at: quiz.due_at,
          published: quiz.published,
          html_url: quiz.html_url,
          questions_created: createdQuestions.length,
        })
      }

      if (args.type === 'discussion') {
        if (args.dry_run) {
          return toJson({ dry_run: true, type: 'discussion', preview: { title: args.title!, message: args.message, published: args.published ?? false } })
        }
        const topic = await createDiscussionTopic(client, courseId, {
          title: args.title!,
          message: args.message,
          is_announcement: false,
          published: args.published ?? false,
        })
        return toJson({ id: topic.id, title: topic.title, published: topic.published })
      }

      if (args.type === 'announcement') {
        if (args.dry_run) {
          return toJson({ dry_run: true, type: 'announcement', preview: { title: args.title!, message: args.message } })
        }
        const ann = await createDiscussionTopic(client, courseId, {
          title: args.title!,
          message: args.message,
          is_announcement: true,
          published: true,
        })
        return toJson({ id: ann.id, title: ann.title })
      }

      if (args.type === 'module') {
        if (args.dry_run) {
          return toJson({ dry_run: true, type: 'module', preview: { name: args.name!, position: args.position, published: args.published ?? false } })
        }
        const mod = await createModule(client, courseId, { name: args.name! })
        if (args.published) {
          await updateModule(client, courseId, mod.id, { published: true })
        }
        return toJson({ id: mod.id, name: mod.name, position: mod.position })
      }

      if (args.type === 'module_item') {
        const modules = await listModules(client, courseId)
        const foundModule = resolveByName(modules, args.module_name!, m => m.name)
        if (!foundModule) return toolError(`No module found matching "${args.module_name}"`)

        if (args.dry_run) {
          return toJson({
            dry_run: true, type: 'module_item',
            preview: {
              module_id: foundModule.match.id,
              module_name: foundModule.match.name,
              item_type: args.item_type!,
              title: args.title!,
              content_id: args.content_id,
              page_url: args.page_url,
              external_url: args.external_url,
              position: args.position,
              indent: args.indent,
              new_tab: args.new_tab,
              completion_requirement: args.completion_requirement,
            },
          })
        }

        const mi = await createModuleItem(client, courseId, foundModule.match.id, {
          type: args.item_type!,
          title: args.title!,
          content_id: args.content_id,
          page_url: args.page_url,
          external_url: args.external_url,
          position: args.position,
          indent: args.indent,
          new_tab: args.new_tab,
          completion_requirement: args.completion_requirement,
        })
        return toJson({
          id: mi.id,
          module_id: mi.module_id,
          title: mi.title,
          type: mi.type,
          ...(foundModule.warning != null ? { warning: foundModule.warning } : {}),
        })
      }

      return toolError('Unknown item type')
    }
  )

  // ── list_items ─────────────────────────────────────────────────────────────

  server.registerTool(
    'list_items',
    {
      description: [
        'List course items by type. Supports 9 types: modules, assignments, quizzes, pages,',
        'discussions, announcements, rubrics, assignment_groups, module_items.',
        'For module_items, provide module_name to identify the module.',
      ].join(' '),
      inputSchema: listItemsSchema,
    },
    async (args) => {
      // Short-circuit for local-only types (no active course required)
      if (args.type === 'templates') {
        return toJson(templateService.list())
      }

      const config = configManager.read()
      let courseId: number
      try {
        courseId = resolveCourseId(config, args.course_id)
      } catch (err) {
        return toolError((err as Error).message)
      }

      if (args.type === 'modules') {
        const modules = await listModules(client, courseId)
        return toJson(modules.map(m => ({
          id: m.id,
          name: m.name,
          position: m.position,
          published: m.published,
          items_count: m.items_count,
          unlock_at: m.unlock_at,
          prerequisite_module_ids: m.prerequisite_module_ids,
        })))
      }

      if (args.type === 'assignments') {
        const assignments = await listAssignments(client, courseId)
        return toJson(assignments.map(a => ({
          id: a.id,
          name: a.name,
          points_possible: a.points_possible,
          due_at: a.due_at,
          submission_types: a.submission_types,
          published: a.published,
        })))
      }

      if (args.type === 'quizzes') {
        const quizzes = await listQuizzes(client, courseId)
        return toJson(quizzes.map(q => ({
          id: q.id,
          title: q.title,
          quiz_type: q.quiz_type,
          points_possible: q.points_possible,
          due_at: q.due_at,
          published: q.published,
        })))
      }

      if (args.type === 'pages') {
        const pages = await listPages(client, courseId)
        return toJson(pages.map(p => ({
          page_id: p.page_id,
          url: p.url,
          title: p.title,
          published: p.published,
          front_page: p.front_page,
        })))
      }

      if (args.type === 'discussions') {
        const topics = await listDiscussionTopics(client, courseId)
        const discussions = topics.filter(t => !t.is_announcement)
        return toJson(discussions.map(d => ({
          id: d.id,
          title: d.title,
          published: d.published,
        })))
      }

      if (args.type === 'announcements') {
        const announcements = await listAnnouncements(client, courseId)
        return toJson(announcements.map(a => ({
          id: a.id,
          title: a.title,
          published: a.published,
        })))
      }

      if (args.type === 'rubrics') {
        const rubrics = await listRubrics(client, courseId)
        return toJson(rubrics.map(r => ({
          id: r.id,
          title: r.title,
          points_possible: r.points_possible,
        })))
      }

      if (args.type === 'assignment_groups') {
        const groups = await fetchAssignmentGroups(client, courseId)
        return toJson(groups.map(g => ({
          id: g.id,
          name: g.name,
          group_weight: g.group_weight,
          rules: g.rules,
        })))
      }

      if (args.type === 'module_items') {
        const modules = await listModules(client, courseId)
        const foundModule = resolveByName(modules, args.module_name!, m => m.name)
        if (!foundModule) return toolError(`No module found matching "${args.module_name}"`)
        const items = await listModuleItems(client, courseId, foundModule.match.id)
        const result: Record<string, unknown> = {
          module_id: foundModule.match.id,
          module_name: foundModule.match.name,
          items: items.map(i => ({
            id: i.id,
            position: i.position,
            type: i.type,
            title: i.title,
            content_id: i.content_id,
            page_url: i.page_url,
            external_url: i.external_url,
            completion_requirement: i.completion_requirement,
          })),
        }
        if (foundModule.warning) result.warning = foundModule.warning
        return toJson(result)
      }

      return toolError('Unknown item type')
    }
  )

  // ── search_course ─────────────────────────────────────────────────────────────

  server.registerTool(
    'search_course',
    {
      description: [
        'Search course content using Canvas Smart Search (AI-powered semantic/vector search).',
        'Returns results with distance scores — lower distance means closer match.',
        'Searches across pages, assignments, announcements, and discussion topics.',
        'Use save_threshold=true to persist the threshold value to config as the new default.',
        'NOTE: Canvas Smart Search is a beta feature and may not be available on all instances.',
      ].join(' '),
      inputSchema: z.object({
        query: z.string().describe('Natural language or keyword search query'),
        filter: z.array(z.enum(['pages', 'assignments', 'announcements', 'discussion_topics'])).optional()
          .describe('Limit to specific content types. Omit to search all types.'),
        threshold: z.number().positive().optional()
          .describe('Max distance score to include (lower=closer match). Overrides config default.'),
        limit: z.number().int().positive().optional()
          .describe('Max results to return after threshold filtering. Returns all passing results if omitted.'),
        include_body: z.boolean().optional()
          .describe('Include full HTML body in results. Default false.'),
        save_threshold: z.boolean().optional()
          .describe('If true, persists the threshold value to config as the new default.'),
        course_id: z.number().optional()
          .describe('Canvas course ID. Defaults to active course.'),
      }),
    },
    async (args) => {
      const config = configManager.read()
      let courseId: number
      try {
        courseId = resolveCourseId(config, args.course_id)
      } catch (err) {
        return toolError((err as Error).message)
      }

      const threshold = args.threshold ?? config.smartSearch.distanceThreshold

      if (args.save_threshold === true) {
        configManager.update({ smartSearch: { distanceThreshold: threshold } })
      }

      let rawResults: Awaited<ReturnType<typeof smartSearch>>
      try {
        rawResults = await smartSearch(client, courseId, args.query, {
          filter: args.filter,
          include: ['status'],
        })
      } catch (err) {
        return toolError(
          `Smart Search failed: ${(err as Error).message}. ` +
          `Canvas Smart Search is a beta feature and may not be available on this instance.`
        )
      }

      let filtered = rawResults.filter(r => r.distance <= threshold)
      if (args.limit !== undefined) {
        filtered = filtered.slice(0, args.limit)
      }

      const results = filtered.map(r => {
        const item: Record<string, unknown> = {
          content_type: r.content_type,
          content_id: r.content_id,
          title: r.title,
          distance: r.distance,
          html_url: r.html_url,
          published: r.published,
          due_at: r.due_at,
        }
        if (args.include_body) {
          item.body = r.body
        }
        return item
      })

      return toJson({
        query: args.query,
        threshold,
        total_results: rawResults.filter(r => r.distance <= threshold).length,
        returned_results: results.length,
        results,
      })
    }
  )
}
