import { AiError, checkAiKey, modelsFor, readAiSetup, type AiSetup, type NoteQuery } from '@cairn/sync'
import { DEFAULT_PROFILE, PROFILE_LIMIT } from '@cairn/core'
import { featuresOf, owner, readsAnnouncements, recycleBin, sources, type Account } from '@cairn/ui'
import Constants from 'expo-constants'
import { useEffect, useState, type ReactNode } from 'react'
import { ActivityIndicator, BackHandler, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { interpolateColor, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { notificationPermission, requestNotificationPermission, type PermissionState } from '../platform/notifications'
import { useCairn } from '../state/context'
import { useObserved } from '../state/hooks'
import { readingOn, useInbox } from '../state/inbox'
import { usePreferences, type Feature, type FontSize, type Layout, type SortOrder } from '../state/preferences'
import { useToast } from '../state/toast'
import { radius, space, useColors } from '../theme'
import { Glyph } from '../ui/icons'
import { fadeIn, fadeOut, settle, sheetIn, sheetOut, Tap } from '../ui/motion'
import { RecycleBinScreen } from './RecycleBinScreen'

const SITE = 'https://cairn-vishalk.web.app'
/** Where the key comes from. Any model page there gives the same kind of key. */
const NVIDIA_PAGE = 'https://build.nvidia.com/openai/gpt-oss-20b'

const FONT_LABEL: Record<FontSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' }
const SORT_LABEL: Record<SortOrder, string> = { modified: 'By modification date', created: 'By creation date' }
const LAYOUT_LABEL: Record<Layout, string> = { grid: 'Grid view', list: 'List view' }

const WITH_DELETED: NoteQuery = { includeDeleted: true }

type Choice = { title: string; options: { label: string; on: boolean; pick: () => void }[] }

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const c = useColors()
  const toast = useToast()
  const cairn = useCairn()
  const { preferences, update, setPaused } = usePreferences()
  const inbox = useInbox()
  const [choice, setChoice] = useState<Choice | null>(null)
  const [permission, setPermission] = useState<PermissionState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [keySheet, setKeySheet] = useState(false)
  const [bin, setBin] = useState(false)
  const [profileSheet, setProfileSheet] = useState(false)
  const binned = recycleBin(useObserved(cairn.notes, WITH_DELETED), Date.now()).length

  useEffect(() => {
    void notificationPermission().then(setPermission)
  }, [])

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (bin) setBin(false)
      else if (profileSheet) setProfileSheet(false)
      else if (keySheet) setKeySheet(false)
      else if (choice) setChoice(null)
      else onBack()
      return true
    })
    return () => sub.remove()
  }, [bin, profileSheet, choice, keySheet, onBack])

  /** Runs an account action with a spinner on its row, and says what went wrong rather than failing silently. */
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    try {
      await action()
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  /**
   * Switching off is a choice made here and takes effect at once; Google is
   * not involved, and keeps the permission so switching back on is instant.
   * Switching on only goes to Google when the permission is missing, and
   * reading then starts from that moment rather than the backlog.
   */
  const toggle = (account: Account, feature: Feature) => {
    const sub = account.identity.sub
    if (readingOn(account, feature, preferences.paused)) {
      setPaused(feature, sub, true)
      return
    }
    void run(`${sub}:${feature}`, async () => {
      if (!featuresOf(account)[feature]) {
        const now = (await cairn.regrant(account, { ...featuresOf(account), [feature]: true })).find((a) => a.identity.sub === sub)
        if (!now || !featuresOf(now)[feature]) {
          throw new Error(`Google didn't give Cairn ${feature === 'mail' ? 'Gmail' : 'Classroom'} access. Tick every box on the permission screen to switch it on.`)
        }
      }
      await inbox.startFresh(sub, feature)
      setPaused(feature, sub, false)
    })
  }

  /** Classroom switched on before Cairn read announcements: Google has to be asked once more. */
  const allowAnnouncements = (account: Account) => {
    const sub = account.identity.sub
    void run(`${sub}:announcements`, async () => {
      const now = (await cairn.regrant(account, { ...featuresOf(account), classroom: true })).find((a) => a.identity.sub === sub)
      if (!now || !readsAnnouncements(now)) {
        throw new Error("Google didn't give Cairn the announcements. Tick every box on the permission screen to read them.")
      }
    })
  }

  const main = owner(cairn.accounts)
  const linked = sources(cairn.accounts)
  const auth = cairn.auth

  const pick = <T extends string>(title: string, labels: Record<T, string>, current: T, set: (v: T) => void) =>
    setChoice({
      title,
      options: (Object.keys(labels) as T[]).map((value) => ({ label: labels[value], on: value === current, pick: () => set(value) })),
    })

  if (bin) return <RecycleBinScreen onBack={() => setBin(false)} />

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={styles.bar}>
        <Tap onPress={onBack} scaleTo={0.92} style={styles.icon} accessibilityLabel="Back">
          <Glyph char="←" color={c.fg} />
        </Tap>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.heading, { color: c.fg }]}>Settings</Text>

        <Section title="Account">
          {auth.status === 'synced' || main ? (
            <Row
              title={main?.identity.email ?? 'Signed in'}
              detail={
                auth.status === 'synced'
                  ? 'Synced with your other devices'
                  : auth.status === 'connecting'
                    ? 'Connecting…'
                    : auth.status === 'error'
                      ? auth.message
                      : 'Signed in'
              }
              detailTone={auth.status === 'error' ? 'danger' : 'muted'}
              trailing={auth.status === 'connecting' ? <ActivityIndicator color={c.muted} /> : undefined}
            />
          ) : (
            <Row
              title="Sign in with Google"
              detail={auth.status === 'error' ? auth.message : 'Back up your notes and keep them in step with the Cairn desktop app'}
              detailTone={auth.status === 'error' ? 'danger' : 'muted'}
              trailing={auth.status === 'connecting' || busy === 'signin' ? <ActivityIndicator color={c.accent} /> : <Glyph char="›" color={c.muted} size={26} />}
              onPress={() => void run('signin', cairn.signIn)}
            />
          )}
          {main && (
            <Row
              title="Sign out"
              detail="Notes stay on this phone; they just stop syncing"
              danger
              onPress={() => void run('signout', cairn.signOut)}
            />
          )}
        </Section>

        {main && (
          <Section title="Mail and Classroom">
            <Text style={[styles.note, { color: c.faint }]}>
              Cairn reads new mail and Classroom posts, picks out what matters and offers due dates as tasks. Nothing in your mailbox or your classes is ever sent or changed.
            </Text>
            <AccountFeatures account={main} busy={busy} paused={preferences.paused} onToggle={(f) => toggle(main, f)} onAnnouncements={() => allowAnnouncements(main)} />
            {linked.map((account) => (
              <View key={account.identity.sub}>
                <AccountFeatures
                  account={account}
                  busy={busy}
                  paused={preferences.paused}
                  onToggle={(f) => toggle(account, f)}
                  onAnnouncements={() => allowAnnouncements(account)}
                />
                <Row title="Disconnect" danger onPress={() => void run(`x${account.identity.sub}`, () => cairn.disconnectSource(account.identity.sub))} />
              </View>
            ))}
            <Row
              title="Link another account"
              detail="A university or work account to read from"
              trailing={busy === 'link' ? <ActivityIndicator color={c.accent} /> : <Glyph char="+" color={c.accent} size={24} />}
              onPress={() => void run('link', () => cairn.connectSource({ mail: true, classroom: true }))}
            />
          </Section>
        )}

        {/* Shown signed out too, so the place to paste a key is easy to find. */}
        <Section title="AI sorting">
          <Text style={[styles.note, { color: c.faint }]}>
            With a key, Cairn sends the text of each new email and Classroom post to NVIDIA's AI service, which picks out what matters to you, files it
            into folders such as Hackathons or Jobs, tags it, and reads off any deadline or time. The key stays on this phone.
            {main ? '' : ' It starts working once you sign in and turn on mail reading.'}
          </Text>
          <Row
            title="What matters to you"
            detail={inbox.profile.length > 140 ? `${inbox.profile.slice(0, 137)}…` : inbox.profile}
            trailing={<Glyph char="›" color={c.muted} size={26} />}
            onPress={() => setProfileSheet(true)}
          />
          {inbox.ai.on ? (
            <>
              <Row
                title="On"
                detail={inbox.ai.error ?? (inbox.ai.model ? `Last sorted by ${inbox.ai.model}` : `Uses ${inbox.ai.preferred ?? 'GPT-OSS'} from the next mail that arrives`)}
                detailTone={inbox.ai.error ? 'danger' : 'muted'}
                trailing={<Glyph char="✓" color={c.accent} size={20} />}
              />
              <Row title="Change key" onPress={() => setKeySheet(true)} trailing={<Glyph char="›" color={c.muted} size={26} />} />
              <Row title="Remove key" detail="Mail goes back to being checked for deadlines only" danger onPress={() => void run('aikey', () => inbox.setAiSetup(null))} />
            </>
          ) : (
            <Row
              title="Add an NVIDIA API key"
              detail="Free from NVIDIA. Paste the code from their GPT-OSS page and Cairn finds the key in it."
              trailing={<Glyph char="+" color={c.accent} size={24} />}
              onPress={() => setKeySheet(true)}
            />
          )}
        </Section>

        <Section title="Style">
          <Row title="Font size" value={FONT_LABEL[preferences.fontSize]} onPress={() => pick('Font size', FONT_LABEL, preferences.fontSize, (fontSize) => update({ fontSize }))} />
          <Row title="Sort" value={SORT_LABEL[preferences.sort]} onPress={() => pick('Sort', SORT_LABEL, preferences.sort, (sort) => update({ sort }))} />
          <Row title="Layout" value={LAYOUT_LABEL[preferences.layout]} onPress={() => pick('Layout', LAYOUT_LABEL, preferences.layout, (layout) => update({ layout }))} />
        </Section>

        <Section title="Reminders">
          <Row
            title="Notifications"
            detail={permission === 'granted' ? 'Allowed' : permission === 'denied' ? 'Off — tap to open system settings' : 'Not asked yet — tap to allow'}
            detailTone={permission === 'granted' ? 'muted' : 'danger'}
            onPress={async () => {
              if (permission === 'undetermined') setPermission(await requestNotificationPermission())
              else void Linking.openSettings()
            }}
          />
          <Row
            title="High-priority reminders"
            detail="Play sound even when Silent or DND mode is on"
            trailing={<Switch on={preferences.urgentAlerts} />}
            onPress={() => {
              const urgentAlerts = !preferences.urgentAlerts
              update({ urgentAlerts })
              if (urgentAlerts) toast({ message: 'For Do Not Disturb, also allow Cairn under Settings › Notifications › Do Not Disturb access.' })
            }}
          />
        </Section>

        <Section title="Notes">
          <Row
            title="Recycle bin"
            detail={`${binned === 0 ? 'Empty' : binned === 1 ? '1 note' : `${binned} notes`} · deleted notes are kept for 30 days`}
            trailing={<Glyph char="›" color={c.muted} size={26} />}
            onPress={() => setBin(true)}
          />
        </Section>

        <Section title="About">
          <Row title="Version" value={Constants.expoConfig?.version ?? '—'} />
          <Row title="Privacy policy" trailing={<Glyph char="›" color={c.muted} size={26} />} onPress={() => void Linking.openURL(`${SITE}/privacy`)} />
          <Row title="Terms" trailing={<Glyph char="›" color={c.muted} size={26} />} onPress={() => void Linking.openURL(`${SITE}/terms`)} />
        </Section>
      </ScrollView>

      {keySheet && (
        <KeySheet
          onClose={() => setKeySheet(false)}
          onSave={async (setup) => {
            const model = await checkAiKey(setup)
            await inbox.setAiSetup(setup)
            setKeySheet(false)
            const preferred = modelsFor(setup)[0]?.label ?? model
            toast({ message: model === preferred ? `Key works. Mail will be sorted by ${model}.` : `Key works. ${preferred} is busy, so ${model} will sort mail for now.` })
          }}
        />
      )}

      {profileSheet && (
        <ProfileSheet
          profile={inbox.profile}
          onSave={(text) => {
            inbox.setProfile(text)
            setProfileSheet(false)
            toast({ message: 'Saved. New mail is read with it from now on.' })
          }}
          onClose={() => setProfileSheet(false)}
        />
      )}

      {choice && (
        <Animated.View entering={fadeIn} exiting={fadeOut} style={[StyleSheet.absoluteFill, styles.scrim]}>
          <Tap onPress={() => setChoice(null)} scaleTo={1} haptic="none" style={styles.flex}>
            <View />
          </Tap>
          <Animated.View entering={sheetIn} exiting={sheetOut} style={[styles.sheet, { backgroundColor: c.surface }]}>
            <Text style={[styles.sheetTitle, { color: c.fg }]}>{choice.title}</Text>
            {choice.options.map((o) => (
              <Tap
                key={o.label}
                onPress={() => {
                  o.pick()
                  setChoice(null)
                }}
                scaleTo={0.98}
                style={styles.sheetRow}
              >
                <Text style={{ color: o.on ? c.accent : c.fg, fontSize: 17, flex: 1, fontWeight: o.on ? '600' : '400' }}>{o.label}</Text>
                {o.on && <Glyph char="✓" color={c.accent} size={18} />}
              </Tap>
            ))}
          </Animated.View>
        </Animated.View>
      )}
    </View>
  )
}

