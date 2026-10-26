import type { ReactNode } from 'react'

/** The pieces every settings-like page is built from, so the Classroom tab's file controls look like Settings. */
export function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="settings-heading">{title}</h2>
      {note && <p className="settings-note">{note}</p>}
      <div className="settings-card">{children}</div>
    </section>
  )
}

export function Row({ title, detail, tone, head, children }: { title: ReactNode; detail?: ReactNode; tone?: 'danger'; head?: boolean; children?: ReactNode }) {
  return (
    <div className={`settings-row ${head ? 'head' : ''}`}>
      <div className="settings-row-text">
        <span className="settings-row-title">{title}</span>
        {detail && <span className={`settings-row-detail ${tone ?? ''}`}>{detail}</span>}
      </div>
      {children && <div className="settings-row-actions">{children}</div>}
    </div>
  )
}

/** A row that opens a page of its own. */
export function LinkRow({ title, detail, onClick }: { title: string; detail?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="settings-row link" onClick={onClick}>
      <span className="settings-row-text">
        <span className="settings-row-title">{title}</span>
        {detail && <span className="settings-row-detail">{detail}</span>}
      </span>
      <span className="chevron" aria-hidden="true">
        ›
      </span>
    </button>
  )
}

export function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  )
}
