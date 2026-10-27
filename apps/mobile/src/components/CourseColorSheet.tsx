import { COURSE_COLOR_KEYS, COURSE_COLORS, courseColorKey, defaultCourseColor } from '@cairn/ui'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useInbox } from '../state/inbox'
import { radius, space, useColors, useScheme } from '../theme'
import { Glyph } from '../ui/icons'
import { Tap } from '../ui/motion'

/**
 * A colour for each Classroom course, shared with the computer. Each course
 * starts with one of its own; picking the ringed swatch again puts that back.
 */
export function CourseColorSheet({ onClose }: { onClose: () => void }) {
  const c = useColors()
  const scheme = useScheme()
  const inbox = useInbox()
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={[styles.sheet, { backgroundColor: c.surface }]} accessibilityViewIsModal>
          <Text style={[styles.heading, { color: c.fg }]}>Course colours</Text>
          <Text style={{ color: c.muted, marginBottom: space.sm }}>Shown on posts, on tasks from coursework and in the widget, here and on your computer.</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {inbox.courses.map(({ courseId, course }) => {
              const current = courseColorKey(courseId, inbox.courseColors)
              const own = defaultCourseColor(courseId)
              return (
                <View key={courseId} style={styles.course}>
                  <Text style={{ color: c.fg, fontSize: 16 }} numberOfLines={1}>
                    {course}
                  </Text>
                  <View style={styles.swatches}>
                    {COURSE_COLOR_KEYS.map((key) => (
                      <Tap
                        key={key}
                        onPress={() => void inbox.setCourseColor(courseId, key === own ? 'auto' : key)}
                        scaleTo={0.9}
                        style={[styles.swatch, { backgroundColor: COURSE_COLORS[key][scheme], borderColor: key === current ? c.fg : 'transparent' }]}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: key === current }}
                        accessibilityLabel={`${COURSE_COLORS[key].name}${key === own ? ', its own colour' : ''}`}
                      >
                        {key === current ? <Glyph char="✓" color="#000" size={14} weight="700" /> : null}
                      </Tap>
                    ))}
                  </View>
                </View>
              )
            })}
          </ScrollView>
          <Pressable style={styles.done} accessibilityRole="button" onPress={onClose}>
            <Text style={{ color: c.accent, fontWeight: '600', fontSize: 16 }}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { padding: space.lg, gap: space.xs, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
  heading: { fontWeight: '700', fontSize: 20 },
  course: { paddingVertical: space.sm, gap: space.sm },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  done: { alignSelf: 'flex-end', paddingVertical: space.md, paddingHorizontal: space.sm },
})
