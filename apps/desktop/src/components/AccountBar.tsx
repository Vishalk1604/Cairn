import { useCairn } from '../app/context'

/**
 * Where syncing stands, and the one control that changes it.
 *
 * Signing in is optional on purpose: Cairn works fully signed out, with
 * everything on this machine. The bar says which of the two you are in,
 * because "where is my data" should never be a guess.
 */
export function AccountBar() {
  const { auth, signIn, signOut } = useCairn()

  if (auth.status === 'loading') return null

  if (auth.status === 'synced') {
    const { account } = auth
    return (
      <div className="account">
        <span className="account-dot synced" aria-hidden="true" />
        <span className="account-who">
          Syncing as <strong>{account.email}</strong>
          {account.domain && <span className="badge">{account.domain}</span>}
        </span>
        <span className="spacer" />
        <button type="button" className="quiet" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    )
  }

  if (auth.status === 'connecting') {
    return (
      <div className="account" aria-live="polite">
        <span className="account-dot" aria-hidden="true" />
        <span className="account-who">Finish signing in in your browser…</span>
      </div>
    )
  }

  return (
    <div className="account">
      <span className="account-dot" aria-hidden="true" />
      <span className="account-who">
        {auth.status === 'error' ? (
          <span className="error-text" role="alert">
            {auth.message}
          </span>
        ) : (
          'Saved on this computer only'
        )}
      </span>
      <span className="spacer" />
      <button type="button" onClick={() => void signIn()}>
        {auth.status === 'error' ? 'Try again' : 'Sign in to sync'}
      </button>
    </div>
  )
}
