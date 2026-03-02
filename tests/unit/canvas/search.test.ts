import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../setup/msw-server.js'
import { CanvasClient } from '../../../src/canvas/client.js'
import { smartSearch } from '../../../src/canvas/search.js'

const BASE_URL = 'https://canvas.example.com'
const TOKEN = 'test-token'
const COURSE_ID = 123

function makeClient() {
  return new CanvasClient({ instanceUrl: BASE_URL, apiToken: TOKEN })
}

describe('search', () => {
  it('smartSearch sends correct parameters', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/smartsearch`, ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('q')).toBe('query')
        expect(url.searchParams.getAll('filter[]')).toEqual(['pages'])
        expect(url.searchParams.getAll('include[]')).toEqual(['status'])
        return HttpResponse.json([{ content_id: 1, title: 'Match' }])
      })
    )
    const client = makeClient()
    const results = await smartSearch(client, COURSE_ID, 'query', {
      filter: ['pages'],
      include: ['status']
    })
    expect(results).toHaveLength(1)
  })

  it('smartSearch handles no options', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/smartsearch`, ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('q')).toBe('only-q')
        expect(url.searchParams.has('filter[]')).toBe(false)
        return HttpResponse.json([])
      })
    )
    const client = makeClient()
    await smartSearch(client, COURSE_ID, 'only-q')
  })
})
