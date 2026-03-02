import { z } from 'zod'
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type CanvasClient } from '../canvas/client.js'
import { type ConfigManager } from '../config/manager.js'
import { type CanvasTeacherConfig } from '../config/schema.js'
import { searchPages, getPage, updatePage, deletePage } from '../canvas/pages.js'
import { searchAssignments, updateAssignment, deleteAssignment } from '../canvas/assignments.js'
import {
  listQuizzes,
  updateQuiz,
  deleteQuiz,
  listQuizQuestions,
} from '../canvas/quizzes.js'
import {
  listModules,
  updateModule,
  deleteModule,
  listModuleItems,
  updateModuleItem,
  deleteModuleItem,
} from '../canvas/modules.js'
import {
  listDiscussionTopics,
  listAnnouncements,
  deleteDiscussionTopic,
} from '../canvas/discussions.js'
import { completionRequirementSchema } from './content.js'
import { smartSearch } from '../canvas/search.js'

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

const findItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('page'),
    search: z.string().describe('Case-insensitive partial title match'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('assignment'),
    search: z.string().describe('Case-insensitive partial name match'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('quiz'),
    search: z.string().describe('Case-insensitive partial title match'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('module'),
    search: z.string().describe('Case-insensitive partial name match'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('module_item'),
    search: z.string().describe('Case-insensitive partial title match'),
    module_name: z.string().describe('Name of the module containing the item (case-insensitive partial match)'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('discussion'),
    search: z.string().describe('Case-insensitive partial title match'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('announcement'),
    search: z.string().describe('Case-insensitive partial title match'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
])

const updateItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('page'),
    search: z.string().describe('Case-insensitive partial title match'),
    title: z.string().optional().describe('New page title'),
    body: z.string().optional().describe('New page body HTML'),
    published: z.boolean().optional().describe('Published state'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('assignment'),
    search: z.string().describe('Case-insensitive partial name match'),
    name: z.string().optional().describe('New assignment name'),
    points_possible: z.number().positive().optional().describe('Points possible'),
    due_at: z.string().nullable().optional().describe('Due date as ISO 8601, or null to clear'),
    submission_types: z.array(z.string()).optional().describe('Submission types'),
    assignment_group_id: z.number().int().positive().optional().describe('Assignment group ID'),
    description: z.string().optional().describe('Assignment description HTML'),
    published: z.boolean().optional().describe('Published state'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('quiz'),
    search: z.string().describe('Case-insensitive partial title match'),
    title: z.string().optional().describe('New quiz title'),
    quiz_type: z.enum(['practice_quiz', 'assignment', 'graded_survey', 'survey']).optional()
      .describe('Quiz type'),
    points_possible: z.number().positive().optional().describe('Points possible'),
    due_at: z.string().nullable().optional().describe('Due date as ISO 8601, or null to clear'),
    time_limit: z.number().int().positive().nullable().optional().describe('Time limit in minutes, or null to clear'),
    allowed_attempts: z.number().int().optional().describe('Number of allowed attempts'),
    published: z.boolean().optional().describe('Published state'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('module'),
    search: z.string().describe('Case-insensitive partial name match'),
    name: z.string().optional().describe('New module name'),
    published: z.boolean().optional().describe('Published state'),
    unlock_at: z.string().nullable().optional().describe('Unlock date as ISO 8601, or null to clear'),
    prerequisite_module_ids: z.array(z.number().int().positive()).optional()
      .describe('Prerequisite module IDs'),
    require_sequential_progress: z.boolean().optional()
      .describe('Require sequential progress'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('module_item'),
    search: z.string().describe('Case-insensitive partial title match'),
    module_name: z.string().describe('Name of the module containing the item (case-insensitive partial match)'),
    title: z.string().optional().describe('New item title'),
    position: z.number().int().positive().optional().describe('New position in module'),
    indent: z.number().int().nonnegative().optional().describe('Indent level (0–5)'),
    completion_requirement: completionRequirementSchema,
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
])

const deleteItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('page'),
    search: z.string().describe('Case-insensitive partial title match'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('assignment'),
    search: z.string().describe('Case-insensitive partial name match'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('quiz'),
    search: z.string().describe('Case-insensitive partial title match'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('module'),
    search: z.string().describe('Case-insensitive partial name match'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('module_item'),
    search: z.string().describe('Case-insensitive partial title match'),
    module_name: z.string().describe('Name of the module containing the item (case-insensitive partial match)'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('discussion'),
    search: z.string().describe('Case-insensitive partial title match'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
  z.object({
    type: z.literal('announcement'),
    search: z.string().describe('Case-insensitive partial title match'),
    course_id: z.number().int().positive().optional()
      .describe('Canvas course ID. Defaults to active course.'),
  }),
])

export function registerFindTools(
  server: McpServer,
  client: CanvasClient,
  configManager: ConfigManager
): void {
  // ── find_item ──────────────────────────────────────────────────────────────

  server.registerTool(
    'find_item',
    {
      description: [
        'Find a course item by name and return its full details in one call.',
        'Supports: page (with body), assignment (with description), quiz (with questions),',
        'module, module_item, discussion, announcement.',
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
        const pages = await searchPages(client, courseId, args.search)
        const found = resolveByName(pages, args.search, p => p.title)
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
        const assignments = await searchAssignments(client, courseId, args.search)
        const found = resolveByName(assignments, args.search, a => a.name)
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
        const found = resolveByName(quizzes, args.search, q => q.title)
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
        const found = resolveByName(modules, args.search, m => m.name)
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
        const foundModule = resolveByName(modules, args.module_name, m => m.name)
        if (!foundModule) return toolError(`No module found matching "${args.module_name}"`)
        const items = await listModuleItems(client, courseId, foundModule.match.id)
        const found = resolveByName(items, args.search, i => i.title)
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
        const found = resolveByName(discussions, args.search, d => d.title)
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
        const found = resolveByName(announcements, args.search, a => a.title)
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

      return toolError('Unknown item type')
    }
  )

  // ── update_item ──────────────────────────────────────────────────────────────

  server.registerTool(
    'update_item',
    {
      description: [
        'Find a course item by name then update it in a single call.',
        'Supports: page, assignment, quiz, module, module_item.',
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
        const pages = await searchPages(client, courseId, args.search)
        const found = resolveByName(pages, args.search, p => p.title)
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
        const assignments = await searchAssignments(client, courseId, args.search)
        const found = resolveByName(assignments, args.search, a => a.name)
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
        const found = resolveByName(quizzes, args.search, q => q.title)
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
        const found = resolveByName(modules, args.search, m => m.name)
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
        const foundModule = resolveByName(modules, args.module_name, m => m.name)
        if (!foundModule) return toolError(`No module found matching "${args.module_name}"`)
        const items = await listModuleItems(client, courseId, foundModule.match.id)
        const found = resolveByName(items, args.search, i => i.title)
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
        const pages = await searchPages(client, courseId, args.search)
        const found = resolveByName(pages, args.search, p => p.title)
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
        const assignments = await searchAssignments(client, courseId, args.search)
        const found = resolveByName(assignments, args.search, a => a.name)
        if (!found) return toolError(`No assignment found matching "${args.search}"`)
        await deleteAssignment(client, courseId, found.match.id)
        return toJson({ deleted: true, matched_title: found.match.name })
      }

      if (args.type === 'quiz') {
        const quizzes = await listQuizzes(client, courseId)
        const found = resolveByName(quizzes, args.search, q => q.title)
        if (!found) return toolError(`No quiz found matching "${args.search}"`)
        await deleteQuiz(client, courseId, found.match.id)
        return toJson({ deleted: true, matched_title: found.match.title })
      }

      if (args.type === 'module') {
        const modules = await listModules(client, courseId)
        const found = resolveByName(modules, args.search, m => m.name)
        if (!found) return toolError(`No module found matching "${args.search}"`)
        await deleteModule(client, courseId, found.match.id)
        return toJson({ deleted: true, matched_title: found.match.name })
      }

      if (args.type === 'module_item') {
        const modules = await listModules(client, courseId)
        const foundModule = resolveByName(modules, args.module_name, m => m.name)
        if (!foundModule) return toolError(`No module found matching "${args.module_name}"`)
        const items = await listModuleItems(client, courseId, foundModule.match.id)
        const found = resolveByName(items, args.search, i => i.title)
        if (!found) return toolError(`No module item found matching "${args.search}" in module "${foundModule.match.name}"`)
        await deleteModuleItem(client, courseId, foundModule.match.id, found.match.id)
        return toJson({ removed: true, matched_title: found.match.title })
      }

      if (args.type === 'discussion') {
        const topics = await listDiscussionTopics(client, courseId)
        const discussions = topics.filter(t => !t.is_announcement)
        const found = resolveByName(discussions, args.search, d => d.title)
        if (!found) return toolError(`No discussion found matching "${args.search}"`)
        await deleteDiscussionTopic(client, courseId, found.match.id)
        return toJson({ deleted: true, matched_title: found.match.title })
      }

      if (args.type === 'announcement') {
        const announcements = await listAnnouncements(client, courseId)
        const found = resolveByName(announcements, args.search, a => a.title)
        if (!found) return toolError(`No announcement found matching "${args.search}"`)
        await deleteDiscussionTopic(client, courseId, found.match.id)
        return toJson({ deleted: true, matched_title: found.match.title })
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
        course_id: z.number().int().positive().optional()
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

  // ── set_smart_search_threshold ────────────────────────────────────────────────

  server.registerTool(
    'set_smart_search_threshold',
    {
      description: [
        'Set the default distance threshold for Smart Search results.',
        'Lower values are stricter (e.g. 0.2 returns only very close matches).',
        'Higher values are more permissive (e.g. 0.8 returns loosely related results).',
        'Default is 0.5. Persisted to the config file.',
      ].join(' '),
      inputSchema: z.object({
        threshold: z.number().positive()
          .describe('New default distance threshold. Lower=stricter (e.g. 0.2). Higher=more permissive (e.g. 0.8).'),
      }),
    },
    async (args) => {
      const updated = configManager.update({ smartSearch: { distanceThreshold: args.threshold } })
      return toJson({ smartSearch: { distanceThreshold: updated.smartSearch.distanceThreshold } })
    }
  )
}
