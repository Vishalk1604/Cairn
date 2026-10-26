import { isRealFolder, type Folder } from '@cairn/ui'
import type { ReactNode } from 'react'
import { ClassIcon, DoneIcon, FolderIcon, InboxIcon, NotesIcon, PinIcon, SettingsIcon, TasksIcon } from './icons'

export type Section = 'tasks' | 'notes' | 'inbox' | 'classroom' | 'done' | 'settings' | 'bin'

interface Props {
  section: Section
  folder: string
  folders: Folder[]
  pinned: readonly string[]
  taskCount: number
  overdue: number
  /** New important mail and new Classroom posts since each was last opened. */
  unseen: { inbox: number; classroom: number }
  onSection: (section: Section) => void
  onFolder: (folder: string) => void
  onTogglePin?: (tag: string) => void
}

/**
 * The full app's left column: where you are, and every folder at a glance.
 * Folders are note tags, as on the phone, so they list under Notes.
 */
export function Sidebar({ section, folder, folders, pinned, taskCount, overdue, unseen, onSection, onFolder, onTogglePin }: Props) {
  return (
    <nav className="sidebar" aria-label="Cairn">
      <div className="nav-group">
        <NavItem icon={<TasksIcon />} label="Tasks" on={section === 'tasks'} onClick={() => onSection('tasks')}>
          {overdue > 0 ? <span className="nav-badge danger">{overdue} late</span> : <span className="nav-count">{taskCount || ''}</span>}
        </NavItem>
        <NavItem icon={<NotesIcon />} label="Notes" on={section === 'notes' && folder === ''} onClick={() => onFolder('')}>
          <span className="nav-count">{folders[0]?.count || ''}</span>
        </NavItem>
        <NavItem icon={<InboxIcon />} label="Inbox" on={section === 'inbox'} onClick={() => onSection('inbox')}>
          {unseen.inbox > 0 && <span className="nav-badge">{unseen.inbox} new</span>}
        </NavItem>
        <NavItem icon={<ClassIcon />} label="Classroom" on={section === 'classroom'} onClick={() => onSection('classroom')}>
          {unseen.classroom > 0 && <span className="nav-badge">{unseen.classroom} new</span>}
        </NavItem>
        <NavItem icon={<DoneIcon />} label="Completed" on={section === 'done'} onClick={() => onSection('done')} />
      </div>

      <h2 className="nav-heading">Folders</h2>
      <div className="nav-group nav-folders">
        {folders.slice(1).length === 0 && <p className="nav-empty">Add #tags to a note and it is filed into a folder here.</p>}
        {folders.slice(1).map((f) => (
          <div key={f.id} className="nav-folder-row">
            <NavItem
              icon={<FolderIcon size={18} />}
              label={f.name}
              on={section === 'notes' && folder === f.id}
              onClick={() => onFolder(f.id)}
            >
              <span className="nav-count">{f.count}</span>
            </NavItem>
            {onTogglePin && isRealFolder(f.id) && (
              <button
                type="button"
                className={`nav-pin ${pinned.includes(f.id) ? 'on' : ''}`}
                aria-label={pinned.includes(f.id) ? `Unpin ${f.name}` : `Pin ${f.name}`}
                title={pinned.includes(f.id) ? 'Unpin' : 'Pin to the top'}
                onClick={() => onTogglePin(f.id)}
              >
                <PinIcon size={14} filled={pinned.includes(f.id)} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="nav-foot">
        <NavItem icon={<SettingsIcon />} label="Settings" on={section === 'settings' || section === 'bin'} onClick={() => onSection('settings')} />
      </div>
    </nav>
  )
}

function NavItem({ icon, label, on, onClick, children }: { icon: ReactNode; label: string; on: boolean; onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" className={`nav-item ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {children}
    </button>
  )
}
