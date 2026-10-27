import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CairnProvider } from './app/CairnProvider'
import { ClassroomFilesProvider } from './app/classroomFiles'
import { InboxProvider } from './app/inbox'
import { MediaProvider } from './app/media'
import { ToastProvider } from './app/toast'
import { DESK_LABEL } from './desk/feed'
import { detectPlatform } from './platform'
import './styles.css'

/** The pinned widget is the same page in a window of its own, which the shell names. */
function isDeskWindow(): boolean {
  const internals = (window as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__
  return internals?.metadata?.currentWindow?.label === DESK_LABEL
}

async function start() {
  const root = createRoot(document.getElementById('root')!)
  if (isDeskWindow()) {
    document.documentElement.classList.add('desk-window')
    const { DeskWindow } = await import('./desk/DeskWindow')
    root.render(
      <StrictMode>
        <DeskWindow />
      </StrictMode>,
    )
    return
  }
  // localhost:1420/?preview shows the signed-in screens with made-up data. Never in a build.
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).has('preview') ? await import('./preview') : null
  // ?preview&desk shows the pinned widget instead, fed in the page.
  const deskPreview = preview && new URLSearchParams(location.search).has('desk') ? await import('./desk/DeskPreview') : null
  if (deskPreview) document.documentElement.classList.add('desk-window', 'desk-preview')
  root.render(
    <StrictMode>
      <CairnProvider platform={preview?.platform ?? detectPlatform()} preview={preview?.user}>
        <MediaProvider>
          <InboxProvider host={preview?.inboxHost}>
            <ClassroomFilesProvider>
              <ToastProvider>{deskPreview ? <deskPreview.DeskPreview /> : <App />}</ToastProvider>
            </ClassroomFilesProvider>
          </InboxProvider>
        </MediaProvider>
      </CairnProvider>
    </StrictMode>,
  )
}

void start()
