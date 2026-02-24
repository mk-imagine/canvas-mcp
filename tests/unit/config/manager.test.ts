import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ConfigManager, ConfigError } from '../../../src/config/manager.js'
import { DEFAULT_CONFIG } from '../../../src/config/schema.js'

function tmpConfigPath(): string {
  const suffix = randomBytes(8).toString('hex')
  return join(tmpdir(), `canvas-teacher-mcp-test-${suffix}`, 'config.json')
}

describe('ConfigManager', () => {
  describe('read()', () => {
    it('returns defaults merged with empty file (throws if instanceUrl missing)', () => {
      const path = tmpConfigPath()
      const manager = new ConfigManager(path)
      // Without instanceUrl/apiToken, read() should throw
      expect(() => manager.read()).toThrow(ConfigError)
    })

    it('parses a valid config correctly', () => {
      const path = tmpConfigPath()
      const dir = path.substring(0, path.lastIndexOf('/'))
      mkdirSync(dir, { recursive: true })
      const config = {
        canvas: { instanceUrl: 'https://canvas.example.com', apiToken: 'tok123' },
        program: { activeCourseId: 42, courseCodes: ['CSC408'], courseCache: {} },
      }
      writeFileSync(path, JSON.stringify(config), 'utf-8')

      const manager = new ConfigManager(path)
      const result = manager.read()
      expect(result.canvas.instanceUrl).toBe('https://canvas.example.com')
      expect(result.canvas.apiToken).toBe('tok123')
      expect(result.program.activeCourseId).toBe(42)
      expect(result.program.courseCodes).toEqual(['CSC408'])
    })

    it('deep-merges partial config with defaults', () => {
      const path = tmpConfigPath()
      const dir = path.substring(0, path.lastIndexOf('/'))
      mkdirSync(dir, { recursive: true })
      // Provide only canvas, omit defaults section entirely
      const config = {
        canvas: { instanceUrl: 'https://canvas.example.com', apiToken: 'tok' },
        program: { activeCourseId: null, courseCodes: [], courseCache: {} },
      }
      writeFileSync(path, JSON.stringify(config), 'utf-8')

      const manager = new ConfigManager(path)
      const result = manager.read()
      // defaults should be filled from DEFAULT_CONFIG
      expect(result.defaults).toEqual(DEFAULT_CONFIG.defaults)
    })

    it('throws ConfigError if instanceUrl is missing', () => {
      const path = tmpConfigPath()
      const dir = path.substring(0, path.lastIndexOf('/'))
      mkdirSync(dir, { recursive: true })
      writeFileSync(path, JSON.stringify({ canvas: { apiToken: 'tok' } }), 'utf-8')

      const manager = new ConfigManager(path)
      expect(() => manager.read()).toThrow('canvas.instanceUrl is not configured')
    })

    it('throws ConfigError if apiToken is missing', () => {
      const path = tmpConfigPath()
      const dir = path.substring(0, path.lastIndexOf('/'))
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        path,
        JSON.stringify({ canvas: { instanceUrl: 'https://canvas.example.com' } }),
        'utf-8'
      )

      const manager = new ConfigManager(path)
      expect(() => manager.read()).toThrow('canvas.apiToken is not configured')
    })
  })

  describe('write()', () => {
    it('creates parent directory if it does not exist', () => {
      const path = tmpConfigPath()
      const manager = new ConfigManager(path)
      const config = {
        ...DEFAULT_CONFIG,
        canvas: { instanceUrl: 'https://canvas.example.com', apiToken: 'tok' },
      }
      manager.write(config)
      const written = JSON.parse(readFileSync(path, 'utf-8')) as typeof config
      expect(written.canvas.instanceUrl).toBe('https://canvas.example.com')
    })

    it('serialises with 2-space indent', () => {
      const path = tmpConfigPath()
      const manager = new ConfigManager(path)
      const config = {
        ...DEFAULT_CONFIG,
        canvas: { instanceUrl: 'https://canvas.example.com', apiToken: 'tok' },
      }
      manager.write(config)
      const raw = readFileSync(path, 'utf-8')
      // 2-space indented JSON has lines starting with '  '
      expect(raw).toContain('\n  ')
    })
  })

  describe('update()', () => {
    it('read-merge-write roundtrip preserves other keys', () => {
      const path = tmpConfigPath()
      const dir = path.substring(0, path.lastIndexOf('/'))
      mkdirSync(dir, { recursive: true })
      const initial = {
        canvas: { instanceUrl: 'https://canvas.example.com', apiToken: 'tok' },
        program: { activeCourseId: null, courseCodes: ['CSC408'], courseCache: {} },
        defaults: DEFAULT_CONFIG.defaults,
      }
      writeFileSync(path, JSON.stringify(initial), 'utf-8')

      const manager = new ConfigManager(path)
      const result = manager.update({ program: { activeCourseId: 99 } })

      expect(result.program.activeCourseId).toBe(99)
      // courseCodes should be preserved from initial
      expect(result.program.courseCodes).toEqual(['CSC408'])
      // canvas should be untouched
      expect(result.canvas.apiToken).toBe('tok')
    })
  })
})
