import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { server as mswServer } from '../../setup/msw-server.js'
import { CanvasClient, ConfigManager, SecureStore, SidecarManager } from '@canvas-mcp/core'
import { registerReportingTools } from '../../../src/tools/reporting.js'

const CANVAS_URL = 'https://canvas.example.com'
const COURSE_ID = 1

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_MODULE = {
  id: 10, name: 'Week 1: Introduction', position: 1, published: true,
  items_count: 3, unlock_at: null, prerequisite_module_ids: [],
  require_sequential_progress: false, workflow_state: 'active',
}

const MOCK_ITEMS = [
  {
    id: 101, module_id: 10, position: 1, title: 'OVERVIEW', type: 'SubHeader',
    indent: 0, completion_requirement: null, content_details: {},
  },
  {
    id: 102, module_id: 10, position: 2, title: 'Week 1 | Overview', type: 'Page',
    content_id: 201, indent: 0, completion_requirement: { type: 'must_view' }, content_details: {},
  },
  {
    id: 103, module_id: 10, position: 3, title: 'Week 1 | Assignment 1.1', type: 'Assignment',
    content_id: 301, indent: 0,
    completion_requirement: { type: 'min_score', min_score: 1 },
    content_details: { points_possible: 10, due_at: '2026-03-01T23:59:00Z' },
  },
]

const MOCK_ENROLLMENTS = [
  {
    id: 1, user_id: 1001, type: 'StudentEnrollment', enrollment_state: 'active',
    user: { id: 1001, name: 'Jane Smith', sortable_name: 'Smith, Jane' },
    grades: { current_score: 87.4, final_score: 82.1, current_grade: 'B+', final_grade: 'B-' },
  },
  {
    id: 2, user_id: 1002, type: 'StudentEnrollment', enrollment_state: 'active',
    user: { id: 1002, name: 'Bob Adams', sortable_name: 'Adams, Bob' },
    grades: { current_score: 60.0, final_score: 50.0, current_grade: 'D', final_grade: 'F' },
  },
]

