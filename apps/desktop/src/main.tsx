import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CairnContext, openCairn } from './app/context'
import { ToastProvider } from './app/toast'
import { detectPlatform } from './platform'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

openCairn(detectPlatform()).then(
  (cairn) =>
    root.render(
      <StrictMode>
        <CairnContext.Provider value={cairn}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </CairnContext.Provider>
      </StrictMode>,
    ),
  (error: unknown) => {
    console.error(error)
    root.render(<p role="alert">Cairn couldn't open its data: {String(error)}</p>)
  },
)
