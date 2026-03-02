import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../setup/msw-server.js'
import { CanvasClient } from '../../../src/canvas/client.js'
import { 
  createQuiz, 
  updateQuiz, 
  createQuizQuestion, 
  listQuizzes, 
  getQuiz, 
  listQuizQuestions, 
  deleteQuiz 
} from '../../../src/canvas/quizzes.js'

const BASE_URL = 'https://canvas.example.com'
const TOKEN = 'test-token'
const COURSE_ID = 123
const QUIZ_ID = 456

function makeClient() {
  return new CanvasClient({ instanceUrl: BASE_URL, apiToken: TOKEN })
}

describe('quizzes', () => {
  it('createQuiz sends correct body', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/courses/${COURSE_ID}/quizzes`, async ({ request }) => {
        const body = await request.json() as any
        expect(body.quiz.title).toBe('New Quiz')
        return HttpResponse.json({ id: QUIZ_ID, title: 'New Quiz' })
      })
    )
    const client = makeClient()
    const result = await createQuiz(client, COURSE_ID, { title: 'New Quiz', quiz_type: 'assignment' })
    expect(result.id).toBe(QUIZ_ID)
  })

  it('updateQuiz sends correct body', async () => {
    server.use(
      http.put(`${BASE_URL}/api/v1/courses/${COURSE_ID}/quizzes/${QUIZ_ID}`, async ({ request }) => {
        const body = await request.json() as any
        expect(body.quiz.published).toBe(true)
        return HttpResponse.json({ id: QUIZ_ID, published: true })
      })
    )
    const client = makeClient()
    const result = await updateQuiz(client, COURSE_ID, QUIZ_ID, { published: true })
    expect(result.published).toBe(true)
  })

  it('createQuizQuestion sends correct body', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/courses/${COURSE_ID}/quizzes/${QUIZ_ID}/questions`, async ({ request }) => {
        const body = await request.json() as any
        expect(body.question.question_name).toBe('Q1')
        return HttpResponse.json({ id: 789, question_name: 'Q1' })
      })
    )
    const client = makeClient()
    const result = await createQuizQuestion(client, COURSE_ID, QUIZ_ID, {
      question_name: 'Q1',
      question_text: 'Text',
      question_type: 'multiple_choice_question'
    })
    expect(result.id).toBe(789)
  })

  it('listQuizzes returns array', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/quizzes`, () => {
        return HttpResponse.json([{ id: QUIZ_ID, title: 'Q' }])
      })
    )
    const client = makeClient()
    const result = await listQuizzes(client, COURSE_ID)
    expect(result).toHaveLength(1)
  })

  it('getQuiz returns single quiz', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/quizzes/${QUIZ_ID}`, () => {
        return HttpResponse.json({ id: QUIZ_ID, title: 'Q' })
      })
    )
    const client = makeClient()
    const result = await getQuiz(client, COURSE_ID, QUIZ_ID)
    expect(result.id).toBe(QUIZ_ID)
  })

  it('listQuizQuestions returns array', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/quizzes/${QUIZ_ID}/questions`, () => {
        return HttpResponse.json([{ id: 789, question_name: 'Q1' }])
      })
    )
    const client = makeClient()
    const result = await listQuizQuestions(client, COURSE_ID, QUIZ_ID)
    expect(result).toHaveLength(1)
  })

  it('deleteQuiz calls delete', async () => {
    let deleted = false
    server.use(
      http.delete(`${BASE_URL}/api/v1/courses/${COURSE_ID}/quizzes/${QUIZ_ID}`, () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      })
    )
    const client = makeClient()
    await deleteQuiz(client, COURSE_ID, QUIZ_ID)
    expect(deleted).toBe(true)
  })
})