const MOCK_SUBMISSIONS = [
  // Jane: 1 graded, 1 late+ungraded
  {
    id: 201, assignment_id: 501, user_id: 1001, score: 9.0,
    submitted_at: '2026-02-01T10:00:00Z', graded_at: '2026-02-02T09:00:00Z',
    late: false, missing: false, workflow_state: 'graded',
    assignment: { id: 501, name: 'Assignment A', points_possible: 10, due_at: '2026-02-01T23:59:00Z', assignment_group_id: 100 },
    user: { id: 1001, name: 'Jane Smith', sortable_name: 'Smith, Jane' },
  },
  {
    id: 202, assignment_id: 502, user_id: 1001, score: null,
    submitted_at: '2026-02-15T10:00:00Z', graded_at: null,
    late: true, missing: false, workflow_state: 'submitted',
    assignment: { id: 502, name: 'Assignment B', points_possible: 10, due_at: '2026-02-10T23:59:00Z', assignment_group_id: 100 },
    user: { id: 1001, name: 'Jane Smith', sortable_name: 'Smith, Jane' },
  },
  // Bob: 1 missing
  {
    id: 203, assignment_id: 501, user_id: 1002, score: null,
    submitted_at: null, graded_at: null,
    late: false, missing: true, workflow_state: 'unsubmitted',
    assignment: { id: 501, name: 'Assignment A', points_possible: 10, due_at: '2026-02-01T23:59:00Z', assignment_group_id: 100 },
    user: { id: 1002, name: 'Bob Adams', sortable_name: 'Adams, Bob' },
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpConfigPath(): string {
  const suffix = randomBytes(8).toString('hex')
  return join(tmpdir(), `canvas-reporting-test-${suffix}`, 'config.json')
}

function writeConfig(path: string, overrides: Record<string, unknown> = {}) {
  const dir = path.substring(0, path.lastIndexOf('/'))
  mkdirSync(dir, { recursive: true })
  const base = {
    canvas: { instanceUrl: CANVAS_URL, apiToken: 'tok' },
    program: { activeCourseId: COURSE_ID, courseCodes: [], courseCache: {} },
    defaults: { assignmentGroup: 'Assignments', submissionType: 'online_url', pointsPossible: 100 },
    ...overrides,
  }
  writeFileSync(path, JSON.stringify(base), 'utf-8')
}

async function makeTestClient(configPath: string, store?: SecureStore) {
  const secureStore = store ?? new SecureStore()
  const configManager = new ConfigManager(configPath)
  const canvasClient = new CanvasClient({ instanceUrl: CANVAS_URL, apiToken: 'tok' })
  const mcpServer = new McpServer({ name: 'test', version: '0.0.1' })
  const sidecarManager = new SidecarManager('', false)
  registerReportingTools(mcpServer, canvasClient, configManager, secureStore, sidecarManager)

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const mcpClient = new Client({ name: 'test-client', version: '0.0.1' })
  await mcpServer.connect(serverTransport)
  await mcpClient.connect(clientTransport)

  return { mcpClient, configManager, store: secureStore }
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>
type ContentBlock = { type: string; text: string; annotations?: { audience: string[] } }

function getContent(result: ToolResult): ContentBlock[] {
  return result.content as ContentBlock[]
}

/** Parses content[0].text as JSON (blinded data — tokens only, no real names). */
function parseBlindedResult(result: ToolResult) {
  return JSON.parse(getContent(result)[0].text)
}

/** Helper for non-blinded tools that return a single JSON block. */
function parseResult(result: ToolResult) {
  return JSON.parse(getContent(result)[0].text)
}

// ─── get_module_summary ────────────────────────────────────────────────────────

describe('get_module_summary', () => {
  it('returns module metadata and items array', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/modules/10`, () =>
        HttpResponse.json(MOCK_MODULE)
      ),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/modules/10/items`, () =>
        HttpResponse.json(MOCK_ITEMS)
      )
    )
    const { mcpClient } = await makeTestClient(configPath)
    const data = parseResult(
      await mcpClient.callTool({ name: 'get_module_summary', arguments: { module_id: 10 } })
    )
    expect(data.module.id).toBe(10)
    expect(data.items).toHaveLength(3)
  })

  it('maps content_details fields onto items', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/modules/10`, () =>
        HttpResponse.json(MOCK_MODULE)
      ),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/modules/10/items`, () =>
        HttpResponse.json(MOCK_ITEMS)
      )
    )
    const { mcpClient } = await makeTestClient(configPath)
    const data = parseResult(
      await mcpClient.callTool({ name: 'get_module_summary', arguments: { module_id: 10 } })
    )
    const assignment = data.items.find((i: { type: string }) => i.type === 'Assignment')
    expect(assignment.points_possible).toBe(10)
    expect(assignment.due_at).toBe('2026-03-01T23:59:00Z')
  })

  it('fetches assignment description HTML when include_html=true', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/modules/10`, () =>
        HttpResponse.json(MOCK_MODULE)
      ),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/modules/10/items`, () =>
        HttpResponse.json(MOCK_ITEMS)
      ),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/assignments/301`, () =>
        HttpResponse.json({ id: 301, name: 'A', points_possible: 10, due_at: null, html_url: '', description: '<h3>Hello</h3>' })
      )
    )
    const { mcpClient } = await makeTestClient(configPath)
    const data = parseResult(
      await mcpClient.callTool({
        name: 'get_module_summary',
        arguments: { module_id: 10, include_html: true },
      })
    )
    const assignment = data.items.find((i: { type: string }) => i.type === 'Assignment')
    expect(assignment.html).toBe('<h3>Hello</h3>')
  })

  it('does not fetch assignments when include_html is false', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/modules/10`, () =>
        HttpResponse.json(MOCK_MODULE)
      ),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/modules/10/items`, () =>
        HttpResponse.json(MOCK_ITEMS)
      )
    )
    const { mcpClient } = await makeTestClient(configPath)
    const data = parseResult(
      await mcpClient.callTool({ name: 'get_module_summary', arguments: { module_id: 10 } })
    )
    const assignment = data.items.find((i: { type: string }) => i.type === 'Assignment')
    expect(assignment.html).toBeUndefined()
  })
})

// ─── get_grades (scope=class) ─────────────────────────────────────────────────

describe('get_grades — scope=class', () => {
  beforeEach(() => {
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/enrollments`, () =>
        HttpResponse.json(MOCK_ENROLLMENTS)
      ),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () =>
        HttpResponse.json(MOCK_SUBMISSIONS)
      ),
    )
  })

  it('returns blinded student list with grade totals', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'get_grades',
      arguments: { scope: 'class' },
    })
    const blocks = getContent(result)
    // Single blinded block, no audience annotation
    expect(blocks).toHaveLength(1)
    expect(blocks[0].annotations).toBeUndefined()
    // Block: tokens only, no real names
    const data = parseBlindedResult(result)
    expect(data.student_count).toBe(2)
    expect(data.students[0].student).toMatch(/\[STUDENT_\d{3}\]/)
    expect(data.students[0].current_score).toBeDefined()
    expect(data.students[0].missing_count).toBeDefined()
    expect(blocks[0].text).not.toContain('Jane Smith')
    expect(blocks[0].text).not.toContain('Bob Adams')
  })

  it('sorts by engagement (missing DESC)', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'get_grades',
      arguments: { scope: 'class', sort_by: 'engagement' },
    })
    // Bob has 1 missing, Jane has 0 → Bob first
    const data = parseBlindedResult(result)
    expect(data.students[0].missing_count).toBe(1)
    expect(data.students[1].missing_count).toBe(0)
  })

  it('sorts by grade (score ASC)', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'get_grades',
      arguments: { scope: 'class', sort_by: 'grade' },
    })
    // Bob has 60, Jane has 87.4 → Bob first
    const data = parseBlindedResult(result)
    expect(data.students[0].current_score).toBe(60)
    expect(data.students[1].current_score).toBe(87.4)
  })

  it('sorts by zeros (zeros DESC)', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    // Add a submission with score 0 for Jane
    const janeZero = { ...MOCK_SUBMISSIONS[0], score: 0 }
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () =>
        HttpResponse.json([janeZero, MOCK_SUBMISSIONS[1], MOCK_SUBMISSIONS[2]])
      )
    )
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'get_grades',
      arguments: { scope: 'class', sort_by: 'zeros' },
    })
    // Jane has 1 zero, Bob has 0 → Jane first
    const data = parseBlindedResult(result)
    expect(data.students[0].zeros_count).toBe(1)
    expect(data.students[1].zeros_count).toBe(0)
  })

  it('filters by assignment_group_id', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const { mcpClient } = await makeTestClient(configPath)
    const data = parseBlindedResult(await mcpClient.callTool({
      name: 'get_grades',
      arguments: { scope: 'class', assignment_group_id: 999 }, // No subs in this group
    }))
    expect(data.students[0].missing_count).toBe(0)
  })

  it('returns error when no active course is set', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath, { program: { activeCourseId: null, courseCodes: [], courseCache: {} } })
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({ name: 'get_grades', arguments: { scope: 'class' } })
    const text = getContent(result)[0].text
    expect(text).toContain('No active course')
  })
})

