export interface CourseCacheEntry {
  code: string
  name: string
  term: string
}

export interface CanvasTeacherConfig {
  canvas: {
    instanceUrl: string
    apiToken: string
  }
  program: {
    activeCourseId: number | null
    courseCodes: string[]
    courseCache: Record<string, CourseCacheEntry>
  }
  defaults: {
    assignmentGroup: string
    submissionType: string
    pointsPossible: number
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export const DEFAULT_CONFIG: CanvasTeacherConfig = {
  canvas: {
    instanceUrl: '',
    apiToken: '',
  },
  program: {
    activeCourseId: null,
    courseCodes: [],
    courseCache: {},
  },
  defaults: {
    assignmentGroup: 'Assignments',
    submissionType: 'online_url',
    pointsPossible: 100,
  },
}
