/**
 * Instrumented Buffered AfterModel Hook.
 *
 * Logic: Buffers partial tokens to handle stream splitting.
 * Debug: Logs buffer usage and replacements to 'aftermodel-hook-test.txt'.
 */

import { readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// --- Configuration ---
const DEFAULT_SIDECAR_PATH = join(homedir(), '.cache', 'canvas-mcp', 'pii_session.json')
const BUFFER_PATH = join(homedir(), '.cache', 'canvas-mcp', 'pii_buffer.txt')
const LOG_FILE = join(homedir(), 'aftermodel-hook-test.txt')

const sidecarPath = process.env['CANVAS_MCP_SIDECAR_PATH'] ?? DEFAULT_SIDECAR_PATH

// Regex to find complete tokens for replacement
const TOKEN_PATTERN = /\[STUDENT_\d{3}\]/g

// Regex to find PARTIAL tokens at the end of a string to buffer.
// Matches any prefix of a token that appears at the very end of the string.
const PARTIAL_PATTERN = /\[(?:S(?:T(?:U(?:D(?:E(?:N(?:T(?:_(?:\d{0,3})?)?)?)?)?)?)?)?)?$/

interface SidecarFile {
  mapping: Record<string, string>
}

// --- Debug Helper ---
function log(message: string) {
  try {
    const timestamp = new Date().toISOString()
    appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`)
  } catch (e) {}
}

// --- Helpers ---

function loadMapping(): Record<string, string> | null {
  if (!existsSync(sidecarPath)) return null
  try {
    const data = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as SidecarFile
    return data.mapping
  } catch {
    return null
  }
}

function loadBuffer(): string {
  if (!existsSync(BUFFER_PATH)) return ''
  try {
    const buf = readFileSync(BUFFER_PATH, 'utf-8')
    if (buf.length > 0) {
      log(`[BUFFER LOAD] Prepending buffered content: "${buf}"`)
    }
    return buf
  } catch {
    return ''
  }
}

function saveBuffer(content: string) {
  try {
    if (content.length > 0) {
      log(`[BUFFER SAVE] Storing partial token: "${content}"`)
    }
    writeFileSync(BUFFER_PATH, content, 'utf-8')
  } catch {
    // silently fail
  }
}

function unblindString(text: string, mapping: Record<string, string>): string {
  // 1. Prepend buffer from previous chunk
  const buffer = loadBuffer()
  let combined = buffer + text

  // 2. Perform Replacement on the combined text
  combined = combined.replaceAll(TOKEN_PATTERN, (token) => {
    const val = mapping[token]
    if (val) {
      log(`[REPLACE] Success: ${token} -> ${val}`)
      return val
    }
    log(`[MISSING] No mapping for ${token}`)
    return token
  })

  // 3. Check for new partial token at the end
  const match = combined.match(PARTIAL_PATTERN)
  let newBuffer = ''
  let finalOutput = combined

  if (match && match[0].length > 0) {
    newBuffer = match[0]
    finalOutput = combined.slice(0, -newBuffer.length)
  }

  // 4. Save new buffer for next turn
  saveBuffer(newBuffer)

  return finalOutput
}

function unblindValue(value: unknown, mapping: Record<string, string>): unknown {
  if (typeof value === 'string') return unblindString(value, mapping)
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

  const mapping = loadMapping()
  if (mapping === null) {
    process.stdout.write('{}')
    return
  }

  const unblindedResponse = unblindValue(llmResponse, mapping)

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'AfterModel',
      llm_response: unblindedResponse,
    },
  }))
}

main().catch((err) => {
  log(`FATAL ERROR: ${(err as Error).message}`)
  process.exit(1)
})