// ─── get_grades (scope=class sorting) ─────────────────────────────────────────

describe('get_grades — scope=class sorting', () => {
  it('sorts by engagement with null scores', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)

    const enrollmentsWithNulls = [
      {
        id: 1, user_id: 1001, type: 'StudentEnrollment', enrollment_state: 'active',
        user: { id: 1001, name: 'C Jane Smith', sortable_name: 'Smith, C Jane' },
        grades: { current_score: null, final_score: null, current_grade: null, final_grade: null },
      },
      {
        id: 2, user_id: 1002, type: 'StudentEnrollment', enrollment_state: 'active',
        user: { id: 1002, name: 'B Bob Adams', sortable_name: 'Adams, B Bob' },
        grades: { current_score: 60.0, final_score: 50.0, current_grade: 'D', final_grade: 'F' },
      },
      {
        id: 3, user_id: 1003, type: 'StudentEnrollment', enrollment_state: 'active',
        user: { id: 1003, name: 'A Alice Jones', sortable_name: 'Jones, A Alice' },
        grades: { current_score: null, final_score: null, current_grade: null, final_grade: null },
      },
    ]

    const submissionsForSort = [
      { id: 201, assignment_id: 501, user_id: 1001, score: 9.0, late: false, missing: false, workflow_state: 'graded', assignment: {}, user: {} },
      { id: 202, assignment_id: 501, user_id: 1002, score: 6.0, late: false, missing: false, workflow_state: 'graded', assignment: {}, user: {} },
      { id: 203, assignment_id: 501, user_id: 1003, score: null, late: false, missing: false, workflow_state: 'unsubmitted', assignment: {}, user: {} },
    ]

    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/enrollments`, () =>
        HttpResponse.json(enrollmentsWithNulls)
      ),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () =>
        HttpResponse.json(submissionsForSort)
      ),
    )

    const store = new SecureStore()
    const { mcpClient } = await makeTestClient(configPath, store)
    const result = await mcpClient.callTool({
      name: 'get_grades',
      arguments: { scope: 'class', sort_by: 'engagement' },
    })

    // All have 0 missing, 0 late.
    // Alice and Jane have null scores, Bob has 60.
    // With engagement sort, null scores should come first, Bob (60) last.
    const data = parseBlindedResult(result)
    expect(data.students[0].current_score).toBeNull()
    expect(data.students[1].current_score).toBeNull()
    expect(data.students[2].current_score).toBe(60)
  });

  it('sorts by grade with null scores', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)

    const enrollmentsWithNulls = [
        {
            id: 1, user_id: 1001, type: 'StudentEnrollment', enrollment_state: 'active',
            user: { id: 1001, name: 'C Jane Smith', sortable_name: 'Smith, C Jane' },
            grades: { current_score: 80, final_score: null, current_grade: null, final_grade: null },
        },
        {
            id: 2, user_id: 1002, type: 'StudentEnrollment', enrollment_state: 'active',
            user: { id: 1002, name: 'B Bob Adams', sortable_name: 'Adams, B Bob' },
            grades: { current_score: 60.0, final_score: 50.0, current_grade: 'D', final_grade: 'F' },
        },
        {
            id: 3, user_id: 1003, type: 'StudentEnrollment', enrollment_state: 'active',
            user: { id: 1003, name: 'A Alice Jones', sortable_name: 'Jones, A Alice' },
            grades: { current_score: null, final_score: null, current_grade: null, final_grade: null },
        },
    ]

    mswServer.use(
        http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/enrollments`, () =>
            HttpResponse.json(enrollmentsWithNulls)
        ),
        http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () =>
            HttpResponse.json([])
        ),
    )

    const store = new SecureStore()
    const { mcpClient } = await makeTestClient(configPath, store)
    const result = await mcpClient.callTool({
        name: 'get_grades',
        arguments: { scope: 'class', sort_by: 'grade' },
    })

    // grade sort is score ASC. nulls first, then by score.
    // Order should be Alice (null), Bob (60), Jane (80)
    const data = parseBlindedResult(result)
    expect(data.students[0].current_score).toBeNull()
    expect(data.students[1].current_score).toBe(60)
    expect(data.students[2].current_score).toBe(80)
  })
})

