import { type RosterStore } from './store.js'
import type { RosterStudent } from './types.js'
import { type CanvasClient } from '../canvas/client.js'
import { fetchStudentEnrollments } from '../canvas/submissions.js'

/**
 * Syncs the shared roster from Canvas enrollments for a given course.
 *
 * For each enrolled student:
 *   - If the student already exists in the roster, their record is updated:
 *     name and sortable_name are refreshed from Canvas, login_id is merged into
 *     emails (deduped), courseId is added to courseIds (deduped), and existing
 *     zoomAliases and created timestamp are preserved.
 *   - If the student is new, a fresh record is created.
 *
 * For each student already in the roster with this courseId who is no longer
 * enrolled, their courseId is removed via removeStudentCourseId.
 *
 * Returns the full roster after all mutations.
 */
export async function syncRosterFromEnrollments(
  rosterStore: RosterStore,
  client: CanvasClient,
  courseId: number
): Promise<RosterStudent[]> {
  const enrollments = await fetchStudentEnrollments(client, courseId)

  const existing = await rosterStore.load()
  const existingByCanvasId = new Map<number, RosterStudent>(
    existing.map((s) => [s.canvasUserId, s])
  )

  const enrolledIds = new Set<number>(enrollments.map((e) => e.user_id))

  for (const enrollment of enrollments) {
    const { user_id, user } = enrollment
    const loginId = user.login_id

    const prev = existingByCanvasId.get(user_id)

    if (prev) {
      // Merge: update name fields, add email if not present, ensure courseId, preserve zoomAliases
      const emails = prev.emails.slice()
      if (loginId && !emails.includes(loginId)) {
        emails.push(loginId)
      }
      const courseIds = prev.courseIds.includes(courseId)
        ? prev.courseIds
        : [...prev.courseIds, courseId]

      await rosterStore.upsertStudent({
        canvasUserId: user_id,
        name: user.name,
        sortable_name: user.sortable_name,
        emails,
        courseIds,
        zoomAliases: prev.zoomAliases,
        created: prev.created,
      })
    } else {
      // New student
      await rosterStore.upsertStudent({
        canvasUserId: user_id,
        name: user.name,
        sortable_name: user.sortable_name,
        emails: loginId ? [loginId] : [],
        courseIds: [courseId],
        zoomAliases: [],
        created: new Date().toISOString(),
      })
    }
  }

  // Remove courseId from students who are no longer enrolled
  for (const student of existing) {
    if (student.courseIds.includes(courseId) && !enrolledIds.has(student.canvasUserId)) {
      await rosterStore.removeStudentCourseId(student.canvasUserId, courseId)
    }
  }

  return rosterStore.allStudents()
}
