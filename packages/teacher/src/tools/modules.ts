import { z } from 'zod'
import Handlebars from 'handlebars'
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type CanvasClient,
  type ConfigManager,
  type CanvasTeacherConfig,
  type TemplateService,
  createPage,
  getPage,
  createAssignment,
  getAssignment,
  createQuiz,
  createQuizQuestion,
  getQuiz,
  listQuizQuestions,
  createModule,
  updateModule,
  getModule,
  listModuleItems,
  createModuleItem,
  type RenderableItem,
  type QuizQuestionInput,
} from '@canvas-mcp/core'

// ─── Shared helpers ───────────────────────────────────────────────────────────

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

// ─── Creation sequence executor ───────────────────────────────────────────────

interface CreatedItem {
  type: string
  title: string
  id?: number
  url?: string
  module_item_id?: number
}

interface ExecutionResult {
  items_created: CreatedItem[]
  error?: string
  completed_before_failure?: CreatedItem[]
}

async function executeRenderables(
  client: CanvasClient,
  courseId: number,
  moduleId: number,
  renderables: RenderableItem[],
  config: CanvasTeacherConfig,
  assignmentGroupId?: number
): Promise<ExecutionResult> {
  const items_created: CreatedItem[] = []

  const completionReq = config.defaults.completionRequirement === 'min_score'
    ? { type: 'min_score' as const, min_score: config.defaults.minScore }
    : { type: config.defaults.completionRequirement as 'must_submit' | 'must_view' }

  for (const item of renderables) {
    try {
      if (item.kind === 'subheader') {
        const mi = await createModuleItem(client, courseId, moduleId, {
          type: 'SubHeader',
          title: item.title,
        })
        items_created.push({ type: 'SubHeader', title: item.title, module_item_id: mi.id })

      } else if (item.kind === 'page') {
        const page = await createPage(client, courseId, {
          title: item.title,
          body: item.body,
          published: false,
        })
        const mi = await createModuleItem(client, courseId, moduleId, {
          type: 'Page',
          title: item.title,
          page_url: page.url,
        })
        items_created.push({ type: 'Page', title: item.title, id: page.page_id, url: page.url, module_item_id: mi.id })

      } else if (item.kind === 'assignment') {
        const assignment = await createAssignment(client, courseId, {
          name: item.title,
          points_possible: item.points,
          due_at: item.due_at,
          submission_types: item.submission_types,
          assignment_group_id: assignmentGroupId,
          description: item.description,
          published: false,
        })
        const mi = await createModuleItem(client, courseId, moduleId, {
          type: 'Assignment',
          title: item.title,
          content_id: assignment.id,
          completion_requirement: completionReq,
        })
        items_created.push({ type: 'Assignment', title: item.title, id: assignment.id, module_item_id: mi.id })

      } else if (item.kind === 'exit_card_quiz') {
        const title = Handlebars.compile(config.exitCardTemplate.title)({ week: String(item.week) })
        const quiz = await createQuiz(client, courseId, {
          title,
          quiz_type: config.exitCardTemplate.quizType,
          points_possible: config.defaults.exitCardPoints,
          published: false,
        })
        await Promise.all(
          config.exitCardTemplate.questions.map(q =>
            createQuizQuestion(client, courseId, quiz.id, {
              question_name: q.question_name,
              question_text: q.question_text,
              question_type: q.question_type,
              points_possible: q.points_possible ?? 0,
            })
          )
        )
        const mi = await createModuleItem(client, courseId, moduleId, {
          type: 'Quiz',
          title,
          content_id: quiz.id,
          completion_requirement: completionReq,
        })
        items_created.push({ type: 'Quiz (exit card)', title, id: quiz.id, module_item_id: mi.id })

      } else if (item.kind === 'quiz') {
        const quiz = await createQuiz(client, courseId, {
          title: item.title,
          quiz_type: item.quiz_type as 'practice_quiz' | 'assignment' | 'graded_survey' | 'survey',
          points_possible: item.points,
          due_at: item.due_at,
          time_limit: item.time_limit,
          allowed_attempts: item.allowed_attempts,
          published: false,
        })
        if (item.questions && item.questions.length > 0) {
          await Promise.all(
            item.questions.map((q: QuizQuestionInput) =>
              createQuizQuestion(client, courseId, quiz.id, {
                question_name: q.question_name,
                question_text: q.question_text,
                question_type: q.question_type,
                points_possible: q.points_possible ?? 0,
              })
            )
          )
        }
        const mi = await createModuleItem(client, courseId, moduleId, {
          type: 'Quiz',
          title: item.title,
          content_id: quiz.id,
          completion_requirement: completionReq,
        })
        items_created.push({ type: 'Quiz', title: item.title, id: quiz.id, module_item_id: mi.id })

      } else if (item.kind === 'external_url') {
        const mi = await createModuleItem(client, courseId, moduleId, {
          type: 'ExternalUrl',
          title: item.title,
          external_url: item.url,
          new_tab: true,
        })
        items_created.push({ type: 'ExternalUrl', title: item.title, module_item_id: mi.id })
      }
    } catch (err) {
      return {
        error: (err as Error).message,
        completed_before_failure: items_created,
        items_created: [],
      }
    }
  }

  return { items_created }
}

