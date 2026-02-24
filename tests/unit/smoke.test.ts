import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../setup/msw-server.js'

describe('unit test framework', () => {
  it('runs basic assertions', () => {
    expect(1 + 1).toBe(2)
  })

  it('intercepts HTTP requests via msw', async () => {
    server.use(
      http.get('https://canvas.instructure.com/api/v1/courses', () =>
        HttpResponse.json([{ id: 1, name: 'TEST SANDBOX' }])
      )
    )

    const response = await fetch('https://canvas.instructure.com/api/v1/courses')
    const data = (await response.json()) as Array<{ id: number; name: string }>

    expect(response.ok).toBe(true)
    expect(data).toHaveLength(1)
    expect(data[0].name).toBe('TEST SANDBOX')
  })
})
