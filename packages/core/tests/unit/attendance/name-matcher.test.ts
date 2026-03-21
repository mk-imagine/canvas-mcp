import { describe, it, expect } from 'vitest'
import { matchAttendance } from '../../../src/attendance/name-matcher.js'
import { ZoomNameMap } from '../../../src/attendance/zoom-name-map.js'
import type { ZoomParticipant, RosterEntry } from '../../../src/attendance/types.js'

describe('matchAttendance', () => {
  const roster: RosterEntry[] = [
    { userId: 1, name: 'Jane Smith', sortableName: 'Smith, Jane' },
    { userId: 2, name: 'John Smith', sortableName: 'Smith, John' },
    { userId: 3, name: 'Alice Johnson', sortableName: 'Johnson, Alice' },
    { userId: 4, name: 'Bob Williams', sortableName: 'Williams, Bob' },
  ]

  it('(1) persistent map hit — known mapping matches immediately', () => {
    const nameMap = new ZoomNameMap()
    nameMap.set('jsmith_zoom', 1)

    const participants: ZoomParticipant[] = [
      { name: 'jsmith_zoom', originalName: null, duration: 45 },
    ]

    const result = matchAttendance(participants, roster, nameMap)

    expect(result.matched).toHaveLength(1)
    expect(result.matched[0]).toEqual({
      zoomName: 'jsmith_zoom',
      canvasUserId: 1,
      canvasName: 'Jane Smith',
      duration: 45,
      source: 'map',
    })
    expect(result.ambiguous).toHaveLength(0)
    expect(result.unmatched).toHaveLength(0)
  })

  it('(2) exact case-insensitive match on name field', () => {
    const nameMap = new ZoomNameMap()
    const participants: ZoomParticipant[] = [
      { name: 'jane smith', originalName: null, duration: 50 },
    ]

    const result = matchAttendance(participants, roster, nameMap)

    expect(result.matched).toHaveLength(1)
    expect(result.matched[0]).toEqual({
      zoomName: 'jane smith',
      canvasUserId: 1,
      canvasName: 'Jane Smith',
      duration: 50,
      source: 'exact',
    })
  })

  it('(3) exact match on sortableName field', () => {
    const nameMap = new ZoomNameMap()
    const participants: ZoomParticipant[] = [
      { name: 'Smith, Jane', originalName: null, duration: 55 },
    ]

    const result = matchAttendance(participants, roster, nameMap)

    expect(result.matched).toHaveLength(1)
    expect(result.matched[0]).toEqual({
      zoomName: 'Smith, Jane',
      canvasUserId: 1,
      canvasName: 'Jane Smith',
      duration: 55,
      source: 'exact',
    })
  })

  it('(4) high-confidence fuzzy match — auto-matches with distance < 0.25', () => {
    const nameMap = new ZoomNameMap()
    // "Jane Smth" vs "Jane Smith" -- edit distance 1, max length 10 => 0.1
    const participants: ZoomParticipant[] = [
      { name: 'Jane Smth', originalName: null, duration: 40 },
    ]

    const result = matchAttendance(participants, roster, nameMap)

    expect(result.matched).toHaveLength(1)
    expect(result.matched[0]).toEqual({
      zoomName: 'Jane Smth',
      canvasUserId: 1,
      canvasName: 'Jane Smith',
      duration: 40,
      source: 'fuzzy',
    })
    // High-confidence fuzzy match should be auto-saved to nameMap
    expect(nameMap.get('Jane Smth')).toBe(1)
  })

  it('(5) ambiguous fuzzy match — distance between 0.25 and 0.5', () => {
    const nameMap = new ZoomNameMap()
    // "J. Smith" is 10 chars; "Jane Smith"=10 chars, "John Smith"=10 chars
    // lev("j. smith", "jane smith") and lev("j. smith", "john smith")
    // both should land in 0.25-0.5 range
    const participants: ZoomParticipant[] = [
      { name: 'J. Smith', originalName: null, duration: 30 },
    ]

    const result = matchAttendance(participants, roster, nameMap)

    expect(result.matched).toHaveLength(0)
    expect(result.ambiguous).toHaveLength(1)
    expect(result.ambiguous[0].zoomName).toBe('J. Smith')
    expect(result.ambiguous[0].duration).toBe(30)
    expect(result.ambiguous[0].candidates.length).toBeGreaterThanOrEqual(1)
    // All candidates should have distance between 0.25 and 0.5
    for (const c of result.ambiguous[0].candidates) {
      expect(c.distance).toBeGreaterThanOrEqual(0.25)
      expect(c.distance).toBeLessThan(0.5)
    }
  })

  it('(6) unmatched name — no close match in roster', () => {
    const nameMap = new ZoomNameMap()
    const participants: ZoomParticipant[] = [
      { name: 'xyz123', originalName: null, duration: 20 },
    ]

    const result = matchAttendance(participants, roster, nameMap)

    expect(result.matched).toHaveLength(0)
    expect(result.ambiguous).toHaveLength(0)
    expect(result.unmatched).toHaveLength(1)
    expect(result.unmatched[0]).toEqual({
      zoomName: 'xyz123',
      duration: 20,
    })
  })

  it('(7) persistent map entry for user not in roster — falls through to fuzzy', () => {
    const nameMap = new ZoomNameMap()
    // Map points to userId 999 which is not in roster
    nameMap.set('Jane Smth', 999)

    const participants: ZoomParticipant[] = [
      { name: 'Jane Smth', originalName: null, duration: 35 },
    ]

    const result = matchAttendance(participants, roster, nameMap)

    // Should NOT match via map (user 999 not in roster)
    // Should fall through to fuzzy and match "Jane Smith" (distance ~0.1)
    expect(result.matched).toHaveLength(1)
    expect(result.matched[0].canvasUserId).toBe(1)
    expect(result.matched[0].source).toBe('fuzzy')
  })

  it('(8) empty participants list — returns empty result', () => {
    const nameMap = new ZoomNameMap()
    const result = matchAttendance([], roster, nameMap)

    expect(result.matched).toHaveLength(0)
    expect(result.ambiguous).toHaveLength(0)
    expect(result.unmatched).toHaveLength(0)
  })

  it('(9) empty roster — all participants unmatched', () => {
    const nameMap = new ZoomNameMap()
    const participants: ZoomParticipant[] = [
      { name: 'Jane Smith', originalName: null, duration: 50 },
      { name: 'John Smith', originalName: null, duration: 45 },
    ]

    const result = matchAttendance(participants, [], nameMap)

    expect(result.matched).toHaveLength(0)
    expect(result.ambiguous).toHaveLength(0)
    expect(result.unmatched).toHaveLength(2)
  })
})
