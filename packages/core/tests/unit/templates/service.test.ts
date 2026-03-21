import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TemplateService } from '../../../src/templates/service.js'

const fixtureDirs: string[] = []

afterAll(() => {
  for (const dir of fixtureDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createFixture(manifest: object, files?: Record<string, string>): { base: string; service: TemplateService } {
  const base = mkdtempSync(join(tmpdir(), 'ts-test-'))
  fixtureDirs.push(base)
  const templateDir = join(base, 'test-template')
  mkdirSync(templateDir, { recursive: true })
  writeFileSync(join(templateDir, 'manifest.json'), JSON.stringify(manifest))
  if (files) {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(templateDir, name), content)
    }
  }
  return { base, service: new TemplateService(base) }
}

function validManifest(structure: object[]): object {
  return { version: 1, name: 'Test', description: 'A test', structure }
}

// ── _loadAll / constructor ──────────────────────────────────────────────────

describe('TemplateService – loading', () => {
  it('loads nothing when templates dir does not exist', () => {
    const service = new TemplateService('/nonexistent/path')
    expect(service.list()).toEqual([])
  })

  it('skips directories without manifest.json', () => {
    const base = mkdtempSync(join(tmpdir(), 'ts-test-'))
    fixtureDirs.push(base)
    mkdirSync(join(base, 'no-manifest'), { recursive: true })
    const service = new TemplateService(base)
    expect(service.list()).toEqual([])
  })

  it('skips manifest with wrong version', () => {
    const { service } = createFixture({ version: 99, name: 'X', description: 'X', structure: [] })
    expect(service.list()).toEqual([])
  })

  it('skips manifest with invalid JSON', () => {
    const base = mkdtempSync(join(tmpdir(), 'ts-test-'))
    fixtureDirs.push(base)
    const templateDir = join(base, 'bad-json')
    mkdirSync(templateDir, { recursive: true })
    writeFileSync(join(templateDir, 'manifest.json'), 'not json!!!')
    const service = new TemplateService(base)
    expect(service.list()).toEqual([])
  })

  it('skips manifest missing required fields', () => {
    const { service } = createFixture({ version: 1, name: 'X' })
    expect(service.list()).toEqual([])
  })

  it('skips template when body_file reference is missing', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Page', title: 'P', body_file: 'missing.hbs' }])
    )
    expect(service.list()).toEqual([])
  })

  it('skips files in templates dir (non-directories)', () => {
    const base = mkdtempSync(join(tmpdir(), 'ts-test-'))
    fixtureDirs.push(base)
    writeFileSync(join(base, 'stray-file.txt'), 'hello')
    const service = new TemplateService(base)
    expect(service.list()).toEqual([])
  })
})

// ── list ────────────────────────────────────────────────────────────────────

describe('TemplateService – list', () => {
  it('returns descriptor with template_name, name, description', () => {
    const { service } = createFixture(validManifest([]))
    const list = service.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual({
      template_name: 'test-template',
      name: 'Test',
      description: 'A test',
      variables_schema: undefined,
    })
  })

  it('includes variables_schema when present', () => {
    const { service } = createFixture({
      version: 1,
      name: 'T',
      description: 'D',
      variables_schema: { week: { type: 'number', required: true } },
      structure: [],
    })
    expect(service.list()[0].variables_schema).toEqual({
      week: { type: 'number', required: true },
    })
  })
})

// ── render – all item types ─────────────────────────────────────────────────

