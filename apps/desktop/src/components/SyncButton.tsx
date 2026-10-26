import { formatAgo } from '@cairn/ui'
import { SyncIcon } from './icons'

/**
 * Sync now, with its state beside it: the arrows turn while it works, and
 * the line says when it last finished, so a glance answers "is this up to
 * date?".
 */
export function SyncButton({ busy, at, onClick, label = 'Sync now', caption = true }: { busy: boolean; at: number | null; onClick: () => void; label?: string; caption?: boolean }) {
  const text = busy ? 'Syncing…' : at ? `Synced ${formatAgo(at, Date.now())}` : 'Not synced yet'
  return (
    <span className="sync">
      <button type="button" className={`icon sync-button ${busy ? 'busy' : ''}`} aria-label={busy ? 'Syncing' : label} title={busy ? 'Syncing…' : `${label} · ${text}`} aria-busy={busy} onClick={() => !busy && onClick()}>
        <SyncIcon size={18} />
      </button>
      {caption && <span className="sync-text">{text}</span>}
    </span>
  )
}
