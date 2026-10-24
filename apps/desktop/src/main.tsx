import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CairnProvider } from './app/CairnProvider'
import { ClassroomFilesProvider } from './app/classroomFiles'
import { MediaProvider } from './app/media'
import { ToastProvider } from './app/toast'
import { detectPlatform } from './platform'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CairnProvider platform={detectPlatform()}>
      <MediaProvider>
        <ClassroomFilesProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ClassroomFilesProvider>
      </MediaProvider>
    </CairnProvider>
  </StrictMode>,
)
