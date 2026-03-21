/**
 * A single participant record extracted from a Zoom participant report CSV.
 *
 * - `name`: the best available name for roster matching -- the original name
 *   (from parentheses) if present, otherwise the display name.
 * - `originalName`: the parenthesised original name, or null if absent.
 * - `duration`: attendance duration in minutes.
 */
export interface ZoomParticipant {
  name: string
  originalName: string | null
  duration: number
}

/**
 * Options for parsing a Zoom CSV.
 */
export interface ZoomCsvOptions {
  /** If provided, rows whose display name matches this value are filtered out (host). */
  hostName?: string
}

/**
 * A Canvas roster entry used for name matching.
 */
export interface RosterEntry {
  userId: number
  name: string
  sortableName: string
}

/**
 * Result of the attendance name matching pipeline.
 */
export interface MatchResult {
  matched: Array<{
    zoomName: string
    canvasUserId: number
    canvasName: string
    duration: number
    source: 'map' | 'exact' | 'fuzzy'
  }>
  ambiguous: Array<{
    zoomName: string
    duration: number
    candidates: Array<{
      canvasName: string
      canvasUserId: number
      distance: number
    }>
  }>
  unmatched: Array<{
    zoomName: string
    duration: number
  }>
}

/**
 * An entry written to the review file for human inspection.
 * Covers Zoom names that could not be definitively matched to a Canvas student.
 */
export interface ReviewEntry {
  zoomName: string
  status: 'ambiguous' | 'unmatched'
  candidates?: Array<{
    canvasName: string
    canvasUserId: number
    distance: number
  }>
}
