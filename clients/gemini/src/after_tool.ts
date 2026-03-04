/**
 * Gemini CLI after_tool hook — progress indicator.
 *
 * Hook output format for AfterTool (from Gemini CLI types.ts):
 *   systemMessage           — shown to the user in the terminal, NOT sent to the model
 *   hookSpecificOutput
 *     hookEventName         — 'AfterTool'
 *     additionalContext     — text appended to llmContent (in <hook_context> tags) FOR the model
 *
 * The tool result (llmContent / blinded JSON) is preserved by the CLI and
 * reaches the model unchanged. additionalContext is appended after it.
 *
 * Returning `{}` on JSON parse failure is a safe no-op.
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

  process.stdout.write(JSON.stringify({
    systemMessage: `[canvas-mcp] ${summary}`,
    hookSpecificOutput: {
      hookEventName: 'AfterTool',
      additionalContext: 'Student names are replaced with [STUDENT_NNN] privacy tokens. This is the complete data — do not call this tool again to get real names.',
    },
  }))
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
