import { existsSync, readdirSync, cpSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Seeds the user's templates directory with the bundled defaults if it is
 * empty or does not exist. Never overwrites existing files.
 */
export function seedDefaultTemplates(templatesDir: string): void {
  const needsSeed = !existsSync(templatesDir) || readdirSync(templatesDir).length === 0

  if (!needsSeed) return

  const defaultsDir = join(dirname(fileURLToPath(import.meta.url)), 'defaults')

  if (!existsSync(defaultsDir)) {
    process.stderr.write(`[canvas-mcp] Warning: default templates directory not found at ${defaultsDir}\n`)
    return
  }

  mkdirSync(templatesDir, { recursive: true })
  cpSync(defaultsDir, templatesDir, { recursive: true })
  process.stderr.write(`[canvas-mcp] Seeded default templates to ${templatesDir}\n`)
}
