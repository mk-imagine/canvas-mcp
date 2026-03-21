/**
 * Gemini CLI AfterTool Hook
 *
 * PURPOSE:
 * 1. Parse tool outputs to generate a concise summary.
 * 2. Inject this summary as a 'systemMessage' to guide the model.
 */

export function buildSummary(toolName: string, data: Record<string, unknown>): string | null {
  // get_submission_status (Missing)
  if (typeof data['total_missing_submissions'] === 'number') {
    return `Found ${data['total_missing_submissions']} missing submissions.`
  }
  // get_submission_status (Late)
  if (typeof data['total_late_submissions'] === 'number') {
    return `Found ${data['total_late_submissions']} late submissions.`
  }
  // get_grades (Class Overview)
  if (typeof data['student_count'] === 'number') {
    return `Fetched grades for ${data['student_count']} students.`
  }
  // get_grades (Specific Student)
  if (Array.isArray(data['assignments']) && typeof data['student_token'] === 'string') {
    return `Fetched ${data['assignments'].length} assignments for ${data['student_token']}.`
  }
  // get_assignments (Course filtered)
  if (Array.isArray(data['assignments']) && typeof data['course_id'] === 'number') {
    return `Found ${data['assignments'].length} assignments for course ${data['course_id']}.`
  }
  // Generic Fallback for Lists
  if (Array.isArray(data['items'])) {
    return `Retrieved ${data['items'].length} items.`
  }
  return null
}

import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DEBUG = process.env['CANVAS_MCP_DEBUG'] === '1'
const DEBUG_LOG = join(homedir(), '.cache', 'canvas-mcp', 'hook-debug.log')

function debugLog(label: string, data: unknown) {
  if (!DEBUG) return
  const ts = new Date().toISOString()
  const line = `[${ts}] ${label}: ${JSON.stringify(data, null, 2)}\n`
  process.stderr.write(`[canvas-mcp/after_tool] ${label}\n`)
  try { appendFileSync(DEBUG_LOG, line) } catch { /* ignore */ }
}

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

  const toolName = hookInput.tool_name
  debugLog('TOOL_CALL', { tool_name: toolName, input_keys: Object.keys(hookInput) })

  if (!toolName) {
    process.stdout.write('{}')
    return
  }

  debugLog('TOOL_INPUT', hookInput.tool_input)
  debugLog('TOOL_RESPONSE', hookInput.tool_response)

  const llmContent = (hookInput.tool_response as Record<string, unknown>)?.llmContent as Record<string, unknown>[] | undefined
  const textPayload = llmContent?.[0]?.text
  if (!textPayload) {
    debugLog('NO_TEXT_PAYLOAD', { llmContent })
    process.stdout.write('{}')
    return
  }

  try {
    const data = JSON.parse(textPayload as string)
    const summary = buildSummary(toolName as string, data)

    debugLog('SUMMARY', { summary })

    if (summary) {
      process.stdout.write(JSON.stringify({
        systemMessage: `[canvas-mcp] ${summary}`
      }))
    } else {
      process.stdout.write('{}')
    }
  } catch {
    process.stdout.write('{}')
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('after_tool.ts')) {
  main().catch((err) => {
    process.stderr.write(`[canvas-mcp/after_tool] Error: ${(err as Error).message}\n`)
    process.exit(1)
  })
}

