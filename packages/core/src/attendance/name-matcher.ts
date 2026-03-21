import { levenshtein } from '../matching/levenshtein.js'
import type { ZoomParticipant, RosterEntry, MatchResult } from './types.js'
import type { ZoomNameMap } from './zoom-name-map.js'

/** Fuzzy auto-match threshold — distances below this are high-confidence matches. */
const AUTO_MATCH_THRESHOLD = 0.33

/** Ambiguous ceiling — distances below this (but >= auto-match) produce candidates. */
const AMBIGUOUS_CEILING = 0.5

/** Minimum token length for part-to-part comparison (avoids misleading short-token scores). */
const MIN_PART_LENGTH = 3

/** Matches parenthesized tokens containing a forward slash, e.g. "(he/him)", "(she/they)". */
const PRONOUN_PATTERN = /^\(.*\/.*\)$/

/**
 * Match Zoom participants to Canvas roster entries using a 4-step pipeline:
 *
 * 1. **Persistent map lookup** — check the ZoomNameMap for a previously saved mapping.
 * 2. **Exact case-insensitive match** — compare against roster `name` and `sortableName`
 *    (after stripping pronoun-like parenthesized tokens).
 * 3. **Fuzzy Levenshtein match** — splits names into parts and compares both
 *    full-string and part-to-part distances. Distance < AUTO_MATCH_THRESHOLD
 *    auto-matches; AUTO_MATCH_THRESHOLD–AMBIGUOUS_CEILING is ambiguous.
 * 4. **Unmatched** — no viable match found.
 *
 * High-confidence fuzzy matches (step 3) are automatically saved to the
 * nameMap for future lookups.
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

    // Clean participant name: strip pronoun-like tokens, e.g. "(he/him)"
    const cleanedParticipant = stripPronouns(participant.name)
    const cleanedLower = cleanedParticipant.toLowerCase()

    // Step 2: Exact case-insensitive match on name or sortableName
    const exactMatch = roster.find(
      (r) =>
        r.name.toLowerCase() === cleanedLower ||
        r.sortableName.toLowerCase() === cleanedLower
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

    // Step 3: Fuzzy Levenshtein matching (full-string + part-to-part)
    const candidates: Array<{
      canvasName: string
      canvasUserId: number
      distance: number
    }> = []

    for (const entry of roster) {
      const distName = bestDistance(cleanedLower, entry.name.toLowerCase())
      const distSortable = bestDistance(cleanedLower, entry.sortableName.toLowerCase())
      const bestDist = Math.min(distName, distSortable)

      if (bestDist < AMBIGUOUS_CEILING) {
        candidates.push({
          canvasName: entry.name,
          canvasUserId: entry.userId,
          distance: bestDist,
        })
      }
    }

    // Sort candidates by distance (best first)
    candidates.sort((a, b) => a.distance - b.distance)

    if (candidates.length > 0 && candidates[0].distance < AUTO_MATCH_THRESHOLD) {
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
      // Ambiguous — candidates exist but none below auto-match threshold
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

/**
 * Strip parenthesized tokens containing a forward slash (e.g. "(he/him)").
 * Splits on whitespace, removes matching tokens, and rejoins.
 */
export function stripPronouns(name: string): string {
  return name
    .split(/\s+/)
    .filter((token) => !PRONOUN_PATTERN.test(token))
    .join(' ')
    .trim()
}

/**
 * Compute the best normalized Levenshtein distance between two name strings.
 *
 * Compares: (1) full strings, (2) each part of `a` against each part of `b`.
 * Returns the minimum distance found, skipping part comparisons for tokens
 * shorter than MIN_PART_LENGTH to avoid misleading short-token scores.
 *
 * Both inputs should already be lowercased.
 */
export function bestDistance(a: string, b: string): number {
  // Full-string comparison
  let best = normalizedDistance(a, b)

  // Part-to-part comparison
  const partsA = a.split(/\s+/).filter((p) => p.length >= MIN_PART_LENGTH)
  const partsB = b.split(/\s+/).filter((p) => p.length >= MIN_PART_LENGTH)

  for (const pa of partsA) {
    for (const pb of partsB) {
      const d = normalizedDistance(pa, pb)
      if (d < best) best = d
    }
  }

  return best
}

/** Compute normalized Levenshtein distance: editDistance / max(a.length, b.length). */
function normalizedDistance(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 0
  return levenshtein(a, b) / maxLen
}
