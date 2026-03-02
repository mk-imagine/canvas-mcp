import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../setup/msw-server.js'
import { CanvasClient } from '../../../src/canvas/client.js'
import { createRubric, createRubricAssociation, listRubrics } from '../../../src/canvas/rubrics.js'

const BASE_URL = 'https://canvas.example.com'
const TOKEN = 'test-token'
const COURSE_ID = 123

function makeClient() {
  return new CanvasClient({ instanceUrl: BASE_URL, apiToken: TOKEN })
}

describe('rubrics', () => {
  it('createRubric sends correctly formatted criteria', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/courses/${COURSE_ID}/rubrics`, async ({ request }) => {
        const body = await request.json() as any
        expect(body.rubric.criteria['0'].description).toBe('Crit 1')
        expect(body.rubric.criteria['0'].ratings['0'].points).toBe(5)
        return HttpResponse.json({
          rubric: { id: 1, title: 'Test Rubric' },
          rubric_association: { id: 10, rubric_id: 1 }
        })
      })
    )
    const client = makeClient()
    const result = await createRubric(client, COURSE_ID, {
      title: 'Test Rubric',
      assignment_id: 456,
      criteria: [
        {
          description: 'Crit 1',
          points: 5,
          ratings: [{ description: 'Full', points: 5 }]
        }
      ]
    })
    expect(result.rubric.id).toBe(1)
  })

  it('createRubricAssociation handles assignment level', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/courses/${COURSE_ID}/rubric_associations`, async ({ request }) => {
        const body = await request.json() as any
        expect(body.rubric_association.association_type).toBe('Assignment')
        return HttpResponse.json({ rubric_association: { id: 11, rubric_id: 1 } })
      })
    )
    const client = makeClient()
    const result = await createRubricAssociation(client, COURSE_ID, {
      rubric_id: 1,
      assignment_id: 456
    })
    expect(result.id).toBe(11)
  })

  it('createRubricAssociation handles course level', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/courses/${COURSE_ID}/rubric_associations`, async ({ request }) => {
        const body = await request.json() as any
        expect(body.rubric_association.association_type).toBe('Course')
        expect(body.rubric_association.association_id).toBe(COURSE_ID)
        return HttpResponse.json({ rubric_association: { id: 12, rubric_id: 1 } })
      })
    )
    const client = makeClient()
    const result = await createRubricAssociation(client, COURSE_ID, {
      rubric_id: 1
    })
    expect(result.id).toBe(12)
  })

  it('listRubrics returns array', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/rubrics`, () => {
        return HttpResponse.json([{ id: 1, title: 'R1' }])
      })
    )
    const client = makeClient()
    const results = await listRubrics(client, COURSE_ID)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('R1')
  })
})
