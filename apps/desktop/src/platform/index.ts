import type { Platform } from './types'
import { webPlatform } from './web'

export type { AppNotification, PermissionState, Platform } from './types'

export function detectPlatform(): Platform {
  return webPlatform
}
