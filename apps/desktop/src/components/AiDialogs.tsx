import { DEFAULT_PROFILE, PROFILE_LIMIT } from '@cairn/core'
import { AiError, checkAiKey, modelsFor, readAiSetup, type AiSetup } from '@cairn/sync'
import { useState } from 'react'
import { useCairn } from '../app/context'
import { useModal } from '../app/useModal'

/** Where the key comes from. Any model page there gives the same kind of key. */
const NVIDIA_PAGE = 'https://build.nvidia.com/openai/gpt-oss-20b'

/**
 * NVIDIA's model pages give out a code sample with the key written into it,
 * not a bare key, so the whole sample is pasted here and read. It is checked
 * against NVIDIA before it is kept, so a bad paste shows here rather than as
 * a silent inbox. Saved, it reaches the phone too.
 */
export function AiKeyDialog({ onSave, onClose }: { onSave: (setup: AiSetup, model: string) => Promise<void>; onClose: () => void }) {
  const { platform } = useCairn()
  const modal = useModal(onClose)
  const [pasted, setPasted] = useState('')
  const [checking, setChecking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const read = pasted.trim() ? readAiSetup(pasted) : null

  const save = async () => {
    if (!read) return
    if (!read.ok) return setProblem(read.error)
    setChecking(true)
    setProblem(null)
    try {
      const model = await checkAiKey(read.setup, { fetchFn: platform.aiFetch })
      await onSave(read.setup, model)
      modal.close()
    } catch (error) {
      setProblem(
        error instanceof AiError && error.badKey
          ? 'NVIDIA did not accept that key. Copy the code again from the NVIDIA page.'
          : `Couldn't reach NVIDIA: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      setChecking(false)
    }
  }

  return (
    <dialog ref={modal.ref} className="editor" onKeyDown={modal.onKeyDown} aria-label="Connect NVIDIA AI">
      <h2>Connect NVIDIA AI</h2>
      <ol className="dialog-steps">
        <li>Open the GPT-OSS page on NVIDIA and sign in.</li>
        <li>Press “Get API Key”, then copy the key it shows (it starts with nvapi-) or the code shown with your key in it.</li>
        <li>Paste it below.</li>
      </ol>
      <div className="editor-actions">
        <button type="button" onClick={() => void platform.openLink(NVIDIA_PAGE)}>
          Open the NVIDIA page
        </button>
      </div>
      <textarea
        className="code-input"
        value={pasted}
        onChange={(e) => {
          setPasted(e.target.value)
          setProblem(null)
        }}
        placeholder="Paste the nvapi- key, or the Shell code"
        spellCheck={false}
        aria-label="NVIDIA code or key"
      />
      {read?.ok && !problem && (
        <p className="dialog-text">
          Found a key{read.setup.model ? ` for ${modelsFor(read.setup)[0]?.label}` : ''}. Kept in your Cairn account, so your phone uses it too, and sent only to NVIDIA.
        </p>
      )}
      {(problem ?? (read && !read.ok ? read.error : null)) && <p className="error">{problem ?? (read && !read.ok ? read.error : '')}</p>}
      {checking && <p className="dialog-text">Asking NVIDIA. Its free tier can take a minute or two to answer.</p>}
      <div className="editor-actions">
        <button type="button" className="quiet" onClick={modal.close}>
          Cancel
        </button>
        <span className="spacer" />
        <button type="button" className="primary" disabled={checking || !read?.ok} onClick={() => void save()}>
          {checking ? 'Checking…' : 'Check and save'}
        </button>
      </div>
    </dialog>
  )
}

/**
 * What the model is told matters, in the person's own words. It goes with
 * every message it reads, on whichever device is reading.
 */
export function ProfileDialog({ profile, onSave, onClose }: { profile: string; onSave: (text: string) => void; onClose: () => void }) {
  const modal = useModal(onClose)
  const [text, setText] = useState(profile)
  return (
    <dialog ref={modal.ref} className="editor" onKeyDown={modal.onKeyDown} aria-label="What matters to you">
      <h2>What matters to you</h2>
      <p className="dialog-text">Say what you want in Important and what you don't, in your own words. The AI reads every email and Classroom post with this in mind, on your phone and here.</p>
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
