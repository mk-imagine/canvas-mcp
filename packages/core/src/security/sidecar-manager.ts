import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SecureStore } from './secure-store.js'

interface SidecarFile {
  session_id: string
  last_updated: string
  mapping: Record<string, string>
}

export class SidecarManager {
  private readonly sidecarPath: string
  private readonly enabled: boolean

  constructor(sidecarPath: string, enabled: boolean) {
    this.sidecarPath = sidecarPath
    this.enabled = enabled
  }

  /**
   * Writes the current token↔name mapping to disk if the session has changed.
   * Returns true if the file was written, false if it was a no-op.
   */
  sync(store: SecureStore): boolean {
    if (!this.enabled) return false

    // Check if existing sidecar matches this session
    if (existsSync(this.sidecarPath)) {
      try {
        const existing = JSON.parse(readFileSync(this.sidecarPath, 'utf-8')) as SidecarFile
        if (existing.session_id === store.sessionId) return false
      } catch {
        // Corrupt sidecar — fall through and overwrite
      }
    }

    // Build bidirectional mapping
    const mapping: Record<string, string> = {}
    for (const token of store.listTokens()) {
      const resolved = store.resolve(token)
      if (resolved !== null) {
        mapping[token] = resolved.name
        mapping[resolved.name] = token
      }
    }

    const sidecar: SidecarFile = {
      session_id: store.sessionId,
      last_updated: new Date().toISOString(),
      mapping,
    }
    const content = JSON.stringify(sidecar, null, 2)

    // Atomic write: write to .tmp then rename
    const dir = dirname(this.sidecarPath)
    mkdirSync(dir, { recursive: true })
    const tmpPath = join(dir, '.pii_session.tmp')
    writeFileSync(tmpPath, content, { mode: 0o600, encoding: 'utf-8' })
    renameSync(tmpPath, this.sidecarPath)
    try {
      chmodSync(this.sidecarPath, 0o600)
    } catch {
      // Non-fatal — mode was already set on write
    }

    return true
  }

  /** Deletes the sidecar file. Called on all exit paths. */
  purge(): void {
    try {
      unlinkSync(this.sidecarPath)
    } catch {
      // File may not exist — ignore
    }
  }
}
