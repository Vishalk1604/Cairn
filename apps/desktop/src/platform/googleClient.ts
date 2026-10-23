import { GOOGLE_CLIENTS } from '@cairn/sync'

/**
 * Google requires this at the token exchange for a Desktop client, even
 * alongside PKCE. It is not confidential for an installed app — it ships in
 * the executable — but it is kept out of the repository and injected at
 * build time all the same. See .env.example.
 */
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET

/** Shared by both platforms: the same build signs in the same way either way. */
export const googleClientId = GOOGLE_CLIENTS.desktop

export function googleClientSecret(): string {
  if (!CLIENT_SECRET) {
    throw new Error(
      'This build has no Google client secret. Copy apps/desktop/.env.example to .env.local, fill it in, and rebuild.',
    )
  }
  return CLIENT_SECRET
}
