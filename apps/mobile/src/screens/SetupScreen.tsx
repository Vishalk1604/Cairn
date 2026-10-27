import { DEFAULT_PROFILE, PROFILE_LIMIT } from '@cairn/core'
import { AiError, checkAiKey, modelsFor, readAiSetup } from '@cairn/sync'
import { reading, type WorkerAccount } from '@cairn/ui'
import { useState, type ReactNode } from 'react'
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { Switch } from '../components/Switch'
import { LOCAL_USER, useCairn } from '../state/context'
import { useInbox } from '../state/inbox'
import { useToast } from '../state/toast'
import { radius, space, useColors } from '../theme'
import { fadeIn, Tap } from '../ui/motion'
import { NVIDIA_PAGE } from './SettingsScreen'

type Step = 'signin' | 'college' | 'watch' | 'ai' | 'done'
const STEPS: Step[] = ['signin', 'college', 'watch', 'ai']

/**
 * Setting Cairn up, the first time: four screens, each one skippable. Sign
 * in with your own Google account; add your college account; choose what to
 * watch; turn on AI sorting. Everything is set up here, on the phone — the
 * computer then needs only to be signed in.
 */
export function SetupScreen({ onDone }: { onDone: () => void }) {
  const c = useColors()
  const toast = useToast()
  const cairn = useCairn()
  const inbox = useInbox()
  const [step, setStep] = useState<Step>(cairn.userId === LOCAL_USER ? 'signin' : 'college')
  const [busy, setBusy] = useState<string | null>(null)
  const [autoTasks, setAutoTasks] = useState(true)
  const [pasted, setPasted] = useState('')
  const [profile, setProfile] = useState(inbox.profile === DEFAULT_PROFILE ? '' : inbox.profile)
  const [problem, setProblem] = useState<string | null>(null)
  const signedIn = cairn.userId !== LOCAL_USER

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setProblem(null)
    try {
      await action()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const next = () => {
    setProblem(null)
    if (step === 'watch') void inbox.setAutoTasks(autoTasks)
    const at = STEPS.indexOf(step as (typeof STEPS)[number])
    // Without an account there is nothing else to set up.
    if (step === 'signin' && !signedIn) return onDone()
    setStep(at >= 0 && at < STEPS.length - 1 ? STEPS[at + 1]! : 'done')
  }

  const toggle = (account: WorkerAccount, what: 'mail' | 'classroom') =>
    void run(`${account.email}:${what}`, async () => {
      if (reading(account, what)) return cairn.watch(account.email, { [what]: false })
      if (!account.services.includes(what)) await cairn.grant(account.email, [what])
      await cairn.watch(account.email, { [what]: true })
    })

  const read = pasted.trim() ? readAiSetup(pasted) : null
  const saveAi = () =>
    void run('ai', async () => {
      if (profile.trim()) await inbox.setProfile(profile)
      if (!read) return next()
      if (!read.ok) throw new Error(read.error)
      try {
        const model = await checkAiKey(read.setup)
        await cairn.ai.save(read.setup)
        toast({ message: `Key works. Mail will be sorted by ${model}.` })
      } catch (error) {
        throw error instanceof AiError && error.badKey ? new Error('NVIDIA did not accept that key. Copy it again from the NVIDIA page.') : error
      }
      next()
    })

  const number = STEPS.indexOf(step as (typeof STEPS)[number]) + 1

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={styles.bar}>
        {step !== 'done' && <Text style={{ color: c.faint }}>{number} of {STEPS.length}</Text>}
        <View style={styles.flex} />
        {step !== 'done' && (
          <Tap onPress={next} scaleTo={0.94} style={styles.skip} accessibilityLabel="Skip this step">
            <Text style={{ color: c.muted, fontSize: 16 }}>{step === 'signin' && !signedIn ? 'Skip setup' : 'Skip'}</Text>
          </Tap>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Animated.View key={step} entering={fadeIn} style={styles.page}>
          {step === 'signin' && (
            <>
              <Heading title="Sign in with your Google account" detail="Your own account holds your notes and tasks, keeps them in step with Cairn on your laptop, and is where photos in your notes are kept, in your Drive." />
              {signedIn ? (
                <>
                  <Text style={[styles.done, { color: c.fg }]}>Signed in as {cairn.email}.</Text>
                  <Primary label="Next" onPress={next} />
                </>
              ) : (
                <Primary label="Sign in with Google" busy={busy === 'signin' || cairn.auth.status === 'connecting'} onPress={() => void run('signin', cairn.signIn)} />
              )}
              {cairn.auth.status === 'error' && <Text style={[styles.problem, { color: c.danger }]}>{cairn.auth.message}</Text>}
              <Text style={[styles.small, { color: c.faint }]}>Google may say it hasn't verified Cairn: choose Advanced, then Go to Cairn.</Text>
            </>
          )}

          {step === 'college' && (
            <>
              <Heading
                title="Add your college account?"
                detail="Cairn can read its Gmail and Google Classroom: new coursework and announcements, and the deadlines in your mail. It only reads — it never sends, changes or deletes anything."
              />
              <Primary label="Add college account" busy={busy === 'college'} onPress={() => void run('college', async () => {
                await cairn.addAccount()
                setStep('watch')
              })} />
              <Secondary label="Not now" onPress={next} />
            </>
          )}

          {step === 'watch' && (
            <>
              <Heading title="What should Cairn watch?" detail="Cairn's server checks these every ten minutes, even with your phone off, and tells you when something needs you." />
              {inbox.accounts.length === 0 && (
                <View style={[styles.card, { backgroundColor: c.surface }]}>
                  <ActivityIndicator color={c.accent} />
                  <Text style={{ color: c.muted, textAlign: 'center' }}>Waiting for Cairn's server…</Text>
                </View>
              )}
              {inbox.accounts.map((account) => (
                <View key={account.email} style={[styles.card, { backgroundColor: c.surface }]}>
                  <Text style={[styles.account, { color: c.fg }]} numberOfLines={1}>
                    {account.email}
                  </Text>
                  <Toggle label="Gmail" detail="Important mail and deadlines" on={reading(account, 'mail')} busy={busy === `${account.email}:mail`} onPress={() => toggle(account, 'mail')} />
                  <Toggle
                    label="Classroom"
                    detail="New coursework and announcements"
                    on={reading(account, 'classroom')}
                    busy={busy === `${account.email}:classroom`}
                    onPress={() => toggle(account, 'classroom')}
                  />
                </View>
              ))}
              <View style={[styles.card, { backgroundColor: c.surface }]}>
                <Toggle label="Add tasks automatically" detail="Coursework at its due date, ticked off when you hand it in" on={autoTasks} onPress={() => setAutoTasks(!autoTasks)} />
              </View>
              <Primary label="Next" onPress={next} />
            </>
          )}

          {step === 'ai' && (
            <>
              <Heading
                title="Sort mail with AI"
                detail="With a free NVIDIA key, each new email and Classroom post is read to pick out what matters, file it into folders and find its deadline. Open the NVIDIA page, sign in, press “Get API Key”, and paste the key or the code it shows here."
              />
              <Secondary label="Open the NVIDIA page" onPress={() => void Linking.openURL(NVIDIA_PAGE)} />
              <TextInput
                value={pasted}
                onChangeText={(text) => {
                  setPasted(text)
                  setProblem(null)
                }}
                placeholder="Paste the nvapi- key, or the Shell code"
                placeholderTextColor={c.faint}
                style={[styles.input, styles.code, { color: c.fg, backgroundColor: c.surfaceHigh }]}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                textAlignVertical="top"
                accessibilityLabel="NVIDIA code or key"
              />
              {read?.ok && <Text style={{ color: c.muted }}>Found a key{read.setup.model ? ` for ${modelsFor(read.setup)[0]?.label}` : ''}.</Text>}
              {read && !read.ok && <Text style={{ color: c.danger }}>{read.error}</Text>}
              <Text style={[styles.label, { color: c.fg }]}>What matters to you</Text>
              <TextInput
                value={profile}
                onChangeText={setProfile}
                multiline
                maxLength={PROFILE_LIMIT}
                placeholder={DEFAULT_PROFILE}
                placeholderTextColor={c.faint}
                style={[styles.input, styles.profile, { color: c.fg, backgroundColor: c.surfaceHigh }]}
                textAlignVertical="top"
                accessibilityLabel="What matters to you"
              />
              {busy === 'ai' && <Text style={{ color: c.muted }}>Asking NVIDIA. Its free tier can take a minute or two to answer.</Text>}
              <Primary label={read ? 'Check and save' : 'Next'} busy={busy === 'ai'} onPress={saveAi} />
            </>
          )}

          {step === 'done' && (
            <>
              <Heading title="You're set up" detail="Cairn's server now checks your mail and Classroom every ten minutes and lets you know what needs you." />
              {signedIn && (
                <View style={[styles.card, { backgroundColor: c.surface }]}>
                  <Text style={[styles.account, { color: c.fg }]}>On your laptop</Text>
                  <Text style={{ color: c.muted, fontSize: 16, lineHeight: 23 }}>
                    Install Cairn and sign in with {cairn.email}. Everything you set up here shows there too.
                  </Text>
                </View>
              )}
              <Primary label="Open Cairn" onPress={onDone} />
            </>
          )}

          {problem && <Text style={[styles.problem, { color: c.danger }]}>{problem}</Text>}
        </Animated.View>
      </ScrollView>
    </View>
  )
}

function Heading({ title, detail }: { title: string; detail: string }) {
  const c = useColors()
  return (
    <View style={styles.heading}>
      <Text style={[styles.title, { color: c.fg }]}>{title}</Text>
      <Text style={[styles.detail, { color: c.muted }]}>{detail}</Text>
    </View>
  )
}

function Primary({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  const c = useColors()
  return (
    <Tap onPress={onPress} disabled={busy} scaleTo={0.96} haptic="medium" style={[styles.primary, { backgroundColor: c.accent }]}>
      {busy ? <ActivityIndicator color={c.onAccent} /> : <Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 17 }}>{label}</Text>}
    </Tap>
  )
}

function Secondary({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useColors()
  return (
    <Tap onPress={onPress} scaleTo={0.96} style={[styles.secondary, { borderColor: c.line }]}>
      <Text style={{ color: c.fg, fontWeight: '600', fontSize: 16 }}>{label}</Text>
    </Tap>
  )
}

function Toggle({ label, detail, on, busy, onPress }: { label: string; detail: string; on: boolean; busy?: boolean; onPress: () => void }): ReactNode {
  const c = useColors()
  return (
    <Tap onPress={onPress} scaleTo={0.985} style={styles.toggle} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label}>
      <View style={styles.flex}>
        <Text style={{ color: c.fg, fontSize: 17, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: c.muted, fontSize: 14 }}>{detail}</Text>
      </View>
      {busy ? <ActivityIndicator color={c.accent} /> : <Switch on={on} />}
    </Tap>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, height: 56 },
  skip: { paddingVertical: space.sm, paddingLeft: space.lg },
  body: { paddingHorizontal: space.xl, paddingBottom: 80 },
  page: { gap: space.lg },
  heading: { gap: space.md, paddingTop: space.xl, paddingBottom: space.sm },
  title: { fontSize: 32, fontWeight: '300', lineHeight: 38 },
  detail: { fontSize: 16, lineHeight: 23 },
  done: { fontSize: 17 },
  card: { borderRadius: radius.card + 4, padding: space.lg, gap: space.sm },
  account: { fontSize: 17, fontWeight: '700' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  primary: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginTop: space.sm },
  secondary: { height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  input: { borderRadius: 12, paddingHorizontal: space.lg, paddingVertical: space.md },
  code: { minHeight: 110, maxHeight: 180, fontSize: 13, fontFamily: 'monospace' },
  profile: { minHeight: 110, maxHeight: 200, fontSize: 15, lineHeight: 21 },
  label: { fontSize: 16, fontWeight: '600', marginTop: space.sm },
  problem: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 19 },
})
