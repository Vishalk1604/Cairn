import { COURSE_COLOR_KEYS, COURSE_COLORS, courseColorKey, defaultCourseColor } from '@cairn/ui'
import { useScheme } from '../app/courses'
import { useInbox } from '../app/inbox'

/**
 * A colour for each Classroom course, shared with the phone. Each course
 * starts with one of its own; picking the ringed swatch again puts it back.
 */
export function CourseColorsPanel() {
  const inbox = useInbox()
  const scheme = useScheme()
  return (
    <div className="course-colors">
      <p className="hint">Shown on posts, on tasks made from coursework and in the widgets, here and on your phone.</p>
      {inbox.courses.map(({ courseId, course }) => {
        const current = courseColorKey(courseId, inbox.courseColors)
        const own = defaultCourseColor(courseId)
        return (
          <div key={courseId} className="course-color-row" role="radiogroup" aria-label={`Colour for ${course}`}>
            <span className="course-color-name">{course}</span>
            {COURSE_COLOR_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={key === current}
                className={`swatch ${key === current ? 'on' : ''}`}
                style={{ background: COURSE_COLORS[key][scheme] }}
                title={`${COURSE_COLORS[key].name}${key === own ? ' (its own colour)' : ''}`}
                aria-label={COURSE_COLORS[key].name}
                onClick={() => void inbox.setCourseColor(courseId, key === own ? 'auto' : key)}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}
