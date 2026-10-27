import { courseColor } from '@cairn/ui'
import { useCallback } from 'react'
import { useScheme } from '../theme'
import { useInbox } from './inbox'

/** A course's colour in the theme showing, and its name as Classroom last gave it. */
export function useCourses(): { color: (courseId: string | undefined) => string | undefined; name: (courseId: string | undefined) => string | undefined } {
  const { courseColors, courses } = useInbox()
  const scheme = useScheme()
  const color = useCallback((courseId: string | undefined) => courseColor(courseId, courseColors, scheme), [courseColors, scheme])
  const name = useCallback((courseId: string | undefined) => courses.find((entry) => entry.courseId === courseId)?.course, [courses])
  return { color, name }
}