// ─── get_grades (scope=assignment) ───────────────────────────────────────────

describe('get_grades — scope=assignment', () => {
  it('returns blinded submission rows for one assignment', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/assignments/501`, () =>
        HttpResponse.json({
          id: 501, name: 'Assignment A', points_possible: 10,
          due_at: '2026-02-01T23:59:00Z',
          html_url: `${CANVAS_URL}/courses/${COURSE_ID}/assignments/501`,
        })
      ),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/assignments/501/submissions`, () =>
        HttpResponse.json([MOCK_SUBMISSIONS[0], MOCK_SUBMISSIONS[2]])
      ),
    )
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'get_grades',
      arguments: { scope: 'assignment', assignment_id: 501 },
    })
    const blocks = getContent(result)
    // Single blinded block, no audience annotation
    expect(blocks).toHaveLength(1)
    expect(blocks[0].annotations).toBeUndefined()
    // Block: tokens only, no real names
    const data = parseBlindedResult(result)
    expect(data.assignment.id).toBe(501)
    expect(data.submissions).toHaveLength(2)
    expect(data.submissions[0].student).toMatch(/\[STUDENT_\d{3}\]/)
    expect(data.summary.total_students).toBe(2)
    expect(data.summary.missing).toBe(1)
    expect(blocks[0].text).not.toContain('Jane Smith')
    expect(blocks[0].text).not.toContain('Bob Adams')
  })
})

// ─── get_grades (scope=student) ───────────────────────────────────────────────

