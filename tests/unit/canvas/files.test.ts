import { describe, it, expect, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../setup/msw-server.js'
import { CanvasClient } from '../../../src/canvas/client.js'
import { uploadFile, listFiles, deleteFile } from '../../../src/canvas/files.js'
import * as fs from 'node:fs'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => Buffer.from('test content')),
  statSync: vi.fn(() => ({ size: 12 })),
}))

const BASE_URL = 'https://canvas.example.com'
const TOKEN = 'test-token'
const COURSE_ID = 123

function makeClient() {
  return new CanvasClient({ instanceUrl: BASE_URL, apiToken: TOKEN })
}

describe('files', () => {
  describe('uploadFile', () => {
    it('handles the 3-step upload process with redirect', async () => {
      const UPLOAD_URL = 'https://s3.example.com/upload'
      const SUCCESS_URL = `${BASE_URL}/api/v1/success`

      // Step 1 mock
      server.use(
        http.post(`${BASE_URL}/api/v1/courses/${COURSE_ID}/files`, () => {
          return HttpResponse.json({
            upload_url: UPLOAD_URL,
            upload_params: { key: 'value' }
          })
        }),
        // Step 2 mock (external S3-like)
        http.post(UPLOAD_URL, () => {
          return new HttpResponse(null, {
            status: 303,
            headers: { Location: SUCCESS_URL }
          })
        }),
        // Step 3 mock
        http.get(SUCCESS_URL, () => {
          return HttpResponse.json({ id: 99, filename: 'test.txt' })
        })
      )

      const client = makeClient()
      const file = await uploadFile(client, COURSE_ID, { file_path: 'test.txt' })
      expect(file.id).toBe(99)
    })

    it('handles direct response in Step 2', async () => {
      const UPLOAD_URL = 'https://s3.example.com/direct'
      server.use(
        http.post(`${BASE_URL}/api/v1/courses/${COURSE_ID}/files`, () => {
          return HttpResponse.json({
            upload_url: UPLOAD_URL,
            upload_params: {}
          })
        }),
        http.post(UPLOAD_URL, () => {
          return HttpResponse.json({ id: 100, filename: 'direct.txt' })
        })
      )

      const client = makeClient()
      const file = await uploadFile(client, COURSE_ID, { file_path: 'direct.txt' })
      expect(file.id).toBe(100)
    })

    it('includes parent_folder_path when provided', async () => {
      let capturedBody: any = null
      server.use(
        http.post(`${BASE_URL}/api/v1/courses/${COURSE_ID}/files`, async ({ request }) => {
          capturedBody = await request.json()
          return HttpResponse.json({ upload_url: 'https://s3.com', upload_params: {} })
        }),
        http.post('https://s3.com', () => {
          return HttpResponse.json({ id: 101 })
        })
      )
      const client = makeClient()
      await uploadFile(client, COURSE_ID, { file_path: 'test.txt', folder_path: 'course files/week1' })
      expect(capturedBody.parent_folder_path).toBe('course files/week1')
    })

    it('throws error if Step 2 fail', async () => {
      server.use(
        http.post(`${BASE_URL}/api/v1/courses/${COURSE_ID}/files`, () => {
          return HttpResponse.json({ upload_url: 'https://fail.com', upload_params: {} })
        }),
        http.post('https://fail.com', () => {
          return new HttpResponse(null, { status: 500 })
        })
      )
      const client = makeClient()
      await expect(uploadFile(client, COURSE_ID, { file_path: 'error.txt' })).rejects.toThrow('File upload failed: 500')
    })

    it('throws error if Step 2 redirect is missing Location', async () => {
      const UPLOAD_URL = 'https://no-loc.com/upload'
      server.use(
        http.post(`${BASE_URL}/api/v1/courses/${COURSE_ID}/files`, () => {
          return HttpResponse.json({ upload_url: UPLOAD_URL, upload_params: {} })
        }),
        http.post(UPLOAD_URL, () => {
          return new HttpResponse(null, { status: 301 })
        })
      )
      const client = makeClient()
      await expect(uploadFile(client, COURSE_ID, { file_path: 'err.txt' })).rejects.toThrow('missing Location header')
    })

    it('throws error if Step 3 confirms with non-ok status', async () => {
      const UPLOAD_URL = 'https://confirm-fail.com/upload'
      const FAIL_CONFIRM_URL = `${BASE_URL}/api/v1/fail-confirm`
      server.use(
        http.post(`${BASE_URL}/api/v1/courses/${COURSE_ID}/files`, () => {
          return HttpResponse.json({ upload_url: UPLOAD_URL, upload_params: {} })
        }),
        http.post(UPLOAD_URL, () => {
          return new HttpResponse(null, { status: 301, headers: { Location: FAIL_CONFIRM_URL } })
        }),
        http.get(FAIL_CONFIRM_URL, () => {
          return new HttpResponse(null, { status: 401 })
        })
      )
      const client = makeClient()
      await expect(uploadFile(client, COURSE_ID, { file_path: 'err.txt' })).rejects.toThrow('confirmation failed: 401')
    })
  })

  it('listFiles returns array', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/courses/${COURSE_ID}/files`, () => {
        return HttpResponse.json([{ id: 1, filename: 'f1.txt' }])
      })
    )
    const client = makeClient()
    const results = await listFiles(client, COURSE_ID)
    expect(results).toHaveLength(1)
  })

  it('deleteFile calls delete', async () => {
    let deletedId = 0
    server.use(
      http.delete(`${BASE_URL}/api/v1/files/:id`, ({ params }) => {
        deletedId = parseInt(params.id as string)
        return new HttpResponse(null, { status: 204 })
      })
    )
    const client = makeClient()
    await deleteFile(client, 12345)
    expect(deletedId).toBe(12345)
  })
})
