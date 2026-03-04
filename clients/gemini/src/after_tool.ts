/**
 * Gemini CLI after_tool hook — progress indicator.
 *
 * Gemini CLI always displays MCP tool result content blocks in the terminal;
 * hooks cannot suppress this. What hooks CAN do is emit a `systemMessage`
 * that appears as a clean summary line in addition to the tool result box.
 *
 * The server now sends only a single blinded content block (no real names),
 * so the terminal display is safe. This hook adds a one-line human-readable
 * summary above/below the tool result box.
 *
 * Returning `{}` on any unrecognised input is a safe no-op.
 */

async function main() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf-8')

  let hookInput: Record<string, unknown>
  try {
    hookInput = JSON.parse(raw)
  } catch {
    process.stdout.write('{}')
    return
  }

  // Extract the first text content block from llmContent and parse the JSON
  const llmContent = (hookInput['tool_response'] as Record<string, unknown> | undefined)?.['llmContent']
  let parsedData: Record<string, unknown> | null = null

  if (Array.isArray(llmContent)) {
    for (const block of llmContent) {
      if (block !== null && typeof block === 'object') {
        const text = (block as Record<string, unknown>)['text']
        if (typeof text === 'string') {
          try { parsedData = JSON.parse(text) } catch { /* not JSON */ }
          if (parsedData !== null) break
        }
      }
    }
  }

  const summary = parsedData !== null ? buildSummary(parsedData) : null
  if (summary === null) {
    process.stdout.write('{}')
    return
  }

  process.stdout.write(JSON.stringify({ systemMessage: `[canvas-mcp] ${summary}` }))
}

function buildSummary(data: Record<string, unknown>): string | null {
  // get_grades scope=class
  if (typeof data['student_count'] === 'number') {
    return `Fetched grades for ${data['student_count']} students.`
  }
  // get_submission_status type=missing
  if (typeof data['total_missing_submissions'] === 'number') {
    return `Found ${data['total_missing_submissions']} missing submissions.`
  }
  // get_submission_status type=late
  if (typeof data['total_late_submissions'] === 'number') {
    return `Found ${data['total_late_submissions']} late submissions.`
  }
  // get_grades scope=student
  if (typeof data['student_token'] === 'string' && Array.isArray(data['assignments'])) {
    return `Fetched ${(data['assignments'] as unknown[]).length} assignments for ${data['student_token']}.`
  }
  // get_grades scope=assignment
  if (data['assignment'] !== null && typeof data['assignment'] === 'object' && Array.isArray(data['submissions'])) {
    const name = (data['assignment'] as Record<string, unknown>)['name']
    const label = typeof name === 'string' ? `"${name}"` : 'assignment'
    return `Fetched ${(data['submissions'] as unknown[]).length} submissions for ${label}.`
  }
  return null
}

main().catch((err) => {
  process.stderr.write(`[canvas-mcp/after_tool] Error: ${(err as Error).message}\n`)
  process.exit(1)
})
