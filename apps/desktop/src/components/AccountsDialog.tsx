import { featuresOf, owner, sources, type Account, type SourceFeatures } from '@cairn/ui'
import { useState } from 'react'
import { useCairn } from '../app/context'
import { useModal } from '../app/useModal'

/**
 * Which Google accounts Cairn is using, and for what.
 *
 * One account holds everything: notes, reminders and attachments. Any others
 * are read-only sources — a second inbox, a university's Classroom — so that
 * losing one of those, when a university closes the account, takes nothing
 * with it.
 */
export function AccountsDialog({ onClose }: { onClose: () => void }) {
  const { accounts, signOut, connectSource, regrant, disconnectSource } = useCairn()
  const modal = useModal(onClose)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<SourceFeatures | null>(null)

  const holder = owner(accounts)
  const others = sources(accounts)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      setAdding(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={modal.ref} className="editor accounts-dialog" onKeyDown={modal.onKeyDown} aria-label="Google accounts">
      <h2>Accounts</h2>

      {holder && (
        <section className="account-group">
          <h3>Holds your data</h3>
          <AccountRow account={holder} />
          <p className="hint">Notes, reminders and attachments live in this account's Drive and database.</p>
        </section>
      )}

      <section className="account-group">
        <h3>Read for deadlines</h3>
        {others.length === 0 && <p className="hint">No other accounts. Add one to watch a second inbox, such as your university's.</p>}
        {others.map((account) => (
          <div key={account.identity.sub} className="account-row-wrap">
            <AccountRow account={account} />
            <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => disconnectSource(account.identity.sub))}>
              Remove
            </button>
          </div>
        ))}
      </section>

      {adding ? (
        <section className="account-group">
          <h3>What should Cairn read from it?</h3>
          <label className="inline">
            <input type="checkbox" checked={adding.mail} onChange={(e) => setAdding({ ...adding, mail: e.target.checked })} />
            Gmail — find deadlines in messages
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={adding.classroom}
              onChange={(e) => setAdding({ ...adding, classroom: e.target.checked })}
            />
            Classroom — assignments and their due dates
          </label>
          <p className="hint">
            You'll be asked to pick the account in your browser. Nothing is ever written to it.
          </p>
          <div className="editor-actions">
            <button type="button" disabled={busy} onClick={() => setAdding(null)}>
              Cancel
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="primary"
              disabled={busy || (!adding.mail && !adding.classroom)}
              onClick={() => void run(() => connectSource(adding))}
            >
              {busy ? 'Waiting for your browser…' : 'Connect'}
            </button>
          </div>
        </section>
      ) : (
        <button type="button" disabled={busy} onClick={() => setAdding({ mail: true, classroom: false })}>
          Connect another account
        </button>
      )}

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <div className="editor-actions">
        {holder && (
          <button type="button" className="quiet" disabled={busy} onClick={() => void run(signOut)}>
            Sign out of everything
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="primary" onClick={modal.close}>
          Done
        </button>
      </div>
    </dialog>
  )

  function AccountRow({ account }: { account: Account }) {
    const features = featuresOf(account)
    const reading = [features.mail ? 'Gmail' : null, features.classroom ? 'Classroom' : null].filter(Boolean)
    const missing: SourceFeatures = { mail: !features.mail, classroom: !features.classroom }

    return (
      <div className="account-row">
        <div className="account-row-main">
          <span className="account-email">{account.identity.email}</span>
          {account.identity.domain && <span className="badge">{account.identity.domain}</span>}
          <span className="hint">
            {reading.length > 0 ? `Reading ${reading.join(' and ')}` : 'Signed in only'}
          </span>
        </div>
        {account.role === 'source' && missing.classroom && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => void run(() => regrant(account, { mail: features.mail, classroom: true }))}
          >
            Add Classroom
          </button>
        )}
        {account.role === 'source' && missing.mail && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => void run(() => regrant(account, { mail: true, classroom: features.classroom }))}
          >
            Add Gmail
          </button>
        )}
      </div>
    )
  }
}
