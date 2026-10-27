import { courseColor, type Scheme } from '@cairn/ui'
import { useCallback, useSyncExternalStore } from 'react'
import { useInbox } from './inbox'

const LIGHT = '(prefers-color-scheme: light)'

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(LIGHT)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

/** Which theme Windows asks for, the same switch the stylesheet follows. */
export function useScheme(): Scheme {
  return useSyncExternalStore(subscribe, () => (window.matchMedia(LIGHT).matches ? 'light' : 'dark'))
}

/** A course's colour in the theme showing, and its name as Classroom last gave it. */
export function useCourses(): { color: (courseId: string | undefined) => string | undefined; name: (courseId: string | undefined) => string | undefined } {
  const { courseColors, courses } = useInbox()
  const scheme = useScheme()
  const color = useCallback((courseId: string | undefined) => courseColor(courseId, courseColors, scheme), [courseColors, scheme])
  const name = useCallback((courseId: string | undefined) => courses.find((entry) => entry.courseId === courseId)?.course, [courses])
  return { color, name }
}
