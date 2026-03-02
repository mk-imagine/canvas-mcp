import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../setup/msw-server.js'
import { CanvasClient } from '../../../src/canvas/client.js'
import { getPage, updatePage, deletePage, listPages, searchPages } from '../../../src/canvas/pages.js'

const BASE_URL = 'https://canvas.example.com'
const TOKEN = 'test-token'
const COURSE_ID = 123

function makeClient() {
  return new CanvasClient({ instanceUrl: BASE_URL, apiToken: TOKEN })
}

describe('pages', () => {
  const mockPages = [
    { page_id: 1, url: 'page-1', title: 'Page 1' },
    { page_id: 2, url: 'page-2', title: 'Page 2' },
  ]

  describe('resolvePageUrl', () => {
    it('uses slug directly if it contains letters', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/pages/some-slug`, () => {
          return HttpResponse.json({ page_id: 1, url: 'some-slug', title: 'Title' })
        })
      )
      const client = makeClient()
      const page = await getPage(client, COURSE_ID, 'some-slug')
      expect(page.url).toBe('some-slug')
    })

    it('resolves numeric ID to slug', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/pages`, () => {
          return HttpResponse.json(mockPages)
        }),
        http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/pages/page-2`, () => {
          return HttpResponse.json(mockPages[1])
        })
      )
      const client = makeClient()
      const page = await getPage(client, COURSE_ID, 2)
      expect(page.url).toBe('page-2')
      expect(page.page_id).toBe(2)
    })

    it('resolves numeric string to slug', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/pages`, () => {
          return HttpResponse.json(mockPages)
        }),
        http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/pages/page-1`, () => {
          return HttpResponse.json(mockPages[0])
        })
      )
      const client = makeClient()
      const page = await getPage(client, COURSE_ID, '1')
      expect(page.url).toBe('page-1')
    })

    it('throws error if numeric ID not found', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/pages`, () => {
          return HttpResponse.json(mockPages)
        })
      )
      const client = makeClient()
      await expect(getPage(client, COURSE_ID, 999)).rejects.toThrow('Page with ID 999 not found')
    })
  })

  describe('CRUD operations', () => {
    it('updatePage uses resolved slug', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/pages`, () => {
          return HttpResponse.json(mockPages)
        }),
        http.put(`${BASE_URL}/api/v1/courses/${COURSE_ID}/pages/page-1`, async ({ request }) => {
          const body = await request.json() as any
          return HttpResponse.json({ ...mockPages[0], title: body.wiki_page.title })
        })
      )
      const client = makeClient()
      const page = await updatePage(client, COURSE_ID, 1, { title: 'New Title' })
      expect(page.title).toBe('New Title')
    })

    it('deletePage uses resolved slug', async () => {
      let deletedSlug = ''
      server.use(
        http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/pages`, () => {
          return HttpResponse.json(mockPages)
        }),
        http.delete(`${BASE_URL}/api/v1/courses/${COURSE_ID}/pages/:slug`, ({ params }) => {
          deletedSlug = params.slug as string
          return new HttpResponse(null, { status: 204 })
        })
      )
      const client = makeClient()
      await deletePage(client, COURSE_ID, 2)
      expect(deletedSlug).toBe('page-2')
    })
  })

  describe('searchPages', () => {
    it('calls API with search_term', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/pages`, ({ request }) => {
          const url = new URL(request.url)
          if (url.searchParams.get('search_term') === 'test') {
            return HttpResponse.json([mockPages[0]])
          }
          return HttpResponse.json([])
        })
      )
      const client = makeClient()
      const results = await searchPages(client, COURSE_ID, 'test')
      expect(results).toHaveLength(1)
      expect(results[0].page_id).toBe(1)
    })
  })
})
