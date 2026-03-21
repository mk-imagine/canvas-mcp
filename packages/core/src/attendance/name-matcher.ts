import { levenshtein } from '../matching/levenshtein.js'
import type { ZoomParticipant, RosterEntry, MatchResult } from './types.js'
import type { ZoomNameMap } from './zoom-name-map.js'

/**
 * Match Zoom participants to Canvas roster entries using a 4-step pipeline:
 *
 * 1. **Persistent map lookup** — check the ZoomNameMap for a previously saved mapping.
 * 2. **Exact case-insensitive match** — compare against roster `name` and `sortableName`.
 * 3. **Fuzzy Levenshtein match** — normalized distance < 0.25 auto-matches,
 *    0.25-0.5 is ambiguous (returns candidates).
 * 4. **Unmatched** — no viable match found.
 *
 * High-confidence fuzzy matches (step 3, distance < 0.25) are automatically
 * saved to the nameMap for future lookups.
 */
export function matchAttendance(
  participants: ZoomParticipant[],
  roster: RosterEntry[],
  nameMap: ZoomNameMap
): MatchResult {
  const result: MatchResult = {
    matched: [],
    ambiguous: [],
    unmatched: [],
  }

  const rosterByUserId = new Map<number, RosterEntry>()
  for (const entry of roster) {
    rosterByUserId.set(entry.userId, entry)
  }

  for (const participant of participants) {
    // Step 1: Persistent map lookup
    const mappedUserId = nameMap.get(participant.name)
    if (mappedUserId !== undefined) {
      const rosterEntry = rosterByUserId.get(mappedUserId)
      if (rosterEntry) {
        result.matched.push({
          zoomName: participant.name,
          canvasUserId: rosterEntry.userId,
          canvasName: rosterEntry.name,
          duration: participant.duration,
          source: 'map',
        })
        continue
      }
      // Map entry points to user not in roster — fall through
    }

    // Step 2: Exact case-insensitive match on name or sortableName
    const participantLower = participant.name.toLowerCase()
    const exactMatch = roster.find(
      (r) =>
        r.name.toLowerCase() === participantLower ||
        r.sortableName.toLowerCase() === participantLower
    )
    if (exactMatch) {
      result.matched.push({
        zoomName: participant.name,
        canvasUserId: exactMatch.userId,
        canvasName: exactMatch.name,
        duration: participant.duration,
        source: 'exact',
      })
      continue
    }

    // Step 3: Fuzzy Levenshtein matching
    const candidates: Array<{
      canvasName: string
      canvasUserId: number
      distance: number
    }> = []

    for (const entry of roster) {
      // Compare against both name and sortableName, take the better distance
      const distName = normalizedDistance(participantLower, entry.name.toLowerCase())
      const distSortable = normalizedDistance(participantLower, entry.sortableName.toLowerCase())
      const bestDist = Math.min(distName, distSortable)

      if (bestDist < 0.5) {
        candidates.push({
          canvasName: entry.name,
          canvasUserId: entry.userId,
          distance: bestDist,
        })
      }
    }

    // Sort candidates by distance (best first)
    candidates.sort((a, b) => a.distance - b.distance)

    if (candidates.length > 0 && candidates[0].distance < 0.25) {
      // High-confidence fuzzy match — auto-match and save to nameMap
      const best = candidates[0]
      result.matched.push({
        zoomName: participant.name,
        canvasUserId: best.canvasUserId,
        canvasName: best.canvasName,
        duration: participant.duration,
        source: 'fuzzy',
      })
      nameMap.set(participant.name, best.canvasUserId)
      continue
    }

    if (candidates.length > 0) {
      // Ambiguous — candidates exist but none below 0.25
      result.ambiguous.push({
        zoomName: participant.name,
        duration: participant.duration,
        candidates,
      })
      continue
    }

    // Step 4: Unmatched
    result.unmatched.push({
      zoomName: participant.name,
      duration: participant.duration,
    })
  }

  return result
}

/** Compute normalized Levenshtein distance: editDistance / max(a.length, b.length). */
function normalizedDistance(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 0
  return levenshtein(a, b) / maxLen
}
