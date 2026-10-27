import { DEFAULT_PROFILE, PROFILE_LIMIT } from '@cairn/core'
import { useState } from 'react'
import { useModal } from '../app/useModal'

/**
 * What the model is told matters, in the person's own words. Cairn's server
 * sends it with every message the model reads.
 */
export function ProfileDialog({ profile, onSave, onClose }: { profile: string; onSave: (text: string) => void; onClose: () => void }) {
  const modal = useModal(onClose)
  const [text, setText] = useState(profile)
  return (
    <dialog ref={modal.ref} className="editor" onKeyDown={modal.onKeyDown} aria-label="What matters to you">
      <h2>What matters to you</h2>
      <p className="dialog-text">Say what you want in Important and what you don't, in your own words. The AI reads every email and Classroom post with this in mind.</p>
      <textarea className="profile-input" value={text} maxLength={PROFILE_LIMIT} onChange={(e) => setText(e.target.value)} placeholder={DEFAULT_PROFILE} aria-label="What matters to you" />
      <p className="hint">
        {text.length}/{PROFILE_LIMIT}
      </p>
      <div className="editor-actions">
        <button type="button" className="quiet" onClick={() => setText(DEFAULT_PROFILE)}>
          Use the default
        </button>
        <span className="spacer" />
        <button type="button" onClick={modal.close}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            onSave(text)
            modal.close()
          }}
        >
          Save
        </button>
      </div>
    </dialog>
  )
}