describe('get_grades — scope=student', () => {
  it('returns full submission history for the resolved student', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const store = new SecureStore()
    const janeToken = store.tokenize(1001, 'Jane Smith')

    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, ({ request }) => {
        const url = new URL(request.url)
        const userId = url.searchParams.get('student_ids[]')
        if (userId === '1001') return HttpResponse.json(MOCK_SUBMISSIONS.filter(s => s.user_id === 1001))
        return HttpResponse.json(MOCK_SUBMISSIONS)
      }),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/enrollments`, () =>
        HttpResponse.json(MOCK_ENROLLMENTS)
      ),
    )

    const { mcpClient } = await makeTestClient(configPath, store)
    const result = await mcpClient.callTool({
      name: 'get_grades',
      arguments: { scope: 'student', student_token: janeToken },
    })
    const blocks = getContent(result)
    // Single blinded block, no audience annotation
    expect(blocks).toHaveLength(1)
    expect(blocks[0].annotations).toBeUndefined()
    // Block: no real names
    const data = parseBlindedResult(result)
    expect(data.student_token).toBe(janeToken)
    expect(data.current_score).toBe(87.4)
    expect(data.assignments.length).toBeGreaterThan(0)
    expect(blocks[0].text).not.toContain('Jane Smith')
  })

  it('returns error for unknown token', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'get_grades',
      arguments: { scope: 'student', student_token: '[STUDENT_999]' },
    })
    const text = getContent(result)[0].text
    expect(text).toContain('Unknown student token')
  })

  it('returns error when student is not in course', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const store = new SecureStore()
    const janeToken = store.tokenize(1001, 'Jane Smith')
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () => {
        return HttpResponse.json(MOCK_SUBMISSIONS.filter(s => s.user_id === 1001))
      }),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/enrollments`, () =>
        HttpResponse.json(MOCK_ENROLLMENTS.filter(e => e.user_id !== 1001))
      ),
    )
    const { mcpClient } = await makeTestClient(configPath, store)
    const result = await mcpClient.callTool({
      name: 'get_grades',
      arguments: { scope: 'student', student_token: janeToken },
    })
    const text = getContent(result)[0].text
    expect(text).toContain('is not enrolled in course')
  })

  it('returns error on Canvas API error', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const store = new SecureStore()
    const janeToken = store.tokenize(1001, 'Jane Smith')
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () => {
        return new HttpResponse(null, { status: 404 })
      }),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/enrollments`, () =>
        HttpResponse.json(MOCK_ENROLLMENTS)
      ),
    )
    const { mcpClient } = await makeTestClient(configPath, store)
    const result = await mcpClient.callTool({
      name: 'get_grades',
      arguments: { scope: 'student', student_token: janeToken },
    })
    const text = getContent(result)[0].text
    expect(text).toContain('is not enrolled in course')
  })
})

// ─── get_submission_status (type=missing) ─────────────────────────────────────

describe('get_submission_status — type=missing', () => {
  it('returns blinded students with missing assignments', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('workflow_state') === 'unsubmitted') {
          return HttpResponse.json(MOCK_SUBMISSIONS.filter(s => s.workflow_state === 'unsubmitted'))
        }
        return HttpResponse.json(MOCK_SUBMISSIONS)
      }),
    )
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'get_submission_status',
      arguments: { type: 'missing' },
    })
    const blocks = getContent(result)
    // Single blinded block, no audience annotation
    expect(blocks).toHaveLength(1)
    expect(blocks[0].annotations).toBeUndefined()
    // Block: tokens only, no real names
    const data = parseBlindedResult(result)
    expect(data.total_missing_submissions).toBe(1)
    expect(data.students).toHaveLength(1)
    expect(data.students[0].student).toMatch(/\[STUDENT_\d{3}\]/)
    expect(data.students[0].missing_count).toBe(1)
    expect(blocks[0].text).not.toContain('Bob Adams')
    expect(blocks[0].text).not.toContain('Jane Smith')
  })

  it('filters missing assignments with since_date', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const missingWithDates = [
      { ...MOCK_SUBMISSIONS[2], assignment: { ...MOCK_SUBMISSIONS[2].assignment, due_at: '2026-01-15T23:59:00Z' } }, // Bob, will be filtered out
      { id: 204, assignment_id: 503, user_id: 1001, score: null, submitted_at: null, late: false, missing: true, workflow_state: 'unsubmitted', assignment: { id: 503, name: 'Assignment C', due_at: '2026-02-15T23:59:00Z' }, user: MOCK_ENROLLMENTS[0].user }, // Jane, will be included
    ]
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () =>
        HttpResponse.json(missingWithDates)
      ),
    )
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'get_submission_status',
      arguments: { type: 'missing', since_date: '2026-02-01' },
    })
    const data = parseBlindedResult(result)
    expect(data.total_missing_submissions).toBe(1)
    expect(data.students).toHaveLength(1)
    // The included assignment should be Assignment C (id=503), not the earlier-due-date one
    expect(data.students[0].missing_assignments[0].assignment_id).toBe(503)
  })

  it('sorts missing assignments with null due dates', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const missingWithNulls = [
      { ...MOCK_SUBMISSIONS[2], assignment: { ...MOCK_SUBMISSIONS[2].assignment, due_at: null } },
      { id: 204, assignment_id: 503, user_id: 1002, score: null, submitted_at: null, late: false, missing: true, workflow_state: 'unsubmitted', assignment: { id: 503, name: 'Assignment C', due_at: '2026-02-15T23:59:00Z' }, user: MOCK_ENROLLMENTS[1].user },
    ]
    mswServer.use(
        http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () =>
            HttpResponse.json(missingWithNulls)
        ),
    )
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
        name: 'get_submission_status',
        arguments: { type: 'missing' },
    })
    const data = parseBlindedResult(result)
    const student = data.students[0]
    // The assignment with the null due date should be last in the list
    expect(student.missing_assignments[1].due_at).toBeNull()
  })

  it('returns error when no active course is set', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath, { program: { activeCourseId: null, courseCodes: [], courseCache: {} } })
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'get_submission_status',
      arguments: { type: 'missing' },
    })
    const text = getContent(result)[0].text
    expect(text).toContain('No active course')
  })
})

// ─── get_submission_status (type=late) ────────────────────────────────────────

describe('get_submission_status — type=late', () => {
  it('returns blinded students with late assignments', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () =>
        HttpResponse.json(MOCK_SUBMISSIONS)
      ),
    )
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'get_submission_status',
      arguments: { type: 'late' },
    })
    const blocks = getContent(result)
    // Single blinded block, no audience annotation
    expect(blocks).toHaveLength(1)
    expect(blocks[0].annotations).toBeUndefined()
    // Block: tokens only, no real names
    const data = parseBlindedResult(result)
    expect(data.total_late_submissions).toBe(1)
    expect(data.students).toHaveLength(1)
    expect(data.students[0].student).toMatch(/\[STUDENT_\d{3}\]/)
    expect(data.students[0].late_count).toBe(1)
    expect(blocks[0].text).not.toContain('Jane Smith')
    expect(blocks[0].text).not.toContain('Bob Adams')
  })

  it('sorts late assignments with null submitted_at dates', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const lateWithNulls = [
        { ...MOCK_SUBMISSIONS[1], submitted_at: null }, // This is an impossible state, but good for testing the sort
        { ...MOCK_SUBMISSIONS[1], id: 205, user_id: 1001, submitted_at: '2026-03-01T10:00:00Z' },
    ]
    mswServer.use(
        http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () =>
            HttpResponse.json(lateWithNulls)
        ),
    )
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
        name: 'get_submission_status',
        arguments: { type: 'late' },
    })
    const data = parseBlindedResult(result)
    const student = data.students[0]
    // The submission with the null submitted_at date should be last in the list
    expect(student.late_assignments[1].submitted_at).toBeNull()
  })
})

// ─── student_pii ──────────────────────────────────────────────────────────────

describe('student_pii — action=resolve', () => {
  it('returns name and canvas_id for a valid token', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const store = new SecureStore()
    const token = store.tokenize(1001, 'Jane Smith')

    const { mcpClient } = await makeTestClient(configPath, store)
    const result = await mcpClient.callTool({
      name: 'student_pii',
      arguments: { action: 'resolve', student_token: token },
    })
    const blocks = getContent(result)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].annotations).toBeUndefined()
    const data = JSON.parse(blocks[0].text)
    expect(data.name).toBe('Jane Smith')
    expect(data.canvas_id).toBe(1001)
    expect(data.student_token).toBe(token)
  })

  it('resolves token without square brackets', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const store = new SecureStore()
    store.tokenize(1001, 'Jane Smith')

    const { mcpClient } = await makeTestClient(configPath, store)
    const result = await mcpClient.callTool({
      name: 'student_pii',
      arguments: { action: 'resolve', student_token: 'STUDENT_001' },
    })
    const blocks = getContent(result)
    expect(blocks).toHaveLength(1)
    const data = JSON.parse(blocks[0].text)
    expect(data.name).toBe('Jane Smith')
    expect(data.canvas_id).toBe(1001)
  })

  it('returns error for unknown token', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'student_pii',
      arguments: { action: 'resolve', student_token: '[STUDENT_999]' },
    })
    const text = getContent(result)[0].text
    expect(text).toContain('Unknown student token')
  })
})

describe('student_pii — action=list', () => {
  it('returns token list', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const store = new SecureStore()
    const t1 = store.tokenize(1001, 'Jane Smith')
    const t2 = store.tokenize(1002, 'Bob Adams')

    const { mcpClient } = await makeTestClient(configPath, store)
    const result = await mcpClient.callTool({
      name: 'student_pii',
      arguments: { action: 'list' },
    })
    const blocks = getContent(result)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].annotations).toBeUndefined()
    const data = JSON.parse(blocks[0].text) as Array<{ token: string }>
    const tokens = data.map(d => d.token)
    expect(tokens).toContain(t1)
    expect(tokens).toContain(t2)
  })

  it('returns empty list when no tokens have been issued', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'student_pii',
      arguments: { action: 'list' },
    })
    const data = JSON.parse(getContent(result)[0].text) as Array<unknown>
    expect(data).toHaveLength(0)
  })
})

// ─── get_module_summary with module_name ─────────────────────────────────────

const MOCK_MODULE_ITEM = {
  id: 103, module_id: 10, position: 1, type: 'Assignment',
  title: 'Week 1 | Assignment 1.1', content_id: 301,
  indent: 0, completion_requirement: { type: 'min_score', min_score: 1 },
  content_details: { points_possible: 10, due_at: '2026-03-01T23:59:00Z' },
}

describe('get_module_summary — module_name', () => {
  beforeEach(() => {
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/modules`, () =>
        HttpResponse.json([MOCK_MODULE])
      ),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/modules/10`, () =>
        HttpResponse.json(MOCK_MODULE)
      ),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/modules/10/items`, () =>
        HttpResponse.json([MOCK_MODULE_ITEM])
      ),
    )
  })

  it('returns module summary when module_name is provided', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const { mcpClient } = await makeTestClient(configPath)
    const data = parseResult(
      await mcpClient.callTool({
        name: 'get_module_summary',
        arguments: { module_name: 'Week 1' },
      })
    )
    expect(data.module.id).toBe(10)
    expect(data.module.name).toBe('Week 1: Introduction')
    expect(data.items).toHaveLength(1)
  })

  it('returns warning when multiple modules match name', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/modules`, () =>
        HttpResponse.json([
          MOCK_MODULE,
          { ...MOCK_MODULE, id: 11, name: 'Week 1: Advanced' }
        ])
      )
    )
    const { mcpClient } = await makeTestClient(configPath)
    const data = parseResult(
      await mcpClient.callTool({
        name: 'get_module_summary',
        arguments: { module_name: 'Week 1' },
      })
    )
    expect(data.warning).toContain('2 modules matched')
    expect(data.module.id).toBe(10)
  })

  it('returns toolError when neither module_id nor module_name is provided', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'get_module_summary',
      arguments: {},
    })
    const text = getContent(result)[0].text
    expect(text).toContain('Provide either module_id or module_name')
  })

  it('returns toolError when module_name does not match', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({
      name: 'get_module_summary',
      arguments: { module_name: 'nonexistent' },
    })
    const text = getContent(result)[0].text
    expect(text).toContain('No module found matching')
  })
})

// ─── FERPA blinding — MCP protocol compliance ─────────────────────────────────
//
// These tests verify the single-block blinding contract:
//   - Only ONE content block is returned (blinded JSON, no audience annotations)
//   - The block contains only [STUDENT_NNN] tokens, no real PII
//
// Audience annotations are intentionally omitted: MCP clients like Gemini CLI
// do not implement audience filtering and either ignore or drop annotated
// content blocks, causing the model to loop because it never sees the tool
// result. Clients wanting real names should use an after_model hook or call
// student_pii(action='resolve').

describe('FERPA blinding — MCP protocol compliance', () => {
  beforeEach(() => {
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/enrollments`, () =>
        HttpResponse.json(MOCK_ENROLLMENTS)
      ),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () =>
        HttpResponse.json(MOCK_SUBMISSIONS)
      ),
    )
  })

  it('exactly one content block, no annotations, tokens only, no real names', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({ name: 'get_grades', arguments: { scope: 'class' } })
    const blocks = getContent(result)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].annotations).toBeUndefined()
    expect(blocks[0].text).toMatch(/\[STUDENT_\d{3}\]/)
    expect(blocks[0].text).not.toContain('Jane Smith')
    expect(blocks[0].text).not.toContain('Bob Adams')
    expect(() => JSON.parse(blocks[0].text)).not.toThrow()
  })

  it('no content block has audience annotations (dropped for MCP client compatibility)', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({ name: 'get_grades', arguments: { scope: 'class' } })

    for (const block of getContent(result)) {
      expect(block.annotations).toBeUndefined()
    }
  })

  it('get_submission_status: single blinded block, no real names', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('workflow_state') === 'unsubmitted') {
          return HttpResponse.json(MOCK_SUBMISSIONS.filter(s => s.workflow_state === 'unsubmitted'))
        }
        return HttpResponse.json(MOCK_SUBMISSIONS)
      }),
    )
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({ name: 'get_submission_status', arguments: { type: 'missing' } })
    const blocks = getContent(result)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].annotations).toBeUndefined()
    expect(blocks[0].text).not.toContain('Bob Adams')
    expect(blocks[0].text).toMatch(/\[STUDENT_\d{3}\]/)
    expect(() => JSON.parse(blocks[0].text)).not.toThrow()
  })

  it('get_grades scope=assignment: single blinded block, no real names', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/assignments/501`, () =>
        HttpResponse.json({ id: 501, name: 'Assignment A', points_possible: 10, due_at: null, html_url: '' })
      ),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/assignments/501/submissions`, () =>
        HttpResponse.json([MOCK_SUBMISSIONS[0], MOCK_SUBMISSIONS[2]])
      ),
    )
    const { mcpClient } = await makeTestClient(configPath)
    const result = await mcpClient.callTool({ name: 'get_grades', arguments: { scope: 'assignment', assignment_id: 501 } })
    const blocks = getContent(result)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].annotations).toBeUndefined()
    expect(blocks[0].text).not.toContain('Jane Smith')
    expect(blocks[0].text).toMatch(/\[STUDENT_\d{3}\]/)
    expect(() => JSON.parse(blocks[0].text)).not.toThrow()
  })

  it('get_grades scope=student: single blinded block, no real names', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const store = new SecureStore()
    const janeToken = store.tokenize(1001, 'Jane Smith')
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('student_ids[]') === '1001') {
          return HttpResponse.json(MOCK_SUBMISSIONS.filter(s => s.user_id === 1001))
        }
        return HttpResponse.json(MOCK_SUBMISSIONS)
      }),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/enrollments`, () =>
        HttpResponse.json(MOCK_ENROLLMENTS)
      ),
    )
    const { mcpClient } = await makeTestClient(configPath, store)
    const result = await mcpClient.callTool({ name: 'get_grades', arguments: { scope: 'student', student_token: janeToken } })
    const blocks = getContent(result)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].annotations).toBeUndefined()
    expect(blocks[0].text).not.toContain('Jane Smith')
    expect(blocks[0].text).toMatch(janeToken)
    expect(() => JSON.parse(blocks[0].text)).not.toThrow()
  })
})

describe('Coverage gaps', () => {
  it('get_grades(scope=class, sort_by=zeros) handles ties', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const enrollments = [
      { id: 1, user_id: 1001, user: { id: 1001, name: 'B Smith', sortable_name: 'Smith, B' }, grades: { current_score: 80 } },
      { id: 2, user_id: 1002, user: { id: 1002, name: 'A Adams', sortable_name: 'Adams, A' }, grades: { current_score: 90 } },
    ]
    const submissions = [
      { id: 1, user_id: 1001, score: 0, missing: false, late: false, workflow_state: 'graded' },
      { id: 2, user_id: 1002, score: 0, missing: false, late: false, workflow_state: 'graded' },
    ]
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/enrollments`, () => HttpResponse.json(enrollments)),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () => HttpResponse.json(submissions))
    )
    // Pre-tokenize to know which token maps to A Adams (user_id 1002)
    const store = new SecureStore()
    const adamsToken = store.tokenize(1002, 'A Adams')
    const { mcpClient } = await makeTestClient(configPath, store)
    const result = await mcpClient.callTool({ name: 'get_grades', arguments: { scope: 'class', sort_by: 'zeros' } })
    // Both have 1 zero, so it should sort by name ASC. Adams first.
    const data = parseBlindedResult(result)
    expect(data.students[0].student).toBe(adamsToken)
  })

  it('get_grades(scope=student) handles non-CanvasApiError', async () => {
    const configPath = makeTmpConfigPath()
    writeConfig(configPath)
    const store = new SecureStore()
    const token = store.tokenize(1001, 'Jane Smith')
    mswServer.use(
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/students/submissions`, () => {
        return Promise.reject(new Error('Network error'))
      }),
      http.get(`${CANVAS_URL}/api/v1/courses/${COURSE_ID}/enrollments`, () => HttpResponse.json(MOCK_ENROLLMENTS))
    )
    const { mcpClient } = await makeTestClient(configPath, store)
    const result = await mcpClient.callTool({ name: 'get_grades', arguments: { scope: 'student', student_token: token } })
    expect(getContent(result)[0].text).toContain('Network error')
  })
})
