import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../setup/msw-server.js'
import { CanvasClient, CanvasApiError } from '../../../src/canvas/client.js'

const BASE_URL = 'https://canvas.example.com'
const TOKEN = 'test-token'

function makeClient() {
  return new CanvasClient({ instanceUrl: BASE_URL, apiToken: TOKEN })
}

describe('CanvasClient', () => {
  describe('get() — pagination', () => {
    it('follows Link headers across multiple pages', async () => {
      let page = 0
      server.use(
        http.get(`${BASE_URL}/api/v1/items`, ({ request }) => {
          const url = new URL(request.url)
          const p = url.searchParams.get('page') ?? '1'
          page = parseInt(p)
          if (page === 1) {
            return new HttpResponse(JSON.stringify([{ id: 1 }, { id: 2 }]), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                link: `<${BASE_URL}/api/v1/items?page=2>; rel="next"`,
              },
            })
          }
          return new HttpResponse(JSON.stringify([{ id: 3 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        })
      )

      const client = makeClient()
      const results = await client.get('/api/v1/items')
      expect(results).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    })

    it('stops at last page (no rel="next")', async () => {
      let callCount = 0
      server.use(
        http.get(`${BASE_URL}/api/v1/items`, () => {
          callCount++
          return HttpResponse.json([{ id: 1 }])
        })
      )

      const client = makeClient()
      const results = await client.get('/api/v1/items')
      expect(results).toEqual([{ id: 1 }])
      expect(callCount).toBe(1)
    })
  })

  describe('get() — rate limiting', () => {
    it('adds ≥500ms delay when X-Rate-Limit-Remaining < 10', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/slow`, () => {
          return new HttpResponse(JSON.stringify([{ id: 1 }]), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-Rate-Limit-Remaining': '5',
            },
          })
        })
      )

      const client = makeClient()
      const start = Date.now()
      await client.get('/api/v1/slow')
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(500)
    })
  })

  describe('get() — 429 retry', () => {
    it('succeeds on 2nd attempt after 429', async () => {
      let calls = 0
      server.use(
        http.get(`${BASE_URL}/api/v1/retry`, () => {
          calls++
          if (calls === 1) {
            return new HttpResponse(null, { status: 429 })
          }
          return HttpResponse.json([{ id: 42 }])
        })
      )

      const client = makeClient()
      // Speed up by mocking setTimeout
      const results = await client.get('/api/v1/retry')
      expect(results).toEqual([{ id: 42 }])
      expect(calls).toBe(2)
    })

    it('throws CanvasApiError after 3 consecutive 429s', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/always429`, () => {
          return new HttpResponse(null, { status: 429 })
        })
      )

      const client = makeClient()
      await expect(client.get('/api/v1/always429')).rejects.toThrow(CanvasApiError)
    })
  })

  describe('error normalization', () => {
    it('throws CanvasApiError with correct status and canvasMessage on 404', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/missing`, () => {
          return HttpResponse.json(
            { errors: [{ message: 'The specified resource does not exist.' }] },
            { status: 404 }
          )
        })
      )

      const client = makeClient()
      try {
        await client.get('/api/v1/missing')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(CanvasApiError)
        const apiErr = err as CanvasApiError
        expect(apiErr.status).toBe(404)
        expect(apiErr.canvasMessage).toBe('The specified resource does not exist.')
      }
    })
  })

  describe('post()', () => {
    it('accepts 200 as success', async () => {
      server.use(
        http.post(`${BASE_URL}/api/v1/quizzes`, () => {
          return HttpResponse.json({ id: 1, quiz_type: 'graded_survey' }, { status: 200 })
        })
      )

      const client = makeClient()
      const result = await client.post('/api/v1/quizzes', { quiz: { title: 'test' } })
      expect((result as { id: number }).id).toBe(1)
    })

    it('accepts 201 as success', async () => {
      server.use(
        http.post(`${BASE_URL}/api/v1/assignments`, () => {
          return HttpResponse.json({ id: 2 }, { status: 201 })
        })
      )

      const client = makeClient()
      const result = await client.post('/api/v1/assignments', { assignment: { name: 'hw1' } })
      expect((result as { id: number }).id).toBe(2)
    })
  })
})
