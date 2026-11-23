import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/atkinson-hyperlegible-next'
import '@fontsource-variable/archivo/wdth.css'
import '@lichess-org/chessground/assets/chessground.base.css'
import '@lichess-org/chessground/assets/chessground.cburnett.css'
import './styles/base.css'
import './styles/board.css'
import './styles/analysis.css'
import './styles/review.css'
import './styles/library.css'
import './styles/notes.css'
import './styles/endgames.css'
import './styles/practice.css'
import './styles/prep.css'
import './styles/settings.css'
import { App } from './App'
import { applySavedTheme } from './state/theme'

applySavedTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
