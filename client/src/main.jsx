import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Standalone PWA launch: iOS can resume scroll position from a previous
// session, which leaves the app visually stuck mid-scroll. External script
// (not inline) so it complies with the production CSP (script-src 'self').
if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
  window.scrollTo(0, 0)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

