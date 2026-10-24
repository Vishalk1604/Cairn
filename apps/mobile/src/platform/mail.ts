import type { MailMessage } from '@cairn/core'
import { gmailLink } from '@cairn/sync'
import { startActivityAsync } from 'expo-intent-launcher'
import { Linking, Platform } from 'react-native'

const GMAIL_APP = 'com.google.android.gm'

/**
 * Opens a message where it lives. A Classroom post opens in Classroom. An
 * email is handed to the Gmail app with a link to its conversation; Gmail
 * has no documented way to be opened at one email, so where the app will
 * not take the link it opens in the browser at that conversation instead.
 */
export async function openMessage(message: MailMessage): Promise<void> {
  if (message.classroom) {
    if (message.classroom.link) await Linking.openURL(message.classroom.link)
    return
  }
  const url = gmailLink(message)
  if (Platform.OS === 'android') {
    // The promise settles only when the person comes back from Gmail, so
    // only a refusal straight away (no Gmail app, or it would not take the
    // link) sends the link to the browser instead.
    const refused = await Promise.race([
      startActivityAsync('android.intent.action.VIEW', { data: url, packageName: GMAIL_APP }).then(
        () => false,
        () => true,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
    ])
    if (!refused) return
  }
  await Linking.openURL(url)
}
