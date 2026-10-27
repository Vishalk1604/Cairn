import { readerStatus } from '@cairn/ui'
import { StyleSheet, Text } from 'react-native'
import Animated from 'react-native-reanimated'
import { useInbox } from '../state/inbox'
import { space, useColors } from '../theme'
import { appear, Tap } from '../ui/motion'

/** When Cairn's server has not looked for a while: what is shown may be out of date. A tap asks it to look now. */
export function PausedNotice() {
  const c = useColors()
  const inbox = useInbox()
  if (!inbox.paused || inbox.checkedAt === null) return null
  return (
    <Animated.View entering={appear}>
      <Tap
        onPress={() => void inbox.refresh()}
        scaleTo={0.98}
        style={[styles.notice, { backgroundColor: c.danger + '22', borderColor: c.danger }]}
        accessibilityRole="button"
        accessibilityHint="Asks Cairn's server to check now"
      >
        <Text style={{ color: c.danger, fontWeight: '600' }}>{readerStatus(inbox, Date.now())}</Text>
        <Text style={{ color: c.muted, marginTop: 2 }}>Cairn's server has not checked your mail lately. Tap to ask it to look now.</Text>
      </Tap>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  notice: { borderWidth: 1, borderRadius: 12, padding: space.md },
})
