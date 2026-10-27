import type { CSSProperties, MouseEvent } from 'react'
import type { DeskData } from './feed'

/**
 * Today, on the wallpaper. A tinted panel so it reads on light and dark
 * wallpapers alike; each task with its urgency's colour and symbol, late
 * ones pulsing slowly (unless motion is turned down), and its class's colour
 * for coursework. Click a circle to tick a task off; double-click anywhere
 * for the full app. The header moves it.
 */
export function DeskView({
  data,
  onComplete,
  onOpen,
  onDrag,
}: {
  data: DeskData | null
  onComplete: (id: string) => void
  onOpen: (id?: string) => void
  onDrag: () => void
}) {
  const counts = data ? [data.classroom ? `${data.classroom} new in Classroom` : '', data.mail ? `${data.mail} important email${data.mail === 1 ? '' : 's'}` : ''].filter(Boolean) : []
  const drag = (event: MouseEvent) => {
    // Only a plain press on the header moves it; a double-click there still opens the app.
    if (event.button === 0 && event.detail === 1) onDrag()
  }
  return (
    <main className="desk" onDoubleClick={() => onOpen()} aria-label="Cairn: today">
      <header className="desk-head" onMouseDown={drag}>
        <span className="desk-title">Today</span>
        <span className="desk-date">{data?.date}</span>
      </header>
      {data === null ? (
        <p className="desk-empty">Opening Cairn…</p>
      ) : (
        <>
          <ul className="desk-list">
            {data.rows.map((row) => (
              <li
                key={row.id}
                className={`desk-row ${row.course ? 'course' : ''}`}
                data-urgency={row.urgency}
                style={{ '--urgency': row.color, '--course': row.course } as CSSProperties}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  onOpen(row.id)
                }}
              >
                <button
                  type="button"
                  className="desk-check"
                  aria-label={`Complete ${row.title}`}
                  title="Mark done"
                  onClick={() => onComplete(row.id)}
                  onDoubleClick={(event) => event.stopPropagation()}
                />
                <span className="desk-text">
                  <span className="desk-task">{row.title}</span>
                  <span className="desk-when">
                    {row.urgency === 'overdue' || row.urgency === 'soon' ? (
                      <span className="desk-cue">
                        {row.symbol} {row.label} ·{' '}
                      </span>
                    ) : null}
                    {row.when}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {data.empty && <p className="desk-empty">{data.empty}</p>}
          <footer className="desk-foot">
            {data.more > 0 && <span>{data.more} more due today</span>}
            {counts.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </footer>
        </>
      )}
    </main>
  )
}