// ─── registerModuleTools ──────────────────────────────────────────────────────

export function registerModuleTools(
  server: McpServer,
  client: CanvasClient,
  configManager: ConfigManager,
  templateService: TemplateService
): void {
  server.registerTool(
    'build_module',
    {
      description: [
        'Build a Canvas module using one of four modes:',
        'mode="blueprint" — render a named template with supplied variables.',
        'mode="manual" — create a module from an explicit ordered list of items.',
        'mode="solution" — create a solution module gated on a prerequisite lesson module.',
        'mode="clone" — clone a module from one course into the active (or specified) destination course.',
        'Use list_items(type="templates") to discover available template names and their variable schemas.',
      ].join(' '),
      inputSchema: z.object({
        mode: z.enum(['blueprint', 'manual', 'solution', 'clone'])
          .describe('Module creation mode.'),
        // blueprint
        template_name: z.string().optional()
          .describe('For mode="blueprint": name of the template directory (required).'),
        variables: z.record(z.string(), z.unknown()).optional()
          .describe('For mode="blueprint": key/value pairs matching the template variables_schema (required).'),
        // manual
        module_name: z.string().optional()
          .describe('For mode="manual": name of the Canvas module to create (required).'),
        items: z.array(z.object({
          kind: z.enum(['subheader', 'page', 'assignment', 'quiz', 'external_url']),
          title: z.string().optional(),
          body: z.string().optional(),
          points: z.number().optional(),
          due_at: z.string().optional(),
          submission_types: z.array(z.string()).optional(),
          description: z.string().optional(),
          url: z.string().optional(),
          quiz_type: z.string().optional(),
          time_limit: z.number().optional(),
          allowed_attempts: z.number().optional(),
          questions: z.array(z.object({
            question_name: z.string(),
            question_text: z.string(),
            question_type: z.string(),
            points_possible: z.number().optional(),
          })).optional(),
        })).optional()
          .describe('For mode="manual": ordered list of items to create in the module (required).'),
        // blueprint + manual shared
        assignment_group_id: z.number().optional()
          .describe('Assignment group ID for all assignments created.'),
        // solution
        title: z.string().optional()
          .describe('For mode="solution": full module title (required). For mode="blueprint": module title override.'),
        lesson_module_id: z.number().optional()
          .describe('For mode="solution": ID of the prerequisite lesson module (required).'),
        unlock_at: z.string().optional()
          .describe('For mode="solution": ISO 8601 date when this module unlocks (required).'),
        solutions: z.array(z.object({ title: z.string(), url: z.string() })).optional()
          .describe('For mode="solution": solution links to add as module items (required).'),
        // clone
        source_module_id: z.number().optional()
          .describe('For mode="clone": Canvas module ID to clone (required).'),
        source_course_id: z.number().optional()
          .describe('For mode="clone": course ID containing the source module (required).'),
        dest_course_id: z.number().optional()
          .describe('For mode="clone": destination course ID. Defaults to active course.'),
        // blueprint + clone shared
        week: z.number().optional()
          .describe('Week number. For blueprint: passed as template variable. For clone: replaces "Week N" in titles.'),
        due_date: z.string().optional()
          .describe('ISO 8601 due date. For blueprint: passed as template variable. For clone: overrides all graded item due dates.'),
        // shared
        publish: z.boolean().optional()
          .describe('Publish the module after creation. Default false.'),
        dry_run: z.boolean().optional()
          .describe('For mode="blueprint" or "solution": preview without creating anything in Canvas.'),
        course_id: z.number().optional()
          .describe('Canvas course ID. Defaults to active course.'),
      }),
    },
    async (args) => {
      // ── blueprint ─────────────────────────────────────────────────────────
      if (args.mode === 'blueprint') {
        const config = configManager.read()
        let courseId: number
        try { courseId = resolveCourseId(config, args.course_id) }
        catch (err) { return toolError((err as Error).message) }

        let renderables: RenderableItem[]
        try {
          const vars: Record<string, unknown> = {
            ...(args.variables ?? {}),
            ...(args.week != null ? { week: args.week } : {}),
            ...(args.due_date != null ? { due_date: args.due_date } : {}),
          }
          renderables = templateService.render(args.template_name!, vars)
        } catch (err) { return toolError(String(err)) }

        if (args.dry_run) return toJson({ items_preview: renderables, dry_run: true })

        const moduleName = args.title
          ? (args.week != null ? `Week ${args.week} | ${args.title}` : args.title)
          : (args.week != null ? `Week ${args.week}` : args.template_name!)
        const mod = await createModule(client, courseId, { name: moduleName })
        const result = await executeRenderables(client, courseId, mod.id, renderables, config, args.assignment_group_id)

        if (result.error) return toJson({ module: { id: mod.id, name: mod.name }, completed_before_failure: result.completed_before_failure, error: result.error })
        if (args.publish) await updateModule(client, courseId, mod.id, { published: true })
        return toJson({ module: { id: mod.id, name: mod.name }, items_created: result.items_created, dry_run: false })
      }

      // ── manual ────────────────────────────────────────────────────────────
      if (args.mode === 'manual') {
        const config = configManager.read()
        let courseId: number
        try { courseId = resolveCourseId(config, args.course_id) }
        catch (err) { return toolError((err as Error).message) }

        const renderables = (args.items ?? []) as RenderableItem[]
        if (args.dry_run) return toJson({ items_preview: renderables, dry_run: true })

        const mod = await createModule(client, courseId, { name: args.module_name! })
        const result = await executeRenderables(client, courseId, mod.id, renderables, config, args.assignment_group_id)

        if (result.error) return toJson({ module: { id: mod.id, name: mod.name }, completed_before_failure: result.completed_before_failure, error: result.error })
        if (args.publish) await updateModule(client, courseId, mod.id, { published: true })
        return toJson({ module: { id: mod.id, name: mod.name }, items_created: result.items_created, dry_run: false })
      }

      // ── solution ──────────────────────────────────────────────────────────
      if (args.mode === 'solution') {
        const config = configManager.read()
        let courseId: number
        try {
          courseId = resolveCourseId(config, args.course_id)
        } catch (err) {
          return toolError((err as Error).message)
        }

        if (args.dry_run) {
          return toJson({
            dry_run: true,
            module_preview: {
              name: args.title!,
              prerequisite_module_ids: [args.lesson_module_id!],
              unlock_at: args.unlock_at!,
            },
            items_preview: args.solutions!.map(s => ({ kind: 'external_url', title: s.title, url: s.url })),
          })
        }

        try {
          await getModule(client, courseId, args.lesson_module_id!)
        } catch {
          return toolError(`Lesson module ${args.lesson_module_id!} not found in course ${courseId}`)
        }

        const mod = await createModule(client, courseId, {
          name: args.title!,
          prerequisite_module_ids: [args.lesson_module_id!],
          unlock_at: args.unlock_at!,
        })

        const items_created: CreatedItem[] = []
        for (const solution of args.solutions!) {
          const mi = await createModuleItem(client, courseId, mod.id, {
            type: 'ExternalUrl',
            title: solution.title,
            external_url: solution.url,
            new_tab: true,
          })
          items_created.push({ type: 'ExternalUrl', title: solution.title, module_item_id: mi.id })
        }

        if (args.publish) {
          await updateModule(client, courseId, mod.id, { published: true })
        }

        return toJson({
          module: { id: mod.id, name: mod.name, prerequisite_module_ids: mod.prerequisite_module_ids },
          items_created,
        })
      }

      // ── clone ───────────────────────────────────────────────────────────
      const config = configManager.read()
      let destCourseId: number
      try {
        destCourseId = resolveCourseId(config, args.dest_course_id)
      } catch (err) {
        return toolError((err as Error).message)
      }

      let sourceModule: Awaited<ReturnType<typeof getModule>>
      try {
        sourceModule = await getModule(client, args.source_course_id!, args.source_module_id!)
      } catch {
        return toolError(`Source module ${args.source_module_id!} not found in course ${args.source_course_id!}`)
      }

      const sourceItems = await listModuleItems(client, args.source_course_id!, args.source_module_id!)

      const detailFetches = sourceItems.map(async (item) => {
        if (item.type === 'Assignment' && item.content_id) {
          try {
            return { item, detail: await getAssignment(client, args.source_course_id!, item.content_id) }
          } catch {
            return { item, detail: null }
          }
        }
        if (item.type === 'Quiz' && item.content_id) {
          try {
            const [quiz, questions] = await Promise.all([
              getQuiz(client, args.source_course_id!, item.content_id),
              listQuizQuestions(client, args.source_course_id!, item.content_id),
            ])
            return { item, detail: { ...quiz, questions } }
          } catch {
            return { item, detail: null }
          }
        }
        if (item.type === 'Page' && item.page_url) {
          try {
            return { item, detail: await getPage(client, args.source_course_id!, item.page_url) }
          } catch {
            return { item, detail: null }
          }
        }
        return { item, detail: null }
      })

      const fetched = await Promise.all(detailFetches)

      const cloneWeek = args.week
      function subWeek(text: string): string {
        if (cloneWeek == null) return text
        return text.replace(/Week\s+\d+/g, `Week ${cloneWeek}`)
      }

      const renderables: RenderableItem[] = []
      for (const { item, detail } of fetched) {
        if (item.type === 'SubHeader') {
          renderables.push({ kind: 'subheader', title: subWeek(item.title) })

        } else if (item.type === 'ExternalUrl') {
          renderables.push({
            kind: 'external_url',
            title: subWeek(item.title),
            url: item.external_url ?? '',
          })

        } else if (item.type === 'Page') {
          const pageDetail = detail as { title: string; body: string | null } | null
          const title = subWeek(pageDetail?.title ?? item.title)
          const body = pageDetail?.body
            ? subWeek(pageDetail.body)
            : undefined
          renderables.push({ kind: 'page', title, body })

        } else if (item.type === 'Assignment') {
          const asgn = detail as { name: string; points_possible: number; due_at: string | null; submission_types: string[]; description: string | null } | null
          const title = subWeek(asgn?.name ?? item.title)
          renderables.push({
            kind: 'assignment',
            title,
            points: asgn?.points_possible ?? 0,
            due_at: args.due_date ?? asgn?.due_at ?? '',
            submission_types: asgn?.submission_types ?? ['online_url'],
            description: asgn?.description ?? undefined,
          })

        } else if (item.type === 'Quiz') {
          const quizDetail = detail as { title: string; quiz_type: string; points_possible: number | null; due_at: string | null; time_limit: number | null; allowed_attempts: number; questions?: QuizQuestionInput[] } | null
          const title = subWeek(quizDetail?.title ?? item.title)
          renderables.push({
            kind: 'quiz',
            title,
            quiz_type: quizDetail?.quiz_type ?? 'assignment',
            points: quizDetail?.points_possible ?? 0,
            due_at: args.due_date ?? quizDetail?.due_at ?? '',
            time_limit: quizDetail?.time_limit ?? undefined,
            allowed_attempts: quizDetail?.allowed_attempts,
            questions: quizDetail?.questions,
          })
        }
      }

      const moduleName = cloneWeek != null
        ? subWeek(sourceModule.name)
        : sourceModule.name

      const mod = await createModule(client, destCourseId, { name: moduleName })

      const result = await executeRenderables(
        client, destCourseId, mod.id, renderables, config
      )

      if (result.error) {
        return toJson({
          module: { id: mod.id, name: mod.name },
          completed_before_failure: result.completed_before_failure,
          error: result.error,
        })
      }

      return toJson({
        module: { id: mod.id, name: mod.name },
        items_created: result.items_created,
        dry_run: false,
      })
    }
  )
}
