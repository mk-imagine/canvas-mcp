import { describe, it, expect } from 'vitest'
import { renderTemplate, validateItems } from '../../src/templates/index.js'
import { CanvasTeacherConfig } from '../../src/config/schema.js'

const mockConfig: CanvasTeacherConfig = {
  canvas: { instanceUrl: 'https://test.instructure.com', apiToken: 'token' },
  program: { courseCodes: ['CS101'], activeCourseId: 123 },
  defaults: {
    pointsPossible: 10,
    submissionType: 'online_url',
    exitCardPoints: 1,
    assignmentGroup: 'Assignments',
    completionRequirement: 'must_submit',
    minScore: 0.8
  },
  exitCardTemplate: {
    title: 'Week {{week}} | Exit Card',
    quizType: 'assignment',
    questions: []
  },
  assignmentDescriptionTemplate: {
    default: '<a href="{{notebook_url}}">{{notebook_title}}</a><p>{{instructions}}</p>'
  },
  smartSearch: { distanceThreshold: 0.5 }
}

describe('templates', () => {
  describe('later-standard template', () => {
    it('renders subheaders and items correctly', () => {
      const items = [
        { type: 'coding_assignment', title: 'Lab 1', hours: 2, notebook_url: 'https://colab.com' },
        { type: 'download_url', title: 'Data Files', url: 'https://files.com' },
        { type: 'reading_page', title: 'Chapter 1', hours: 1 },
        { type: 'regular_assignment', title: 'HW 1', mins: 30 },
        { type: 'manual_assignment', title: 'Quiz prep', mins: 15 }
      ]
      const results = renderTemplate('later-standard', 1, items, '2026-01-01', mockConfig)
      
      expect(results[0]).toEqual({ kind: 'subheader', title: 'OVERVIEW' })
      expect(results[1]).toEqual({ kind: 'page', title: 'Week 1 | Overview' })
      expect(results[2]).toEqual({ kind: 'subheader', title: 'ASSIGNMENTS' })
      
      // Coding Assignment
      expect(results[3]).toMatchObject({
        kind: 'assignment',
        title: 'Week 1 | Coding Assignment | Lab 1 (2 Hours)',
        description: '<a href="https://colab.com">Lab 1</a><p></p>'
      })
      
      // Download URL
      expect(results[4]).toEqual({
        kind: 'external_url',
        title: 'Data Files',
        url: 'https://files.com'
      })

      // Reading Page
      expect(results[5]).toEqual({
        kind: 'page',
        title: 'Week 1 | Reading & Exercise | Chapter 1 (1 Hour)'
      })

      // Regular Assignment
      expect(results[6]).toMatchObject({
        kind: 'assignment',
        title: 'Week 1 | Assignment | HW 1 (30 min)'
      })

      // Manual Assignment
      expect(results[7]).toMatchObject({
        kind: 'assignment',
        title: 'Week 1 | Manual Assignment | Quiz prep (15 mins)',
        submission_types: ['no_submission']
      })

      expect(results[8]).toEqual({ kind: 'subheader', title: 'WRAP-UP' })
      expect(results[9]).toEqual({ kind: 'exit_card_quiz', week: 1 })
    })
  })

  describe('later-review template', () => {
    it('renders review items correctly', () => {
      const items = [
        { type: 'video_page', title: 'Review Video', mins: 20 },
        { type: 'review_assignment', title: 'Final Prep', hours: 3 },
        { type: 'supplemental_page', title: 'Extra Reading' },
        { type: 'review_quiz', title: 'Mock Exam', hours: 1, attempts: 3, time_limit: 60 }
      ]
      const results = renderTemplate('later-review', 2, items, '2026-01-01', mockConfig)
      
      expect(results).toContainEqual({ kind: 'page', title: 'Week 2 | Review Video Video (~20 mins)' })
      expect(results).toContainEqual({
        kind: 'assignment',
        title: 'Week 2 | Assignment | Final Prep (3 hours)',
        points: 10,
        due_at: '2026-01-01',
        submission_types: ['online_url']
      })
      expect(results).toContainEqual({ kind: 'page', title: 'Week 2 | Extra Reading' })
      expect(results).toContainEqual({
        kind: 'quiz',
        title: 'Week 2 | Mock Exam (1 hour) - Can take 3x',
        points: 10,
        due_at: '2026-01-01',
        quiz_type: 'assignment',
        time_limit: 60,
        allowed_attempts: 3
      })
    })
  })

  describe('earlier-standard template', () => {
    it('renders with auto-generated reminders and videos', () => {
      const items = [
        { type: 'assignment', verb: 'Read', description: 'Chapter 2' },
        { type: 'video_page', title: 'Python Basics', mins: 10 }
      ]
      const results = renderTemplate('earlier-standard', 3, items, '2026-01-01', mockConfig)
      
      expect(results).toContainEqual({
        kind: 'assignment',
        title: 'Week 3 | Assignment 3.1 | Read: Chapter 2',
        points: 10,
        due_at: '2026-01-01',
        submission_types: ['online_url']
      })
      expect(results).toContainEqual({
        kind: 'assignment',
        title: 'Week 3 | Reminder | Attend Weekly Discussion',
        points: 0,
        due_at: '2026-01-01',
        submission_types: ['no_submission']
      })
      expect(results).toContainEqual({ kind: 'subheader', title: 'QUICK ACCESS TO VIDEOS' })
      expect(results).toContainEqual({ kind: 'page', title: 'Video 3a | Python Basics (~10 mins)' })
    })
  })

  describe('earlier-review template', () => {
    it('renders correctly', () => {
      const items = [
        { type: 'assignment', verb: 'Complete', description: 'Review Set' }
      ]
      const results = renderTemplate('earlier-review', 4, items, '2026-01-01', mockConfig)
      expect(results).toContainEqual({
        kind: 'assignment',
        title: 'Week 4 | Assignment 4.1 | Complete: Review Set',
        points: 10,
        due_at: '2026-01-01',
        submission_types: ['online_url']
      })
    })
  })

  describe('validation', () => {
    it('throws error for unknown template', () => {
      expect(() => renderTemplate('unknown' as any, 1, [], '2026', mockConfig)).toThrow('Unknown template')
    })

    it('throws error for unaccepted item type', () => {
      const items = [{ type: 'video_page' }] // video_page not accepted in later-standard
      expect(() => renderTemplate('later-standard', 1, items as any, '2026', mockConfig)).toThrow('not accepted')
    })

    it('validates required fields for various types', () => {
      const tests = [
        { type: 'coding_assignment', items: [{ type: 'coding_assignment' }], error: '"title" is required' },
        { type: 'coding_assignment', items: [{ type: 'coding_assignment', title: 'T' }], error: '"hours" is required' },
        { type: 'download_url', items: [{ type: 'download_url' }], error: '"url" is required' },
        { type: 'reading_page', items: [{ type: 'reading_page', title: 'T' }], error: '"hours" is required' },
        { type: 'regular_assignment', items: [{ type: 'regular_assignment', title: 'T' }], error: '"mins" is required' },
        { type: 'review_quiz', items: [{ type: 'review_quiz', title: 'T', hours: 1 }], error: '"attempts" is required' },
        { type: 'assignment', items: [{ type: 'assignment', verb: 'V' }], error: '"description" is required' }
      ]

      for (const t of tests) {
        // Find a template that accepts this type to test field validation
        const template = t.type === 'assignment' ? 'earlier-standard' : 
                         ['video_page', 'review_assignment', 'supplemental_page', 'review_quiz'].includes(t.type) ? 'later-review' :
                         'later-standard'
        try {
          const result = validateItems(template, t.items as any)
          if (result === null) {
            throw new Error(`Validation unexpectedly passed for type ${t.type} in template ${template}`)
          }
          expect(result).toContain(t.error)
        } catch (err: any) {
          if (err.message.includes('Validation unexpectedly passed')) {
            throw err
          }
          throw err
        }
      }
    })
  })
})
