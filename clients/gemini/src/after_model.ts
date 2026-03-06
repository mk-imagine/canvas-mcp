/**
 * Gemini CLI after_model hook — Deep Inspection Mode.
 *
 * PURPOSE:
 * 1. Dumps the FULL raw input to '~/.cache/canvas-mcp/last_run_input.json'.
 * This allows us to see exactly what fields the CLI is sending.
 * 2. Runs the current "Best Effort" buffering logic (Multi-Field).
 * 3. Logs detailed execution steps to 'aftermodel-hook-test.txt'.
 */

import { readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// --- Configuration ---
const CACHE_DIR = join(homedir(), '.cache', 'canvas-mcp')
const DEFAULT_SIDECAR_PATH = join(CACHE_DIR, 'pii_session.json')
const BUFFER_PATH = join(CACHE_DIR, 'pii_buffer.txt')
const LOG_FILE = join(homedir(), 'aftermodel-hook-test.txt')
const DUMP_FILE = join(CACHE_DIR, 'last_run_input.json')

const sidecarPath = process.env['CANVAS_MCP_SIDECAR_PATH'] ?? DEFAULT_SIDECAR_PATH

const TOKEN_PATTERN = /\[STUDENT_\d{3}\]/g
const PARTIAL_PATTERN = /\[(?:S(?:T(?:U(?:D(?:E(?:N(?:T(?:_(?:\d{0,3})?)?)?)?)?)?)?)?)?$/

interface SidecarFile {
  mapping: Record<string, string>
}

// Global state for the duration of ONE hook execution
interface HookContext {
  inputBuffer: string;      // The buffer we started with (e.g. "[STUDENT_00")
  nextBuffer: string;       // What we will save for the next turn
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

function readBufferFile(): string {
  if (!existsSync(BUFFER_PATH)) return ''
  try {
    return readFileSync(BUFFER_PATH, 'utf-8')
  } catch {
    return ''
  }
}

function writeBufferFile(content: string) {
  try {
    writeFileSync(BUFFER_PATH, content, 'utf-8')
  } catch { }
}

// --- CORE LOGIC (Multi-Field Buffering) ---

function processString(text: string, mapping: Record<string, string>, ctx: HookContext): string {
  let workingText = text

  // 1. Try to Apply Buffer
  if (ctx.inputBuffer.length > 0) {
    const combined = ctx.inputBuffer + text
    
    // Check if combined text creates a valid token at the boundary
    const match = combined.match(TOKEN_PATTERN)
    if (match && combined.indexOf(match[0]) < ctx.inputBuffer.length) {
      log(`[BUFFER SUCCESS] Prepending "${ctx.inputBuffer}" to "${text.slice(0, 15).replace(/\n/g, '\\n')}..." formed token "${match[0]}"`)
      workingText = combined
    }
  }

  // 2. Perform Replacement
  const unblinded = workingText.replaceAll(TOKEN_PATTERN, (token) => {
    const val = mapping[token]
    if (val) {
      log(`[REPLACE] Success: ${token} -> ${val}`)
      return val
    }
    log(`[MISSING] No mapping for ${token}`)
    return token
  })

  // 3. Detect New Partial Token
  const partialMatch = unblinded.match(PARTIAL_PATTERN)
  if (partialMatch && partialMatch[0].length > 0) {
    // Only update nextBuffer if it's longer or we haven't found one yet
    // (Simple "last write wins" usually works for streaming)
    ctx.nextBuffer = partialMatch[0]
    log(`[BUFFERING] Found partial token "${ctx.nextBuffer}" at end of field.`)
    return unblinded.slice(0, -ctx.nextBuffer.length)
  }

  return unblinded
}

function processValue(value: unknown, mapping: Record<string, string>, ctx: HookContext): unknown {
  if (typeof value === 'string') return processString(value, mapping, ctx)
  if (Array.isArray(value)) return value.map((v) => processValue(v, mapping, ctx))
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = processValue(v, mapping, ctx)
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

  // --- DUMP INPUT FOR INSPECTION ---
  try {
    writeFileSync(DUMP_FILE, raw, 'utf-8')
    // log(`[DEBUG] Dumped raw input to ${DUMP_FILE}`)
  } catch (e) {
    log(`[ERROR] Failed to dump input: ${(e as Error).message}`)
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

  const mapping = loadMapping()
  if (mapping === null) {
    process.stdout.write('{}')
    return
  }

  // --- INITIALIZE CONTEXT ---
  const initialBuffer = readBufferFile()
  if (initialBuffer.length > 0) {
    log(`[HOOK START] Loaded buffer: "${initialBuffer}"`)
  }

  const ctx: HookContext = {
    inputBuffer: initialBuffer,
    nextBuffer: '' 
  }

  // --- EXECUTE ---
  const unblindedResponse = processValue(llmResponse, mapping, ctx)

  // --- FINALIZE ---
  if (ctx.nextBuffer !== initialBuffer) {
     if (ctx.nextBuffer.length > 0) log(`[BUFFER SAVE] New buffer: "${ctx.nextBuffer}"`)
     else if (initialBuffer.length > 0) log(`[BUFFER CLEAR] Buffer consumed or cleared.`)
  }
  
  writeBufferFile(ctx.nextBuffer)

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