/**
 * NVIDIA's model pages give out a code sample with the key written into it,
 * not a bare key, so the whole sample is pasted here and read. It is checked
 * against NVIDIA before it is kept, so a bad paste shows here rather than as
 * a silent inbox.
 */
function KeySheet({ onSave, onClose }: { onSave: (setup: AiSetup) => Promise<void>; onClose: () => void }) {
  const c = useColors()
  const [pasted, setPasted] = useState('')
  const [checking, setChecking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const read = pasted.trim() ? readAiSetup(pasted) : null
  // The sheet sits on top of the keyboard, so the paste and the button stay in view.
  const keyboard = useAnimatedKeyboard()
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -keyboard.height.value }] }))
  const save = async () => {
    if (!read) return
    if (!read.ok) return setProblem(read.error)
    setChecking(true)
    setProblem(null)
    try {
      await onSave(read.setup)
    } catch (error) {
      setProblem(
        error instanceof AiError && error.badKey
          ? 'NVIDIA did not accept that key. Copy the code again from the NVIDIA page.'
          : `Couldn't reach NVIDIA: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      setChecking(false)
    }
  }
  const steps = [
    'Open the GPT-OSS page on NVIDIA and sign in.',
    'Press “Get API Key”, then copy the key it shows (it starts with nvapi-) or the code shown with your key in it.',
    'Paste it below.',
  ]
  return (
    <Animated.View entering={fadeIn} exiting={fadeOut} style={[StyleSheet.absoluteFill, styles.scrim]}>
      <Tap onPress={onClose} scaleTo={1} haptic="none" style={styles.flex} accessibilityLabel="Close">
        <View />
      </Tap>
      <Animated.View entering={sheetIn} exiting={sheetOut} style={[styles.sheet, { backgroundColor: c.surface }, lift]}>
        <Text style={[styles.sheetTitle, { color: c.fg }]}>Connect NVIDIA AI</Text>
        {steps.map((step, i) => (
          <View key={step} style={styles.step}>
            <Text style={[styles.stepNumber, { color: c.accent }]}>{i + 1}</Text>
            <Text style={[styles.stepText, { color: c.muted }]}>{step}</Text>
          </View>
        ))}
        <Tap onPress={() => void Linking.openURL(NVIDIA_PAGE)} scaleTo={0.97} style={[styles.openPage, { borderColor: c.accent }]}>
          <Text style={{ color: c.accent, fontWeight: '600' }}>Open the NVIDIA page</Text>
        </Tap>
        <TextInput
          value={pasted}
          onChangeText={(text) => {
            setPasted(text)
            setProblem(null)
          }}
          placeholder="Paste the nvapi- key, or the Shell code"
          placeholderTextColor={c.faint}
          style={[styles.keyInput, styles.codeInput, { color: c.fg, backgroundColor: c.surfaceHigh }]}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          textAlignVertical="top"
          accessibilityLabel="NVIDIA code or key"
        />
        {read?.ok && !problem && (
          <Text style={{ color: c.muted, marginTop: space.sm }}>
            Found a key{read.setup.model ? ` for ${modelsFor(read.setup)[0]?.label}` : ''}. Kept in this phone's secure storage and sent only to NVIDIA.
          </Text>
        )}
        {(problem ?? (read && !read.ok ? read.error : null)) && (
          <Text style={{ color: c.danger, marginTop: space.sm }}>{problem ?? (read && !read.ok ? read.error : '')}</Text>
        )}
        {checking && (
          <Text style={{ color: c.muted, marginTop: space.sm }}>Asking NVIDIA. Its free tier can take a minute or two to answer.</Text>
        )}
        <Tap onPress={() => void save()} disabled={checking || !read?.ok} scaleTo={0.96} haptic="medium" style={[styles.keySave, { backgroundColor: c.accent, opacity: read?.ok ? 1 : 0.5 }]}>
          {checking ? <ActivityIndicator color={c.onAccent} /> : <Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 16 }}>Check and save</Text>}
        </Tap>
      </Animated.View>
    </Animated.View>
  )
}

/**
 * What the model is told matters, in the person's own words. It goes with
 * every message it reads, so "SIH and anything from the placement cell" is
 * enough to move those into Important.
 */
function ProfileSheet({ profile, onSave, onClose }: { profile: string; onSave: (text: string) => void; onClose: () => void }) {
  const c = useColors()
  const [text, setText] = useState(profile)
  const keyboard = useAnimatedKeyboard()
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -keyboard.height.value }] }))
  return (
    <Animated.View entering={fadeIn} exiting={fadeOut} style={[StyleSheet.absoluteFill, styles.scrim]}>
      <Tap onPress={onClose} scaleTo={1} haptic="none" style={styles.flex}>
        <View />
      </Tap>
      <Animated.View entering={sheetIn} exiting={sheetOut} style={[styles.sheet, { backgroundColor: c.surface }, lift]}>
        <Text style={[styles.sheetTitle, { color: c.fg }]}>What matters to you</Text>
        <Text style={{ color: c.muted, marginBottom: space.md, lineHeight: 20 }}>
          Say what you want in Important and what you don't, in your own words. The AI reads every email and Classroom post with this in mind.
        </Text>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          maxLength={PROFILE_LIMIT}
          placeholder={DEFAULT_PROFILE}
          placeholderTextColor={c.faint}
          style={[styles.keyInput, styles.profileInput, { color: c.fg, backgroundColor: c.surfaceHigh }]}
          textAlignVertical="top"
          accessibilityLabel="What matters to you"
        />
        <Text style={{ color: c.faint, marginTop: space.xs, textAlign: 'right' }}>
          {text.length}/{PROFILE_LIMIT}
        </Text>
        <View style={styles.profileButtons}>
          <Tap onPress={() => setText(DEFAULT_PROFILE)} scaleTo={0.96} style={[styles.openPage, { borderColor: c.line }]}>
            <Text style={{ color: c.muted }}>Use the default</Text>
          </Tap>
          <View style={styles.flex} />
          <Tap onPress={() => onSave(text)} scaleTo={0.96} haptic="medium" style={[styles.profileSave, { backgroundColor: c.accent }]}>
            <Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 16 }}>Save</Text>
          </Tap>
        </View>
      </Animated.View>
    </Animated.View>
  )
}

function AccountFeatures({
  account,
  busy,
  paused,
  onToggle,
  onAnnouncements,
}: {
  account: Account
  busy: string | null
  paused: Record<Feature, string[]>
  onToggle: (feature: Feature) => void
  onAnnouncements: () => void
}) {
  const c = useColors()
  const sub = account.identity.sub
  const row = (feature: Feature, title: string, detail: string) => (
    <Row
      title={title}
      detail={detail}
      trailing={busy === `${sub}:${feature}` ? <ActivityIndicator color={c.accent} /> : <Switch on={readingOn(account, feature, paused)} />}
      onPress={() => onToggle(feature)}
    />
  )
  return (
    <View>
      <Text style={[styles.accountName, { color: c.fg }]}>{account.identity.email}</Text>
      {row('mail', 'Read Gmail', 'New mail from now on — important mail and deadlines picked out')}
      {row('classroom', 'Read Google Classroom', 'New coursework and announcements from now on. A task made from coursework ticks itself off when you hand in')}
      {readingOn(account, 'classroom', paused) && !readsAnnouncements(account) && (
        <Row
          title="Read announcements too"
          detail="Classroom was switched on before Cairn read announcements. Google will ask you once more."
          trailing={busy === `${sub}:announcements` ? <ActivityIndicator color={c.accent} /> : <Glyph char="›" color={c.muted} size={26} />}
          onPress={onAnnouncements}
        />
      )}
    </View>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const c = useColors()
  return (
    <View style={[styles.section, { borderBottomColor: c.line }]}>
      <Text style={[styles.sectionTitle, { color: c.muted }]}>{title}</Text>
      {children}
    </View>
  )
}

function Row({
  title,
  detail,
  detailTone = 'muted',
  value,
  trailing,
  onPress,
  danger,
}: {
  title: string
  detail?: string
  detailTone?: 'muted' | 'danger'
  value?: string
  trailing?: ReactNode
  onPress?: () => void
  danger?: boolean
}) {
  const c = useColors()
  const content = (
    <>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: danger ? c.danger : c.fg }]}>{title}</Text>
        {detail && <Text style={[styles.rowDetail, { color: detailTone === 'danger' ? c.danger : c.muted }]}>{detail}</Text>}
      </View>
      {value && <Text style={[styles.rowValue, { color: c.muted }]}>{value}</Text>}
      {value && onPress && <Glyph char="⌄" color={c.muted} size={18} />}
      {trailing}
    </>
  )
  if (!onPress) return <View style={styles.row}>{content}</View>
  return (
    <Tap onPress={onPress} scaleTo={0.985} style={styles.row} accessibilityRole="button" accessibilityLabel={title}>
      {content}
    </Tap>
  )
}

/** A switch whose thumb travels on a spring, so flipping it feels like a toggle rather than a repaint. */
function Switch({ on }: { on: boolean }) {
  const c = useColors()
  const t = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    t.value = withTiming(on ? 1 : 0, settle)
  }, [on, t])
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(t.value, [0, 1], [c.surfaceHigh, c.accent]) }))
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: t.value * 22 }] }))
  return (
    <Animated.View style={[styles.track, track]} accessibilityRole="switch" accessibilityState={{ checked: on }}>
      <Animated.View style={[styles.thumb, thumb]} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', paddingHorizontal: space.sm, paddingTop: space.sm, height: 60, alignItems: 'center' },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  body: { paddingBottom: 80 },
  heading: { fontSize: 40, fontWeight: '300', paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg },
  section: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, marginHorizontal: space.xl },
  sectionTitle: { fontSize: 15, paddingVertical: space.md },
  note: { fontSize: 13, lineHeight: 19, paddingBottom: space.md },
  accountName: { fontSize: 14, fontWeight: '600', paddingTop: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg, minHeight: 60 },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 18, fontWeight: '600' },
  rowDetail: { fontSize: 14, lineHeight: 19 },
  rowValue: { fontSize: 16 },
  track: { width: 52, height: 30, borderRadius: 15, padding: 3 },
  thumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: space.lg, paddingBottom: space.xl },
  sheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: space.sm },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md },
  keyInput: { borderRadius: 12, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: 16 },
  codeInput: { minHeight: 120, maxHeight: 200, fontSize: 13, fontFamily: 'monospace' },
  step: { flexDirection: 'row', gap: space.md, marginBottom: space.sm },
  stepNumber: { width: 16, fontWeight: '700' },
  stepText: { flex: 1, fontSize: 15, lineHeight: 21 },
  openPage: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 18, paddingHorizontal: space.lg, paddingVertical: space.sm, marginVertical: space.md },
  keySave: { marginTop: space.lg, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  profileInput: { minHeight: 140, maxHeight: 240, fontSize: 15, lineHeight: 21 },
  profileButtons: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm },
  profileSave: { height: 48, borderRadius: 24, paddingHorizontal: space.xl, alignItems: 'center', justifyContent: 'center' },
})
