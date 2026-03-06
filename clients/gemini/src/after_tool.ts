/**
 * Gemini CLI AfterTool Hook - Step 1: Deep Inspection & Heartbeat
 *
 * PURPOSE:
 * 1. Capture the exact JSON schema coming from the CLI during a tool use event.
 * 2. Dump full raw input to '~/.cache/canvas-mcp/last_tool_input.json'.
 * 3. Log execution flow to 'aftertool-hook-test.txt'.
 * 4. Return no-op ({}) to ensure the CLI continues functioning.
 */

import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// --- Configuration ---
const CACHE_DIR = join(homedir(), '.cache', 'canvas-mcp')
const LOG_FILE = join(homedir(), 'aftertool-hook-test.txt')
const DUMP_FILE = join(CACHE_DIR, 'last_tool_input.json')

// --- Debug Helper ---
function log(message: string) {
  try {
    const timestamp = new Date().toISOString()
    appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`)
  } catch (e) {
    // If logging fails, we can't do much, but we shouldn't crash the hook
  }
}

async function main() {
  // 1. Read all input from stdin
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf-8')

  // 2. Dump raw input for schema inspection
  try {
    // Ensure dir exists
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(DUMP_FILE, raw, 'utf-8')
    log(`[DEBUG] Dumped raw input to ${DUMP_FILE}`)
    log(`[DEBUG] Input size: ${raw.length} bytes`)
  } catch (e) {
    log(`[ERROR] Failed to dump input: ${(e as Error).message}`)
  }

  // 3. Parse and Log specific fields (Heartbeat)
  try {
    if (!raw.trim()) {
      log(`[WARNING] Received empty input`)
      process.stdout.write('{}')
      return
    }

    const hookInput = JSON.parse(raw)
    
    // Log top-level keys to understand the envelope
    log(`[SCHEMA] Keys: ${Object.keys(hookInput).join(', ')}`)

    // Log the Tool Name if present (Validation)
    if (hookInput.tool_name) {
      log(`[TOOL DETECTED] Name: "${hookInput.tool_name}"`)
    } else {
      log(`[WARNING] No 'tool_name' field found.`)
    }
    
    // Log the structure of the tool response/result
    if (hookInput.tool_response) {
      const type = Array.isArray(hookInput.tool_response) ? 'array' : typeof hookInput.tool_response
      log(`[TOOL RESPONSE] Type: ${type}`)
      log(`[TOOL RESPONSE] Preview: ${JSON.stringify(hookInput.tool_response).slice(0, 150)}...`)
    }

  } catch (e) {
    log(`[ERROR] JSON Parse failed: ${(e as Error).message}`)
  }

  // 4. Return Safe No-Op
  process.stdout.write('{}')
}

main().catch((err) => {
  log(`FATAL ERROR: ${(err as Error).message}`)
  process.exit(1)
})