/**
 * Debug-Instrumented BeforeModel Hook
 */
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Debug Setup
const LOG_FILE = join(homedir(), 'beforemodel-hook-test.txt')
function log(message: string) {
  try {
    const timestamp = new Date().toISOString()
    appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`)
  } catch (e) {
    // Ignore logging errors to prevent breaking the hook
  }
}

// Original Logic Constants
const DEFAULT_SIDECAR_PATH = join(homedir(), '.cache', 'canvas-mcp', 'pii_session.json')
const sidecarPath = process.env['CANVAS_MCP_SIDECAR_PATH'] ?? DEFAULT_SIDECAR_PATH

interface SidecarFile {
  session_id: string
  last_updated: string
  mapping: Record<string, string>
}

function loadMapping(): Record<string, string> | null {
  log(`Attempting to load sidecar from: ${sidecarPath}`)
  if (!existsSync(sidecarPath)) {
    log('Sidecar file does not exist.')
    return null
  }
  try {
    const content = readFileSync(sidecarPath, 'utf-8')
    const data = JSON.parse(content) as SidecarFile
    log(`Sidecar loaded. Mapping keys: ${Object.keys(data.mapping).length}`)
    return data.mapping
  } catch (e) {
    log(`Error reading sidecar: ${(e as Error).message}`)
    return null
  }
}

function blindText(text: string, mapping: Record<string, string>): string {
  let result = text
  for (const [key, value] of Object.entries(mapping)) {
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
  log('--- Hook Started ---')
  
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf-8')
  log(`Received input size: ${raw.length}`)

  const mapping = loadMapping()
  if (mapping === null) {
    log('No mapping available. Passing through.')
    process.stdout.write('{}')
    return
  }

  let hookInput: Record<string, unknown>
  try {
    hookInput = JSON.parse(raw)
  } catch (e) {
    log(`JSON Parse Error: ${(e as Error).message}`)
    process.stdout.write('{}')
    return
  }

  const llmRequest = hookInput['llm_request']
  if (llmRequest === undefined) {
    log('No llm_request found in input.')
    process.stdout.write('{}')
    return
  }

  const blindedRequest = blindValue(llmRequest, mapping)

  const originalJson = JSON.stringify(llmRequest)
  const blindedJson = JSON.stringify(blindedRequest)
  const changed = originalJson !== blindedJson

  if (!changed) {
    log('No PII found to blind. Passing through.')
    process.stdout.write('{}')
    return
  }

  log('PII detected and blinded. Sending modified request.')
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'BeforeModel',
      llm_request: blindedRequest,
    },
  }))
}

main().catch((err) => {
  log(`FATAL ERROR: ${(err as Error).message}`)
  process.stderr.write(`[canvas-mcp/before_model] Error: ${(err as Error).message}\n`)
  process.exit(1)
})