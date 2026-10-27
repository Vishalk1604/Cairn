import { useModal } from '../app/useModal'

/** Asks once before something that cannot be undone. */
export function ConfirmDialog({
  title,
  message,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string
  message: string
  confirm: string
  onConfirm: () => void
  onClose: () => void
}) {
  const modal = useModal(onClose)
  return (
    <dialog ref={modal.ref} className="editor confirm" onKeyDown={modal.onKeyDown} aria-label={title}>
      <h2>{title}</h2>
      <p className="dialog-text">{message}</p>
      <div className="editor-actions">
        <span className="spacer" />
        <button type="button" autoFocus onClick={modal.close}>
          Cancel
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            onConfirm()
            modal.close()
          }}
        >
          {confirm}
        </button>
      </div>
    </dialog>
  )
}
