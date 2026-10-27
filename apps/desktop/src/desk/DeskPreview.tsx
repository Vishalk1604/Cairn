import type { ReminderQuery } from '@cairn/sync'
import { useActions } from '../app/actions'
import { useCairn } from '../app/context'
import { useNow, useObserved } from '../app/hooks'
import { useToast } from '../app/toast'
import { DeskView } from './DeskView'
import { useDeskData } from './useDesk'

const ACTIVE: ReminderQuery = { status: ['pending', 'snoozed'] }

/** localhost:1420/?preview&desk: the pinned widget over a stand-in wallpaper, fed in the page rather than by the main window. */
export function DeskPreview() {
  const { reminders } = useCairn()
  const active = useObserved(reminders, ACTIVE)
  const data = useDeskData(active, useNow(active))
  const actions = useActions()
  const toast = useToast()
  return (
    <div className="desk-wallpaper">
      <div className="desk-frame">
        <DeskView
          data={data}
          onComplete={(id) => {
            const reminder = active.find((r) => r.id === id)
            if (reminder) void actions.complete(reminder)
          }}
          onOpen={(id) => toast({ message: id ? `Would open the full app on ${id}` : 'Would open the full app' })}
          onDrag={() => {}}
        />
      </div>
    </div>
  )
}
