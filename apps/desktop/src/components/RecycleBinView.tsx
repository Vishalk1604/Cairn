import type { NoteQuery } from '@cairn/sync'
import { binCountdown, noteHeading, recycleBin } from '@cairn/ui'
import { useActions } from '../app/actions'
import { useCairn } from '../app/context'
import { useObserved } from '../app/hooks'
import { BackIcon, BinIcon } from './icons'
import { Row } from './SettingsParts'

const WITH_DELETED: NoteQuery = { includeDeleted: true }

/**
 * Deleted notes, for thirty days, on a page of their own. After that Cairn
 * deletes them for good — from every device, from the cloud, and their
 * photos and recordings from Drive.
 */
export function RecycleBinView({ onBack }: { onBack: () => void }) {
  const { notes } = useCairn()
  const actions = useActions()
  const bin = recycleBin(useObserved(notes, WITH_DELETED), Date.now())
  return (
    <section className="view settings" aria-label="Recycle bin">
      <button type="button" className="back-link" onClick={onBack}>
        <BackIcon size={16} />
        Settings
      </button>
      <header className="view-head keep">
        <h1 className="view-title">Recycle bin</h1>
        <span className="view-sub">{bin.length === 1 ? '1 note' : `${bin.length} notes`}</span>
      </header>
      <p className="settings-note">Deleted notes stay here for 30 days, then they are deleted for good, from every device and with their photos and recordings.</p>
      {bin.length === 0 ? (
        <div className="empty">
          <span className="empty-icon">
            <BinIcon size={30} />
          </span>
          <p>The recycle bin is empty. Notes you delete on any device wait here.</p>
        </div>
      ) : (
        <div className="settings-card bin-list">
          {bin.map(({ note, daysLeft }) => (
            <Row key={note.id} title={noteHeading(note)} detail={binCountdown(daysLeft)} tone={daysLeft <= 3 ? 'danger' : undefined}>
              <button type="button" className="button" onClick={() => void actions.restoreNote(note)}>
                Restore
              </button>
            </Row>
          ))}
        </div>
      )}
    </section>
  )
}
