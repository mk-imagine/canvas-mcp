import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SecureStore } from '../../../src/security/secure-store.js'
import { SidecarManager } from '../../../src/security/sidecar-manager.js'

describe('SidecarManager', () => {
  let dir: string
  let sidecarPath: string
  let store: SecureStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sidecar-test-'))
    sidecarPath = join(dir, 'pii_session.json')
    store = new SecureStore()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // ── enabled=false ──────────────────────────────────────────────────────────

  it('sync returns false and writes no file when disabled', () => {
    const mgr = new SidecarManager(sidecarPath, false)
    const result = mgr.sync(store)
    expect(result).toBe(false)
    expect(existsSync(sidecarPath)).toBe(false)
  })

  // ── first write ────────────────────────────────────────────────────────────

  it('first sync writes a valid JSON file', () => {
    const mgr = new SidecarManager(sidecarPath, true)
    store.tokenize(1, 'Alice')
    const result = mgr.sync(store)
    expect(result).toBe(true)
    expect(existsSync(sidecarPath)).toBe(true)

    const content = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    expect(content.session_id).toBe(store.sessionId)
    expect(content.last_updated).toBeTruthy()
    expect(content.mapping['[STUDENT_001]']).toBe('Alice')
    expect(content.mapping['Alice']).toBe('[STUDENT_001]')
  })

  // ── skip if unchanged ──────────────────────────────────────────────────────

  it('second sync with same token count returns false (no-op)', () => {
    const mgr = new SidecarManager(sidecarPath, true)
    store.tokenize(1, 'Alice')
    mgr.sync(store)
    const result = mgr.sync(store)
    expect(result).toBe(false)
  })

  // ── write on new token ─────────────────────────────────────────────────────

  it('sync returns true after a new token is added', () => {
    const mgr = new SidecarManager(sidecarPath, true)
    store.tokenize(1, 'Alice')
    mgr.sync(store)

    store.tokenize(2, 'Bob')
    const result = mgr.sync(store)
    expect(result).toBe(true)

    const content = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    expect(content.mapping['[STUDENT_002]']).toBe('Bob')
  })

  // ── atomic write (no .tmp left behind) ─────────────────────────────────────

  it('no .tmp file remains after sync', () => {
    const mgr = new SidecarManager(sidecarPath, true)
    store.tokenize(1, 'Alice')
    mgr.sync(store)
    expect(existsSync(join(dir, '.pii_session.tmp'))).toBe(false)
  })

  // ── file permissions ───────────────────────────────────────────────────────

  it('sidecar file has mode 0o600', () => {
    const mgr = new SidecarManager(sidecarPath, true)
    store.tokenize(1, 'Alice')
    mgr.sync(store)
    const mode = statSync(sidecarPath).mode & 0o777
    expect(mode).toBe(0o600)
  })

  // ── corrupt sidecar ────────────────────────────────────────────────────────

  it('overwrites corrupt sidecar file', () => {
    writeFileSync(sidecarPath, 'not-json!!!', 'utf-8')
    const mgr = new SidecarManager(sidecarPath, true)
    store.tokenize(1, 'Alice')
    const result = mgr.sync(store)
    expect(result).toBe(true)

    const content = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    expect(content.session_id).toBe(store.sessionId)
  })

  // ── purge ──────────────────────────────────────────────────────────────────

  it('purge deletes the sidecar file', () => {
    const mgr = new SidecarManager(sidecarPath, true)
    store.tokenize(1, 'Alice')
    mgr.sync(store)
    expect(existsSync(sidecarPath)).toBe(true)

    mgr.purge()
    expect(existsSync(sidecarPath)).toBe(false)
  })

  it('purge does not throw when file does not exist', () => {
    const mgr = new SidecarManager(sidecarPath, true)
    expect(() => mgr.purge()).not.toThrow()
  })

  // ── creates parent directories ─────────────────────────────────────────────

  it('sync creates parent directories if needed', () => {
    const nestedPath = join(dir, 'sub', 'deep', 'pii_session.json')
    const mgr = new SidecarManager(nestedPath, true)
    store.tokenize(1, 'Alice')
    const result = mgr.sync(store)
    expect(result).toBe(true)
    expect(existsSync(nestedPath)).toBe(true)
  })
})
