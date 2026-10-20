import { useState } from 'react'
import { owner, sources } from '../app/accounts'
import { useCairn } from '../app/context'
import { AccountsDialog } from './AccountsDialog'

/**
 * Where syncing stands, and the way to change it.
 *
 * Signing in is optional on purpose: Cairn works fully signed out, with
 * everything on this machine. The bar says which of the two you are in,
 * because "where is my data" should never be a guess.
 */
export function AccountBar() {
  const { auth, accounts, signIn } = useCairn()
  const [managing, setManaging] = useState(false)

  if (auth.status === 'loading') return null

  const holder = owner(accounts)
  const extra = sources(accounts).length

  return (
    <>
      <div className="account">
        <span className={`account-dot ${auth.status === 'synced' ? 'synced' : ''}`} aria-hidden="true" />
        <span className="account-who">
          {auth.status === 'connecting' && 'Finish signing in in your browser…'}
          {auth.status === 'error' && (
            <span className="error-text" role="alert">
              {auth.message}
            </span>
          )}
          {auth.status === 'local' && 'Saved on this computer only'}
          {auth.status === 'synced' && holder && (
            <>
              Syncing as <strong>{holder.identity.email}</strong>
              {extra > 0 && <span className="badge">{extra === 1 ? '+1 account' : `+${extra} accounts`}</span>}
            </>
          )}
        </span>
        <span className="spacer" />
        {holder ? (
          <button type="button" className="quiet" onClick={() => setManaging(true)}>
            Accounts
          </button>
        ) : (
          <button type="button" disabled={auth.status === 'connecting'} onClick={() => void signIn()}>
            {auth.status === 'error' ? 'Try again' : 'Sign in to sync'}
          </button>
        )}
      </div>
      {managing && <AccountsDialog onClose={() => setManaging(false)} />}
    </>
  )
}