describe('TemplateService – render', () => {
  it('throws for unknown template name', () => {
    const { service } = createFixture(validManifest([]))
    expect(() => service.render('nonexistent', {})).toThrow(/Unknown template/)
  })

  it('renders SubHeader', () => {
    const { service } = createFixture(
      validManifest([{ type: 'SubHeader', title: 'Week {{week}}' }])
    )
    const result = service.render('test-template', { week: 3 })
    expect(result).toEqual([{ kind: 'subheader', title: 'Week 3' }])
  })

  it('renders Page with body_file', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Page', title: 'Overview', body_file: 'page.hbs' }]),
      { 'page.hbs': '<h1>Week {{week}}</h1>' }
    )
    const result = service.render('test-template', { week: 2 })
    expect(result).toEqual([{ kind: 'page', title: 'Overview', body: '<h1>Week 2</h1>' }])
  })

  it('renders Page without body_file', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Page', title: 'Empty' }])
    )
    const result = service.render('test-template', {})
    expect(result).toEqual([{ kind: 'page', title: 'Empty', body: undefined }])
  })

  it('renders Assignment with body_file', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Assignment', title: 'HW {{week}}', points: 10, body_file: 'body.hbs' }]),
      { 'body.hbs': '<p>Hello {{name}}</p>' }
    )
    const result = service.render('test-template', { week: 5, name: 'World', due_date: '2026-01-15' })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'assignment',
      title: 'HW 5',
      points: 10,
      due_at: '2026-01-15',
      description: '<p>Hello World</p>',
    })
  })

  it('renders Assignment without body_file — description is undefined', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Assignment', title: 'HW', points: 10 }])
    )
    const result = service.render('test-template', { due_date: '2026-02-01' })
    expect((result[0] as any).description).toBeUndefined()
  })

  it('renders Assignment with string points (Handlebars expression)', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Assignment', title: 'HW', points: '{{pts}}' }])
    )
    const result = service.render('test-template', { pts: 25, due_date: '2026-01-01' })
    expect((result[0] as any).points).toBe(25)
  })

  it('renders Assignment with NaN string points as 0', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Assignment', title: 'HW', points: '{{pts}}' }])
    )
    const result = service.render('test-template', { pts: 'not-a-number', due_date: '2026-01-01' })
    expect((result[0] as any).points).toBe(0)
  })

  it('renders Assignment with no points as 0', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Assignment', title: 'HW' }])
    )
    const result = service.render('test-template', { due_date: '2026-01-01' })
    expect((result[0] as any).points).toBe(0)
  })

  it('renders Assignment with custom submission_types', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Assignment', title: 'HW', points: 5, submission_types: ['online_upload'] }])
    )
    const result = service.render('test-template', { due_date: '2026-01-01' })
    expect((result[0] as any).submission_types).toEqual(['online_upload'])
  })

  it('renders Quiz with questions', () => {
    const { service } = createFixture(
      validManifest([{
        type: 'Quiz',
        title: 'Quiz {{week}}',
        points: 5,
        quiz_type: 'graded_survey',
        time_limit: 10,
        allowed_attempts: 2,
        questions: [
          { question_text: 'Q1?', question_name: 'First', question_type: 'multiple_choice_question' },
          { question_text: 'Q2?' },
        ],
      }])
    )
    const result = service.render('test-template', { week: 1, due_date: '2026-03-01' })
    expect(result).toHaveLength(1)
    const quiz = result[0] as any
    expect(quiz.kind).toBe('quiz')
    expect(quiz.title).toBe('Quiz 1')
    expect(quiz.points).toBe(5)
    expect(quiz.quiz_type).toBe('graded_survey')
    expect(quiz.time_limit).toBe(10)
    expect(quiz.allowed_attempts).toBe(2)
    expect(quiz.questions).toHaveLength(2)
    expect(quiz.questions[0]).toEqual({
      question_name: 'First',
      question_text: 'Q1?',
      question_type: 'multiple_choice_question',
    })
    expect(quiz.questions[1]).toEqual({
      question_name: 'Question 2',
      question_text: 'Q2?',
      question_type: 'essay_question',
    })
  })

  it('renders Quiz with string points', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Quiz', title: 'Q', points: '{{pts}}' }])
    )
    const result = service.render('test-template', { pts: 15, due_date: '2026-01-01' })
    expect((result[0] as any).points).toBe(15)
  })

  it('renders Quiz with default quiz_type', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Quiz', title: 'Q', points: 5 }])
    )
    const result = service.render('test-template', { due_date: '2026-01-01' })
    expect((result[0] as any).quiz_type).toBe('assignment')
  })

  it('renders ExternalUrl', () => {
    const { service } = createFixture(
      validManifest([{ type: 'ExternalUrl', title: 'Link', url: 'https://example.com/{{id}}' }])
    )
    const result = service.render('test-template', { id: 42 })
    expect(result).toEqual([{ kind: 'external_url', title: 'Link', url: 'https://example.com/42' }])
  })

  it('renders for_each loop', () => {
    const { service } = createFixture(
      validManifest([{
        type: 'Assignment',
        title: '{{item.name}}',
        points: 10,
        for_each: 'assignments',
      }])
    )
    const result = service.render('test-template', {
      due_date: '2026-01-01',
      assignments: [{ name: 'HW1' }, { name: 'HW2' }],
    })
    expect(result).toHaveLength(2)
    expect((result[0] as any).title).toBe('HW1')
    expect((result[1] as any).title).toBe('HW2')
  })

  it('throws when for_each key is not an array', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Page', title: 'P', for_each: 'items' }])
    )
    expect(() => service.render('test-template', { items: 'not-array' })).toThrow(/not an array/)
  })

  it('ignores unknown item types', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Unknown' as any, title: 'X' }])
    )
    const result = service.render('test-template', {})
    expect(result).toEqual([])
  })
})

// ── renderFile ──────────────────────────────────────────────────────────────

describe('TemplateService – renderFile', () => {
  it('renders a single body file with variables', () => {
    const { service } = createFixture(
      validManifest([{ type: 'Page', title: 'P', body_file: 'page.hbs' }]),
      { 'page.hbs': 'Hello {{who}}!' }
    )
    expect(service.renderFile('test-template', 'page.hbs', { who: 'World' })).toBe('Hello World!')
  })

  it('throws for unknown template', () => {
    const { service } = createFixture(validManifest([]))
    expect(() => service.renderFile('nope', 'f.hbs', {})).toThrow(/Unknown template/)
  })

  it('throws for unknown body file', () => {
    const { service } = createFixture(validManifest([]))
    expect(() => service.renderFile('test-template', 'nope.hbs', {})).toThrow(/not found/)
  })
})
