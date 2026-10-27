import { modelsFor, storedAiSetup, type AiSetup } from '@cairn/sync/ai'
import { CLASSROOM_BLOCKED, type AccountsDoc, type WorkerAccount } from '@cairn/sync/worker'
import { open } from './crypto'
import type { Env } from './env'
import type { Firestore } from './firestore'
import { servicesOf } from './google'
import { firestoreFor, type Ctx } from './session'
import type { AccountRow, UserRow } from './store'

/**
 * Whether Classroom is read from its notification emails: chosen, with
 * Gmail granted, and the API either never granted or turned away.
 */
export function classroomByEmail(row: Pick<AccountRow, 'scopes' | 'watchClassroom' | 'problem'>): boolean {
  const services = servicesOf(row.scopes)
  return row.watchClassroom && services.includes('mail') && (!services.includes('classroom') || row.problem === CLASSROOM_BLOCKED)
}

/**
 * The accounts document the apps show: who is connected, for what, and
 * whether AI sorting is on. Never a token or the key — the rules refuse
 * those anyway.
 */
export function accountsDoc(rows: readonly AccountRow[], ai: AiSetup | null, now: number): AccountsDoc {
  return {
    accounts: rows.map(
      (row): WorkerAccount => ({
        email: row.email,
        role: row.role,
        services: servicesOf(row.scopes),
        watch: { mail: row.watchMail, classroom: row.watchClassroom },
        ...(row.problem ? { problem: row.problem } : {}),
        ...(classroomByEmail(row) ? { classroomVia: 'email' as const } : {}),
      }),
    ),
    ai: ai ? { on: true, ...(modelsFor(ai)[0] ? { preferred: modelsFor(ai)[0]!.label } : {}) } : { on: false },
    updatedAt: now,
  }
}

export async function aiSetupOf(env: Env, user: Pick<UserRow, 'uid' | 'ai'> | null): Promise<AiSetup | null> {
  if (!user?.ai) return null
  try {
    return storedAiSetup(await open(env, user.ai, aiContext(user.uid)))
  } catch {
    return null
  }
}

export const aiContext = (uid: string) => `ai:${uid}`

/** Writes the accounts document after anything about the accounts changed. */
export async function publishAccounts(ctx: Ctx, uid: string, firestore?: Firestore): Promise<AccountsDoc> {
  const [rows, user] = await Promise.all([ctx.store.accounts(uid), ctx.store.user(uid)])
  const doc = accountsDoc(rows, await aiSetupOf(ctx.env, user), ctx.now)
  const fs = firestore ?? (await firestoreFor(ctx, uid, rows.find((r) => r.role === 'owner')))
  await fs.write([{ kind: 'set', path: `users/${uid}/settings/accounts`, data: doc as unknown as Record<string, unknown> }])
  return doc
}
