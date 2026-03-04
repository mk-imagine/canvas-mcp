/**
 * Gemini CLI after_model hook — output unblinding.
 *
 * Reads the PII sidecar and replaces [STUDENT_NNN] tokens in the model's
 * response with real student names before displaying to the user.
 *
 * The hook must return:
 *   { hookSpecificOutput: { hookEventName: "AfterModel", llm_response: <modified> } }
 *
 * Returning the whole input object (as an earlier version did) is ignored by
 * Gemini CLI — only the hookSpecificOutput wrapper triggers actual replacement.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DEFAULT_SIDECAR_PATH = join(homedir(), '.cache', 'canvas-mcp', 'pii_session.json')
const sidecarPath = process.env['CANVAS_MCP_SIDECAR_PATH'] ?? DEFAULT_SIDECAR_PATH

const TOKEN_PATTERN = /\[STUDENT_\d{3}\]/g

interface SidecarFile {
  session_id: string
  last_updated: string
  mapping: Record<string, string>
}

function loadMapping(): Record<string, string> | null {
  if (!existsSync(sidecarPath)) return null
  try {
    const data = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as SidecarFile
    return data.mapping
  } catch {
    return null
  }
}

function unblindText(text: string, mapping: Record<string, string>): string {
  return text.replaceAll(TOKEN_PATTERN, (token) => mapping[token] ?? token)
}

function unblindValue(value: unknown, mapping: Record<string, string>): unknown {
  if (typeof value === 'string') return unblindText(value, mapping)
  if (Array.isArray(value)) return value.map((v) => unblindValue(v, mapping))
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = unblindValue(v, mapping)
    }
    return result
  }
  return value
}

async function main() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf-8')

  const mapping = loadMapping()
  if (mapping === null) {
    // No sidecar — no tokens to unblind, pass through as no-op
    process.stdout.write('{}')
    return
  }

  let hookInput: Record<string, unknown>
  try {
    hookInput = JSON.parse(raw)
  } catch {
    process.stdout.write('{}')
    return
  }

  const llmResponse = hookInput['llm_response']
  if (llmResponse === undefined) {
    process.stdout.write('{}')
    return
  }

  const unblindedResponse = unblindValue(llmResponse, mapping)

  // If nothing changed, return a no-op
  if (JSON.stringify(llmResponse) === JSON.stringify(unblindedResponse)) {
    process.stdout.write('{}')
    return
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'AfterModel',
      llm_response: unblindedResponse,
    },
  }))
}

main().catch((err) => {
  process.stderr.write(`[canvas-mcp/after_model] Error: ${(err as Error).message}\n`)
  process.exit(1)
})
