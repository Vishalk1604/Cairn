import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CairnProvider } from './app/CairnProvider'
import { ClassroomFilesProvider } from './app/classroomFiles'
import { InboxProvider } from './app/inbox'
import { MediaProvider } from './app/media'
import { ToastProvider } from './app/toast'
import { detectPlatform } from './platform'
import './styles.css'

async function start() {
  // localhost:1420/?preview shows the signed-in screens with made-up data. Never in a build.
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).has('preview') ? await import('./preview') : null
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <CairnProvider platform={preview?.platform ?? detectPlatform()} preview={preview?.user}>
        <MediaProvider>
          <InboxProvider host={preview?.inboxHost}>
            <ClassroomFilesProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </ClassroomFilesProvider>
          </InboxProvider>
        </MediaProvider>
      </CairnProvider>
    </StrictMode>,
  )
}

void start()
