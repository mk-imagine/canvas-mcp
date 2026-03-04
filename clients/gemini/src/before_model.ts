/**
 * Gemini CLI before_model hook — input blinding.
 *
 * Reads the PII sidecar and replaces real student names in the outgoing LLM
 * request with their session tokens. If the sidecar does not yet exist (no
 * canvas-mcp tool call has been made this session), the request is passed
 * through unchanged.
 *
 * The hook must return:
 *   { hookSpecificOutput: { hookEventName: "BeforeModel", llm_request: <modified> } }
 *
 * Returning the whole input object (as an earlier version did) is ignored by
 * Gemini CLI — only the hookSpecificOutput wrapper triggers actual replacement.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'


const DEFAULT_SIDECAR_PATH = join(homedir(), '.cache', 'canvas-mcp', 'pii_session.json')
const sidecarPath = process.env['CANVAS_MCP_SIDECAR_PATH'] ?? DEFAULT_SIDECAR_PATH

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

function blindText(text: string, mapping: Record<string, string>): string {
  let result = text
  for (const [key, value] of Object.entries(mapping)) {
    // Only replace name→token pairs (skip token→name pairs)
    if (!key.startsWith('[STUDENT_')) {
      result = result.replaceAll(key, value)
    }
  }
  return result
}

function blindValue(value: unknown, mapping: Record<string, string>): unknown {
  if (typeof value === 'string') return blindText(value, mapping)
  if (Array.isArray(value)) return value.map((v) => blindValue(v, mapping))
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = blindValue(v, mapping)
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
    // No sidecar yet — no names to blind, pass through as no-op
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

  const llmRequest = hookInput['llm_request']
  if (llmRequest === undefined) {
    process.stdout.write('{}')
    return
  }

  const blindedRequest = blindValue(llmRequest, mapping)

  // If nothing changed, return a no-op so Gemini uses the original request unchanged
  const originalJson = JSON.stringify(llmRequest)
  const blindedJson = JSON.stringify(blindedRequest)
  const changed = originalJson !== blindedJson

  if (!changed) {
    process.stdout.write('{}')
    return
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'BeforeModel',
      llm_request: blindedRequest,
    },
  }))
}

main().catch((err) => {
  process.stderr.write(`[canvas-mcp/before_model] Error: ${(err as Error).message}\n`)
  process.exit(1)
})
